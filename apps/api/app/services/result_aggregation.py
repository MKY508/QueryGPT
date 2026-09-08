"""Bounded result aggregation without dataframe numeric coercion."""

from __future__ import annotations

import json
import math
from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation, localcontext
from numbers import Integral, Real
from typing import Any

from app.services.result_values import MAX_JSON_INTEGER, json_result_value


def _missing(value: Any) -> bool:
    return value is None or (
        isinstance(value, Real) and not isinstance(value, Integral) and math.isnan(value)
    )


def _decimal(value: Any) -> Decimal | None:
    if _missing(value):
        return None
    if isinstance(value, bool):
        return Decimal(int(value))
    raw = str(value).strip()
    if len(raw) > 256:
        raise ValueError("汇总数值过长，请先确认字段内容")
    try:
        number = Decimal(raw)
    except InvalidOperation:
        return None  # Keep the existing non-numeric/missing-value policy.
    if not number.is_finite():
        raise ValueError("汇总字段包含非有限数值，请先确认并整理这些记录")
    if abs(number.adjusted()) > 1000 or abs(number.as_tuple().exponent) > 1000:
        raise ValueError("汇总数值超出支持范围")
    return number


def aggregate_result_rows(
    rows: list[dict[str, Any]],
    *,
    group_by: list[str],
    operation: str,
    output_column: str,
    value_column: str | None = None,
    limit: int = 10_000,
) -> list[dict[str, Any]]:
    if not rows:
        return []
    if operation not in {"count", "nunique", "sum", "mean", "min", "max"}:
        raise ValueError("不支持的汇总方式")
    if not output_column or output_column in group_by or len(set(group_by)) != len(group_by):
        raise ValueError("分组字段和汇总字段必须使用不同的名称")
    columns = {column for row in rows for column in row}
    missing = [column for column in group_by if column not in columns]
    if missing:
        raise ValueError(f"分组字段不存在：{'、'.join(missing)}")
    if operation != "count" and (not value_column or value_column not in columns):
        raise ValueError("该汇总方式需要一个真实存在的数值或标识字段")

    numeric: list[Decimal | None] = []
    float_lane = False
    precision = 38
    if operation not in {"count", "nunique"}:
        raw_values = [row.get(value_column) for row in rows]
        numeric = [_decimal(value) for value in raw_values]
        values = [value for value in numeric if value is not None]
        if not values:
            raise ValueError(f"字段 {value_column} 没有可用于 {operation} 的数值")
        # Enough digits for aligned addition plus the carry from all rows.
        # Only a non-terminating mean rounds (at least 38 significant digits).
        integer_digits = max(1, max(value.adjusted() + 1 for value in values))
        scale = max(0, max(-value.as_tuple().exponent for value in values))
        precision = max(38, integer_digits + scale + len(str(len(values))) + 2)
        present = [value for value in raw_values if value is not None]
        float_lane = any(isinstance(value, float) for value in present) and all(
            isinstance(value, Real)
            and not (isinstance(value, Integral) and abs(value) > MAX_JSON_INTEGER)
            for value in present
        )

    # Group retained scalar keys as-is. A nullable BIGINT must not acquire a
    # float key via dataframe groupby; insertion order gives stable tied sums.
    groups: dict[tuple[Any, ...], list[int]] = {}
    for index, row in enumerate(rows):
        key = tuple(None if _missing(row.get(column)) else row.get(column) for column in group_by)
        try:
            groups.setdefault(key, []).append(index)
        except TypeError as exc:
            raise ValueError("分组字段需要普通值，不能使用嵌套对象或列表") from exc
    results: list[tuple[Any, dict[str, Any]]] = []
    with localcontext() as context:
        context.prec = precision
        context.rounding = ROUND_HALF_EVEN
        for keys, indices in groups.items():
            row = dict(zip(group_by, keys, strict=True))
            if operation == "count":
                value = len(indices)
            elif operation == "nunique":
                distinct = {
                    json.dumps(json_result_value(item), sort_keys=True, ensure_ascii=False)
                    for item in (rows[index].get(value_column) for index in indices)
                    if not _missing(item)
                }
                value = len(distinct)
            else:
                selected = [numeric[index] for index in indices if numeric[index] is not None]
                if not selected:
                    value = Decimal(0) if operation == "sum" else None
                elif operation == "sum":
                    value = sum(selected, Decimal(0))
                elif operation == "mean":
                    value = sum(selected, Decimal(0)) / len(selected)
                else:
                    value = min(selected) if operation == "min" else max(selected)
            order_value = value
            if isinstance(value, Decimal):
                if float_lane:
                    converted = float(value)
                    if math.isfinite(converted):
                        value = converted
                elif value == value.to_integral_value():
                    value = int(value)
            row[output_column] = value
            results.append((order_value, row))
    # Sort native exact values, not their JSON strings; ties keep source order.
    results.sort(key=lambda item: (item[0] is not None, item[0] or 0), reverse=True)
    return json_result_value([row for _, row in results[: max(0, limit)]])
