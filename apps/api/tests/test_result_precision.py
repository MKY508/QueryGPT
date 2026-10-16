"""Small fixtures covering query -> retained result -> checkpoint/export boundaries."""

import json
from datetime import UTC, datetime
from decimal import Decimal
from uuid import uuid4

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from app.services.analysis_checkpoint import (
    _load_checkpoint_sync,
    _sha256_file,
    _write_checkpoint_sync,
)
from app.services.checkpoint_contract import CheckpointError, stable_payload_hash
from app.services.database import QueryResult
from app.services.file_query import query_project_file_rows
from app.services.result_aggregation import aggregate_result_rows as _aggregate_result_rows
from app.services.result_values import fetch_result_rows


def test_file_query_keeps_native_result_precision_and_limit(tmp_path):
    epoch = 1788220800123456789
    path = tmp_path / "source.parquet"
    pq.write_table(
        pa.table(
            {
                "id": pa.array([7, 9007199254740993, None], type=pa.int64()),
                "unsigned": pa.array([18446744073709551615] * 3, type=pa.uint64()),
                "amount": pa.array(
                    [Decimal("9999999999999999999999999999999999.1234")] * 3,
                    type=pa.decimal128(38, 4),
                ),
                "event_time": pa.array([epoch, epoch + 1, epoch + 2], type=pa.timestamp("ns")),
                "clock": pa.array([123456789, 123456790, 123456789], type=pa.time64("ns")),
                "observed_at": pa.array([0] * 3, type=pa.timestamp("us", tz="Asia/Shanghai")),
            }
        ),
        path,
    )
    holder = {}
    rows, truncated, available = query_project_file_rows(
        [{"kind": "file", "view_name": "orders", "working_uri": str(path)}],
        'SELECT * FROM "orders" ORDER BY event_time',
        tmp_path / "project",
        limit=2,
        connection_holder=holder,
    )
    assert available == ["orders"] and truncated and holder == {}
    assert [row["id"] for row in rows] == [7, "9007199254740993"]
    assert rows[0]["unsigned"] == "18446744073709551615"
    assert rows[0]["amount"] == "9999999999999999999999999999999999.1234"
    assert rows[0]["event_time"].endswith("123456789")
    assert rows[1]["event_time"] != rows[0]["event_time"]
    assert rows[0]["clock"] == "00:00:00.123456789"
    assert rows[0]["observed_at"] == "1970-01-01T00:00:00.000000Z"
    json.dumps(rows, allow_nan=False)
    grouped, truncated, _ = query_project_file_rows(
        [{"kind": "file", "view_name": "orders", "working_uri": str(path)}],
        'SELECT count(DISTINCT clock) AS times FROM "orders"',
        tmp_path / "project",
    )
    assert grouped == [{"times": 2}] and not truncated
    # The Arrow bridge must be gone before executing the supplied SQL.
    with pytest.raises(duckdb.Error, match="disabled|Permission"):
        query_project_file_rows(
            [{"kind": "file", "view_name": "orders", "working_uri": str(path)}],
            "SELECT * FROM read_parquet('unapproved.parquet')",
            tmp_path / "project",
        )


def test_arrow_result_boundaries_close_reader_and_reject_duplicate_labels():
    with duckdb.connect() as connection:
        rows, truncated = fetch_result_rows(connection.execute("SELECT * FROM range(5)"), 5)
        assert len(rows) == 5 and not truncated
        assert fetch_result_rows(connection.execute("SELECT 1"), 0) == ([], True)
        with pytest.raises(ValueError, match="同名字段"):
            fetch_result_rows(connection.execute("SELECT 1 AS value, 2 AS value"), 5)
        assert connection.execute("SELECT 42").fetchone() == (42,)


