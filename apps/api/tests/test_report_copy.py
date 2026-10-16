from uuid import uuid4

import pytest
from sqlalchemy import func, select, text

from app.db.tables import Project, ReportCopyReceipt, ReportDocument, ReportRevision
from app.services import report_save_receipts
from tests.test_report_save_receipts import create_report, save_payload
from tests.test_reports import _seed_file_refresh_boundary


def intent(version=1):
    return {"request_id": str(uuid4()), "expected_version": version, "title": "Independent copy"}


@pytest.mark.asyncio
async def test_copy_is_independent_draft_and_replay_survives_source_changes_and_purge(
    client, db_session
):
    await db_session.execute(text("PRAGMA foreign_keys=ON"))
    await db_session.commit()
    url, original = await create_report(client, db_session)
    saved_payload = save_payload(original)
    saved_payload["status"] = "published"
    saved_payload["extra_data"] = {"presentation": {"theme": "quiet"}}
    saved_payload["pages"][1]["config"] = {"width": "wide"}
    saved_payload["pages"][1]["blocks"] = [
        {
            "block_type": "chart",
            "title": "Chart",
            "source_kind": "manual",
            "content": {"rows": [{"region": "East", "amount": "9007199254740993.01"}]},
            "config": {
                "interaction_key": "chart-key",
                "filter_action": {
                    "field": "region",
                    "targets": [{"key": "table-key", "field": "region"}],
                },
            },
        },
        {
            "block_type": "table",
            "title": "Details",
            "source_kind": "manual",
            "content": {"rows": [{"region": "East", "amount": "9007199254740993.01"}]},
            "config": {"interaction_key": "table-key"},
        },
    ]
    saved = (await client.patch(url, json=saved_payload)).json()["data"]
    payload = intent(2)
    assert (await client.post(url + "/copies/resolve", json=payload)).json()["data"] is None
    copied = await client.post(url + "/copies", json=payload)
    assert copied.status_code == 200, copied.text
    ack = copied.json()["data"]
    target = f"/api/v1/projects/{saved['project_id']}/reports/{ack['report_id']}"
    duplicate = (await client.get(target)).json()["data"]
    assert duplicate["status"] == "draft" and duplicate["version"] == 1
    assert duplicate["title"] == payload["title"] and duplicate["extra_data"] == saved["extra_data"]
    assert duplicate["id"] != saved["id"] and duplicate["deleted_at"] is None
    for page, source in zip(duplicate["pages"], saved["pages"], strict=True):
        assert page["id"] != source["id"] and page["config"] == source["config"]
        for block, old in zip(page["blocks"], source["blocks"], strict=True):
            assert block["id"] != old["id"] and block["version"] == 1
            for field in ("content", "config", "layout", "source_ref", "source_kind"):
                assert block[field] == old[field]
    assert (await client.get(url)).json()["data"] == saved
    history = (await client.get(target + "/revisions")).json()["data"]["items"]
    assert [row["reason"] for row in history] == ["copied"]
    assert (await client.post(url + "/copies", json=payload)).json() == copied.json()
    assert (await client.post(url + "/copies/resolve", json=payload)).json() == copied.json()
    assert (
        await client.post(url + "/copies", json={**payload, "title": "different"})
    ).status_code == 409
    assert (
        await client.patch(target, json={"expected_version": 1, "title": "Edited copy"})
    ).status_code == 200
    assert (
        await client.patch(url, json={"expected_version": 2, "title": "Changed original"})
    ).status_code == 200
    assert (await client.post(url + "/copies", json=payload)).json() == copied.json()
    assert (await client.get(target)).json()["data"]["title"] == "Edited copy"
    assert (await client.delete(url, params={"expected_version": 3})).status_code == 200
    source_trash = url.replace("/reports/", "/report-trash/")
    assert (await client.delete(source_trash, params={"expected_version": 4})).status_code == 200
    assert (await client.post(url + "/copies/resolve", json=payload)).json() == copied.json()
    assert (await client.post(url + "/copies", json=payload)).json() == copied.json()
    assert (await client.delete(target, params={"expected_version": 2})).status_code == 200
    assert (await client.post(url + "/copies", json=payload)).json()["detail"][
        "code"
    ] == "report_copy_unavailable"
    assert (
        await client.delete(
            target.replace("/reports/", "/report-trash/"), params={"expected_version": 3}
        )
    ).status_code == 200
    assert (await client.post(url + "/copies", json=payload)).status_code == 409
    assert await db_session.scalar(select(func.count()).select_from(ReportCopyReceipt)) == 1
    assert await db_session.scalar(select(func.count()).select_from(ReportDocument)) == 0


