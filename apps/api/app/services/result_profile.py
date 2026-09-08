"""Deterministic evidence from retained query rows."""

import json
import math
from typing import Any


def profile_result(
    rows: list[dict[str, Any]],
    *,
    key_columns: list[str],
    numeric_columns: list[str],
) -> dict[str, Any]:
    """Build deterministic evidence before the model turns rows into claims."""

    columns = sorted({str(key) for row in rows for key in row})
    missing_requested = sorted(
        {str(column) for column in [*key_columns, *numeric_columns]} - set(columns)
    )
    if missing_requested:
        raise ValueError(f"请求校验的字段不存在: {'、'.join(missing_requested)}")
    null_counts = {
        column: sum(row.get(column) is None or row.get(column) == "" for row in rows)
        for column in columns
    }
    duplicate_rows = len(rows) - len(
        {json.dumps(row, sort_keys=True, default=str, ensure_ascii=False) for row in rows}
    )
    keys: dict[str, Any] = {}
    for column in key_columns:
        values = [row.get(column) for row in rows]
        present = [value for value in values if value is not None and value != ""]
        keys[column] = {
            "missing": len(values) - len(present),
            "unique": len({str(value) for value in present}),
            "duplicate_values": max(len(present) - len({str(value) for value in present}), 0),
        }

    numeric: dict[str, Any] = {}
    for column in numeric_columns:
        values: list[float] = []
        for row in rows:
            value = row.get(column)
            try:
                number = float(value)
            except (TypeError, ValueError):
                continue
            if math.isfinite(number):
                values.append(number)
        numeric[column] = (
            {
                "count": len(values),
                "sum": round(sum(values), 6),
                "min": min(values),
                "max": max(values),
            }
            if values
            else {"count": 0}
        )
        if not values:
            raise ValueError(f"数值字段 {column} 没有可验证的有限数值")

    return {
        "materialized_rows": len(rows),
        "columns": columns,
        "null_counts": null_counts,
        "duplicate_rows": duplicate_rows,
        "keys": keys,
        "numeric": numeric,
    }
