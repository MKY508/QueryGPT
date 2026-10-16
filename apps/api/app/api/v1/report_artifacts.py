"""Report-facing artifact directory and explicit, version-checked content reads."""

from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.db.tables import AnalysisRun, ArtifactRecord
from app.models.common import APIResponse
from app.models.workspace import ArtifactResponse

router = APIRouter()


class ReportArtifactSummary(BaseModel):
    id: UUID
    project_id: UUID
    analysis_run_id: UUID
    kind: Literal["metric", "table", "chart", "file", "evidence", "result_snapshot", "change_brief"]
    title: str
    created_at: datetime
    updated_at: datetime


SUMMARY_COLUMNS = [getattr(ArtifactRecord, name) for name in ReportArtifactSummary.model_fields]


def utc_values(row):
    values = dict(row)
    for key in ("created_at", "updated_at"):
        if values[key].tzinfo is None:
            values[key] = values[key].replace(tzinfo=UTC)
        else:
            values[key] = values[key].astimezone(UTC)
    return values


async def completed_run(db: AsyncSession, project_id: UUID, run_id: UUID):
    state = await db.scalar(
        select(AnalysisRun.state).where(
            AnalysisRun.id == run_id,
            AnalysisRun.project_id == project_id,
        )
    )
    if state is None:
        raise HTTPException(404, "调查不存在")
    if state != "completed":
        raise HTTPException(409, "调查尚未完成")


@router.get(
    "/projects/{project_id}/analysis-runs/{run_id}/report-artifacts",
    response_model=APIResponse[list[ReportArtifactSummary]],
)
async def directory(project_id: UUID, run_id: UUID, db: AsyncSession = Depends(get_db)):
    await completed_run(db, project_id, run_id)
    rows = (
        await db.execute(
            select(*SUMMARY_COLUMNS)
            .where(
                ArtifactRecord.project_id == project_id,
                ArtifactRecord.analysis_run_id == run_id,
                ArtifactRecord.kind != "report",
            )
            .order_by(ArtifactRecord.created_at, ArtifactRecord.id)
        )
    ).mappings()
    # Explicit column selection prevents accidental ORM loads of payload/traces.
    return APIResponse.ok(
        data=[ReportArtifactSummary.model_validate(utc_values(row)) for row in rows]
    )


@router.get(
    "/projects/{project_id}/analysis-runs/{run_id}/report-artifacts/{artifact_id}",
    response_model=APIResponse[ArtifactResponse],
)
async def content(
    project_id: UUID,
    run_id: UUID,
    artifact_id: UUID,
    expected_updated_at: datetime = Query(...),
    db: AsyncSession = Depends(get_db),
):
    if expected_updated_at.tzinfo is None:
        raise HTTPException(422, "更新时间必须包含时区")
    await completed_run(db, project_id, run_id)
    row = (
        (
            await db.execute(
                select(*SUMMARY_COLUMNS, ArtifactRecord.payload).where(
                    ArtifactRecord.id == artifact_id,
                    ArtifactRecord.project_id == project_id,
                    ArtifactRecord.analysis_run_id == run_id,
                    ArtifactRecord.kind != "report",
                )
            )
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        raise HTTPException(404, "调查内容不存在")
    values = utc_values(row)
    if values["updated_at"] != expected_updated_at.astimezone(UTC):
        raise HTTPException(409, "调查内容已有变化，请重新选择")
    # The report renderer uses business payloads, not execution diagnostics.
    return APIResponse.ok(data=ArtifactResponse.model_validate({**values, "technical_details": {}}))
