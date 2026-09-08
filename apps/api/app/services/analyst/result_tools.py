"""Model-callable aggregation and validation of retained results."""

from __future__ import annotations

import re
from typing import Any, Literal, cast

from pydantic_ai import ModelRetry, RunContext

from app.services.analyst.relationships import (
    _scoped_source_refs,
)
from app.services.analyst.result_store import (
    _ensure_result_budget,
    _ensure_result_write_allowed,
    _protected_result_profile,
)
from app.services.analyst.session import (
    AnalystSession,
)
from app.services.checkpoint_contract import stable_payload_hash
from app.services.metric_formula import (
    aggregate_decimal_metric,
)
from app.services.result_aggregation import aggregate_result_rows as _aggregate_result_rows
from app.services.result_profile import (
    profile_result,
)


async def validate_result(
    ctx: RunContext[AnalystSession],
    result_name: str,
    purpose: str,
    key_columns: list[str] | None = None,
    numeric_columns: list[str] | None = None,
) -> dict[str, Any]:
    """Validate retained rows before reporting metrics, joins or charts."""

    ctx.deps.queue_progress("validate_results")
    rows = ctx.deps.dataframes.get(result_name)
    if rows is None:
        raise ModelRetry(f"找不到结果 {result_name}，请使用查询工具实际返回的 result_name")
    protected_receipt = ctx.deps.protected_results.get(result_name)
    if protected_receipt is not None:
        try:
            return _protected_result_profile(
                ctx.deps,
                result_name,
                protected_receipt,
            )
        except ValueError as exc:
            raise ModelRetry("系统校验结果已经发生不一致，不能重复校验或继续生成结论") from exc
    try:
        profile = profile_result(
            rows,
            key_columns=key_columns or [],
            numeric_columns=numeric_columns or [],
        )
    except ValueError as exc:
        raise ModelRetry(f"结果校验失败，请根据真实字段修正：{exc}") from exc
    profile.update(ctx.deps.result_metadata.get(result_name) or {})
    result_hash = stable_payload_hash(rows)
    ctx.deps.validated_results.add(result_name)
    ctx.deps.tool_history.append(
        {
            "kind": "validation",
            "purpose": purpose,
            "result_name": result_name,
            "result_hash": result_hash,
            "profile": profile,
        }
    )
    ctx.deps.replay_journal.append(
        {
            "op": "validate_result",
            "purpose": purpose,
            "result_name": result_name,
            "key_columns": key_columns or [],
            "numeric_columns": numeric_columns or [],
            "result_hash": result_hash,
            "profile_hash": stable_payload_hash(profile),
        }
    )
    await ctx.deps.checkpoint()
    return profile


