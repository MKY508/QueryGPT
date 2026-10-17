"""Server report selection and its existing-data upgrade; no external database."""

import importlib.util
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.core.report_library_keys import report_name_key, report_search_text
from app.db.tables import Project, ReportBlock, ReportDocument, ReportPage
from app.services.migration_bootstrap import UnsafeLocalSchemaError, migrate_local_sqlite_to_head


@pytest.mark.asyncio
async def test_library_pages_use_global_selection_counts_and_project_scope(
    client: AsyncClient, db_session: AsyncSession
):
    project, other = Project(name="Library"), Project(name="Other")
    db_session.add_all([project, other])
    await db_session.flush()
    start = datetime(2026, 9, 1, tzinfo=UTC)
    reports = [
        ReportDocument(
            id=UUID(int=index + 1),
            project_id=project.id,
            title=f"Report {index + 1}",
            description="华东 100% under_score /" if index == 25 else "West 1000 underXscore",
            status="published" if index == 25 else "draft",
            created_at=start + timedelta(days=index),
            updated_at=start,
            extra_data={"not_a_summary": "large content"},
        )
        for index in range(26)
    ]
    db_session.add_all(
        [*reports, ReportDocument(project_id=other.id, title="Report 0", description="华东 100%")]
    )
    await db_session.flush()
    report_page = ReportPage(report_id=reports[25].id, title="Overview")
    db_session.add(report_page)
    await db_session.flush()
    db_session.add(
        ReportBlock(
            page_id=report_page.id,
            block_type="text",
            source_kind="manual",
            content={"text": "not returned"},
        )
    )
    await db_session.commit()
    url = f"/api/v1/projects/{project.id}/reports/library"
    first = (await client.get(url, params={"sort": "title"})).json()["data"]
    assert (first["total"], first["count"], first["page_count"]) == (26, 26, 2)
    assert len(first["items"]) == 24
    assert [item["title"] for item in first["items"][:3]] == ["Report 1", "Report 2", "Report 3"]
    last = (await client.get(url, params={"sort": "title", "page": 999999})).json()["data"]
    assert last["page"] == 2
    assert [item["title"] for item in last["items"]] == ["Report 25", "Report 26"]
    assert last["items"][1]["page_count"] == last["items"][1]["block_count"] == 1
    assert {"extra_data", "pages", "search_text", "name_key"}.isdisjoint(last["items"][1])
    match = (
        await client.get(url, params={"q": "REPORT ２６ 华东 100% _ /", "status": "published"})
    ).json()["data"]
    assert (match["total"], match["count"], match["page"]) == (26, 1, 1)
    assert match["items"][0]["id"] == str(reports[25].id)
    no_match = (await client.get(url, params={"q": "100%", "status": "draft", "page": 2})).json()[
        "data"
    ]
    assert (no_match["items"], no_match["count"], no_match["page"], no_match["page_count"]) == (
        [],
        0,
        1,
        1,
    )
    for sort in ("created", "updated"):
        result = (await client.get(url, params={"sort": sort, "page_size": 1})).json()["data"]
        assert result["items"][0]["id"] == str(reports[25].id)
    # Actual API metadata edits update derived search keys in the same commit.
    renamed = await client.patch(
        f"/api/v1/projects/{project.id}/reports/{reports[25].id}",
        json={"title": "Résumé ２", "description": None, "expected_version": 1},
    )
    assert renamed.status_code == 200
    found = (await client.get(url, params={"q": "RÉSUMÉ 2"})).json()["data"]
    assert found["count"] == 1
    assert (await client.get(url, params={"q": "华东"})).json()["data"]["count"] == 0


@pytest.mark.asyncio
async def test_library_validates_controls_and_distinguishes_missing_project(
    client: AsyncClient, db_session: AsyncSession
):
    project = Project(name="Empty")
    db_session.add(project)
    await db_session.commit()
    url = f"/api/v1/projects/{project.id}/reports/library"
    assert (await client.get(url)).json()["data"] == {
        "items": [],
        "total": 0,
        "count": 0,
        "page": 1,
        "page_size": 24,
        "page_count": 1,
    }
    for params in (
        {"q": "a" * 201},
        {"q": "bad\0query"},
        {"page": 0},
        {"page_size": 101},
        {"sort": "title;drop table reports"},
        {"status": "deleted"},
    ):
        assert (await client.get(url, params=params)).status_code == 422
    assert (await client.get(f"/api/v1/projects/{uuid4()}/reports/library")).status_code == 404


