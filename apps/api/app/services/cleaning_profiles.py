"""Streaming column impact summaries; full counters, explicitly bounded frequencies."""

from __future__ import annotations

from collections import Counter
from typing import Any

import pyarrow as pa
import pyarrow.compute as pc

from app.services.result_values import arrow_result_rows

SAMPLE_ROWS = 1000
MAX_VALUE_CHARS = 256


def _kind(dtype: pa.DataType) -> str:
    if pa.types.is_dictionary(dtype):
        return _kind(dtype.value_type)
    if pa.types.is_integer(dtype) or pa.types.is_decimal(dtype) or pa.types.is_floating(dtype):
        return "number"
    if pa.types.is_string(dtype) or pa.types.is_large_string(dtype):
        return "text"
    if pa.types.is_timestamp(dtype) or pa.types.is_date(dtype) or pa.types.is_time(dtype):
        return "temporal"
    if pa.types.is_boolean(dtype):
        return "boolean"
    return "other"


def _count(mask: pa.Array) -> int:
    return int(pc.sum(mask).as_py() or 0)


def _values(array: pa.Array) -> list[Any]:
    # Keep decimal scale, large integers and nanosecond timestamps intact.
    return [row["value"] for row in arrow_result_rows(pa.record_batch([array], names=["value"]))]


class ColumnImpact:
    def __init__(self, dtype: pa.DataType):
        self.kind = _kind(dtype)
        self.rows = self.null_count = self.blank_count = self.zero_count = 0
        self.non_finite_count = self.sample_rows = self.omitted_long_values = 0
        self.floating = pa.types.is_floating(
            dtype.value_type if pa.types.is_dictionary(dtype) else dtype
        )
        self.minimum: pa.Scalar | None = None
        self.maximum: pa.Scalar | None = None
        self.frequencies: Counter = Counter()

    def update(self, values: pa.Array) -> None:
        if pa.types.is_dictionary(values.type):
            values = pc.dictionary_decode(values)
        self.rows += len(values)
        self.null_count += values.null_count
        finite = values
        if self.kind == "text":
            self.blank_count += _count(pc.equal(pc.utf8_trim_whitespace(values), ""))
        if self.kind == "number":
            self.zero_count += _count(pc.equal(values, pa.scalar(0, type=values.type)))
        if self.floating:
            self.non_finite_count += _count(pc.invert(pc.is_finite(values)))
            finite = pc.filter(values, pc.is_finite(values))
        if self.kind in {"number", "temporal"}:
            limits = pc.min_max(finite)
            low, high = limits["min"], limits["max"]
            if low.is_valid and (self.minimum is None or pc.less(low, self.minimum).as_py()):
                self.minimum = low
            if high.is_valid and (self.maximum is None or pc.greater(high, self.maximum).as_py()):
                self.maximum = high

        if self.kind == "other":
            return
        sample = values.slice(0, max(0, SAMPLE_ROWS - self.sample_rows))
        self.sample_rows += len(sample)
        sample = pc.drop_null(sample)
        if self.floating:
            sample = pc.filter(sample, pc.is_finite(sample))
        if self.kind == "text":
            short = pc.less_equal(pc.utf8_length(sample), MAX_VALUE_CHARS)
            self.omitted_long_values += len(sample) - _count(short)
            sample = pc.filter(sample, short)
        # Conversion and frequency memory are bounded by the sampled rows, not
        # full-table cardinality. Long strings are omitted, never merged by prefix.
        self.frequencies.update(_values(sample))

    def finish(self) -> dict[str, Any]:
        def present(value: pa.Scalar | None) -> Any:
            return _values(pa.array([value], type=value.type))[0] if value is not None else None

        return {
            "kind": self.kind,
            "rows": self.rows,
            "null_count": self.null_count,
            "blank_count": self.blank_count if self.kind == "text" else None,
            "zero_count": self.zero_count if self.kind == "number" else None,
            "non_finite_count": self.non_finite_count if self.floating else None,
            "minimum": present(self.minimum),
            "maximum": present(self.maximum),
            "sample_rows": self.sample_rows,
            "omitted_long_values": self.omitted_long_values,
            "top_values": [
                {"value": value, "count": count} for value, count in self.frequencies.most_common(5)
            ],
        }
