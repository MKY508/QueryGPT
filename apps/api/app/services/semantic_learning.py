"""Compile user-confirmed report corrections into fail-closed execution rules."""

from __future__ import annotations

import hashlib
import json
import math
import re
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import AnalysisRun, SemanticEntry
from app.models.workspace import RelationshipDefinition
from app.services.checkpoint_contract import stable_payload_hash
from app.services.metric_formula import metric_formula_columns, parse_explicit_metric_formula
from app.services.result_filters import (
    build_revenue_refund_option_strategies,
    revenue_refund_candidate_columns,
    stable_field_binding_candidates,
    validate_business_rule_strategy_definition,
)
from app.services.validated_result_evidence import (
    ValidatedResultEvidenceError as _CompilationBlockedError,
)
from app.services.validated_result_evidence import (
    load_validated_retained_result as _load_validated_retained_result,
)
from app.services.validated_result_evidence import (
    trusted_source_catalog as _trusted_source_catalog,
)

ExecutionState = Literal["definition_only", "needs_validation", "verified", "blocked"]


@dataclass(frozen=True)
class CorrectionCompilation:
    definition: dict[str, Any] | None
    validity: Literal["active", "unverified"]
    execution_state: ExecutionState
    execution_details: dict[str, Any]
    evidence: dict[str, Any]


@dataclass(frozen=True)
class MetricColumnCorrectionCandidate:
    """Internal field identity; only an opaque ref and label may reach the browser."""

    column: str
    binding: dict[str, str]


def _normalized_text(value: str) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value).casefold())


def _metric_column_from_text(text: str, rows: list[dict[str, Any]]) -> str | None:
    columns = sorted({str(key) for row in rows for key in row})
    normalized_text = re.sub(
        r"[^0-9a-z\u3400-\u9fff]+",
        "",
        _normalized_text(text),
    )
    normalized_columns = {
        column: re.sub(r"[^0-9a-z\u3400-\u9fff]+", "", _normalized_text(column))
        for column in columns
    }

    exact = [
        column
        for column, normalized in normalized_columns.items()
        if normalized and normalized in normalized_text
    ]
    if len(exact) == 1 and _column_has_numeric_value(rows, exact[0]):
        return exact[0]

    alias_groups = (
        (
            ("实付金额", "支付金额", "成交金额", "paidamount", "amountpaid"),
            ("实付金额", "支付金额", "成交金额", "paidamount", "paymentamount", "actualamount"),
        ),
        (
            ("净额", "净收入", "netamount", "netrevenue"),
            ("净额", "净收入", "退款后金额", "netamount", "netrevenue"),
        ),
        (
            ("销售额", "营收", "收入", "revenue", "salesamount"),
            ("销售额", "营收", "收入", "revenue", "salesamount"),
        ),
    )
    for text_aliases, column_aliases in alias_groups:
        if not any(_normalized_text(alias) in normalized_text for alias in text_aliases):
            continue
        matches = [
            column
            for column, normalized in normalized_columns.items()
            if any(_normalized_text(alias) in normalized for alias in column_aliases)
            and _column_has_numeric_value(rows, column)
        ]
        if len(matches) == 1:
            return matches[0]
    return None


def _column_has_numeric_value(rows: list[dict[str, Any]], column: str) -> bool:
    for row in rows:
        value = row.get(column)
        if value is None or isinstance(value, bool):
            continue
        try:
            if math.isfinite(float(value)):
                return True
        except (TypeError, ValueError):
            continue
    return False


def _refund_strategy_for_text(
    text: str,
    rows: list[dict[str, Any]],
) -> dict[str, Any] | None:
    normalized = _normalized_text(text)
    if len(revenue_refund_candidate_columns(rows)) != 1:
        return None
    strategies = build_revenue_refund_option_strategies(rows)
    option: str | None = None
    if any(
        marker in normalized
        for marker in ("不计入收入", "不算收入", "排除退款", "扣除退款", "剔除退款")
    ):
        option = "扣除退款"
    elif any(marker in normalized for marker in ("保留退款", "退款计入", "包含退款")):
        option = "保留退款订单"
    elif any(marker in normalized for marker in ("按净额", "现有净额", "退款后金额")):
        option = "按现有净额字段"
    selected = strategies.get(option or "")
    if selected is None:
        return None
    return {
        **selected,
        "selected_option": text,
    }


