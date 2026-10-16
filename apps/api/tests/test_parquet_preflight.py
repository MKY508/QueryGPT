"""Native-schema and precision checks using small generated Parquet files."""

from datetime import date
from decimal import Decimal
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq
import pytest

from app.services import parquet_preflight
from app.services.data_preflight import PreflightInputError, fingerprint_file, run_preflight


def test_streams_native_values_with_exact_decimal_integer_and_timestamp_precision(
    tmp_path, monkeypatch
):
    source = tmp_path / "native.parquet"
    epoch = 1788220800123456789
    table = pa.table(
        {
            "record_id": pa.array(
                [9007199254740993, 9007199254740993, 9007199254740993], type=pa.int64()
            ),
            "unsigned": pa.array([18446744073709551615] * 3, type=pa.uint64()),
            "amount": pa.array(
                [Decimal("9999999999999999999999999999999999.1234")] * 3, type=pa.decimal128(38, 4)
            ),
            "event_time": pa.array(
                [epoch, epoch + 1, epoch], type=pa.timestamp("ns", tz="Asia/Shanghai")
            ),
            "naive_time": pa.array([epoch, epoch + 1, epoch], type=pa.timestamp("ns")),
            "day": pa.array([date(2026, 9, 1)] * 3, type=pa.date32()),
            "clock_time": pa.array([123456789] * 3, type=pa.time64("ns")),
            "rate": pa.array([0.25] * 3, type=pa.float32()),
            "active": pa.array([True] * 3),
            "region": pa.array([" east "] * 3),
        }
    )
    pq.write_table(table, source, row_group_size=1, write_page_checksum=True)
    before = fingerprint_file(source)
    monkeypatch.setattr(
        pd, "read_parquet", lambda *args, **kwargs: pytest.fail("No full pandas frame")
    )
    monkeypatch.setattr(parquet_preflight, "_BATCH_ROWS", 1)
    result = run_preflight(source, tmp_path / "prepared")
    output = pq.read_table(result.working_path)
    assert output.num_rows == 2  # Equal microseconds must not merge distinct nanoseconds.
    for name in table.column_names:
        assert output.schema.field(name).type == table.schema.field(name).type
        if name != "region":
            assert output[name].equals(table[name].slice(0, 2))
    assert output["region"].to_pylist() == ["east", "east"]
    snapshot = result.source_snapshot
    assert snapshot["sample"][0]["record_id"] == "9007199254740993"
    assert snapshot["sample"][0]["amount"] == "9999999999999999999999999999999999.1234"
    assert snapshot["sample"][0]["event_time"].endswith("123456789Z")
    assert pd.Timestamp(snapshot["sample"][1]["naive_time"]).value == epoch + 1
    assert snapshot["sample"][0]["clock_time"].endswith("123456789")
    assert snapshot["reader"]["engine"] == "parquet_stream_v1"
    assert snapshot["reader"]["batch_rows"] == 1
    assert fingerprint_file(source) == before
    assert fingerprint_file(result.working_path) == result.output_fingerprint
    assert list((tmp_path / "prepared").iterdir()) == [result.working_path]


def test_replays_native_fills_without_changing_decimal_scale_or_timezone(tmp_path):
    source = tmp_path / "fill.parquet"
    dtype = pa.timestamp("ns", tz="Asia/Shanghai")
    table = pa.table(
        {
            "id": [1, 2],
            "amount": pa.array([None, Decimal("1.25")], type=pa.decimal128(8, 2)),
            "event_time": pa.array([None, 0], type=dtype),
            "clock_time": pa.array([None, 0], type=pa.time64("ns")),
        }
    )
    pq.write_table(table, source)
    timestamp = "2026-09-02T00:00:00.123456789+08:00"
    result = run_preflight(
        source,
        tmp_path / "prepared",
        [
            {"operation": "normalize_currency", "column": "amount"},
            {"operation": "normalize_datetime", "column": "event_time"},
            {"operation": "fill_missing", "column": "amount", "value": 0.1},
            {"operation": "fill_missing", "column": "event_time", "value": timestamp},
            {"operation": "fill_missing", "column": "clock_time", "value": "00:00:00.123456789"},
        ],
    )
    output = pq.read_table(result.working_path)
    assert output["amount"][0].as_py() == Decimal("0.10")
    assert output.schema.field("amount").type == pa.decimal128(8, 2)
    assert output["event_time"][0] == pc.cast(pa.scalar(timestamp), dtype)
    assert pc.cast(output["clock_time"], pa.int64()).to_pylist() == [123456789, 0]
    assert result.source_snapshot["recipe_replay"]["drift"] == []


