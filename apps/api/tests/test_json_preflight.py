"""Small synthetic fixtures; no live database, customer files or full JSON frame."""

import json
from decimal import Decimal
from io import BytesIO
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from app.services import json_preflight
from app.services.data_preflight import PreflightInputError, fingerprint_file, run_preflight
from app.services.sanitation_contract import executable_sanitation_operations


@pytest.mark.asyncio
async def test_json_visual_preview_and_confirmed_apply_use_exact_staged_values(
    client, db_session, tmp_path, monkeypatch
):
    from app.core.config import settings
    from app.db.tables import Project, ProjectDataSource

    monkeypatch.setattr(settings, "WORKSPACE_ROOT", tmp_path / "workspace")
    source_path = tmp_path / "orders.json"
    source_path.write_text('[{"id":"01","amount":9007199254740993.01},{"id":"02","amount":null}]')
    baseline = run_preflight(source_path, tmp_path / "trusted")
    project = Project(name="JSON preview")
    db_session.add(project)
    await db_session.flush()
    source = ProjectDataSource(
        project_id=project.id,
        kind="file",
        name="orders.json",
        format="json",
        source_uri=str(source_path),
        working_uri=str(baseline.working_path),
        status=baseline.status,
        fingerprint=baseline.input_fingerprint,
        profile_data={"is_current": True},
    )
    db_session.add(source)
    await db_session.commit()
    root = f"/api/v1/projects/{project.id}/sources/{source.id}/cleaning"
    operations = [{"operation": "fill_missing", "column": "amount", "value": 0}]
    response = await client.post(root + "/preview", json={"operations": operations})
    assert response.status_code == 200, response.text
    preview = response.json()["data"]
    assert preview["can_apply"] is True
    assert preview["after"]["sample"][0]["amount"] == "9007199254740993.01"
    assert preview["after"]["sample"][1]["amount"] == "0.00"
    assert source.working_uri == str(baseline.working_path)
    response = await client.post(
        root + "/apply",
        json={
            "operations": operations,
            **{
                "expected_" + key: preview[key]
                for key in [
                    "operations_hash",
                    "source_fingerprint",
                    "preview_output_fingerprint",
                    "current_working_fingerprint",
                    "current_recipe_active_revision_id",
                ]
            },
        },
    )
    assert response.status_code == 200, response.text
    await db_session.refresh(source)
    assert source.working_uri != str(baseline.working_path)
    assert pq.read_table(Path(source.working_uri))["amount"].to_pylist() == [
        Decimal("9007199254740993.01"),
        Decimal("0.00"),
    ]
    assert fingerprint_file(source_path) == baseline.input_fingerprint
    assert fingerprint_file(baseline.working_path) == baseline.output_fingerprint


def test_records_discover_late_fields_and_preserve_numbers_strings_and_typed_duplicates(
    tmp_path, monkeypatch
):
    source = tmp_path / "records.json"
    # Numeric 1 and string "1" remain separate even after a mixed column becomes
    # text. A genuine repeated row still disappears across staging batches.
    first = '{" record_id ":9007199254740993,"amount":9007199254740993.0123,"value":1,"code":"001","huge":1e400,"blank":null}'
    second = first.replace('"value":1', '"value":"1"')
    source.write_text(
        "[" + ",".join([first, second, first, '{" record_id ":2,"late":true}', "{}"]) + "]"
    )
    before = fingerprint_file(source)
    monkeypatch.setattr(pd, "read_json", lambda *a, **kw: pytest.fail("must not materialize JSON"))
    monkeypatch.setattr(json_preflight, "_BATCH_ROWS", 1)
    result = run_preflight(source, tmp_path / "prepared")
    output = pq.read_table(result.working_path)
    assert output.num_rows == 3
    assert output["record_id"].to_pylist() == [9007199254740993, 9007199254740993, 2]
    assert output["amount"].to_pylist() == [Decimal("9007199254740993.0123")] * 2 + [None]
    assert output.schema.field("amount").type == pa.decimal128(20, 4)
    assert output["value"].to_pylist() == ["1", "1", None]
    assert output["code"].to_pylist() == ["001", "001", None]
    assert output["huge"].to_pylist() == ["1E+400", "1E+400", None]
    assert output["late"].to_pylist() == [None, None, True]
    assert "blank" not in output.column_names
    assert not any(name.startswith("__receiptbi") for name in output.column_names)
    assert result.source_snapshot["sample"][0]["amount"] == "9007199254740993.0123"
    assert result.source_snapshot["reader"]["engine"] == "json_stream_v1"
    assert result.source_snapshot["reader"]["batch_rows"] == 1
    assert fingerprint_file(source) == before
    assert list((tmp_path / "prepared").iterdir()) == [result.working_path]
    assert any(
        step["operation"] == "normalize_column_names"
        for step in executable_sanitation_operations(result.operations)
    )


