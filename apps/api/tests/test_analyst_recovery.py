"""Checkpoint installation is all-or-nothing and independent of model selection."""

import base64
import copy
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel

from app.core.config import settings
from app.services.analysis_checkpoint import load_runtime_checkpoint, save_runtime_checkpoint
from app.services.analyst import result_store
from app.services.analyst.python_tools import _build_result_chart_code
from app.services.analyst.recovery import restore_session_checkpoint
from app.services.analyst.session import AnalystSession
from app.services.analyst_runtime import PydanticAnalystRuntime
from app.services.checkpoint_contract import (
    CheckpointDriftError,
    RestoredCheckpoint,
    stable_payload_hash,
)
from app.services.dependency_manager import ProjectDependencyManager
from app.services.execution_policy import ExecutionPolicy, ExecutionPolicyError
from app.services.project_context import ProjectRuntimeContext
from app.services.python_sandbox import PythonSandbox
from tests.model_fixtures import synthetic_model_config


class AnalystRecoveryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="receiptbi-recovery-")
        self.addCleanup(temporary.cleanup)
        workspace = patch.object(settings, "WORKSPACE_ROOT", Path(temporary.name) / "中文工作区")
        workspace.start()
        self.addCleanup(workspace.stop)
        cloud = patch("pydantic_ai.models.ALLOW_MODEL_REQUESTS", False)
        cloud.start()
        self.addCleanup(cloud.stop)

    def session(self, policy=None):
        project = ProjectRuntimeContext(project_id=uuid4(), name="门店调查")
        manager = ProjectDependencyManager(project.project_dir)
        sandbox = PythonSandbox(extra_paths=[manager.import_path])
        self.addCleanup(sandbox.cleanup)
        return AnalystSession(project, sandbox, manager, policy=policy or ExecutionPolicy())

    def checkpoint(self):
        rows = [{"store": "甲店", "sales": 20}]
        digest = stable_payload_hash(rows)
        return RestoredCheckpoint(
            manifest={
                "resumable": True,
                "result_metadata": {"sales": {"source_refs": [{"id": "source-a"}]}},
                "tool_history": [{"kind": "sql", "result_name": "sales"}],
                "knowledge_proposals": [{"key": "sales_policy", "definition": {"meaning": "paid"}}],
                "replay_journal": [
                    {
                        "op": "query_database",
                        "planned_sql": "SELECT store, sales FROM orders",
                        "result_name": "sales",
                        "result_hash": digest,
                    },
                    {"op": "validate_result", "result_name": "sales", "result_hash": digest},
                ],
            },
            dataframes={"sales": rows},
        )

    def assert_empty(self, session):
        for name in (
            "dataframes",
            "result_metadata",
            "tool_history",
            "replay_journal",
            "knowledge_proposals",
            "validated_results",
            "python_output",
            "python_images",
        ):
            self.assertFalse(getattr(session, name), name)

    def test_contract_and_recovery_have_separate_dependency_boundaries(self):
        probe = """
import importlib.abc
import sys
class ContractBoundary(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'sqlalchemy', 'pyarrow', 'pydantic_ai', 'openai', 'anthropic'}:
            raise AssertionError(fullname)
        if fullname == 'app.services.analysis_checkpoint':
            raise AssertionError(fullname)
guard = ContractBoundary()
sys.meta_path.insert(0, guard)
from app.services.checkpoint_contract import RestoredCheckpoint, stable_payload_hash
assert stable_payload_hash({'a': 1, 'b': 2}) == stable_payload_hash({'b': 2, 'a': 1})
sys.meta_path.remove(guard)
class RecoveryBoundary(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname in {'app.services.analyst_runtime', 'app.services.model_engine', 'app.services.analysis_checkpoint'}:
            raise AssertionError(fullname)
sys.meta_path.insert(0, RecoveryBoundary())
from app.services.analyst.recovery import restore_session_checkpoint
print('recovery-boundary-ok')
"""
        result = subprocess.run(
            [sys.executable, "-c", probe], text=True, capture_output=True, check=True, timeout=20
        )
        self.assertEqual(result.stdout.strip().splitlines()[-1], "recovery-boundary-ok")

    async def test_disk_checkpoint_installs_isolated_sessions(self):
        first, second = self.session(), self.session()
        snapshot = self.checkpoint()
        descriptor = await save_runtime_checkpoint(
            first.project.project_dir,
            uuid4(),
            1,
            {
                **snapshot.manifest,
                "dataframes": snapshot.dataframes,
            },
        )
        checkpoint = await load_runtime_checkpoint(first.project.project_dir, descriptor)
        self.assertIsInstance(checkpoint, RestoredCheckpoint)
        before = copy.deepcopy(checkpoint)
        restore_session_checkpoint(first, checkpoint)
        restore_session_checkpoint(second, checkpoint)
        self.assertEqual(first.validated_results, {"sales"})
        first.dataframes["sales"][0]["sales"] = 99
        first.result_metadata["sales"]["source_refs"][0]["id"] = "changed"
        first.tool_history[0]["kind"] = "changed"
        first.replay_journal[0]["result_hash"] = "changed"
        first.knowledge_proposals[0]["definition"]["meaning"] = "changed"
        self.assertEqual(checkpoint, before)
        self.assertEqual(second.dataframes, before.dataframes)
        self.assertEqual(second.result_metadata, before.manifest["result_metadata"])
        self.assertEqual(second.replay_journal, before.manifest["replay_journal"])
        self.assertEqual(second.knowledge_proposals, before.manifest["knowledge_proposals"])

    async def test_invalid_snapshot_never_enters_a_runtime_or_calls_a_model(self):
        checkpoint = self.checkpoint()
        checkpoint.manifest["replay_journal"][-1]["result_hash"] = "wrong"
        runtime = PydanticAnalystRuntime(
            model_config=synthetic_model_config(),
            project_context=self.session().project,
            resume_state=checkpoint,
        )
        self.assert_empty(runtime.deps)
        with patch(
            "app.services.analyst_runtime.model_session", side_effect=AssertionError("No model IO")
        ):
            with self.assertRaises(CheckpointDriftError):
                _ = [event async for event in runtime.execute(query="继续调查")]
        self.assert_empty(runtime.deps)

    async def test_validated_state_is_available_before_the_model_continues(self):
        checkpoint = self.checkpoint()
        calls = []

        def answer(messages, info):
            calls.append(messages)
            self.assertEqual(runtime.deps.dataframes, checkpoint.dataframes)
            self.assertEqual(runtime.deps.validated_results, {"sales"})
            self.assertEqual(runtime.deps.tool_history, checkpoint.manifest["tool_history"])
            self.assertIsNot(runtime.deps.dataframes["sales"][0], checkpoint.dataframes["sales"][0])
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        info.output_tools[0].name,
                        {
                            "status": "needs_data",
                            "title": "继续门店调查",
                            "summary": "需要补充同期数据。",
                            "action": {
                                "kind": "add_data",
                                "label": "补充同期数据",
                                "reason": "比较门店趋势需要同期销售记录。",
                                "requested_data": ["同期销售记录"],
                            },
                        },
                    )
                ]
            )

        runtime = PydanticAnalystRuntime(
            model_config=synthetic_model_config(),
            project_context=self.session().project,
            resume_state=checkpoint,
            model=FunctionModel(answer),
        )
        self.assert_empty(runtime.deps)
        events = [event async for event in runtime.execute(query="继续比较门店销售")]
        self.assertEqual(len(calls), 1)
        self.assertEqual(
            [event.data["report"]["status"] for event in events if event.type == "result"],
            ["needs_data"],
        )

    def test_invalid_journal_data_or_budget_leaves_the_destination_untouched(self):
        snapshots = []
        blocked = self.checkpoint()
        blocked.manifest["resumable"] = False
        snapshots.append(blocked)
        malformed = self.checkpoint()
        malformed.manifest["replay_journal"].append(None)
        snapshots.append(malformed)
        missing = self.checkpoint()
        missing.dataframes = {}
        snapshots.append(missing)
        for checkpoint in snapshots:
            with self.subTest(checkpoint=checkpoint.manifest):
                session = self.session()
                with self.assertRaises(CheckpointDriftError):
                    restore_session_checkpoint(session, checkpoint)
                self.assert_empty(session)
        session = self.session()
        with patch.object(result_store, "RUN_RESULT_MAX_ROWS", 0):
            with self.assertRaisesRegex(CheckpointDriftError, "超过当前运行预算"):
                restore_session_checkpoint(session, self.checkpoint())
        self.assert_empty(session)

    def test_live_session_cannot_be_replaced_by_a_saved_snapshot(self):
        session = self.session()
        session.tool_history = [{"kind": "new-work"}]
        with self.assertRaises(CheckpointDriftError):
            restore_session_checkpoint(session, self.checkpoint())
        self.assertEqual(session.tool_history, [{"kind": "new-work"}])
        self.assertFalse(session.dataframes)

    def test_chart_artifacts_and_current_capabilities_are_checked_before_install(self):
        checkpoint = self.checkpoint()
        chart = {
            "chart_type": "bar",
            "x": "store",
            "y": "sales",
            "value": None,
            "color": None,
            "title": "门店销售",
        }
        code = _build_result_chart_code(checkpoint.dataframes["sales"], **chart)
        checkpoint.python_output = ["Chart generated"]
        checkpoint.python_images = [base64.b64encode(b"synthetic-chart").decode()]
        checkpoint.manifest["replay_journal"].append(
            {
                "op": "render_chart",
                "result_name": "sales",
                "purpose": "比较门店",
                **chart,
                "input_hash": stable_payload_hash(checkpoint.dataframes["sales"]),
                "code_hash": stable_payload_hash(code),
                "output_index": 0,
                "image_start": 0,
                "image_count": 1,
                "output_hash": stable_payload_hash(checkpoint.python_output[0]),
                "image_hashes": [stable_payload_hash(checkpoint.python_images[0])],
            }
        )
        session = self.session()
        restore_session_checkpoint(session, checkpoint)
        self.assertEqual(session.python_images, checkpoint.python_images)
        session.python_images.clear()
        self.assertEqual(len(checkpoint.python_images), 1)
        disabled = self.session(policy=ExecutionPolicy(python_enabled=False))
        with self.assertRaises(ExecutionPolicyError):
            restore_session_checkpoint(disabled, checkpoint)
        self.assert_empty(disabled)
        checkpoint.manifest["replay_journal"][-1]["code_hash"] = "wrong"
        rejected = self.session()
        with self.assertRaises(CheckpointDriftError):
            restore_session_checkpoint(rejected, checkpoint)
        self.assert_empty(rejected)


if __name__ == "__main__":
    unittest.main()
