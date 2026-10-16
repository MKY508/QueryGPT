"""One explicit, checked transaction for SQLite schema-copy migrations."""

from collections.abc import Callable
from typing import TypeVar

import structlog
from sqlalchemy import Connection

from app.db.sqlite_backup import backup_before_migration

T = TypeVar("T")


def run_sqlite_migration(
    connection: Connection,
    migrate: Callable[[], T],
    *,
    target_revision: str | tuple[str, ...] | None = None,
) -> T:
    """Run on an idle connection, restoring FK enforcement on every exit.

    sqlite3/aiosqlite legacy transaction control does not BEGIN for DDL. An
    explicit transaction is required for table copies AND version stamps to
    roll back together. The caller supplies one exclusive startup connection.
    """
    if connection.in_transaction():
        raise RuntimeError("SQLite migrations require an idle connection")
    connection.exec_driver_sql("PRAGMA foreign_keys = OFF")
    connection.commit()
    try:
        if connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one():
            raise RuntimeError("Could not suspend SQLite foreign-key enforcement for migration")
        connection.commit()
        connection.exec_driver_sql("BEGIN IMMEDIATE")
        if target_revision is not None:
            snapshot = backup_before_migration(connection, target_revision)
            if snapshot is not None:
                structlog.get_logger().info(
                    "Pre-upgrade database backup preserved",
                    path=str(snapshot),
                    target_revision=target_revision,
                )
        result = migrate()
        if connection.exec_driver_sql("PRAGMA foreign_key_check").first():
            raise RuntimeError("数据库迁移后存在失效的关联，已回滚升级")
        connection.commit()
        return result
    finally:
        if connection.in_transaction():
            connection.rollback()
        connection.exec_driver_sql("PRAGMA foreign_keys = ON")
        connection.commit()
