"""Small synthetic checks for upload ownership, cancellation and publication."""

from __future__ import annotations

import asyncio
import errno
import hashlib
import io
from pathlib import Path
from threading import Event
from unittest.mock import AsyncMock
from uuid import UUID

import pytest

from app.api.v1 import projects as projects_api
from app.core.config import settings
from app.db.tables import ProjectDataSource
from app.services import file_upload


@pytest.mark.asyncio
async def test_upload_hashes_once_in_bounded_chunks_and_preserves_long_extension(tmp_path):
    payload = b"id,amount\n" + b"1,10\n" * 220_000

    class RecordingInput(io.BytesIO):
        reads: list[int] = []

        def read(self, size=-1):
            self.reads.append(size)
            return super().read(size)

    stream = RecordingInput(payload)
    filename = projects_api._safe_filename("C:\\folder\\" + "订单" * 100 + ".csv")
    result = await file_upload.store_upload(
        stream, tmp_path / "source", filename, max_bytes=len(payload)
    )
    assert result.path.read_bytes() == payload
    assert result.fingerprint == hashlib.sha256(payload).hexdigest()
    assert result.size == len(payload)
    assert sum(size == file_upload.COPY_CHUNK_BYTES for size in stream.reads) == 3
    assert result.path.suffix == ".csv" and len(filename.encode()) <= 180
    assert list(result.path.parent.iterdir()) == [result.path]
    assert projects_api._safe_filename("CON.csv") == "_CON.csv"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload,code", [(b"", "file_upload_empty"), (b"abc", "file_upload_too_large")]
)
async def test_rejected_uploads_leave_no_source_copy(tmp_path, payload, code):
    source_dir = tmp_path / "source"
    with pytest.raises(file_upload.UploadRejectedError) as failure:
        await file_upload.store_upload(io.BytesIO(payload), source_dir, "orders.csv", max_bytes=2)
    assert failure.value.code == code
    assert not source_dir.exists()


@pytest.mark.asyncio
async def test_write_failure_cleans_owned_copy_but_collision_preserves_existing(
    tmp_path, monkeypatch
):
    source_dir = tmp_path / "source"

    def disk_full(_fd):
        raise OSError(errno.ENOSPC, "synthetic full disk")

    monkeypatch.setattr(file_upload.os, "fsync", disk_full)
    with pytest.raises(OSError, match="synthetic full disk"):
        await file_upload.store_upload(io.BytesIO(b"abc"), source_dir, "orders.csv", max_bytes=10)
    assert not source_dir.exists()
    source_dir.mkdir()
    existing = source_dir / "original.csv"
    existing.write_bytes(b"preserve me")
    with pytest.raises(FileExistsError):
        await file_upload.store_upload(io.BytesIO(b"abc"), source_dir, "orders.csv", max_bytes=10)
    assert existing.read_bytes() == b"preserve me"


@pytest.mark.asyncio
async def test_cancellation_waits_for_worker_before_input_can_close(tmp_path):
    loop = asyncio.get_running_loop()
    started = asyncio.Event()
    release = Event()

    class PausedInput(io.BytesIO):
        def read(self, size=-1):
            loop.call_soon_threadsafe(started.set)
            assert release.wait(timeout=3), "test did not release upload read"
            assert not self.closed
            return super().read(size)

    stream = PausedInput(b"id,amount\n1,10\n")
    source_dir = tmp_path / "source"
    task = asyncio.create_task(
        file_upload.store_upload(stream, source_dir, "orders.csv", max_bytes=100)
    )
    try:
        await asyncio.wait_for(started.wait(), timeout=3)
        task.cancel()
        await asyncio.sleep(0)
        task.cancel()  # A repeated cancellation must not orphan the same worker.
        await asyncio.sleep(0)
        assert not task.done()
    finally:
        release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    stream.close()
    assert not source_dir.exists()


@pytest.mark.asyncio
async def test_failed_flush_removes_copy_before_commit(client, db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "WORKSPACE_ROOT", tmp_path)
    project = (await client.post("/api/v1/projects", json={"name": "Upload"})).json()["data"]
    commit = AsyncMock()
    monkeypatch.setattr(db_session, "commit", commit)
    monkeypatch.setattr(db_session, "flush", AsyncMock(side_effect=RuntimeError("flush failed")))
    with pytest.raises(RuntimeError, match="flush failed"):
        await client.post(
            f"/api/v1/projects/{project['id']}/sources/files",
            files={"file": ("orders.csv", b"id,amount\n1,10\n", "text/csv")},
        )
    commit.assert_not_awaited()
    assert list((tmp_path / project["id"] / "sources").iterdir()) == []


@pytest.mark.asyncio
async def test_lost_commit_response_preserves_already_saved_file(
    client, db_session, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "WORKSPACE_ROOT", tmp_path)
    project = (await client.post("/api/v1/projects", json={"name": "Upload"})).json()["data"]
    commit = db_session.commit

    async def commit_then_disconnect():
        await commit()
        raise ConnectionError("synthetic lost acknowledgement")

    monkeypatch.setattr(db_session, "commit", commit_then_disconnect)
    request_id = "62423412-83d9-4e55-96d1-f19e94c02884"
    response = await client.post(
        f"/api/v1/projects/{project['id']}/sources/files",
        headers={"Idempotency-Key": request_id},
        files={"file": ("orders.csv", b"id,amount\n1,10\n", "text/csv")},
    )
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "file_upload_outcome_unknown"
    sources = (await client.get(f"/api/v1/projects/{project['id']}/sources")).json()["data"]
    assert len(sources) == 1
    saved = await db_session.get(ProjectDataSource, UUID(sources[0]["id"]))
    assert saved is not None and saved.source_uri is not None
    assert Path(saved.source_uri).read_bytes() == b"id,amount\n1,10\n"
    monkeypatch.setattr(db_session, "commit", commit)
    checked = (
        await client.get(f"/api/v1/projects/{project['id']}/source-uploads/{request_id}")
    ).json()["data"]
    assert checked["status"] == "added" and checked["source_id"] == sources[0]["id"]
    repeated = await client.post(
        f"/api/v1/projects/{project['id']}/sources/files",
        headers={"Idempotency-Key": request_id},
        files={"file": ("orders.csv", b"id,amount\n1,10\n", "text/csv")},
    )
    assert repeated.status_code == 200 and repeated.json()["data"]["id"] == sources[0]["id"]


@pytest.mark.asyncio
async def test_api_rejects_oversize_and_empty_before_creating_source(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "WORKSPACE_ROOT", tmp_path)
    monkeypatch.setattr(settings, "FILE_UPLOAD_MAX_BYTES", 2)
    project = (await client.post("/api/v1/projects", json={"name": "Upload"})).json()["data"]
    for payload, status, code in [
        (b"abc", 413, "file_upload_too_large"),
        (b"", 400, "file_upload_empty"),
    ]:
        response = await client.post(
            f"/api/v1/projects/{project['id']}/sources/files",
            files={"file": ("orders.csv", payload, "text/csv")},
        )
        assert response.status_code == status
        assert response.json()["detail"]["code"] == code
    assert (await client.get(f"/api/v1/projects/{project['id']}/sources")).json()["data"] == []
    assert list((tmp_path / project["id"] / "sources").iterdir()) == []
