"""Small disposable period-file workflows, including stale preview evidence."""

from copy import deepcopy
from pathlib import Path
from uuid import UUID, uuid4

import pyarrow.parquet as pq
import pytest
from sqlalchemy import func, select

from app.api.v1 import projects
from app.db.tables import PreflightReportRecord, ProjectDataSource, SanitationRecipeRecord
from app.services.sanitation_revisions import (
    append_sanitation_revision,
    ensure_sanitation_revision_head,
)
from tests.test_reader_method_continuity import attach, current_method, fill_amount, reader_choice


async def period_files(client, db_session, tmp_path, monkeypatch, *, delimiter=";"):
    url, old = await attach(client, db_session, tmp_path, monkeypatch)
    prepared = await client.post(
        url + "/preflight", json=await reader_choice(client, url, header_row=1)
    )
    assert prepared.status_code == 200, prepared.text
    await fill_amount(client, url)
    await db_session.refresh(old)
    project_id, old_id = old.project_id, old.id
    body = (
        f"order_id{delimiter}amount\n003{delimiter}30\n004{delimiter}\n005{delimiter}50\n".encode()
    )
    added = await client.post(
        f"/api/v1/projects/{project_id}/sources/files", files={"file": ("next.csv", body)}
    )
    assert added.status_code == 200, added.text
    candidate_id = UUID(added.json()["data"]["id"])
    return url + "/replacement", project_id, old_id, candidate_id


@pytest.mark.asyncio
async def test_explicit_period_preview_and_update_preserve_history_and_use_adjusted_reader(
    client, db_session, tmp_path, monkeypatch
):
    url, project_id, old_id, candidate_id = await period_files(
        client, db_session, tmp_path, monkeypatch, delimiter="\t"
    )
    old = await db_session.get(ProjectDataSource, old_id)
    candidate = await db_session.get(ProjectDataSource, candidate_id)
    old_recipe = await current_method(db_session, old)
    old_head, old_steps, trusted = (
        old_recipe.active_revision_id,
        deepcopy(old_recipe.operations),
        old.working_uri,
    )
    old_bytes, new_bytes = (
        Path(old.source_uri).read_bytes(),
        Path(candidate.source_uri).read_bytes(),
    )
    original_reports = await db_session.scalar(
        select(func.count()).select_from(PreflightReportRecord)
    )
    request = {"candidate_source_id": str(candidate_id)}
    incompatible = await client.post(url + "/preview", json=request)
    assert incompatible.status_code == 200, incompatible.text
    assert incompatible.json()["data"]["can_apply"] is False
    raw = (
        await client.get(
            f"/api/v1/projects/{project_id}/sources/{candidate_id}/csv", params={"delimiter": "\t"}
        )
    ).json()["data"]
    request["selection"] = {
        "kind": "csv",
        "delimiter": "\t",
        "encoding": raw["encoding"],
        "header_row": 1,
        "source_revision": raw["source_revision"],
        "input_fingerprint": raw["input_fingerprint"],
    }
    response = await client.post(url + "/preview", json=request)
    assert response.status_code == 200, response.text
    preview = response.json()["data"]
    assert preview["can_apply"] and preview["before"]["rows"] == 2 and preview["after"]["rows"] == 3
    assert preview["after"]["sample"][1] == {"order_id": "004", "amount": 0}
    await db_session.refresh(candidate)
    assert candidate.status == "attached" and candidate.working_uri is None
    assert (
        await db_session.scalar(select(func.count()).select_from(PreflightReportRecord))
        == original_reports
    )
    assert not list((tmp_path / "workspace").glob("*/sources/*/working/previews/*"))
    applied = await client.post(url + "/apply", json={**request, "proof": preview["proof"]})
    assert applied.status_code == 200, applied.text
    await db_session.refresh(old)
    await db_session.refresh(candidate)
    old_recipe = await current_method(db_session, old)
    assert old.status == "superseded" and old.working_uri == trusted
    assert old_recipe.active_revision_id == old_head and old_recipe.operations == old_steps
    assert candidate.profile_data["logical_name"] == old.profile_data["logical_name"]
    assert candidate.profile_data["version"] == 2 and candidate.profile_data["is_current"] is True
    assert candidate.profile_data["csv_options"]["delimiter"] == "\t"
    assert pq.read_table(candidate.working_uri).num_rows == 3
    assert (
        Path(old.source_uri).read_bytes() == old_bytes
        and Path(candidate.source_uri).read_bytes() == new_bytes
    )
    assert (await current_method(db_session, candidate)).active_revision_id != old_head
    assert (
        await client.post(url + "/apply", json={**request, "proof": preview["proof"]})
    ).status_code == 409
    assert await db_session.scalar(select(func.count()).select_from(SanitationRecipeRecord)) == 2