def test_columnar_indices_arrays_values_and_record_sequences_share_one_bounded_plane(tmp_path):
    cases = [
        ('{"code":["01","02"],"qty":[10,20]}', ["01", "02"], [10, 20]),
        ('{"code":{"b":"02","a":"01"},"qty":{"a":10,"c":30}}', ["02", "01", None], [None, 10, 30]),
        ('\ufeff{"code":"01","qty":10}\n{"code":"02","qty":20}', ["01", "02"], [10, 20]),
    ]
    for index, (content, codes, quantities) in enumerate(cases):
        source = tmp_path / f"layout-{index}.json"
        source.write_text(content, encoding="utf-8")
        result = run_preflight(source, tmp_path / f"output-{index}")
        output = pq.read_table(result.working_path)
        assert output["code"].to_pylist() == codes
        assert output["qty"].to_pylist() == quantities
    values = tmp_path / "values.json"
    values.write_text('[["01",10],["02",20]]')
    result = run_preflight(values, tmp_path / "values-output")
    assert pq.read_table(result.working_path).to_pydict() == {
        "column_1": ["01", "02"],
        "column_2": [10, 20],
    }


def test_literal_json_strings_require_explicit_conversion_and_native_fills_stay_exact(tmp_path):
    source = tmp_path / "literal.json"
    source.write_text(
        '[{"id":"01","amount":"1.2500000000000000001","event_time":"2026-09-05T00:00:00.123456789","price":0.10},{"id":"02","price":null}]'
    )
    baseline = run_preflight(source, tmp_path / "baseline")
    output = pq.read_table(baseline.working_path)
    assert output["amount"][0].as_py() == "1.2500000000000000001"
    assert output["event_time"][0].as_py().endswith("123456789")
    prepared = run_preflight(
        source,
        tmp_path / "filled",
        [
            {"operation": "fill_missing", "column": "price", "value": "0.20"},
            {"operation": "select_sheet", "sheet": "old"},
        ],
    )
    assert pq.read_table(prepared.working_path)["price"].to_pylist() == [
        Decimal("0.10"),
        Decimal("0.20"),
    ]
    assert prepared.source_snapshot["recipe_replay"]["drift"]
    with pytest.raises(ValueError, match="类型或精度"):
        run_preflight(
            source,
            tmp_path / "filled",
            [{"operation": "fill_missing", "column": "price", "value": "0.001"}],
        )
    assert fingerprint_file(prepared.working_path) == prepared.output_fingerprint


def test_invalid_structures_duplicate_keys_and_truncation_never_replace_a_trusted_copy(tmp_path):
    destination = tmp_path / "prepared"
    destination.mkdir()
    trusted = destination / "analysis-ready.parquet"
    trusted.write_bytes(b"previous analysis")
    invalid = [
        '[{"a":1,"a":2}]',
        '{"a":{"0":1,"0":2}}',
        '{"a":[1],"a":[2]}',
        '[{"a":{"nested":1}}]',
        '[{"a":[1,2]}]',
        '[{"a":1}',
        '[{"a":1}] trailing',
        '[{"a":NaN}]',
        '[{"a":01}]',
        "42",
        '{"a":[1],"b":{"0":2}}',
        '{"a":[1]} {"a":2}',
        '[{"a":1e9999999999999999999999999}]',
        '[{"a":' + "9" * 10_000 + "}]",
    ]
    source = tmp_path / "invalid.json"
    for content in invalid:
        source.write_text(content)
        with pytest.raises(PreflightInputError):
            run_preflight(source, destination)
        assert trusted.read_bytes() == b"previous analysis"
        assert list(destination.iterdir()) == [trusted]


def test_limits_reject_wide_long_and_oversized_staging_with_bounded_reads(tmp_path, monkeypatch):
    class Bounded(BytesIO):
        def read(self, size=-1):
            assert 0 <= size <= json_preflight._READ_BYTES
            return super().read(size)

    assert list(json_preflight._events(Bounded(b'[{"a":1}]')))[-1][0] == "end_array"
    source = tmp_path / "limits.json"
    destination = tmp_path / "prepared"
    for setting, limit, content in [
        ("_MAX_COLUMNS", 1, '[{"a":1,"b":2}]'),
        ("_MAX_TEXT_BYTES", 3, '[{"a":"long"}]'),
        ("_MAX_ROW_BYTES", 5, '[{"a":"one","b":"two"}]'),
        ("_MAX_STAGE_BYTES", 4096 * 4, json.dumps([{"a": "x" * 1000, "id": i} for i in range(20)])),
        ("_MAX_TOKEN_BYTES", 8, '[{"a":"' + "x" * 150_000 + '"}]'),
    ]:
        source.write_text(content)
        with monkeypatch.context() as scope:
            scope.setattr(json_preflight, setting, limit)
            with pytest.raises(PreflightInputError) as caught:
                run_preflight(source, destination)
            assert caught.value.presentation_code == "json_size_limit"
        assert list(destination.iterdir()) == []
