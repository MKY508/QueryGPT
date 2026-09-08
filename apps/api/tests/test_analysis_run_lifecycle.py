"""Admission and startup recovery against real persisted state, without model calls."""

import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.base import Base
from app.db.tables import AnalysisRun, Conversation, Message, Project
from app.services import analysis_run_recovery as recovery
from app.services.analysis_checkpoint import save_runtime_checkpoint
from app.services.checkpoint_contract import CheckpointError
from app.services.execution import ExecutionInputs, ExecutionService
from tests.model_fixtures import synthetic_model_config


class AnalysisRunLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        directory = tempfile.TemporaryDirectory(prefix="receiptbi-lifecycle-")
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
        self.project_id, self.conversation_id = uuid4(), uuid4()
        self.db.add_all(
            [
                Project(id=self.project_id, name="门店"),
                Conversation(id=self.conversation_id, title="销售", status="active"),
            ]
        )
        await self.db.commit()

    async def run_row(self, state="needs_attention", stage="paused", **checkpoint):
        run = AnalysisRun(
            project_id=self.project_id,
            conversation_id=self.conversation_id,
            query="查看销售",
            state=state,
            stage=stage,
            checkpoint={"stream_attempt_id": "old", **checkpoint},
        )
        self.db.add(run)
        await self.db.commit()
        return run

    def service(self, db=None, attempt="current"):
        return ExecutionService(
            db or self.db, project_id=self.project_id, stream_attempt_id=attempt
        )

    async def resume(self, service, run_id):
        return await service._prepare_analysis_run(
            query="不能替换原始问题", conversation_id=self.conversation_id, resume_run_id=run_id
        )

    async def observe(self, run_id):
        async with self.sessions() as db:
            run = await db.get(AnalysisRun, run_id)
            messages = list(
                (
                    await db.scalars(
                        select(Message).where(
                            Message.extra_data["analysis_run_id"].as_string() == str(run_id)
                        )
                    )
                ).all()
            )
            return run, messages

    async def test_every_continuation_uses_the_original_question_and_current_context(self):
        receipt = {"key": "refund_policy", "selected_value": "扣除退款", "applied": True}
        cases = [
            (
                "understanding",
                "prepared",
                {"standing_analysis": {"id": "weekly"}},
                "understanding",
                False,
            ),
            (
                "waiting_confirmation",
                "confirmation_received",
                {"confirmation_receipt": receipt, "confirmation_receipt_status": "pending"},
                "confirmation_received",
                False,
            ),
            ("needs_attention", "paused", {"reason": "awaiting_data"}, "data_received", False),
            (
                "needs_attention",
                "paused",
                {"continuation_kind": "confirmation", "confirmation_receipt": receipt},
                "confirmation_received",
                False,
            ),
            ("needs_attention", "paused", {"continuation_kind": "data"}, "data_received", False),
            (
                "needs_attention",
                "paused",
                {"resumable": True, "manifest_path": "saved", "confirmation_receipt": receipt},
                "restoring",
                True,
            ),
        ]
        for state, stage, checkpoint, expected_stage, restored in cases:
            with self.subTest(stage=expected_stage, original=stage, checkpoint=checkpoint):
                run = await self.run_row(state, stage, **checkpoint)
                run_id = run.id
                prepared, query, snapshot, confirmation = await self.resume(self.service(), run_id)
                self.assertEqual(prepared.stage, expected_stage)
                self.assertTrue(query.startswith("查看销售"))
                self.assertEqual(snapshot is not None, restored)
                if confirmation:
                    self.assertEqual(confirmation["key"], "revenue_refund_policy")
                    self.assertIn("扣除退款", query)
                current, _ = await self.observe(run_id)
                self.assertEqual(current.state, "understanding")
                self.assertEqual(current.checkpoint["stream_attempt_id"], "current")
                self.assertFalse(self.db.in_transaction())

    async def test_two_resumers_cannot_both_claim_a_stale_attention_row(self):
        run = await self.run_row(resumable=True)
        run_id = run.id
        async with self.sessions() as second:
            await second.get(AnalysisRun, run_id)
            outcomes = await asyncio.gather(
                self.resume(self.service(attempt="one"), run_id),
                self.resume(self.service(second, "two"), run_id),
                return_exceptions=True,
            )
        self.assertEqual(sum(isinstance(value, tuple) for value in outcomes), 1)
        self.assertEqual(sum(isinstance(value, CheckpointError) for value in outcomes), 1)
        current, _ = await self.observe(run_id)
        self.assertIn(current.checkpoint["stream_attempt_id"], {"one", "two"})
        self.assertEqual(current.stage, "restoring")

    async def test_invalid_confirmation_and_cross_scope_requests_leave_state_unchanged(self):
        run = await self.run_row(
            "waiting_confirmation",
            "confirmation_received",
            confirmation_receipt={"applied": False},
            confirmation_receipt_status="pending",
        )
        run_id = run.id
        for mode in ("receipt", "project", "conversation"):
            with self.subTest(mode=mode):
                service = self.service()
                if mode == "project":
                    service.project_id = uuid4()
                with self.assertRaises(CheckpointError):
                    await service._prepare_analysis_run(
                        query="查看销售",
                        conversation_id=uuid4() if mode == "conversation" else self.conversation_id,
                        resume_run_id=run_id,
                    )
                current, messages = await self.observe(run_id)
                self.assertEqual(current.state, "waiting_confirmation")
                self.assertEqual(current.checkpoint["stream_attempt_id"], "old")
                self.assertEqual(messages, [])

    async def test_cancellation_during_admission_retains_the_run_identity_for_pause(self):
        for resume in (False, True):
            with self.subTest(resume=resume):
                run_id = (await self.run_row(resumable=True)).id if resume else None
                service = self.service()
                service._load_execution_inputs = AsyncMock(
                    return_value=ExecutionInputs(synthetic_model_config(), None, [])
                )
                service._build_engine = AsyncMock()
                started, release = asyncio.Event(), asyncio.Event()
                original_commit = self.db.commit

                async def commit():
                    if not started.is_set():
                        started.set()
                        await release.wait()
                    await original_commit()

                stream = service.execute_stream(
                    "查看销售", self.conversation_id, resume_run_id=run_id
                )
                with patch.object(self.db, "commit", side_effect=commit):
                    task = asyncio.create_task(anext(stream))
                    try:
                        await asyncio.wait_for(started.wait(), 2)
                        self.assertIsNotNone(service.analysis_run_id)
                        task.cancel()
                        await asyncio.sleep(0)
                        self.assertFalse(task.done())
                    finally:
                        release.set()
                        await asyncio.wait_for(asyncio.gather(task, return_exceptions=True), 2)
                        await stream.aclose()
                self.assertTrue(task.cancelled())
                current, _ = await self.observe(service.analysis_run_id)
                self.assertEqual((current.state, current.stage), ("needs_attention", "paused"))
                service._build_engine.assert_not_called()

    async def test_startup_preserves_prepared_runs_and_continuations_without_fake_checkpoints(self):
        prepared = await self.run_row(
            "understanding", "prepared", standing_analysis={"id": "weekly"}
        )
        confirmed = await self.run_row(
            "understanding",
            "confirmation_received",
            continuation_kind="confirmation",
            confirmation_receipt={"applied": True, "key": "refund_policy", "value": "扣除退款"},
        )
        broken = await self.run_row(
            "investigating", "read_files", resumable=True, manifest_path="missing"
        )
        saved = await self.run_row("investigating", "read_files")
        checkpoint = await save_runtime_checkpoint(
            self.root / str(self.project_id),
            str(saved.id),
            1,
            {"resumable": True, "safe_boundary": "after_tool", "analysis_state": "investigating"},
        )
        saved.checkpoint = {**checkpoint, "stream_attempt_id": "old"}
        await self.db.commit()
        self.assertEqual(await recovery.recover_interrupted_analysis_runs(self.db), 3)
        self.assertEqual((await self.observe(prepared.id))[0].stage, "prepared")
        for run, resumable in ((confirmed, True), (broken, False), (saved, True)):
            current, messages = await self.observe(run.id)
            self.assertEqual(current.checkpoint["resumable"], resumable)
            self.assertEqual(len(messages), 1)
            self.assertEqual(messages[0].extra_data["resumable"], resumable)
        self.assertEqual(await recovery.recover_interrupted_analysis_runs(self.db), 0)
        _, _, snapshot, receipt = await self.resume(self.service(), confirmed.id)
        self.assertIsNone(snapshot)
        self.assertTrue(receipt["applied"])

    async def test_startup_does_not_apply_a_file_check_to_a_changed_generation(self):
        run = await self.run_row("investigating", "read_files", resumable=True)
        run_id = run.id

        async def probe(*_args):
            self.assertFalse(self.db.in_transaction())
            async with self.sessions() as editor:
                current = await editor.get(AnalysisRun, run_id)
                current.checkpoint = {"stream_attempt_id": "new", "resumable": True}
                await editor.commit()
            return True, "可以继续"

        with patch.object(recovery, "_recovery_offer", side_effect=probe):
            self.assertEqual(await recovery.recover_interrupted_analysis_runs(self.db), 0)
        current, messages = await self.observe(run_id)
        self.assertEqual(current.state, "investigating")
        self.assertEqual(current.checkpoint["stream_attempt_id"], "new")
        self.assertEqual(messages, [])

    async def test_recovery_message_failure_rolls_back_state_and_repeated_staging_is_idempotent(
        self,
    ):
        run = await self.run_row("investigating", "read_files")
        run_id = run.id

        def fail(*_args):
            raise RuntimeError("Message insert failed")

        event.listen(Message, "before_insert", fail)
        try:
            with self.assertRaisesRegex(RuntimeError, "Message insert failed"):
                await recovery.recover_interrupted_analysis_runs(self.db)
        finally:
            event.remove(Message, "before_insert", fail)
        current, messages = await self.observe(run_id)
        self.assertEqual(current.state, "investigating")
        self.assertEqual(messages, [])
        await self.db.refresh(run)
        run.state = "needs_attention"
        await self.db.commit()
        await recovery.ensure_recovery_message(self.db, run, reason="client_disconnected")
        await recovery.ensure_recovery_message(self.db, run, reason="client_disconnected")
        self.assertEqual((await self.observe(run_id))[1], [])
        await self.db.commit()
        self.assertEqual(len((await self.observe(run_id))[1]), 1)


if __name__ == "__main__":
    unittest.main()
