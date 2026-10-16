"""Bounded native Arrow staging for flat analytical Parquet tables."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from app.services.data_preflight import PreflightInputError
from app.services.tabular_preflight import (
    _BATCH_CELLS,
    _BATCH_ROWS,
    _MAX_COLUMNS,
    StagedTable,
    run_staged_preflight,
)

_MAX_FOOTER_BYTES = 16 * 1024 * 1024
_MAX_DECODED_BATCH_BYTES = 64 * 1024 * 1024
_MAX_TEXT_VALUE_BYTES = 4 * 1024 * 1024


def _storage_type(dtype: pa.DataType) -> pa.DataType:
    if pa.types.is_dictionary(dtype):
        if dtype.ordered:
            raise PreflightInputError(
                "暂不能保留有序分类字段的顺序，请先导出为普通值列",
                code="parquet_schema_unsupported",
            )
        return _storage_type(dtype.value_type)
    if pa.types.is_null(dtype) or pa.types.is_boolean(dtype) or pa.types.is_integer(dtype):
        return dtype
    if pa.types.is_floating(dtype) and dtype.bit_width >= 32:
        return dtype
    if pa.types.is_string(dtype) or pa.types.is_large_string(dtype):
        return pa.string()
    if pa.types.is_timestamp(dtype):
        # Removing the timezone annotation via Arrow preserves epoch integers.
        # DuckDB otherwise truncates aware nanoseconds to microseconds on read.
        return pa.timestamp(dtype.unit)
    if pa.types.is_date(dtype):
        return pa.date32()
    if pa.types.is_time(dtype):
        return pa.timestamp(dtype.unit)
    if pa.types.is_decimal(dtype) and 0 <= dtype.scale <= dtype.precision <= 38:
        return pa.decimal128(dtype.precision, dtype.scale)
    raise PreflightInputError(
        "这份 Parquet 包含暂不支持的字段类型，请将嵌套、二进制或超高精度字段转换后再导入",
        code="parquet_schema_unsupported",
    )


def _check_footer(path: Path) -> None:
    size = path.stat().st_size
    if size < 12:
        raise PreflightInputError(
            "Parquet 文件不完整，请重新导出后再导入", code="parquet_unreadable"
        )
    with path.open("rb") as source:
        header = source.read(4)
        source.seek(-8, 2)
        footer = source.read(8)
    if header != b"PAR1" or footer[4:] != b"PAR1":
        raise PreflightInputError(
            "无法读取这份 Parquet，请检查文件格式或加密方式", code="parquet_unreadable"
        )
    length = int.from_bytes(footer[:4], "little")
    if length > _MAX_FOOTER_BYTES or length > size - 12:
        raise PreflightInputError(
            "Parquet 的结构信息过大或不完整，请拆分并重新导出", code="parquet_size_limit"
        )


def _stage_parquet(
    source_path: Path, staged: Path, ordinal: str, steps: list[dict[str, Any]]
) -> StagedTable:
    from app.services import data_preflight as common

    _check_footer(source_path)
    with pq.ParquetFile(
        source_path,
        pre_buffer=False,
        memory_map=False,
        thrift_string_size_limit=_MAX_FOOTER_BYTES,
        thrift_container_size_limit=100_000,
        page_checksum_verification=True,
        arrow_extensions_enabled=False,
    ) as source:
        original = source.schema_arrow
        if not original.names or len(original) > _MAX_COLUMNS:
            raise PreflightInputError(
                "Parquet 列数为空或过多，请检查并拆分文件", code="parquet_size_limit"
            )
        columns = common._dedupe_columns(original.names)
        storage_types = [_storage_type(item.type) for item in original]
        schema = pa.schema(
            [pa.field(name, dtype) for name, dtype in zip(columns, storage_types, strict=True)]
            + [pa.field(ordinal, pa.int64())]
        )
        native_types = {}
        for name, item, storage in zip(columns, original, storage_types, strict=True):
            if not pa.types.is_string(storage) and not pa.types.is_null(storage):
                native_types[name] = (
                    item.type.value_type if pa.types.is_dictionary(item.type) else item.type
                )
        row_limit = max(1, min(_BATCH_ROWS, _BATCH_CELLS // len(columns)))
        count = 0
        with pq.ParquetWriter(staged, schema, compression="zstd") as writer:
            for batch in source.iter_batches(
                batch_size=row_limit, use_threads=False, use_pandas_metadata=False
            ):
                # This cap is checked after decode, not claimed as a decoder RSS limit.
                if batch.nbytes > _MAX_DECODED_BATCH_BYTES:
                    raise PreflightInputError(
                        "Parquet 中的单批数据过大，请拆分文件或缩短文本后再导入",
                        code="parquet_size_limit",
                    )
                arrays = []
                for array, dtype in zip(batch.columns, storage_types, strict=True):
                    if pa.types.is_dictionary(array.type):
                        array = pc.dictionary_decode(array)
                    if pa.types.is_time(array.type):
                        integer = pa.int32() if array.type.bit_width == 32 else pa.int64()
                        array = pc.cast(pc.cast(pc.cast(array, integer), pa.int64()), dtype)
                    else:
                        array = pc.cast(array, dtype, safe=True)
                    if pa.types.is_string(dtype):
                        if (pc.max(pc.binary_length(array)).as_py() or 0) > _MAX_TEXT_VALUE_BYTES:
                            raise PreflightInputError(
                                "Parquet 中有过长的文本，请缩短单元格内容后再导入",
                                code="parquet_size_limit",
                            )
                    elif pa.types.is_floating(dtype):
                        # Match missing-value handling without narrowing finite values.
                        array = pc.if_else(pc.is_nan(array), pa.scalar(None, type=dtype), array)
                    arrays.append(array)
                arrays.append(pa.array(range(count, count + batch.num_rows), type=pa.int64()))
                writer.write_batch(pa.RecordBatch.from_arrays(arrays, schema=schema))
                count += batch.num_rows
        if count != source.metadata.num_rows:
            raise PreflightInputError(
                "Parquet 的记录数与文件信息不一致，请重新导出", code="parquet_unreadable"
            )
    operations = []
    if columns != original.names or any(
        step["operation"] == "normalize_column_names" for step in steps
    ):
        operations.append(
            {
                "operation": "normalize_column_names",
                "columns": columns,
                "replayed": any(step["operation"] == "normalize_column_names" for step in steps),
            }
        )
    drift = []
    if any(
        step["operation"] in {"select_sheet", "select_header", "use_generated_headers"}
        for step in steps
    ):
        drift.append("Parquet 文件不支持重放工作表或表头选择")
    return StagedTable(
        rows=count,
        columns=columns,
        operations=operations,
        drift=drift,
        native_types=native_types,
        preserve_string_types=True,
        reader={
            "engine": "parquet_stream_v1",
            "batch_rows": row_limit,
            "source_schema": {
                name: str(item.type) for name, item in zip(columns, original, strict=True)
            },
            "timezone_presentation": "UTC",
            "pandas_index_columns": "physical_columns",
        },
    )


def run_parquet_preflight(source_path: Path, output_dir: Path, steps: list[dict[str, Any]]):
    try:
        return run_staged_preflight(source_path, output_dir, steps, _stage_parquet)
    except pa.ArrowException as exc:
        raise PreflightInputError(
            "无法完整读取这份 Parquet，请重新导出后再导入", code="parquet_unreadable"
        ) from exc
