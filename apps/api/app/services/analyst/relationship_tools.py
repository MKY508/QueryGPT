"""Model-callable relationship investigation and joins."""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic_ai import ModelRetry, RunContext

from app.services.analyst.relationships import (
    _enforce_relationship_acceptance,
    _join_result_rows,
    _relationship_orientation,
    _relationship_proof_scope,
    _required_trial_relationship,
    _result_source_endpoints,
    _scoped_source_refs,
)
from app.services.analyst.result_store import (
    _ensure_result_budget,
    _ensure_result_write_allowed,
)
from app.services.analyst.session import (
    AnalystSession,
)
from app.services.checkpoint_contract import stable_payload_hash
from app.services.correction_completion import (
    is_reusable_full_relationship_evidence,
)


async def join_results(
    ctx: RunContext[AnalystSession],
    left_result: str,
    right_result: str,
    result_name: str,
    purpose: str,
    left_key: str | None = None,
    right_key: str | None = None,
    how: Literal["inner", "left"] = "left",
    normalization: Literal["auto", "exact", "trim_casefold", "identifier"] = "auto",
    relationship_key: str | None = None,
) -> dict[str, Any]:
    """Join retained results; only confirmed or explicitly bound trial relationships apply."""

    _ensure_result_write_allowed(ctx.deps)
    ctx.deps.queue_progress("relate_sources")
    left_rows = ctx.deps.dataframes.get(left_result)
    right_rows = ctx.deps.dataframes.get(right_result)
    if left_rows is None or right_rows is None:
        raise ModelRetry("关联只能使用查询工具实际返回的 result_name")
    left_metadata = ctx.deps.result_metadata.get(left_result) or {}
    right_metadata = ctx.deps.result_metadata.get(right_result) or {}
    if left_metadata.get("truncated") or right_metadata.get("truncated"):
        raise ModelRetry("关联输入被截断，请先在来源查询中汇总到所需粒度后重新关联")

    required_metric_columns = {
        str(metadata.get("required_metric_column") or "")
        for metadata in (left_metadata, right_metadata)
        if metadata.get("required_metric_column")
    }
    if len(required_metric_columns) > 1:
        raise ModelRetry("两个关联结果携带不同的已确认金额字段，不能自动混用")
    required_metric_column = next(iter(required_metric_columns), None)
    constrained_metadata = [
        metadata
        for metadata in (left_metadata, right_metadata)
        if metadata.get("required_metric_column")
    ]
    if len(constrained_metadata) > 1:
        raise ModelRetry("两个关联分支都携带指标值，不能自动判断应保留哪一列")
    required_metric_hashes = {
        str(metadata.get("required_metric_definition_hash") or "")
        for metadata in constrained_metadata
        if metadata.get("required_metric_definition_hash")
    }
    if len(required_metric_hashes) > 1:
        raise ModelRetry("两个关联结果携带不同版本的已确认指标定义，不能自动混用")
    required_metric_definition_hash = next(iter(required_metric_hashes), None)
    required_metric_action_kinds = {
        str(metadata.get("required_metric_action_kind") or "")
        for metadata in constrained_metadata
        if metadata.get("required_metric_action_kind")
    }
    if len(required_metric_action_kinds) > 1:
        raise ModelRetry("两个关联结果携带不同类型的已确认指标定义，不能自动混用")
    required_metric_action_kind = next(iter(required_metric_action_kinds), None)
    if required_metric_action_kind == "metric_formula" and not (required_metric_definition_hash):
        raise ModelRetry("指标公式缺少当前定义指纹，不能继续关联")
    metric_source_metadata = constrained_metadata[0] if constrained_metadata else {}
    metric_policy_satisfied = bool(metric_source_metadata.get("metric_policy_satisfied"))
    metric_output_column = (
        str(metric_source_metadata.get("metric_output_column") or required_metric_column or "")
        or None
    )
    if metric_output_column and metric_source_metadata is right_metadata:
        left_columns = {str(column) for row in left_rows for column in row}
        if metric_output_column in left_columns:
            raise ModelRetry("关联会产生同名指标列覆盖，请先调整非指标字段名称")

    left_refs = list(left_metadata.get("source_refs", []))
    right_refs = list(right_metadata.get("source_refs", []))
    input_refs = {
        (
            str(item.get("source_id") or ""),
            str(item.get("table_or_view") or ""),
            str(item.get("source_logical_name") or ""),
        ): item
        for item in [*left_refs, *right_refs]
    }
    left_endpoints = _result_source_endpoints(left_metadata)
    right_endpoints = _result_source_endpoints(right_metadata)
    applicable_relationships: list[dict[str, Any]] = []
    for relationship in ctx.deps.project.executable_relationships.values():
        if (
            _relationship_orientation(
                relationship,
                left_endpoints=left_endpoints,
                right_endpoints=right_endpoints,
            )
            is not None
        ):
            applicable_relationships.append(relationship)
    relationship: dict[str, Any] | None = None
    candidate_relationship: dict[str, Any] | None = None
    reversed_direction = False
    if relationship_key:
        relationship = ctx.deps.project.executable_relationships.get(relationship_key)
        if relationship is not None and relationship not in applicable_relationships:
            raise ModelRetry("该确认关系不适用于这两个查询结果，请检查数据来源")
        if relationship is None:
            candidate_relationship = _required_trial_relationship(
                ctx.deps.project,
                relationship_key,
            )
            if (
                candidate_relationship is None
                or _relationship_orientation(
                    candidate_relationship,
                    left_endpoints=left_endpoints,
                    right_endpoints=right_endpoints,
                )
                is None
            ):
                raise ModelRetry("该关系尚未验证，且不属于这次任务绑定的指定试跑关系")
        selected_relationship = relationship or candidate_relationship
        definition = selected_relationship["definition"]
        orientation = _relationship_orientation(
            selected_relationship,
            left_endpoints=left_endpoints,
            right_endpoints=right_endpoints,
        )
        if orientation == "forward":
            left_key = str(definition["left"]["column"])
            right_key = str(definition["right"]["column"])
        elif orientation == "reverse":
            reversed_direction = True
            left_key = str(definition["right"]["column"])
            right_key = str(definition["left"]["column"])
        else:
            raise ModelRetry("该项目关系不适用于这两个查询结果的来源和表")
        normalization = str(definition["normalization"])
        how = str(definition["default_join"])
    elif len(applicable_relationships) == 1:
        relationship = applicable_relationships[0]
        relationship_key = str(relationship.get("key") or "") or None
        definition = relationship["definition"]
        orientation = _relationship_orientation(
            relationship,
            left_endpoints=left_endpoints,
            right_endpoints=right_endpoints,
        )
        if orientation == "forward":
            left_key = str(definition["left"]["column"])
            right_key = str(definition["right"]["column"])
        elif orientation == "reverse":
            reversed_direction = True
            left_key = str(definition["right"]["column"])
            right_key = str(definition["left"]["column"])
        else:
            raise ModelRetry("该项目关系不适用于这两个查询结果的来源和表")
        normalization = str(definition["normalization"])
        how = str(definition["default_join"])
    elif applicable_relationships:
        known_keys = "、".join(str(item.get("key") or "") for item in applicable_relationships)
        raise ModelRetry(f"这两个数据源已有确认关系，请通过 relationship_key 复用：{known_keys}")
    if not left_key or not right_key:
        raise ModelRetry(
            "未使用已确认关系时必须明确提供左右关联字段；普通分析不能自动采用待核对关系"
        )

    try:
        rows, profile = _join_result_rows(
            left_rows,
            left_key,
            right_rows,
            right_key,
            how=how,
            normalization=normalization,
        )
    except ValueError as exc:
        raise ModelRetry(f"关联失败，请根据真实字段修正：{exc}") from exc

    try:
        _enforce_relationship_acceptance(
            profile,
            definition=(relationship or candidate_relationship or {}).get("definition"),
            reversed_direction=reversed_direction,
        )
    except ValueError as exc:
        raise ModelRetry(f"关联验收失败：{exc}") from exc

    proof_scope = _relationship_proof_scope(
        left_metadata,
        right_metadata,
        output_truncated=bool(profile.get("truncated")),
    )
    profile.update(proof_scope)

    observed_relationship = relationship or candidate_relationship
    candidate_relationship_key: str | None = None
    if relationship is None and observed_relationship is not None:
        candidate_relationship_key = str(observed_relationship.get("key") or "") or None
    evidence_definition_hash = (observed_relationship or {}).get("definition_hash")

    relationship_evidence = {
        "kind": (
            "relationship_application" if relationship is not None else "relationship_validation"
        ),
        "purpose": purpose,
        "relationship_key": relationship_key,
        "candidate_relationship_key": candidate_relationship_key,
        "semantic_entry_id": (observed_relationship or {}).get("id"),
        "active_revision_id": (observed_relationship or {}).get("active_revision_id"),
        "definition_hash": evidence_definition_hash,
        "left_result": left_result,
        "right_result": right_result,
        "input_hashes": {
            left_result: stable_payload_hash(left_rows),
            right_result: stable_payload_hash(right_rows),
        },
        "profile": profile,
        "source_refs": list(input_refs.values()),
        **proof_scope,
    }
    name = re.sub(r"\W+", "_", result_name).strip("_") or f"joined_{len(ctx.deps.dataframes) + 1}"
    required_visible_metric_column = (
        metric_output_column if metric_policy_satisfied else required_metric_column
    )
    if (
        required_visible_metric_column
        and rows
        and not any(required_visible_metric_column in row for row in rows)
    ):
        raise ModelRetry("关联结果丢失了已确认指标字段，不能继续生成结论")
    _ensure_result_write_allowed(ctx.deps)
    _ensure_result_budget(ctx.deps, {name: rows})
    ctx.deps.tool_history.append(relationship_evidence)
    ctx.deps.dataframes[name] = rows
    combined_refs = {
        (
            str(item.get("source_id") or ""),
            str(item.get("table_or_view") or ""),
            str(item.get("source_logical_name") or ""),
        ): item
        for item in _scoped_source_refs(list(input_refs.values()), "derived")
    }
    ctx.deps.result_metadata[name] = {
        "materialized_rows": len(rows),
        "truncated": profile["truncated"],
        "relationship": profile,
        "relationship_key": relationship_key,
        "candidate_relationship_key": candidate_relationship_key,
        "definition_hash": evidence_definition_hash,
        "required_metric_column": required_metric_column,
        "required_metric_definition_hash": required_metric_definition_hash,
        "required_metric_action_kind": required_metric_action_kind,
        "metric_policy_satisfied": metric_policy_satisfied,
        "metric_output_column": metric_output_column,
        "query_scope": "derived",
        "result_completeness": ("partial" if profile["truncated"] else proof_scope["completeness"]),
        "source_refs": list(combined_refs.values()),
    }
    ctx.deps.tool_history.append(
        {
            "kind": "join",
            "purpose": purpose,
            "left_result": left_result,
            "right_result": right_result,
            "left_key": left_key,
            "right_key": right_key,
            "relationship_key": relationship_key,
            "candidate_relationship_key": candidate_relationship_key,
            "definition_hash": evidence_definition_hash,
            "how": how,
            "normalization": profile["normalization"],
            "source_refs": list(input_refs.values()),
            "input_hashes": {
                left_result: stable_payload_hash(left_rows),
                right_result: stable_payload_hash(right_rows),
            },
            "result_hash": stable_payload_hash(rows),
            "result_name": name,
            "rows": len(rows),
            "profile": profile,
            **proof_scope,
            "required_metric_column": required_metric_column,
            "required_metric_definition_hash": required_metric_definition_hash,
            "required_metric_action_kind": required_metric_action_kind,
            "metric_policy_satisfied": metric_policy_satisfied,
            "metric_output_column": metric_output_column,
        }
    )
    metadata = ctx.deps.result_metadata[name]
    ctx.deps.replay_journal.append(
        {
            "op": "join_results",
            "purpose": purpose,
            "left_result": left_result,
            "left_key": left_key,
            "right_result": right_result,
            "right_key": right_key,
            "relationship_key": relationship_key,
            "candidate_relationship_key": candidate_relationship_key,
            "definition_hash": evidence_definition_hash,
            "result_name": name,
            "how": how,
            "normalization": profile["normalization"],
            "input_hashes": {
                left_result: stable_payload_hash(left_rows),
                right_result: stable_payload_hash(right_rows),
            },
            "result_hash": stable_payload_hash(rows),
            "profile_hash": stable_payload_hash(profile),
            **proof_scope,
            "required_metric_column": required_metric_column,
            "required_metric_definition_hash": required_metric_definition_hash,
            "required_metric_action_kind": required_metric_action_kind,
            "metric_policy_satisfied": metric_policy_satisfied,
            "metric_output_column": metric_output_column,
            "metadata_hash": stable_payload_hash(metadata),
        }
    )
    if observed_relationship is not None:
        observation = {
            "kind": "relationship_observation",
            "definition_hash": observed_relationship.get("definition_hash"),
            "source_refs": list(input_refs.values()),
            "profile": profile,
            **proof_scope,
            "input_hashes": {
                left_result: stable_payload_hash(left_rows),
                right_result: stable_payload_hash(right_rows),
            },
        }
        previous_evidence = list(observed_relationship.get("evidence") or [])
        if is_reusable_full_relationship_evidence(observation):
            ctx.deps.knowledge_proposals.append(
                {
                    "key": observed_relationship["key"],
                    "value": observed_relationship.get("value")
                    or f"已验证关系：{left_key} ↔ {right_key}",
                    "entry_type": "relationship",
                    "definition": observed_relationship.get("definition"),
                    "validity": "active",
                    "evidence": [*previous_evidence[-19:], observation],
                    "confidence": (
                        1.0
                        if observed_relationship.get("state") in {"confirmed", "locked"}
                        else 0.8
                    ),
                    "state": observed_relationship.get("state") or "candidate",
                    "source": "verified_analysis",
                }
            )
    await ctx.deps.checkpoint()
    return {
        "result_name": name,
        "rows": len(rows),
        "relationship": profile,
        "sample": rows[:30],
    }


