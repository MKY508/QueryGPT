from uuid import UUID

import pytest
from sqlalchemy import func, select

from app.db.tables import Project, ReportRevision
from app.services import report_save_receipts
from tests.test_report_save_receipts import create_report, save_payload
from tests.test_reports import _seed_file_refresh_boundary


@pytest.mark.asyncio
async def test_saved_history_preview_restore_and_retry_are_atomic_and_scoped(client, db_session):
    url, original = await create_report(client, db_session)
    payload = save_payload(original)
    saved = await client.patch(url, json=payload)
    assert saved.status_code == 200, saved.text
    assert (await client.patch(url, json=payload)).json() == saved.json()
    directory = (await client.get(url + "/revisions?limit=1")).json()["data"]
    assert directory["next_before"] == 2 and [item["version"] for item in directory["items"]] == [2]
    assert "snapshot" not in str(directory) and "pages" not in directory["items"][0]
    previous = (await client.get(url + "/revisions?before=2")).json()["data"]
    assert [item["version"] for item in previous["items"]] == [1]
    preview = await client.get(url + "/revisions/1")
    assert preview.status_code == 200 and preview.json()["data"] == original
    assert (await client.get(url)).json() == saved.json()  # Preview is read-only.
    restored = await client.post(url + "/revisions/1/restore", json={"expected_version": 2})
    assert restored.status_code == 200, restored.text
    result = restored.json()["data"]
    assert result["version"] == 3 and result["title"] == original["title"]
    assert result["pages"][0]["id"] != original["pages"][0]["id"]
    assert (
        await client.post(url + "/revisions/1/restore", json={"expected_version": 2})
    ).status_code == 409
    assert (await client.get(url + "/revisions/2")).json() == saved.json()
    # An old page ID cannot become valid again after restoration.
    assert (
        await client.patch(
            url + f"/pages/{original['pages'][0]['id']}",
            json={"expected_version": 1, "title": "stale"},
        )
    ).status_code == 404
    other = Project(name="Other")
    db_session.add(other)
    await db_session.commit()
    foreign = f"/api/v1/projects/{other.id}/reports/{original['id']}/revisions"
    assert (await client.get(foreign)).status_code == 404
    assert (await client.get(foreign + "/1")).status_code == 404
    assert (
        await client.post(foreign + "/1/restore", json={"expected_version": 3})
    ).status_code == 404
    assert await db_session.scalar(select(func.count()).select_from(ReportRevision)) == 3


@pytest.mark.asyncio
async def test_all_page_and_block_mutations_retain_versions(client, db_session):
    url, original = await create_report(client, db_session)
    page_url = url + f"/pages/{original['pages'][0]['id']}"
    added = await client.post(
        page_url + "/blocks",
        json={"block_type": "text", "source_kind": "manual", "content": {"text": "old"}},
    )
    assert added.status_code == 201, added.text
    block_id = added.json()["data"]["pages"][0]["blocks"][0]["id"]
    changed = await client.patch(
        page_url + f"/blocks/{block_id}", json={"expected_version": 1, "content": {"text": "new"}}
    )
    assert changed.status_code == 200, changed.text
    assert (await client.delete(page_url + f"/blocks/{block_id}")).status_code == 200
    assert (
        await client.patch(page_url, json={"expected_version": 4, "title": "renamed"})
    ).status_code == 200
    assert (await client.post(url + "/pages", json={"title": "second"})).status_code == 201
    assert (await client.delete(page_url)).status_code == 200
    directory = (await client.get(url + "/revisions")).json()["data"]
    assert [item["version"] for item in directory["items"]] == list(range(7, 0, -1))
    historical = (await client.get(url + "/revisions/2")).json()["data"]
    assert historical["pages"][0]["blocks"][0]["content"] == {"text": "old"}


@pytest.mark.asyncio
async def test_refresh_records_imported_results_and_restore_does_not_query(
    client, db_session, tmp_path, monkeypatch
):
    from app.api.v1 import reports

    refresh_url, ids, _, _ = await _seed_file_refresh_boundary(db_session, tmp_path, monkeypatch)
    url = f"/api/v1/projects/{ids[0]}/reports/{ids[1]}"
    refreshed = await client.post(refresh_url, json={"expected_version": 1})
    assert refreshed.status_code == 200, refreshed.text

    async def forbidden(*args, **kwargs):
        pytest.fail("Restoring history must not query current source data")

    monkeypatch.setattr(reports, "run_analysis_playbook", forbidden)
    restored = await client.post(url + "/revisions/1/restore", json={"expected_version": 2})
    assert restored.status_code == 200, restored.text
    block = restored.json()["data"]["pages"][0]["blocks"][0]
    assert block["content"]["rows"] == [{"region": "旧区域", "revenue": 1}]
    assert "refresh_binding" in block["source_ref"]
    assert (await client.get(url + "/revisions/2")).json() == refreshed.json()


@pytest.mark.asyncio
async def test_history_failure_rolls_back_save_and_corrupt_snapshot_cannot_restore(
    client, db_session, monkeypatch
):
    url, original = await create_report(client, db_session)
    with monkeypatch.context() as limited:
        limited.setattr(report_save_receipts, "MAX_SNAPSHOT_BYTES", 16)
        failed = await client.patch(url, json={"expected_version": 1, "title": "must not publish"})
    assert failed.status_code == 413, failed.text
    assert (await client.get(url)).json()["data"] == original
    revision = await db_session.get(ReportRevision, (UUID(original["id"]), 1))
    revision.snapshot = b"not the recorded snapshot"
    await db_session.commit()
    rejected = await client.post(url + "/revisions/1/restore", json={"expected_version": 1})
    assert (
        rejected.status_code == 409
        and rejected.json()["detail"]["code"] == "report_history_unavailable"
    )
    assert (await client.get(url)).json()["data"] == original
