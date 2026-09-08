"""Materialize approved Parquet files before disabling external SQL access."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from uuid import uuid4

import duckdb
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from app.services.file_formats import JSON_LINES_FORMATS
from app.services.result_values import fetch_result_rows


def query_project_file_rows(
    sources: list[dict[str, Any]],
    sql: str,
    project_dir: Path,
    *,
    limit: int = 10_000,
    connection_holder: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], bool, list[str]]:
    """Materialize approved files, then disable DuckDB filesystem and network access."""

    temp_dir = project_dir / ".duckdb-temp"
    temp_dir.mkdir(parents=True, exist_ok=True)
    connection = duckdb.connect(database=":memory:")
    if connection_holder is not None:
        connection_holder["connection"] = connection
    available: list[str] = []
    try:
        escaped_temp_dir = str(temp_dir).replace("'", "''")
        connection.execute("SET threads=2")
        connection.execute("SET memory_limit='1GB'")
        connection.execute(f"SET temp_directory='{escaped_temp_dir}'")
        for source in sources:
            if source.get("kind") != "file":
                continue
            path = source.get("working_uri")
            view_name = source.get("view_name")
            if not path or not view_name:
                continue
            escaped_path = str(path).replace("'", "''")
            safe_name = str(view_name).replace('"', '""')
            suffix = str(path).lower().rsplit(".", 1)[-1]
            if suffix == "parquet":
                materialize_parquet(connection, str(path), str(view_name))
                available.append(str(view_name))
                continue
            elif suffix in JSON_LINES_FORMATS:
                # Imported JSON Lines must pass the preparation/line-validation
                # path first; a legacy raw working URI is not a CSV fallback.
                raise ValueError("请先重新整理逐行 JSON 文件，再进行查询")
            elif suffix == "json":
                reader = f"read_json_auto('{escaped_path}')"
            else:
                reader = f"read_csv_auto('{escaped_path}', header=true)"
            connection.execute(f'CREATE TEMP TABLE "{safe_name}" AS SELECT * FROM {reader}')
            available.append(str(view_name))
        if not available:
            raise ValueError("项目文件尚未完成数据预检")
        connection.execute("SET enable_external_access=false")
        connection.execute("SET lock_configuration=true")
        cursor = connection.execute(sql)
        rows, truncated = fetch_result_rows(cursor, limit)
        return rows, truncated, available
    finally:
        if connection_holder is not None:
            connection_holder.pop("connection", None)
        connection.close()


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


class UnsupportedParquetPrecisionError(ValueError):
    def __init__(self, columns: list[str]):
        self.columns = columns
        super().__init__("当前文件包含暂不支持完整验证的高精度字段")


def _unsupported_precision(dtype: pa.DataType, *, nested: bool = False) -> bool:
    if pa.types.is_timestamp(dtype):
        return dtype.unit == "ns" and (bool(dtype.tz) or nested)
    if pa.types.is_time64(dtype):
        return dtype.unit == "ns" and nested
    if pa.types.is_decimal(dtype):
        return dtype.precision > 38
    if pa.types.is_duration(dtype):
        return True
    if pa.types.is_dictionary(dtype):
        return _unsupported_precision(dtype.value_type, nested=True)
    if pa.types.is_struct(dtype):
        return any(_unsupported_precision(field.type, nested=True) for field in dtype)
    if (
        pa.types.is_list(dtype)
        or pa.types.is_large_list(dtype)
        or pa.types.is_fixed_size_list(dtype)
    ):
        return _unsupported_precision(dtype.value_type, nested=True)
    if pa.types.is_map(dtype):
        return _unsupported_precision(dtype.key_type, nested=True) or _unsupported_precision(
            dtype.item_type, nested=True
        )
    return False


def materialize_parquet(
    connection, path: str, table_name: str, *, require_lossless: bool = False
) -> None:
    """Bridge TIME(NANOS) through text into DuckDB's actual TIME_NS type.

    The pinned reader narrows Parquet time64[ns] to TIME even though the SQL
    engine supports TIME_NS. The temporary string representation is only a
    transport; comparisons/grouping still use a typed nanosecond SQL column.
    Do not strip timestamp timezones here: their binning semantics differ.
    """

    with pq.ParquetFile(path, pre_buffer=False, arrow_extensions_enabled=False) as source:
        schema = source.schema_arrow
        if require_lossless:
            unsupported = [field.name for field in schema if _unsupported_precision(field.type)]
            if unsupported:
                raise UnsupportedParquetPrecisionError(unsupported)
        precise_times = {
            field.name
            for field in schema
            if pa.types.is_time64(field.type) and field.type.unit == "ns"
        }
        if not precise_times:
            connection.execute(
                f"CREATE TEMP TABLE {_quote(table_name)} AS SELECT * FROM read_parquet(?)",
                [path],
            )
            return
        transport_schema = pa.schema(
            [
                pa.field(field.name, pa.string(), nullable=field.nullable)
                if field.name in precise_times
                else field
                for field in schema
            ]
        )

        def batches():
            size = max(1, min(8192, 65536 // max(1, len(schema))))
            for batch in source.iter_batches(batch_size=size, use_threads=False):
                arrays = [
                    pc.cast(column, pa.string(), safe=True)
                    if field.name in precise_times
                    else column
                    for field, column in zip(schema, batch.columns, strict=True)
                ]
                yield pa.RecordBatch.from_arrays(arrays, schema=transport_schema)

        name = f"_receiptbi_arrow_{uuid4().hex}"
        projection = ", ".join(
            f"CAST({_quote(field.name)} AS TIME_NS) AS {_quote(field.name)}"
            if field.name in precise_times
            else _quote(field.name)
            for field in schema
        )
        with pa.RecordBatchReader.from_batches(transport_schema, batches()) as reader:
            connection.register(name, reader)
            try:
                connection.execute(
                    f"CREATE TEMP TABLE {_quote(table_name)} AS SELECT {projection} FROM {_quote(name)}"
                )
            finally:
                connection.unregister(name)
