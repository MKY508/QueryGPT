"""Bounded business-facing navigation, separate from full run inspection."""

from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import case, func, select, true
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.analysis_history_keys import analysis_search_text
from app.db import get_db
from app.db.tables import AnalysisRun, Conversation, Project
from app.models.common import APIResponse
from app.models.workspace import AnalysisState

router = APIRouter()


class HistoryReport(BaseModel):
    title: str | None = None
    summary: str | None = None


class AnalysisHistoryItem(BaseModel):
    id: UUID
    project_id: UUID
    conversation_id: UUID | None
    query: str
    state: AnalysisState
    stage: str
    report: HistoryReport
    created_at: datetime
    updated_at: datetime


class AnalysisHistoryPage(BaseModel):
    items: list[AnalysisHistoryItem]
    total: int
    count: int
    page: int
    page_size: int
    page_count: int
    current_run_id: UUID | None


@router.get(
    "/projects/{project_id}/analysis-history", response_model=APIResponse[AnalysisHistoryPage]
)
async def read_analysis_history(
    project_id: UUID,
    q: str = Query(default="", max_length=512, pattern=r"^[^\x00]*$"),
    status: Literal[
        "all", "completed", "waiting_confirmation", "needs_attention", "active"
    ] = "all",
    page: int = Query(default=1, ge=1, le=1_000_000),
    page_size: int = Query(default=12, ge=1, le=50),
    current_run_id: UUID | None = None,
    purpose: Literal["navigation", "report"] = "navigation",
    db: AsyncSession = Depends(get_db),
) -> APIResponse[AnalysisHistoryPage]:
    if await db.scalar(select(Project.id).where(Project.id == project_id)) is None:
        raise HTTPException(status_code=404, detail="项目不存在")
    # Project ownership lives on the run; conversations have no project column.
    # Broken conversation references are not navigation targets.
    reachable = (
        select(Conversation.id).where(Conversation.id == AnalysisRun.conversation_id).exists()
    )
    scope = [AnalysisRun.project_id == project_id]
    if purpose == "navigation":
        scope.append(reachable)
    else:
        # A retained completed result can still be assembled into a report after
        # its conversation is removed. Never expose active/failed runs here.
        scope.append(AnalysisRun.state == "completed")
    conditions = list(scope)
    if status == "active":
        conditions.append(AnalysisRun.state.in_(["understanding", "investigating"]))
    elif status != "all":
        conditions.append(AnalysisRun.state == status)
    for term in analysis_search_text(q).split():
        conditions.append(AnalysisRun.history_search_text.contains(term, autoescape=True))
    current = (
        select(AnalysisRun.id).where(*scope, AnalysisRun.id == current_run_id).scalar_subquery()
    )
    counts = select(
        select(func.count())
        .select_from(AnalysisRun)
        .where(*scope)
        .scalar_subquery()
        .label("total"),
        select(func.count())
        .select_from(AnalysisRun)
        .where(*conditions)
        .scalar_subquery()
        .label("count"),
        current.label("current_run_id"),
    ).cte("history_counts")
    page_count = case((counts.c.count == 0, 1), else_=(counts.c.count + page_size - 1) // page_size)
    bounds = select(
        counts,
        page_count.label("page_count"),
        case((page > page_count, page_count), else_=page).label("page"),
    ).cte("history_bounds")
    ordering = [
        case((AnalysisRun.id == current_run_id, 0), else_=1),
        AnalysisRun.updated_at.desc(),
        AnalysisRun.created_at.desc(),
        AnalysisRun.id,
    ]
    selected = (
        select(AnalysisRun.id)
        .where(*conditions)
        .order_by(*ordering)
        .limit(page_size)
        .offset((select(bounds.c.page).scalar_subquery() - 1) * page_size)
        .cte("history_selection")
    )
    # Counts, clamped page and selection share a statement snapshot. JSON scalar
    # projection is limited to the selected page; no report/checkpoint ORM loads.
    columns = [
        getattr(AnalysisRun, name)
        for name in (
            "id",
            "project_id",
            "conversation_id",
            "query",
            "state",
            "stage",
            "created_at",
            "updated_at",
        )
    ]
    rows = (
        (
            await db.execute(
                select(
                    *columns,
                    AnalysisRun.report["title"].label("title"),
                    AnalysisRun.report["summary"].label("summary"),
                    bounds,
                )
                .select_from(
                    bounds.outerjoin(selected, true()).outerjoin(
                        AnalysisRun, AnalysisRun.id == selected.c.id
                    )
                )
                .order_by(*ordering)
            )
        )
        .mappings()
        .all()
    )
    items = []
    for row in rows:
        if row["id"] is None:
            continue
        values = {column.key: row[column.key] for column in columns}
        for name in ("created_at", "updated_at"):
            if values[name].tzinfo is None:
                values[name] = values[name].replace(tzinfo=UTC)
        values["report"] = {
            name: row[name] if isinstance(row[name], str) else None for name in ("title", "summary")
        }
        items.append(AnalysisHistoryItem.model_validate(values))
    first = rows[0]
    return APIResponse.ok(
        data=AnalysisHistoryPage(
            items=items,
            total=first["total"],
            count=first["count"],
            page=first["page"],
            page_size=page_size,
            page_count=first["page_count"],
            current_run_id=first["current_run_id"],
        )
    )