def test_database_result_uses_strict_json_without_retyping_text():
    result = QueryResult(
        data=[
            {
                "amount": Decimal("-9007199254740993.0123"),
                "id": 9007199254740993,
                "code": "0001",
                "nested": {"count": 9007199254740994, "active": True},
                "nan": float("nan"),
                "inf": float("inf"),
                "when": datetime(2026, 9, 5, tzinfo=UTC),
            }
        ],
        rows_count=1,
    )
    row = result.data[0]
    assert row["amount"] == "-9007199254740993.0123"
    assert row["id"] == "9007199254740993" and row["code"] == "0001"
    assert row["nested"] == {"count": "9007199254740994", "active": True}
    assert row["nan"] is None and row["inf"] == "Infinity"
    assert row["when"] == "2026-09-05T00:00:00+00:00"
    assert QueryResult(data=result.data, rows_count=1).data == result.data
    json.dumps(result.data, allow_nan=False)


def test_retained_aggregation_keeps_decimals_nullable_ids_and_exact_order():
    rows = _aggregate_result_rows(
        [
            {"id": 9007199254740993, "amount": "9999999999999999999999999999999999.1234"},
            {"id": 9007199254740993, "amount": "0.0001"},
            {"id": 9007199254740992, "amount": "10.1"},
            {"id": None, "amount": "2.01"},
            {"id": None, "amount": None},
        ],
        group_by=["id"],
        operation="sum",
        value_column="amount",
        output_column="total",
    )
    assert rows == [
        {"id": "9007199254740993", "total": "9999999999999999999999999999999999.1235"},
        {"id": "9007199254740992", "total": "10.1"},
        {"id": None, "total": "2.01"},
    ]
    assert _aggregate_result_rows(
        [{"value": 9223372036854775807}, {"value": 1}],
        group_by=[],
        operation="sum",
        value_column="value",
        output_column="total",
    ) == [{"total": "9223372036854775808"}]
    assert _aggregate_result_rows(
        [{"value": "0.1"}, {"value": "0.2"}],
        group_by=[],
        operation="mean",
        value_column="value",
        output_column="total",
    ) == [{"total": "0.15"}]


@pytest.mark.parametrize("value", ["Infinity", "1e1000000"])
def test_retained_aggregation_rejects_nonfinite_or_unbounded_numbers(value):
    with pytest.raises(ValueError):
        _aggregate_result_rows(
            [{"value": value}],
            group_by=[],
            operation="sum",
            value_column="value",
            output_column="total",
        )


def test_checkpoint_keeps_sparse_mixed_rows_and_verifies_hash(tmp_path):
    rows = [
        {"id": 7, "amount": "0.10", "time": "00:00:00.123456789"},
        {"id": "9007199254740993", "amount": None},
        {"id": None, "nested": {"value": "999999999999999999.1234"}},
    ]
    checkpoint = _write_checkpoint_sync(tmp_path, uuid4(), 1, {"dataframes": {"result": rows}})
    restored = _load_checkpoint_sync(tmp_path, checkpoint)
    assert restored.dataframes["result"] == rows
    descriptor = restored.manifest["datasets"]["result"]
    assert descriptor["encoding"] == "json_rows_v1"
    assert descriptor["result_hash"] == stable_payload_hash(rows)
    data_path = (tmp_path / checkpoint["manifest_path"]).parent / descriptor["path"]
    data_path.write_bytes(b"damaged")
    with pytest.raises(CheckpointError, match="校验失败"):
        _load_checkpoint_sync(tmp_path, checkpoint)


def test_legacy_native_parquet_checkpoint_still_loads(tmp_path):
    rows = [{"id": 7, "amount": 1.5}, {"id": 8, "amount": 2.5}]
    checkpoint = _write_checkpoint_sync(tmp_path, uuid4(), 1, {"dataframes": {"result": rows}})
    manifest_path = tmp_path / checkpoint["manifest_path"]
    manifest = json.loads(manifest_path.read_text())
    descriptor = manifest["datasets"]["result"]
    descriptor.pop("encoding")
    path = manifest_path.parent / descriptor["path"]
    pq.write_table(pa.Table.from_pylist(rows), path)
    descriptor["sha256"] = _sha256_file(path)
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    checkpoint["manifest_sha256"] = _sha256_file(manifest_path)
    assert _load_checkpoint_sync(tmp_path, checkpoint).dataframes == {"result": rows}
