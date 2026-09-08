"""Regression contract for deterministic preflight business-confirmation gating."""

from __future__ import annotations

from contextlib import nullcontext
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from pydantic_ai.models.test import TestModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import AnalysisRun, Conversation, Project, ProjectDataSource
from app.models import SSEEventType
from app.models.analysis import AnalysisReport
from app.services import analyst_runtime
from app.services.analyst_runtime import PydanticAnalystRuntime
from app.services.execution import ExecutionService
from app.services.project_context import ProjectRuntimeContext
from tests.model_fixtures import synthetic_model_config

REFUND_AMBIGUITY = {
    "key": "revenue_refund_policy",
    "question": "计算收入时，退款订单需要扣除吗？",
    "reason": "数据同时包含金额和退款字段，不同口径会改变收入结论。",
    "options": ["扣除退款", "保留退款订单", "按现有净额字段"],
}


class CompletedModelProbe:
    """A model-shaped probe that reveals whether the runtime crossed the gate."""

    def __init__(self) -> None:
        self.calls = 0

    async def run(self, prompt: str, *, deps: Any, model: Any) -> SimpleNamespace:
        del prompt, deps
        self.calls += 1
        return SimpleNamespace(
            output=AnalysisReport(
                status="completed",
                title="不应越过待确认口径",
                summary="模型准备直接完成分析。",
            )
        )


def _project_context(
    *,
    knowledge_state: str | None = None,
    ambiguity: dict[str, Any] | None = None,
    knowledge_key: str = REFUND_AMBIGUITY["key"],
) -> ProjectRuntimeContext:
    confirmed_knowledge: list[dict[str, Any]] = []
    if knowledge_state is not None:
        confirmed_knowledge.append(
            {
                "key": knowledge_key,
                "value": "扣除退款",
                "type": "business_rule",
                "state": knowledge_state,
                "confidence": 1,
            }
        )
    return ProjectRuntimeContext(
        project_id=uuid4(),
        name="门店经营项目",
        sources=[
            {
                "id": str(uuid4()),
                "name": "线上订单-2026-07.xlsx",
                "kind": "file",
                "format": "xlsx",
                "status": "needs_confirmation",
                "view_name": "online_orders",
                "working_uri": "/tmp/receiptbi-preflight-gate-unused.parquet",
                "profile": {
                    "logical_name": "online_orders",
                    "is_current": True,
                    "ambiguities": [ambiguity or REFUND_AMBIGUITY],
                },
            }
        ],
        confirmed_knowledge=confirmed_knowledge,
    )


def _runtime(
    monkeypatch: pytest.MonkeyPatch,
    *,
    knowledge_state: str | None = None,
    ambiguity: dict[str, Any] | None = None,
    knowledge_key: str = REFUND_AMBIGUITY["key"],
    language: str = "zh",
) -> tuple[PydanticAnalystRuntime, CompletedModelProbe]:
    monkeypatch.setattr(analyst_runtime, "model_session", lambda _config, **_kwargs: nullcontext(TestModel()))
    runtime = PydanticAnalystRuntime(
        model_config=synthetic_model_config(),
        project_context=_project_context(
            knowledge_state=knowledge_state,
            ambiguity=ambiguity,
            knowledge_key=knowledge_key,
        ),
        language=language,
    )
    probe = CompletedModelProbe()
    runtime.agent = probe
    return runtime, probe


