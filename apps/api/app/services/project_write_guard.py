"""Short publication transactions shared by prepared data and report refresh."""

from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import Project


async def lock_project_for_publication(db: AsyncSession, project_id: UUID) -> Project | None:
    """Call after ending the read transaction and staging all expensive work.

    SQLite ignores SELECT FOR UPDATE, so acquire its write reservation before
    re-reading publication evidence. Other backends share the project row lock
    used by catalog-governance writers.
    """
    bind = db.get_bind()
    if bind is not None and bind.dialect.name == "sqlite":
        await db.execute(text("BEGIN IMMEDIATE"))
        statement = select(Project).where(Project.id == project_id)
    else:
        statement = select(Project).where(Project.id == project_id).with_for_update()
    result = await db.execute(statement.execution_options(populate_existing=True))
    return result.scalar_one_or_none()
