"""Focused checks for cleaning previews and independent semantic probes."""

import json
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from app.services import semantic_validation as validation
from app.services.data_preflight import compare_working_copies
from app.services.result_values import arrow_result_rows


@pytest.mark.asyncio
async def test_relationship_probe_does_not_merge_distinct_nanosecond_keys(tmp_path, monkeypatch):
    sources = {}
    for name, values in {"left": [123456789, 123456790], "right": [123456789]}.items():
        path = tmp_path / f"{name}.parquet"
        pq.write_table(pa.table({"clock": pa.array(values, type=pa.time64("ns"))}), path)
        sources[name] = SimpleNamespace(kind="file", working_uri=str(path))

    async def endpoint(_db, _project_id, definition):
        return sources[definition["side"]], None

    monkeypatch.setattr(validation, "_resolve_relationship_endpoint", endpoint)
    with pytest.raises(validation._BlockedValidation) as error:
        await validation._validate_relationship(
            None,
            uuid4(),
            {
                "left": {"column": "clock", "side": "left"},
                "right": {"column": "clock", "side": "right"},
                "normalization": "exact",
                "cardinality": "many_to_one",
                "minimum_left_match_rate": 0.8,
                "maximum_expansion_ratio": 1.2,
            },
        )
    assert error.value.code == "relationship_threshold_not_met"
    assert error.value.facts["matched_left_rows"] == 1
    assert error.value.facts["left_match_rate"] == 0.5


def test_comparison_keeps_nanosecond_and_decimal_values_before_any_sql_conversion(tmp_path):
    epoch = 1788220800123456789
    exact = "9" * 44 + ".1234"
    before = pa.table(
        {
            "id": pa.array([18446744073709551615] * 3, type=pa.uint64()),
            "amount": pa.array([Decimal(exact)] * 3, type=pa.decimal256(50, 4)),
            "clock": pa.array([123456789] * 3, type=pa.time64("ns")),
            "time": pa.array([epoch] * 3, type=pa.timestamp("ns", tz="UTC")),
            "group": pa.array(
                [{"clock": 123456789}, None, {"clock": 123456789}],
                type=pa.struct([("clock", pa.time64("ns"))]),
            ),
        }
    )
    after = before.set_column(
        1,
        before.schema.field(1),
        pa.array(
            [Decimal(exact), Decimal("9" * 44 + ".1235"), Decimal(exact)], type=pa.decimal256(50, 4)
        ),
    )
    after = after.set_column(
        2, before.schema.field(2), pa.array([123456789, 123456790, 123456789], type=pa.time64("ns"))
    )
    after = after.set_column(
        3,
        before.schema.field(3),
        pa.array([epoch, epoch + 1, epoch], type=pa.timestamp("ns", tz="UTC")),
    )
    first, second = tmp_path / "before.parquet", tmp_path / "after.parquet"
    pq.write_table(before, first, row_group_size=1)
    pq.write_table(after, second, row_group_size=2)
    result = compare_working_copies(first, second)
    assert result["changes"] == [
        {"column": "id", "changed_count": 0},
        {"column": "amount", "changed_count": 1},
        {"column": "clock", "changed_count": 1},
        {"column": "time", "changed_count": 1},
        {"column": "group", "changed_count": 0},
    ]
    sample = result["before"]["sample"][0]
    assert sample["id"] == "18446744073709551615" and sample["amount"] == exact
    assert sample["clock"] == sample["group"]["clock"] == "00:00:00.123456789"
    assert sample["time"].endswith("123456789Z")
    assert result["after"]["sample"][1]["time"].endswith("123456790Z")
    json.dumps(result, allow_nan=False)


def test_comparison_counts_late_columns_and_type_conversions_without_coercion(tmp_path):
    before = pa.table({f"field{index}": [index, None] for index in range(210)})
    after = before.set_column(205, "field205", pa.array([999, None]))
    after = after.set_column(0, "field0", pa.array(["0", None]))
    first, second = tmp_path / "before.parquet", tmp_path / "after.parquet"
    pq.write_table(before, first)
    pq.write_table(after, second)
    changes = compare_working_copies(first, second)["changes"]
    assert len(changes) == 210
    assert [
        (item["column"], item["changed_count"]) for item in changes if item["changed_count"]
    ] == [("field0", 1), ("field205", 1)]


