"""Moving cards reparents a same-report identity; it never recreates its source."""

from copy import deepcopy
from uuid import uuid4

import pytest

from tests.test_report_page_copy import saved_source
from tests.test_reports import _seed_refreshable_report


@pytest.mark.asyncio
@pytest.mark.parametrize("direction", ["new_page", "earlier_page", "replace_page"])
async def test_move_keeps_identity_and_detached_provenance(client, db_session, direction):
    url, source = await saved_source(client, db_session)
    original = source["pages"][0]["blocks"][0]
    # First add an empty saved page, also exercising order-independent reparenting.
    added = await client.patch(
        url,
        json={
            "expected_version": source["version"],
            "pages": [
                {"title": "Destination", "order_index": 0, "blocks": []},
                {**source["pages"][0], "order_index": 1},
            ],
        },
    )
    assert added.status_code == 200, added.text
    before = added.json()["data"]
    target, origin = deepcopy(before["pages"])
    moving = origin["blocks"].pop()
    moving["source_ref"] = {"snapshot": {"title": "Forged"}}
    target["blocks"] = [moving]
    if direction == "new_page":
        target.pop("id")
    pages = [target] if direction == "replace_page" else [origin, target]
    for index, page in enumerate(pages):
        page["order_index"] = index
    # earlier_page actually processes the destination before the source.
    if direction == "earlier_page":
        pages.reverse()
        for index, page in enumerate(pages):
            page["order_index"] = index
    request = {
        "expected_version": before["version"],
        "save_request_id": str(uuid4()),
        "pages": pages,
    }
    response = await client.patch(url, json=request)
    assert response.status_code == 200, response.text
    saved = response.json()["data"]
    blocks = [block for page in saved["pages"] for block in page["blocks"]]
    assert len(blocks) == 1
    assert blocks[0]["id"] == original["id"]
    assert blocks[0]["created_at"] == original["created_at"]
    assert blocks[0]["source_ref"] == original["source_ref"]
    assert blocks[0]["source_kind"] == "artifact"
    assert blocks[0]["source_available"] is False
    assert blocks[0]["version"] == moving["version"] + 1
    assert (await client.get(url)).json()["data"] == saved
    assert (await client.patch(url, json=request)).json() == response.json()
    # Saving an undo can also restore a removed page with the same card identity.
    undo_pages = deepcopy(before["pages"])
    surviving = {page["id"] for page in saved["pages"]}
    for page in undo_pages:
        if page["id"] not in surviving:
            page.pop("id")
    undo = await client.patch(url, json={"expected_version": saved["version"], "pages": undo_pages})
    assert undo.status_code == 200, undo.text
    assert undo.json()["data"]["pages"][1]["blocks"][0]["id"] == original["id"]


@pytest.mark.asyncio
async def test_move_keeps_live_source_and_refresh_binding(client, db_session):
    project, playbook, run, artifact, report = await _seed_refreshable_report(db_session)
    block = report.pages[0].blocks[0]
    binding = {
        "version": 1,
        "kind": "analysis_playbook",
        "playbook_id": playbook.id,
        "playbook_shape_hash": "b" * 64,
        "result_name": "result_1",
    }
    block.source_ref = {**block.source_ref, "refresh_binding": binding}
    await db_session.commit()
    url = f"/api/v1/projects/{project.id}/reports/{report.id}"
    source = (await client.get(url)).json()["data"]
    origin = deepcopy(source["pages"][0])
    target = {"title": "Detail", "order_index": 1, "blocks": [origin["blocks"].pop(0)]}
    response = await client.patch(
        url, json={"expected_version": source["version"], "pages": [origin, target]}
    )
    assert response.status_code == 200, response.text
    moved = response.json()["data"]["pages"][1]["blocks"][0]
    assert moved["id"] == str(block.id)
    assert moved["analysis_run_id"] == str(run.id)
    assert moved["artifact_id"] == str(artifact.id)
    assert moved["source_ref"]["refresh_binding"] == binding
    assert moved["source_available"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid", ["other_report", "duplicate"])
async def test_move_rejects_foreign_or_repeated_identity_atomically(client, db_session, invalid):
    url, before = await saved_source(client, db_session)
    _, other = await saved_source(client, db_session)
    target = {
        "title": "Invalid",
        "order_index": 1,
        "blocks": deepcopy((other if invalid == "other_report" else before)["pages"][0]["blocks"]),
    }
    response = await client.patch(
        url,
        json={
            "expected_version": before["version"],
            "title": "Do not write",
            "pages": [before["pages"][0], target],
        },
    )
    assert response.status_code == 400, response.text
    assert (await client.get(url)).json()["data"] == before
