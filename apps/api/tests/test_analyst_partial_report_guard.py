"""Output-guard contracts for honest reports over intentionally limited samples."""

from __future__ import annotations

from contextlib import nullcontext
from typing import Any

import pytest
from pydantic_ai import (
    ModelMessage,
    ModelResponse,
    ToolCallPart,
    capture_run_messages,
    models,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

from app.models import SSEEventType
from app.models.analysis import AnalysisReport
from app.services import analyst_runtime
from app.services.analyst.report_validation import (
    _allows_honest_partial_report,
    _business_evidence_from_tools,
)
from app.services.analyst_runtime import PydanticAnalystRuntime
from app.services.checkpoint_contract import stable_payload_hash
from app.services.project_context import ProjectRuntimeContext
from tests.model_fixtures import synthetic_model_config


def _report(
    *,
    summary: str = "已完成当前数据概览。",
    findings: list[str] | None = None,
) -> AnalysisReport:
    return AnalysisReport(
        status="completed",
        title="数据概览",
        summary=summary,
        findings=findings or [],
    )


@pytest.mark.parametrize(
    ("query", "report", "allowed"),
    [
        (
            "最多读取 100 行有限样本，做文字型数据质量概览，不要全表扫描",
            _report(),
            True,
        ),
        (
            "先快速做一份数据质量概览",
            _report(summary="以下结论只描述当前样本，不代表全量数据。"),
            True,
        ),
        (
            "检查空值和重复行，先给我一个文字概览",
            _report(),
            True,
        ),
        (
            "概览订单数据",
            _report(summary="模型自行把结果改为有限样本概览。"),
            False,
        ),
        (
            "计算全部订单总额、门店排名和各门店占比",
            _report(summary="以下只展示当前样本。"),
            False,
        ),
        (
            "抽样 100 行，但请给出全量订单总额",
            _report(summary="以下只展示当前样本。"),
            False,
        ),
        (
            "从全量数据中随机抽样 100 行做字段概览",
            _report(),
            True,
        ),
        (
            "抽样 100 行估算总体销售额",
            _report(summary="以下只展示当前样本。"),
            False,
        ),
        (
            "抽样 100 行做概览",
            _report(summary="全量销售额为 100 万。"),
            False,
        ),
        (
            "抽样 100 行做概览",
            AnalysisReport(
                status="completed",
                title="抽样概览",
                summary="以下只描述当前样本。",
                metrics=[
                    {
                        "label": "销售额",
                        "value": "全量 100 万",
                        "context": "当前样本",
                    }
                ],
            ),
            False,
        ),
    ],
)
def test_partial_report_authorization_comes_from_user_intent(
    query: str,
    report: AnalysisReport,
    allowed: bool,
):
    assert _allows_honest_partial_report(query, report) is allowed


def test_connection_evidence_does_not_invent_a_store_scenario():
    evidence = _business_evidence_from_tools(
        [
            {
                "kind": "structured_query",
                "source_kind": "connection",
                "result_name": "accounting_sample",
            }
        ],
        latest_result="accounting_sample",
    )

    assert "结论使用了已连接业务数据库中的实际记录。" in evidence
    assert all("门店" not in item for item in evidence)


def _runtime_with_truncated_sample(
    monkeypatch: pytest.MonkeyPatch,
    model: Any,
) -> PydanticAnalystRuntime:
    monkeypatch.setattr(models, "ALLOW_MODEL_REQUESTS", False)
    monkeypatch.setattr(
        analyst_runtime,
        "model_session",
        lambda _config, **_kwargs: nullcontext(FunctionModel(model)),
    )
    runtime = PydanticAnalystRuntime(
        model_config=synthetic_model_config(),
        project_context=ProjectRuntimeContext(
            name="有限样本门禁",
            sources=[
                {
                    "id": "orders-source",
                    "name": "订单",
                    "kind": "file",
                    "source_uri": "/tmp/not-read-by-this-test.parquet",
                }
            ],
        ),
    )
    rows = [{"row_number": index + 1, "quality_issue": index % 10 == 0} for index in range(100)]
    metadata = {
        "materialized_rows": len(rows),
        "request_limit": 100,
        "truncated": True,
        "result_completeness": "partial",
        "query_scope": "full",
        "source_id": "orders-source",
        "table_or_view": "orders",
    }
    result_hash = stable_payload_hash(rows)
    runtime.deps.dataframes["quality_sample"] = rows
    runtime.deps.result_metadata["quality_sample"] = metadata
    runtime.deps.validated_results.add("quality_sample")
    runtime.deps.tool_history.extend(
        [
            {
                "kind": "structured_query",
                "result_name": "quality_sample",
                "rows": len(rows),
                "truncated": True,
            },
            {
                "kind": "validation",
                "result_name": "quality_sample",
                "result_hash": result_hash,
                "profile": metadata,
            },
        ]
    )
    return runtime


@pytest.mark.asyncio
async def test_output_validator_allows_explicit_limited_quality_sample(
    monkeypatch: pytest.MonkeyPatch,
):
    calls = 0

    def model(_messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        nonlocal calls
        calls += 1
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "status": "completed",
                        "title": "订单数据质量概览",
                        "summary": "发现少量记录需要进一步检查。",
                        "primary_result": "quality_sample",
                        "findings": ["100 行中有 10 行被标记为需要复核。"],
                        "metrics": [{"label": "待复核记录", "value": "10 行"}],
                        "evidence": ["已对最终结果调用 validate_result。"],
                    },
                )
            ]
        )

    runtime = _runtime_with_truncated_sample(monkeypatch, model)
    events = [
        event
        async for event in runtime.execute(
            query="最多读取 100 行有限样本，做文字型数据质量概览，不要全表扫描"
        )
    ]

    result = next(event for event in events if event.type == SSEEventType.RESULT)
    report = result.data["report"]
    assert calls == 1
    assert result.data["analysis_state"] == "completed"
    assert result.data["truncated"] is True
    assert result.data["preview_truncated"] is False
    assert "100 行有限样本" in report["summary"]
    assert "不能外推为全量数据结论" in report["summary"]
    assert "100 行有限样本" in report["metrics"][0]["context"]
    assert report["visualization"] is None


