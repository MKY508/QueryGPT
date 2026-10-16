"""Portable UUID storage and atomic upgrade of the existing SQLite graph."""

import asyncio
import importlib.util
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import selectinload

from app.db.base import Base
from app.db.sqlite_migration import run_sqlite_migration
from app.db.tables import Project, ReportBlock, ReportDocument, ReportPage, SemanticScopeNode
from app.services import migration_bootstrap as bootstrap

OLD = "0023_report_library"
HEAD = "0030_analysis_history"
PROJECT_ID = UUID("aaaaaaaa-0000-4000-8000-000000000001")
REPORT_ID = UUID("aaaaaaaa-0000-4000-8000-000000000002")
PAGE_ID = UUID("aaaaaaaa-0000-4000-8000-000000000003")
BLOCK_ID = UUID("aaaaaaaa-0000-4000-8000-000000000004")
SCOPE_ID = UUID("aaaaaaaa-0000-4000-8000-000000000005")
CHILD_ID = UUID("aaaaaaaa-0000-4000-8000-000000000006")


def _migration():
    path = Path(__file__).resolve().parents[1] / "alembic/versions/0024_sqlite_uuid_text.py"
    spec = importlib.util.spec_from_file_location("uuid_storage_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def _old_database(tmp_path: Path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'legacy.db'}")

    def prepare(connection):
        def migrate():
            bootstrap._create_legacy_seed_tables(connection)
            bootstrap._run_environment(
                connection,
                script_location=bootstrap._script_location(),
                destination="0001_initial",
                stamp=True,
            )
            bootstrap._run_environment(
                connection,
                script_location=bootstrap._script_location(),
                destination=OLD,
                stamp=False,
            )

        run_sqlite_migration(connection, migrate)

    async with engine.connect() as connection:
        await connection.run_sync(prepare)
    async with AsyncSession(engine, expire_on_commit=False) as session:
        project = Project(id=PROJECT_ID, name="Preserved project")
        session.add(project)
        await session.flush()
        session.add(
            SemanticScopeNode(
                id=SCOPE_ID,
                project_id=PROJECT_ID,
                kind="project",
                stable_key="root",
                business_name="Root",
            )
        )
        await session.flush()
        session.add(
            SemanticScopeNode(
                id=CHILD_ID,
                project_id=PROJECT_ID,
                parent_id=SCOPE_ID,
                kind="context",
                stable_key="context",
                business_name="Context",
            )
        )
        report = ReportDocument(
            id=REPORT_ID,
            project_id=project.id,
            title="Report 10",
            description="Retained",
            version=7,
            updated_at=datetime(2026, 9, 1, tzinfo=UTC),
            extra_data={"keep": [1, 2]},
        )
        session.add(report)
        await session.flush()
        page = ReportPage(id=PAGE_ID, report_id=report.id, title="Page", version=3)
        session.add(page)
        await session.flush()
        session.add(
            ReportBlock(
                id=BLOCK_ID,
                page_id=page.id,
                block_type="text",
                source_kind="manual",
                content={"text": "Retained content"},
                version=4,
            )
        )
        await session.commit()
    return engine


def test_runtime_uuid_types_cover_migration_and_keep_postgresql_native():
    actual = {
        name: tuple(column.name for column in table.c if isinstance(column.type, sa.Uuid))
        for name, table in Base.metadata.tables.items()
    }
    actual = {name: columns for name, columns in actual.items() if columns}
    assert actual == {**_migration().UUID_COLUMNS, "report_save_receipts": ("report_id",)}
    for table, names in actual.items():
        for name in names:
            type_ = Base.metadata.tables[table].c[name].type
            assert str(type_.compile(dialect=sqlite.dialect())) == "CHAR(32)"
            assert str(type_.compile(dialect=postgresql.dialect())) == "UUID"


