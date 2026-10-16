"""Save acknowledgements in isolated SQLite fixtures, never a user's workspace."""

from uuid import uuid4

import pytest
from sqlalchemy import func, select, text

from app.db.tables import Project, ReportBlock, ReportPage, ReportSaveReceipt
from app.services import report_save_receipts as receipts


async def create_report(client, db_session):
    project = Project(name="Save receipt fixture")
    db_session.add(project)
    await db_session.commit()
    project_id = str(project.id)
    response = await client.post(
        f"/api/v1/projects/{project_id}/reports",
        json={
            "title": "Before",
            "pages": [{"title": "Overview", "blocks": []}],
        },
    )
    assert response.status_code == 201, response.text
    document = response.json()["data"]
    url = f"/api/v1/projects/{project_id}/reports/{document['id']}"
    return url, document


def save_payload(document):
    return {
        "save_request_id": str(uuid4()),
        "expected_version": document["version"],
        "title": "Saved once",
        "pages": [
            {"id": document["pages"][0]["id"], "title": "Overview", "blocks": []},
            {
                "title": "New page",
                "order_index": 1,
                "blocks": [
                    {
                        "block_type": "text",
                        "source_kind": "manual",
                        "title": "New block",
                        "content": {"text": "Keep exactly once"},
                    }
                ],
            },
        ],
    }


@pytest.mark.asyncio
async def test_resolving_save_receipt_is_read_only_and_requires_exact_parameters(
    client, db_session
):
    url, document = await create_report(client, db_session)
    payload = save_payload(document)
    endpoint = f"{url}/save-receipts/resolve"
    absent = await client.post(endpoint, json=payload)
    assert absent.status_code == 200, absent.text
    assert absent.json()["data"] is None
    assert (await client.get(url)).json()["data"] == document
    assert await db_session.scalar(select(func.count()).select_from(ReportSaveReceipt)) == 0
    saved = (await client.patch(url, json=payload)).json()["data"]
    await client.patch(url, json={"expected_version": 2, "title": "Later writer"})
    confirmed = await client.post(endpoint, json={**payload, "retry_save": True})
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["data"] == saved
    current = (await client.get(url)).json()["data"]
    assert (current["title"], current["version"]) == ("Later writer", 3)
    changed = await client.post(endpoint, json={**payload, "title": "Different draft"})
    assert changed.status_code == 409
    assert changed.json()["detail"]["code"] == "report_save_key_reused"
    assert (await client.post(endpoint, json={"expected_version": 1})).status_code == 422
    other_url, _ = await create_report(client, db_session)
    wrong_report = await client.post(f"{other_url}/save-receipts/resolve", json=payload)
    assert wrong_report.status_code == 409
    assert "Keep exactly once" not in wrong_report.text
    wrong_project = await client.post(
        endpoint.replace(document["project_id"], str(uuid4())), json=payload
    )
    assert wrong_project.status_code == 404
    await client.delete(url)
    assert (await client.post(endpoint, json=payload)).status_code == 404


@pytest.mark.asyncio
async def test_retry_replays_original_response_without_recreating_entities_or_overwriting_later_save(
    client, db_session
):
    url, document = await create_report(client, db_session)
    payload = save_payload(document)
    first = await client.patch(url, json=payload)
    assert first.status_code == 200, first.text
    saved = first.json()["data"]
    assert saved["version"] == 2
    later = await client.patch(url, json={"expected_version": 2, "title": "Another writer"})
    assert later.status_code == 200, later.text
    replay = await client.patch(url, json={**payload, "retry_save": True})
    assert replay.status_code == 200, replay.text
    assert replay.json()["data"] == saved
    current = (await client.get(url)).json()["data"]
    assert (current["title"], current["version"]) == ("Another writer", 3)
    assert await db_session.scalar(select(func.count()).select_from(ReportPage)) == 2
    assert await db_session.scalar(select(func.count()).select_from(ReportBlock)) == 1


