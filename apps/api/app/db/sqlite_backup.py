"""Verified, no-overwrite metadata snapshots before SQLite schema upgrades."""

import asyncio
import hashlib
import os
import re
import shutil
import sqlite3
import stat
import tempfile
import threading
import time
from contextlib import closing
from pathlib import Path

from alembic.runtime.migration import MigrationContext
from sqlalchemy import Connection

BACKUP_DIRECTORY = ".receiptbi-backups"
BACKUP_TIMEOUT_SECONDS = 120
_SIDECARS = ("-wal", "-shm", "-journal")


class SQLiteBackupError(RuntimeError):
    """The migration must not start without a verified snapshot."""


def _check_private(
    path: Path, *, directory: bool = False, allow_links: bool = False
) -> os.stat_result:
    info = path.lstat()
    expected = stat.S_ISDIR if directory else stat.S_ISREG
    if not expected(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise SQLiteBackupError("升级备份路径不是普通文件或目录，数据库尚未升级")
    if os.name != "nt" and (info.st_mode & 0o077 or info.st_uid != os.getuid()):
        raise SQLiteBackupError("升级备份目录或文件的访问权限不安全，数据库尚未升级")
    if not directory and not allow_links and info.st_nlink != 1:
        raise SQLiteBackupError("升级备份文件存在额外链接，数据库尚未升级")
    return info


def _fsync_directory(path: Path) -> None:
    if os.name == "nt":
        return
    descriptor = os.open(
        path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    )
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _fingerprint(path: Path, check) -> str:
    digest = hashlib.sha256()
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as handle:
        while chunk := handle.read(1024 * 1024):
            check()
            digest.update(chunk)
    return digest.hexdigest()


def _finish_published_cleanup(final: Path) -> None:
    """Recover a crash between publishing the hard link and removing scratch.

    Only a private, recognized scratch name pointing at this verified final's
    exact inode may be removed. Other links/files remain untouched.
    """
    info = _check_private(final, allow_links=True)
    if info.st_nlink > 1:
        with os.scandir(final.parent) as entries:
            for entry in entries:
                if not re.fullmatch(r"\.migration-[a-z0-9_]{8}\.tmp", entry.name):
                    continue
                candidate = Path(entry.path)
                try:
                    linked = entry.stat(follow_symlinks=False)
                except FileNotFoundError:
                    continue
                if (linked.st_dev, linked.st_ino) == (info.st_dev, info.st_ino):
                    _check_private(candidate, allow_links=True)
                    candidate.unlink()
        _fsync_directory(final.parent)
    _check_private(final)


def _create_snapshot(
    source: Path,
    expected_revisions: tuple[str, ...],
    database_bytes: int,
    cancelled: threading.Event,
) -> Path:
    deadline = time.monotonic() + BACKUP_TIMEOUT_SECONDS

    def check() -> None:
        if cancelled.is_set() or time.monotonic() > deadline:
            raise SQLiteBackupError("升级备份已取消或超时，数据库尚未升级")

    temporary = None
    temporary_identity = None
    try:
        before = source.lstat()
        if stat.S_ISLNK(before.st_mode) or not stat.S_ISREG(before.st_mode):
            raise SQLiteBackupError("待升级数据库不是普通文件，未执行升级")
        for suffix in _SIDECARS:
            sidecar = Path(f"{source}{suffix}")
            if sidecar.exists() or sidecar.is_symlink():
                info = sidecar.lstat()
                if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
                    raise SQLiteBackupError("数据库附属文件无法安全读取，未执行升级")
        parent = source.parent / BACKUP_DIRECTORY
        try:
            parent.mkdir(mode=0o700)
        except FileExistsError:
            pass
        else:
            _fsync_directory(source.parent)
        _check_private(parent, directory=True)
        # Admission estimate only: snapshot + migration-copy headroom. Other
        # processes and journal growth can still exhaust disk after this check.
        if shutil.disk_usage(parent).free < database_bytes * 2 + 64 * 1024 * 1024:
            raise SQLiteBackupError(
                "磁盘空间不足，未执行数据库升级；请保留现有备份并腾出空间后重试"
            )
        descriptor, name = tempfile.mkstemp(prefix=".migration-", suffix=".tmp", dir=parent)
        temporary = Path(name)
        with os.fdopen(descriptor, "wb") as handle:
            if os.name != "nt":
                os.fchmod(handle.fileno(), 0o600)
            info = os.fstat(handle.fileno())
            temporary_identity = (info.st_dev, info.st_ino)
        with closing(sqlite3.connect(f"{source.as_uri()}?mode=ro", uri=True, timeout=1)) as origin:
            origin.execute("PRAGMA query_only = ON")
            with closing(sqlite3.connect(f"{temporary.as_uri()}?mode=rw", uri=True)) as target:
                origin.backup(target, pages=256, sleep=0.05, progress=lambda *_: check())
                if target.execute("PRAGMA journal_mode = DELETE").fetchone() != ("delete",):
                    raise SQLiteBackupError("升级备份未形成独立副本，数据库尚未升级")
                target.set_progress_handler(
                    lambda: int(cancelled.is_set() or time.monotonic() > deadline), 10000
                )
                integrity = target.execute("PRAGMA quick_check")
                if integrity.fetchone() != ("ok",) or integrity.fetchone() is not None:
                    raise SQLiteBackupError("升级备份未通过完整性检查，数据库尚未升级")
                has_revision = target.execute(
                    "SELECT 1 FROM sqlite_schema WHERE type='table' AND name='alembic_version'"
                ).fetchone()
                revisions = (
                    tuple(
                        sorted(
                            row[0]
                            for row in target.execute("SELECT version_num FROM alembic_version")
                        )
                    )
                    if has_revision
                    else ()
                )
                if revisions != expected_revisions:
                    raise SQLiteBackupError("备份版本与待升级数据库不一致，未执行升级")
                target.commit()
        after = source.lstat()
        if (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino):
            raise SQLiteBackupError("数据库文件在备份时发生变化，未执行升级")
        if any(Path(f"{temporary}{suffix}").exists() for suffix in _SIDECARS):
            raise SQLiteBackupError("升级备份仍依赖附属文件，数据库尚未升级")
        _check_private(temporary)
        digest = _fingerprint(temporary, check)
        # Content addressing avoids accumulating identical copies on repeated
        # failed upgrades. Different databases/contents never overwrite a backup.
        source_key = hashlib.sha256(source.name.encode()).hexdigest()[:16]
        label = re.sub(r"[^a-zA-Z0-9_.-]+", "_", source.name).strip("._")[:32] or "metadata"
        final = parent / f"{label}-{source_key}-{digest}.sqlite3"
        check()
        with temporary.open("rb") as handle:
            os.fsync(handle.fileno())
        try:
            os.link(temporary, final, follow_symlinks=False)
        except FileExistsError:
            _check_private(final, allow_links=True)
            if _fingerprint(final, check) != digest:
                raise SQLiteBackupError("已有升级备份内容不符，未覆盖该文件，也未执行升级")
            _finish_published_cleanup(final)
        _fsync_directory(parent)
        return final
    except SQLiteBackupError:
        raise
    except (OSError, sqlite3.Error) as exc:
        raise SQLiteBackupError(
            "升级备份未完成，数据库尚未升级；请检查磁盘空间和文件权限后重试"
        ) from exc
    finally:
        # Only remove this invocation's unpublished scratch file. Published or
        # older backups are retained even when a later migration fails.
        if temporary is not None:
            try:
                info = temporary.lstat()
                if (info.st_dev, info.st_ino) == temporary_identity:
                    temporary.unlink()
                    for suffix in _SIDECARS:
                        Path(f"{temporary}{suffix}").unlink(missing_ok=True)
                    _fsync_directory(temporary.parent)
            except OSError:
                pass


def backup_before_migration(
    connection: Connection, target_revision: str | tuple[str, ...]
) -> Path | None:
    """Called under BEGIN IMMEDIATE, before any stamp, DDL or data migration."""
    current = tuple(sorted(MigrationContext.configure(connection).get_current_heads()))
    targets = (
        (target_revision,) if isinstance(target_revision, str) else tuple(sorted(target_revision))
    )
    if current == targets:
        return None
    has_tables = connection.exec_driver_sql(
        "SELECT 1 FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'alembic_version' LIMIT 1"
    ).first()
    if not has_tables:
        return None
    filename = next(
        (row[2] for row in connection.exec_driver_sql("PRAGMA database_list") if row[1] == "main"),
        "",
    )
    if not filename:
        # In-memory test databases have no persistent state to preserve.
        return None
    source = Path(filename).absolute()
    size = (
        connection.exec_driver_sql("PRAGMA page_count").scalar_one()
        * connection.exec_driver_sql("PRAGMA page_size").scalar_one()
    )
    cancelled = threading.Event()
    if connection.dialect.is_async:

        async def copy():
            try:
                return await asyncio.to_thread(_create_snapshot, source, current, size, cancelled)
            except asyncio.CancelledError:
                cancelled.set()
                raise

        return connection.connection.run_async(lambda _: copy())
    return _create_snapshot(source, current, size, cancelled)
