"""Independent draft copies of a saved report, with durable creation receipts."""

from copy import deepcopy
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import reports
from app.db import get_db
from app.db.tables import ReportCopyReceipt, ReportDocument
from app.models.common import APIResponse
from app.services.checkpoint_contract import stable_payload_hash
from app.services.project_write_guard import lock_project_for_publication
from app.services.report_cloning import clone_report_pages
from app.services.report_history import report_baseline

router = APIRouter()


class CopyReport(BaseModel):
    expected_version: int = Field(ge=1)
    request_id: UUID
    title: str = Field(min_length=1, max_length=200, pattern=r"^[^\x00]*$")
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ReportCopyResponse(BaseModel):
    request_id: UUID
    project_id: UUID
    source_report_id: UUID
    source_version: int
    report_id: UUID


def _hash(project_id: UUID, report_id: UUID, payload: CopyReport) -> str:
    return stable_payload_hash(
        {
            "project_id": str(project_id),
            "source_report_id": str(report_id),
            **payload.model_dump(mode="json"),
        }
    )


async def _replay(
    db: AsyncSession, project_id: UUID, report_id: UUID, payload: CopyReport
) -> ReportCopyResponse | None:
    receipt = await db.get(ReportCopyReceipt, (project_id, payload.request_id))
    if receipt is None:
        return None
    if receipt.request_hash != _hash(project_id, report_id, payload):
        raise HTTPException(status_code=409, detail={"code": "report_copy_key_reused"})
    target = await db.scalar(
        select(ReportDocument.id).where(
            ReportDocument.id == receipt.target_report_id,
            ReportDocument.project_id == project_id,
            ReportDocument.deleted_at.is_(None),
        )
    )
    if target is None:
        # Keep the tombstone even after permanent deletion; replay cannot make a
        # replacement report just because its acknowledged target disappeared.
        raise HTTPException(status_code=409, detail={"code": "report_copy_unavailable"})
    return ReportCopyResponse(
        request_id=payload.request_id,
        project_id=project_id,
        source_report_id=receipt.source_report_id,
        source_version=receipt.source_version,
        report_id=target,
    )


@router.post(
    "/projects/{project_id}/reports/{report_id}/copies/resolve",
    response_model=APIResponse[ReportCopyResponse | None],
)
async def resolve_copy(
    project_id: UUID, report_id: UUID, payload: CopyReport, db: AsyncSession = Depends(get_db)
):
    # Read-only and independent from the current source version/existence.
    await reports._require_project(db, project_id)
    return APIResponse.ok(data=await _replay(db, project_id, report_id, payload))


@router.post(
    "/projects/{project_id}/reports/{report_id}/copies",
    response_model=APIResponse[ReportCopyResponse],
)
async def copy_report(
    project_id: UUID, report_id: UUID, payload: CopyReport, db: AsyncSession = Depends(get_db)
):
    await db.rollback()
    try:
        if await lock_project_for_publication(db, project_id) is None:
            raise HTTPException(status_code=404, detail="项目不存在")
        replayed = await _replay(db, project_id, report_id, payload)
        if replayed is not None:
            await db.rollback()
            return APIResponse.ok(data=replayed)
        # SQLite already owns the write reservation. Row locking on other
        # backends keeps the saved tree stable without bumping the source version.
        await db.execute(
            select(ReportDocument.id)
            .where(
                ReportDocument.id == report_id,
                ReportDocument.project_id == project_id,
                ReportDocument.deleted_at.is_(None),
            )
            .with_for_update()
        )
        source = await reports._load_report(db, project_id, report_id)
        reports._assert_expected_version(source.version, payload.expected_version)
        saved = report_baseline(source)
        pages = await clone_report_pages(db, project_id, saved.pages)
        duplicate = ReportDocument(
            project_id=project_id,
            title=payload.title,
            description=saved.description,
            status="draft",
            extra_data=deepcopy(saved.extra_data),
            pages=pages,
        )
        db.add(duplicate)
        await db.flush()
        await reports._retain_report_change(db, project_id, duplicate.id, None, "copied")
        db.add(
            ReportCopyReceipt(
                project_id=project_id,
                request_id=payload.request_id,
                source_report_id=report_id,
                source_version=saved.version,
                target_report_id=duplicate.id,
                request_hash=_hash(project_id, report_id, payload),
            )
        )
        response = ReportCopyResponse(
            request_id=payload.request_id,
            project_id=project_id,
            source_report_id=report_id,
            source_version=saved.version,
            report_id=duplicate.id,
        )
        await db.commit()
        return APIResponse.ok(data=response)
    except BaseException:
        await db.rollback()
        raise
