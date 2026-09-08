"""Fail-closed access to a completed run's fully retained final result."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import AnalysisRun, ArtifactRecord, ProjectDataSource
from app.services.checkpoint_contract import stable_payload_hash

DATA_PRODUCER_KINDS = frozenset(
    {
        "structured_query",
        "sql",
        "file_sql",
        "join",
        "aggregate",
        "business_rule_application",
    }
)


@dataclass(frozen=True)
class ValidatedRetainedResult:
    rows: list[dict[str, Any]]
    artifact: ArtifactRecord
    validation: dict[str, Any]
    source_refs: list[dict[str, Any]]


class ValidatedResultEvidenceError(ValueError):
    def __init__(self, reason_code: str, summary: str):
        self.reason_code = reason_code
        self.summary = summary
        super().__init__(summary)


def _result_dependencies(step: dict[str, Any]) -> list[str]:
    dependencies: list[str] = []
    for key in ("source_result", "left_result", "right_result"):
        value = str(step.get(key) or "").strip()
        if value:
            dependencies.append(value)
    dependencies.extend(
        str(value).strip() for value in (step.get("input_results") or []) if str(value).strip()
    )
    return dependencies


def lineage_source_ids(tool_history: list[dict[str, Any]], result_name: str) -> set[str]:
    producers: dict[str, dict[str, Any]] = {}
    for item in tool_history:
        name = str(item.get("result_name") or "").strip()
        if not name or item.get("kind") not in DATA_PRODUCER_KINDS:
            continue
        if name in producers:
            raise ValidatedResultEvidenceError(
                "AMBIGUOUS_RESULT_LINEAGE",
                "已记住这条定义；最终结果存在重复的来源记录，暂不自动执行。",
            )
        producers[name] = item
    if result_name not in producers:
        raise ValidatedResultEvidenceError(
            "MISSING_RESULT_LINEAGE",
            "已记住这条定义；最终结果缺少可核对的数据来源链路。",
        )
    source_ids: set[str] = set()
    pending = [result_name]
    visited: set[str] = set()
    while pending:
        current = pending.pop()
        if not current or current in visited:
            continue
        visited.add(current)
        step = producers.get(current)
        if step is None:
            raise ValidatedResultEvidenceError(
                "BROKEN_RESULT_LINEAGE",
                "已记住这条定义；最终结果的数据来源链路不完整。",
            )
        source_id = str(step.get("source_id") or "").strip()
        if source_id:
            source_ids.add(source_id)
        source_refs = list(step.get("source_refs") or [])
        profile = step.get("profile")
        if isinstance(profile, dict):
            source_refs.extend(profile.get("source_refs") or [])
        for source_ref in source_refs:
            if not isinstance(source_ref, dict):
                continue
            source_id = str(source_ref.get("source_id") or "").strip()
            if source_id:
                source_ids.add(source_id)
        pending.extend(_result_dependencies(step))
    return source_ids


async def load_validated_retained_result(
    db: AsyncSession,
    run: AnalysisRun,
) -> ValidatedRetainedResult:
    if run.state != "completed":
        raise ValidatedResultEvidenceError(
            "RUN_NOT_COMPLETED",
            "已记住这条定义；原调查尚未完成，不能从中建立自动执行方式。",
        )
    tool_history = [
        dict(item)
        for item in (run.checkpoint or {}).get("tool_history") or []
        if isinstance(item, dict)
    ]
    validations = [
        (index, item) for index, item in enumerate(tool_history) if item.get("kind") == "validation"
    ]
    if not validations:
        raise ValidatedResultEvidenceError(
            "NO_FINAL_VALIDATION",
            "已记住这条定义；原报告没有最终结果校验，暂不自动执行。",
        )
    validation_index, validation = validations[-1]
    result_name = str(validation.get("result_name") or "").strip()
    result_hash = str(validation.get("result_hash") or "").strip()
    profile = validation.get("profile")
    if not result_name or len(result_hash) != 64 or not isinstance(profile, dict):
        raise ValidatedResultEvidenceError(
            "INVALID_FINAL_VALIDATION",
            "已记住这条定义；原报告的最终校验记录不完整，暂不自动执行。",
        )
    if profile.get("truncated") is not False:
        raise ValidatedResultEvidenceError(
            "TRUNCATED_FINAL_RESULT",
            "已记住这条定义；原报告结果不完整，不能安全建立自动执行方式。",
        )
    materialized_rows = profile.get("materialized_rows")
    if type(materialized_rows) is not int or materialized_rows < 0:
        raise ValidatedResultEvidenceError(
            "UNKNOWN_FINAL_ROW_COUNT",
            "已记住这条定义；原报告缺少完整行数证据，暂不自动执行。",
        )
    if any(
        item.get("kind") in DATA_PRODUCER_KINDS for item in tool_history[validation_index + 1 :]
    ):
        raise ValidatedResultEvidenceError(
            "UNVALIDATED_LATER_RESULT",
            "已记住这条定义；最终校验后仍有新的数据结果，暂不自动执行。",
        )

    lineage_ids = lineage_source_ids(tool_history, result_name)
    source_refs = [
        dict(item) for item in profile.get("source_refs") or [] if isinstance(item, dict)
    ]
    if not source_refs:
        raise ValidatedResultEvidenceError(
            "MISSING_SOURCE_REFS",
            "已记住这条定义；最终结果没有可靠的数据来源记录，暂不自动执行。",
        )
    ref_source_ids = {
        str(item.get("source_id") or "").strip()
        for item in source_refs
        if str(item.get("source_id") or "").strip()
    }
    if len(ref_source_ids) != len(source_refs):
        raise ValidatedResultEvidenceError(
            "INVALID_SOURCE_REFS",
            "已记住这条定义；最终结果的数据来源记录不完整或重复。",
        )
    if lineage_ids and lineage_ids != ref_source_ids:
        raise ValidatedResultEvidenceError(
            "SOURCE_LINEAGE_MISMATCH",
            "已记住这条定义；最终结果和数据来源链路不一致，暂不自动执行。",
        )

    artifact_result = await db.execute(
        select(ArtifactRecord).where(
            ArtifactRecord.analysis_run_id == run.id,
            ArtifactRecord.kind == "table",
        )
    )
    artifacts = [
        artifact
        for artifact in artifact_result.scalars().all()
        if str((artifact.technical_details or {}).get("result_name") or "") == result_name
    ]
    if len(artifacts) != 1:
        raise ValidatedResultEvidenceError(
            "MISSING_RETAINED_RESULT",
            "已记住这条定义；找不到唯一的最终保留结果，暂不自动执行。",
        )
    artifact = artifacts[0]
    payload = artifact.payload or {}
    raw_rows = payload.get("rows")
    if not isinstance(raw_rows, list) or any(not isinstance(row, dict) for row in raw_rows):
        raise ValidatedResultEvidenceError(
            "INVALID_RETAINED_RESULT",
            "已记住这条定义；最终保留结果无法安全读取，暂不自动执行。",
        )
    rows = [dict(row) for row in raw_rows]
    if (
        payload.get("sampled") is not False
        or type(payload.get("rows_count")) is not int
        or payload.get("rows_count") != len(rows)
        or materialized_rows != len(rows)
        or stable_payload_hash(rows) != result_hash
    ):
        raise ValidatedResultEvidenceError(
            "RETAINED_RESULT_NOT_COMPLETE",
            "已记住这条定义；当前只保留了样例或结果证据不一致，暂不自动执行。",
        )
    if not rows:
        raise ValidatedResultEvidenceError(
            "EMPTY_RETAINED_RESULT",
            "已记住这条定义；最终结果为空，无法安全推断执行方式。",
        )
    return ValidatedRetainedResult(
        rows=rows,
        artifact=artifact,
        validation=validation,
        source_refs=source_refs,
    )


async def trusted_source_catalog(
    db: AsyncSession,
    *,
    run: AnalysisRun,
    source_refs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    try:
        source_ids = [UUID(str(ref["source_id"])) for ref in source_refs]
    except (KeyError, TypeError, ValueError) as exc:
        raise ValidatedResultEvidenceError(
            "INVALID_SOURCE_REFS",
            "已记住这条定义；最终结果的数据来源标识无法核对。",
        ) from exc
    source_result = await db.execute(
        select(ProjectDataSource).where(
            ProjectDataSource.project_id == run.project_id,
            ProjectDataSource.id.in_(source_ids),
        )
    )
    sources = list(source_result.scalars().all())
    by_id = {str(source.id): source for source in sources}
    if len(by_id) != len(source_ids):
        raise ValidatedResultEvidenceError(
            "MISSING_LINEAGE_SOURCE",
            "已记住这条定义；原报告使用的数据来源已经无法完整核对。",
        )

    catalog: list[dict[str, Any]] = []
    for ref in source_refs:
        source = by_id[str(ref["source_id"])]
        profile = dict(source.profile_data or {})
        logical_name = str(profile.get("logical_name") or "").strip()
        ref_logical_name = str(ref.get("source_logical_name") or "").strip()
        ref_kind = str(ref.get("source_kind") or "").strip()
        if (
            source.status != "ready"
            or profile.get("is_current") is False
            or not logical_name
            or ref_logical_name != logical_name
            or ref_kind != source.kind
        ):
            raise ValidatedResultEvidenceError(
                "UNTRUSTED_SOURCE_PROFILE",
                "已记住这条定义；原报告的数据来源角色或结构档案无法可靠核对。",
            )
        catalog.append(
            {
                "id": str(source.id),
                "kind": source.kind,
                "status": source.status,
                "profile": profile,
            }
        )
    return catalog
