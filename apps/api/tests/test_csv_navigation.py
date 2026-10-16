"""Focused CSV navigation checks using only disposable files/databases."""

import csv
from io import StringIO
from pathlib import Path
from uuid import UUID, uuid4

import pyarrow.parquet as pq
import pytest
from sqlalchemy import func, select

from app.api.v1 import projects
from app.core.config import settings
from app.db.tables import PreflightReportRecord, ProjectDataSource
from app.services import csv_preview, workbook_preview
from app.services.data_preflight import fingerprint_file, run_preflight
from app.services.sanitation_contract import (
    SanitationContractError,
    canonicalize_sanitation_operations,
)


def contents(rows, delimiter=";", encoding="utf-8-sig"):
    text = StringIO(newline="")
    csv.writer(text, delimiter=delimiter).writerows(rows)
    return text.getvalue().encode(encoding)


def test_csv_preview_uses_selected_dialect_encoding_and_logical_record_numbers(
    tmp_path, monkeypatch
):
    path = tmp_path / "preview.csv"
    for delimiter, encoding in [
        (";", "utf-8-sig"),
        ("\t", "gb18030"),
        ("|", "utf-8-sig"),
        (",", "utf-8-sig"),
    ]:
        path.write_bytes(
            contents(
                [
                    ["城市", "说明"],
                    ["杭州", f"first{delimiter}part\nsecond part"],
                    *[[str(i), "x" * 400] for i in range(20)],
                ],
                delimiter,
                encoding,
            )
        )
        before = fingerprint_file(path)
        sample = csv_preview.preview_csv(path, delimiter)
        assert sample["encoding"] == encoding and sample["delimiter"] == delimiter
        assert sample["rows"][1] == ["杭州", f"first{delimiter}part\nsecond part"]
        assert len(sample["rows"]) == 12 and sample["has_more_rows"]
        assert sample["truncated_cells"] and len(sample["rows"][2][1]) == 251
        page = csv_preview.preview_csv(path, delimiter, encoding, 13)
        assert page["start_row"] == 13 and page["rows"][0][0] == "10"
        assert not page["has_more_rows"] and fingerprint_file(path) == before
    assert csv_preview._READERS is workbook_preview._READERS
    csv_preview._READERS.acquire()
    csv_preview._READERS.acquire()
    try:
        with pytest.raises(ValueError, match="busy"):
            csv_preview.preview_csv(path)
    finally:
        csv_preview._READERS.release()
        csv_preview._READERS.release()
    monkeypatch.setattr(settings, "FILE_UPLOAD_MAX_BYTES", 1)
    with pytest.raises(ValueError, match="too large"):
        csv_preview.preview_csv(path)


def test_csv_read_options_and_late_header_replay_keep_the_same_output_and_reject_drift(tmp_path):
    path = tmp_path / "orders.csv"
    rows = [
        ["报告\n说明"],
        *[[f"note {i}"] for i in range(12)],
        ["order_id", "amount"],
        ["001", 10],
        ["002", 20],
    ]
    path.write_bytes(contents(rows, "\t", "gb18030"))
    steps = [
        {"operation": "read_csv", "delimiter": "\t", "encoding": "gb18030"},
        {"operation": "select_header", "row": 14},
    ]
    result = run_preflight(path, tmp_path / "prepared", recipe_operations=steps)
    assert pq.read_table(result.working_path).to_pylist() == [
        {"order_id": "001", "amount": 10},
        {"order_id": "002", "amount": 20},
    ]
    assert result.source_snapshot["reader"]["header_row"] == 14
    assert result.source_snapshot["reader"]["delimiter"] == "\t"
    replay = run_preflight(path, tmp_path / "replay", recipe_operations=result.operations)
    assert pq.read_table(result.working_path).equals(pq.read_table(replay.working_path))
    trusted = result.working_path.read_bytes()
    path.write_bytes(contents([*rows, ["too", "many", "columns"]], "\t", "gb18030"))
    with pytest.raises(ValueError, match="列数"):
        run_preflight(path, tmp_path / "prepared", recipe_operations=result.operations)
    assert result.working_path.read_bytes() == trusted
    for bad in [
        [{"operation": "read_csv", "delimiter": "::", "encoding": "utf-8-sig"}],
        [{"operation": "read_csv", "delimiter": ",", "encoding": "unknown"}],
        [steps[0], steps[0]],
    ]:
        with pytest.raises(SanitationContractError):
            canonicalize_sanitation_operations(bad)
    with pytest.raises(ValueError, match="其他文件"):
        run_preflight(tmp_path / "absent.xlsx", tmp_path / "absent", recipe_operations=steps)
    assert not (tmp_path / "absent").exists()


