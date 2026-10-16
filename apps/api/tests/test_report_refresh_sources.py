"""Refresh source confirmation, next-period execution and truthful saved receipts."""

from datetime import UTC, datetime
from uuid import UUID

import pytest
from sqlalchemy import select

from app.api.v1 import reports
from app.db.tables import Project, ProjectDataSource, SanitationRecipeRecord
from app.models.reports import ReportRefreshReceipt, ReportRefreshSourceLabel
from app.models.workspace import AnalysisPlaybookResponse
from app.services import analysis_playbook_runner
from app.services.data_preflight import run_preflight
from app.services.report_refresh import preserve_refresh_receipt, refresh_content_hash
from app.services.sanitation_revisions import ensure_sanitation_revision_head
from app.services.structured_query import profile_schema_signature
from tests.test_reports import _seed_file_refresh_boundary, _seed_page_refresh_boundary


@pytest.mark.asyncio
async def test_report_refresh_plan_is_read_only_and_rejects_stale_source_before_query(
    client, db_session, tmp_path, monkeypatch
):
    url, ids, _, _ = await _seed_file_refresh_boundary(db_session, tmp_path, monkeypatch)

    async def must_not_query(*args, **kwargs):
        pytest.fail("Source confirmation and stale plans must not execute a data query")

    monkeypatch.setattr(reports, "run_analysis_playbook", must_not_query)
    response = await client.post(url + "-sources", json={"expected_version": 1})
    assert response.status_code == 200, response.text
    plan = response.json()["data"]
    assert plan["blocks"][0]["previous_source"] is None
    assert plan["blocks"][0]["next_source"]["data_version"] == 1
    assert "source_uri" not in response.text and "working_uri" not in response.text
    source = await db_session.get(ProjectDataSource, ids[4])
    source.profile_data = {**source.profile_data, "version": 2}
    await db_session.commit()
    rejected = await client.post(
        url, json={"expected_version": 1, "source_plan": plan["source_plan"]}
    )
    assert (
        rejected.status_code == 409
        and rejected.json()["detail"]["code"] == "report_refresh_source_changed"
    )
    document = (await client.get(f"/api/v1/projects/{ids[0]}/reports/{ids[1]}")).json()["data"]
    assert document["version"] == 1
    assert "refresh_receipt" not in document["pages"][0]["blocks"][0]["source_ref"]