@pytest.mark.parametrize(
    "dtype, value",
    [(pa.int32(), 1.5), (pa.decimal128(8, 2), "0.005"), (pa.decimal128(8, 2), 0.005)],
)
def test_rejects_lossy_native_fill_and_keeps_previous_copy(tmp_path, dtype, value):
    source = tmp_path / "lossy.parquet"
    pq.write_table(pa.table({"id": [1, 2], "amount": pa.array([None, 1], type=dtype)}), source)
    output = tmp_path / "prepared"
    output.mkdir()
    previous = output / "analysis-ready.parquet"
    previous.write_bytes(b"trusted copy")
    with pytest.raises(ValueError, match="类型或精度"):
        run_preflight(
            source, output, [{"operation": "fill_missing", "column": "amount", "value": value}]
        )
    assert previous.read_bytes() == b"trusted copy"
    assert list(output.iterdir()) == [previous]


def test_preserves_declared_strings_and_reports_inapplicable_recipe_steps(tmp_path):
    source = tmp_path / "strings.parquet"
    pq.write_table(
        pa.table(
            {"value": ["001", "002", "NA", ""], "qty": pa.array([1, 2, 3, 4], type=pa.int16())}
        ),
        source,
    )
    result = run_preflight(
        source,
        tmp_path / "prepared",
        [
            {"operation": "select_sheet", "sheet": "missing"},
            {"operation": "normalize_datetime", "column": "qty"},
        ],
    )
    output = pq.read_table(result.working_path)
    assert output["value"].to_pylist() == ["001", "002", "NA", ""]
    assert output.schema.field("qty").type == pa.int16()
    assert len(result.source_snapshot["recipe_replay"]["drift"]) == 2
    assert result.status == "needs_confirmation"


@pytest.mark.parametrize(
    "dtype, values",
    [
        (pa.list_(pa.int32()), [[1], [2]]),
        (pa.decimal256(50, 2), [Decimal("1.00"), Decimal("2.00")]),
    ],
)
def test_rejects_unsupported_schema_without_stringifying_or_publishing(tmp_path, dtype, values):
    source = tmp_path / "unsupported.parquet"
    pq.write_table(pa.table({"value": pa.array(values, type=dtype)}), source)
    with pytest.raises(PreflightInputError, match="字段类型") as error:
        run_preflight(source, tmp_path / "prepared")
    assert error.value.presentation_code == "parquet_schema_unsupported"
    assert not list((tmp_path / "prepared").iterdir())


def test_preserves_infinity_and_converts_nan_to_missing_in_typed_float(tmp_path):
    source = tmp_path / "float.parquet"
    pq.write_table(pa.table({"id": [1, 2, 3], "amount": [0.5, float("inf"), float("nan")]}), source)
    result = run_preflight(source, tmp_path / "prepared")
    assert pq.read_table(result.working_path)["amount"].to_pylist() == [0.5, float("inf"), None]
    assert result.source_snapshot["sample"][1]["amount"] == "Infinity"
    assert (
        next(issue for issue in result.issues if issue["code"] == "possible_outliers")["count"] == 1
    )
    assert (
        next(item for item in result.inferred_schema["columns"] if item["name"] == "amount")[
            "missing"
        ]
        == 1
    )


def test_checks_footer_size_before_metadata_decode(tmp_path: Path, monkeypatch):
    source = tmp_path / "broken.parquet"
    source.write_bytes(b"PAR1" + (2**30).to_bytes(4, "little") + b"PAR1")
    monkeypatch.setattr(
        pq, "ParquetFile", lambda *args, **kwargs: pytest.fail("Reject footer first")
    )
    with pytest.raises(ValueError, match="结构信息"):
        run_preflight(source, tmp_path / "prepared")
    assert not list((tmp_path / "prepared").iterdir())
