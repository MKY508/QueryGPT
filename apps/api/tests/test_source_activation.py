"""Version activation agrees across discovery, binding, context and validation."""

import json
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.tables import (
    Project,
    ProjectDataSource,
    SemanticEntry,
    SemanticValidationJobItem,
)
from app.services import semantic_validation
from app.services.project_context import load_project_context
from app.services.result_filters import stable_schema_signature
from app.services.semantic_revisions import append_semantic_revision
from app.services.semantic_scopes import _current_sources
from app.services.semantic_source_scope import SemanticSourceCatalog, resolve_semantic_source_scope
from app.services.source_activation import file_source_blockers, is_current_source

COLUMNS = [{"name": "amount", "dtype": "float64"}]


def test_shared_frontend_activation_examples_match_backend():
    examples = json.loads(
        (Path(__file__).parent / "fixtures" / "source-activation.json").read_text(encoding="utf-8")
    )
    for example in examples:
        source = ProjectDataSource(**example["source"])
        profile = source.profile_data if isinstance(source.profile_data, dict) else {}
        assert is_current_source(source) == example["current"], example["name"]
        assert sorted(file_source_blockers(source.kind, profile)) == example["blockers"], example[
            "name"
        ]


def profile(**extra):
    return {"logical_name": "orders", "schema": {"columns": COLUMNS}, **extra}


def definition():
    return {
        "version": 1,
        "kind": "aggregate_metric",
        "operation": "sum",
        "source": {
            "source_logical_name": "orders",
            "source_kind": "file",
            "table_or_view": "orders",
            "action_column": "amount",
            "canonical_type": "number",
            "schema_signature": stable_schema_signature(COLUMNS),
        },
        "null_policy": "ignore",
        "business_name": "订单金额",
        "example_questions": [],
    }


def file_source(project_id, name, path=None, **extra):
    return ProjectDataSource(
        id=uuid4(),
        project_id=project_id,
        kind="file",
        name=name,
        format="parquet",
        status="ready",
        working_uri=str(path) if path else None,
        profile_data=profile(**extra),
    )


@pytest.mark.parametrize(
    "pending_flags",
    [
        {"is_current": False},
        {"activation_state": "pending_confirmation"},
        {"issues": [{"code": "recipe_replay_drift"}]},
        {"issues": [{"code": "recipe_input_changed"}]},
    ],
)
@pytest.mark.asyncio
async def test_consumers_resolve_the_same_accepted_version(
    db_session, tmp_path: Path, pending_flags
):
    project = Project(name="版本一致性")
    db_session.add(project)
    await db_session.flush()
    working = tmp_path / "accepted.parquet"
    pq.write_table(pa.table({"amount": [10.0, 20.0]}), working)
    current = file_source(project.id, "orders-current.parquet", working)
    # A nonexistent pending working copy proves it is never opened by validation.
    pending = file_source(
        project.id, "orders-next.parquet", tmp_path / "must-not-read.parquet", **pending_flags
    )
    retired = file_source(project.id, "orders-old.parquet")
    retired.status = "superseded"
    db_session.add_all([current, pending, retired])
    await db_session.commit()
    pending_before = deepcopy(pending.profile_data)
    entry = SimpleNamespace(definition=definition(), evidence=[])
    catalog = SemanticSourceCatalog.from_rows(
        [(item, None) for item in [pending, retired, current]]
    )
    resolution = resolve_semantic_source_scope(entry, catalog)
    assert [ref.source_id for ref in resolution.source_refs] == [current.id]
    assert resolution.source_scope == "parquet"
    assert catalog.by_id(str(pending.id)) is None
    assert [item.id for item in await _current_sources(db_session, project.id)] == [current.id]
    assert [
        item.id for item, _ in await semantic_validation._project_sources(db_session, project.id)
    ] == [current.id]
    context = await load_project_context(db_session, project.id)
    assert [item["id"] for item in context.sources] == [str(current.id)]
    assert [item["id"] for item in context.pending_sources] == [str(pending.id)]
    stats = await semantic_validation._validate_aggregate_metric(
        db_session, project.id, definition()
    )
    assert stats["aggregate_value"] == 30.0 and stats["total_rows"] == 2
    assert pending.profile_data == pending_before
    assert pending.status == "ready" and retired.status == "superseded"