@pytest.mark.asyncio
async def test_plain_text_sample_report_still_gets_real_source_evidence(
    monkeypatch: pytest.MonkeyPatch,
):
    def model(_messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "status": "completed",
                        "title": "订单字段概览",
                        "summary": "当前样本包含订单字段和质量风险。",
                        "primary_result": "quality_sample",
                        "findings": ["部分记录需要进一步复核。"],
                    },
                )
            ]
        )

    runtime = _runtime_with_truncated_sample(monkeypatch, model)
    runtime.deps.tool_history[0]["source_kind"] = "connection"
    events = [
        event
        async for event in runtime.execute(
            query="最多读取 100 行有限样本，做纯文字数据质量概览，不要画图"
        )
    ]

    result = next(event for event in events if event.type == SSEEventType.RESULT)
    assert result.data["report"]["evidence"] == [
        "结论使用了已连接业务数据库中的实际记录。",
        "最终汇总共 100 行，存在截断。",
    ]
    assert result.data["report"]["visualization"] is None


@pytest.mark.asyncio
async def test_output_validator_rejects_full_metrics_from_truncated_result(
    monkeypatch: pytest.MonkeyPatch,
):
    calls = 0

    def model(_messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        nonlocal calls
        calls += 1
        if calls == 1:
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        info.output_tools[0].name,
                        {
                            "status": "completed",
                            "title": "全量订单排名",
                            "summary": "以下数字代表全部订单。",
                            "primary_result": "quality_sample",
                            "metrics": [{"label": "订单总数", "value": "100"}],
                            "evidence": ["已对最终结果调用 validate_result。"],
                        },
                    )
                ]
            )
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "status": "needs_data",
                        "title": "需要来源端汇总",
                        "summary": "当前有限结果不能回答全量指标。",
                        "action": {
                            "kind": "add_data",
                            "label": "提供完整汇总",
                            "reason": "全量总计、排名和占比需要来源端完整汇总。",
                            "requested_data": ["按所需粒度聚合后的完整结果"],
                        },
                    },
                )
            ]
        )

    runtime = _runtime_with_truncated_sample(monkeypatch, model)
    with capture_run_messages() as messages:
        events = [
            event async for event in runtime.execute(query="计算全部订单总额、门店排名和各门店占比")
        ]

    result = next(event for event in events if event.type == SSEEventType.RESULT)
    assert calls == 2
    assert result.data["analysis_state"] == "needs_attention"
    assert result.data["report"]["status"] == "needs_data"
    assert any(
        getattr(part, "part_kind", None) == "retry-prompt"
        and "最终结果来自被截断的数据，请先在来源查询中完成汇总"
        in str(getattr(part, "content", ""))
        for message in messages
        for part in message.parts
    )
