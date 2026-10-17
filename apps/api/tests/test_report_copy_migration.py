import pytest
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import Project, ReportDocument
from app.services.migration_bootstrap import migrate_local_sqlite_to_head
from tests.test_migration_bootstrap import HEAD, _engine


@pytest.mark.asyncio
async def test_prior_schema_adds_copy_receipts_without_copying_or_changing_reports(tmp_path):
    engine = _engine(tmp_path / "report-copy-upgrade.db")
    try:
        await migrate_local_sqlite_to_head(engine, str(engine.url))
        async with AsyncSession(engine, expire_on_commit=False) as db:
            project = Project(name="Retained")
            db.add(project)
            await db.flush()
            report = ReportDocument(project_id=project.id, title="Original", version=9, pages=[])
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
            await connection.execute(
                text("UPDATE alembic_version SET version_num = '0027_report_trash'")
            )
        assert await migrate_local_sqlite_to_head(engine, str(engine.url)) == HEAD
        assert await migrate_local_sqlite_to_head(engine, str(engine.url)) == HEAD
        async with AsyncSession(engine) as db:
            report = await db.get(ReportDocument, identity)
            assert report.title == "Original" and report.version == 9
            assert await db.scalar(text("SELECT count(*) FROM report_copy_receipts")) == 0
        async with engine.connect() as connection:
            pk = await connection.run_sync(
                lambda sync: inspect(sync).get_pk_constraint("report_copy_receipts")
            )
            assert pk["constrained_columns"] == ["project_id", "request_id"]
    finally:
        await engine.dispose()
