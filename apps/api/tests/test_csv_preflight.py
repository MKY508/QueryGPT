"""Focused CSV streaming checks; all files and databases are disposable fixtures."""

import csv
from io import StringIO
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq
import pytest

from app.services import csv_preflight, tabular_preflight
from app.services.csv_preview import preview_csv
from app.services.data_preflight import fingerprint_file, run_preflight
from app.services.file_preview import PREVIEW_CELL_CHARACTERS


@pytest.mark.parametrize("delimiter,encoding", [(",", "utf-8-sig"), (";", "gb18030")])
def test_long_cells_preview_bounded_but_prepare_and_replay_in_full(
    tmp_path: Path, delimiter: str, encoding: str
):
    # Past both the old 128 Ki-character field ceiling and the initial probe.
    note = '备注明细,"货物";费用\r\n' * 12_000 + "末尾保留"
    rows = [
        ["order_id", "amount", "note"],
        *[[f"{index:04d}", str(index), "普通备注"] for index in range(1, 13)],
        ["0013", "13", note],
    ]
    content = StringIO(newline="")
    csv.writer(content, delimiter=delimiter).writerows(rows)
    source = tmp_path / "long-notes.csv"
    source.write_bytes(content.getvalue().encode(encoding))
    before = fingerprint_file(source)

    sample = preview_csv(source, delimiter, encoding, start_row=14)
    assert sample["rows"] == [["0013", "13", note[:PREVIEW_CELL_CHARACTERS] + "…"]]
    assert sample["truncated_cells"] and not sample["has_more_rows"]
    steps = [
        {"operation": "read_csv", "encoding": encoding, "delimiter": delimiter},
        {"operation": "select_header", "row": 1},
    ]
    prepared = run_preflight(source, tmp_path / "prepared", steps)
    replayed = run_preflight(source, tmp_path / "replayed", prepared.operations)
    for result in (prepared, replayed):
        actual = pq.read_table(result.working_path).to_pylist()
        assert len(actual) == 13
        assert actual[-1] == {"order_id": "0013", "amount": 13, "note": note}
        assert list(result.working_path.parent.iterdir()) == [result.working_path]
    assert fingerprint_file(source) == before


@pytest.mark.parametrize("ending", ["\n", "\r\n"])
def test_csv_record_character_boundary_includes_quotes_and_resets_per_record(
    tmp_path: Path, ending: str
):
    value = "备" * (csv_preflight._RECORD_CHARACTERS - len('001,""' + ending))
    record = f'001,"{value}"{ending}'
    assert len(record) == csv_preflight._RECORD_CHARACTERS
    source = tmp_path / "boundary.csv"
    source.write_bytes((record * 2).encode("utf-8"))
    assert list(csv_preflight._records(source, "utf-8-sig")) == [["001", value]] * 2


@pytest.mark.parametrize("multiline", [False, True])
def test_oversized_csv_records_still_fail_without_replacing_previous_copy(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, multiline: bool
):
    monkeypatch.setattr(csv_preflight, "_BATCH_ROWS", 2)
    value = ("备注" * 1000 + "\n") * 525 if multiline else "x" * csv_preflight._RECORD_CHARACTERS
    source = tmp_path / "oversized.csv"
    source.write_text("order_id,note\n" + "001,正常\n" * 20 + f'002,"{value}"\n', encoding="utf-8")
    before = fingerprint_file(source)
    output = tmp_path / "prepared"
    output.mkdir()
    previous = output / "analysis-ready.parquet"
    previous.write_bytes(b"previous trusted copy")
    with pytest.raises(ValueError, match="过长的记录"):
        run_preflight(source, output)
    with pytest.raises(ValueError, match="过长的记录"):
        preview_csv(source, start_row=22)
    assert previous.read_bytes() == b"previous trusted copy"
    assert list(output.iterdir()) == [previous]
    assert fingerprint_file(source) == before