@pytest.mark.asyncio
async def test_numeric_and_exponent_shaped_ids_round_trip_with_relationships(
    db_session: AsyncSession,
):
    identities = [
        UUID(int=1),
        UUID("00000000-0000-4000-8000-000000000001"),
        UUID("00000000-0000-0000-0000-000000000e10"),
    ]
    for index, identity in enumerate(identities):
        project = Project(id=identity, name=f"Project {index}")
        db_session.add(project)
        await db_session.flush()
        db_session.add(ReportDocument(id=identity, project_id=identity, title=f"Report {index}"))
    await db_session.commit()
    db_session.expunge_all()
    for identity in identities:
        report = await db_session.get(
            ReportDocument, identity, options=[selectinload(ReportDocument.project)]
        )
        assert report.project.id == identity == report.id
    stored = (
        await db_session.execute(
            sa.text("SELECT id, project_id, typeof(id), typeof(project_id) FROM report_documents")
        )
    ).all()
    assert {row[0] for row in stored} == {identity.hex for identity in identities}
    assert all(row[2:] == ("text", "text") for row in stored)


@pytest.mark.asyncio
async def test_existing_graph_survives_uuid_affinity_upgrade_and_remains_writable(tmp_path: Path):
    engine = await _old_database(tmp_path)
    try:
        async with engine.connect() as connection:
            before = await connection.run_sync(
                lambda sync: sa.inspect(sync).get_columns("projects")
            )
            assert not isinstance(next(c["type"] for c in before if c["name"] == "id"), sa.String)
        assert await bootstrap.migrate_local_sqlite_to_head(engine, str(engine.url)) == HEAD
        assert await bootstrap.migrate_local_sqlite_to_head(engine, str(engine.url)) == HEAD
        async with AsyncSession(engine) as session:
            report = await session.get(
                ReportDocument,
                REPORT_ID,
                options=[selectinload(ReportDocument.pages).selectinload(ReportPage.blocks)],
            )
            assert (report.project_id, report.title, report.description, report.version) == (
                PROJECT_ID,
                "Report 10",
                "Retained",
                7,
            )
            assert report.extra_data == {"keep": [1, 2]}
            assert report.updated_at.replace(tzinfo=UTC) == datetime(2026, 9, 1, tzinfo=UTC)
            assert (report.pages[0].id, report.pages[0].version) == (PAGE_ID, 3)
            assert (report.pages[0].blocks[0].id, report.pages[0].blocks[0].version) == (
                BLOCK_ID,
                4,
            )
            assert report.pages[0].blocks[0].content == {"text": "Retained content"}
            child = await session.get(
                SemanticScopeNode, CHILD_ID, options=[selectinload(SemanticScopeNode.parent)]
            )
            assert child.parent.id == SCOPE_ID
            session.add(Project(id=UUID(int=1), name="Numeric ID"))
            await session.commit()
        async with engine.connect() as connection:
            assert (await connection.exec_driver_sql("PRAGMA foreign_keys")).scalar_one() == 1
            assert not (await connection.exec_driver_sql("PRAGMA foreign_key_check")).all()

            def inspect_schema(sync):
                inspector = sa.inspect(sync)
                for table, names in _migration().UUID_COLUMNS.items():
                    columns = {
                        column["name"]: column["type"] for column in inspector.get_columns(table)
                    }
                    assert all(isinstance(columns[name], sa.String) for name in names)
                assert {"ix_report_library_updated", "ix_report_library_created"} <= {
                    i["name"] for i in inspector.get_indexes("report_documents")
                }
                assert "ck_report_document_status" in {
                    c["name"] for c in inspector.get_check_constraints("report_documents")
                }
                parent_fk = next(
                    fk
                    for fk in inspector.get_foreign_keys("semantic_scope_nodes")
                    if fk["constrained_columns"] == ["parent_id"]
                )
                assert parent_fk["referred_table"] == "semantic_scope_nodes"
                assert parent_fk["options"]["ondelete"] == "CASCADE"

            await connection.run_sync(inspect_schema)
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_uuid_upgrade_rejects_already_numeric_id_without_changing_schema(tmp_path: Path):
    engine = await _old_database(tmp_path)
    try:
        async with engine.begin() as connection:
            await connection.execute(
                sa.text(
                    "INSERT INTO projects (id, name, status, extra_data) VALUES (:id, 'Damaged', 'active', '{}')"
                ),
                {"id": UUID(int=1).hex},
            )
        with pytest.raises(RuntimeError, match="Unsafe stored UUID in projects.id"):
            await bootstrap.migrate_local_sqlite_to_head(engine, str(engine.url))
        async with engine.connect() as connection:
            assert (
                await connection.execute(sa.text("SELECT version_num FROM alembic_version"))
            ).scalar_one() == OLD
            assert (
                await connection.execute(
                    sa.text("SELECT typeof(id) FROM projects WHERE name='Damaged'")
                )
            ).scalar_one() == "integer"
            assert (await connection.exec_driver_sql("PRAGMA foreign_keys")).scalar_one() == 1
            columns = await connection.run_sync(
                lambda sync: sa.inspect(sync).get_columns("report_documents")
            )
            assert not isinstance(next(c["type"] for c in columns if c["name"] == "id"), sa.String)
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_invalid_final_graph_rolls_back_schema_data_and_revision(tmp_path: Path, monkeypatch):
    engine = await _old_database(tmp_path)
    original = bootstrap._bootstrap_sync

    def introduce_broken_reference(connection, location):
        result = original(connection, location)
        connection.exec_driver_sql(
            "UPDATE report_documents SET project_id='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'"
        )
        return result

    monkeypatch.setattr(bootstrap, "_bootstrap_sync", introduce_broken_reference)
    try:
        with pytest.raises(RuntimeError, match="已回滚"):
            await bootstrap.migrate_local_sqlite_to_head(engine, str(engine.url))
        async with engine.connect() as connection:
            assert (
                await connection.execute(sa.text("SELECT version_num FROM alembic_version"))
            ).scalar_one() == OLD
            assert (
                await connection.execute(sa.text("SELECT project_id FROM report_documents"))
            ).scalar_one() == PROJECT_ID.hex
            assert (await connection.exec_driver_sql("PRAGMA foreign_keys")).scalar_one() == 1
            assert not (await connection.exec_driver_sql("PRAGMA foreign_key_check")).all()
            columns = await connection.run_sync(
                lambda sync: sa.inspect(sync).get_columns("report_documents")
            )
            assert not isinstance(next(c["type"] for c in columns if c["name"] == "id"), sa.String)
    finally:
        await engine.dispose()


