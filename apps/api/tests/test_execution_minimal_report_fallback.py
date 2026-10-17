"""Focused coverage for the verified table-only report fallback."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError
from pydantic_ai import ModelRetry, UnexpectedModelBehavior
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import AnalysisRun, ArtifactRecord, Conversation, Project
from app.models import SSEEvent, SSEEventType
from app.models.analysis import AnalysisReport
from app.services.checkpoint_contract import stable_payload_hash
from app.services.execution import ExecutionService
from tests.model_fixtures import synthetic_model_config


def _invalid_report_output_error(*, business_rejection: bool = False) -> RuntimeError:
    error = UnexpectedModelBehavior("Exceeded maximum output retries (4)")
    if business_rejection:
        error.__cause__ = ModelRetry("最终结果没有满足业务校验")
        return error
    try:
        AnalysisReport.model_validate({"status": "completed"})
    except ValidationError as validation_error:
        error.__cause__ = validation_error
    return error


def _verified_dependencies(
    *,
    include_validation: bool = True,
    matching_hash: bool = True,
) -> SimpleNamespace:
    rows = [{"门店": "一店", "订单数": 12}]
    result_hash = stable_payload_hash(rows)
    tool_history: list[dict] = [
        {
            "kind": "aggregate",
            "purpose": "按门店汇总订单",
            "result_name": "store_orders",
            "rows": 1,
            "result_completeness": "complete",
        }
    ]
    if include_validation:
        validation = {
            "kind": "validation",
            "purpose": "核对最终门店汇总",
            "result_name": "store_orders",
            "result_hash": result_hash if matching_hash else "f" * 64,
            "profile": {
                "materialized_rows": 1,
                "columns": ["订单数", "门店"],
                "truncated": False,
                "keys": {},
                "numeric": {},
            },
        }
        tool_history.append(validation)
    return SimpleNamespace(
        dataframes={"store_orders": rows},
        result_metadata={
            "store_orders": {
                "materialized_rows": 1,
                "truncated": False,
                "result_completeness": "complete",
                "source_refs": [],
            }
        },
        validated_results={"store_orders"} if include_validation else set(),
        tool_history=tool_history,
    )


class _FailingEngine:
    def __init__(self, error: RuntimeError, deps: SimpleNamespace):
        self.error = error
        self.deps = deps
        self.semantic_adapter = SimpleNamespace(status="internal")

    async def execute(self, *, query, history, stop_checker):
        del query, history, stop_checker
        yield SSEEvent.progress("investigating", "正在核对数据")
        raise self.error


async def _stream_with_engine(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    *,
    engine: _FailingEngine,
    checkpoint: dict | None = None,
    language: str = "zh",
) -> tuple[list[SSEEvent], AnalysisRun]:
    project = Project(name="最小可信报告项目")
    conversation = Conversation(title="调查门店订单", status="active")
    db_session.add_all([project, conversation])
    await db_session.flush()
    service = ExecutionService(db_session, project_id=project.id, language=language)
    run = AnalysisRun(
        project_id=project.id,
        conversation_id=conversation.id,
        query="汇总各门店订单",
        state="understanding",
        stage="understanding",
        checkpoint={**(checkpoint or {}), "stream_attempt_id": service.stream_attempt_id},
    )
    db_session.add(run)
    await db_session.commit()

    async def fake_load_inputs(**_kwargs):
        return SimpleNamespace(model_config=synthetic_model_config(model="test"), history=[])

    async def fake_prepare_run(**_kwargs):
        return run, run.query, None, None

    async def fake_build_engine(_inputs, *, run, resume_checkpoint):
        del run, resume_checkpoint
        return engine

    monkeypatch.setattr(service, "_load_execution_inputs", fake_load_inputs)
    monkeypatch.setattr(service, "_prepare_analysis_run", fake_prepare_run)
    monkeypatch.setattr(service, "_build_engine", fake_build_engine)
    events = [
        event
        async for event in service.execute_stream(
            query=run.query,
            conversation_id=conversation.id,
        )
    ]
    await db_session.refresh(run)
    return events, run


@pytest.mark.asyncio
async def test_output_schema_failure_with_verified_final_table_persists_minimal_report(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    events, run = await _stream_with_engine(
        db_session,
        monkeypatch,
        engine=_FailingEngine(
            _invalid_report_output_error(),
            _verified_dependencies(),
        ),
    )

    result = next(event for event in events if event.type == SSEEventType.RESULT)
    assert result.data["analysis_state"] == "completed"
    assert result.data["report"]["metrics"] == []
    assert result.data["report"]["visualization"] is None
    assert "模型未能补充业务解释" in result.data["report"]["summary"]
    assert result.data["data"] == [{"门店": "一店", "订单数": 12}]
    assert run.state == "completed"
    assert run.checkpoint["report_fallback"]["reason_code"] == "MODEL_REPORT_OUTPUT_INVALID"
    assert run.checkpoint["report_fallback"]["result_hash"] == stable_payload_hash(
        result.data["data"]
    )

    artifacts = list(
        (
            await db_session.execute(
                select(ArtifactRecord).where(ArtifactRecord.analysis_run_id == run.id)
            )
        ).scalars()
    )
    assert {artifact.kind for artifact in artifacts} == {"report", "table", "evidence"}
    report_artifact = next(artifact for artifact in artifacts if artifact.kind == "report")
    assert (
        "UnexpectedModelBehavior"
        in report_artifact.technical_details["report_fallback"]["technical_error"]
    )


@pytest.mark.asyncio
async def test_minimal_report_fallback_uses_requested_english(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    events, _run = await _stream_with_engine(
        db_session,
        monkeypatch,
        engine=_FailingEngine(
            _invalid_report_output_error(),
            _verified_dependencies(),
        ),
        language="en",
    )

    result = next(event for event in events if event.type == SSEEventType.RESULT)
    report = result.data["report"]
    assert report["title"] == "Verified data result"
    assert "model could not complete the business explanation" in report["summary"]
    assert report["findings"][0] == "The verified table contains 1 row and 2 columns."
    assert report["evidence"] == [
        "The final table contents, row count, and fields match this investigation's validation record."
    ]
    assert "模型未能补充业务解释" not in report["summary"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("error", "deps"),
    [
        (RuntimeError("执行引擎失败"), _verified_dependencies()),
        (
            _invalid_report_output_error(business_rejection=True),
            _verified_dependencies(),
        ),
        (
            _invalid_report_output_error(),
            _verified_dependencies(include_validation=False),
        ),
        (
            _invalid_report_output_error(),
            _verified_dependencies(matching_hash=False),
        ),
    ],
    ids=["engine-error", "business-output-rejection", "no-validation", "hash-mismatch"],
)
async def test_fallback_rejects_everything_except_schema_invalid_verified_final_result(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    error: RuntimeError,
    deps: SimpleNamespace,
):
    events, run = await _stream_with_engine(
        db_session,
        monkeypatch,
        engine=_FailingEngine(error, deps),
    )

    assert not any(event.type == SSEEventType.RESULT for event in events)
    assert any(event.type == SSEEventType.ERROR for event in events)
    assert run.state == "needs_attention"
    artifacts = list(
        (
            await db_session.execute(
                select(ArtifactRecord).where(ArtifactRecord.analysis_run_id == run.id)
            )
        ).scalars()
    )
    assert artifacts == []


@pytest.mark.asyncio
async def test_fallback_rejects_missing_required_playbook_receipt(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    events, run = await _stream_with_engine(
        db_session,
        monkeypatch,
        engine=_FailingEngine(
            _invalid_report_output_error(),
            _verified_dependencies(),
        ),
        checkpoint={
            "standing_analysis": {
                "playbook_id": "pb_0123456789abcdefabcd",
                "playbook_shape_hash": "a" * 64,
            }
        },
    )

    assert not any(event.type == SSEEventType.RESULT for event in events)
    assert run.state == "needs_attention"


@pytest.mark.asyncio
async def test_fallback_keeps_unmet_required_correction_in_attention(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    events, run = await _stream_with_engine(
        db_session,
        monkeypatch,
        engine=_FailingEngine(
            _invalid_report_output_error(),
            _verified_dependencies(),
        ),
        checkpoint={"correction_context": {"correction_id": str(uuid4())}},
    )

    error = next(event for event in events if event.type == SSEEventType.ERROR)
    assert error.data["code"] == "CORRECTION_RESULT_REJECTED"
    assert not any(event.type == SSEEventType.RESULT for event in events)
    assert run.state == "needs_attention"
    assert run.checkpoint["reason"] == "correction_result_rejected"
