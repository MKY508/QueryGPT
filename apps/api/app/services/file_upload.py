"""Publish one owned upload copy without blocking the request's event loop.

FastAPI has already parsed/spooled the multipart body before this service runs.
The byte cap here limits accepted source copies, not incoming request bodies.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from threading import Event
from typing import BinaryIO

logger = logging.getLogger(__name__)
COPY_CHUNK_BYTES = 1024 * 1024


class UploadRejectedError(ValueError):
    def __init__(self, code: str, message: str, status_code: int):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


def check_upload_size(size: int, max_bytes: int) -> None:
    if size == 0:
        raise UploadRejectedError("file_upload_empty", "这份文件是空的，请选择有内容的文件", 400)
    if size > max_bytes:
        raise UploadRejectedError("file_upload_too_large", "这份文件过大，请拆分后再上传", 413)


@dataclass(frozen=True)
class StoredUpload:
    path: Path
    fingerprint: str
    size: int


def remove_upload_copy(source_dir: Path) -> None:
    """Only call for a fresh directory this upload successfully created."""
    try:
        shutil.rmtree(source_dir)
    except FileNotFoundError:
        pass
    except OSError:
        # Cleanup must not mask the upload/transaction error. Never broaden it
        # to a parent directory or an external source if removal fails.
        logger.warning("Could not remove owned upload directory %s", source_dir, exc_info=True)


def _copy_upload(
    stream: BinaryIO,
    source_dir: Path,
    filename: str,
    max_bytes: int,
    cancelled: Event,
) -> StoredUpload:
    # No overwrite/reuse: a collision must not delete somebody else's files.
    source_dir.mkdir(parents=True, exist_ok=False)
    try:
        partial = source_dir / ".upload-part"
        destination = source_dir / filename
        digest = hashlib.sha256()
        size = 0
        stream.seek(0)
        with partial.open("xb") as output:
            while True:
                if cancelled.is_set():
                    raise asyncio.CancelledError
                chunk = stream.read(COPY_CHUNK_BYTES)
                if not chunk:
                    break
                size += len(chunk)
                check_upload_size(size, max_bytes)
                output.write(chunk)
                digest.update(chunk)
            check_upload_size(size, max_bytes)
            output.flush()
            os.fsync(output.fileno())
        if cancelled.is_set():
            raise asyncio.CancelledError
        partial.replace(destination)
        return StoredUpload(destination.resolve(), digest.hexdigest(), size)
    except BaseException:
        remove_upload_copy(source_dir)
        raise


async def store_upload(
    stream: BinaryIO, source_dir: Path, filename: str, *, max_bytes: int
) -> StoredUpload:
    """Drain cancellation before FastAPI closes the worker's input file.

    Shielding alone is insufficient: the request must wait for its worker to stop
    before cleaning a copy or allowing the multipart spool to close. Cancellation
    is cooperative between reads; it cannot interrupt a stalled filesystem call.
    """
    cancelled = Event()
    worker = asyncio.create_task(
        asyncio.to_thread(_copy_upload, stream, source_dir, filename, max_bytes, cancelled)
    )
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
            pass  # Failed workers clean only their own directory.
        else:
            remove_upload_copy(source_dir)
        raise asyncio.CancelledError
    return worker.result()
