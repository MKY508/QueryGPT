"""Exercise durable completion through the real execution and chat persistence chain."""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

from pydantic import BaseModel, ValidationError
from pydantic_ai import UnexpectedModelBehavior
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import chat as chat_api
from app.core.config import settings
from app.db.base import Base
from app.db.tables import AnalysisRun, ArtifactRecord, Conversation, Message, Project
from app.models import SSEEvent
from app.services.chat_runtime import ActiveQueryRegistry, ChatTurn
from app.services.checkpoint_contract import stable_payload_hash
from app.services.execution import ExecutionInputs, ExecutionService
from tests.model_fixtures import synthetic_model_config


class AnalysisCompletionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        directory = tempfile.TemporaryDirectory(prefix="receiptbi-completion-")
        self.addCleanup(directory.cleanup)
        root = Path(directory.name) / "中文项目"
        root.mkdir()
        self.enterContext(patch.object(settings, "WORKSPACE_ROOT", root))
        self.engine = create_async_engine(f"sqlite+aiosqlite:///{root / '状态.sqlite'}")
        self.addAsyncCleanup(self.engine.dispose)
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        self.db = self.sessions()
        self.addAsyncCleanup(self.db.close)
        self.project_id, self.conversation_id, self.run_id = uuid4(), uuid4(), uuid4()
        self.db.add_all(
            [
                Project(id=self.project_id, name="门店"),
                Conversation(id=self.conversation_id, title="销售", status="active"),
                AnalysisRun(
                    id=self.run_id,
                    project_id=self.project_id,
                    conversation_id=self.conversation_id,
                    query="查看销售",
                    state="investigating",
                    stage="read_files",
                ),
            ]
        )
        await self.db.commit()
        self.registry = ActiveQueryRegistry()
        self.enterContext(patch.object(chat_api, "active_query_registry", self.registry))

    async def observe(self):
        async with self.sessions() as observer:
            run = await observer.get(AnalysisRun, self.run_id)
            conversation = await observer.get(Conversation, self.conversation_id)
            artifacts = list((await observer.scalars(select(ArtifactRecord))).all())
            messages = list(
                (await observer.scalars(select(Message).where(Message.role == "assistant"))).all()
            )
            return run, conversation, artifacts, messages

    async def make_stream(self, *, state="completed", fallback=False, project=True):
        run = await self.db.get(AnalysisRun, self.run_id)
        report = {"status": state, "title": "销售结果", "summary": "销售额为 42"}
        rows = [{"sales": 42}]

        async def events(**_kwargs):
            yield SSEEvent.progress("read_files", "读取数据", analysis_state="investigating")
            if fallback:
                class Output(BaseModel):
                    required: str

                try:
                    Output.model_validate({})
                except ValidationError as exc:
                    raise UnexpectedModelBehavior("Exceeded maximum output retries (1)") from exc
            yield SSEEvent.progress(state, "报告完成", analysis_state=state)
            yield SSEEvent.result(
                "销售额为 42",
                report=report,
                analysis_state=state,
                data=rows,
                result_name="sales",
            )
            yield SSEEvent.python_output("Calculation finished")

        runtime = SimpleNamespace(execute=events, model_request_succeeded=False)
        if fallback:
            profile = {"truncated": False, "materialized_rows": 1, "columns": ["sales"]}
            runtime.deps = SimpleNamespace(
                dataframes={"sales": rows},
                result_metadata={"sales": profile},
                validated_results={"sales"},
                tool_history=[
                    {"kind": "structured_query", "result_name": "sales"},
                    {
                        "kind": "validation",
                        "result_name": "sales",
                        "result_hash": stable_payload_hash(rows),
                        "profile": profile,
                    },
                ],
            )
        service = ExecutionService(self.db, project_id=self.project_id if project else None)
        service._load_execution_inputs = AsyncMock(
            return_value=ExecutionInputs(synthetic_model_config(), None, [])
        )
        service._prepare_analysis_run = AsyncMock(
            return_value=(run if project else None, "查看销售", None, None)
        )
        service._persist_explicit_confirmation = AsyncMock(return_value=None)
        service._build_engine = Mock(return_value=runtime)
        service.get_runtime_snapshot = AsyncMock(return_value={})
        self.enterContext(patch.object(chat_api, "ExecutionService", return_value=service))
        self.enterContext(patch.object(chat_api, "get_or_create_app_settings", AsyncMock()))
        self.enterContext(patch.object(chat_api, "settings_to_dict", return_value={}))
        response = await chat_api._chat_stream_response(
            query="查看销售",
            model=None,
            conversation_id=self.conversation_id,
            connection_id=None,
            project_id=self.project_id if project else None,
            resume_run_id=None,
            correction_id=None,
            client_stream_id="completion-test",
            language="zh",
            context_rounds=3,
            db=self.db,
        )
        async def close_stream():
            await response.body_iterator.aclose()

        self.addAsyncCleanup(close_stream)
        return response.body_iterator

    async def test_result_artifacts_and_transcript_share_one_visible_commit(self):
        original_stage = ChatTurn.stage
        observations = []

        async def inspect_staged(turn, db, events):
            await original_stage(turn, db, events)
            run, conversation, artifacts, messages = await self.observe()
            observations.append((run.state, conversation.status, len(artifacts), len(messages)))

        self.enterContext(patch.object(ChatTurn, "stage", inspect_staged))
        stream = await self.make_stream()
        async for raw in stream:
            item = json.loads(raw["data"])
            if item["type"] == "result":
                self.assertNotIn("python_images", item["data"])
                self.assertNotIn("visualization", item["data"])
                run, conversation, artifacts, messages = await self.observe()
                self.assertEqual((run.state, conversation.status), ("completed", "completed"))
                self.assertEqual({artifact.kind for artifact in artifacts}, {"report", "table"})
                self.assertEqual(len(messages), 1)
                self.assertEqual(messages[0].content, "销售额为 42")
                self.assertEqual(messages[0].extra_data["python_output"], "Calculation finished")
                break
        await stream.aclose()
        self.assertEqual(observations, [("investigating", "active", 0, 0)])
        run, conversation, _, messages = await self.observe()
        self.assertEqual((run.state, conversation.status), ("completed", "completed"))
        self.assertEqual(len(messages), 1)
        self.assertFalse(self.registry.is_active(self.conversation_id))

    async def test_message_insert_failure_rolls_back_the_entire_result(self):
        failed = False

        def fail_once(_mapper, _connection, message):
            nonlocal failed
            if message.role == "assistant" and not failed:
                failed = True
                raise RuntimeError("Synthetic transcript insert failure")

        event.listen(Message, "before_insert", fail_once)
        self.addCleanup(event.remove, Message, "before_insert", fail_once)
        stream = await self.make_stream()
        emitted = [json.loads(raw["data"]) async for raw in stream]
        self.assertTrue(failed)
        self.assertFalse(any(item["type"] in {"result", "done"} for item in emitted))
        self.assertFalse(any(item["data"].get("stage") == "completed" for item in emitted))
        run, conversation, artifacts, messages = await self.observe()
        self.assertEqual((run.state, conversation.status), ("needs_attention", "error"))
        self.assertEqual(run.report, {})
        self.assertEqual(artifacts, [])
        self.assertEqual(len(messages), 1)
        self.assertIn("error_code", messages[0].extra_data)
        self.assertNotIn("report", messages[0].extra_data)
        self.assertNotEqual(messages[0].content, "销售额为 42")

    async def test_cancellation_before_commit_discards_staged_success(self):
        staged = asyncio.Event()
        original_stage = ChatTurn.stage

        async def pause_before_commit(turn, db, events):
            await original_stage(turn, db, events)
            staged.set()
            await asyncio.Future()

        self.enterContext(patch.object(ChatTurn, "stage", pause_before_commit))
        stream = await self.make_stream()

        async def consume():
            return [item async for item in stream]

        task = asyncio.create_task(consume())
        try:
            await asyncio.wait_for(staged.wait(), 3)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        run, conversation, artifacts, messages = await self.observe()
        self.assertEqual((run.state, conversation.status), ("needs_attention", "error"))
        self.assertEqual(run.report, {})
        self.assertEqual(artifacts, [])
        self.assertEqual(len(messages), 1)
        self.assertNotIn("report", messages[0].extra_data)
        self.assertFalse(self.registry.is_active(self.conversation_id))

    async def test_cancellation_during_commit_waits_for_its_durable_outcome(self):
        committed = asyncio.Event()
        release = asyncio.Event()
        original_commit = self.db.commit

        async def pause_at_commit_return():
            completing = any(
                isinstance(item, Message) and item.role == "assistant" for item in self.db.new
            )
            await original_commit()
            if completing:
                committed.set()
                await release.wait()

        self.enterContext(patch.object(self.db, "commit", pause_at_commit_return))
        stream = await self.make_stream()

        async def consume():
            return [item async for item in stream]

        task = asyncio.create_task(consume())
        try:
            await asyncio.wait_for(committed.wait(), 3)
            task.cancel()
            await asyncio.sleep(0)
            self.assertFalse(task.done())
            task.cancel()
            await asyncio.sleep(0)
            self.assertFalse(task.done())
            release.set()
            with self.assertRaises(asyncio.CancelledError):
                await task
        finally:
            release.set()
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        run, conversation, artifacts, messages = await self.observe()
        self.assertEqual((run.state, conversation.status), ("completed", "completed"))
        self.assertEqual({artifact.kind for artifact in artifacts}, {"report", "table"})
        self.assertEqual(len(messages), 1)
        self.assertNotIn("error_code", messages[0].extra_data)
        self.assertFalse(self.registry.is_active(self.conversation_id))

    async def test_rejection_commits_only_rejected_report_and_error_message(self):
        run = await self.db.get(AnalysisRun, self.run_id)
        run.checkpoint = {
            "semantic_validation_selection": [
                {"semantic_entry_id": str(uuid4()), "relationship_key": "orders_to_stores"}
            ]
        }
        await self.db.commit()
        stream = await self.make_stream()
        emitted = [json.loads(raw["data"]) async for raw in stream]
        self.assertEqual(emitted[-1]["data"]["code"], "SEMANTIC_VALIDATION_INCOMPLETE")
        self.assertFalse(any(item["type"] in {"result", "done"} for item in emitted))
        run, conversation, artifacts, messages = await self.observe()
        self.assertEqual((run.state, conversation.status), ("needs_attention", "error"))
        self.assertEqual(run.checkpoint["reason"], "semantic_validation_incomplete")
        self.assertEqual([artifact.kind for artifact in artifacts], ["report"])
        self.assertEqual(artifacts[0].payload["status"], "needs_attention")
        self.assertEqual(len(messages), 1)
        self.assertNotIn("report", messages[0].extra_data)
        self.assertEqual(messages[0].extra_data["error_code"], "SEMANTIC_VALIDATION_INCOMPLETE")

    async def test_waiting_confirmation_is_saved_without_completing_the_conversation(self):
        stream = await self.make_stream(state="waiting_confirmation")
        emitted = [json.loads(raw["data"]) async for raw in stream]
        self.assertEqual(emitted[-1]["type"], "done")
        run, conversation, artifacts, messages = await self.observe()
        self.assertEqual((run.state, conversation.status), ("waiting_confirmation", "active"))
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0].extra_data["analysis_state"], run.state)
        self.assertTrue(artifacts)

    async def test_verified_table_only_report_uses_the_same_completion_transaction(self):
        stream = await self.make_stream(fallback=True)
        emitted = [json.loads(raw["data"]) async for raw in stream]
        self.assertEqual(emitted[-1]["type"], "done")
        result = next(item for item in emitted if item["type"] == "result")
        self.assertNotIn("report_fallback", result["data"])
        run, conversation, artifacts, messages = await self.observe()
        self.assertEqual((run.state, conversation.status), ("completed", "completed"))
        self.assertEqual(run.checkpoint["report_fallback"]["status"], "used")
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0].extra_data["report"], run.report)
        self.assertIn("table", {artifact.kind for artifact in artifacts})

    async def test_nonproject_result_is_committed_with_its_whole_terminal_batch(self):
        stream = await self.make_stream(project=False)
        emitted = [json.loads(raw["data"]) async for raw in stream]
        self.assertEqual(emitted[-1]["type"], "done")
        _, conversation, artifacts, messages = await self.observe()
        self.assertEqual(conversation.status, "completed")
        self.assertEqual(artifacts, [])
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0].extra_data["python_output"], "Calculation finished")


if __name__ == "__main__":
    unittest.main()