def _unverified(
    *,
    correction_id: UUID,
    run: AnalysisRun,
    target_key: str,
    reason_code: str,
    summary: str,
) -> CorrectionCompilation:
    evidence = {
        "kind": "correction_compilation",
        "status": "unverified",
        "correction_id": str(correction_id),
        "analysis_run_id": str(run.id),
        "target_key": target_key,
        "reason_code": reason_code,
    }
    return CorrectionCompilation(
        definition=None,
        validity="unverified",
        execution_state="definition_only",
        execution_details={
            "version": 1,
            "status": "definition_only",
            "reason_code": reason_code,
            "summary": summary,
        },
        evidence=evidence,
    )


def _unique_stable_binding(
    source_catalog: list[dict[str, Any]],
    *,
    action_column: str,
    action_kind: str,
) -> dict[str, str]:
    candidates = [
        candidate
        for source in source_catalog
        for candidate in stable_field_binding_candidates(source, action_column)
    ]
    if not candidates:
        raise _CompilationBlockedError(
            "DERIVED_OR_UNPROFILED_ACTION_COLUMN",
            "已记住这条定义；执行字段只出现在派生结果中，或来源结构没有足够证据。",
        )
    if len(candidates) != 1:
        raise _CompilationBlockedError(
            "AMBIGUOUS_ACTION_COLUMN_SOURCE",
            "已记住这条定义；同名执行字段来自多个数据位置，暂不自动选择。",
        )
    binding = candidates[0]
    if action_kind in {"metric_column", "metric_formula"} and binding["canonical_type"] != "number":
        raise _CompilationBlockedError(
            "METRIC_COLUMN_NOT_NUMERIC",
            "已记住这条定义；指定的指标字段没有可靠的数值类型证据。",
        )
    return binding


def _metric_column_candidates_from_catalog(
    source_catalog: list[dict[str, Any]],
) -> list[MetricColumnCorrectionCandidate]:
    column_names: set[str] = set()
    for source in source_catalog:
        profile = source.get("profile") or {}
        if source.get("kind") == "file":
            structures = [(profile.get("schema") or {}).get("columns") or []]
        else:
            structures = [
                table.get("columns") or []
                for table in profile.get("tables") or []
                if isinstance(table, dict)
            ]
        for columns in structures:
            for item in columns:
                if not isinstance(item, dict):
                    continue
                column = str(item.get("name") or "").strip()
                if column:
                    column_names.add(column)

    candidates: list[MetricColumnCorrectionCandidate] = []
    for column in sorted(column_names, key=str.casefold):
        try:
            binding = _unique_stable_binding(
                source_catalog,
                action_column=column,
                action_kind="metric_column",
            )
        except _CompilationBlockedError:
            # Ambiguous, non-numeric and unprofiled fields must not become a
            # browser-selectable execution contract.
            continue
        candidates.append(MetricColumnCorrectionCandidate(column=column, binding=binding))
    return candidates


async def discover_metric_column_correction_candidates(
    db: AsyncSession,
    run: AnalysisRun,
) -> list[MetricColumnCorrectionCandidate]:
    """Return trusted numeric fields for one completed, retained run.

    Callers must keep ``column`` and ``binding`` server-side.  The public
    correction-options API projects these identities through run-bound opaque
    references in ``correction_targets``.
    """

    try:
        retained = await _load_validated_retained_result(db, run)
        source_catalog = await _trusted_source_catalog(
            db,
            run=run,
            source_refs=retained.source_refs,
        )
    except _CompilationBlockedError:
        return []
    return _metric_column_candidates_from_catalog(source_catalog)


def _relationship_source_columns(
    source: dict[str, Any],
    table_or_view: str,
) -> list[dict[str, Any]]:
    profile = source.get("profile") or {}
    if source.get("kind") == "file":
        return list((profile.get("schema") or {}).get("columns") or [])
    for table in profile.get("tables") or []:
        if str(table.get("name") or "") == table_or_view:
            return list(table.get("columns") or [])
    return []