@pytest.mark.asyncio
async def test_replacement_rejects_changed_inputs_working_copy_head_and_foreign_source(
    client, db_session, tmp_path, monkeypatch
):
    url, project_id, old_id, candidate_id = await period_files(
        client, db_session, tmp_path, monkeypatch
    )
    request = {"candidate_source_id": str(candidate_id)}
    response = await client.post(url + "/preview", json=request)
    assert response.status_code == 200, response.text
    proof = response.json()["data"]["proof"]
    old = await db_session.get(ProjectDataSource, old_id)
    new = await db_session.get(ProjectDataSource, candidate_id)
    for raw_path in [new.source_uri, old.working_uri, old.source_uri]:
        path = Path(raw_path)
        original = path.read_bytes()
        path.write_bytes(original + b"changed")
        rejected = await client.post(url + "/apply", json={**request, "proof": proof})
        assert rejected.status_code == 409, rejected.text
        path.write_bytes(original)
    await db_session.refresh(old)
    recipe = await current_method(db_session, old)
    active = await ensure_sanitation_revision_head(db_session, recipe)
    await append_sanitation_revision(
        db_session,
        recipe,
        expected_active_revision_id=active.id,
        state="confirmed",
        operations=active.operations,
        input_contract=active.input_contract,
        output_contract=active.output_contract,
        actor_source="user",
        reason="Changed head",
    )
    await db_session.commit()
    assert (await client.post(url + "/apply", json={**request, "proof": proof})).status_code == 409
    assert (
        await client.post(url.replace(str(project_id), str(uuid4())) + "/preview", json=request)
    ).status_code == 404
    await db_session.refresh(old)
    await db_session.refresh(new)
    assert old.profile_data["is_current"] is True and new.working_uri is None


@pytest.mark.asyncio
async def test_replacement_rolls_back_if_candidate_changes_during_replay(
    client, db_session, tmp_path, monkeypatch
):
    url, _, old_id, candidate_id = await period_files(client, db_session, tmp_path, monkeypatch)
    request = {"candidate_source_id": str(candidate_id)}
    preview = (await client.post(url + "/preview", json=request)).json()["data"]
    runner = projects._run_preflight_in_thread

    async def concurrent_change(*args, **kwargs):
        result = await runner(*args, **kwargs)
        candidate = await db_session.get(ProjectDataSource, candidate_id)
        candidate.profile_data = {"summary": "Changed by another action"}
        await db_session.commit()
        return result

    monkeypatch.setattr(projects, "_run_preflight_in_thread", concurrent_change)
    rejected = await client.post(url + "/apply", json={**request, "proof": preview["proof"]})
    assert rejected.status_code == 409, rejected.text
    old = await db_session.get(ProjectDataSource, old_id)
    candidate = await db_session.get(ProjectDataSource, candidate_id)
    assert old.status != "superseded" and candidate.working_uri is None
    assert candidate.profile_data["summary"] == "Changed by another action"
    assert not list((tmp_path / "workspace").glob(f"*/sources/{candidate_id}/working/attempts/*"))
