"""Single-file multipart admission, using the pinned Starlette parser.

Only the project file-upload route uses this adapter. Other JSON, streaming and
form endpoints retain their own request contracts.
"""

from __future__ import annotations

import asyncio
import errno
import logging
import re
from collections.abc import AsyncGenerator, Awaitable, Callable, Iterator
from contextlib import contextmanager
from threading import Lock

from fastapi import HTTPException, Request, Response
from fastapi.routing import APIRoute
from python_multipart.exceptions import MultipartParseError
from python_multipart.multipart import parse_options_header
from starlette.datastructures import FormData, Headers
from starlette.formparsers import MultiPartException, MultiPartParser
from starlette.types import Message, Receive

from app.core.config import settings

logger = logging.getLogger(__name__)
MULTIPART_OVERHEAD_BYTES = 64 * 1024
PARSER_CHUNK_BYTES = 64 * 1024
PART_HEADER_BYTES = 16 * 1024
_admission_lock = Lock()
_active_uploads = 0


class UploadRequestError(MultiPartException):
    def __init__(self, code: str = "file_upload_invalid", status_code: int = 400):
        super().__init__(code)
        self.code = code
        self.status_code = status_code


def _http_error(error: UploadRequestError) -> HTTPException:
    return HTTPException(
        status_code=error.status_code,
        detail={"code": error.code},
        headers={"Retry-After": "2"} if error.status_code == 429 else None,
    )


def _validate_headers(headers: Headers, max_body_bytes: int) -> None:
    content_types = headers.getlist("content-type")
    if len(content_types) != 1 or len(content_types[0]) > 1024:
        raise UploadRequestError()
    content_type, options = parse_options_header(content_types[0])
    boundary = options.get(b"boundary", b"")
    if content_type != b"multipart/form-data" or not 1 <= len(boundary) <= 200:
        raise UploadRequestError()
    if headers.get("content-encoding", "identity").strip().lower() != "identity":
        raise UploadRequestError()
    lengths = headers.getlist("content-length")
    if lengths:
        if len(lengths) != 1 or re.fullmatch(r"[0-9]{1,20}", lengths[0]) is None:
            raise UploadRequestError()
        if int(lengths[0]) > max_body_bytes:
            raise UploadRequestError("file_upload_too_large", 413)


@contextmanager
def _upload_slot() -> Iterator[None]:
    global _active_uploads
    # No waiting queue: an unaccepted request must not retain a multipart spool.
    # The counter is per process, including when tests use different event loops.
    with _admission_lock:
        if _active_uploads >= settings.FILE_UPLOAD_MAX_CONCURRENT:
            raise UploadRequestError("file_upload_busy", 429)
        _active_uploads += 1
    try:
        yield
    finally:
        with _admission_lock:
            _active_uploads -= 1


async def _receive_or_stop(
    receive: Receive, stopped: asyncio.Task[bool], deadline: float
) -> Message:
    remaining = deadline - asyncio.get_running_loop().time()
    if remaining <= 0:
        raise UploadRequestError("file_upload_timeout", 408)
    reader = asyncio.create_task(receive())
    try:
        done, _ = await asyncio.wait(
            {reader, stopped}, timeout=remaining, return_when=asyncio.FIRST_COMPLETED
        )
        if stopped in done:
            raise asyncio.CancelledError
        if reader not in done:
            raise UploadRequestError("file_upload_timeout", 408)
        return reader.result()
    finally:
        if not reader.done():
            reader.cancel()
        await asyncio.gather(reader, return_exceptions=True)


async def _bounded_stream(
    receive: Receive, cancelled: asyncio.Event, max_bytes: int, timeout: float
) -> AsyncGenerator[bytes, None]:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    stopped = asyncio.create_task(cancelled.wait())
    total = 0
    try:
        while True:
            if cancelled.is_set():
                raise asyncio.CancelledError
            message = await _receive_or_stop(receive, stopped, deadline)
            if message["type"] != "http.request":
                raise UploadRequestError()  # Includes a client disconnect.
            body = message.get("body", b"")
            total += len(body)
            if total > max_bytes:
                raise UploadRequestError("file_upload_too_large", 413)
            # ASGI transports choose their own message size. Do not pass an
            # arbitrarily large message to the parser's synchronous callbacks.
            for offset in range(0, len(body), PARSER_CHUNK_BYTES):
                if cancelled.is_set():
                    raise asyncio.CancelledError
                if loop.time() >= deadline:
                    raise UploadRequestError("file_upload_timeout", 408)
                yield body[offset : offset + PARSER_CHUNK_BYTES]
            if not message.get("more_body", False):
                break
        if loop.time() >= deadline:
            raise UploadRequestError("file_upload_timeout", 408)
        yield b""
    finally:
        stopped.cancel()
        await asyncio.gather(stopped, return_exceptions=True)