async def upload(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "WORKSPACE_ROOT", tmp_path / "projects")
    project = (await client.post("/api/v1/projects", json={"name": "CSV navigation"})).json()[
        "data"
    ]
    uploaded = await client.post(
        f"/api/v1/projects/{project['id']}/sources/files",
        files={
            "file": ("orders.csv", contents([["order_id", "amount"], ["001", 10], ["002", 20]]))
        },
    )
    assert uploaded.status_code == 200, uploaded.text
    source = uploaded.json()["data"]
    return f"/api/v1/projects/{project['id']}/sources/{source['id']}", source


def selection(preview, **options):
    return {
        "kind": "csv",
        "delimiter": preview["delimiter"],
        "encoding": preview["encoding"],
        "source_revision": preview["source_revision"],
        "input_fingerprint": preview["input_fingerprint"],
        **options,
    }


@pytest.mark.asyncio
async def test_csv_api_is_read_only_until_explicit_preparation_and_publishes_the_selected_options(
    client, db_session, tmp_path, monkeypatch
):
    url, source_data = await upload(client, tmp_path, monkeypatch)
    preview = (await client.get(url + "/csv", params={"delimiter": ";"})).json()["data"]
    assert await db_session.scalar(select(func.count()).select_from(PreflightReportRecord)) == 0
    assert preview["rows"][0] == ["order_id", "amount"]
    for extra in [{"headerless": True, "header_row": 1}, {"sheet": "Orders"}, {"delimiter": "::"}]:
        assert (
            await client.post(url + "/preflight", json=selection(preview, **extra))
        ).status_code == 422

    async def unexpected_match(*args, **kwargs):
        pytest.fail("Explicit CSV options cannot guess a prior source method")

    monkeypatch.setattr(projects, "_matching_prior_source", unexpected_match)
    prepared = await client.post(url + "/preflight", json=selection(preview, header_row=1))
    assert prepared.status_code == 200, prepared.text
    source = await db_session.get(ProjectDataSource, UUID(source_data["id"]))
    await db_session.refresh(source)
    assert source.profile_data["csv_options"] == {"delimiter": ";", "encoding": "utf-8-sig"}
    assert source.profile_data["header_row"] == 1
    assert pq.read_table(source.working_uri).to_pylist() == [
        {"order_id": "001", "amount": 10},
        {"order_id": "002", "amount": 20},
    ]
    assert (await client.post(url + "/preflight", json=selection(preview))).status_code == 409
    assert (
        await client.get(url.replace(source_data["project_id"], str(uuid4())) + "/csv")
    ).status_code == 404


@pytest.mark.asyncio
async def test_csv_api_keeps_the_trusted_copy_after_file_changes_or_failed_preparation(
    client, db_session, tmp_path, monkeypatch
):
    url, source_data = await upload(client, tmp_path, monkeypatch)
    source = await db_session.get(ProjectDataSource, UUID(source_data["id"]))
    preview = (await client.get(url + "/csv", params={"delimiter": ";"})).json()["data"]
    assert (
        await client.post(url + "/preflight", json=selection(preview, headerless=True))
    ).status_code == 200
    await db_session.refresh(source)
    trusted = source.working_uri
    assert pq.read_table(trusted).num_rows == 3
    fresh = (await client.get(url + "/csv", params={"delimiter": ";"})).json()["data"]
    Path(source.source_uri).write_bytes(contents([["order_id", "amount"], ["001", 10, "extra"]]))
    assert (await client.post(url + "/preflight", json=selection(fresh))).status_code == 409
    changed = (await client.get(url + "/csv", params={"delimiter": ";"})).json()["data"]
    failed = await client.post(url + "/preflight", json=selection(changed, header_row=1))
    assert failed.status_code == 409
    await db_session.refresh(source)
    assert source.working_uri == trusted and source.profile_data["has_header"] is False
