"""History paging/projection and its local migration, without customer data."""

import importlib.util
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.core.analysis_history_keys import analysis_search_text
from app.db.tables import AnalysisRun, Conversation, Project
from app.services.migration_bootstrap import migrate_local_sqlite_to_head


async def seed(db: AsyncSession):
    project, other = Project(name="History"), Project(name="Other")
    db.add_all([project, other])
    await db.flush()
    conversation, foreign = Conversation(), Conversation()
    db.add_all([conversation, foreign])
    await db.flush()
    stamp = datetime(2026, 9, 1, tzinfo=UTC)
    runs = [
        AnalysisRun(
            id=UUID(int=i + 1),
            project_id=project.id,
            conversation_id=conversation.id,
            query=f"收入 {i}",
            state="completed",
            stage="completed",
            report={
                "title": f"报告 {i}",
                "summary": "门店",
                "rows": [{"not_in_history": "large" * 1000}],
            },
            checkpoint={"private_trace": "needle"},
            created_at=stamp,
            updated_at=stamp,
        )
        for i in range(26)
    ]
    db.add_all(
        [
            *runs,
            AnalysisRun(project_id=project.id, query="orphan"),
            AnalysisRun(project_id=other.id, conversation_id=foreign.id, query="foreign"),
            AnalysisRun(project_id=project.id, conversation_id=uuid4(), query="broken reference"),
        ]
    )
    await db.commit()
    return project, runs


@pytest.mark.asyncio
async def test_pages_pin_current_clamp_and_select_only_summary_fields(
    client: AsyncClient, db_session: AsyncSession
):
    project, runs = await seed(db_session)
    url = f"/api/v1/projects/{project.id}/analysis-history"
    params = {"current_run_id": str(runs[25].id)}
    first = (await client.get(url, params=params)).json()["data"]
    assert (first["total"], first["count"], first["page_count"]) == (26, 26, 3)
    assert first["current_run_id"] == str(runs[25].id)
    assert len(first["items"]) == 12
    assert [row["id"] for row in first["items"]] == [
        str(runs[25].id),
        *[str(r.id) for r in runs[:11]],
    ]
    assert set(first["items"][0]) == {
        "id",
        "project_id",
        "conversation_id",
        "query",
        "state",
        "stage",
        "report",
        "created_at",
        "updated_at",
    }
    assert set(first["items"][0]["report"]) == {"title", "summary"}
    assert first["items"][0]["updated_at"].endswith("Z")
    last = (await client.get(url, params={**params, "page": 99999})).json()["data"]
    assert last["page"] == 3
    assert [row["id"] for row in last["items"]] == [str(r.id) for r in runs[23:25]]
    middle = (await client.get(url, params={**params, "page": 2})).json()["data"]
    assert len({row["id"] for part in (first, middle, last) for row in part["items"]}) == 26
    invalid = (await client.get(url, params={"current_run_id": str(uuid4())})).json()["data"]
    assert invalid["current_run_id"] is None
    # Projection is also a SQL boundary, not just Pydantic removing a fetched blob.
    statements = []

    def capture(_conn, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement)

    engine = db_session.get_bind()
    sa.event.listen(engine, "before_cursor_execute", capture)
    try:
        await client.get(url)
    finally:
        sa.event.remove(engine, "before_cursor_execute", capture)
    assert len(statements) == 2  # Project existence + a single selection/count snapshot.
    assert "checkpoint" not in statements[-1] and "history_search_text" not in statements[-1]
    assert "JSON_EXTRACT" in statements[-1]


@pytest.mark.asyncio
async def test_search_normalization_literal_terms_status_and_updates(
    client: AsyncClient, db_session: AsyncSession
):
    project, runs = await seed(db_session)
    run = runs[25]
    run.query = "华东 Ｓａｌｅｓ ２０２６"
    run.report = {"title": "Résumé", "summary": "增长 100% _ /"}
    run.state = "waiting_confirmation"
    await db_session.commit()
    url = f"/api/v1/projects/{project.id}/analysis-history"
    params = {"q": "2026 华东 SALES RÉSUMÉ 100% _ /", "status": "waiting_confirmation", "page": 3}
    result = (await client.get(url, params=params)).json()["data"]
    assert (result["count"], result["page"], result["total"]) == (1, 1, 26)
    assert result["items"][0]["id"] == str(run.id)
    for q in ("needle", "not_in_history", "1000", "under_score"):
        assert (await client.get(url, params={"q": q})).json()["data"]["count"] == 0
    assert (await client.get(url, params={**params, "status": "completed"})).json()["data"][
        "items"
    ] == []
    run.report = {"title": ["malformed"], "summary": {"not": "a string"}}
    run.state = "understanding"
    runs[0].state = "investigating"
    await db_session.commit()
    assert (await client.get(url, params={"q": "Résumé"})).json()["data"]["count"] == 0
    active = (await client.get(url, params={"status": "active"})).json()["data"]
    assert active["count"] == 2
    assert active["items"][0]["report"] == {"title": None, "summary": None}