@pytest.mark.asyncio
async def test_new_period_activation_then_report_refresh_uses_the_confirmed_new_source(
    client, db_session, tmp_path, monkeypatch
):
    url, ids, original, _ = await _seed_file_refresh_boundary(db_session, tmp_path, monkeypatch)
    # Seed both periods through the real file preparer so schema evidence uses
    # the same reader, rather than inventing equivalent SQL/Arrow type names.
    source = await db_session.get(ProjectDataSource, ids[4])
    prepared = run_preflight(original, original.parent / "baseline")
    source.working_uri = str(prepared.working_path)
    source.profile_data = {**source.profile_data, "schema": prepared.inferred_schema}
    recipe = (
        await db_session.scalars(
            select(SanitationRecipeRecord).where(SanitationRecipeRecord.data_source_id == source.id)
        )
    ).one()
    recipe.operations = prepared.operations
    recipe.output_fingerprint = prepared.output_fingerprint
    await ensure_sanitation_revision_head(db_session, recipe)
    project = await db_session.get(Project, ids[0])
    playbook = AnalysisPlaybookResponse.model_validate(project.extra_data["analysis_playbooks"][0])
    playbook.source_roles[0].schema_signature = profile_schema_signature(source.profile_data)
    playbook.shape_hash = analysis_playbook_runner._shape_hash(playbook)
    project.extra_data = {"analysis_playbooks": [playbook.model_dump(mode="json")]}
    report = await reports._load_report(db_session, ids[0], ids[1])
    block = report.pages[0].blocks[0]
    block.source_ref = {
        **block.source_ref,
        "refresh_binding": {
            **block.source_ref["refresh_binding"],
            "playbook_shape_hash": playbook.shape_hash,
        },
    }
    await db_session.commit()
    first = await client.post(url, json={"expected_version": 1})
    assert first.status_code == 200, first.text
    first_receipt = first.json()["data"]["pages"][0]["blocks"][0]["source_ref"]["refresh_receipt"]
    assert first_receipt["source"]["source_id"] == str(ids[4])
    uploaded = await client.post(
        f"/api/v1/projects/{ids[0]}/sources/files",
        files={"file": ("september.csv", b"region,revenue\nEast,240\n")},
    )
    candidate = uploaded.json()["data"]["id"]
    replacement_url = f"/api/v1/projects/{ids[0]}/sources/{ids[4]}/replacement"
    request = {"candidate_source_id": candidate}
    trial = await client.post(replacement_url + "/preview", json=request)
    assert trial.status_code == 200, trial.text
    updated = await client.post(
        replacement_url + "/apply", json={**request, "proof": trial.json()["data"]["proof"]}
    )
    assert updated.status_code == 200, updated.text
    preview = await client.post(url + "-sources", json={"expected_version": 2})
    assert preview.status_code == 200, preview.text
    plan = preview.json()["data"]
    assert plan["blocks"][0]["previous_source"]["data_version"] == 1
    assert plan["blocks"][0]["next_source"]["data_version"] == 2
    assert plan["blocks"][0]["next_source"]["name"] == "september.csv"
    refreshed = await client.post(
        url, json={"expected_version": 2, "source_plan": plan["source_plan"]}
    )
    assert refreshed.status_code == 200, refreshed.text
    new_block = refreshed.json()["data"]["pages"][0]["blocks"][0]
    # The integer SUM uses the exact-value string transport, not a JS double.
    assert new_block["content"]["rows"] == [{"region": "East", "revenue": "240"}]
    assert new_block["source_ref"]["refresh_receipt"]["source"]["source_id"] == candidate
    # A normal presentation edit keeps the receipt; editing the data drops it.
    changed = await client.patch(
        url.removesuffix("/refresh"), json={"expected_version": 3, "title": "九月收入"}
    )
    assert changed.status_code == 200, changed.text
    assert "refresh_receipt" in changed.json()["data"]["pages"][0]["blocks"][0]["source_ref"]
    changed = await client.patch(
        url.removesuffix("/refresh"),
        json={"expected_version": 4, "content": {"rows": [{"region": "East", "revenue": 999}]}},
    )
    assert changed.status_code == 200, changed.text
    assert "refresh_receipt" not in changed.json()["data"]["pages"][0]["blocks"][0]["source_ref"]


@pytest.mark.asyncio
async def test_page_source_plan_covers_exactly_the_refreshable_blocks(
    client, db_session, tmp_path, monkeypatch
):
    url, ids = await _seed_page_refresh_boundary(db_session, tmp_path, monkeypatch)
    preview = await client.post(url + "-sources", json={"expected_version": 1})
    assert preview.status_code == 200, preview.text
    plan = preview.json()["data"]
    assert plan["block_id"] is None and len(plan["blocks"]) == 2
    applied = await client.post(
        url, json={"expected_version": 1, "source_plan": plan["source_plan"]}
    )
    assert applied.status_code == 200, applied.text
    blocks = applied.json()["data"]["pages"][0]["blocks"]
    assert all("refresh_receipt" in block["source_ref"] for block in blocks[:2])
    assert all("refresh_receipt" not in (block.get("source_ref") or {}) for block in blocks[2:])


def test_refresh_receipt_survives_json_number_roundtrip_but_not_changed_data():
    content = {"rows": [{"amount": 120.0, "code": "9007199254740993", "flag": True}]}
    receipt = ReportRefreshReceipt(
        refreshed_at=datetime.now(UTC),
        source=ReportRefreshSourceLabel(
            source_id=UUID(int=1), name="orders.csv", kind="file", data_version=2
        ),
        source_catalog_hash="a" * 64,
        content_hash=refresh_content_hash(content),
    ).model_dump(mode="json")
    previous = {"refresh_receipt": receipt}
    roundtrip = {"rows": [{"amount": 120, "code": "9007199254740993", "flag": True}]}
    assert preserve_refresh_receipt({}, previous, roundtrip)["refresh_receipt"] == receipt
    roundtrip["rows"][0]["flag"] = 1
    assert preserve_refresh_receipt({}, previous, roundtrip) == {}