def _relationship_schema_signature(columns: list[dict[str, Any]]) -> str:
    payload = json.dumps(
        sorted(
            [
                {
                    "name": str(column.get("name") or ""),
                    "type": str(column.get("type") or column.get("dtype") or "unknown"),
                }
                for column in columns
            ],
            key=lambda item: (item["name"], item["type"]),
        ),
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _canonical_relationship_column(value: str) -> str:
    normalized = re.sub(
        r"[^a-zA-Z0-9\u4e00-\u9fff]",
        "",
        unicodedata.normalize("NFKC", value).casefold(),
    )
    aliases = {
        "门店id": "storeid",
        "门店编号": "storeid",
        "店铺id": "storeid",
        "shopid": "storeid",
        "订单id": "orderid",
        "订单编号": "orderid",
        "商品id": "productid",
        "产品id": "productid",
    }
    return aliases.get(normalized, normalized)


def _relationship_endpoint_candidates(
    source_catalog: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    endpoints: list[dict[str, Any]] = []
    for source in source_catalog:
        profile = source.get("profile") or {}
        logical_name = str(profile.get("logical_name") or "").strip()
        if not logical_name:
            continue
        if source.get("kind") == "file":
            groups = [(logical_name, list((profile.get("schema") or {}).get("columns") or []))]
        else:
            groups = [
                (str(table.get("name") or ""), list(table.get("columns") or []))
                for table in profile.get("tables") or []
                if table.get("name")
            ]
        for table_or_view, columns in groups:
            signature = _relationship_schema_signature(columns)
            for column in columns:
                column_name = str(column.get("name") or "").strip()
                if not column_name:
                    continue
                endpoints.append(
                    {
                        "source_id": str(source.get("id") or ""),
                        "source_logical_name": logical_name,
                        "source_kind": source.get("kind"),
                        "table_or_view": table_or_view,
                        "column": column_name,
                        "data_type": str(column.get("type") or column.get("dtype") or "unknown"),
                        "schema_signature": signature,
                        "canonical_column": _canonical_relationship_column(column_name),
                    }
                )
    unique = {
        (
            endpoint["source_id"],
            endpoint["table_or_view"],
            endpoint["column"],
        ): endpoint
        for endpoint in endpoints
    }
    return list(unique.values())


def _explicit_relationship_endpoints(
    text: str,
    source_catalog: list[dict[str, Any]],
) -> list[dict[str, Any]] | None:
    """Resolve only endpoint pairs explicitly and unambiguously named by the user."""

    candidates = _relationship_endpoint_candidates(source_catalog)
    compact_text = re.sub(
        r"[^a-zA-Z0-9\u4e00-\u9fff]",
        "",
        unicodedata.normalize("NFKC", text).casefold(),
    )
    raw_matches = [
        endpoint
        for endpoint in candidates
        if len(_canonical_relationship_column(endpoint["column"])) >= 3
        and _canonical_relationship_column(endpoint["column"]) in compact_text
    ]
    if len(raw_matches) == 2:
        return raw_matches

    groups: dict[str, list[dict[str, Any]]] = {}
    for endpoint in candidates:
        canonical = str(endpoint["canonical_column"] or "")
        if len(canonical) >= 3:
            groups.setdefault(canonical, []).append(endpoint)
    matching_groups = [
        endpoints
        for canonical, endpoints in groups.items()
        if canonical in compact_text and len(endpoints) == 2
    ]
    if len(matching_groups) == 1:
        return matching_groups[0]
    return None


async def _compile_relationship_candidate(
    db: AsyncSession,
    *,
    run: AnalysisRun,
    target_key: str,
    text: str,
    source_catalog: list[dict[str, Any]],
) -> dict[str, Any]:
    """Bind an explicit project candidate to the current stable source schemas.

    A free-text correction is not enough to invent join endpoints.  The user must
    select a concrete candidate key already produced from source preflight; this
    compiler then proves that both endpoints still exist in the sources that fed
    the corrected report.  Row-level coverage is deliberately deferred to the
    required-correction trial run.
    """

    result = await db.execute(
        select(SemanticEntry).where(
            SemanticEntry.project_id == run.project_id,
            SemanticEntry.key == target_key,
            SemanticEntry.entry_type == "relationship",
            SemanticEntry.is_active.is_(True),
        )
    )
    entry = result.scalar_one_or_none()
    if entry is None or entry.validity == "stale" or not entry.definition:
        raise _CompilationBlockedError(
            "RELATIONSHIP_CANDIDATE_NOT_FOUND",
            "已记住这条关联修正；请选择当前数据理解中仍有效的一条候选关系。",
        )
    try:
        previous_definition = RelationshipDefinition.model_validate(entry.definition).model_dump()
    except ValueError as exc:
        raise _CompilationBlockedError(
            "INVALID_RELATIONSHIP_DEFINITION",
            "已记住这条关联修正；候选关系的字段绑定不完整，暂不能试跑。",
        ) from exc

    explicit_endpoints = _explicit_relationship_endpoints(text, source_catalog)
    if explicit_endpoints is None:
        raise _CompilationBlockedError(
            "AMBIGUOUS_RELATIONSHIP_CORRECTION",
            "已记住这条关联修正；请明确写出应使用的关联字段，系统不会沿用可能错误的旧关系。",
        )
    previous_source_order = {
        (
            previous_definition[side]["source_logical_name"],
            previous_definition[side]["source_kind"],
            previous_definition[side]["table_or_view"],
        ): index
        for index, side in enumerate(("left", "right"))
    }
    explicit_endpoints.sort(
        key=lambda endpoint: previous_source_order.get(
            (
                endpoint["source_logical_name"],
                endpoint["source_kind"],
                endpoint["table_or_view"],
            ),
            len(previous_source_order),
        )
    )
    definition = {
        "version": 1,
        "left": {
            key: explicit_endpoints[0][key]
            for key in (
                "source_logical_name",
                "source_kind",
                "table_or_view",
                "column",
                "data_type",
                "schema_signature",
            )
        },
        "right": {
            key: explicit_endpoints[1][key]
            for key in (
                "source_logical_name",
                "source_kind",
                "table_or_view",
                "column",
                "data_type",
                "schema_signature",
            )
        },
        "normalization": (
            previous_definition["normalization"]
            if {
                previous_definition["left"]["column"],
                previous_definition["right"]["column"],
            }
            == {explicit_endpoints[0]["column"], explicit_endpoints[1]["column"]}
            else "auto"
        ),
        "cardinality": (
            previous_definition["cardinality"]
            if {
                previous_definition["left"]["column"],
                previous_definition["right"]["column"],
            }
            == {explicit_endpoints[0]["column"], explicit_endpoints[1]["column"]}
            else None
        ),
        "default_join": previous_definition["default_join"],
        "minimum_left_match_rate": previous_definition["minimum_left_match_rate"],
        "maximum_expansion_ratio": previous_definition["maximum_expansion_ratio"],
    }
    definition = RelationshipDefinition.model_validate(definition).model_dump()

    resolved_endpoints: list[tuple[str, str, str, str]] = []
    for side in ("left", "right"):
        endpoint = definition[side]
        matching_sources = [
            source
            for source in source_catalog
            if source.get("kind") == endpoint["source_kind"]
            and str((source.get("profile") or {}).get("logical_name") or "").strip()
            == endpoint["source_logical_name"]
        ]
        if len(matching_sources) != 1:
            raise _CompilationBlockedError(
                "RELATIONSHIP_SOURCE_NOT_IN_REPORT",
                "已记住这条关联修正；候选关系没有唯一绑定到原报告的数据来源。",
            )
        source = matching_sources[0]
        columns = _relationship_source_columns(source, endpoint["table_or_view"])
        current_column = next(
            (column for column in columns if str(column.get("name") or "") == endpoint["column"]),
            None,
        )
        if current_column is None:
            raise _CompilationBlockedError(
                "RELATIONSHIP_COLUMN_NOT_FOUND",
                "已记住这条关联修正；候选关联字段在当前数据结构中已不存在。",
            )
        if _relationship_schema_signature(columns) != endpoint["schema_signature"]:
            raise _CompilationBlockedError(
                "RELATIONSHIP_SCHEMA_DRIFT",
                "已记住这条关联修正；候选关系对应的数据结构已经变化，需要重新识别。",
            )
        resolved_endpoints.append(
            (
                str(source.get("id") or ""),
                endpoint["table_or_view"],
                endpoint["column"],
                endpoint["source_kind"],
            )
        )
    if resolved_endpoints[0] == resolved_endpoints[1]:
        raise _CompilationBlockedError(
            "RELATIONSHIP_ENDPOINTS_IDENTICAL",
            "已记住这条关联修正；关联两端不能是同一个字段。",
        )
    return definition


async def compile_report_correction(
    db: AsyncSession,
    *,
    run: AnalysisRun,
    correction_id: UUID,
    target_key: str,
    text: str,
    correction_type: str,
    selected_metric_column: str | None = None,
    selected_metric_binding: dict[str, str] | None = None,
) -> CorrectionCompilation:
    """Compile only rules proven by a complete final result and stable source schema."""

    try:
        retained = await _load_validated_retained_result(db, run)
        source_catalog = await _trusted_source_catalog(
            db,
            run=run,
            source_refs=retained.source_refs,
        )
    except _CompilationBlockedError as exc:
        return _unverified(
            correction_id=correction_id,
            run=run,
            target_key=target_key,
            reason_code=exc.reason_code,
            summary=exc.summary,
        )
    rows = retained.rows
    artifact = retained.artifact

    if correction_type == "relationship_rule":
        try:
            relationship_definition = await _compile_relationship_candidate(
                db,
                run=run,
                target_key=target_key,
                text=text,
                source_catalog=source_catalog,
            )
        except _CompilationBlockedError as exc:
            return _unverified(
                correction_id=correction_id,
                run=run,
                target_key=target_key,
                reason_code=exc.reason_code,
                summary=exc.summary,
            )
        definition_hash = stable_payload_hash(relationship_definition)
        compiled_at = datetime.now(UTC).isoformat()
        endpoints = [
            {
                "source_logical_name": relationship_definition[side]["source_logical_name"],
                "source_kind": relationship_definition[side]["source_kind"],
                "table_or_view": relationship_definition[side]["table_or_view"],
                "column": relationship_definition[side]["column"],
                "schema_signature": relationship_definition[side]["schema_signature"],
            }
            for side in ("left", "right")
        ]
        evidence = {
            "kind": "correction_compilation",
            "status": "compiled",
            "correction_id": str(correction_id),
            "analysis_run_id": str(run.id),
            "artifact_id": str(artifact.id),
            "target_key": target_key,
            "definition_hash": definition_hash,
            "source_binding": endpoints,
            "action_kind": "relationship",
            "compiled_at": compiled_at,
        }
        return CorrectionCompilation(
            definition=relationship_definition,
            validity="unverified",
            execution_state="needs_validation",
            execution_details={
                "version": 1,
                "status": "needs_validation",
                "definition_hash": definition_hash,
                "source_run_id": str(run.id),
                "source_binding": endpoints,
                "compiled_at": compiled_at,
                "summary": "关联字段已绑定，等待下一次真实调查验证覆盖率和最终结果。",
            },
            evidence=evidence,
        )

    definition: dict[str, Any] | None = None
    structured_metric_binding: dict[str, str] | None = None
    if (selected_metric_column is None) != (selected_metric_binding is None):
        return _unverified(
            correction_id=correction_id,
            run=run,
            target_key=target_key,
            reason_code="INCOMPLETE_METRIC_FIELD_SELECTION",
            summary="已记住这条定义；所选指标字段缺少完整的来源绑定。",
        )
    if selected_metric_column is not None:
        selected_candidate = next(
            (
                candidate
                for candidate in _metric_column_candidates_from_catalog(source_catalog)
                if candidate.column == selected_metric_column
                and candidate.binding == selected_metric_binding
            ),
            None,
        )
        if correction_type != "metric_definition" or selected_candidate is None:
            return _unverified(
                correction_id=correction_id,
                run=run,
                target_key=target_key,
                reason_code="INVALID_METRIC_FIELD_SELECTION",
                summary="已记住这条定义；所选指标字段已失效或不再具有唯一的数值来源。",
            )
        structured_metric_binding = selected_candidate.binding
        definition = {
            "version": 1,
            "kind": "business_rule_strategy",
            "rule_key": target_key,
            "selected_option": text,
            "action": {
                "kind": "metric_column",
                "column": selected_candidate.column,
            },
        }
    attempted_explicit_formula = (
        selected_metric_column is None
        and correction_type == "metric_definition"
        and "=" in unicodedata.normalize("NFKC", text)
    )
    if (
        definition is None
        and target_key == "revenue_refund_policy"
        and correction_type
        in {
            "business_rule",
            "filter_rule",
            "metric_definition",
        }
    ):
        definition = _refund_strategy_for_text(text, rows)
    if definition is None and correction_type == "metric_definition" and attempted_explicit_formula:
        existing_columns = sorted({str(key) for row in rows for key in row})
        numeric_columns = [
            column
            for column in existing_columns
            if len(
                [
                    candidate
                    for source in source_catalog
                    for candidate in stable_field_binding_candidates(source, column)
                    if candidate["canonical_type"] == "number"
                ]
            )
            == 1
        ]
        formula_action = parse_explicit_metric_formula(
            text,
            known_numeric_columns=numeric_columns,
            existing_columns=existing_columns,
        )
        if formula_action is not None:
            definition = {
                "version": 1,
                "kind": "business_rule_strategy",
                "rule_key": target_key,
                "selected_option": text,
                "action": formula_action,
            }
    if (
        definition is None
        and correction_type == "metric_definition"
        and not attempted_explicit_formula
    ):
        column = _metric_column_from_text(text, rows)
        if column is not None:
            definition = {
                "version": 1,
                "kind": "business_rule_strategy",
                "rule_key": target_key,
                "selected_option": text,
                "action": {"kind": "metric_column", "column": column},
            }
    if definition is None:
        return _unverified(
            correction_id=correction_id,
            run=run,
            target_key=target_key,
            reason_code="NO_UNIQUE_TYPED_ACTION",
            summary="已记住这条定义；它还不能唯一转换成安全的筛选或指标字段。",
        )

    action = definition.get("action") or {}
    action_kind = str(action.get("kind") or "")
    try:
        if action_kind == "metric_formula":
            stable_bindings: dict[str, dict[str, str]] = {
                column: _unique_stable_binding(
                    source_catalog,
                    action_column=column,
                    action_kind=action_kind,
                )
                for column in metric_formula_columns(action)
            }
            applies_to: dict[str, str] | list[dict[str, str]] = [
                stable_bindings[column] for column in sorted(stable_bindings)
            ]
        else:
            applies_to = (
                structured_metric_binding
                if structured_metric_binding is not None
                else _unique_stable_binding(
                    source_catalog,
                    action_column=str(action.get("column") or ""),
                    action_kind=action_kind,
                )
            )
    except (_CompilationBlockedError, ValueError) as exc:
        reason_code = (
            exc.reason_code
            if isinstance(exc, _CompilationBlockedError)
            else "INVALID_COMPILED_FORMULA"
        )
        summary = (
            exc.summary
            if isinstance(exc, _CompilationBlockedError)
            else "已记住这条定义；指标公式没有通过安全合同校验。"
        )
        return _unverified(
            correction_id=correction_id,
            run=run,
            target_key=target_key,
            reason_code=reason_code,
            summary=summary,
        )
    definition = {**definition, "applies_to": applies_to}
    try:
        validate_business_rule_strategy_definition(
            definition,
            expected_key=target_key,
            expected_value=text,
        )
    except ValueError:
        return _unverified(
            correction_id=correction_id,
            run=run,
            target_key=target_key,
            reason_code="INVALID_COMPILED_DEFINITION",
            summary="已记住这条定义；自动执行方式没有通过内部合同校验。",
        )

    definition_hash = stable_payload_hash(definition)
    compiled_at = datetime.now(UTC).isoformat()
    evidence = {
        "kind": "correction_compilation",
        "status": "compiled",
        "correction_id": str(correction_id),
        "analysis_run_id": str(run.id),
        "artifact_id": str(artifact.id),
        "target_key": target_key,
        "definition_hash": definition_hash,
        "source_binding": applies_to,
        "action_kind": str((definition.get("action") or {}).get("kind") or ""),
        "compiled_at": compiled_at,
    }
    return CorrectionCompilation(
        definition=definition,
        validity="active",
        execution_state="needs_validation",
        execution_details={
            "version": 1,
            "status": "needs_validation",
            "definition_hash": definition_hash,
            "source_run_id": str(run.id),
            "source_binding": applies_to,
            "compiled_at": compiled_at,
            "summary": "执行方式已绑定，等待下一次真实调查验证。",
        },
        evidence=evidence,
    )
