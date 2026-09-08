"""Relationship orientation, acceptance and deterministic join operations."""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Literal

from app.services.correction_completion import (
    is_reusable_full_relationship_evidence,
)
from app.services.project_context import (
    ProjectRuntimeContext,
)
from app.services.result_values import json_result_value


def _enforce_relationship_acceptance(
    profile: dict[str, Any],
    *,
    definition: dict[str, Any] | None,
    reversed_direction: bool,
) -> None:
    """Apply one coverage, expansion and directional-cardinality gate everywhere."""

    expected = str((definition or {}).get("cardinality") or "") or None
    if expected and reversed_direction:
        expected = {
            "one_to_many": "many_to_one",
            "many_to_one": "one_to_many",
        }.get(expected, expected)
    observed = str(profile.get("cardinality") or "")
    compatible = {
        "one_to_one": {"one_to_one"},
        "one_to_many": {"one_to_one", "one_to_many"},
        "many_to_one": {"one_to_one", "many_to_one"},
        "many_to_many": {"one_to_one", "one_to_many", "many_to_one", "many_to_many"},
    }
    if expected and observed not in compatible.get(expected, set()):
        raise ValueError(f"实际关联基数 {observed} 与已确认基数 {expected} 不兼容")
    if observed == "many_to_many" and expected != "many_to_many":
        raise ValueError("检测到未确认的多对多关联，必须先统一分析粒度或明确确认")

    minimum_match_rate = float((definition or {}).get("minimum_left_match_rate", 0.5))
    match_key = "right_match_rate" if definition and reversed_direction else "left_match_rate"
    match_rate = float(profile.get(match_key) or 0)
    if match_rate < minimum_match_rate:
        raise ValueError(f"关联覆盖率只有 {match_rate:.1%}，低于要求的 {minimum_match_rate:.1%}")
    maximum_expansion_ratio = float((definition or {}).get("maximum_expansion_ratio", 5))
    expansion_ratio = float(profile.get("expansion_ratio") or 0)
    if expansion_ratio > maximum_expansion_ratio:
        raise ValueError(
            f"关联行数膨胀 {expansion_ratio:.2f} 倍，超过允许的 {maximum_expansion_ratio:.2f} 倍"
        )


def _scoped_source_refs(
    source_refs: list[dict[str, Any]],
    query_scope: Literal["full", "filtered", "aggregated", "derived"],
) -> list[dict[str, Any]]:
    """Copy lineage refs while making the current result scope explicit."""

    return [{**ref, "query_scope": query_scope} for ref in source_refs]


def _result_source_endpoints(metadata: dict[str, Any]) -> set[tuple[str, str]]:
    """Return only complete physical source/table endpoint identities."""

    return {
        (str(ref.get("source_id") or ""), str(ref.get("table_or_view") or ""))
        for ref in metadata.get("source_refs") or []
        if str(ref.get("source_id") or "") and str(ref.get("table_or_view") or "")
    }


def _relationship_endpoint(
    relationship: dict[str, Any],
    side: Literal["left", "right"],
) -> tuple[str, str] | None:
    """Resolve a persisted relationship endpoint without dropping its table binding."""

    resolved = (relationship.get("resolved_sources") or {}).get(side) or {}
    definition = (relationship.get("definition") or {}).get(side) or {}
    source_id = str(resolved.get("source_id") or "")
    table_or_view = str(resolved.get("table_or_view") or definition.get("table_or_view") or "")
    if not source_id or not table_or_view:
        return None
    return source_id, table_or_view


def _relationship_orientation(
    relationship: dict[str, Any],
    *,
    left_endpoints: set[tuple[str, str]],
    right_endpoints: set[tuple[str, str]],
) -> Literal["forward", "reverse"] | None:
    """Match both physical source and table; legacy source-only evidence fails closed."""

    left_endpoint = _relationship_endpoint(relationship, "left")
    right_endpoint = _relationship_endpoint(relationship, "right")
    if left_endpoint is None or right_endpoint is None:
        return None
    if left_endpoint in left_endpoints and right_endpoint in right_endpoints:
        return "forward"
    if right_endpoint in left_endpoints and left_endpoint in right_endpoints:
        return "reverse"
    return None


