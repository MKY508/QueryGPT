"""Small method-history/replay workflows on disposable project files."""

from copy import deepcopy
from pathlib import Path
from uuid import UUID, uuid4

import pyarrow.parquet as pq
import pytest
from sqlalchemy import func, select

from app.api.v1 import projects
from app.db.tables import PreflightReportRecord, ProjectDataSource, SanitationRecipeRevisionRecord
from app.services.sanitation_revisions import (
    append_sanitation_revision,
    ensure_sanitation_revision_head,
)
from tests.test_reader_method_continuity import attach, current_method, fill_amount, reader_choice


async def prepared(client, db_session, tmp_path, monkeypatch):
    source_url, source = await attach(client, db_session, tmp_path, monkeypatch)
    response = await client.post(
        source_url + "/preflight", json=await reader_choice(client, source_url, header_row=1)
    )
    assert response.status_code == 200, response.text
    recipe = await current_method(db_session, source)
    initial = recipe.active_revision_id
    await fill_amount(client, source_url)
    await db_session.refresh(source)
    await db_session.refresh(recipe)
    url = f"/api/v1/projects/{source.project_id}/recipes/{recipe.id}/replay"
    return url, source, recipe, initial


@pytest.mark.asyncio
async def test_preview_and_restore_apply_keep_old_data_until_confirmed_and_preserve_history(
    client, db_session, tmp_path, monkeypatch
):
    url, source, recipe, initial = await prepared(client, db_session, tmp_path, monkeypatch)
    source_id, recipe_id = source.id, recipe.id
    original, working, head = (
        Path(source.source_uri).read_bytes(),
        source.working_uri,
        recipe.active_revision_id,
    )
    revisions = list(
        (
            await db_session.scalars(
                select(SanitationRecipeRevisionRecord).where(
                    SanitationRecipeRevisionRecord.recipe_id == recipe_id
                )
            )
        ).all()
    )
    old_history = {revision.id: deepcopy(revision.operations) for revision in revisions}
    count = await db_session.scalar(select(func.count()).select_from(PreflightReportRecord))
    preview = await client.post(url + "/preview", json={"revision_id": str(initial)})
    assert preview.status_code == 200, preview.text
    data = preview.json()["data"]
    assert data["before"]["sample"][1]["amount"] == 0
    assert data["after"]["sample"][1]["amount"] is None
    await db_session.refresh(source)
    await db_session.refresh(recipe)
    assert source.working_uri == working and recipe.active_revision_id == head
    assert await db_session.scalar(select(func.count()).select_from(PreflightReportRecord)) == count
    applied = await client.post(
        url + "/apply", json={"revision_id": str(initial), "proof": data["proof"]}
    )
    assert applied.status_code == 200, applied.text
    await db_session.refresh(source)
    await db_session.refresh(recipe)
    assert source.id == source_id and source.working_uri != working
    assert Path(source.source_uri).read_bytes() == original and Path(working).is_file()
    assert pq.read_table(source.working_uri).to_pylist()[1]["amount"] is None
    current = await db_session.get(SanitationRecipeRevisionRecord, recipe.active_revision_id)
    assert current.parent_revision_id == head
    assert current.input_contract["replayed_from_revision_id"] == str(initial)
    for revision in revisions:
        await db_session.refresh(revision)
        assert revision.operations == old_history[revision.id]
    assert (
        await client.post(
            url + "/apply", json={"revision_id": str(initial), "proof": data["proof"]}
        )
    ).status_code == 409
    # Current-head replay keeps manual ownership when it is still valid.
    await fill_amount(client, url.replace(f"recipes/{recipe_id}/replay", f"sources/{source_id}"))
    preview = (await client.post(url + "/preview", json={})).json()["data"]
    assert (
        await client.post(
            url + "/apply", json={"revision_id": preview["revision_id"], "proof": preview["proof"]}
        )
    ).status_code == 200
    await db_session.refresh(source)
    assert source.profile_data["visual_cleaning"]["operations"][0]["operation"] == "fill_missing"


