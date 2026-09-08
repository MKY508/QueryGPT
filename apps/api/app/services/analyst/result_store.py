"""Retained-result budgets, write boundaries and current validation receipts."""

from __future__ import annotations

import sys
from dataclasses import dataclass
from typing import Any

import pandas as pd
from pydantic_ai import ModelRetry

from app.services.analyst.session import (
    AnalystSession,
)
from app.services.checkpoint_contract import stable_payload_hash

RUN_RESULT_MAX_RESULTS = 12
RUN_RESULT_MAX_ROWS = 50_000
RUN_RESULT_MAX_BYTES = 64 * 1024 * 1024
RESULT_DATA_PREVIEW_MAX_ROWS = 100


@dataclass(frozen=True, slots=True)
class _ResultBudgetUsage:
    results: int
    rows: int
    estimated_bytes: int


def _result_row_count(value: Any) -> int:
    """Count retained rows for record lists and dataframe-like results."""

    try:
        return max(0, int(len(value)))
    except (TypeError, ValueError):
        return 0


def _deep_result_size(value: Any, seen: set[int] | None = None) -> int:
    """Estimate retained heap size without assuming every result is already JSON records."""

    if isinstance(value, pd.DataFrame):
        try:
            return int(value.memory_usage(index=True, deep=True).sum())
        except (AttributeError, TypeError, ValueError):
            pass

    seen = seen if seen is not None else set()
    object_id = id(value)
    if object_id in seen:
        return 0
    seen.add(object_id)

    size = sys.getsizeof(value, 0)
    if isinstance(value, dict):
        return size + sum(
            _deep_result_size(key, seen) + _deep_result_size(item, seen)
            for key, item in value.items()
        )
    if isinstance(value, (list, tuple, set, frozenset)):
        return size + sum(_deep_result_size(item, seen) for item in value)
    nbytes = getattr(value, "nbytes", None)
    if isinstance(nbytes, int):
        return max(size, nbytes)
    return size


def _result_budget_usage(results: dict[str, Any]) -> _ResultBudgetUsage:
    return _ResultBudgetUsage(
        results=len(results),
        rows=sum(_result_row_count(value) for value in results.values()),
        estimated_bytes=sum(_deep_result_size(value) for value in results.values()),
    )


def _ensure_result_budget(
    deps: AnalystSession,
    pending_results: dict[str, Any],
) -> _ResultBudgetUsage:
    """Reject an atomic result write before any retained run state is mutated."""

    collisions = sorted(set(deps.dataframes).intersection(pending_results))
    if collisions:
        names = "、".join(collisions)
        raise ModelRetry(f"结果名称 {names} 已存在，请换一个新名称后重试，不要覆盖已有结果。")

    usage = _result_budget_usage({**deps.dataframes, **pending_results})
    if (
        usage.results > RUN_RESULT_MAX_RESULTS
        or usage.rows > RUN_RESULT_MAX_ROWS
        or usage.estimated_bytes > RUN_RESULT_MAX_BYTES
    ):
        estimated_mib = usage.estimated_bytes / (1024 * 1024)
        raise ModelRetry(
            "本轮调查保留的数据结果将超过安全预算"
            f"（预计 {usage.results} 个结果、{usage.rows:,} 行、约 {estimated_mib:.1f} MiB；"
            f"上限为 {RUN_RESULT_MAX_RESULTS} 个结果、{RUN_RESULT_MAX_ROWS:,} 行、约 "
            f"{RUN_RESULT_MAX_BYTES // (1024 * 1024)} MiB）。"
            "请在数据源端增加筛选、分组或汇总后重试，不要继续拉取明细；已有结果会原样保留。"
        )
    return usage


def _ensure_result_write_allowed(deps: AnalystSession) -> None:
    """Keep a system-verified Standing result immutable while the model explains it."""

    if not deps.protected_results:
        return
    names = "、".join(sorted(deps.protected_results))
    raise ModelRetry(
        f"系统已在当前数据上生成并校验结果 {names}。"
        "请直接解释该结果或基于它绘图，不要重新查询、关联、汇总或覆盖数据结果。"
    )


def _protected_result_profile(
    deps: AnalystSession,
    result_name: str,
    receipt: dict[str, Any],
) -> dict[str, Any]:
    """Verify the immutable result, metadata and sole validation bound by a receipt."""

    rows = deps.dataframes.get(result_name)
    metadata = deps.result_metadata.get(result_name)
    if rows is None or metadata is None or result_name not in deps.validated_results:
        raise ValueError("the protected result is not available and validated")
    if stable_payload_hash(rows) != str(receipt.get("result_hash") or ""):
        raise ValueError("the protected result rows no longer match the receipt")
    if stable_payload_hash(metadata) != str(receipt.get("metadata_hash") or ""):
        raise ValueError("the protected result metadata no longer matches the receipt")
    validations = [
        item
        for item in deps.tool_history
        if item.get("kind") == "validation" and item.get("result_name") == result_name
    ]
    if len(validations) != 1:
        raise ValueError("the protected result must have one receipt-bound validation")
    validation = validations[0]
    profile = dict(validation.get("profile") or {})
    if (
        str(validation.get("result_hash") or "") != receipt.get("result_hash")
        or stable_payload_hash(profile) != receipt.get("profile_hash")
        or stable_payload_hash(validation) != receipt.get("validation_hash")
    ):
        raise ValueError("the protected result validation no longer matches the receipt")
    return profile


def _is_result_currently_validated(deps: AnalystSession, result_name: str) -> bool:
    """A validation remains valid only while the retained rows are unchanged."""

    rows = deps.dataframes.get(result_name)
    if rows is None or result_name not in deps.validated_results:
        return False
    validation = next(
        (
            item
            for item in reversed(deps.tool_history)
            if item.get("kind") == "validation"
            and str(item.get("result_name") or "") == result_name
        ),
        None,
    )
    expected_hash = str((validation or {}).get("result_hash") or "")
    return bool(expected_hash) and expected_hash == stable_payload_hash(rows)