def _result_query_scope(metadata: dict[str, Any]) -> str:
    scope = str(metadata.get("query_scope") or "")
    if scope:
        return scope
    ref_scopes = {
        str(ref.get("query_scope") or "")
        for ref in metadata.get("source_refs") or []
        if str(ref.get("query_scope") or "")
    }
    return next(iter(ref_scopes)) if len(ref_scopes) == 1 else ""


def _relationship_proof_scope(
    left_metadata: dict[str, Any],
    right_metadata: dict[str, Any],
    *,
    output_truncated: bool = False,
) -> dict[str, Any]:
    """Classify whether current inputs prove a reusable full-table relationship."""

    left_refs = left_metadata.get("source_refs") or []
    right_refs = right_metadata.get("source_refs") or []
    left_endpoints = _result_source_endpoints(left_metadata)
    right_endpoints = _result_source_endpoints(right_metadata)
    table_lineage_complete = (
        bool(left_refs)
        and bool(right_refs)
        and all(
            isinstance(ref, dict)
            and str(ref.get("source_id") or "")
            and str(ref.get("table_or_view") or "")
            for ref in [*left_refs, *right_refs]
        )
        and len(left_refs) == 1
        and len(right_refs) == 1
        and len(left_endpoints) == 1
        and len(right_endpoints) == 1
        and len(left_endpoints | right_endpoints) == 2
    )
    completeness = (
        "complete"
        if table_lineage_complete
        and left_metadata.get("result_completeness") == "complete"
        and right_metadata.get("result_completeness") == "complete"
        and not left_metadata.get("truncated")
        and not right_metadata.get("truncated")
        and not output_truncated
        else "partial"
    )
    candidate_scope = {
        "evidence_origin": "system",
        "evidence_scope": "full_relation",
        "completeness": "complete",
        "reusable_proof_eligible": True,
        "source_refs": [*left_refs, *right_refs],
        "profile": {"truncated": output_truncated},
    }
    full_relation = (
        completeness == "complete"
        and _result_query_scope(left_metadata) == "full"
        and _result_query_scope(right_metadata) == "full"
        and is_reusable_full_relationship_evidence(candidate_scope)
    )
    return {
        "evidence_origin": "system",
        "evidence_scope": "full_relation" if full_relation else "current_result",
        "completeness": completeness,
        "reusable_proof_eligible": full_relation,
    }


def _matching_candidate_relationship(
    candidates: list[dict[str, Any]],
    *,
    left_endpoints: set[tuple[str, str]],
    right_endpoints: set[tuple[str, str]],
    left_key: str,
    right_key: str,
) -> dict[str, Any] | None:
    """Bind a validated ad-hoc join to an exact physical candidate endpoint pair."""

    for candidate in candidates:
        definition = candidate.get("definition") or {}
        if not definition:
            continue
        orientation = _relationship_orientation(
            candidate,
            left_endpoints=left_endpoints,
            right_endpoints=right_endpoints,
        )
        forward = (
            orientation == "forward"
            and str((definition.get("left") or {}).get("column") or "") == left_key
            and str((definition.get("right") or {}).get("column") or "") == right_key
        )
        reverse = (
            orientation == "reverse"
            and str((definition.get("right") or {}).get("column") or "") == left_key
            and str((definition.get("left") or {}).get("column") or "") == right_key
        )
        if forward or reverse:
            return candidate
    return None


def _candidate_relationship_by_key(
    project: ProjectRuntimeContext,
    relationship_key: str,
) -> dict[str, Any] | None:
    return next(
        (
            item
            for item in project.candidate_relationships
            if str(item.get("key") or "") == relationship_key
        ),
        None,
    )


