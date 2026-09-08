"""Confirmed-rule application and reusable project knowledge proposals."""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic_ai import ModelRetry, RunContext

from app.services.analysis_checkpoint import stable_payload_hash
from app.services.analyst.confirmation import (
    _canonical_confirmation_key,
)
from app.services.analyst.relationships import (
    _scoped_source_refs,
)
from app.services.analyst.result_store import (
    _ensure_result_budget,
    _ensure_result_write_allowed,
)
from app.services.analyst.session import (
    AnalystSession,
)
from app.services.business_decision_slots import (
    canonicalize_decision_key,
)
from app.services.metric_formula import (
    apply_metric_formula,
)
from app.services.result_filters import (
    apply_value_filter,
    resolve_confirmed_rule_strategy,
)


async def apply_confirmed_rule(
    ctx: RunContext[AnalystSession],
    source_result: str,
    rule_key: str,
    result_name: str,
    purpose: str,
) -> dict[str, Any]:
    """Apply the named confirmed rule; its stored strategy supplies all filter details."""

    _ensure_result_write_allowed(ctx.deps)
    ctx.deps.queue_progress("check_confirmed_definitions")
    rule_key = canonicalize_decision_key(rule_key)
    source_rows = ctx.deps.dataframes.get(source_result)
    if source_rows is None:
        raise ModelRetry("业务规则只能应用到实际存在的 result_name")
    required_correction = ctx.deps.project.required_correction or {}
    pending_confirmation = ctx.deps.pending_confirmation or {}
    pending_key = _canonical_confirmation_key(pending_confirmation)
    confirmed = next(
        (
            item
            for item in ctx.deps.project.confirmed_knowledge
            if canonicalize_decision_key(str(item.get("key") or "")) == rule_key
            and (
                item.get("execution_state") == "verified"
                or (
                    bool(required_correction.get("executable"))
                    and str(required_correction.get("semantic_entry_id") or "")
                    == str(item.get("id") or "")
                )
                or (ctx.deps.user_confirmation and pending_key == rule_key)
            )
        ),
        None,
    )
    if confirmed is None:
        raise ModelRetry("该业务定义尚未形成可验证的执行方式，不能自动套用")
    confirmed = {**confirmed, "key": rule_key}
    source_metadata = ctx.deps.result_metadata.get(source_result) or {}
    try:
        strategy = resolve_confirmed_rule_strategy(
            confirmed,
            source_rows,
            source_refs=source_metadata.get("source_refs") or [],
            source_catalog=ctx.deps.project.sources,
        )
    except ValueError as exc:
        raise ModelRetry(f"业务规则应用失败：{exc}") from exc
    action = strategy["action"]
    action_kind = str(action["kind"])
    definition_hash = stable_payload_hash(confirmed.get("definition") or strategy)
    if action_kind == "value_filter":
        try:
            rows, evidence = apply_value_filter(
                source_rows,
                rule_key=rule_key,
                rule_value=str(confirmed.get("value") or ""),
                column=str(action["column"]),
                operator=str(action["operator"]),
                values=list(action["values"]),
            )
        except ValueError as exc:
            raise ModelRetry(f"业务规则应用失败：{exc}") from exc
    elif action_kind == "metric_formula":
        try:
            rows, evidence = apply_metric_formula(
                source_rows,
                rule_key=rule_key,
                rule_value=str(confirmed.get("value") or ""),
                action=action,
            )
        except ValueError as exc:
            raise ModelRetry(f"业务规则应用失败：{exc}") from exc
    else:
        rows = [dict(row) for row in source_rows]
        evidence = {
            "kind": "business_rule_application",
            "rule_key": rule_key,
            "rule_value": str(confirmed.get("value") or ""),
            "action_kind": action_kind,
            "column": str(action["column"]),
            "operator": None,
            "values": [],
            "before_rows": len(source_rows),
            "after_rows": len(rows),
            "excluded_rows": 0,
            "matched_rows": len(rows),
            "missing_value_rows": 0,
            "input_hash": stable_payload_hash(source_rows),
            "output_hash": stable_payload_hash(rows),
        }
    evidence.update(
        {
            "semantic_entry_id": confirmed.get("id"),
            "active_revision_id": confirmed.get("active_revision_id"),
            "definition_hash": definition_hash,
            "source_refs": list(source_metadata.get("source_refs", [])),
        }
    )
    if required_correction.get("executable") and str(
        required_correction.get("semantic_entry_id") or ""
    ) == str(confirmed.get("id") or ""):
        evidence.update(
            {
                "correction_id": required_correction.get("id"),
                "source_run_id": required_correction.get("source_run_id"),
            }
        )
    name = re.sub(r"\W+", "_", result_name).strip("_") or f"filtered_{len(ctx.deps.dataframes) + 1}"
    _ensure_result_write_allowed(ctx.deps)
    _ensure_result_budget(ctx.deps, {name: rows})
    ctx.deps.dataframes[name] = rows
    action_column = str(
        action.get("output_column")
        if action_kind == "metric_formula"
        else action.get("column") or ""
    )
    required_metric_column = (
        action_column
        if action_kind in {"metric_column", "metric_formula"}
        else source_metadata.get("required_metric_column")
    )
    required_metric_definition_hash = (
        definition_hash
        if action_kind in {"metric_column", "metric_formula"}
        else source_metadata.get("required_metric_definition_hash")
    )
    required_metric_action_kind = (
        action_kind
        if action_kind in {"metric_column", "metric_formula"}
        else source_metadata.get("required_metric_action_kind")
    )
    metric_policy_satisfied = (
        False
        if action_kind in {"metric_column", "metric_formula"}
        else bool(source_metadata.get("metric_policy_satisfied"))
    )
    metric_output_column = (
        action_column
        if action_kind in {"metric_column", "metric_formula"}
        else source_metadata.get("metric_output_column")
    )
    query_scope: Literal["filtered", "derived"] = (
        "filtered" if action_kind == "value_filter" else "derived"
    )
    result_completeness = (
        "complete"
        if source_metadata.get("result_completeness") == "complete"
        and not source_metadata.get("truncated")
        else "partial"
    )
    result_source_refs = _scoped_source_refs(
        list(source_metadata.get("source_refs", [])), query_scope
    )
    ctx.deps.result_metadata[name] = {
        "source_result": source_result,
        "materialized_rows": len(rows),
        "truncated": bool(source_metadata.get("truncated")),
        "business_rule": evidence,
        "required_metric_column": required_metric_column,
        "required_metric_definition_hash": required_metric_definition_hash,
        "required_metric_action_kind": required_metric_action_kind,
        "metric_policy_satisfied": metric_policy_satisfied,
        "metric_output_column": metric_output_column,
        "metric_null_policy": (
            action.get("null_policy")
            if action_kind == "metric_formula"
            else source_metadata.get("metric_null_policy")
        ),
        "query_scope": query_scope,
        "result_completeness": result_completeness,
        "source_refs": result_source_refs,
    }
    ctx.deps.tool_history.append(
        {
            **evidence,
            "purpose": purpose,
            "source_result": source_result,
            "result_name": name,
            "required_metric_column": required_metric_column,
            "required_metric_definition_hash": required_metric_definition_hash,
            "required_metric_action_kind": required_metric_action_kind,
            "metric_policy_satisfied": metric_policy_satisfied,
            "metric_output_column": metric_output_column,
            "query_scope": query_scope,
            "result_completeness": result_completeness,
            "source_refs": result_source_refs,
        }
    )
    metadata = ctx.deps.result_metadata[name]
    ctx.deps.replay_journal.append(
        {
            "op": "apply_confirmed_rule",
            "purpose": purpose,
            "source_result": source_result,
            "rule_key": rule_key,
            "rule_value": evidence["rule_value"],
            "action_kind": action_kind,
            "semantic_entry_id": confirmed.get("id"),
            "definition_hash": definition_hash,
            "column": action_column,
            "operator": action.get("operator"),
            "values": evidence["values"],
            "action": action if action_kind == "metric_formula" else None,
            "formula_hash": evidence.get("formula_hash"),
            "result_name": name,
            "required_metric_column": required_metric_column,
            "required_metric_definition_hash": required_metric_definition_hash,
            "required_metric_action_kind": required_metric_action_kind,
            "metric_policy_satisfied": metric_policy_satisfied,
            "metric_output_column": metric_output_column,
            "query_scope": query_scope,
            "result_completeness": result_completeness,
            # Execution evidence intentionally ignores row ordering, while a
            # checkpoint must reproduce the exact retained sequence.
            "input_hash": stable_payload_hash(source_rows),
            "result_hash": stable_payload_hash(rows),
            "metadata_hash": stable_payload_hash(metadata),
        }
    )
    await ctx.deps.checkpoint()
    return {
        "result_name": name,
        "rows": len(rows),
        "excluded_rows": evidence["excluded_rows"],
        "rule_value": evidence["rule_value"],
        "action_kind": action_kind,
        "metric_column": (
            action_column if action_kind in {"metric_column", "metric_formula"} else None
        ),
        "sample": rows[:30],
    }