@pytest.mark.asyncio
async def test_replay_rejects_changed_file_working_head_and_foreign_revision(
    client, db_session, tmp_path, monkeypatch
):
    url, source, recipe, _ = await prepared(client, db_session, tmp_path, monkeypatch)
    project_id = source.project_id
    paths = [source.source_uri, source.working_uri]
    preview = (await client.post(url + "/preview", json={})).json()["data"]
    request = {"revision_id": preview["revision_id"], "proof": preview["proof"]}
    for raw in paths:
        path = Path(raw)
        original = path.read_bytes()
        path.write_bytes(original + b"changed")
        assert (await client.post(url + "/apply", json=request)).status_code == 409
        path.write_bytes(original)
    await db_session.refresh(source)
    recipe = await current_method(db_session, source)
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
    )
    await db_session.commit()
    assert (await client.post(url + "/apply", json=request)).status_code == 409
    assert (
        await client.post(url + "/preview", json={"revision_id": str(uuid4())})
    ).status_code == 404
    assert (
        await client.post(url.replace(str(project_id), str(uuid4())) + "/preview", json={})
    ).status_code == 404


@pytest.mark.asyncio
async def test_replay_rejects_intervening_changes_and_cleans_only_failed_attempt(
    client, db_session, tmp_path, monkeypatch
):
    url, source, recipe, _ = await prepared(client, db_session, tmp_path, monkeypatch)
    source_id, working, head = source.id, source.working_uri, recipe.active_revision_id
    before_attempts = set(
        (tmp_path / "workspace").glob(f"*/sources/{source_id}/working/attempts/*")
    )
    preview = (await client.post(url + "/preview", json={})).json()["data"]
    runner = projects._run_preflight_in_thread

    async def change(*args, **kwargs):
        result = await runner(*args, **kwargs)
        source = await db_session.get(ProjectDataSource, source_id)
        source.profile_data = {**source.profile_data, "summary": "Another edit"}
        await db_session.commit()
        return result

    monkeypatch.setattr(projects, "_run_preflight_in_thread", change)
    assert (await client.post(url + "/apply", json={"proof": preview["proof"]})).status_code == 409
    await db_session.refresh(source)
    await db_session.refresh(recipe)
    assert source.working_uri == working and recipe.active_revision_id == head
    assert source.profile_data["summary"] == "Another edit"
    assert (
        set((tmp_path / "workspace").glob(f"*/sources/{source_id}/working/attempts/*"))
        == before_attempts
    )


@pytest.mark.asyncio
async def test_replay_without_working_copy_does_not_activate_a_pending_replacement(
    client, db_session, tmp_path, monkeypatch
):
    url, source, recipe, _ = await prepared(client, db_session, tmp_path, monkeypatch)
    project_id = source.project_id
    added = await client.post(
        f"/api/v1/projects/{project_id}/sources/files",
        files={"file": ("previous.csv", b"order_id,amount\n005,30\n")},
    )
    previous_id = UUID(added.json()["data"]["id"])
    assert (
        await client.post(f"/api/v1/projects/{project_id}/sources/{previous_id}/preflight")
    ).status_code == 200
    previous = await db_session.get(ProjectDataSource, previous_id)
    previous.working_uri = source.working_uri
    previous.status = "ready"
    previous.profile_data = {**source.profile_data, "is_current": True}
    source.status = "attached"
    source.working_uri = None
    source.profile_data = {
        **source.profile_data,
        "is_current": False,
        "replacement_of": str(previous_id),
        "activation_state": "pending_confirmation",
    }
    await db_session.commit()
    original_previous = deepcopy(previous.profile_data)
    preview = await client.post(url + "/preview", json={})
    assert preview.status_code == 200, preview.text
    data = preview.json()["data"]
    assert data["before"] is None and data["pending_replacement"]
    applied = await client.post(url + "/apply", json={"proof": data["proof"]})
    assert applied.status_code == 200, applied.text
    await db_session.refresh(source)
    await db_session.refresh(previous)
    assert source.profile_data["is_current"] is False and source.working_uri
    assert source.profile_data["activation_state"] == "pending_confirmation"
    assert previous.profile_data == original_previous and previous.status == "ready"