def _required_trial_relationship(
    project: ProjectRuntimeContext,
    relationship_key: str,
) -> dict[str, Any] | None:
    """Return only a candidate bound to an exact correction or batch contract."""

    correction = project.required_correction or {}
    required: dict[str, Any] | None = None
    if (
        correction.get("executable")
        and correction.get("correction_type") == "relationship_rule"
        and str(correction.get("target_key") or "") == relationship_key
    ):
        required = correction
    if required is None:
        required = next(
            (
                item
                for item in project.required_relationship_validations
                if str(item.get("relationship_key") or "") == relationship_key
            ),
            None,
        )
    if required is None:
        return None
    candidate = _candidate_relationship_by_key(project, relationship_key)
    if candidate is None:
        return None
    expected_active_revision_id = str(required.get("expected_active_revision_id") or "")
    if (
        not expected_active_revision_id
        or str(candidate.get("id") or "") != str(required.get("semantic_entry_id") or "")
        or str(candidate.get("definition_hash") or "") != str(required.get("definition_hash") or "")
        or str(candidate.get("active_revision_id") or "") != expected_active_revision_id
        or candidate.get("state") not in {"candidate", "confirmed", "locked"}
        or candidate.get("validity") not in {"active", "unverified"}
        or candidate.get("execution_state") != "needs_validation"
    ):
        return None
    return candidate


def _current_runtime_relationship(
    project: ProjectRuntimeContext,
    relationship_key: str,
) -> dict[str, Any] | None:
    return project.executable_relationships.get(relationship_key) or _required_trial_relationship(
        project, relationship_key
    )


def _relationship_profile(
    left_rows: list[dict[str, Any]],
    left_key: str,
    right_rows: list[dict[str, Any]],
    right_key: str,
) -> dict[str, Any]:
    """Measure join coverage and cardinality instead of trusting similar column names."""

    left_values = [row.get(left_key) for row in left_rows]
    right_values = [row.get(right_key) for row in right_rows]
    left_present = [str(value) for value in left_values if value is not None and value != ""]
    right_present = [str(value) for value in right_values if value is not None and value != ""]
    left_set = set(left_present)
    right_set = set(right_present)
    left_matched = sum(value in right_set for value in left_present)
    right_matched = sum(value in left_set for value in right_present)
    left_unique = len(left_set) == len(left_present)
    right_unique = len(right_set) == len(right_present)
    if left_unique and right_unique:
        cardinality = "one_to_one"
    elif left_unique:
        cardinality = "one_to_many"
    elif right_unique:
        cardinality = "many_to_one"
    else:
        cardinality = "many_to_many"
    left_non_null_match_rate = left_matched / len(left_present) if left_present else 0
    right_non_null_match_rate = right_matched / len(right_present) if right_present else 0
    left_full_record_coverage = left_matched / len(left_values) if left_values else 0
    right_full_record_coverage = right_matched / len(right_values) if right_values else 0
    return {
        "left_key": left_key,
        "right_key": right_key,
        "left_rows": len(left_values),
        "right_rows": len(right_values),
        "left_non_null": len(left_present),
        "right_non_null": len(right_present),
        "left_null_keys": len(left_values) - len(left_present),
        "right_null_keys": len(right_values) - len(right_present),
        "left_non_null_match_rate": round(left_non_null_match_rate, 6),
        "right_non_null_match_rate": round(right_non_null_match_rate, 6),
        "left_full_record_coverage": round(left_full_record_coverage, 6),
        "right_full_record_coverage": round(right_full_record_coverage, 6),
        # Keep the established fields, but make them mean coverage across all
        # records so a mostly-null key can no longer look 100% matched.
        "left_match_rate": round(left_full_record_coverage, 6),
        "right_match_rate": round(right_full_record_coverage, 6),
        "cardinality": cardinality,
        "left_unmatched_examples": sorted(left_set - right_set)[:10],
        "right_unmatched_examples": sorted(right_set - left_set)[:10],
    }