async def aggregate_result(
    ctx: RunContext[AnalystSession],
    source_result: str,
    group_by: list[str],
    operation: Literal["count", "sum", "mean", "min", "max", "nunique"],
    output_column: str,
    result_name: str,
    purpose: str,
    value_column: str | None = None,
) -> dict[str, Any]:
    """Create a retained, deterministic grouped result for metrics and charts."""

    _ensure_result_write_allowed(ctx.deps)
    ctx.deps.queue_progress("aggregate_results")
    source_rows = ctx.deps.dataframes.get(source_result)
    if source_rows is None:
        raise ModelRetry("汇总只能使用查询或关联工具实际返回的 result_name")
    source_metadata = ctx.deps.result_metadata.get(source_result) or {}
    if source_metadata.get("truncated"):
        raise ModelRetry("结果已被截断，请把 GROUP BY 和汇总放进来源查询")
    required_metric_column = str(source_metadata.get("required_metric_column") or "") or None
    required_metric_definition_hash = (
        str(source_metadata.get("required_metric_definition_hash") or "") or None
    )
    required_metric_action_kind = (
        str(source_metadata.get("required_metric_action_kind") or "") or None
    )
    if required_metric_action_kind == "metric_formula" and not (required_metric_definition_hash):
        raise ModelRetry("指标公式缺少当前定义指纹，不能继续汇总")
    source_metric_output_column = str(source_metadata.get("metric_output_column") or "") or None
    current_metric_column = source_metric_output_column or required_metric_column
    metric_operations = {"sum", "mean", "min", "max"}
    if (
        current_metric_column
        and operation in metric_operations
        and value_column != current_metric_column
    ):
        raise ModelRetry(f"已确认口径要求使用 {current_metric_column}，不能改用其他金额字段")
    consumes_required_metric = bool(
        current_metric_column
        and operation in metric_operations
        and value_column == current_metric_column
    )
    decimal_evidence: dict[str, Any] | None = None
    try:
        if (
            required_metric_action_kind == "metric_formula"
            and operation in metric_operations
            and value_column == current_metric_column
        ):
            raw_null_policy = str(source_metadata.get("metric_null_policy") or "propagate")
            metric_null_policy = cast(
                Literal["propagate", "zero", "error"],
                raw_null_policy
                if raw_null_policy in {"propagate", "zero", "error"}
                else "propagate",
            )
            rows, decimal_evidence = aggregate_decimal_metric(
                source_rows,
                value_column=str(value_column),
                operation=operation,
                group_by=group_by,
                output_column=output_column,
                limit=5000,
                null_policy=metric_null_policy,
            )
        else:
            rows = _aggregate_result_rows(
                source_rows,
                group_by=group_by,
                operation=operation,
                value_column=value_column,
                output_column=output_column,
            )
    except ValueError as exc:
        raise ModelRetry(f"汇总失败，请根据结果样例修正：{exc}") from exc
    if consumes_required_metric:
        metric_policy_satisfied = True
        metric_output_column: str | None = output_column
    else:
        metric_policy_satisfied = False
        metric_output_column = None
    name = re.sub(r"\W+", "_", result_name).strip("_") or f"summary_{len(ctx.deps.dataframes) + 1}"
    _ensure_result_write_allowed(ctx.deps)
    _ensure_result_budget(ctx.deps, {name: rows})
    ctx.deps.dataframes[name] = rows
    result_completeness = (
        "complete"
        if source_metadata.get("result_completeness") == "complete"
        and not source_metadata.get("truncated")
        else "partial"
    )
    source_refs = _scoped_source_refs(list(source_metadata.get("source_refs", [])), "aggregated")
    ctx.deps.result_metadata[name] = {
        "source_result": source_result,
        "materialized_rows": len(rows),
        "operation": operation,
        "group_by": group_by,
        "value_column": value_column,
        "required_metric_column": required_metric_column,
        "required_metric_definition_hash": required_metric_definition_hash,
        "required_metric_action_kind": required_metric_action_kind,
        "metric_policy_satisfied": metric_policy_satisfied,
        "metric_input_column": (current_metric_column if consumes_required_metric else None),
        "metric_output_column": metric_output_column,
        "metric_null_policy": source_metadata.get("metric_null_policy"),
        "numeric_backend": "decimal" if decimal_evidence is not None else "pandas",
        "decimal_aggregate_evidence": decimal_evidence,
        "query_scope": "aggregated",
        "result_completeness": result_completeness,
        "source_refs": source_refs,
    }
    ctx.deps.tool_history.append(
        {
            "kind": "aggregate",
            "purpose": purpose,
            "source_result": source_result,
            "result_name": name,
            "operation": operation,
            "group_by": group_by,
            "value_column": value_column,
            "required_metric_column": required_metric_column,
            "required_metric_definition_hash": required_metric_definition_hash,
            "required_metric_action_kind": required_metric_action_kind,
            "metric_policy_satisfied": metric_policy_satisfied,
            "metric_input_column": (current_metric_column if consumes_required_metric else None),
            "metric_output_column": metric_output_column,
            "numeric_backend": "decimal" if decimal_evidence is not None else "pandas",
            "decimal_aggregate_evidence": decimal_evidence,
            "output_column": output_column,
            "rows": len(rows),
            "query_scope": "aggregated",
            "result_completeness": result_completeness,
            "source_refs": source_refs,
        }
    )
    metadata = ctx.deps.result_metadata[name]
    ctx.deps.replay_journal.append(
        {
            "op": "aggregate_result",
            "purpose": purpose,
            "source_result": source_result,
            "group_by": group_by,
            "operation": operation,
            "value_column": value_column,
            "output_column": output_column,
            "result_name": name,
            "limit": 5000,
            "input_hash": stable_payload_hash(source_rows),
            "result_hash": stable_payload_hash(rows),
            "required_metric_column": required_metric_column,
            "required_metric_definition_hash": required_metric_definition_hash,
            "required_metric_action_kind": required_metric_action_kind,
            "metric_policy_satisfied": metric_policy_satisfied,
            "metric_input_column": (current_metric_column if consumes_required_metric else None),
            "metric_output_column": metric_output_column,
            "numeric_backend": "decimal" if decimal_evidence is not None else "pandas",
            "decimal_aggregate_evidence": decimal_evidence,
            "query_scope": "aggregated",
            "result_completeness": result_completeness,
            "metadata_hash": stable_payload_hash(metadata),
        }
    )
    await ctx.deps.checkpoint()
    return {"result_name": name, "rows": len(rows), "sample": rows[:30]}