async def validate_relationship(
    ctx: RunContext[AnalystSession],
    left_result: str,
    right_result: str,
    purpose: str,
    left_key: str | None = None,
    right_key: str | None = None,
    normalization: Literal["auto", "exact", "trim_casefold", "identifier"] = "auto",
    relationship_key: str | None = None,
) -> dict[str, Any]:
    """Check join coverage without adopting unconfirmed relationship candidates."""

    ctx.deps.queue_progress("validate_relationships")
    left_rows = ctx.deps.dataframes.get(left_result)
    right_rows = ctx.deps.dataframes.get(right_result)
    if left_rows is None or right_rows is None:
        raise ModelRetry("关联检查只能使用查询工具实际返回的 result_name")
    left_metadata = ctx.deps.result_metadata.get(left_result) or {}
    right_metadata = ctx.deps.result_metadata.get(right_result) or {}
    left_endpoints = _result_source_endpoints(left_metadata)
    right_endpoints = _result_source_endpoints(right_metadata)
    applicable_relationships: list[dict[str, Any]] = []
    for candidate in ctx.deps.project.executable_relationships.values():
        if (
            _relationship_orientation(
                candidate,
                left_endpoints=left_endpoints,
                right_endpoints=right_endpoints,
            )
            is not None
        ):
            applicable_relationships.append(candidate)
    relationship = (
        ctx.deps.project.executable_relationships.get(relationship_key)
        if relationship_key
        else None
    )
    candidate_relationship: dict[str, Any] | None = None
    if (
        relationship_key
        and relationship is not None
        and (relationship not in applicable_relationships)
    ):
        raise ModelRetry("找不到适用于这两个结果的确认关系，不能用猜测字段替代")
    if relationship_key and relationship is None:
        candidate_relationship = _required_trial_relationship(
            ctx.deps.project,
            relationship_key,
        )
        if (
            candidate_relationship is None
            or _relationship_orientation(
                candidate_relationship,
                left_endpoints=left_endpoints,
                right_endpoints=right_endpoints,
            )
            is None
        ):
            raise ModelRetry("该关系尚未验证，且不属于这次任务绑定的指定试跑关系")
    if (
        relationship is None
        and candidate_relationship is None
        and len(applicable_relationships) == 1
    ):
        relationship = applicable_relationships[0]
        relationship_key = str(relationship.get("key") or "") or None
    elif (
        relationship is None
        and candidate_relationship is None
        and len(applicable_relationships) > 1
    ):
        known_keys = "、".join(str(item.get("key") or "") for item in applicable_relationships)
        raise ModelRetry(f"有多个确认关系适用，请选择 relationship_key：{known_keys}")
    reversed_direction = False
    selected_relationship = relationship or candidate_relationship
    if selected_relationship is not None:
        definition = selected_relationship["definition"]
        orientation = _relationship_orientation(
            selected_relationship,
            left_endpoints=left_endpoints,
            right_endpoints=right_endpoints,
        )
        if orientation == "forward":
            left_key = str(definition["left"]["column"])
            right_key = str(definition["right"]["column"])
        elif orientation == "reverse":
            reversed_direction = True
            left_key = str(definition["right"]["column"])
            right_key = str(definition["left"]["column"])
        else:
            raise ModelRetry("该项目关系不适用于这两个查询结果的来源和表")
        normalization = str(definition["normalization"])
    if not left_key or not right_key:
        raise ModelRetry(
            "未使用已确认关系时必须明确提供左右关联字段；普通分析不能自动采用待核对关系"
        )
    try:
        _rows, profile = _join_result_rows(
            left_rows,
            left_key,
            right_rows,
            right_key,
            how="left",
            normalization=normalization,
        )
    except ValueError as exc:
        raise ModelRetry(f"关联字段不存在，请根据真实样例修正：{exc}") from exc
    try:
        _enforce_relationship_acceptance(
            profile,
            definition=(selected_relationship or {}).get("definition"),
            reversed_direction=reversed_direction,
        )
    except ValueError as exc:
        raise ModelRetry(f"关联验收失败：{exc}") from exc
    proof_scope = _relationship_proof_scope(
        left_metadata,
        right_metadata,
        output_truncated=bool(profile.get("truncated")),
    )
    profile.update(proof_scope)
    candidate_relationship_key = (
        str(candidate_relationship.get("key") or "") or None
        if candidate_relationship is not None
        else None
    )
    evidence_definition_hash = (selected_relationship or {}).get("definition_hash")
    ctx.deps.tool_history.append(
        {
            "kind": "relationship_validation",
            "purpose": purpose,
            "relationship_key": relationship_key,
            "candidate_relationship_key": candidate_relationship_key,
            "semantic_entry_id": (selected_relationship or {}).get("id"),
            "active_revision_id": (selected_relationship or {}).get("active_revision_id"),
            "definition_hash": evidence_definition_hash,
            "left_result": left_result,
            "right_result": right_result,
            "input_hashes": {
                left_result: stable_payload_hash(left_rows),
                right_result: stable_payload_hash(right_rows),
            },
            "profile": profile,
            "source_refs": [
                *left_metadata.get("source_refs", []),
                *right_metadata.get("source_refs", []),
            ],
            **proof_scope,
        }
    )
    ctx.deps.replay_journal.append(
        {
            "op": "validate_relationship",
            "purpose": purpose,
            "left_result": left_result,
            "left_key": left_key,
            "right_result": right_result,
            "right_key": right_key,
            "relationship_key": relationship_key,
            "candidate_relationship_key": candidate_relationship_key,
            "definition_hash": evidence_definition_hash,
            "normalization": profile["normalization"],
            "profile_hash": stable_payload_hash(profile),
            **proof_scope,
        }
    )
    await ctx.deps.checkpoint()
    return profile