@pytest.mark.asyncio
async def test_empty_history_and_validation(client: AsyncClient, db_session: AsyncSession):
    project = Project(name="Empty")
    db_session.add(project)
    await db_session.commit()
    url = f"/api/v1/projects/{project.id}/analysis-history"
    assert (await client.get(url)).json()["data"] == {
        "items": [],
        "total": 0,
        "count": 0,
        "page": 1,
        "page_size": 12,
        "page_count": 1,
        "current_run_id": None,
    }
    for params in (
        {"q": "a" * 513},
        {"q": "bad\0query"},
        {"page": 0},
        {"page_size": 51},
        {"current_run_id": "invalid"},
        {"status": "completed;drop"},
        {"purpose": "invalid"},
    ):
        assert (await client.get(url, params=params)).status_code == 422
    assert (await client.get(f"/api/v1/projects/{uuid4()}/analysis-history")).status_code == 404


@pytest.mark.asyncio
async def test_report_library_keeps_completed_results_without_conversations(
    client: AsyncClient, db_session: AsyncSession
):
    project, runs = await seed(db_session)
    orphan = AnalysisRun(
        project_id=project.id,
        query="保留的结果",
        state="completed",
        report={"title": "旧调查", "summary": "华南"},
    )
    broken = AnalysisRun(
        project_id=project.id, conversation_id=uuid4(), query="无会话的结果", state="completed"
    )
    db_session.add_all([orphan, broken])
    await db_session.commit()
    url = f"/api/v1/projects/{project.id}/analysis-history"
    navigation = (await client.get(url)).json()["data"]
    assert navigation["total"] == 26
    report = (
        await client.get(
            url, params={"purpose": "report", "page_size": 50, "current_run_id": str(orphan.id)}
        )
    ).json()["data"]
    assert report["total"] == report["count"] == 28
    assert report["items"][0]["id"] == str(orphan.id)
    assert report["items"][0]["conversation_id"] is None
    assert {item["id"] for item in report["items"]} == {
        str(run.id) for run in [*runs, orphan, broken]
    }
    assert all(item["state"] == "completed" for item in report["items"])
    matched = (await client.get(url, params={"purpose": "report", "q": "华南"})).json()["data"]
    assert matched["count"] == 1
    assert matched["items"][0]["id"] == str(orphan.id)


def test_history_migration_backfills_batches_without_modifying_business_content():
    path = Path(__file__).resolve().parents[1] / "alembic/versions/0030_analysis_history.py"
    spec = importlib.util.spec_from_file_location("analysis_history_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    table = sa.Table(
        "analysis_runs",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("project_id", sa.String),
        sa.Column("query", sa.Text),
        sa.Column("report", sa.JSON),
        sa.Column("checkpoint", sa.JSON),
        sa.Column("created_at", sa.String),
        sa.Column("updated_at", sa.String),
    )
    metadata.create_all(engine)
    with engine.begin() as connection:
        rows = [
            {
                "id": f"{i:04d}",
                "project_id": "project",
                "query": f"收入 {i}",
                "report": {"title": "ＲÉＳＵＭÉ", "summary": "100% _", "rows": [1, 2]},
                "checkpoint": {"unchanged": True},
                "created_at": "created",
                "updated_at": "updated",
            }
            for i in range(501)
        ]
        connection.execute(table.insert(), rows)
        module.op = Operations(MigrationContext.configure(connection))
        module.upgrade()
        assert [
            dict(row) for row in connection.execute(table.select().order_by(table.c.id)).mappings()
        ] == rows
        values = (
            connection.execute(sa.text("SELECT history_search_text FROM analysis_runs ORDER BY id"))
            .scalars()
            .all()
        )
        assert values == [analysis_search_text(row["query"], row["report"]) for row in rows]
        assert (
            sa.inspect(connection).get_indexes("analysis_runs")[0]["name"]
            == "ix_analysis_history_updated"
        )
        module.downgrade()
        assert connection.scalar(sa.select(sa.func.count()).select_from(table)) == 501
    engine.dispose()


@pytest.mark.asyncio
async def test_history_bootstrap_recognizes_head_and_upgrades_previous_schema(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'history.db'}")
    try:
        assert (
            await migrate_local_sqlite_to_head(engine, str(engine.url)) == "0030_analysis_history"
        )
        async with engine.begin() as connection:
            await connection.execute(sa.text("DROP INDEX ix_analysis_history_updated"))
            await connection.execute(
                sa.text("ALTER TABLE analysis_runs DROP COLUMN history_search_text")
            )
            await connection.execute(
                sa.text("UPDATE alembic_version SET version_num = '0029_file_upload_receipts'")
            )
        assert (
            await migrate_local_sqlite_to_head(engine, str(engine.url)) == "0030_analysis_history"
        )
        async with engine.begin() as connection:
            await connection.execute(sa.text("DROP TABLE alembic_version"))
        assert (
            await migrate_local_sqlite_to_head(engine, str(engine.url)) == "0030_analysis_history"
        )
    finally:
        await engine.dispose()
