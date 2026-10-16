"""Page copies inherit same-report provenance, not client source assertions."""

from copy import deepcopy
from uuid import uuid4

import pytest

from app.db.tables import Project, ReportBlock, ReportDocument, ReportPage
from tests.test_reports import _seed_refreshable_report


async def saved_source(client, db):
    project = Project(name="Page copy fixture")
    db.add(project)
    await db.flush()
    report = ReportDocument(
        project_id=project.id,
        title="Original",
        pages=[
            ReportPage(
                title="Overview",
                blocks=[
                    ReportBlock(
                        block_type="chart",
                        title="Revenue",
                        source_kind="artifact",
                        source_ref={"snapshot": {"title": "Trusted historical source"}},
                        content={"rows": [{"region": "East", "revenue": 12}]},
                        config={"chart_type": "bar"},
                        layout={"x": 0, "y": 0, "w": 12, "h": 5},
                    )
                ],
            ),
        ],
    )
    db.add(report)
    await db.commit()
    url = f"/api/v1/projects/{project.id}/reports/{report.id}"
    return url, (await client.get(url)).json()["data"]


def copy_page(document):
    page = deepcopy(document["pages"][0])
    page.pop("id")
    page["title"] = "Copy"
    page["order_index"] = 1
    for block in page["blocks"]:
        block["copy_source_block_id"] = block.pop("id")
        block["source_ref"] = {"snapshot": {"title": "Forged client source"}}
    return page


@pytest.mark.asyncio
async def test_page_copy_keeps_detached_provenance_and_is_saved_exactly_once(client, db_session):
    url, source = await saved_source(client, db_session)
    page = copy_page(source)
    page["blocks"][0]["title"] = "Locally edited copy"
    payload = {
        "expected_version": source["version"],
        "save_request_id": str(uuid4()),
        "pages": [source["pages"][0], page],
    }
    response = await client.patch(url, json=payload)
    assert response.status_code == 200, response.text
    saved = response.json()["data"]
    original, copied = saved["pages"]
    assert copied["id"] != original["id"]
    assert copied["blocks"][0]["id"] != original["blocks"][0]["id"]
    assert copied["blocks"][0]["source_ref"] == source["pages"][0]["blocks"][0]["source_ref"]
    assert copied["blocks"][0]["source_kind"] == "artifact"
    assert copied["blocks"][0]["source_available"] is False
    assert copied["blocks"][0]["title"] == "Locally edited copy"
    assert "copy_source_block_id" not in copied["blocks"][0]
    assert original["blocks"][0]["title"] == "Revenue"
    replay = await client.patch(url, json=payload)
    assert replay.json() == response.json()
    followup = await client.patch(
        url, json={"expected_version": saved["version"], "pages": saved["pages"]}
    )
    assert followup.status_code == 200, followup.text
    assert len(followup.json()["data"]["pages"]) == 2


@pytest.mark.asyncio
async def test_page_copy_keeps_live_source_links_and_server_refresh_binding(client, db_session):
    project, playbook, run, artifact, report = await _seed_refreshable_report(db_session)
    block = report.pages[0].blocks[0]
    binding = {
        "version": 1,
        "kind": "analysis_playbook",
        "playbook_id": playbook.id,
        "playbook_shape_hash": "a" * 64,
        "result_name": "result_1",
    }
    block.source_ref = {**block.source_ref, "refresh_binding": binding}
    await db_session.commit()
    url = f"/api/v1/projects/{project.id}/reports/{report.id}"
    source = (await client.get(url)).json()["data"]
    response = await client.patch(
        url,
        json={
            "expected_version": source["version"],
            "pages": [source["pages"][0], copy_page(source)],
        },
    )
    assert response.status_code == 200, response.text
    copied = response.json()["data"]["pages"][1]["blocks"][0]
    assert copied["analysis_run_id"] == str(run.id)
    assert copied["artifact_id"] == str(artifact.id)
    assert copied["source_available"] is True
    assert copied["source_ref"]["refresh_binding"] == binding


@pytest.mark.asyncio
async def test_page_copy_can_replace_source_page_in_same_transaction(client, db_session):
    url, source = await saved_source(client, db_session)
    response = await client.patch(
        url, json={"expected_version": source["version"], "pages": [copy_page(source)]}
    )
    assert response.status_code == 200, response.text
    saved = response.json()["data"]
    assert len(saved["pages"]) == 1
    assert saved["pages"][0]["id"] != source["pages"][0]["id"]
    assert (
        saved["pages"][0]["blocks"][0]["source_ref"]
        == source["pages"][0]["blocks"][0]["source_ref"]
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid", ["other_report", "new_source", "existing_identity"])
async def test_page_copy_rejects_invalid_origin_before_mutating_report(client, db_session, invalid):
    url, source = await saved_source(client, db_session)
    page = copy_page(source)
    block = page["blocks"][0]
    if invalid == "other_report":
        _, other = await saved_source(client, db_session)
        block["copy_source_block_id"] = other["pages"][0]["blocks"][0]["id"]
    elif invalid == "new_source":
        block["artifact_id"] = str(uuid4())
    else:
        page["id"] = source["pages"][0]["id"]
        block["id"] = source["pages"][0]["blocks"][0]["id"]
    response = await client.patch(
        url,
        json={"expected_version": source["version"], "title": "Must not change", "pages": [page]},
    )
    assert response.status_code in (400, 409, 422), response.text
    assert (await client.get(url)).json()["data"] == source
