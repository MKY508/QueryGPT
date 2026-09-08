"""Learn narrow, system-proven aggregate metric candidates from final results."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import AnalysisRun, ProjectDataSource, SemanticEntry
from app.models.workspace import AggregateMetricDefinition
from app.services.checkpoint_contract import stable_payload_hash
from app.services.result_filters import stable_field_binding_candidates
from app.services.semantic_revisions import append_semantic_revision
from app.services.validated_result_evidence import (
    DATA_PRODUCER_KINDS,
    ValidatedResultEvidenceError,
    load_validated_retained_result,
    trusted_source_catalog,
)

_MAX_EVIDENCE_ITEMS = 12


@dataclass(frozen=True)
class AggregateMetricObservation:
    definition: dict[str, Any]
    definition_hash: str
    key: str
    value: str
    evidence: dict[str, Any]
    execution_details: dict[str, Any]


def _finite_number(value: Any) -> bool:
    if value is None or isinstance(value, bool):
        return False
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def _same_source_refs(left: Any, right: Any) -> bool:
    if not isinstance(left, list) or not isinstance(right, list):
        return False
    return stable_payload_hash(left) == stable_payload_hash(right)


def _source_column_label(
    source: dict[str, Any],
    *,
    table_or_view: str,
    column: str,
) -> str:
    profile = source.get("profile")
    if not isinstance(profile, dict):
        return column
    if source.get("kind") == "file":
        schema = profile.get("schema")
        structures = [schema.get("columns") or []] if isinstance(schema, dict) else []
    else:
        structures = [
            table.get("columns") or []
            for table in profile.get("tables") or []
            if isinstance(table, dict) and str(table.get("name") or "") == table_or_view
        ]
    matches = [
        item
        for columns in structures
        for item in columns
        if isinstance(item, dict) and str(item.get("name") or "").strip() == column
    ]
    if len(matches) != 1:
        return column
    for key in ("business_label", "display_name", "label"):
        label = str(matches[0].get(key) or "").strip()
        if label:
            return label[:120]
    return column


async def _is_unique_current_project_binding(
    db: AsyncSession,
    *,
    run: AnalysisRun,
    selected_source_id: str,
    binding: dict[str, str],
) -> bool:
    result = await db.execute(
        select(ProjectDataSource).where(
            ProjectDataSource.project_id == run.project_id,
            ProjectDataSource.status == "ready",
        )
    )
    matching_source_ids: list[str] = []
    for source in result.scalars().all():
        profile = dict(source.profile_data or {})
        if profile.get("is_current") is not True:
            continue
        source_payload = {
            "id": str(source.id),
            "kind": source.kind,
            "status": source.status,
            "profile": profile,
        }
        if binding in stable_field_binding_candidates(
            source_payload,
            binding["action_column"],
        ):
            matching_source_ids.append(str(source.id))
    return matching_source_ids == [selected_source_id]


async def extract_verified_aggregate_metric_observation(
    db: AsyncSession,
    *,
    run: AnalysisRun,
    result_data: dict[str, Any],
) -> AggregateMetricObservation | None:
    """Extract only a final, one-row SUM/AVG produced by structured_query."""

    report = result_data.get("report")
    if (
        run.state != "completed"
        or result_data.get("analysis_state") != "completed"
        or not isinstance(report, dict)
        or report.get("status") != "completed"
    ):
        return None

    try:
        retained = await load_validated_retained_result(db, run)
    except ValidatedResultEvidenceError:
        return None

    validation = retained.validation
    result_name = str(validation.get("result_name") or "").strip()
    result_hash = str(validation.get("result_hash") or "").strip()
    profile = validation.get("profile")
    if (
        not result_name
        or str(result_data.get("result_name") or "").strip() != result_name
        or not isinstance(profile, dict)
        or profile.get("truncated") is not False
        or profile.get("result_completeness") != "complete"
        or profile.get("materialized_rows") != 1
        or type(result_data.get("rows_count")) is not int
        or result_data.get("rows_count") != 1
        or len(retained.rows) != 1
    ):
        return None
    result_rows = result_data.get("data")
    if (
        not isinstance(result_rows, list)
        or len(result_rows) != 1
        or not isinstance(result_rows[0], dict)
        or stable_payload_hash(result_rows) != result_hash
        or stable_payload_hash(result_rows) != stable_payload_hash(retained.rows)
    ):
        return None

    tool_history = [
        dict(item)
        for item in (run.checkpoint or {}).get("tool_history") or []
        if isinstance(item, dict)
    ]
    validation_indexes = [
        index
        for index, item in enumerate(tool_history)
        if item.get("kind") == "validation"
        and str(item.get("result_name") or "").strip() == result_name
        and str(item.get("result_hash") or "").strip() == result_hash
    ]
    producer_indexes = [
        index
        for index, item in enumerate(tool_history)
        if item.get("kind") in DATA_PRODUCER_KINDS
        and str(item.get("result_name") or "").strip() == result_name
    ]
    if (
        len(validation_indexes) != 1
        or len(producer_indexes) != 1
        or producer_indexes[0] >= validation_indexes[0]
    ):
        return None
    producer = tool_history[producer_indexes[0]]
    if (
        producer.get("kind") != "structured_query"
        or producer.get("truncated") is not False
        or producer.get("result_completeness") != "complete"
        or producer.get("query_scope") != "aggregated"
        or type(producer.get("rows")) is not int
        or producer.get("rows") != 1
    ):
        return None

    query_plan = producer.get("query_plan")
    if (
        not isinstance(query_plan, dict)
        or query_plan.get("is_aggregate") is not True
        or query_plan.get("query_scope") != "aggregated"
        or query_plan.get("dimensions") != []
        or query_plan.get("filters") != []
        or profile.get("query_plan") != query_plan
    ):
        return None
    metrics = query_plan.get("metrics")
    if not isinstance(metrics, list) or len(metrics) != 1 or not isinstance(metrics[0], dict):
        return None
    metric = metrics[0]
    operation = str(metric.get("operation") or "").strip()
    column = str(metric.get("column") or "").strip()
    alias = str(metric.get("alias") or "").strip()
    if operation not in {"sum", "avg"} or not column or not alias:
        return None

    final_row = retained.rows[0]
    if set(final_row) != {alias} or not _finite_number(final_row.get(alias)):
        return None
    profile_columns = profile.get("columns")
    if not isinstance(profile_columns, list) or profile_columns != [alias]:
        return None

    source_id = str(producer.get("source_id") or "").strip()
    table_or_view = str(producer.get("table_or_view") or "").strip()
    query_plan_source_id = str(query_plan.get("source_id") or "").strip()
    query_plan_table = str(query_plan.get("table_or_view") or query_plan.get("table") or "").strip()
    profile_source_id = str(profile.get("source_id") or "").strip()
    profile_table = str(profile.get("table_or_view") or "").strip()
    if (
        not source_id
        or not table_or_view
        or source_id != query_plan_source_id
        or source_id != profile_source_id
        or table_or_view != query_plan_table
        or table_or_view != profile_table
        or len(retained.source_refs) != 1
        or str(retained.source_refs[0].get("source_id") or "").strip() != source_id
        or str(retained.source_refs[0].get("table_or_view") or "").strip() != table_or_view
        or retained.source_refs[0].get("query_scope") != "aggregated"
        or not _same_source_refs(producer.get("source_refs"), retained.source_refs)
        or not _same_source_refs(profile.get("source_refs"), retained.source_refs)
    ):
        return None

    try:
        source_catalog = await trusted_source_catalog(
            db,
            run=run,
            source_refs=retained.source_refs,
        )
    except ValidatedResultEvidenceError:
        return None
    if len(source_catalog) != 1 or str(source_catalog[0].get("id") or "") != source_id:
        return None
    bindings = [
        binding
        for binding in stable_field_binding_candidates(source_catalog[0], column)
        if binding.get("table_or_view") == table_or_view
        and binding.get("canonical_type") == "number"
    ]
    if len(bindings) != 1:
        return None
    binding = bindings[0]
    if not await _is_unique_current_project_binding(
        db,
        run=run,
        selected_source_id=source_id,
        binding=binding,
    ):
        return None
    source_ref = retained.source_refs[0]
    if (
        source_ref.get("source_logical_name") != binding.get("source_logical_name")
        or source_ref.get("source_kind") != binding.get("source_kind")
        or producer.get("source_kind") != binding.get("source_kind")
    ):
        return None

    definition = AggregateMetricDefinition(
        kind="aggregate_metric",
        operation=operation,
        source=binding,
    ).model_dump(mode="json")
    definition_hash = stable_payload_hash(definition)
    observed_at = datetime.now(UTC).isoformat()
    evidence = {
        "version": 1,
        "kind": "deterministic_aggregate_metric_observation",
        "analysis_run_id": str(run.id),
        "artifact_id": str(retained.artifact.id),
        "result_name": result_name,
        "physical_source_id": source_id,
        "source_binding": binding,
        "operation": operation,
        "observed_output_alias": alias,
        "definition_hash": definition_hash,
        "query_plan_hash": stable_payload_hash(query_plan),
        "result_hash": result_hash,
        "validation_profile_hash": stable_payload_hash(profile),
        "observed_at": observed_at,
    }
    execution_details = {
        "version": 1,
        "status": "verified",
        "definition_hash": definition_hash,
        "last_verified_run_id": str(run.id),
        "result_hash": result_hash,
        "source_binding": binding,
        "verified_at": observed_at,
        "summary": "该聚合方式已在完整最终结果中验证；业务含义仍待确认。",
    }
    column_label = _source_column_label(
        source_catalog[0],
        table_or_view=table_or_view,
        column=column,
    )
    operation_label = "合计" if operation == "sum" else "平均值"
    value = f"{binding['source_logical_name']} 数据中“{column_label}”的{operation_label}候选"
    return AggregateMetricObservation(
        definition=definition,
        definition_hash=definition_hash,
        key=f"metric:{definition_hash[:20]}",
        value=value,
        evidence=evidence,
        execution_details=execution_details,
    )


async def learn_verified_aggregate_metric_candidate(
    db: AsyncSession,
    *,
    run: AnalysisRun,
    result_data: dict[str, Any],
) -> SemanticEntry | None:
    """Persist one candidate without changing governed semantic heads."""

    observation = await extract_verified_aggregate_metric_observation(
        db,
        run=run,
        result_data=result_data,
    )
    if observation is None:
        return None

    result = await db.execute(
        select(SemanticEntry)
        .where(
            SemanticEntry.project_id == run.project_id,
            SemanticEntry.key == observation.key,
        )
        .with_for_update()
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        if (
            not existing.is_active
            or existing.validity != "active"
            or existing.state != "candidate"
            or existing.source != "verified_analysis"
            or existing.definition != observation.definition
        ):
            return None
        evidence = [item for item in (existing.evidence or []) if isinstance(item, dict)]
        if any(
            item.get("kind") == "deterministic_aggregate_metric_observation"
            and item.get("analysis_run_id") == str(run.id)
            for item in evidence
        ):
            return existing
        previous_revision_id = existing.active_revision_id
        existing.evidence = [*evidence[-(_MAX_EVIDENCE_ITEMS - 1) :], observation.evidence]
        existing.execution_state = "verified"
        existing.execution_details = observation.execution_details
        existing.confidence = max(float(existing.confidence or 0), 0.75)
        await append_semantic_revision(
            db,
            existing,
            mutation_kind="deterministic_metric_observation",
            actor_source="verified_analysis",
            reason="完整最终结果再次验证了这项聚合指标候选",
            expected_active_revision_id=previous_revision_id,
        )
        return existing

    entry = SemanticEntry(
        project_id=run.project_id,
        key=observation.key,
        value=observation.value,
        entry_type="metric",
        state="candidate",
        confidence=0.75,
        definition=observation.definition,
        validity="active",
        execution_state="verified",
        execution_details=observation.execution_details,
        evidence=[observation.evidence],
        source="verified_analysis",
        is_active=True,
    )
    db.add(entry)
    await db.flush()
    await append_semantic_revision(
        db,
        entry,
        mutation_kind="deterministic_metric_candidate",
        actor_source="verified_analysis",
        reason="完整最终结果生成了待确认的聚合指标候选",
    )
    return entry