def test_activation_does_not_replace_readiness_or_business_confirmation():
    current = file_source(uuid4(), "orders", issues=[None, "bad", {"code": "refund_policy"}])
    current.status = "needs_confirmation"
    assert is_current_source(current)
    assert not file_source_blockers("file", current.profile_data)
    # File-specific drift markers do not disable a database connection.
    connection = ProjectDataSource(
        kind="connection",
        status="attached",
        profile_data={"issues": [{"code": "recipe_input_changed"}]},
    )
    assert is_current_source(connection)
    connection.profile_data = {"is_current": False}
    assert not is_current_source(connection)
    legacy = file_source(uuid4(), "legacy")
    legacy.profile_data = None
    assert is_current_source(legacy)
    assert file_source_blockers("file", {"issues": {"code": "recipe_input_changed"}}) == set()


@pytest.mark.asyncio
async def test_pending_only_validation_job_stays_blocked_without_querying(db_session, monkeypatch):
    project = Project(name="不验证未启用的数据")
    db_session.add(project)
    await db_session.flush()
    pending = file_source(
        project.id, "orders-next.parquet", activation_state="pending_confirmation"
    )
    db_session.add(pending)
    entry = SemanticEntry(
        project_id=project.id,
        key="pending-metric",
        value="订单金额",
        entry_type="metric",
        state="candidate",
        source="inferred",
        definition=definition(),
        validity="unverified",
        execution_state="needs_validation",
        evidence=[],
    )
    db_session.add(entry)
    await db_session.flush()
    await append_semantic_revision(
        db_session,
        entry,
        mutation_kind="candidate_created",
        actor_source="inferred",
        expected_active_revision_id=None,
    )
    job = await semantic_validation.queue_semantic_validation_job(
        db_session, project_id=project.id, entries=[entry], reason=None
    )
    job_id, entry_id = job.id, entry.id
    await db_session.commit()
    calls = []

    async def no_query(*args, **kwargs):
        calls.append(args)
        raise AssertionError("Pending data must not be probed")

    monkeypatch.setattr(semantic_validation, "_execute_source_query", no_query)
    factory = async_sessionmaker(db_session.bind, class_=AsyncSession, expire_on_commit=False)
    await semantic_validation.run_semantic_validation_job(job_id, factory)
    db_session.expire_all()
    item = await db_session.scalar(
        select(SemanticValidationJobItem).where(SemanticValidationJobItem.job_id == job_id)
    )
    assert item.status == "blocked" and item.code == "semantic_binding_unresolved"
    assert calls == []
    stored = await db_session.get(SemanticEntry, entry_id)
    assert stored.state == "candidate" and stored.validity == "unverified"
    assert stored.execution_state == "blocked"


@pytest.mark.asyncio
async def test_knowledge_directory_filters_current_refs_but_preserves_legacy_evidence(
    client, db_session
):
    project = Project(name="来源筛选一致性")
    db_session.add(project)
    await db_session.flush()
    current = file_source(project.id, "orders-current.parquet")
    pending = file_source(project.id, "orders-next.parquet", is_current=False)
    db_session.add_all([current, pending])
    entries = [
        SemanticEntry(
            project_id=project.id,
            key="current-metric",
            value="订单金额",
            entry_type="metric",
            state="confirmed",
            source="user",
            definition=definition(),
            evidence=[{"source_id": str(pending.id)}],
        ),
        SemanticEntry(
            project_id=project.id,
            key="legacy-note",
            value="旧版本备注",
            entry_type="business_rule",
            state="confirmed",
            source="user",
            evidence=[{"source_id": str(pending.id)}],
        ),
    ]
    db_session.add_all(entries)
    await db_session.commit()
    url = f"/api/v1/projects/{project.id}/knowledge/page"
    response = await client.get(url, params={"source_scope": "parquet"})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["total"] == 1 and data["items"][0]["key"] == "current-metric"
    assert [item["source_id"] for item in data["items"][0]["source_refs"]] == [str(current.id)]
    legacy = await client.get(url, params={"source_id": str(pending.id)})
    assert legacy.status_code == 200, legacy.text
    by_key = {item["key"]: item for item in legacy.json()["data"]["items"]}
    assert set(by_key) == {"current-metric", "legacy-note"}
    assert by_key["legacy-note"]["source_scope"] == "unresolved"
    assert by_key["legacy-note"]["source_refs"] == []

    # A subsequent request follows an explicit activation change; no directory
    # cache should keep binding the previous physical version.
    current.status = "superseded"
    current.profile_data = profile(is_current=False)
    pending.profile_data = profile(is_current=True)
    await db_session.commit()
    refreshed = await client.get(url, params={"source_scope": "parquet"})
    assert refreshed.status_code == 200, refreshed.text
    data = refreshed.json()["data"]
    assert data["total"] == 2
    for item in data["items"]:
        assert [ref["source_id"] for ref in item["source_refs"]] == [str(pending.id)]