def test_streams_batches_with_exact_cross_batch_deduplication_and_identifier_text(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(csv_preflight, "_BATCH_ROWS", 2)
    monkeypatch.setattr(
        pd,
        "read_csv",
        lambda *args, **kwargs: pytest.fail("CSV must not materialize a pandas frame"),
    )
    source = tmp_path / "orders.csv"
    source.write_text(
        "\ufefforder_id,amount,date,refund_status,note\n"
        '0001,"¥1,200",2026/09/01,no,"第一行\n第二行"\n'
        "1,20,2026-09-02,yes,退货\n"
        "NA,30,2026-09-03,no,保留编号\n"
        ",,,,\n"
        "合计,1250,,,\n"
        '0001,"¥1,200",2026/09/01,no,"第一行\n第二行"\n',
        encoding="utf-8",
    )
    before = fingerprint_file(source)
    result = run_preflight(source, tmp_path / "prepared")
    rows = pq.read_table(result.working_path).to_pylist()
    assert [row["order_id"] for row in rows] == ["0001", "1", "NA"]
    assert [row["amount"] for row in rows] == [1200, 20, 30]
    assert rows[0]["note"] == "第一行\n第二行"
    counts = {issue["code"]: issue["count"] for issue in result.issues}
    assert counts["duplicate_rows"] == counts["empty_regions"] == counts["summary_rows"] == 1
    assert result.source_snapshot["original_rows"] == 6
    assert result.source_snapshot["reader"]["engine"] == "csv_stream_v1"
    assert result.inferred_schema["rows"] == 3
    assert result.status == "needs_confirmation"
    assert result.ambiguities[0]["option_strategies"]["扣除退款"]["action"]["values"] == ["yes"]
    assert fingerprint_file(source) == before
    assert fingerprint_file(result.working_path) == result.output_fingerprint
    assert list((tmp_path / "prepared").iterdir()) == [result.working_path]


def test_uses_whole_column_thresholds_and_replays_dates_and_missing_values(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(csv_preflight, "_BATCH_ROWS", 2)
    source = tmp_path / "mixed.csv"
    records = [
        f"{index:04d},{'¥10' if index < 16 else 'unknown'},"
        f"{'2026-09-01' if index < 16 else 'not a date'},"
        f"{'' if index == 0 else '  north  '}"
        for index in range(20)
    ]
    source.write_text("order_id,amount,date,region\n" + "\n".join(records), encoding="utf-8")
    result = run_preflight(
        source,
        tmp_path / "prepared",
        [
            {"operation": "normalize_currency", "column": "amount"},
            {"operation": "normalize_datetime", "column": "date"},
            {"operation": "fill_missing", "column": "region", "value": "unknown"},
        ],
    )
    rows = pq.read_table(result.working_path).to_pylist()
    assert result.status == "needs_confirmation"
    assert rows[0]["amount"] == "¥10"  # 80% is below the full-column money threshold.
    assert rows[-1]["amount"] == "unknown"
    assert rows[0]["date"].year == 2026
    assert rows[-1]["date"] is None
    assert rows[0]["region"] == "unknown"
    assert rows[1]["region"] == "north"
    assert "amount" in result.source_snapshot["recipe_replay"]["drift"][0]
    assert (
        next(issue for issue in result.issues if issue["code"] == "invalid_date_values")["count"]
        == 4
    )


def test_checks_late_gb18030_bytes_and_variable_width_preamble(tmp_path: Path):
    source = tmp_path / "encoding.csv"
    source.write_bytes(
        (
            "Sales report\n\norder_id,amount,note\n"
            + "\n".join(
                f"{index:04d},10,{'中文' if index == 19 else 'plain'}" for index in range(20)
            )
        ).encode("gb18030")
    )
    result = run_preflight(source, tmp_path / "prepared")
    assert result.source_snapshot["reader"]["encoding"] == "gb18030"
    assert result.inferred_schema["rows"] == 20
    assert (
        next(step for step in result.operations if step["operation"] == "select_header")["row"] == 2
    )
    assert pq.read_table(result.working_path).to_pylist()[-1]["note"] == "中文"


@pytest.mark.parametrize("bad_row", ["1,2,3\n", '1,"unterminated\n'])
def test_rejects_late_malformed_rows_without_replacing_a_previous_copy(
    tmp_path: Path, bad_row: str
):
    source = tmp_path / "broken.csv"
    source.write_text("order_id,amount\n" + "1,10\n" * 20 + bad_row, encoding="utf-8")
    output = tmp_path / "prepared"
    output.mkdir()
    previous = output / "analysis-ready.parquet"
    previous.write_bytes(b"previous trusted copy")
    with pytest.raises(ValueError, match="CSV"):
        run_preflight(source, output)
    assert previous.read_bytes() == b"previous trusted copy"
    assert list(output.iterdir()) == [previous]


def test_quotes_column_names_and_fill_values_and_keeps_normalized_names_unique(tmp_path: Path):
    source = tmp_path / "names.csv"
    source.write_text('id,"region""name",A,a,A_2\n001,,x,y,z\n002,west,q,r,s\n', encoding="utf-8")
    fill = "x'); DROP TABLE prepared; --"
    result = run_preflight(
        source,
        tmp_path / "prepared",
        [
            {"operation": "fill_missing", "column": 'region"name', "value": fill},
        ],
    )
    table = pq.read_table(result.working_path)
    assert len(table.column_names) == len({name.casefold() for name in table.column_names})
    assert table.to_pylist()[0]['region"name'] == fill
    assert table.to_pylist()[0]["id"] == "001"


def test_never_builds_a_refund_strategy_from_a_truncated_marker_list(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(tabular_preflight, "_MAX_REFUND_VALUES", 2)
    source = tmp_path / "refunds.csv"
    source.write_text(
        "order_id,amount,refund_status\n001,10,no\n002,20,yes\n003,30,refunded\n", encoding="utf-8"
    )
    result = run_preflight(source, tmp_path / "prepared")
    assert result.ambiguities == []
    assert result.source_snapshot["reader"]["refund_values_complete"] is False
    assert any(issue["code"] == "refund_values_review" for issue in result.issues)


def test_refuses_to_publish_if_the_original_changes_during_preparation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    source = tmp_path / "changing.csv"
    source.write_text("order_id,amount\n001,10\n", encoding="utf-8")
    original_profile = tabular_preflight._profile

    def profile_then_modify(*args, **kwargs):
        profile = original_profile(*args, **kwargs)
        source.write_text("order_id,amount\n001,999\n", encoding="utf-8")
        return profile

    monkeypatch.setattr(tabular_preflight, "_profile", profile_then_modify)
    with pytest.raises(ValueError, match="文件发生变化"):
        run_preflight(source, tmp_path / "prepared")
    assert not list((tmp_path / "prepared").iterdir())


def test_keeps_large_integer_text_and_recognizes_booleans_and_compact_dates(tmp_path: Path):
    source = tmp_path / "types.csv"
    source.write_text(
        "token,active,date,payment_id,date_key,payment_date\n"
        "184467440737095516160,true,20260901,0000123,20260901,20260901\n"
        "184467440737095516161,false,20260902,0000124,20260902,20260902\n",
        encoding="utf-8",
    )
    result = run_preflight(source, tmp_path / "prepared")
    rows = pq.read_table(result.working_path).to_pylist()
    assert rows[0]["token"] == "184467440737095516160"
    assert rows[1]["token"] == "184467440737095516161"
    assert rows[0]["active"] is True and rows[1]["active"] is False
    assert rows[0]["date"].strftime("%Y-%m-%d") == "2026-09-01"
    assert rows[0]["payment_id"] == "0000123"
    assert rows[0]["date_key"] == "20260901"
    assert rows[0]["payment_date"].strftime("%Y-%m-%d") == "2026-09-01"


def test_preserves_large_currency_integers_and_refuses_lossy_mixed_columns(tmp_path: Path):
    source = tmp_path / "money.csv"
    source.write_text(
        "order_id,amount,revenue,value\n"
        "001,¥9007199254740993,¥184467440737095516160,9007199254740993\n"
        "002,¥9007199254740994,¥10.5,10.5\n",
        encoding="utf-8",
    )
    result = run_preflight(
        source,
        tmp_path / "prepared",
        [
            {"operation": "normalize_currency", "column": "revenue"},
        ],
    )
    rows = pq.read_table(result.working_path).to_pylist()
    assert rows[0]["amount"] == 9007199254740993
    assert rows[1]["amount"] == 9007199254740994
    assert rows[0]["revenue"] == "¥184467440737095516160"
    assert rows[0]["value"] == "9007199254740993"
    assert result.status == "needs_confirmation"
    assert any(issue["code"] == "numeric_precision_review" for issue in result.issues)
    assert "长整数" in result.source_snapshot["recipe_replay"]["drift"][0]


def test_extreme_finite_values_do_not_abort_outlier_profiling(tmp_path: Path):
    source = tmp_path / "extremes.csv"
    source.write_text(
        "order_id,value\n"
        + "\n".join(f"{index:03d},{'-' if index < 4 else ''}1e308" for index in range(8)),
        encoding="utf-8",
    )
    result = run_preflight(source, tmp_path / "prepared")
    rows = pq.read_table(result.working_path).to_pylist()
    assert len(rows) == 8
    assert rows[0]["value"] == -1e308
    assert rows[-1]["value"] == 1e308


def test_production_batch_limits_keep_twelve_thousand_rows_exact(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    source = tmp_path / "larger.csv"
    with source.open("w", encoding="utf-8") as handle:
        handle.write("order_id,amount,note\n")
        for index in range(12_000):
            handle.write(f"{index:06d},{index + 1},{'x' * 400}\n")
        handle.write(f"000000,1,{'x' * 400}\n")
    batch_rows = []
    original_writer = pq.ParquetWriter

    class RecordingWriter(original_writer):
        def write_batch(self, batch, *args, **kwargs):
            batch_rows.append(batch.num_rows)
            return super().write_batch(batch, *args, **kwargs)

    monkeypatch.setattr(pq, "ParquetWriter", RecordingWriter)
    monkeypatch.setattr(pd, "read_csv", lambda *args, **kwargs: pytest.fail("No full pandas read"))
    result = run_preflight(source, tmp_path / "prepared")
    assert len(batch_rows) >= 2
    assert sum(batch_rows) == 12_001
    assert max(batch_rows) <= csv_preflight._BATCH_ROWS
    assert result.inferred_schema["rows"] == 12_000
    assert result.inferred_schema["candidate_grain"][0]["unique"] == 12_000
    assert next(issue for issue in result.issues if issue["code"] == "duplicate_rows")["count"] == 1
    assert pq.read_metadata(result.working_path).num_rows == 12_000
