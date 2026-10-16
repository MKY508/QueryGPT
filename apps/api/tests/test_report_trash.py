from uuid import UUID

import pytest
from sqlalchemy import func, select, text

from app.db.tables import (
    Project,
    ReportBlock,
    ReportDocument,
    ReportPage,
    ReportRevision,
    ReportSaveReceipt,
)
from app.services import report_save_receipts
from tests.test_report_save_receipts import create_report, save_payload


@pytest.mark.asyncio
async def test_trash_preview_restore_preserves_content_history_and_rejects_stale_editors(
    client, db_session
):
    url, original = await create_report(client, db_session)
    saved_response = await client.patch(url, json=save_payload(original))
    saved = saved_response.json()["data"]
    trash = f"/api/v1/projects/{saved['project_id']}/report-trash"
    target = f"{trash}/{saved['id']}"
    assert (await client.delete(url)).status_code == 422  # Destructive intent must pin a version.
    assert (await client.delete(url, params={"expected_version": 1})).status_code == 409
    moved = await client.delete(url, params={"expected_version": 2})
    assert moved.status_code == 200, moved.text
    assert (await client.get(url)).status_code == 404
    assert (await client.get(url + "/revisions")).status_code == 404
    assert (await client.get(url + "/export.xlsx")).status_code == 404
    assert (
        await client.patch(url, json={"expected_version": 2, "title": "stale"})
    ).status_code == 404
    assert (await client.post(url + "/pages", json={"title": "stale"})).status_code == 404
    assert (
        await client.post(url + "/revisions/1/restore", json={"expected_version": 3})
    ).status_code == 404
    assert (await client.get(url.rsplit("/", 1)[0])).json()["data"] == []
    library = (await client.get(url.rsplit("/", 1)[0] + "/library")).json()["data"]
    assert library["items"] == [] and library["total"] == 0
    directory = (await client.get(trash + "?page=999")).json()["data"]
    assert directory["page"] == 1 and directory["count"] == 1
    assert directory["items"][0]["version"] == 3 and "pages" not in directory["items"][0]
    assert (await client.get(trash + "?q=missing")).json()["data"]["count"] == 0
    preview = (await client.get(target)).json()["data"]
    assert preview["version"] == 3 and preview["deleted_at"]
    assert preview["pages"][1]["blocks"][0]["content"] == saved["pages"][1]["blocks"][0]["content"]
    assert (await client.get(target)).json()["data"] == preview  # Preview never restores.
    restored = await client.post(target + "/restore", json={"expected_version": 3})
    assert restored.status_code == 200, restored.text
    result = restored.json()["data"]
    assert result["version"] == 4 and result["deleted_at"] is None
    assert result["pages"][0]["id"] == saved["pages"][0]["id"]
    assert result["pages"][1]["blocks"][0]["id"] == saved["pages"][1]["blocks"][0]["id"]
    assert (await client.get(url + "/revisions/2")).json() == saved_response.json()
    page = saved["pages"][1]
    page_url = f"{url}/pages/{page['id']}"
    assert (
        await client.patch(page_url, json={"expected_version": page["version"], "title": "old"})
    ).status_code == 409
    block = page["blocks"][0]
    assert (
        await client.patch(
            f"{page_url}/blocks/{block['id']}",
            json={"expected_version": block["version"], "content": {"text": "old"}},
        )
    ).status_code == 409
    assert (await client.delete(url, params={"expected_version": 2})).status_code == 409
    assert (await client.post(target + "/restore", json={"expected_version": 3})).status_code == 409
    assert (await client.get(trash)).json()["data"]["total"] == 0
    assert await db_session.scalar(select(func.count()).select_from(ReportRevision)) == 4


@pytest.mark.asyncio
async def test_purge_requires_matching_trashed_version_and_cascades_only_that_report(
    client, db_session
):
    await db_session.execute(text("PRAGMA foreign_keys=ON"))
    await db_session.commit()
    url, document = await create_report(client, db_session)
    assert (await client.patch(url, json=save_payload(document))).status_code == 200
    other = Project(name="Other")
    db_session.add(other)
    await db_session.commit()
    foreign = f"/api/v1/projects/{other.id}/report-trash/{document['id']}"
    target = f"/api/v1/projects/{document['project_id']}/report-trash/{document['id']}"
    assert (await client.delete(target, params={"expected_version": 2})).status_code == 409
    assert (await client.delete(url, params={"expected_version": 2})).status_code == 200
    assert (await client.get(foreign)).status_code == 404
    assert (
        await client.post(foreign + "/restore", json={"expected_version": 3})
    ).status_code == 404
    assert (await client.delete(foreign, params={"expected_version": 3})).status_code == 404
    assert (await client.delete(target, params={"expected_version": 2})).status_code == 409
    assert (await client.delete(target, params={"expected_version": 3})).status_code == 200
    assert (await client.delete(target, params={"expected_version": 3})).status_code == 404
    assert await db_session.get(ReportDocument, UUID(document["id"])) is None
    for model in (ReportPage, ReportBlock, ReportRevision, ReportSaveReceipt):
        assert await db_session.scalar(select(func.count()).select_from(model)) == 0
    assert await db_session.scalar(select(func.count()).select_from(Project)) == 2


@pytest.mark.asyncio
async def test_history_failure_rolls_back_trash_and_nested_version_changes(
    client, db_session, monkeypatch
):
    url, document = await create_report(client, db_session)
    with monkeypatch.context() as limited:
        limited.setattr(report_save_receipts, "MAX_SNAPSHOT_BYTES", 16)
        result = await client.delete(url, params={"expected_version": 1})
    assert result.status_code == 413, result.text
    assert (await client.get(url)).json()["data"] == document
    assert await db_session.scalar(select(func.count()).select_from(ReportRevision)) == 1
