"""Synthetic ASGI messages exercise limits before FastAPI parses an upload."""

from __future__ import annotations

import asyncio
import errno
import json
from unittest.mock import AsyncMock

import pytest
from fastapi import APIRouter, FastAPI, File, Request, UploadFile
from starlette import formparsers
from starlette.datastructures import UploadFile as StarletteUploadFile

from app.api import upload_route
from app.core.config import settings

PREFIX = (
    b'--receiptbi\r\nContent-Disposition: form-data; name="file"; filename="orders.csv"\r\n\r\n'
)
ENDING = b"\r\n--receiptbi--\r\n"
HEADERS = [(b"content-type", b"multipart/form-data; boundary=receiptbi")]


@pytest.fixture
def uploads(monkeypatch):
    monkeypatch.setattr(settings, "FILE_UPLOAD_MAX_BYTES", 1024)
    monkeypatch.setattr(settings, "FILE_UPLOAD_MAX_CONCURRENT", 1)
    monkeypatch.setattr(settings, "FILE_UPLOAD_RECEIVE_TIMEOUT_SECONDS", 2)
    app = FastAPI()
    router = APIRouter(route_class=upload_route.SingleFileUploadRoute)
    files = []
    calls = []
    spool = formparsers.SpooledTemporaryFile

    def tracked_spool(*args, **kwargs):
        # Exercise real disk rollover with a tiny fixture instead of big files.
        kwargs["max_size"] = 32
        file = spool(*args, **kwargs)
        files.append(file)
        return file

    monkeypatch.setattr(formparsers, "SpooledTemporaryFile", tracked_spool)

    @router.post("/upload")
    async def endpoint(request: Request, file: UploadFile = File(...)):
        calls.append(file.filename)
        assert (await request.form())["file"] is file
        return {"size": file.size, "text": (await file.read()).decode()}

    app.include_router(router)

    @app.post("/ordinary")
    async def ordinary(request: Request):
        return {"size": len(await request.body())}

    return app, files, calls


async def invoke(app, receive, *, headers=None, path="/upload"):
    sent = []

    async def send(message):
        sent.append(message)

    await app(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": b"",
            "headers": HEADERS if headers is None else headers,
            "client": ("127.0.0.1", 1),
            "server": ("test", 80),
        },
        receive,
        send,
    )
    start = next(message for message in sent if message["type"] == "http.response.start")
    body = b"".join(
        message.get("body", b"") for message in sent if message["type"] == "http.response.body"
    )
    return start["status"], json.loads(body), start.get("headers", [])


def messages(*chunks):
    events = iter(
        [
            {"type": "http.request", "body": chunk, "more_body": index < len(chunks) - 1}
            for index, chunk in enumerate(chunks)
        ]
    )

    async def receive():
        return next(events)

    return receive


@pytest.mark.asyncio
async def test_chunked_form_is_parsed_once_and_spool_closes(uploads):
    app, files, calls = uploads
    payload = b"id,amount\n" + b"1,10\n" * 10
    status, result, _ = await invoke(
        app, messages(PREFIX[:10], PREFIX[10:] + payload[:9], payload[9:] + ENDING)
    )
    assert status == 200 and result == {"size": len(payload), "text": payload.decode()}
    assert calls == ["orders.csv"] and len(files) == 1
    assert files[0]._rolled and files[0].closed
    assert (
        "multipart/form-data" in app.openapi()["paths"]["/upload"]["post"]["requestBody"]["content"]
    )


@pytest.mark.asyncio
async def test_declared_oversize_is_rejected_without_reading_body(uploads):
    app, files, calls = uploads

    async def never_receive():
        pytest.fail("rejected headers must not consume request data")

    headers = HEADERS + [
        (b"content-length", str(1025 + upload_route.MULTIPART_OVERHEAD_BYTES).encode())
    ]
    status, result, _ = await invoke(app, never_receive, headers=headers)
    assert status == 413 and result["detail"]["code"] == "file_upload_too_large"
    assert not files and not calls


@pytest.mark.asyncio
async def test_streamed_size_does_not_trust_missing_or_false_length(uploads, monkeypatch):
    app, files, calls = uploads
    monkeypatch.setattr(settings, "FILE_UPLOAD_MAX_BYTES", 8)
    for headers in [HEADERS, HEADERS + [(b"content-length", b"1")]]:
        status, result, _ = await invoke(
            app, messages(PREFIX + b"abc", b"defghijkl" + ENDING), headers=headers
        )
        assert status == 413 and result["detail"]["code"] == "file_upload_too_large"
    # Total-body accounting also runs before an oversized ASGI message reaches
    # the parser, independently of the per-file callback limit.
    status, _, _ = await invoke(app, messages(PREFIX, b"x" * upload_route.MULTIPART_OVERHEAD_BYTES))
    assert status == 413
    assert not calls and files and all(file.closed for file in files)