def test_first_ddl_is_rolled_back_and_foreign_keys_restored_on_failure():
    engine = sa.create_engine("sqlite://")
    with engine.connect() as connection:

        def broken_migration():
            connection.exec_driver_sql("CREATE TABLE must_not_survive (id INTEGER PRIMARY KEY)")
            raise RuntimeError("Interrupted")

        with pytest.raises(RuntimeError, match="Interrupted"):
            run_sqlite_migration(connection, broken_migration)
        assert not sa.inspect(connection).has_table("must_not_survive")
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
    engine.dispose()


@pytest.mark.asyncio
async def test_alembic_cli_uses_the_checked_sqlite_upgrade_path(tmp_path: Path):
    engine = await _old_database(tmp_path)
    try:
        # Only this fixture's temporary file is passed to the independent CLI.
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-m",
            "alembic",
            "upgrade",
            "head",
            cwd=str(Path(__file__).resolve().parents[1]),
            env={**os.environ, "DATABASE_URL": str(engine.url)},
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        assert process.returncode == 0, (stdout + stderr).decode()
        async with engine.connect() as connection:
            assert (
                await connection.execute(sa.text("SELECT version_num FROM alembic_version"))
            ).scalar_one() == HEAD
            assert (
                await connection.execute(sa.text("SELECT project_id FROM report_documents"))
            ).scalar_one() == PROJECT_ID.hex
            assert not (await connection.exec_driver_sql("PRAGMA foreign_key_check")).all()
            columns = await connection.run_sync(
                lambda sync: sa.inspect(sync).get_columns("report_documents")
            )
            assert isinstance(next(c["type"] for c in columns if c["name"] == "id"), sa.String)
    finally:
        await engine.dispose()
