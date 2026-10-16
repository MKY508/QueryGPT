"""Clone trusted saved report trees, not client-authored source assertions."""

from copy import deepcopy
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import AnalysisRun, ArtifactRecord, ReportBlock, ReportPage
from app.models.reports import ReportPageResponse


async def clone_report_pages(
    db: AsyncSession, project_id: UUID, saved_pages: list[ReportPageResponse]
) -> list[ReportPage]:
    """Keep layout/interaction keys/provenance; assign fresh ORM identities.

    Live source links are shared, not duplicated. Missing links stay detached;
    source metadata inside the saved snapshot stays explicitly historical.
    """
    blocks = [block for page in saved_pages for block in page.blocks]
    runs, artifacts = {}, {}
    for model, identities, found in (
        (AnalysisRun, {block.analysis_run_id for block in blocks if block.analysis_run_id}, runs),
        (ArtifactRecord, {block.artifact_id for block in blocks if block.artifact_id}, artifacts),
    ):
        ids = list(identities)
        # Bounded IN parameters, including reports larger than a refresh page.
        for start in range(0, len(ids), 500):
            for item in await db.scalars(
                select(model).where(model.id.in_(ids[start : start + 500]))
            ):
                if item.project_id != project_id:
                    raise HTTPException(status_code=409, detail="报告来源已变化")
                found[item.id] = item
    for block in blocks:
        artifact = artifacts.get(block.artifact_id)
        if artifact is not None and artifact.analysis_run_id != block.analysis_run_id:
            raise HTTPException(status_code=409, detail="报告来源已变化")
    return [
        ReportPage(
            title=old_page.title,
            order_index=old_page.order_index,
            config=deepcopy(old_page.config),
            blocks=[
                ReportBlock(
                    block_type=old.block_type,
                    title=old.title,
                    order_index=old.order_index,
                    source_kind=old.source_kind,
                    analysis_run_id=old.analysis_run_id if old.analysis_run_id in runs else None,
                    artifact_id=old.artifact_id if old.artifact_id in artifacts else None,
                    source_ref=deepcopy(old.source_ref),
                    content=deepcopy(old.content),
                    config=deepcopy(old.config),
                    layout=deepcopy(old.layout),
                )
                for old in old_page.blocks
            ],
        )
        for old_page in saved_pages
    ]
