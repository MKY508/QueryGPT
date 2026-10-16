"""Idempotent save replay with a bounded per-report storage footprint."""

import hashlib
import json
import zlib
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.db.tables import ReportSaveReceipt
from app.models.reports import ReportDocumentResponse, ReportUpdate

RECEIPTS_PER_REPORT = 8
MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024
MAX_COMPRESSED_BYTES = 8 * 1024 * 1024


def request_hash(payload: ReportUpdate) -> str:
    data = payload.model_dump(
        mode="json", exclude_unset=True, exclude={"save_request_id", "retry_save"}
    )
    digest = hashlib.sha256()
    try:
        for chunk in json.JSONEncoder(
            sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
        ).iterencode(data):
            digest.update(chunk.encode("utf-8"))
    except (ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=422, detail={"code": "report_save_invalid_payload"}
        ) from exc
    return digest.hexdigest()


def _encode(document: ReportDocumentResponse) -> bytes:
    raw = document.model_dump_json().encode("utf-8")
    if len(raw) > MAX_SNAPSHOT_BYTES:
        raise HTTPException(status_code=413, detail={"code": "report_save_receipt_too_large"})
    compressed = zlib.compress(raw, level=1)
    if len(compressed) > MAX_COMPRESSED_BYTES:
        raise HTTPException(status_code=413, detail={"code": "report_save_receipt_too_large"})
    return compressed


def _decode(snapshot: bytes) -> ReportDocumentResponse:
    decoder = zlib.decompressobj()
    raw = decoder.decompress(snapshot, MAX_SNAPSHOT_BYTES + 1)
    if len(raw) > MAX_SNAPSHOT_BYTES or not decoder.eof or decoder.unused_data:
        raise ValueError("Invalid report-save receipt")
    return ReportDocumentResponse.model_validate_json(raw)


async def replay_save(
    db: AsyncSession,
    report_id: UUID,
    payload: ReportUpdate,
    digest: str,
) -> ReportDocumentResponse | None:
    receipt = await db.get(ReportSaveReceipt, str(payload.save_request_id))
    if receipt is None:
        return None
    if receipt.report_id != report_id or receipt.request_hash != digest:
        raise HTTPException(status_code=409, detail={"code": "report_save_key_reused"})
    document = await run_in_threadpool(_decode, receipt.snapshot)
    if document.id != report_id or document.version != receipt.result_version:
        raise ValueError("Report-save receipt identity mismatch")
    return document


async def record_save(
    db: AsyncSession,
    report_id: UUID,
    payload: ReportUpdate,
    digest: str,
    document: ReportDocumentResponse,
) -> None:
    snapshot = await run_in_threadpool(_encode, document)
    db.add(
        ReportSaveReceipt(
            request_id=str(payload.save_request_id),
            report_id=report_id,
            request_hash=digest,
            result_version=document.version,
            snapshot=snapshot,
        )
    )
    await db.flush()
    expired = (
        select(ReportSaveReceipt.request_id)
        .where(ReportSaveReceipt.report_id == report_id)
        .order_by(
            ReportSaveReceipt.result_version.desc(),
            ReportSaveReceipt.request_id.desc(),
        )
        .offset(RECEIPTS_PER_REPORT)
    )
    await db.execute(delete(ReportSaveReceipt).where(ReportSaveReceipt.request_id.in_(expired)))


def unconfirmed_save() -> HTTPException:
    # A missing old receipt is not evidence that the original save never committed.
    return HTTPException(status_code=409, detail={"code": "report_save_unconfirmed"})
