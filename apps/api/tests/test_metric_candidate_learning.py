"""Focused contracts for deterministic aggregate metric candidate learning."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import (
    AnalysisRun,
    ArtifactRecord,
    Project,
    ProjectDataSource,
    SemanticEntry,
    SemanticEntryRevision,
)
from app.models.workspace import AggregateMetricDefinition, SemanticEntryCreate
from app.services.checkpoint_contract import stable_payload_hash
from app.services.execution import ExecutionService
from app.services.metric_candidate_learning import learn_verified_aggregate_metric_candidate
from app.services.result_filters import stable_field_binding_candidates


def test_aggregate_metric_definition_is_a_typed_semantic_contract():
    binding = stable_field_binding_candidates(
        {"kind": "file", "profile": _profile()},
        "paid_amount",
    )[0]
    payload = SemanticEntryCreate(
        key="metric:typed",
        value="orders 数据中“paid_amount”的合计候选",
        entry_type="metric",
        definition={
            "version": 1,
            "kind": "aggregate_metric",
            "operation": "sum",
            "source": binding,
            "null_policy": "ignore",
        },
    )

    assert isinstance(payload.definition, AggregateMetricDefinition)


def _profile(
    logical_name: str = "orders",
    columns: list[tuple[str, str]] | None = None,
) -> dict[str, Any]:
    return {
        "logical_name": logical_name,
        "is_current": True,
        "schema": {
            "columns": [
                {"name": name, "type": data_type}
                for name, data_type in (columns or [("paid_amount", "DOUBLE")])
            ]
        },
    }


async def _source(
    db: AsyncSession,
    project: Project,
    *,
    name: str = "orders-july.csv",
    profile: dict[str, Any] | None = None,
) -> ProjectDataSource:
    source = ProjectDataSource(
        project_id=project.id,
        kind="file",
        name=name,
        format="csv",
        status="ready",
        profile_data=profile or _profile(),
    )
    db.add(source)
    await db.flush()
    return source


def _result_payload(
    source: ProjectDataSource,
    *,
    operation: str = "sum",
    column: str = "paid_amount",
    alias: str = "sales",
    value: Any = 125.5,
) -> dict[str, Any]:
    result_name = "final_metric"
    logical_name = str((source.profile_data or {})["logical_name"])
    source_ref = {
        "source_id": str(source.id),
        "source_logical_name": logical_name,
        "source_kind": source.kind,
        "table_or_view": logical_name,
        "query_scope": "aggregated",
    }
    query_plan = {
        "source_id": str(source.id),
        "table": logical_name,
        "table_or_view": logical_name,
        "query_scope": "aggregated",
        "dimensions": [],
        "metrics": [{"operation": operation, "column": column, "alias": alias}],
        "filters": [],
        "sort": [],
        "limit": 1000,
        "is_aggregate": True,
    }
    rows = [{alias: value}]
    profile = {
        "materialized_rows": 1,
        "columns": [alias],
        "null_counts": {alias: 0},
        "duplicate_rows": 0,
        "keys": {},
        "numeric": {alias: {"count": 1, "sum": value, "min": value, "max": value}},
        "truncated": False,
        "request_limit": 1000,
        "source_id": str(source.id),
        "table_or_view": logical_name,
        "query_scope": "aggregated",
        "result_completeness": "complete",
        "query_plan": query_plan,
        "execution_backend": "duckdb",
        "execution_metadata": None,
        "source_refs": [source_ref],
    }
    return {
        "analysis_state": "completed",
        "report": {
            "status": "completed",
            "title": "销售汇总",
            "summary": "汇总已完成。",
            "metrics": [],
        },
        "data": rows,
        "rows_count": 1,
        "result_name": result_name,
        "tool_history": [
            {
                "kind": "structured_query",
                "source_kind": source.kind,
                "source_id": str(source.id),
                "table_or_view": logical_name,
                "query_scope": "aggregated",
                "result_completeness": "complete",
                "source_refs": [source_ref],
                "purpose": "汇总销售额",
                "query_plan": query_plan,
                "compiled_sql": f'SELECT SUM("{column}") AS "{alias}" FROM "{logical_name}"',
                "result_name": result_name,
                "rows": 1,
                "truncated": False,
            },
            {
                "kind": "validation",
                "purpose": "核对最终销售额",
                "result_name": result_name,
                "result_hash": stable_payload_hash(rows),
                "profile": profile,
            },
        ],
        "knowledge_proposals": [],
    }


async def _persist(
    db: AsyncSession,
    project: Project,
    payload: dict[str, Any],
    *,
    query: str = "汇总销售额",
) -> AnalysisRun:
    run = AnalysisRun(project_id=project.id, query=query)
    db.add(run)
    await db.commit()
    await ExecutionService(db, project_id=project.id)._persist_project_result(run, payload)
    return run


async def _metric_entries(db: AsyncSession, project: Project) -> list[SemanticEntry]:
    result = await db.execute(
        select(SemanticEntry).where(
            SemanticEntry.project_id == project.id,
            SemanticEntry.entry_type == "metric",
        )
    )
    return list(result.scalars().all())


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["sum", "avg"])
async def test_final_single_structured_aggregate_creates_verified_candidate(
    db_session: AsyncSession,
    operation: str,
):
    project = Project(name="指标候选")
    db_session.add(project)
    await db_session.flush()
    source = await _source(db_session, project)
    payload = _result_payload(source, operation=operation)

    run = await _persist(db_session, project, payload)

    entries = await _metric_entries(db_session, project)
    assert len(entries) == 1
    entry = entries[0]
    expected_binding = stable_field_binding_candidates(
        {"kind": source.kind, "profile": source.profile_data},
        "paid_amount",
    )[0]
    assert entry.key == f"metric:{stable_payload_hash(entry.definition)[:20]}"
    assert entry.state == "candidate"
    assert entry.execution_state == "verified"
    assert entry.source == "verified_analysis"
    assert entry.definition == {
        "version": 1,
        "kind": "aggregate_metric",
        "operation": operation,
        "source": expected_binding,
        "null_policy": "ignore",
    }
    expected_operation_label = "合计" if operation == "sum" else "平均值"
    assert entry.value == f"orders 数据中“paid_amount”的{expected_operation_label}候选"
    assert entry.execution_details["last_verified_run_id"] == str(run.id)
    assert entry.evidence[0]["result_hash"] == stable_payload_hash(payload["data"])
    assert entry.evidence[0]["result_name"] == payload["result_name"]
    assert entry.evidence[0]["artifact_id"]
    assert "observed_value" not in entry.evidence[0]
    assert str(payload["data"][0]["sales"]) not in str(entry.evidence[0])

    revisions = list(
        (
            await db_session.execute(
                select(SemanticEntryRevision).where(
                    SemanticEntryRevision.semantic_entry_id == entry.id
                )
            )
        ).scalars()
    )
    assert len(revisions) == 1
    assert revisions[0].mutation_kind == "deterministic_metric_candidate"
    assert revisions[0].snapshot["state"] == "candidate"
    assert revisions[0].snapshot["execution_state"] == "verified"


@pytest.mark.asyncio
async def test_metric_candidate_prefers_profile_business_label(db_session: AsyncSession):
    project = Project(name="业务字段标签")
    db_session.add(project)
    await db_session.flush()
    profile = _profile()
    profile["schema"]["columns"][0]["business_label"] = "实付金额"
    source = await _source(db_session, project, profile=profile)

    await _persist(db_session, project, _result_payload(source))

    entry = (await _metric_entries(db_session, project))[0]
    assert entry.value == "orders 数据中“实付金额”的合计候选"


@pytest.mark.asyncio
async def test_same_logical_metric_is_idempotent_and_survives_physical_source_replacement(
    db_session: AsyncSession,
):
    project = Project(name="月度指标")
    db_session.add(project)
    await db_session.flush()
    july = await _source(db_session, project, name="orders-july.csv")
    july_payload = _result_payload(july)
    july_run = await _persist(db_session, project, july_payload, query="七月销售额")
    entry = (await _metric_entries(db_session, project))[0]

    duplicate = await learn_verified_aggregate_metric_candidate(
        db_session,
        run=july_run,
        result_data=july_payload,
    )
    assert duplicate is entry
    assert entry.revision_number == 1

    july.profile_data = {**(july.profile_data or {}), "is_current": False}
    await db_session.commit()
    august = await _source(db_session, project, name="orders-august.csv")
    august_payload = _result_payload(august, value=140.0)
    august_run = await _persist(db_session, project, august_payload, query="八月销售额")

    entries = await _metric_entries(db_session, project)
    assert entries == [entry]
    await db_session.refresh(entry)
    assert entry.revision_number == 2
    assert len(entry.evidence) == 2
    assert {item["physical_source_id"] for item in entry.evidence} == {
        str(july.id),
        str(august.id),
    }
    assert entry.execution_details["last_verified_run_id"] == str(august_run.id)
    revisions = list(
        (
            await db_session.execute(
                select(SemanticEntryRevision)
                .where(SemanticEntryRevision.semantic_entry_id == entry.id)
                .order_by(SemanticEntryRevision.revision_number)
            )
        ).scalars()
    )
    assert [revision.mutation_kind for revision in revisions] == [
        "deterministic_metric_candidate",
        "deterministic_metric_observation",
    ]
    assert revisions[1].parent_revision_id == revisions[0].id


@pytest.mark.asyncio
async def test_model_proposal_cannot_overwrite_system_verified_metric_candidate(
    db_session: AsyncSession,
):
    project = Project(name="系统候选保护")
    db_session.add(project)
    await db_session.flush()
    source = await _source(db_session, project)
    await _persist(db_session, project, _result_payload(source))
    entry = (await _metric_entries(db_session, project))[0]
    original_value = entry.value
    original_definition = deepcopy(entry.definition)
    original_evidence = deepcopy(entry.evidence)
    original_revision_id = entry.active_revision_id
    original_revision_number = entry.revision_number

    proposal_payload = _result_payload(source, value=200.0)
    _reject_raw_sql(proposal_payload)
    proposal_payload["knowledge_proposals"] = [
        {
            "key": entry.key,
            "value": "模型擅自改成收入",
            "entry_type": "business_rule",
            "state": "confirmed",
            "confidence": 1,
            "definition": {
                "version": 1,
                "kind": "business_rule_strategy",
                "rule_key": entry.key,
                "selected_option": "模型擅自确认",
                "action": {"kind": "metric_column", "column": "paid_amount"},
            },
            "evidence": [{"kind": "model_claim"}],
            "source": "user",
        }
    ]
    await _persist(db_session, project, proposal_payload, query="模型尝试覆盖候选")

    await db_session.refresh(entry)
    assert entry.value == original_value
    assert entry.definition == original_definition
    assert entry.evidence == original_evidence
    assert entry.state == "candidate"
    assert entry.source == "verified_analysis"
    assert entry.execution_state == "verified"
    assert entry.active_revision_id == original_revision_id
    assert entry.revision_number == original_revision_number


@pytest.mark.asyncio
async def test_metric_learning_failure_does_not_reject_verified_report(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    project = Project(name="旁路学习失败")
    db_session.add(project)
    await db_session.flush()
    source = await _source(db_session, project)
    payload = _result_payload(source)
    run = AnalysisRun(project_id=project.id, query="汇总销售额")
    db_session.add(run)
    await db_session.commit()

    async def fail_metric_learning(*_args, **_kwargs):
        raise RuntimeError("simulated candidate write conflict")

    monkeypatch.setattr(
        "app.services.execution.learn_verified_aggregate_metric_candidate",
        fail_metric_learning,
    )
    outcome = await ExecutionService(
        db_session,
        project_id=project.id,
    )._persist_project_result(run, payload)

    assert outcome.accepted is True
    await db_session.refresh(run)
    assert run.state == "completed"
    assert run.report["status"] == "completed"
    artifacts = list(
        (
            await db_session.execute(
                select(ArtifactRecord).where(ArtifactRecord.analysis_run_id == run.id)
            )
        ).scalars()
    )
    assert {artifact.kind for artifact in artifacts} >= {"report", "table", "evidence"}
    assert await _metric_entries(db_session, project) == []


def _reject_raw_sql(payload: dict[str, Any]) -> None:
    payload["tool_history"][0]["kind"] = "sql"


def _reject_python(payload: dict[str, Any]) -> None:
    payload["tool_history"][0]["kind"] = "python"


def _reject_count(payload: dict[str, Any]) -> None:
    payload["tool_history"][0]["query_plan"]["metrics"][0]["operation"] = "count"


def _reject_multi_metric(payload: dict[str, Any]) -> None:
    payload["tool_history"][0]["query_plan"]["metrics"].append(
        {"operation": "avg", "column": "paid_amount", "alias": "average_sales"}
    )


def _reject_dimension(payload: dict[str, Any]) -> None:
    payload["tool_history"][0]["query_plan"]["dimensions"] = ["store"]


def _reject_filter(payload: dict[str, Any]) -> None:
    payload["tool_history"][0]["query_plan"]["filters"] = [
        {"column": "paid_amount", "operator": "gt", "value": 0}
    ]


def _reject_truncation(payload: dict[str, Any]) -> None:
    payload["tool_history"][0]["truncated"] = True
    payload["tool_history"][0]["result_completeness"] = "partial"
    payload["tool_history"][1]["profile"]["truncated"] = True
    payload["tool_history"][1]["profile"]["result_completeness"] = "partial"


def _reject_hash_mismatch(payload: dict[str, Any]) -> None:
    payload["tool_history"][1]["result_hash"] = "0" * 64


def _reject_no_validation(payload: dict[str, Any]) -> None:
    payload["tool_history"] = payload["tool_history"][:1]


def _reject_later_data_producer(payload: dict[str, Any]) -> None:
    later = deepcopy(payload["tool_history"][0])
    later["result_name"] = "unvalidated_later_result"
    payload["tool_history"].append(later)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mutate",
    [
        _reject_raw_sql,
        _reject_python,
        _reject_count,
        _reject_multi_metric,
        _reject_dimension,
        _reject_filter,
        _reject_truncation,
        _reject_hash_mismatch,
        _reject_no_validation,
        _reject_later_data_producer,
    ],
    ids=[
        "raw-sql",
        "python",
        "count",
        "multiple-metrics",
        "dimension",
        "filter",
        "truncated",
        "hash-mismatch",
        "unvalidated",
        "later-data-producer",
    ],
)
async def test_unsupported_or_unverified_result_does_not_create_metric_candidate(
    db_session: AsyncSession,
    mutate,
):
    project = Project(name="拒绝不可靠候选")
    db_session.add(project)
    await db_session.flush()
    source = await _source(db_session, project)
    payload = _result_payload(source)
    mutate(payload)

    await _persist(db_session, project, payload)

    assert await _metric_entries(db_session, project) == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("state", "is_active"),
    [("confirmed", True), ("locked", True), ("candidate", False)],
)
async def test_governed_or_inactive_metric_head_is_not_mutated(
    db_session: AsyncSession,
    state: str,
    is_active: bool,
):
    project = Project(name="受保护指标")
    db_session.add(project)
    await db_session.flush()
    source = await _source(db_session, project)
    first_payload = _result_payload(source)
    await _persist(db_session, project, first_payload)
    entry = (await _metric_entries(db_session, project))[0]
    entry.state = state
    entry.is_active = is_active
    entry.source = "user" if state != "candidate" else "verified_analysis"
    original_evidence = deepcopy(entry.evidence)
    original_revision = entry.active_revision_id
    source.profile_data = {**(source.profile_data or {}), "is_current": False}
    await db_session.commit()

    later_source = await _source(db_session, project, name="orders-later.csv")
    later_payload = _result_payload(later_source, value=999.0)
    await _persist(db_session, project, later_payload)

    await db_session.refresh(entry)
    assert entry.state == state
    assert entry.is_active is is_active
    assert entry.evidence == original_evidence
    assert entry.active_revision_id == original_revision


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "columns",
    [
        [("paid_amount", "VARCHAR")],
        [("paid_amount", "DOUBLE"), ("paid_amount", "DOUBLE")],
    ],
    ids=["non-numeric-binding", "ambiguous-binding"],
)
async def test_non_numeric_or_ambiguous_stable_binding_is_not_learned(
    db_session: AsyncSession,
    columns: list[tuple[str, str]],
):
    project = Project(name="无可靠字段绑定")
    db_session.add(project)
    await db_session.flush()
    source = await _source(db_session, project, profile=_profile(columns=columns))

    await _persist(db_session, project, _result_payload(source))

    assert await _metric_entries(db_session, project) == []


@pytest.mark.asyncio
async def test_duplicate_current_project_binding_is_not_learned(db_session: AsyncSession):
    project = Project(name="重复当前来源")
    db_session.add(project)
    await db_session.flush()
    selected = await _source(db_session, project, name="orders-a.csv")
    await _source(db_session, project, name="orders-b.csv")

    await _persist(db_session, project, _result_payload(selected))

    assert await _metric_entries(db_session, project) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("value", ["NaN", "not-a-number"], ids=["non-finite", "non-numeric"])
async def test_non_finite_or_non_numeric_final_value_is_not_learned(
    db_session: AsyncSession,
    value: str,
):
    project = Project(name="无有效最终指标值")
    db_session.add(project)
    await db_session.flush()
    source = await _source(db_session, project)

    await _persist(db_session, project, _result_payload(source, value=value))

    assert await _metric_entries(db_session, project) == []
