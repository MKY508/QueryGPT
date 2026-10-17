import pytest
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import Project, ReportDocument
from app.services.migration_bootstrap import migrate_local_sqlite_to_head
from tests.test_migration_bootstrap import HEAD, _engine


@pytest.mark.asyncio
async def test_previous_database_adds_trash_without_hiding_existing_reports(tmp_path):
    engine = _engine(tmp_path / "trash-upgrade.db")
    try:
        await migrate_local_sqlite_to_head(engine, str(engine.url))
        async with AsyncSession(engine, expire_on_commit=False) as db:
            project = Project(name="Existing")
            db.add(project)
            await db.flush()
            report = ReportDocument(project_id=project.id, title="Retain me", version=9, pages=[])
            db.add(report)
            await db.commit()
            identity = report.id
        async with engine.begin() as connection:
            await connection.execute(text("DROP INDEX ix_analysis_history_updated"))
            await connection.execute(
                text("ALTER TABLE analysis_runs DROP COLUMN history_search_text")
            )
            await connection.execute(text("DROP TABLE file_upload_receipts"))
            await connection.execute(text("DROP TABLE report_copy_receipts"))
            await connection.execute(text("DROP INDEX ix_report_trash"))
            await connection.execute(text("ALTER TABLE report_documents DROP COLUMN deleted_at"))
            await connection.execute(
                text("UPDATE alembic_version SET version_num = '0026_report_revisions'")
            )
        assert await migrate_local_sqlite_to_head(engine, str(engine.url)) == HEAD
        assert await migrate_local_sqlite_to_head(engine, str(engine.url)) == HEAD
        async with AsyncSession(engine) as db:
            report = await db.get(ReportDocument, identity)
            assert report.title == "Retain me" and report.version == 9 and report.deleted_at is None
        async with engine.connect() as connection:
            indexes = await connection.run_sync(
                lambda sync: inspect(sync).get_indexes("report_documents")
            )
            assert "ix_report_trash" in {item["name"] for item in indexes}
    finally:
        await engine.dispose()
