"""Real SQLite and disk boundaries for concurrent writes and resumed runs."""

import asyncio
import tempfile
import threading
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.base import Base
from app.db.tables import AnalysisRun, Conversation, Project
from app.models import SSEEvent
from app.services import analysis_checkpoint as checkpoint_store
from app.services.analysis_completion import AnalysisCompletion
from app.services.analysis_run_journal import AnalysisRunOwnershipError
from app.services.execution import ExecutionInputs, ExecutionService
from app.services.project_context import ProjectRuntimeContext
from tests.model_fixtures import synthetic_model_config


class AnalysisRunJournalTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        directory = tempfile.TemporaryDirectory(prefix="receiptbi-journal-")
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name) / "中文项目"
        self.root.mkdir()
        self.enterContext(patch.object(settings, "WORKSPACE_ROOT", self.root))
        self.engine = create_async_engine(f"sqlite+aiosqlite:///{self.root / '状态.sqlite'}")
        self.addAsyncCleanup(self.engine.dispose)
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False, autoflush=False)
        self.db = self.sessions()
        self.addAsyncCleanup(self.db.close)
        self.project_id, self.conversation_id, self.run_id = uuid4(), uuid4(), uuid4()
        self.run = AnalysisRun(
            id=self.run_id,
            project_id=self.project_id,
            conversation_id=self.conversation_id,
            query="查看销售",
            state="investigating",
            stage="read_files",
            checkpoint={"stream_attempt_id": "current", "resumable": True},
        )
        self.db.add_all(
            [
                Project(id=self.project_id, name="门店"),
                Conversation(id=self.conversation_id, title="销售", status="active"),
                self.run,
            ]
        )
        await self.db.commit()
        self.service = ExecutionService(
            self.db, project_id=self.project_id, stream_attempt_id="current"
        )
        self.journal = self.service._journal_for(self.run)

    async def observe(self):
        async with self.sessions() as observer:
            run = await observer.get(AnalysisRun, self.run_id)
            return run.state, run.stage, run.checkpoint, run.error

    async def checkpoint(self, **overrides):
        return await self.journal.checkpoint(
            {
                "analysis_state": "investigating",
                "stage": "validate_results",
                "safe_boundary": "after_tool",
                "resumable": True,
                **overrides,
            },
            project_dir=self.root,
            source_fingerprints={},
        )

    @asynccontextmanager
    async def blocked_disk_write(self):
        started, release = asyncio.Event(), threading.Event()
        loop = asyncio.get_running_loop()
        original = checkpoint_store._write_checkpoint_sync

        def write(*args, **kwargs):
            loop.call_soon_threadsafe(started.set)
            if not release.wait(5):
                raise TimeoutError("Test did not release the checkpoint writer")
            return original(*args, **kwargs)

        with patch.object(checkpoint_store, "_write_checkpoint_sync", side_effect=write):
            writer = asyncio.create_task(self.checkpoint())
            try:
                await asyncio.wait_for(started.wait(), 2)
                yield writer
            finally:
                release.set()
                await asyncio.wait_for(asyncio.gather(writer, return_exceptions=True), 3)

    async def test_snapshot_retains_current_context_without_old_continuation_flags(self):
        context = {
            "stream_attempt_id": "current",
            "semantic_validation_selection": [{"semantic_entry_id": "relationship"}],
            "standing_analysis": {"playbook_id": "weekly"},
            "correction_context": {"correction_id": "review"},
            "confirmation_receipt": {"applied": True},
            "confirmation_consumed_at": "2026-09-09T00:00:00Z",
        }
        # Another session updates metadata after the writer's ORM instance was loaded.
        async with self.sessions() as editor:
            current = await editor.get(AnalysisRun, self.run_id)
            current.checkpoint = {
                **context,
                "confirmation_receipt_status": "in_progress",
                "continuation_kind": "confirmation",
                "last_error": "old failure",
                "reason": "restoring",
            }
            await editor.commit()
        receipt = await self.checkpoint()
        for key, value in context.items():
            self.assertEqual(receipt[key], value)
        self.assertEqual(receipt["confirmation_receipt_status"], "consumed")
        self.assertNotIn("continuation_kind", receipt)
        self.assertNotIn("last_error", receipt)
        self.assertNotEqual(receipt.get("reason"), "restoring")
        self.assertEqual((await self.observe())[:2], ("investigating", "validate_results"))
        restored = await checkpoint_store.load_runtime_checkpoint(self.root, receipt)
        self.assertEqual(restored.manifest["safe_boundary"], "after_tool")
        receipt["confirmation_receipt"]["applied"] = False
        self.assertTrue(self.run.checkpoint["confirmation_receipt"]["applied"])

    async def test_progress_waits_for_checkpoint_without_holding_a_database_transaction(self):
        async with self.blocked_disk_write() as writer:
            started = asyncio.Event()

            async def progress():
                started.set()
                await self.journal.progress(
                    {"stage": "build_report", "analysis_state": "investigating"}
                )

            progress_task = asyncio.create_task(progress())
            await started.wait()
            self.assertFalse(progress_task.done())
            self.assertFalse(self.db.in_transaction())
            self.assertEqual((await self.observe())[1], "read_files")
        await asyncio.wait_for(progress_task, 2)
        self.assertTrue(writer.done())
        state, stage, checkpoint, _ = await self.observe()
        self.assertEqual((state, stage), ("investigating", "build_report"))
        self.assertEqual(checkpoint["revision"], 1)

    async def test_repeated_cancellation_joins_disk_and_receipt_before_marking_pause(self):
        async with self.blocked_disk_write() as writer:
            for _ in range(2):
                writer.cancel()
                await asyncio.sleep(0)
                self.assertFalse(writer.done())
            self.assertNotIn("revision", (await self.observe())[2])
        self.assertTrue(writer.cancelled())
        await self.service._mark_run_needs_attention(self.run, asyncio.CancelledError())
        state, stage, checkpoint, _ = await self.observe()
        self.assertEqual((state, stage), ("needs_attention", "paused"))
        self.assertEqual(checkpoint["revision"], 1)
        self.assertEqual(checkpoint["stream_attempt_id"], "current")
        await checkpoint_store.load_runtime_checkpoint(self.root, checkpoint)

    async def test_old_generation_cannot_publish_checkpoint_progress_result_or_failure(self):
        async with self.sessions() as editor:
            current = await editor.get(AnalysisRun, self.run_id)
            current.checkpoint = {"stream_attempt_id": "resumed", "reason": "restoring"}
            await editor.commit()
        expected = await self.observe()
        with self.assertRaises(AnalysisRunOwnershipError):
            await self.checkpoint()
        with self.assertRaises(AnalysisRunOwnershipError):
            await self.journal.progress({"stage": "old_progress"})
        self.service._stage_project_result = AsyncMock()
        completion = AnalysisCompletion(self.db, stage_transcript=AsyncMock())
        with self.assertRaises(AnalysisRunOwnershipError):
            await self.service._complete_result(self.run, {}, [], completion)
        self.service._stage_project_result.assert_not_awaited()
        completion.stage_transcript.assert_not_awaited()
        await self.service._mark_run_needs_attention(self.run, RuntimeError("Old failure"))
        self.assertEqual(await self.observe(), expected)
        self.assertFalse(self.db.in_transaction())
        self.assertFalse(self.service._run_event_context(self.run)["resumable"])

    async def test_failed_receipt_commit_preserves_the_previous_durable_checkpoint(self):
        first = await self.checkpoint()
        with patch.object(self.db, "commit", AsyncMock(side_effect=RuntimeError("Commit failed"))):
            with self.assertRaisesRegex(RuntimeError, "Commit failed"):
                await self.checkpoint(stage="build_report")
        self.assertEqual((await self.observe())[2], first)
        self.assertTrue((self.root / first["manifest_path"]).exists())
        # Do not delete an immutable file on an ambiguous database acknowledgement.
        self.assertEqual(len(list(self.root.glob("runs/*/checkpoints/*/manifest.json"))), 2)
        third = await self.checkpoint()
        self.assertEqual(third["revision"], 3)

    async def test_superseded_stream_publishes_no_terminal_result(self):
        async def events(**_kwargs):
            yield SSEEvent.progress("read_files", "读取数据", analysis_state="investigating")
            async with self.sessions() as editor:
                current = await editor.get(AnalysisRun, self.run_id)
                current.checkpoint = {"stream_attempt_id": "resumed", "reason": "restoring"}
                await editor.commit()
            yield SSEEvent.progress("completed", "报告完成", analysis_state="completed")
            yield SSEEvent.result(
                "旧结果", report={"status": "completed"}, analysis_state="completed"
            )

        self.service._load_execution_inputs = AsyncMock(
            return_value=ExecutionInputs(synthetic_model_config(), None, [])
        )
        self.service._prepare_analysis_run = AsyncMock(
            return_value=(self.run, "查看销售", None, None)
        )
        self.service._persist_explicit_confirmation = AsyncMock(return_value=None)
        self.service._build_engine = Mock(
            return_value=SimpleNamespace(execute=events, model_request_succeeded=False)
        )
        self.service._stage_project_result = AsyncMock()
        delivered = [
            event async for event in self.service.execute_stream("查看销售", self.conversation_id)
        ]
        self.assertEqual([event.type.value for event in delivered], ["progress", "error"])
        self.assertEqual(delivered[-1].data["code"], "CANCELLED")
        self.service._stage_project_result.assert_not_awaited()
        self.assertEqual((await self.observe())[2]["stream_attempt_id"], "resumed")

    async def test_terminal_snapshot_and_progress_cannot_finish_a_run(self):
        await self.checkpoint(analysis_state="completed", stage="completed")
        self.assertEqual((await self.observe())[:2], ("investigating", "read_files"))
        with self.assertRaises(ValueError):
            await self.journal.progress({"stage": "completed", "analysis_state": "completed"})
        async with self.journal.transaction():
            self.run.state = "completed"
        with self.assertRaises(AnalysisRunOwnershipError):
            await self.journal.progress({"stage": "late_progress"})
        self.assertEqual((await self.observe())[0], "completed")

    async def test_engine_uses_the_journal_and_ends_setup_transaction(self):
        context = ProjectRuntimeContext(project_id=self.project_id)
        with patch("app.services.execution.load_project_context", AsyncMock(return_value=context)):
            engine = await self.service._build_engine(
                ExecutionInputs(synthetic_model_config(), None, []), run=self.run
            )
        self.assertFalse(self.db.in_transaction())
        self.addCleanup(engine.deps.python_sandbox.cleanup)
        receipt = await engine.deps.checkpoint_callback(
            {
                "analysis_state": "investigating",
                "stage": "read_files",
                "safe_boundary": "after_tool",
            }
        )
        self.assertEqual(receipt["stream_attempt_id"], "current")
        self.assertEqual((await self.observe())[2]["manifest_path"], receipt["manifest_path"])


if __name__ == "__main__":
    unittest.main()