def test_nested_arrow_result_slices_keep_time_precision_and_container_nulls():
    clock = pa.time64("ns")
    table = pa.table(
        {
            "list": pa.array([[123456789], None, [123456790, None]], type=pa.list_(clock)),
            "fixed": pa.array([[123456789], None, [123456790]], type=pa.list_(clock, 1)),
            "map": pa.array(
                [[("at", 123456789)], None, [("at", 123456790)]], type=pa.map_(pa.string(), clock)
            ),
        }
    )
    rows = arrow_result_rows(table.to_batches()[0].slice(1, 2))
    assert rows == [
        {"list": None, "fixed": None, "map": None},
        {
            "list": ["00:00:00.123456790", None],
            "fixed": ["00:00:00.123456790"],
            "map": [["at", "00:00:00.123456790"]],
        },
    ]


@pytest.mark.asyncio
async def test_semantic_file_probe_uses_shared_precision_bridge_and_closes_external_access(
    tmp_path,
):
    path = tmp_path / "sales'quoted.parquet"
    pq.write_table(
        pa.table(
            {
                "amount": pa.array(
                    [Decimal("9007199254740993.0123"), Decimal("0.0001")], type=pa.decimal128(38, 4)
                ),
                "clock": pa.array([123456789, 123456790], type=pa.time64("ns")),
            }
        ),
        path,
    )
    source = SimpleNamespace(kind="file", working_uri=str(path))
    stats = await validation._execute_source_query(
        source,
        None,
        sql_builder=lambda quote, relation: (
            f"SELECT SUM({quote('amount')}) AS amount, COUNT(DISTINCT {quote('clock')}) AS clocks, MIN({quote('clock')}) AS first FROM {relation}"
        ),
    )
    assert stats == {"amount": "9007199254740993.0124", "clocks": 2, "first": "00:00:00.123456789"}
    assert validation._json_value(Decimal("9007199254740993.0123")) == "9007199254740993.0123"
    assert validation._json_value(0.00000000123) == 0.00000000123
    with pytest.raises(duckdb.Error, match="disabled|Permission"):
        validation._run_duckdb_query(
            "SELECT * FROM read_parquet('unapproved.parquet')", 5, {"approved": str(path)}
        )


@pytest.mark.parametrize(
    "dtype,value",
    [
        (pa.timestamp("ns", tz="UTC"), 1788220800123456789),
        (pa.decimal256(50, 4), Decimal("9" * 44 + ".1234")),
    ],
)
def test_semantic_probe_does_not_verify_a_source_with_unsupported_precision(tmp_path, dtype, value):
    path = tmp_path / "precise.parquet"
    pq.write_table(pa.table({"precise": pa.array([value], type=dtype)}), path)
    with pytest.raises(validation._BlockedValidation) as error:
        validation._run_duckdb_query(
            'SELECT COUNT(*) AS total FROM "source"', 5, {"source": str(path)}
        )
    assert error.value.code == "semantic_file_precision_unsupported"
    assert error.value.facts == {"columns": ["precise"]}


@pytest.mark.asyncio
async def test_nonfinite_semantic_aggregates_stay_unverified(monkeypatch):
    async def binding(*_args):
        return SimpleNamespace(id="one-source"), None

    async def execute(*_args, **_kwargs):
        return {
            "total_rows": 2,
            "non_null_rows": 2,
            "computed_rows": 2,
            "source_nulls": 0,
            "aggregate_value": "Infinity",
        }

    monkeypatch.setattr(validation, "_resolve_binding", binding)
    monkeypatch.setattr(validation, "_execute_source_query", execute)
    source = {
        "canonical_type": "number",
        "action_column": "amount",
        "table_or_view": "source",
        "schema_signature": "schema",
    }
    with pytest.raises(validation._BlockedValidation, match="非有限"):
        await validation._validate_aggregate_metric(
            None, uuid4(), {"source": source, "operation": "sum"}
        )
    with pytest.raises(validation._BlockedValidation, match="非有限"):
        await validation._validate_derived_metric(
            None,
            uuid4(),
            {
                "sources": [source],
                "aggregate": "sum",
                "formula": {
                    "kind": "metric_formula",
                    "output_column": "total",
                    "evaluation_order": "row_then_aggregate",
                    "expression": {"op": "column", "name": "amount"},
                    "null_policy": "propagate",
                    "divide_by_zero": "error",
                },
            },
        )
