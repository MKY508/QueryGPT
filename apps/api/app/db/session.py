"""数据库会话管理"""

from collections.abc import AsyncGenerator

import structlog
from sqlalchemy import event
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings

logger = structlog.get_logger()

# 创建异步引擎
# SQLite 不支持连接池参数
_db_url = str(settings.DATABASE_URL)
_engine_kwargs: dict = {"echo": settings.DEBUG}
if not _db_url.startswith("sqlite"):
    _engine_kwargs["pool_pre_ping"] = True
    _engine_kwargs["pool_size"] = 10
    _engine_kwargs["max_overflow"] = 20

engine = create_async_engine(_db_url, **_engine_kwargs)


def _set_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
    """Enable SQLite FK enforcement and concurrency pragmas for every pooled DB-API connection."""

    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=5000")
    finally:
        cursor.close()


def configure_sqlite_foreign_keys(async_engine: AsyncEngine, database_url: str) -> None:
    """Apply SQLite's per-connection FK switch without affecting other databases."""

    if not database_url.startswith(("sqlite://", "sqlite+aiosqlite://")):
        return
    sync_engine = async_engine.sync_engine
    if not event.contains(sync_engine, "connect", _set_sqlite_foreign_keys):
        event.listen(sync_engine, "connect", _set_sqlite_foreign_keys)


configure_sqlite_foreign_keys(engine, _db_url)

# 创建异步会话工厂
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Get database session with explicit exception handling.

    Per D-04: Use specific exception types instead of bare except.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except SQLAlchemyError as exc:
            # Database layer errors
            await session.rollback()
            logger.error(
                "Database session error",
                error_type=type(exc).__name__,
                exception_detail=str(exc),
            )
            raise
        except Exception as exc:
            # Unexpected error in session management
            await session.rollback()
            logger.error(
                "Unexpected error in get_db",
                error_type=type(exc).__name__,
                exception_detail=str(exc),
            )
            raise
        finally:
            await session.close()
