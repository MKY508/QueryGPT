"""Exercise real toolsets without a cloud model or the investigation runtime."""

from __future__ import annotations

import asyncio
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from pydantic_ai import Agent, ModelResponse, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.models.test import TestModel

from app.core.config import settings
from app.models.analysis import AnalysisReport
from app.services.analyst.python_tools import execute_python_code
from app.services.analyst.report_validation import validate_report
from app.services.analyst.session import AnalystSession
from app.services.analyst.toolsets import build_toolsets
from app.services.dependency_manager import ProjectDependencyManager
from app.services.execution_policy import ExecutionPolicy, ExecutionPolicyError
from app.services.project_context import ProjectRuntimeContext
from app.services.python_sandbox import PythonSandbox


class AnalystToolsetTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="receiptbi-toolsets-")
        self.addCleanup(temporary.cleanup)
        workspace = patch.object(settings, "WORKSPACE_ROOT", Path(temporary.name))
        workspace.start()
        self.addCleanup(workspace.stop)
        no_cloud = patch("pydantic_ai.models.ALLOW_MODEL_REQUESTS", False)
        no_cloud.start()
        self.addCleanup(no_cloud.stop)

    def session(self, *, policy=None, sources=None, callback=None):
        project = ProjectRuntimeContext(
            project_id=uuid4(), name="工具集检查", sources=sources or []
        )
        manager = ProjectDependencyManager(project.project_dir)
        sandbox = PythonSandbox(extra_paths=[manager.import_path])
        self.addCleanup(sandbox.cleanup)
        return AnalystSession(
            project=project,
            dependency_manager=manager,
            python_sandbox=sandbox,
            policy=policy or ExecutionPolicy(),
            checkpoint_callback=callback,
            current_query="按门店汇总销售额",
        )

    def test_tools_load_without_the_model_engine_or_runtime(self):
        probe = """
import importlib.abc
import sys

class NoRuntime(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname in {'app.services.analyst_runtime', 'app.services.model_engine'}:
            raise AssertionError(f'Tools loaded the model runtime: {fullname}')

sys.meta_path.insert(0, NoRuntime())
from app.services.analyst.toolsets import build_toolsets
from app.services.analyst.report_validation import validate_report
from app.services.execution_policy import ExecutionPolicy
assert sum(len(group.tools) for group in build_toolsets(ExecutionPolicy())) == 15
print('toolset-boundary-ok')
"""
        result = subprocess.run(
            [sys.executable, "-c", probe],
            capture_output=True,
            text=True,
            cwd=Path(__file__).resolve().parents[1],
            timeout=20,
            check=True,
        )
        self.assertEqual(result.stdout.strip().splitlines()[-1], "toolset-boundary-ok")

    async def test_one_agent_keeps_concurrent_file_analysis_sessions_separate(self):
        snapshots = [[], []]
        sessions = []
        for index, amount in enumerate((12, 120)):

            async def capture(snapshot, destination=snapshots[index]):
                destination.append(snapshot)
                return snapshot

            session = self.session(callback=capture)
            source_file = session.project.project_dir / "中文 门店销售.csv"
            source_file.parent.mkdir(parents=True, exist_ok=True)
            source_file.write_text(f"门店,金额\n甲店,{amount}\n甲店,8\n", encoding="utf-8")
            session.project.sources.append(
                {
                    "id": "sales",
                    "name": "Sales",
                    "kind": "file",
                    "format": "csv",
                    "view_name": "sales",
                    "working_uri": str(source_file),
                    "profile": {
                        "schema": {
                            "columns": [
                                {"name": "门店", "dtype": "object"},
                                {"name": "金额", "dtype": "int64"},
                            ]
                        }
                    },
                }
            )
            sessions.append(session)

        steps = [
            ("inspect_project_data", {}),
            (
                "query_source_data",
                {
                    "purpose": "读取销售明细",
                    "source_id": "sales",
                    "table": "sales",
                    "result_name": "orders",
                    "dimensions": ["门店", "金额"],
                    "limit": 20,
                },
            ),
            (
                "aggregate_result",
                {
                    "purpose": "汇总门店销售额",
                    "source_result": "orders",
                    "group_by": ["门店"],
                    "operation": "sum",
                    "value_column": "金额",
                    "output_column": "销售额",
                    "result_name": "sales_by_store",
                },
            ),
            (
                "validate_result",
                {
                    "purpose": "核对汇总结果",
                    "result_name": "sales_by_store",
                    "key_columns": ["门店"],
                    "numeric_columns": ["销售额"],
                },
            ),
        ]

        def respond(messages, info):
            step = sum(isinstance(message, ModelResponse) for message in messages)
            if step < len(steps):
                name, arguments = steps[step]
                return ModelResponse(parts=[ToolCallPart(name, arguments)])
            validation = next(
                part.content
                for message in reversed(messages)
                for part in message.parts
                if isinstance(part, ToolReturnPart) and part.tool_name == "validate_result"
            )
            total = validation["numeric"]["销售额"]["sum"]
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        info.output_tools[0].name,
                        {
                            "status": "completed",
                            "title": "门店销售额",
                            "summary": "已读取并核对当前项目的销售明细。",
                            "primary_result": "sales_by_store",
                            "metrics": [{"label": "销售额", "value": str(total)}],
                        },
                    )
                ]
            )

        agent = Agent(
            FunctionModel(respond),
            deps_type=AnalystSession,
            output_type=AnalysisReport,
            toolsets=build_toolsets(ExecutionPolicy()),
        )
        agent.output_validator(validate_report)
        reports = await asyncio.gather(
            *(agent.run(session.current_query, deps=session) for session in sessions)
        )
        for index, total in enumerate((20, 128)):
            self.assertEqual(reports[index].output.status, "completed")
            self.assertEqual(float(reports[index].output.metrics[0].value), total)
            self.assertTrue(reports[index].output.evidence)
            self.assertEqual(
                sessions[index].dataframes["sales_by_store"],
                [{"门店": "甲店", "销售额": total}],
            )
            self.assertEqual(len(snapshots[index]), 3)
            self.assertNotIn("sales_by_store", snapshots[index][0]["dataframes"])
            sessions[index].dataframes["orders"][0]["金额"] = -1
            self.assertGreater(snapshots[index][0]["dataframes"]["orders"][0]["金额"], 0)

    async def test_capabilities_and_checkpoint_state_follow_the_session(self):
        snapshots = []

        async def capture(snapshot):
            snapshots.append(snapshot)
            return snapshot

        policy = ExecutionPolicy(python_enabled=False, auto_repair_enabled=False)
        session = self.session(policy=policy, callback=capture)
        model = TestModel(call_tools=[], custom_output_text="ready")
        agent = Agent(model, deps_type=AnalystSession, toolsets=build_toolsets(policy))
        await agent.run("inspect available capabilities", deps=session)
        names = {tool.name for tool in model.last_model_request_parameters.function_tools}
        self.assertIn("query_source_data", names)
        self.assertTrue(
            {"render_chart", "analyze_with_python", "install_python_packages"}.isdisjoint(names)
        )
        execute = AsyncMock()
        with patch.object(session.python_sandbox, "execute", execute):
            with self.assertRaises(ExecutionPolicyError):
                await execute_python_code(session, "print(1)", sql_data={})
        execute.assert_not_called()

        await session.checkpoint(resumable=False, reason="python_state_not_replayable")
        await session.checkpoint()
        self.assertEqual([snapshot["resumable"] for snapshot in snapshots], [False, False])
        self.assertEqual(snapshots[-1]["reason"], "python_state_not_replayable")
        other = self.session(callback=capture)
        await other.checkpoint()
        self.assertTrue(snapshots[-1]["resumable"])
        session.queue_progress("validate_results")
        session.queue_progress("validate_results")
        self.assertEqual(session.progress_queue.qsize(), 1)
        self.assertTrue(other.progress_queue.empty())


if __name__ == "__main__":
    unittest.main()
