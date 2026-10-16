"""Bounded report summaries, with selection/counts from one SQL statement."""

from uuid import UUID

from sqlalchemy import case, func, select, true
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.report_library_keys import report_search_text
from app.db.tables import ReportBlock, ReportDocument, ReportPage
from app.models.reports import ReportLibraryResponse, ReportSummaryResponse


async def read_report_library(
    db: AsyncSession,
    project_id: UUID,
    *,
    search: str,
    status: str,
    sort: str,
    page: int,
    page_size: int,
    trashed: bool = False,
) -> ReportLibraryResponse:
    scope = [
        ReportDocument.project_id == project_id,
        ReportDocument.deleted_at.is_not(None) if trashed else ReportDocument.deleted_at.is_(None),
    ]
    conditions = list(scope)
    if status != "all":
        conditions.append(ReportDocument.status == status)
    for term in report_search_text(search, None).split():
        # Parameterized literal contains: %, _ and the escape character have no
        # wildcard meaning. Normalization is identical for stored and query text.
        conditions.append(ReportDocument.search_text.contains(term, autoescape=True))

    counts = select(
        select(func.count())
        .select_from(ReportDocument)
        .where(*conditions)
        .scalar_subquery()
        .label("count"),
        select(func.count())
        .select_from(ReportDocument)
        .where(*scope)
        .scalar_subquery()
        .label("total"),
    ).cte("library_counts")
    page_count = case((counts.c.count == 0, 1), else_=(counts.c.count + page_size - 1) // page_size)
    bounds = select(
        counts.c.count,
        counts.c.total,
        page_count.label("page_count"),
        case((page > page_count, page_count), else_=page).label("page"),
    ).cte("library_bounds")
    # A binary collation makes ordering independent of DB locale. Name keys are
    # not indexed: NFKC expansion can exceed PostgreSQL's btree entry limit.
    collation = "BINARY" if db.get_bind().dialect.name == "sqlite" else "C"
    ordering = [ReportDocument.name_key.collate(collation), ReportDocument.id]
    if sort != "title":
        field = (
            ReportDocument.deleted_at
            if trashed
            else (ReportDocument.created_at if sort == "created" else ReportDocument.updated_at)
        )
        ordering = [field.desc(), ReportDocument.id.desc()]
    selected = (
        select(ReportDocument.id)
        .where(*conditions)
        .order_by(*ordering)
        .limit(page_size)
        .offset((select(bounds.c.page).scalar_subquery() - 1) * page_size)
        .cte("library_selection")
    )
    pages = (
        select(func.count(ReportPage.id))
        .where(ReportPage.report_id == ReportDocument.id)
        .correlate(ReportDocument)
        .scalar_subquery()
    )
    blocks = (
        select(func.count(ReportBlock.id))
        .join(ReportPage, ReportPage.id == ReportBlock.page_id)
        .where(ReportPage.report_id == ReportDocument.id)
        .correlate(ReportDocument)
        .scalar_subquery()
    )
    # Project counts and page selection share one statement snapshot. Only the
    # selected summaries get page/block counts; no document JSON is selected.
    columns = [
        getattr(ReportDocument, field)
        for field in (
            "id",
            "project_id",
            "title",
            "description",
            "status",
            "version",
            "created_at",
            "updated_at",
            "deleted_at",
        )
    ]
    rows = (
        (
            await db.execute(
                select(
                    *columns,
                    pages.label("page_count"),
                    blocks.label("block_count"),
                    bounds.c.count,
                    bounds.c.total,
                    bounds.c.page,
                    bounds.c.page_count.label("library_page_count"),
                )
                .select_from(
                    bounds.outerjoin(selected, true()).outerjoin(
                        ReportDocument, ReportDocument.id == selected.c.id
                    )
                )
                .order_by(*ordering)
            )
        )
        .mappings()
        .all()
    )
    first = rows[0]
    return ReportLibraryResponse(
        items=[
            ReportSummaryResponse.model_validate(dict(row)) for row in rows if row["id"] is not None
        ],
        total=first["total"],
        count=first["count"],
        page=first["page"],
        page_size=page_size,
        page_count=first["library_page_count"],
    )
