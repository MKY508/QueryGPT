"""Small receipt checks with real publication transactions and isolated files."""

import asyncio
import hashlib
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import inspect, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db import get_db
from app.db.tables import Base, FileUploadReceipt, Project, ProjectDataSource
from app.main import app
from app.services.migration_bootstrap import migrate_local_sqlite_to_head
from tests.test_migration_bootstrap import HEAD, _engine


@pytest.mark.asyncio
async def test_upload_expected_content_rejects_changed_bytes_before_publication(
    client, db_session, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "WORKSPACE_ROOT", tmp_path)
    project = (await client.post("/api/v1/projects", json={"name": "Verified uploads"})).json()[
        "data"
    ]["id"]
    request_id = str(uuid4())
    url = f"/api/v1/projects/{project}/sources/files"
    payload = b"id,amount\n1,10\n"
    headers = {"Idempotency-Key": request_id, "X-File-SHA256": hashlib.sha256(payload).hexdigest()}
    wrong = await client.post(
        url, headers=headers, files={"file": ("orders.csv", b"id,amount\n1,20\n", "text/csv")}
    )
    assert (
        wrong.status_code == 409 and wrong.json()["detail"]["code"] == "file_upload_content_changed"
    )
    assert await db_session.get(FileUploadReceipt, (UUID(project), UUID(request_id))) is None
    assert (await db_session.scalars(select(ProjectDataSource))).all() == []
    assert list((tmp_path / project / "sources").iterdir()) == []
    malformed = await client.post(
        url,
        headers={**headers, "X-File-SHA256": "invalid"},
        files={"file": ("orders.csv", payload, "text/csv")},
    )
    assert malformed.status_code == 422
    first = await client.post(
        url, headers=headers, files={"file": ("orders.csv", payload, "text/csv")}
    )
    assert first.status_code == 200, first.text
    repeat = await client.post(
        url, headers=headers, files={"file": ("orders.csv", payload, "text/csv")}
    )
    assert repeat.json()["data"]["id"] == first.json()["data"]["id"]
    assert first.json()["data"]["fingerprint"] == headers["X-File-SHA256"]
    assert len(list((tmp_path / project / "sources").iterdir())) == 1


@pytest.mark.asyncio
async def test_upload_receipt_rejects_changed_bytes_and_keeps_removal_and_project_scope(
    client, db_session, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "WORKSPACE_ROOT", tmp_path)
    project = (await client.post("/api/v1/projects", json={"name": "Uploads"})).json()["data"]["id"]
    other = (await client.post("/api/v1/projects", json={"name": "Other"})).json()["data"]["id"]
    request_id = str(uuid4())
    url = f"/api/v1/projects/{project}/sources/files"
    check = f"/api/v1/projects/{project}/source-uploads/{request_id}"
    headers = {"Idempotency-Key": request_id}
    payload = {"file": ("orders.csv", b"id,amount\n1,10\n", "text/csv")}
    assert (await client.get(check)).json()["data"] is None
    first = await client.post(url, files=payload, headers=headers)
    assert first.status_code == 200, first.text
    source_id = first.json()["data"]["id"]
    repeat = await client.post(url, files=payload, headers=headers)
    assert repeat.json()["data"]["id"] == source_id
    receipt = (await client.get(check)).json()["data"]
    assert receipt["status"] == "added" and receipt["source_id"] == source_id
    assert receipt["byte_size"] == len(payload["file"][1])
    assert (await client.get(f"/api/v1/projects/{other}/source-uploads/{request_id}")).json()[
        "data"
    ] is None
    changed = await client.post(
        url, headers=headers, files={"file": ("orders.csv", b"id,amount\n1,20\n", "text/csv")}
    )
    assert (
        changed.status_code == 409 and changed.json()["detail"]["code"] == "file_upload_key_reused"
    )
    assert len(list((tmp_path / project / "sources").iterdir())) == 1
    source = await db_session.get(ProjectDataSource, UUID(source_id))
    assert Path(source.source_uri).read_bytes() == payload["file"][1]
    # A normal rename must not invalidate the original upload identity.
    source.name = "Renamed orders"
    await db_session.commit()
    assert (await client.post(url, files=payload, headers=headers)).json()["data"][
        "name"
    ] == "Renamed orders"
    await db_session.delete(source)
    await db_session.commit()
    assert (await client.get(check)).json()["data"]["status"] == "removed"
    repeat = await client.post(url, files=payload, headers=headers)
    assert (
        repeat.status_code == 409
        and repeat.json()["detail"]["code"] == "file_upload_source_removed"
    )
    assert await db_session.get(FileUploadReceipt, (UUID(project), UUID(request_id))) is not None
    assert list((tmp_path / project / "sources").iterdir()) == [
        tmp_path / project / "sources" / source_id
    ]


@pytest.mark.asyncio
async def test_simultaneous_upload_intents_publish_one_source_across_database_sessions(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "WORKSPACE_ROOT", tmp_path / "files")
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'concurrent.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def independent_session():
        async with sessions() as db:
            yield db

    previous = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = independent_session
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            project = (await client.post("/api/v1/projects", json={"name": "Concurrent"})).json()[
                "data"
            ]["id"]
            headers = {"Idempotency-Key": str(uuid4())}
            url = f"/api/v1/projects/{project}/sources/files"
            responses = await asyncio.gather(
                *[
                    client.post(
                        url, headers=headers, files={"file": ("orders.csv", b"id\n1\n", "text/csv")}
                    )
                    for _ in range(2)
                ]
            )
            assert all(response.status_code == 200 for response in responses), [
                response.text for response in responses
            ]
            assert len({response.json()["data"]["id"] for response in responses}) == 1
            async with sessions() as db:
                assert len((await db.scalars(select(ProjectDataSource))).all()) == 1
                assert len((await db.scalars(select(FileUploadReceipt))).all()) == 1
            assert len(list((tmp_path / "files" / project / "sources").iterdir())) == 1
    finally:
        if previous is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous
        await engine.dispose()


@pytest.mark.asyncio
async def test_previous_schema_adds_upload_receipts_without_changing_sources(tmp_path):
    engine = _engine(tmp_path / "upload-upgrade.db")
    try:
        await migrate_local_sqlite_to_head(engine, str(engine.url))
        async with AsyncSession(engine, expire_on_commit=False) as db:
            project = Project(name="Retained")
            db.add(project)
            await db.flush()
            source = ProjectDataSource(
                project_id=project.id,
                name="orders.csv",
                kind="file",
                format="csv",
                fingerprint="a" * 64,
            )
            db.add(source)
            await db.commit()
            identity = source.id
        async with engine.begin() as connection:
            await connection.execute(text("DROP TABLE file_upload_receipts"))
            await connection.execute(
                text("UPDATE alembic_version SET version_num = '0028_report_copy_receipts'")
            )
        assert await migrate_local_sqlite_to_head(engine, str(engine.url)) == HEAD
        assert await migrate_local_sqlite_to_head(engine, str(engine.url)) == HEAD
        async with AsyncSession(engine) as db:
            source = await db.get(ProjectDataSource, identity)
            assert source.name == "orders.csv" and source.fingerprint == "a" * 64
            assert await db.scalar(text("SELECT count(*) FROM file_upload_receipts")) == 0
        async with engine.connect() as connection:
            pk = await connection.run_sync(
                lambda sync: inspect(sync).get_pk_constraint("file_upload_receipts")
            )
            assert pk["constrained_columns"] == ["project_id", "request_id"]
    finally:
        await engine.dispose()
