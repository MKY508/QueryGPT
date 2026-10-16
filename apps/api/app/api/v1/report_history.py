"""Read saved versions, preview them, and restore only with current report CAS."""

from copy import deepcopy
from datetime import UTC
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import reports
from app.db import get_db
from app.db.tables import (
    ReportDocument,
    ReportRevision,
)
from app.models.common import APIResponse
from app.services.report_cloning import clone_report_pages
from app.services.report_history import read_revision, report_baseline

router = APIRouter()


class RestoreRevision(BaseModel):
    expected_version: int = Field(ge=1)
    model_config = ConfigDict(extra="forbid")


async def _current_version(db: AsyncSession, project_id: UUID, report_id: UUID) -> int:
    version = await db.scalar(
        select(ReportDocument.version).where(
            ReportDocument.id == report_id,
            ReportDocument.project_id == project_id,
            ReportDocument.deleted_at.is_(None),
        )
    )
    if version is None:
        raise HTTPException(status_code=404, detail="报表不存在")
    return version


@router.get("/projects/{project_id}/reports/{report_id}/revisions")
async def list_revisions(
    project_id: UUID,
    report_id: UUID,
    before: int | None = Query(default=None, ge=1),
    limit: int = Query(default=20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    current = await _current_version(db, project_id, report_id)
    # Select directory fields only; do not fetch/decompress every saved body.
    query = select(
        ReportRevision.version,
        ReportRevision.title,
        ReportRevision.saved_at,
        ReportRevision.reason,
        ReportRevision.page_count,
        ReportRevision.block_count,
    ).where(ReportRevision.report_id == report_id, ReportRevision.version <= current)
    if before is not None:
        query = query.where(ReportRevision.version < before)
    rows = (
        (await db.execute(query.order_by(ReportRevision.version.desc()).limit(limit + 1)))
        .mappings()
        .all()
    )
    return APIResponse.ok(
        data={
            "report_id": report_id,
            "current_version": current,
            "items": [
                {
                    **row,
                    "saved_at": row["saved_at"].replace(tzinfo=UTC)
                    if row["saved_at"].tzinfo is None
                    else row["saved_at"],
                }
                for row in rows[:limit]
            ],
            "next_before": rows[limit - 1]["version"] if len(rows) > limit else None,
        }
    )


@router.get("/projects/{project_id}/reports/{report_id}/revisions/{version}")
async def get_revision(
    project_id: UUID, report_id: UUID, version: int, db: AsyncSession = Depends(get_db)
):
    await _current_version(db, project_id, report_id)
    document = await read_revision(db, project_id, report_id, version)
    return APIResponse.ok(data=document)


@router.post("/projects/{project_id}/reports/{report_id}/revisions/{version}/restore")
async def restore_revision(
    project_id: UUID,
    report_id: UUID,
    version: int,
    payload: RestoreRevision,
    db: AsyncSession = Depends(get_db),
):
    await _current_version(db, project_id, report_id)
    historical = await read_revision(db, project_id, report_id, version)
    await db.rollback()  # Decompression/read transaction ends before publication.
    try:
        await reports._lock_project_for_report_refresh(db, project_id)
        report = await reports._load_report(db, project_id, report_id)
        reports._assert_expected_version(report.version, payload.expected_version)
        if version == report.version:
            raise HTTPException(status_code=409, detail="这已经是当前版本")
        before = report_baseline(report)
        pages = await clone_report_pages(db, project_id, historical.pages)
        await reports._claim_report_version(db, report, payload.expected_version)
        report.title, report.description, report.status = (
            historical.title,
            historical.description,
            historical.status,
        )
        report.extra_data = deepcopy(historical.extra_data)
        # New page/block IDs prevent stale editor requests from matching old
        # restored entity versions (ABA). Report identity/version remain monotonic.
        report.pages = pages
        response = await reports._retain_report_change(
            db, project_id, report_id, before, "restored"
        )
        await db.commit()
        return APIResponse.ok(data=response)
    except BaseException:
        await db.rollback()
        raise
