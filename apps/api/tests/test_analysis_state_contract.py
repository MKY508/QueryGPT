"""State and terminal publication across the runtime, checkpoint, and service."""

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

from app.models import SSEEvent
from app.models.analysis_state import AnalysisState
from app.services.analysis_checkpoint import load_runtime_checkpoint, save_runtime_checkpoint
from app.services.execution import ExecutionInputs, ExecutionService, ResultPersistenceOutcome
from tests.model_fixtures import synthetic_model_config


class AnalysisStateContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_checkpoint_round_trip_retains_state_separately_from_work_step(self):
        with tempfile.TemporaryDirectory(prefix="receiptbi-state-contract-") as directory:
            project = Path(directory) / "中文项目"
            receipt = await save_runtime_checkpoint(
                project,
                str(uuid4()),
                1,
                {
                    "analysis_state": AnalysisState.INVESTIGATING,
                    "stage": "validate_results",
                    "safe_boundary": "after_tool",
                },
            )
            self.assertEqual(receipt["analysis_state"], "investigating")
            restored = await load_runtime_checkpoint(project, receipt)
            self.assertEqual(restored.manifest["analysis_state"], "investigating")
            self.assertEqual(restored.manifest["stage"], "validate_results")

    async def test_explicit_state_drives_persistence_independently_of_stage_or_message(self):
        run = SimpleNamespace(
            id=uuid4(),
            project_id=uuid4(),
            state="understanding",
            stage="understanding",
            checkpoint={},
        )
        service = ExecutionService(AsyncMock())
        service._load_execution_inputs = AsyncMock(
            return_value=ExecutionInputs(
                model_config=synthetic_model_config(),
                db_config=None,
                history=[],
            )
        )
        service._prepare_analysis_run = AsyncMock(return_value=(run, "查看销售", None, None))
        service._persist_explicit_confirmation = AsyncMock(return_value=None)

        async def events(**_kwargs):
            yield SSEEvent.progress(
                "read_files", "Completed", analysis_state=AnalysisState.INVESTIGATING
            )
            yield SSEEvent.progress(
                "validate_results", "Reading files", analysis_state=AnalysisState.COMPLETED
            )
            yield SSEEvent.result(
                "已核对", report={"status": "completed"}, analysis_state="completed"
            )

        service._build_engine = Mock(
            return_value=SimpleNamespace(execute=events, model_request_succeeded=False)
        )

        async def persist(_run, data):
            self.assertEqual(run.state, AnalysisState.INVESTIGATING)
            self.assertEqual(run.stage, "read_files")
            self.assertEqual(data["analysis_state"], AnalysisState.COMPLETED)
            run.state = AnalysisState.COMPLETED
            return ResultPersistenceOutcome(accepted=True)

        service._persist_project_result = AsyncMock(side_effect=persist)
        stream = service.execute_stream("查看销售", uuid4())
        first = await anext(stream)
        self.assertEqual(first.data["analysis_state"], "investigating")
        self.assertEqual(run.state, "investigating")
        remaining = [event async for event in stream]
        self.assertTrue(remaining[0].is_terminal_progress)
        self.assertEqual(run.state, "completed")
        service._persist_project_result.assert_awaited_once()

    async def test_missing_active_or_mismatched_result_states_cannot_be_saved_as_completed(self):
        service = ExecutionService(AsyncMock())
        for state, status in (
            (None, "completed"),
            ("investigating", "completed"),
            ("completed", "needs_data"),
        ):
            with self.subTest(state=state, report_status=status):
                with self.assertRaises(ValueError):
                    await service._persist_project_result(
                        SimpleNamespace(),
                        {"analysis_state": state, "report": {"status": status}},
                    )
        service.db.commit.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