@pytest.mark.asyncio
async def test_unresolved_active_source_ambiguity_blocks_before_model_and_returns_typed_action(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange: the active source has an unresolved question, while the model would complete.
    runtime, model = _runtime(monkeypatch)

    # Act: enter the production runtime at the same boundary used by chat execution.
    events = [event async for event in runtime.execute(query="比较各门店净收入")]

    # Assert: product policy, not model discretion, owns the blocking confirmation.
    result = next(event for event in events if event.type == SSEEventType.RESULT)
    report = result.data["report"]
    assert model.calls == 0
    assert result.data["analysis_state"] == "waiting_confirmation"
    assert report["status"] == "waiting_confirmation"
    assert report["confirmation"] == {
        **REFUND_AMBIGUITY,
        "presentation_code": "preflight.revenue_refund_policy",
        "option_codes": {
            "扣除退款": "exclude_refunds",
            "保留退款订单": "include_refunds",
            "按现有净额字段": "use_existing_net_amount",
        },
    }
    assert report["action"] == {
        "kind": "confirm",
        "label": "确认业务口径",
        "reason": REFUND_AMBIGUITY["reason"],
        "requested_data": [],
        "confirmation_key": REFUND_AMBIGUITY["key"],
        "options": REFUND_AMBIGUITY["options"],
    }


@pytest.mark.asyncio
async def test_system_owned_confirmation_and_progress_follow_english_language(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime, model = _runtime(monkeypatch, language="en")

    events = [event async for event in runtime.execute(query="比较各门店净收入")]

    progress = [event.data for event in events if event.type == SSEEventType.PROGRESS]
    result = next(event for event in events if event.type == SSEEventType.RESULT)
    assert model.calls == 0
    assert progress[0] == {
        "stage": "understanding",
        "step": "understand_data",
        "message": "Understanding the data and business definitions",
    }
    assert progress[-1] == {
        "stage": "waiting_confirmation",
        "step": "confirmation_required",
        "message": "A business definition that affects the conclusion needs confirmation",
    }
    assert result.data["report"]["title"] == "A business definition needs confirmation"
    assert result.data["report"]["action"]["label"] == "Confirm business definition"
    confirmation = result.data["report"]["confirmation"]
    assert confirmation["question"] == (
        "Should refunded orders be deducted when calculating revenue?"
    )
    assert confirmation["reason"].startswith("The data contains both amount and refund fields")
    assert confirmation["options"] == REFUND_AMBIGUITY["options"]
    assert confirmation["option_codes"]["扣除退款"] == "exclude_refunds"
    assert "### Confirmation needed" in result.data["content"]


@pytest.mark.asyncio
async def test_excel_preflight_confirmation_localizes_prose_but_not_sheet_names(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_id = uuid4()
    ambiguity = {
        "key": f"excel_sheet_selection:{source_id}",
        "presentation_code": "preflight.excel_sheet_selection",
        "presentation_facts": {"selected_sheet": "订单明细"},
        "question": "这次先分析工作表“订单明细”，是否正确？",
        "reason": "文件里有多个工作表，选择不同工作表可能改变分析范围。",
        "options": ["订单明细", "退款明细"],
    }
    runtime, model = _runtime(monkeypatch, ambiguity=ambiguity, language="en")

    events = [event async for event in runtime.execute(query="Analyze this workbook")]

    result = next(event for event in events if event.type == SSEEventType.RESULT)
    confirmation = result.data["report"]["confirmation"]
    assert model.calls == 0
    assert confirmation["question"] == ("Should this analysis use the “订单明细” worksheet?")
    assert confirmation["reason"].startswith("This file contains multiple worksheets")
    assert confirmation["options"] == ["订单明细", "退款明细"]


def test_queued_product_milestones_use_stable_steps_and_runtime_language(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime, _ = _runtime(monkeypatch, language="en")

    runtime._queue_product_progress("read_files")

    assert runtime.deps.progress_queue.get_nowait() == {
        "stage": "investigating",
        "step": "read_files",
        "message": "Reading the relevant file data",
    }


@pytest.mark.asyncio
async def test_preflight_alias_is_emitted_as_the_canonical_decision_slot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ambiguity = {**REFUND_AMBIGUITY, "key": "refund_handling"}
    runtime, model = _runtime(monkeypatch, ambiguity=ambiguity)

    events = [event async for event in runtime.execute(query="本月营收要不要扣除退款？")]

    result = next(event for event in events if event.type == SSEEventType.RESULT)
    assert model.calls == 0
    assert result.data["report"]["confirmation"]["key"] == "revenue_refund_policy"
    assert result.data["report"]["action"]["confirmation_key"] == "revenue_refund_policy"


@pytest.mark.asyncio
async def test_unrelated_question_does_not_trigger_refund_confirmation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime, model = _runtime(monkeypatch)

    events = [event async for event in runtime.execute(query="各渠道的订单数量分布如何？")]

    result = next(event for event in events if event.type == SSEEventType.RESULT)
    assert model.calls == 1
    assert result.data["analysis_state"] == "completed"
    assert result.data["report"]["confirmation"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("knowledge_state", ["confirmed", "locked"])
async def test_confirmed_or_locked_knowledge_suppresses_the_same_preflight_gate(
    monkeypatch: pytest.MonkeyPatch,
    knowledge_state: str,
) -> None:
    # Arrange: the source still carries its historical question, but the project answered it.
    runtime, model = _runtime(monkeypatch, knowledge_state=knowledge_state)

    # Act: run the same user request.
    events = [event async for event in runtime.execute(query="比较各门店净收入")]

    # Assert: the resolved key no longer interrupts the autonomous investigation.
    result = next(event for event in events if event.type == SSEEventType.RESULT)
    assert model.calls == 1
    assert result.data["analysis_state"] == "completed"
    assert result.data["report"]["status"] == "completed"
    assert result.data["report"]["confirmation"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("ambiguity_key", "knowledge_key"),
    [
        ("refund_policy", "revenue_refund_policy"),
        ("revenue_refund_policy", "refund_handling"),
    ],
)
async def test_preflight_resolution_compares_canonical_decision_slots(
    monkeypatch: pytest.MonkeyPatch,
    ambiguity_key: str,
    knowledge_key: str,
) -> None:
    runtime, model = _runtime(
        monkeypatch,
        knowledge_state="confirmed",
        ambiguity={**REFUND_AMBIGUITY, "key": ambiguity_key},
        knowledge_key=knowledge_key,
    )

    events = [event async for event in runtime.execute(query="本月营收要不要扣除退款？")]

    result = next(event for event in events if event.type == SSEEventType.RESULT)
    assert model.calls == 1
    assert result.data["analysis_state"] == "completed"


@pytest.mark.asyncio
async def test_confirmed_revenue_policy_does_not_swallow_an_adjacent_refund_decision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    refund_window = {
        "key": "refund_window_policy",
        "question": "退款申请允许在几天内提交？",
        "reason": "不同时限会改变客服处理流程。",
        "options": ["7 天内", "30 天内"],
        "affected_terms": ["退款", "申请时限"],
    }
    runtime, model = _runtime(
        monkeypatch,
        knowledge_state="confirmed",
        ambiguity=refund_window,
    )

    events = [event async for event in runtime.execute(query="退款申请时限是多少天？")]

    result = next(event for event in events if event.type == SSEEventType.RESULT)
    assert model.calls == 0
    assert result.data["analysis_state"] == "waiting_confirmation"
    assert result.data["report"]["confirmation"]["key"] == "refund_window_policy"


@pytest.mark.asyncio
async def test_generated_gate_resumes_same_run_but_rejects_unsupported_completion(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project = Project(name="预检确认真实续接项目")
    conversation = Conversation(title="门店订单调查", status="active")
    db_session.add_all([project, conversation])
    await db_session.flush()
    source = ProjectDataSource(
        project_id=project.id,
        kind="file",
        name="线上订单-2026-07.xlsx",
        format="xlsx",
        status="needs_confirmation",
        working_uri="/tmp/receiptbi-confirmation-gate-unused.parquet",
        profile_data={
            "logical_name": "online_orders",
            "is_current": True,
            "ambiguities": [
                {
                    **REFUND_AMBIGUITY,
                    "option_strategies": {
                        "扣除退款": {
                            "version": 1,
                            "kind": "business_rule_strategy",
                            "rule_key": "revenue_refund_policy",
                            "selected_option": "扣除退款",
                            "action": {
                                "kind": "value_filter",
                                "column": "退款状态",
                                "operator": "exclude",
                                "values": ["已退款"],
                                "observed_values": ["否", "已退款"],
                            },
                        }
                    },
                }
            ],
        },
    )
    db_session.add(source)
    await db_session.commit()

    model = TestModel(
        call_tools=[],
        custom_output_args={
            "status": "completed",
            "title": "已按确认口径继续",
            "summary": "同一项调查已经继续完成。",
        },
    )
    monkeypatch.setattr(analyst_runtime, "model_session", lambda _config, **_kwargs: nullcontext(model))
    service = ExecutionService(db_session, project_id=project.id)

    class Inputs:
        model_config = synthetic_model_config()
        db_config = None
        history: list[dict] = []
        language = "zh"

    async def fake_load_inputs(**_kwargs):
        return Inputs()

    monkeypatch.setattr(service, "_load_execution_inputs", fake_load_inputs)

    first_events = [
        event
        async for event in service.execute_stream(
            query="比较各门店净收入",
            conversation_id=conversation.id,
        )
    ]
    first_result = next(event for event in first_events if event.type == SSEEventType.RESULT)
    assert first_result.data["analysis_state"] == "waiting_confirmation"
    run_id = first_result.data["analysis_run_id"]

    confirmation = await client.post(
        "/api/v1/chat/confirm",
        json={
            "analysis_run_id": run_id,
            "key": REFUND_AMBIGUITY["key"],
            "selected_option": "扣除退款",
        },
    )
    assert confirmation.status_code == 200, confirmation.text
    assert confirmation.json()["data"]["resume_run_id"] == run_id

    second_events = [
        event
        async for event in service.execute_stream(
            query="继续",
            conversation_id=conversation.id,
            resume_run_id=UUID(run_id),
        )
    ]
    second_error = next(event for event in second_events if event.type == SSEEventType.ERROR)
    assert second_error.data["code"] == "CONFIRMATION_RESULT_REJECTED"
    assert second_error.data["analysis_run_id"] == run_id

    runs = list(
        (
            await db_session.execute(
                select(AnalysisRun).where(AnalysisRun.project_id == project.id)
            )
        ).scalars()
    )
    assert [str(item.id) for item in runs] == [run_id]
    assert runs[0].state == "needs_attention"
    assert runs[0].report["status"] == "needs_attention"
    assert runs[0].checkpoint["reason"] == "confirmation_result_rejected"
    assert runs[0].checkpoint["resumable"] is True