@pytest.mark.asyncio
async def test_malformed_and_extra_parts_close_even_unfinished_files(uploads):
    app, files, calls = uploads
    for body in [
        PREFIX + b"unfinished",  # No terminal boundary.
        PREFIX + b"first\r\n" + PREFIX + b"second" + ENDING,
        PREFIX
        + b'first\r\n--receiptbi\r\nContent-Disposition: form-data; name="extra"\r\n\r\ntext'
        + ENDING,
        PREFIX + b"first\r\n--receiptbi\r\n" + b"x" * (upload_route.PART_HEADER_BYTES + 1),
        PREFIX + b"first\r\n--receiptbi\r\ninvalid header\r\n",  # Native parser exception.
    ]:
        status, result, _ = await invoke(app, messages(body))
        assert status == 400 and result["detail"]["code"] == "file_upload_invalid"
        assert all(file.closed for file in files)
    assert not calls


@pytest.mark.asyncio
async def test_disconnect_and_cancellation_close_incomplete_spools(uploads):
    app, files, calls = uploads
    waiting = asyncio.Event()

    def interrupted(*, cancel):
        first = True

        async def receive():
            nonlocal first
            if first:
                first = False
                return {"type": "http.request", "body": PREFIX + b"content", "more_body": True}
            waiting.set()
            if cancel:
                await asyncio.Event().wait()
            return {"type": "http.disconnect"}

        return receive

    status, _, _ = await invoke(app, interrupted(cancel=False))
    assert status == 400 and all(file.closed for file in files)
    waiting.clear()
    task = asyncio.create_task(invoke(app, interrupted(cancel=True)))
    await asyncio.wait_for(waiting.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(task, 1)
    assert not calls and all(file.closed for file in files)
    assert upload_route._active_uploads == 0


@pytest.mark.asyncio
async def test_repeated_cancellation_drains_an_active_spool_writer(uploads, monkeypatch):
    app, files, calls = uploads
    writing = asyncio.Event()
    release = asyncio.Event()
    write = StarletteUploadFile.write

    async def paused_write(self, data):
        writing.set()
        await release.wait()
        assert not self.file.closed
        await write(self, data)

    monkeypatch.setattr(StarletteUploadFile, "write", paused_write)
    task = asyncio.create_task(invoke(app, messages(PREFIX + b"data", ENDING)))
    try:
        await asyncio.wait_for(writing.wait(), 1)
        task.cancel()
        await asyncio.sleep(0)
        task.cancel()
        await asyncio.sleep(0)
        assert not task.done() and files and not files[0].closed
    finally:
        release.set()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(task, 1)
    assert not calls and all(file.closed for file in files)
    assert upload_route._active_uploads == 0


@pytest.mark.asyncio
async def test_timeout_releases_capacity_and_does_not_limit_other_routes(uploads, monkeypatch):
    app, files, calls = uploads
    monkeypatch.setattr(settings, "FILE_UPLOAD_RECEIVE_TIMEOUT_SECONDS", 0.03)
    waiting = asyncio.Event()
    first = True

    async def stalled_receive():
        nonlocal first
        if first:
            first = False
            return {"type": "http.request", "body": PREFIX + b"data", "more_body": True}
        waiting.set()
        await asyncio.Event().wait()

    stalled = asyncio.create_task(invoke(app, stalled_receive))
    await asyncio.wait_for(waiting.wait(), 1)

    async def never_receive():
        pytest.fail("busy request must not start a second spool")

    status, result, headers = await invoke(app, never_receive)
    assert status == 429 and result["detail"]["code"] == "file_upload_busy"
    assert (b"retry-after", b"2") in headers
    status, result, _ = await invoke(app, messages(b"x" * 2048), path="/ordinary", headers=[])
    assert status == 200 and result["size"] == 2048
    status, result, _ = await asyncio.wait_for(stalled, 1)
    assert status == 408 and result["detail"]["code"] == "file_upload_timeout"
    assert not calls and all(file.closed for file in files)
    status, _, _ = await invoke(app, messages(PREFIX + b"retry" + ENDING))
    assert status == 200 and upload_route._active_uploads == 0


@pytest.mark.asyncio
async def test_spool_write_error_has_safe_code_and_closes_file(uploads, monkeypatch):
    app, files, calls = uploads

    async def failed_write(self, data):
        raise OSError(errno.ENOSPC, "/private/synthetic/path")

    monkeypatch.setattr(StarletteUploadFile, "write", failed_write)
    status, result, _ = await invoke(app, messages(PREFIX + b"data" + ENDING))
    assert status == 507 and result["detail"] == {"code": "file_upload_no_space"}
    assert not calls and files and all(file.closed for file in files)
    assert upload_route._active_uploads == 0


@pytest.mark.asyncio
async def test_real_project_route_rejects_disconnect_before_database_access(monkeypatch):
    from app.api.v1 import projects
    from app.main import app

    lookup = AsyncMock(side_effect=AssertionError("incomplete upload must not access a project"))
    monkeypatch.setattr(projects, "_project_or_404", lookup)
    events = iter(
        [
            {"type": "http.request", "body": PREFIX + b"partial", "more_body": True},
            {"type": "http.disconnect"},
        ]
    )

    async def receive():
        return next(events, {"type": "http.disconnect"})

    status, result, _ = await invoke(
        app, receive, path="/api/v1/projects/00000000-0000-0000-0000-000000000001/sources/files"
    )
    assert status == 400 and result["detail"]["code"] == "file_upload_invalid"
    lookup.assert_not_awaited()
    assert upload_route._active_uploads == 0