async def propose_project_knowledge(
    ctx: RunContext[AnalystSession],
    key: str,
    value: str,
    evidence: str,
    entry_type: Literal["metric", "dimension", "business_rule", "cleaning_rule"] = "business_rule",
) -> str:
    """Record a user correction or reusable business definition as a candidate for this project."""

    ctx.deps.queue_progress("record_understanding")
    proposal_key = canonicalize_decision_key(
        key,
        question=evidence,
        reason=value,
    )
    pending_confirmation = ctx.deps.pending_confirmation or {}
    pending_key = _canonical_confirmation_key(pending_confirmation)
    if ctx.deps.user_confirmation and pending_key:
        proposal_key = pending_key
    is_confirmed = ctx.deps.user_confirmation and (not pending_key or proposal_key == pending_key)
    ctx.deps.knowledge_proposals.append(
        {
            "key": proposal_key[:160],
            "value": value,
            "entry_type": entry_type,
            "evidence": [{"description": evidence}],
            "confidence": 0.8,
            "state": "confirmed" if is_confirmed else "candidate",
            "source": "user" if is_confirmed else "inferred",
        }
    )
    await ctx.deps.checkpoint()
    if is_confirmed:
        return "已作为当前项目的确认口径记录，后续分析会自动复用。"
    return "已作为当前项目的候选理解记录，等待确认后长期使用。"
