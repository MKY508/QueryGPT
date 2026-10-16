"""Focused contracts for bounded, exact visual-cleaning impact summaries."""

import asyncio
from decimal import Decimal
from pathlib import Path
from threading import Event

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from app.api.v1 import projects as projects_api
from app.models.workspace import SourceCleaningColumnImpact
from app.services.cleaning_profiles import ColumnImpact
from app.services.working_copy_comparison import compare_working_copies


def test_impact_keeps_decimal_integer_and_nanosecond_ranges(tmp_path: Path) -> None:
    values = {
        "amount": pa.array(
            [Decimal("9007199254740993.01"), Decimal("0.00"), None], pa.decimal128(22, 2)
        ),
        "id": pa.array([9007199254740993, 9007199254740994, None], pa.int64()),
        "time": pa.array([1788652800000000001, 1788652800000000002, None], pa.timestamp("ns")),
    }
    before, after = tmp_path / "before.parquet", tmp_path / "after.parquet"
    table = pa.table(values)
    pq.write_table(table, before, row_group_size=1)
    pq.write_table(table, after, row_group_size=2)
    result = compare_working_copies(before, after)
    assert result["comparison_basis"] == "position"
    assert all(change["changed_count"] == 0 for change in result["changes"])
    profiles = {impact["column"]: impact["before"] for impact in result["profiles"]}
    assert profiles["amount"]["minimum"] == "0.00"
    assert profiles["amount"]["maximum"] == "9007199254740993.01"
    assert profiles["id"]["maximum"] == "9007199254740994"
    assert profiles["time"]["minimum"].endswith("000000001")
    assert profiles["time"]["maximum"].endswith("000000002")
    for name, array in values.items():
        # Extremes must also merge exactly across separate update calls.
        accumulator = ColumnImpact(array.type)
        for offset in range(len(array)):
            accumulator.update(array.slice(offset, 1))
        assert accumulator.finish() == profiles[name]
    for impact in result["profiles"]:
        assert SourceCleaningColumnImpact.model_validate(impact).model_dump() == impact


def test_shape_changes_still_profile_null_blank_zero_and_non_finite(tmp_path: Path) -> None:
    before, after = tmp_path / "before.parquet", tmp_path / "after.parquet"
    table = pa.table(
        {
            "text": [None, "", "  \t", "x" * 257, "x" * 258],
            "amount": [float("nan"), float("inf"), float("-inf"), None, 0.0],
            "flag": [False, False, True, None, True],
            "nested": [[1], [], None, [2], [3]],
        }
    )
    pq.write_table(table, before)
    pq.write_table(table.slice(0, 4).drop(["nested"]), after)
    result = compare_working_copies(before, after)
    assert result["comparison_basis"] == "unavailable"
    assert result["changes"] == []
    profiles = {impact["column"]: impact for impact in result["profiles"]}
    text = profiles["text"]["before"]
    assert (text["null_count"], text["blank_count"], text["omitted_long_values"]) == (1, 2, 2)
    assert text["top_values"] == [{"value": "", "count": 1}, {"value": "  \t", "count": 1}]
    amount = profiles["amount"]["before"]
    assert (amount["null_count"], amount["non_finite_count"], amount["zero_count"]) == (1, 3, 1)
    assert amount["minimum"] == amount["maximum"] == 0
    assert amount["top_values"] == [{"value": 0.0, "count": 1}]
    assert profiles["amount"]["after"]["minimum"] is None
    assert profiles["flag"]["before"]["zero_count"] is None
    assert profiles["nested"]["before"]["null_count"] == 1
    assert profiles["nested"]["before"]["sample_rows"] == 0
    assert profiles["nested"]["after"] is None
    for impact in result["profiles"]:
        assert SourceCleaningColumnImpact.model_validate(impact).model_dump() == impact


def test_frequency_and_column_caps_do_not_truncate_full_counters(tmp_path: Path) -> None:
    before, after = tmp_path / "before.parquet", tmp_path / "after.parquet"
    table = pa.table({f"value_{index}": [0] * 1000 + [9] * 100 + [None] for index in range(14)})
    pq.write_table(table, before)
    pq.write_table(table, after)
    defaults = compare_working_copies(before, after)
    assert len(defaults["profiles"]) == 12
    assert defaults["profiles_omitted"] == 2
    requested = compare_working_copies(before, after, profile_columns=["value_13", "value_13"])
    assert len(requested["profiles"]) == 1
    profile = requested["profiles"][0]["before"]
    assert profile["rows"] == 1101
    assert profile["sample_rows"] == 1000
    assert profile["top_values"] == [{"value": 0, "count": 1000}]
    assert (profile["null_count"], profile["zero_count"], profile["maximum"]) == (1, 1000, 9)
    empty = ColumnImpact(pa.int64()).finish()
    assert empty["rows"] == empty["null_count"] == 0 and empty["minimum"] is None
    dictionary = ColumnImpact(pa.dictionary(pa.int32(), pa.string()))
    dictionary.update(pa.array(["", "a", None]).dictionary_encode())
    assert dictionary.finish()["blank_count"] == 1


@pytest.mark.asyncio
async def test_comparison_cancellation_drains_worker_before_propagating(
    monkeypatch, tmp_path: Path
) -> None:
    entered, release, finished = Event(), Event(), Event()
    observed = {}

    def compare(*args, cancelled, **kwargs):
        observed["cancelled"] = cancelled
        entered.set()
        try:
            assert release.wait(2)
            assert cancelled.is_set()
            return {}
        finally:
            finished.set()

    monkeypatch.setattr(projects_api, "compare_working_copies", compare)
    task = asyncio.create_task(
        projects_api._compare_cleaning_in_thread(
            tmp_path / "a.parquet",
            tmp_path / "b.parquet",
            profile_columns=[],
        )
    )
    try:
        assert await asyncio.to_thread(entered.wait, 2)
        task.cancel()
        assert await asyncio.to_thread(observed["cancelled"].wait, 2)
        assert not task.done() and not finished.is_set()
        task.cancel()  # A second cancellation still must not skip draining.
    finally:
        release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert finished.is_set()
    with pytest.raises(InterruptedError):
        compare_working_copies(
            tmp_path / "a.parquet", tmp_path / "b.parquet", cancelled=observed["cancelled"]
        )
