"""Upgrade backups include WAL data, fail closed, and never overwrite history."""

import asyncio
import os
import sqlite3
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine

from app.db import sqlite_backup as backup
from app.db.sqlite_migration import run_sqlite_migration


def _prepare(connection):
    connection.exec_driver_sql("CREATE TABLE alembic_version (version_num TEXT PRIMARY KEY)")
    connection.exec_driver_sql("INSERT INTO alembic_version VALUES ('old')")
    connection.exec_driver_sql("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)")
    connection.exec_driver_sql("INSERT INTO notes VALUES (1, 'keep before upgrade')")
    connection.commit()


def _read(snapshot: Path):
    with sqlite3.connect(f"{snapshot.as_uri()}?mode=ro&immutable=1", uri=True) as connection:
        return connection.execute("SELECT version_num FROM alembic_version").fetchone()[
            0
        ], connection.execute("SELECT body FROM notes").fetchone()[0]


def test_upgrade_backup_includes_committed_wal_and_is_standalone_private(tmp_path: Path):
    path = tmp_path / "metadata.db"
    engine = sa.create_engine(f"sqlite:///{path}")
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA journal_mode=WAL")
        connection.exec_driver_sql("PRAGMA wal_autocheckpoint=0")
        connection.commit()
        _prepare(connection)
        assert Path(f"{path}-wal").stat().st_size > 0

        def migrate():
            connection.exec_driver_sql("UPDATE notes SET body='after upgrade'")
            connection.exec_driver_sql("UPDATE alembic_version SET version_num='new'")
            return "new"

        assert run_sqlite_migration(connection, migrate, target_revision="new") == "new"
        snapshots = list((tmp_path / backup.BACKUP_DIRECTORY).glob("*.sqlite3"))
        assert len(snapshots) == 1
        assert _read(snapshots[0]) == ("old", "keep before upgrade")
        assert all(
            not Path(f"{snapshots[0]}{suffix}").exists() for suffix in ("-wal", "-shm", "-journal")
        )
        if os.name != "nt":
            assert snapshots[0].stat().st_mode & 0o777 == 0o600
            assert snapshots[0].parent.stat().st_mode & 0o777 == 0o700
        assert snapshots[0].stat().st_nlink == 1
        modified = snapshots[0].stat().st_mtime_ns
        run_sqlite_migration(connection, lambda: None, target_revision="new")
        assert snapshots[0].stat().st_mtime_ns == modified
        assert list(snapshots[0].parent.glob("*.sqlite3")) == snapshots
    engine.dispose()


def test_failed_upgrade_keeps_and_reuses_unchanged_snapshot_without_overwriting(tmp_path: Path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'metadata.db'}")
    with engine.connect() as connection:
        _prepare(connection)

        def fail():
            connection.exec_driver_sql("UPDATE notes SET body='must roll back'")
            raise RuntimeError("Migration failed")

        for attempt in range(2):
            with pytest.raises(RuntimeError, match="Migration failed"):
                run_sqlite_migration(connection, fail, target_revision="new")
            if attempt == 0:
                published = next((tmp_path / backup.BACKUP_DIRECTORY).glob("*.sqlite3"))
                # Simulate a process exit after no-overwrite publication, before
                # its temporary hard link was removed. The final must survive.
                os.link(published, published.parent / ".migration-crash000.tmp")
        snapshots = list((tmp_path / backup.BACKUP_DIRECTORY).glob("*.sqlite3"))
        assert len(snapshots) == 1
        assert snapshots[0].stat().st_nlink == 1
        assert _read(snapshots[0]) == ("old", "keep before upgrade")
        preserved = snapshots[0].read_bytes()
        connection.exec_driver_sql("UPDATE notes SET body='new committed input'")
        connection.commit()
        with pytest.raises(RuntimeError, match="Migration failed"):
            run_sqlite_migration(connection, fail, target_revision="new")
        assert len(list(snapshots[0].parent.glob("*.sqlite3"))) == 2
        assert snapshots[0].read_bytes() == preserved
        assert not list(snapshots[0].parent.glob("*.tmp"))
    engine.dispose()


def test_backup_failure_blocks_migration_and_only_removes_its_scratch_file(
    tmp_path: Path, monkeypatch
):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'metadata.db'}")
    called = []
    with engine.connect() as connection:
        _prepare(connection)
        # A failed publication must not be treated as permission to upgrade.
        monkeypatch.setattr(
            backup, "_fingerprint", lambda *_: (_ for _ in ()).throw(OSError("Disk failure"))
        )
        with pytest.raises(backup.SQLiteBackupError, match="备份未完成"):
            run_sqlite_migration(connection, lambda: called.append(True), target_revision="new")
        assert called == []
        assert (
            connection.exec_driver_sql("SELECT version_num FROM alembic_version").scalar_one()
            == "old"
        )
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
        assert not list((tmp_path / backup.BACKUP_DIRECTORY).iterdir())
        connection.commit()
        monkeypatch.setattr(backup.shutil, "disk_usage", lambda _: SimpleNamespace(free=0))
        with pytest.raises(backup.SQLiteBackupError, match="磁盘空间不足"):
            run_sqlite_migration(connection, lambda: called.append(True), target_revision="new")
        assert called == []
    engine.dispose()


@pytest.mark.skipif(os.name == "nt", reason="POSIX symlink/permission policy")
def test_backup_rejects_linked_or_public_directory_without_touching_target(tmp_path: Path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'metadata.db'}")
    outside = tmp_path / "outside"
    outside.mkdir(mode=0o700)
    linked = tmp_path / backup.BACKUP_DIRECTORY
    linked.symlink_to(outside, target_is_directory=True)
    with engine.connect() as connection:
        _prepare(connection)
        with pytest.raises(backup.SQLiteBackupError, match="备份路径"):
            run_sqlite_migration(
                connection, lambda: pytest.fail("Must not migrate"), target_revision="new"
            )
        assert not list(outside.iterdir())
        linked.unlink()
        linked.mkdir(mode=0o755)
        with pytest.raises(backup.SQLiteBackupError, match="访问权限"):
            run_sqlite_migration(
                connection, lambda: pytest.fail("Must not migrate"), target_revision="new"
            )
    engine.dispose()


@pytest.mark.asyncio
async def test_async_backup_cancellation_never_enters_migration(tmp_path: Path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'metadata.db'}")
    entered, release, finished = threading.Event(), threading.Event(), threading.Event()
    stopped = []

    def pending(_source, _versions, _bytes, cancelled):
        entered.set()
        try:
            release.wait(2)
            stopped.append(cancelled.is_set())
        finally:
            finished.set()

    monkeypatch.setattr(backup, "_create_snapshot", pending)
    try:
        async with engine.connect() as connection:
            await connection.run_sync(_prepare)
            task = asyncio.create_task(
                connection.run_sync(
                    lambda sync: run_sqlite_migration(
                        sync,
                        lambda: pytest.fail("Cancelled backup must not migrate"),
                        target_revision="new",
                    )
                )
            )
            assert await asyncio.to_thread(entered.wait, 2)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            release.set()
            assert await asyncio.to_thread(finished.wait, 2)
            assert stopped == [True]
            assert (await connection.exec_driver_sql("PRAGMA foreign_keys")).scalar_one() == 1
    finally:
        release.set()
        await engine.dispose()
