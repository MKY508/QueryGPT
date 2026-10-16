import pytest
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import Project, ReportDocument
from app.services.migration_bootstrap import migrate_local_sqlite_to_head
from tests.test_migration_bootstrap import HEAD, _engine


@pytest.mark.asyncio
async def test_previous_report_schema_upgrades_without_backfilling_fake_versions(tmp_path):
    engine = _engine(tmp_path / "history-upgrade.db")
    try:
        await migrate_local_sqlite_to_head(engine, str(engine.url))
        async with AsyncSession(engine, expire_on_commit=False) as db:
            project = Project(name="Existing")
            db.add(project)
            await db.flush()
            report = ReportDocument(project_id=project.id, title="Retain me", version=9, pages=[])
            db.add(report)
            await db.commit()
            report_id = report.id
        async with engine.begin() as connection:
            await connection.execute(text("DROP TABLE file_upload_receipts"))
            await connection.execute(text("DROP TABLE report_copy_receipts"))
            await connection.execute(text("DROP INDEX ix_report_trash"))
            await connection.execute(text("ALTER TABLE report_documents DROP COLUMN deleted_at"))
            await connection.execute(text("DROP TABLE report_revisions"))
            await connection.execute(
                text("UPDATE alembic_version SET version_num = '0025_report_save_receipts'")
            )
        assert await migrate_local_sqlite_to_head(engine, str(engine.url)) == HEAD
        async with AsyncSession(engine) as db:
            report = await db.get(ReportDocument, report_id)
            assert report.title == "Retain me" and report.version == 9
            assert await db.scalar(text("SELECT count(*) FROM report_revisions")) == 0
        async with engine.connect() as connection:
            pk = await connection.run_sync(
                lambda sync: inspect(sync).get_pk_constraint("report_revisions")
            )
            assert pk["constrained_columns"] == ["report_id", "version"]
    finally:
        await engine.dispose()