class _SingleFileParser(MultiPartParser):
    def __init__(self, headers: Headers, stream: AsyncGenerator[bytes, None], max_bytes: int):
        super().__init__(
            headers, stream, max_files=1, max_fields=0, max_part_size=PART_HEADER_BYTES
        )
        self.max_file_bytes = max_bytes
        self.header_bytes = 0
        self.file_bytes = 0
        self.complete = False

    def on_part_begin(self) -> None:
        self.header_bytes = 0
        self.file_bytes = 0
        super().on_part_begin()

    def _count_header(self, count: int) -> None:
        self.header_bytes += count
        if self.header_bytes > PART_HEADER_BYTES:
            raise UploadRequestError()

    def on_header_field(self, data: bytes, start: int, end: int) -> None:
        self._count_header(end - start)
        super().on_header_field(data, start, end)

    def on_header_value(self, data: bytes, start: int, end: int) -> None:
        self._count_header(end - start)
        super().on_header_value(data, start, end)

    def on_headers_finished(self) -> None:
        super().on_headers_finished()
        if self._current_part.field_name != "file" or self._current_part.file is None:
            raise UploadRequestError()

    def on_part_data(self, data: bytes, start: int, end: int) -> None:
        self.file_bytes += end - start
        if self.file_bytes > self.max_file_bytes:
            raise UploadRequestError("file_upload_too_large", 413)
        super().on_part_data(data, start, end)

    def on_end(self) -> None:
        self.complete = True
        super().on_end()

    def close_files(self) -> None:
        # Pinned Starlette owns this registry, including incomplete parts that
        # never reach FormData. Its normal error path does not cover every
        # parser exception/cancellation. Never close while a writer is active.
        for file in self._files_to_close_on_error:
            try:
                file.close()
            except OSError:
                logger.warning("Could not close upload spool", exc_info=True)

    async def parse(self) -> FormData:
        try:
            form = await super().parse()
            if not self.complete or len(form.multi_items()) != 1:
                raise UploadRequestError()
            return form
        except BaseException:
            self.close_files()
            raise


async def _parse_until_stopped(parser: _SingleFileParser, cancelled: asyncio.Event) -> FormData:
    # Shield the entire parse, including its thread-backed spool writes. Stop
    # cooperatively at the next receive/chunk, then drain before closing files.
    worker = asyncio.create_task(parser.parse())
    cancellation_requested = False
    while not worker.done():
        try:
            await asyncio.shield(worker)
        except asyncio.CancelledError:
            cancellation_requested = True
            cancelled.set()
        except Exception:
            break
    if cancellation_requested:
        try:
            worker.result()
        except BaseException:
            pass
        raise asyncio.CancelledError
    return worker.result()


class SingleFileUploadRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Awaitable[Response]]:
        original_handler = super().get_route_handler()

        async def upload_handler(request: Request) -> Response:
            max_file_bytes = settings.FILE_UPLOAD_MAX_BYTES
            max_body_bytes = max_file_bytes + MULTIPART_OVERHEAD_BYTES
            try:
                _validate_headers(request.headers, max_body_bytes)
                with _upload_slot():
                    # The same cancellation flag must reach the stream and
                    # parser drain even when a receive is waiting indefinitely.
                    cancelled = asyncio.Event()
                    stream = _bounded_stream(
                        request.receive,
                        cancelled,
                        max_body_bytes,
                        settings.FILE_UPLOAD_RECEIVE_TIMEOUT_SECONDS,
                    )
                    parser = _SingleFileParser(request.headers, stream, max_file_bytes)
                    try:
                        form = await _parse_until_stopped(parser, cancelled)
                        prepared = Request(request.scope, request.receive)
                        # Reuse Starlette's form cache so FastAPI keeps its
                        # UploadFile validation/OpenAPI and does not parse twice.
                        prepared._form = form
                        return await original_handler(prepared)
                    finally:
                        parser.close_files()
                        await stream.aclose()
            except UploadRequestError as exc:
                raise _http_error(exc) from exc
            except (MultiPartException, MultipartParseError) as exc:
                raise _http_error(UploadRequestError()) from exc
            except OSError as exc:
                logger.warning("Upload admission storage failure", exc_info=True)
                full = exc.errno in {errno.ENOSPC, errno.EDQUOT}
                raise _http_error(
                    UploadRequestError(
                        "file_upload_no_space" if full else "file_upload_write_failed",
                        507 if full else 503,
                    )
                ) from exc

        return upload_handler