@pytest.mark.asyncio
async def test_key_reuse_rejects_changed_payload_and_other_report_without_exposing_receipt(
    client, db_session
):
    url, document = await create_report(client, db_session)
    payload = save_payload(document)
    assert (await client.patch(url, json=payload)).status_code == 200
    for changed in [{**payload, "title": "Changed"}, {**payload, "expected_version": 2}]:
        response = await client.patch(url, json=changed)
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "report_save_key_reused"
    other_url, _ = await create_report(client, db_session)
    response = await client.patch(other_url, json=payload)
    assert response.status_code == 409
    assert "Keep exactly once" not in response.text
    assert (await client.get(other_url)).json()["data"]["title"] == "Before"


@pytest.mark.asyncio
async def test_receipt_retention_is_report_scoped_and_missing_retries_do_not_turn_into_new_writes(
    client, db_session, monkeypatch
):
    monkeypatch.setattr(receipts, "RECEIPTS_PER_REPORT", 2)
    url, document = await create_report(client, db_session)
    other_url, other = await create_report(client, db_session)
    other_payload = save_payload(other)
    assert (await client.patch(other_url, json=other_payload)).status_code == 200
    payload = save_payload(document)
    assert (await client.patch(url, json=payload)).status_code == 200
    for version in [2, 3]:
        result = await client.patch(
            url,
            json={
                "save_request_id": str(uuid4()),
                "expected_version": version,
                "title": f"Version {version + 1}",
            },
        )
        assert result.status_code == 200, result.text
    assert await db_session.scalar(select(func.count()).select_from(ReportSaveReceipt)) == 3
    missing = await client.patch(url, json={**payload, "retry_save": True})
    assert missing.status_code == 409
    assert missing.json()["detail"]["code"] == "report_save_unconfirmed"
    assert (await client.get(url)).json()["data"]["version"] == 4
    assert (
        await client.patch(other_url, json={**other_payload, "retry_save": True})
    ).status_code == 200
    # A previously undelivered request may still execute against its unchanged base.
    fresh = await client.patch(
        url,
        json={
            "save_request_id": str(uuid4()),
            "retry_save": True,
            "expected_version": 4,
            "title": "Delivered now",
        },
    )
    assert fresh.status_code == 200, fresh.text
    assert fresh.json()["data"]["version"] == 5


@pytest.mark.asyncio
async def test_receipt_size_failure_rolls_back_the_whole_save_and_allows_same_request_retry(
    client, db_session, monkeypatch
):
    url, document = await create_report(client, db_session)
    payload = save_payload(document)
    with monkeypatch.context() as limited:
        limited.setattr(receipts, "MAX_SNAPSHOT_BYTES", 16)
        failed = await client.patch(url, json=payload)
    assert failed.status_code == 413, failed.text
    current = (await client.get(url)).json()["data"]
    assert (current["version"], current["title"], len(current["pages"])) == (1, "Before", 1)
    assert await db_session.scalar(select(func.count()).select_from(ReportSaveReceipt)) == 0
    assert await db_session.scalar(select(func.count()).select_from(ReportBlock)) == 0
    retried = await client.patch(url, json={**payload, "retry_save": True})
    assert retried.status_code == 200, retried.text
    assert retried.json()["data"]["version"] == 2


@pytest.mark.asyncio
async def test_report_delete_removes_receipts_and_replay_cannot_resurrect_it(client, db_session):
    # The production engine enables this at connect; the generic in-memory fixture does not.
    await db_session.execute(text("PRAGMA foreign_keys=ON"))
    await db_session.commit()
    url, document = await create_report(client, db_session)
    payload = save_payload(document)
    assert (await client.patch(url, json=payload)).status_code == 200
    assert (await client.delete(url)).status_code == 200
    assert await db_session.scalar(select(func.count()).select_from(ReportSaveReceipt)) == 0
    assert (await client.patch(url, json={**payload, "retry_save": True})).status_code == 404
