"""Bounded, positional comparisons of the original Arrow values in prepared files."""

from __future__ import annotations

from pathlib import Path
from threading import Event
from typing import Any

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from app.services.cleaning_profiles import ColumnImpact
from app.services.result_values import arrow_result_rows


def _snapshot(source: pq.ParquetFile) -> dict[str, Any]:
    sample = []
    for batch in source.iter_batches(batch_size=8, use_threads=False):
        sample.extend(arrow_result_rows(batch.slice(0, 8 - len(sample))))
        if len(sample) == 8:
            break
    return {
        "rows": source.metadata.num_rows,
        "columns": len(source.schema_arrow),
        "sample": sample,
    }


def _changed_cells(left: pa.Array, right: pa.Array) -> int:
    if pa.types.is_dictionary(left.type):
        left = pc.dictionary_decode(left)
    if pa.types.is_dictionary(right.type):
        right = pc.dictionary_decode(right)
    both_null = pc.and_(pc.is_null(left), pc.is_null(right))
    if left.type != right.type:
        # Count a type conversion as a changed cell; never coerce distinct large
        # integers/decimals to a shared double just to make them comparable.
        equal = both_null
    else:
        try:
            equal = pc.or_(pc.fill_null(pc.equal(left, right), False), both_null)
            if pa.types.is_floating(left.type):
                both_nan = pc.fill_null(pc.and_(pc.is_nan(left), pc.is_nan(right)), False)
                equal = pc.or_(equal, both_nan)
        except pa.ArrowNotImplementedError:
            # Nested values stay Arrow-native, including nested temporal precision.
            return sum(not left.slice(i, 1).equals(right.slice(i, 1)) for i in range(len(left)))
    return len(left) - int(pc.sum(equal).as_py() or 0)


def snapshot_working_copy(path: Path) -> dict[str, Any]:
    """Read shape and eight exact-value rows, without a positional period diff."""

    if not path.is_file() or path.suffix.casefold() != ".parquet":
        raise ValueError("分析副本不存在或格式不受支持")
    with pq.ParquetFile(path, pre_buffer=False, arrow_extensions_enabled=False) as source:
        return _snapshot(source)


def compare_working_copies(
    before_path: Path,
    after_path: Path,
    *,
    profile_columns: list[str] | None = None,
    cancelled: Event | None = None,
) -> dict[str, Any]:
    def check_cancelled() -> None:
        if cancelled is not None and cancelled.is_set():
            raise InterruptedError("分析副本比较已取消")

    check_cancelled()
    for path in (before_path, after_path):
        if not path.is_file() or path.suffix.casefold() != ".parquet":
            raise ValueError("当前分析副本不存在或格式不受支持")
    with (
        pq.ParquetFile(before_path, pre_buffer=False, arrow_extensions_enabled=False) as before,
        pq.ParquetFile(after_path, pre_buffer=False, arrow_extensions_enabled=False) as after,
    ):
        names = before.schema_arrow.names
        if len(names) != len(set(names)) or len(after.schema_arrow.names) != len(
            set(after.schema_arrow.names)
        ):
            raise ValueError("分析副本包含同名字段，无法可靠比较")
        all_names = list(dict.fromkeys([*names, *after.schema_arrow.names]))
        requested = list(dict.fromkeys(profile_columns or []))
        if len(requested) > 100:
            raise ValueError("一次最多比较 100 个字段的影响")
        selected = (
            [name for name in requested if name in all_names] if requested else all_names[:12]
        )
        profiles = [
            {
                name: ColumnImpact(source.schema_arrow.field(name).type)
                for name in selected
                if name in source.schema_arrow.names
            }
            for source in (before, after)
        ]
        result = {
            "before": _snapshot(before),
            "after": _snapshot(after),
            "changes": [],
            "comparison_basis": "unavailable",
            "profiles": [],
            "profiles_omitted": len(all_names) - len(selected),
        }

        def finish() -> dict[str, Any]:
            check_cancelled()
            result["profiles"] = [
                {
                    "column": name,
                    "before": profiles[0][name].finish() if name in profiles[0] else None,
                    "after": profiles[1][name].finish() if name in profiles[1] else None,
                }
                for name in selected
            ]
            return result

        # Row removal/reordering is not an identity join. Shape changes deliberately
        # omit per-cell counts instead of pretending shifted positions are edits.
        if before.metadata.num_rows != after.metadata.num_rows or names != after.schema_arrow.names:
            for source, accumulators in zip((before, after), profiles, strict=True):
                if not accumulators:
                    continue
                read_rows = 0
                size = max(1, min(8192, 65536 // len(accumulators)))
                for batch in source.iter_batches(
                    columns=list(accumulators),
                    batch_size=size,
                    use_threads=False,
                ):
                    check_cancelled()
                    read_rows += len(batch)
                    for name, accumulator in accumulators.items():
                        check_cancelled()
                        index = batch.schema.get_field_index(name)
                        if index < 0:
                            raise ValueError("分析副本字段读取不完整，未生成字段统计")
                        accumulator.update(batch.column(index))
                if read_rows != source.metadata.num_rows:
                    raise ValueError("分析副本读取不完整，未生成字段统计")
            return finish()
        if not names:
            return finish()
        size = max(1, min(8192, 65536 // len(names)))
        left_batches = iter(before.iter_batches(batch_size=size, use_threads=False))
        right_batches = iter(after.iter_batches(batch_size=size, use_threads=False))
        left = right = None
        left_offset = right_offset = compared = 0
        counts = [0] * len(names)
        while True:
            check_cancelled()
            if left is None or left_offset == len(left):
                left = next(left_batches, None)
                left_offset = 0
            if right is None or right_offset == len(right):
                right = next(right_batches, None)
                right_offset = 0
            if left is None or right is None:
                if left is not None or right is not None or compared != before.metadata.num_rows:
                    raise ValueError("分析副本读取不完整，未生成对比结果")
                break
            length = min(len(left) - left_offset, len(right) - right_offset)
            if length <= 0:
                raise ValueError("分析副本读取到空批次，未生成对比结果")
            for index in range(len(names)):
                check_cancelled()
                left_values = left.column(index).slice(left_offset, length)
                right_values = right.column(index).slice(right_offset, length)
                counts[index] += _changed_cells(left_values, right_values)
                if names[index] in profiles[0]:
                    profiles[0][names[index]].update(left_values)
                    profiles[1][names[index]].update(right_values)
            compared += length
            left_offset += length
            right_offset += length
        result["changes"] = [
            {"column": column, "changed_count": count}
            for column, count in zip(names, counts, strict=True)
        ]
        result["comparison_basis"] = "position"
        return finish()
