"""Transactional report history. Call record only after claiming the report writer."""

import hashlib
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.db.tables import ReportDocument, ReportRevision
from app.models.reports import ReportDocumentResponse
from app.services.report_save_receipts import _decode, _encode


def report_baseline(report: ReportDocument) -> ReportDocumentResponse:
    return ReportDocumentResponse.model_validate(report).model_copy(deep=True)


async def record_revision(db: AsyncSession, document: ReportDocumentResponse, reason: str) -> None:
    # Existing source links can disappear without changing a report's version.
    # Never rewrite the snapshot that was actually recorded for that version.
    if await db.get(ReportRevision, (document.id, document.version)) is not None:
        return
    try:
        snapshot = await run_in_threadpool(_encode, document)
    except HTTPException as exc:
        raise HTTPException(status_code=413, detail={"code": "report_history_too_large"}) from exc
    db.add(
        ReportRevision(
            report_id=document.id,
            version=document.version,
            title=document.title,
            saved_at=document.updated_at,
            reason=reason,
            page_count=len(document.pages),
            block_count=sum(len(page.blocks) for page in document.pages),
            snapshot=snapshot,
            snapshot_hash=hashlib.sha256(snapshot).hexdigest(),
        )
    )
    await db.flush()


async def read_revision(
    db: AsyncSession, project_id: UUID, report_id: UUID, version: int
) -> ReportDocumentResponse:
    revision = await db.get(ReportRevision, (report_id, version))
    if revision is None:
        raise HTTPException(status_code=404, detail="历史版本不存在")
    try:
        if hashlib.sha256(revision.snapshot).hexdigest() != revision.snapshot_hash:
            raise ValueError("Report history checksum mismatch")
        document = await run_in_threadpool(_decode, revision.snapshot)
        if (
            document.project_id != project_id
            or document.id != report_id
            or document.version != version
        ):
            raise ValueError("Report history scope mismatch")
        return document
    except Exception as exc:
        raise HTTPException(status_code=409, detail={"code": "report_history_unavailable"}) from exc
