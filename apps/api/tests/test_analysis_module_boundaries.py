"""Exercise deterministic data work independently of the model runtime."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tests.model_fixtures import synthetic_model_config


class AnalysisModuleBoundaryTests(unittest.IsolatedAsyncioTestCase):
    def test_domain_and_data_modules_load_without_any_agent_sdk(self):
        probe = """
import importlib.abc
import sys

class NoAgentSDK(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'pydantic_ai', 'openai', 'anthropic'} or fullname == 'app.services.analyst_runtime':
            raise AssertionError(f'Data services loaded an agent dependency: {fullname}')

sys.meta_path.insert(0, NoAgentSDK())
from app.models.analysis import AnalysisReport
from app.models.query import StructuredQueryFilter
from app.services.structured_query import execute_structured_query
from app.services.analysis_playbook_runner import run_analysis_playbook
print('data-boundary-ok')
"""
        result = subprocess.run(
            [sys.executable, "-c", probe],
            capture_output=True,
            text=True,
            cwd=Path(__file__).resolve().parents[1],
            timeout=20,
            check=True,
        )
        self.assertEqual(result.stdout.strip(), "data-boundary-ok")

    async def test_real_file_query_and_evidence_use_the_shared_contract(self):
        from app.models.analysis import ChartSpec
        from app.models.workspace import AnalysisPlaybookStructuredQueryPlan
        from app.services.result_profile import profile_result
        from app.services.structured_query import (
            StructuredQueryExecutionError,
            execute_structured_query,
        )

        with tempfile.TemporaryDirectory(prefix="receiptbi-domain-") as directory:
            project = Path(directory) / "中文 项目"
            project.mkdir()
            source_file = project / "门店销售.csv"
            source_file.write_text(
                "门店,金额,状态\n甲店,12,完成\n甲店,8,完成\n乙店,90,退款\n", encoding="utf-8"
            )
            source = {
                "id": "synthetic-sales",
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
                            {"name": "状态", "dtype": "object"},
                        ]
                    }
                },
            }
            plan = AnalysisPlaybookStructuredQueryPlan.model_validate(
                {
                    "table": "sales",
                    "dimensions": ["门店"],
                    "metrics": [{"operation": "sum", "column": "金额", "alias": "销售额"}],
                    "filters": [{"column": "状态", "operator": "eq", "value": "完成"}],
                    "limit": 20,
                }
            )
            execution = await execute_structured_query(source, plan, project_dir=project)
            self.assertEqual(execution.rows, [{"门店": "甲店", "销售额": "20"}])
            self.assertEqual(execution.query_plan["query_scope"], "aggregated")
            evidence = profile_result(
                execution.rows, key_columns=["门店"], numeric_columns=["销售额"]
            )
            self.assertEqual(evidence["numeric"]["销售额"]["sum"], 20)
            self.assertEqual(evidence["keys"]["门店"]["unique"], 1)
            chart = ChartSpec.model_validate(
                {
                    "type": "bar",
                    "encoding": {"x": {"field": "门店"}, "y": ["销售额"]},
                    "data": [{"销售额": 999999}],
                }
            )
            self.assertEqual(chart.data, [])
            self.assertEqual(chart.encoding.y[0].field, "销售额")
            self.assertIn("甲店,12,完成", source_file.read_text(encoding="utf-8"))

            invalid = plan.model_copy(update={"dimensions": ["不存在的字段"]})
            with self.assertRaises(StructuredQueryExecutionError):
                await execute_structured_query(source, invalid, project_dir=project)

    async def test_injected_model_still_emits_the_product_report_contract(self):
        from pydantic_ai.models.test import TestModel

        from app.models.analysis import AnalysisReport
        from app.services.analyst_runtime import PydanticAnalystRuntime
        from app.services.project_context import ProjectRuntimeContext

        runtime = PydanticAnalystRuntime(
            model_config=synthetic_model_config(),
            project_context=ProjectRuntimeContext(name="Synthetic project"),
            model=TestModel(
                call_tools=[],
                custom_output_args={
                    "status": "needs_data",
                    "title": "需要销售数据",
                    "summary": "添加销售明细后才能分析。",
                    "action": {
                        "kind": "add_data",
                        "label": "添加销售明细",
                        "reason": "当前项目没有销售明细。",
                        "requested_data": ["包含门店与金额的销售明细"],
                    },
                },
            ),
        )
        events = [event async for event in runtime.execute(query="查看销售情况")]
        reports = [event.data["report"] for event in events if event.type == "result"]
        self.assertEqual(
            len(reports), 1, json.dumps([event.model_dump(mode="json") for event in events])
        )
        report = AnalysisReport.model_validate(reports[0])
        self.assertEqual(report.status, "needs_data")
        self.assertEqual(report.action.kind, "add_data")


if __name__ == "__main__":
    unittest.main()