def test_library_migration_backfills_multiple_batches_without_changing_report_content():
    path = Path(__file__).resolve().parents[1] / "alembic/versions/0023_report_library.py"
    spec = importlib.util.spec_from_file_location("report_library_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE report_documents (id TEXT PRIMARY KEY, project_id TEXT, title TEXT, description TEXT, version INTEGER, created_at TEXT, updated_at TEXT)"
        )
        connection.execute(
            sa.text(
                "INSERT INTO report_documents VALUES (:id, 'project', :title, NULL, 8, 'created', 'updated')"
            ),
            [{"id": f"{i:04d}", "title": f"Résumé {i}"} for i in range(501)],
        )
        module.op = Operations(MigrationContext.configure(connection))
        module.upgrade()
        rows = (
            connection.execute(sa.text("SELECT * FROM report_documents ORDER BY id"))
            .mappings()
            .all()
        )
        assert len(rows) == 501
        for row in rows:
            assert row["search_text"] == report_search_text(row["title"], None)
            assert row["name_key"] == report_name_key(row["title"])
            assert (row["description"], row["version"], row["created_at"], row["updated_at"]) == (
                None,
                8,
                "created",
                "updated",
            )
        assert len(sa.inspect(connection).get_indexes("report_documents")) == 2
        module.downgrade()
        assert len(connection.execute(sa.text("SELECT * FROM report_documents")).all()) == 501
    engine.dispose()
    assert report_name_key("A ００２") == report_name_key("a 2")
    assert report_name_key("A 2") < report_name_key("A 10") < report_name_key("A 100")
    assert report_name_key("表 ٢") == report_name_key("表 2")


@pytest.mark.asyncio
async def test_library_bootstrap_upgrades_populated_previous_schema_and_rejects_partial_keys(
    tmp_path: Path,
):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'library.db'}")
    try:
        assert (
            await migrate_local_sqlite_to_head(engine, str(engine.url)) == "0030_analysis_history"
        )
        async with AsyncSession(engine, expire_on_commit=False) as session:
            project = Project(name="Existing project")
            session.add(project)
            await session.flush()
            report = ReportDocument(
                project_id=project.id, title="Existing １０", description="华东 100%", version=9
            )
            session.add(report)
            await session.commit()
            identity, updated = report.id, report.updated_at
        async with engine.begin() as connection:
            for statement in (
                "DROP INDEX ix_analysis_history_updated",
                "ALTER TABLE analysis_runs DROP COLUMN history_search_text",
                "DROP TABLE file_upload_receipts",
                "DROP TABLE report_copy_receipts",
                "DROP INDEX ix_report_trash",
                "ALTER TABLE report_documents DROP COLUMN deleted_at",
                "DROP TABLE report_revisions",
                "DROP TABLE report_save_receipts",
                "DROP INDEX ix_report_library_updated",
                "DROP INDEX ix_report_library_created",
                "ALTER TABLE report_documents DROP COLUMN search_text",
                "ALTER TABLE report_documents DROP COLUMN name_key",
                "UPDATE alembic_version SET version_num = '0022_retire_legacy_user_scope'",
            ):
                await connection.execute(sa.text(statement))
        assert (
            await migrate_local_sqlite_to_head(engine, str(engine.url)) == "0030_analysis_history"
        )
        async with AsyncSession(engine) as session:
            retained = await session.get(ReportDocument, identity)
            assert retained.version == 9
            assert retained.updated_at.replace(tzinfo=UTC) == updated
            assert retained.search_text == report_search_text("Existing １０", "华东 100%")
        async with engine.begin() as connection:
            await connection.execute(sa.text("ALTER TABLE report_documents DROP COLUMN name_key"))
        with pytest.raises(UnsafeLocalSchemaError, match="不完整.*0023"):
            await migrate_local_sqlite_to_head(engine, str(engine.url))
    finally:
        await engine.dispose()
