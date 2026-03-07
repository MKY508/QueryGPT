"""Visualization helpers for SQL result rendering."""

from __future__ import annotations

from typing import Any


def build_chart_from_config(
    config: dict[str, Any],
    data: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Build a chart payload from an explicit model-provided config."""
    if not data:
        return None

    chart_type = config.get("type", "bar")
    title = config.get("title", "")
    x_key = config.get("xKey")
    y_keys = list(config.get("yKeys", []))

    columns = list(data[0].keys())
    if not x_key or x_key not in columns:
        x_key = columns[0]

    if not y_keys:
        for column in columns:
            if column == x_key:
                continue
            try:
                float(data[0][column])
            except (TypeError, ValueError):
                continue
            y_keys.append(column)

    if not y_keys:
        return None

    chart_data = []
    for row in data[:50]:
        item = {"name": str(row.get(x_key, ""))}
        for y_key in y_keys:
            try:
                item[y_key] = float(row.get(y_key, 0))
            except (TypeError, ValueError):
                item[y_key] = 0
        chart_data.append(item)

    return {
        "type": chart_type,
        "title": title,
        "data": chart_data,
        "xKey": "name",
        "yKeys": y_keys,
    }


def generate_visualization(
    data: list[dict[str, Any]],
    query: str,
) -> dict[str, Any] | None:
    """Generate a fallback chart config from query semantics and result data."""
    if not data:
        return None

    columns = list(data[0].keys())
    if len(columns) < 2:
        return None

    x_column = columns[0]
    y_columns: list[str] = []
    for column in columns[1:]:
        try:
            float(data[0][column])
        except (TypeError, ValueError):
            continue
        y_columns.append(column)

    if not y_columns:
        return None

    query_lower = query.lower()
    if any(token in query_lower for token in ("趋势", "trend", "变化", "时间", "time")):
        chart_type = "line"
    elif any(token in query_lower for token in ("占比", "比例", "percentage", "pie")):
        chart_type = "pie"
    else:
        chart_type = "bar"

    chart_data = []
    for row in data[:50]:
        item = {"name": str(row[x_column])}
        for y_column in y_columns:
            try:
                item[y_column] = float(row[y_column])
            except (TypeError, ValueError):
                item[y_column] = 0
        chart_data.append(item)

    return {
        "type": chart_type,
        "data": chart_data,
        "xKey": "name",
        "yKeys": y_columns,
    }