@pytest.mark.asyncio
async def test_copied_source_blocks_keep_refresh_binding_without_querying_during_copy(
    client, db_session, tmp_path, monkeypatch
):
    from app.api.v1 import reports

    _, ids, raw, working = await _seed_file_refresh_boundary(db_session, tmp_path, monkeypatch)
    url = f"/api/v1/projects/{ids[0]}/reports/{ids[1]}"
    original = (await client.get(url)).json()["data"]
    raw_bytes, working_bytes = raw.read_bytes(), working.read_bytes()

    async def forbidden(*args, **kwargs):
        pytest.fail("Copying saved content must not query current data")

    with monkeypatch.context() as isolated:
        isolated.setattr(reports, "run_analysis_playbook", forbidden)
        response = await client.post(url + "/copies", json=intent())
    assert response.status_code == 200, response.text
    target = f"/api/v1/projects/{ids[0]}/reports/{response.json()['data']['report_id']}"
    copied = (await client.get(target)).json()["data"]
    block, source = copied["pages"][0]["blocks"][0], original["pages"][0]["blocks"][0]
    assert block["source_ref"] == source["source_ref"]
    assert (
        block["artifact_id"] == source["artifact_id"]
        and block["analysis_run_id"] == source["analysis_run_id"]
    )
    refreshed = await client.post(
        f"{target}/pages/{copied['pages'][0]['id']}/blocks/{block['id']}/refresh",
        json={"expected_version": 1},
    )
    assert refreshed.status_code == 200, refreshed.text
    assert refreshed.json()["data"]["pages"][0]["blocks"][0]["content"]["rows"] == [
        {"region": "East", "revenue": 120.0}
    ]
    assert (await client.get(url)).json()["data"] == original
    assert raw.read_bytes() == raw_bytes and working.read_bytes() == working_bytes


@pytest.mark.asyncio
async def test_copy_rejects_foreign_stale_or_client_authored_sources_and_rolls_back_history_failure(
    client, db_session, monkeypatch
):
    url, original = await create_report(client, db_session)
    other = Project(name="Other")
    db_session.add(other)
    await db_session.commit()
    foreign = f"/api/v1/projects/{other.id}/reports/{original['id']}/copies"
    payload = intent()
    assert (await client.post(foreign, json=payload)).status_code == 404
    assert (
        await client.post(url + "/copies", json={**payload, "expected_version": 99})
    ).status_code == 409
    assert (await client.post(url + "/copies", json={**payload, "pages": []})).status_code == 422
    with monkeypatch.context() as limited:
        limited.setattr(report_save_receipts, "MAX_SNAPSHOT_BYTES", 16)
        failed = await client.post(url + "/copies", json=payload)
    assert failed.status_code == 413, failed.text
    assert (await client.post(url + "/copies/resolve", json=payload)).json()["data"] is None
    assert await db_session.scalar(select(func.count()).select_from(ReportCopyReceipt)) == 0
    assert await db_session.scalar(select(func.count()).select_from(ReportDocument)) == 1
    assert await db_session.scalar(select(func.count()).select_from(ReportRevision)) == 1
    assert (await client.get(url)).json()["data"] == original
