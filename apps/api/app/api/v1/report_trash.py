"""Explicit, project-scoped report trash; no automatic purge policy."""

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import reports
from app.db import get_db
from app.db.tables import ReportBlock, ReportDocument, ReportPage
from app.models.common import APIResponse
from app.models.reports import ReportDeleteResponse, ReportDocumentResponse, ReportLibraryResponse
from app.services.project_write_guard import lock_project_for_publication
from app.services.report_history import report_baseline
from app.services.report_library import read_report_library

router = APIRouter()


class RestoreReport(BaseModel):
    expected_version: int = Field(ge=1)
    model_config = ConfigDict(extra="forbid")


async def _trash_report(db: AsyncSession, project_id: UUID, report_id: UUID) -> ReportDocument:
    report = await reports._load_report(db, project_id, report_id, include_deleted=True)
    if report.deleted_at is None:
        raise HTTPException(status_code=409, detail="报表已不在回收站，请刷新列表")
    return report


async def _reserve_project(db: AsyncSession, project_id: UUID) -> None:
    await db.rollback()
    if await lock_project_for_publication(db, project_id) is None:
        raise HTTPException(status_code=404, detail="项目不存在")


@router.get(
    "/projects/{project_id}/report-trash", response_model=APIResponse[ReportLibraryResponse]
)
async def list_trash(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    q: Annotated[str, Query(max_length=200, pattern=r"^[^\x00]*$")] = "",
    page: Annotated[int, Query(ge=1, le=999999)] = 1,
):
    await reports._require_project(db, project_id)
    return APIResponse.ok(
        data=await read_report_library(
            db,
            project_id,
            search=q,
            status="all",
            sort="updated",
            page=page,
            page_size=24,
            trashed=True,
        )
    )


@router.get(
    "/projects/{project_id}/report-trash/{report_id}",
    response_model=APIResponse[ReportDocumentResponse],
)
async def preview_trash(project_id: UUID, report_id: UUID, db: AsyncSession = Depends(get_db)):
    return APIResponse.ok(
        data=ReportDocumentResponse.model_validate(await _trash_report(db, project_id, report_id))
    )


@router.delete(
    "/projects/{project_id}/reports/{report_id}", response_model=APIResponse[ReportDeleteResponse]
)
async def move_to_trash(
    project_id: UUID,
    report_id: UUID,
    expected_version: Annotated[int, Query(ge=1)],
    db: AsyncSession = Depends(get_db),
):
    try:
        await _reserve_project(db, project_id)
        report = await reports._load_report(db, project_id, report_id)
        reports._assert_expected_version(report.version, expected_version)
        before = report_baseline(report)
        await reports._claim_report_version(db, report, expected_version)
        report.deleted_at = datetime.now(UTC)
        # Retain entity identities for draft reconciliation, but invalidate old
        # page/block editors even if this report is subsequently restored.
        await db.execute(
            update(ReportPage)
            .where(ReportPage.report_id == report_id)
            .values(version=ReportPage.version + 1)
        )
        await db.execute(
            update(ReportBlock)
            .where(
                ReportBlock.page_id.in_(
                    select(ReportPage.id).where(ReportPage.report_id == report_id)
                )
            )
            .values(version=ReportBlock.version + 1)
        )
        await reports._retain_report_change(
            db, project_id, report_id, before, "trashed", include_deleted=True
        )
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    return APIResponse.ok(data=ReportDeleteResponse(id=report_id))


@router.post(
    "/projects/{project_id}/report-trash/{report_id}/restore",
    response_model=APIResponse[ReportDocumentResponse],
)
async def restore_trash(
    project_id: UUID,
    report_id: UUID,
    payload: RestoreReport,
    db: AsyncSession = Depends(get_db),
):
    try:
        await _reserve_project(db, project_id)
        report = await _trash_report(db, project_id, report_id)
        reports._assert_expected_version(report.version, payload.expected_version)
        before = report_baseline(report)
        await reports._claim_report_version(db, report, payload.expected_version)
        report.deleted_at = None
        response = await reports._retain_report_change(
            db, project_id, report_id, before, "trash_restored"
        )
        await db.commit()
        return APIResponse.ok(data=response)
    except BaseException:
        await db.rollback()
        raise


@router.delete(
    "/projects/{project_id}/report-trash/{report_id}",
    response_model=APIResponse[ReportDeleteResponse],
)
async def permanently_delete(
    project_id: UUID,
    report_id: UUID,
    expected_version: Annotated[int, Query(ge=1)],
    db: AsyncSession = Depends(get_db),
):
    try:
        await _reserve_project(db, project_id)
        report = await _trash_report(db, project_id, report_id)
        reports._assert_expected_version(report.version, expected_version)
        await reports._claim_report_version(db, report, expected_version)
        await db.delete(report)
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    return APIResponse.ok(data=ReportDeleteResponse(id=report_id))