def _normalized_join_value(value: Any, mode: str) -> str | None:
    if value is None or value == "":
        return None
    text = unicodedata.normalize("NFKC", str(value)).strip()
    if mode in {"trim_casefold", "identifier"}:
        text = text.casefold()
    if mode == "identifier":
        text = re.sub(r"[\s_\-./]+", "", text)
    return text or None


def _profile_with_normalization(
    left_rows: list[dict[str, Any]],
    left_key: str,
    right_rows: list[dict[str, Any]],
    right_key: str,
    mode: str,
) -> dict[str, Any]:
    left = [{"key": _normalized_join_value(row.get(left_key), mode)} for row in left_rows]
    right = [{"key": _normalized_join_value(row.get(right_key), mode)} for row in right_rows]
    profile = _relationship_profile(left, "key", right, "key")
    profile.update(
        {
            "left_key": left_key,
            "right_key": right_key,
            "normalization": mode,
        }
    )
    return profile


def _join_result_rows(
    left_rows: list[dict[str, Any]],
    left_key: str,
    right_rows: list[dict[str, Any]],
    right_key: str,
    *,
    how: Literal["inner", "left"] = "left",
    normalization: Literal["auto", "exact", "trim_casefold", "identifier"] = "auto",
    limit: int = 10_000,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Join retained results with measured coverage and bounded expansion."""

    if not any(left_key in row for row in left_rows):
        raise ValueError(f"左侧结果没有字段 {left_key}")
    if not any(right_key in row for row in right_rows):
        raise ValueError(f"右侧结果没有字段 {right_key}")

    exact_profile = _profile_with_normalization(left_rows, left_key, right_rows, right_key, "exact")
    selected_mode = normalization
    selected_profile = exact_profile
    if normalization == "auto":
        candidate_modes = ["trim_casefold"]
        key_hint = f"{left_key} {right_key}".lower()
        if any(token in key_hint for token in ("id", "编号", "编码", "代码")):
            candidate_modes.append("identifier")
        for mode in candidate_modes:
            candidate = _profile_with_normalization(
                left_rows, left_key, right_rows, right_key, mode
            )
            if candidate["left_match_rate"] > selected_profile["left_match_rate"] + 0.05:
                selected_mode = mode
                selected_profile = candidate
        if selected_mode == "auto":
            selected_mode = "exact"
    elif normalization != "exact":
        selected_profile = _profile_with_normalization(
            left_rows, left_key, right_rows, right_key, normalization
        )

    right_index: dict[str, list[dict[str, Any]]] = {}
    for row in right_rows:
        key = _normalized_join_value(row.get(right_key), selected_mode)
        if key is not None:
            right_index.setdefault(key, []).append(row)

    left_columns = {str(column) for row in left_rows for column in row}
    joined: list[dict[str, Any]] = []
    matched_left_rows = 0
    expected_joined_rows = 0
    for left_row in left_rows:
        key = _normalized_join_value(left_row.get(left_key), selected_mode)
        matches = right_index.get(key or "", []) if key is not None else []
        if matches:
            matched_left_rows += 1
            expected_joined_rows += len(matches)
        elif how == "left":
            expected_joined_rows += 1
            if len(joined) < limit:
                joined.append(dict(left_row))
        for right_row in matches:
            if len(joined) >= limit:
                continue
            combined = dict(left_row)
            for column, value in right_row.items():
                if column == right_key:
                    continue
                output_column = column if column not in left_columns else f"right_{column}"
                combined[output_column] = value
            joined.append(combined)

    truncated = expected_joined_rows > limit
    expansion_ratio = expected_joined_rows / len(left_rows) if left_rows else 0
    profile = {
        **selected_profile,
        "normalization": selected_mode,
        "exact_left_match_rate": exact_profile["left_match_rate"],
        "exact_left_non_null_match_rate": exact_profile["left_non_null_match_rate"],
        "matched_left_rows": matched_left_rows,
        "joined_rows": len(joined),
        "expected_joined_rows": expected_joined_rows,
        "expansion_ratio": round(expansion_ratio, 6),
        "truncated": truncated,
    }
    return json_result_value(joined), profile
