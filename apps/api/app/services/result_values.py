"""Lossless transport for bounded query results, not a numeric inference layer.

RFC 8259's interoperable integer range is narrower than SQL BIGINT. Decimal
and temporal columns also must not pass through float/Python datetime before
being serialized. Keep their exact spelling at the JSON boundary; calculations
remain the responsibility of the query/metric engine.
"""

from __future__ import annotations

import math
import re
from collections.abc import Mapping
from datetime import date, datetime, time
from decimal import Decimal, InvalidOperation
from numbers import Integral, Real
from typing import Any

import pyarrow as pa
import pyarrow.compute as pc

MAX_JSON_INTEGER = 2**53 - 1
_CHART_DECIMAL = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?\Z")


def is_chart_number(value: Any) -> bool:
    """Recognize numeric transport cells without modifying their exact value.

    Charts use floating geometry; explicit numeric strings remain unchanged in
    the bound result/hash. Padded identifiers, booleans and nonfinite values
    must not become inferred chart measures.
    """

    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        return False
    text = str(value)
    if len(text) > 256 or not _CHART_DECIMAL.fullmatch(text):
        return False
    try:
        number = Decimal(text)
        if not number.is_finite() or abs(number.adjusted()) > 1000:
            return False
        plotted = float(number)
        return math.isfinite(plotted) and (plotted != 0 or number.is_zero())
    except (InvalidOperation, ValueError, OverflowError):
        return False


def json_result_value(value: Any) -> Any:
    """Convert a value without rounding exact numbers or inferring text types."""

    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, Integral):
        integer = int(value)
        return integer if abs(integer) <= MAX_JSON_INTEGER else str(integer)
    if isinstance(value, Decimal):
        # str preserves scale and does not expand an arbitrarily large exponent.
        return str(value)
    if isinstance(value, Real):
        number = float(value)
        if math.isnan(number):
            return None
        if math.isinf(number):
            return "Infinity" if number > 0 else "-Infinity"
        return number
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, Mapping):
        return {str(key): json_result_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_result_value(item) for item in value]
    # Numpy booleans and other scalar wrappers, without importing numpy here.
    if hasattr(value, "item") and callable(value.item):
        return json_result_value(value.item())
    return str(value)


def _arrow_column_values(column: pa.Array) -> list[Any]:
    dtype = column.type
    if pa.types.is_dictionary(dtype):
        return _arrow_column_values(pc.dictionary_decode(column))
    if (
        pa.types.is_timestamp(dtype)
        or pa.types.is_date(dtype)
        or pa.types.is_time(dtype)
        or pa.types.is_decimal(dtype)
    ):
        if pa.types.is_timestamp(dtype) and dtype.tz:
            # Presentation only: retain awareness and the original subsecond unit.
            column = pc.cast(column, pa.timestamp(dtype.unit, tz="UTC"), safe=True)
        values = pc.cast(column, pa.string(), safe=True).to_pylist()
        return (
            [value.replace(" ", "T", 1) if value else value for value in values]
            if pa.types.is_timestamp(dtype)
            else values
        )
    if pa.types.is_struct(dtype):
        names = [field.name for field in dtype]
        if len(names) != len(set(names)):
            raise ValueError("查询结果包含同名字段，请为这些字段设置不同的别名")
        if not names:
            return [{} if valid else None for valid in column.is_valid().to_pylist()]
        children = [_arrow_column_values(column.field(index)) for index in range(len(dtype))]
        return [
            dict(zip(names, values, strict=True)) if valid else None
            for valid, values in zip(
                column.is_valid().to_pylist(), zip(*children, strict=True), strict=True
            )
        ]
    if (
        pa.types.is_list(dtype)
        or pa.types.is_large_list(dtype)
        or pa.types.is_fixed_size_list(dtype)
    ):
        values = _arrow_column_values(column.values)
        offsets = (
            [(column.offset + index) * dtype.list_size for index in range(len(column) + 1)]
            if pa.types.is_fixed_size_list(dtype)
            else column.offsets.to_pylist()
        )
        return [
            values[offsets[index] : offsets[index + 1]] if valid else None
            for index, valid in enumerate(column.is_valid().to_pylist())
        ]
    if pa.types.is_map(dtype):
        keys = _arrow_column_values(column.keys)
        values = _arrow_column_values(column.items)
        offsets = column.offsets.to_pylist()
        return [
            [[keys[item], values[item]] for item in range(offsets[index], offsets[index + 1])]
            if valid
            else None
            for index, valid in enumerate(column.is_valid().to_pylist())
        ]
    return [json_result_value(value) for value in column.to_pylist()]


def arrow_result_rows(batch: pa.RecordBatch) -> list[dict[str, Any]]:
    """Serialize exact Arrow scalars recursively, before Python narrows temporal values."""
    names = batch.schema.names
    if len(set(names)) != len(names):
        raise ValueError("查询结果包含同名字段，请为这些字段设置不同的别名")
    columns = [_arrow_column_values(column) for column in batch.columns]
    if not columns:
        return [{} for _ in range(batch.num_rows)]
    return [dict(zip(names, values, strict=True)) for values in zip(*columns, strict=True)]


def fetch_result_rows(cursor: Any, limit: int) -> tuple[list[dict[str, Any]], bool]:
    """Consume at most limit+1 result rows with a closed, bounded Arrow reader.

    This preserves the engine's result, not precision already lost by a SQL
    cast or a source reader (notably TIMESTAMPTZ nanoseconds in DuckDB).
    """

    if limit < 0:
        raise ValueError("查询结果行数上限不能为负数")
    rows: list[dict[str, Any]] = []
    with cursor.to_arrow_reader(min(2048, limit + 1)) as reader:
        if len(set(reader.schema.names)) != len(reader.schema.names):
            raise ValueError("查询结果包含同名字段，请为这些字段设置不同的别名")
        for batch in reader:
            rows.extend(arrow_result_rows(batch.slice(0, limit + 1 - len(rows))))
            if len(rows) > limit:
                break
    return rows[:limit], len(rows) > limit
