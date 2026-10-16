"""Focused JSON Lines admission, record boundaries, and actual project workflow."""

from decimal import Decimal
from pathlib import Path
from uuid import UUID

import pyarrow.parquet as pq
import pytest
from sqlalchemy import select

from app.core.config import settings
from app.db.tables import PreflightReportRecord, ProjectDataSource
from app.services import json_preflight
from app.services.data_preflight import PreflightInputError, fingerprint_file, run_preflight
from app.services.file_formats import JSON_FILE_FORMATS, SUPPORTED_FILE_FORMATS
from app.services.file_query import query_project_file_rows
from app.services.semantic_source_scope import SemanticSourceCatalog


def test_json_lines_accepts_crlf_last_record_and_scalar_rows_without_numeric_narrowing(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(json_preflight, "_BATCH_ROWS", 1)
    payload = (
        '{"id":"001","amount":9007199254740993.0123,"note":"一\\n二"}\r\n'
        '{"id":"002","amount":2.0000,"late":true}'
    ).encode()
    for suffix in ["JSONL", "ndjson"]:
        source = tmp_path / f"orders.{suffix}"
        source.write_bytes(payload)
        result = run_preflight(source, tmp_path / suffix)
        output = pq.read_table(result.working_path)
        assert output["id"].to_pylist() == ["001", "002"]
        assert output["amount"].to_pylist() == [Decimal("9007199254740993.0123"), Decimal("2.0000")]
        assert output["note"].to_pylist() == ["一\n二", None]
        assert output["late"].to_pylist() == [None, True]
        assert result.source_snapshot["reader"]["layout"] == "json_lines"
        assert result.source_snapshot["reader"]["batch_rows"] == 1
        assert source.read_bytes() == payload
    source = tmp_path / "arrays.jsonl"
    source.write_text('["001",1.25]\n["002",2.50]\n')
    result = run_preflight(source, tmp_path / "arrays")
    assert pq.read_table(result.working_path).to_pydict() == {
        "column_1": ["001", "002"],
        "column_2": [Decimal("1.25"), Decimal("2.50")],
    }


def test_json_lines_refuses_bad_record_boundaries_and_reports_the_physical_line(
    tmp_path, monkeypatch
):
    source = tmp_path / "bad.ndjson"
    output = tmp_path / "prepared"
    output.mkdir()
    trusted = output / "analysis-ready.parquet"
    trusted.write_bytes(b"trusted")
    for bad_line in [
        b"\n",
        b" \t\r\n",
        b'{"id":2}{"id":3}\n',
        b'{"id":\n2}\n',
        b'{"id":2}\r{"id":3}',
        b'\xef\xbb\xbf{"id":2}\n',
        b'{"id":2,"id":3}\n',
        b'{"id":[2]}\n',
        b"42\n",
        b'{"id":"\xff"}\n',
        b'{"id":',
        b'{"id":' + b"9" * 10_000 + b"}\n",
    ]:
        source.write_bytes(b'{"id":1}\n' + bad_line)
        with pytest.raises(PreflightInputError) as caught:
            run_preflight(source, output)
        assert caught.value.presentation_facts["line"] == 2
        assert trusted.read_bytes() == b"trusted"
        assert list(output.iterdir()) == [trusted]
    monkeypatch.setattr(json_preflight, "_MAX_LINE_BYTES", 16)
    source.write_bytes(b'{"id":1}\n{"id":"' + b"x" * 100 + b'"}\n')
    with pytest.raises(PreflightInputError) as caught:
        run_preflight(source, output)
    assert caught.value.presentation_code == "json_size_limit"
    assert caught.value.presentation_facts["line"] == 2
    assert trusted.read_bytes() == b"trusted"


@pytest.mark.asyncio
async def test_upload_prepare_query_and_failure_receipt_keep_json_lines_in_the_json_family(
    client, db_session, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "WORKSPACE_ROOT", tmp_path / "workspace")
    created = await client.post("/api/v1/projects", json={"name": "逐行销售明细"})
    project_id = created.json()["data"]["id"]
    for suffix in ["JSONL", "ndjson"]:
        uploaded = await client.post(
            f"/api/v1/projects/{project_id}/sources/files",
            files={
                "file": (
                    f"orders.{suffix}",
                    b'{"id":"001","amount":9007199254740993.01}\n',
                    "application/x-ndjson",
                ),
            },
        )
        assert uploaded.status_code == 200, uploaded.text
        data = uploaded.json()["data"]
        assert data["format"] == suffix.lower()
        source_id = data["id"]
        source = await db_session.get(ProjectDataSource, UUID(source_id))
        assert source.status == "attached" and source.working_uri is None
        assert Path(source.source_uri).suffix == "." + suffix
        prepared = await client.post(f"/api/v1/projects/{project_id}/sources/{source_id}/preflight")
        assert prepared.status_code == 200, prepared.text
        await db_session.refresh(source)
        assert Path(source.working_uri).suffix == ".parquet"
        rows, truncated, names = query_project_file_rows(
            [
                {"kind": "file", "working_uri": source.working_uri, "view_name": "orders"},
            ],
            'SELECT * FROM "orders"',
            tmp_path / suffix,
        )
        assert rows == [{"id": "001", "amount": "9007199254740993.01"}]
        assert not truncated and names == ["orders"]
        catalog = SemanticSourceCatalog.from_rows([(source, None)])
        assert catalog.by_id(source_id).scope == "json"
        assert fingerprint_file(Path(source.source_uri)) == source.fingerprint
        with pytest.raises(ValueError, match="重新整理逐行 JSON"):
            query_project_file_rows(
                [
                    {"kind": "file", "working_uri": source.source_uri, "view_name": "orders"},
                ],
                'SELECT * FROM "orders"',
                tmp_path / suffix,
            )
    assert {"json", "jsonl", "ndjson"} == JSON_FILE_FORMATS <= SUPPORTED_FILE_FORMATS
    failed = await client.post(
        f"/api/v1/projects/{project_id}/sources/files",
        files={
            "file": ("broken.jsonl", b'{"id":1}\n\n{"id":2}\n', "application/jsonl"),
        },
    )
    failed_id = failed.json()["data"]["id"]
    response = await client.post(f"/api/v1/projects/{project_id}/sources/{failed_id}/preflight")
    assert response.status_code == 409
    report = (
        await db_session.execute(
            select(PreflightReportRecord).where(
                PreflightReportRecord.data_source_id == UUID(failed_id),
            )
        )
    ).scalar_one()
    assert report.issues[0]["presentation_code"] == "json_lines_invalid"
    assert report.issues[0]["presentation_facts"]["line"] == 2
    failed_source = await db_session.get(ProjectDataSource, UUID(failed_id))
    assert failed_source.status == "error" and failed_source.working_uri is None
