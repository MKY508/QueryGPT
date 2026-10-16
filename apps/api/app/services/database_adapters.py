"""Database driver adapters used by DatabaseManager."""

from __future__ import annotations

import contextlib
import math
import re
import socket
import threading
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol

from app.services.sqlite_trusted_executor import (
    MAX_CORE_ROWS,
    RustSQLiteSidecarExecutor,
    TrustedSQLiteExecutionCancelledError,
)

if TYPE_CHECKING:
    from app.services.database import DatabaseConfig


@dataclass(slots=True)
class AdapterQueryResult:
    data: list[dict[str, Any]]
    truncated: bool = False
    backend: str = "python"
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class BoundedSchemaCatalog:
    """A schema slice whose relation and column work was capped at the server.

    ``unread_*_at_least`` deliberately reports a lower bound.  Catalog queries
    fetch one sentinel row beyond each limit, so callers never have to pretend
    that the returned slice is the complete database schema.
    """

    tables: list[dict[str, Any]]
    relations_truncated: bool = False
    unread_relations_at_least: int = 0
    columns_truncated: bool = False
    unread_columns_at_least: int = 0


@dataclass(slots=True)
class BoundedRelationIndex:
    """A metadata-only relation directory with an explicit completeness boundary."""

    relations: list[dict[str, Any]]
    truncated: bool = False
    unread_relations_at_least: int = 0


class DatabaseQueryCancelledError(RuntimeError):
    """Raised when the caller wins the race to cancel an active database query."""


def _raise_if_cancelled(cancellation_event: threading.Event | None) -> None:
    if cancellation_event is not None and cancellation_event.is_set():
        raise DatabaseQueryCancelledError("Database query was cancelled before execution")


class _QueryCancellationWatcher:
    """Run one DB-API cancellation callback while its query is still active.

    The state lock linearizes query completion against cancellation. This matters
    for pooled or otherwise reusable DB-API connections: once ``finish`` wins,
    the watcher can no longer issue a late cancellation against a later query.
    """

    def __init__(
        self,
        cancellation_event: threading.Event | None,
        cancel_query: Callable[[], None],
        *,
        driver: str,
    ) -> None:
        self._cancellation_event = cancellation_event
        self._cancel_query = cancel_query
        self._driver = driver
        self._state_lock = threading.Lock()
        self._finished = threading.Event()
        self._active = False
        self._cancelled = False
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        event = self._cancellation_event
        if event is None:
            return
        _raise_if_cancelled(event)
        with self._state_lock:
            self._active = True
        self._thread = threading.Thread(
            target=self._watch,
            name=f"receiptbi-{self._driver}-query-cancel-{id(self):x}",
            daemon=True,
        )
        self._thread.start()

    def _watch(self) -> None:
        event = self._cancellation_event
        if event is None:
            return
        while not self._finished.wait(0.01):
            if not event.is_set():
                continue
            # Keep the callback under the same lock used by finish(). If query
            # completion acquired the lock first, this cancellation is stale and
            # must not touch the connection. If cancellation acquired it first,
            # the query cannot return and be reused until the callback completes.
            with self._state_lock:
                if not self._active:
                    return
                self._cancelled = True
                self._cancel_query()
            return

    def finish(self) -> bool:
        with self._state_lock:
            self._active = False
        self._finished.set()
        if self._thread is not None:
            self._thread.join()
        return self._cancelled


@contextlib.contextmanager
def _cancellable_query(
    cancellation_event: threading.Event | None,
    cancel_query: Callable[[], None],
    *,
    driver: str,
) -> Iterator[None]:
    watcher = _QueryCancellationWatcher(
        cancellation_event,
        cancel_query,
        driver=driver,
    )
    watcher.start()
    try:
        yield
    except BaseException as exc:
        if watcher.finish():
            raise DatabaseQueryCancelledError("Database query was cancelled") from exc
        raise
    else:
        if watcher.finish():
            raise DatabaseQueryCancelledError("Database query was cancelled")


def _close_connection_quietly(conn: Any) -> None:
    with contextlib.suppress(Exception):
        conn.close()


def _force_close_mysql_connection(conn: Any) -> None:
    """Interrupt PyMySQL's blocking socket read without returning it for reuse."""

    target_socket = getattr(conn, "_sock", None)
    if target_socket is not None:
        with contextlib.suppress(Exception):
            target_socket.shutdown(socket.SHUT_RDWR)
        with contextlib.suppress(Exception):
            target_socket.close()
    _close_connection_quietly(conn)


class DatabaseAdapter(Protocol):
    """Interface implemented by each database driver adapter."""

    def create_connection(self, config: DatabaseConfig) -> Any: ...

    def get_db_info(self, conn: Any) -> tuple[str, int]: ...

    def enforce_read_only(self, conn: Any, *, timeout_seconds: float) -> None: ...

    def execute_sql(
        self,
        conn: Any,
        sql: str,
        max_rows: int | None = None,
        cancellation_event: threading.Event | None = None,
        timeout_seconds: float | None = None,
        connection_config: DatabaseConfig | None = None,
        read_only_prepared: bool = False,
    ) -> AdapterQueryResult: ...

    def quote_identifier(self, identifier: str) -> str: ...

    def get_tables(self, conn: Any) -> list[str]: ...

    def get_table_columns(self, conn: Any, table_name: str) -> list[dict[str, Any]]: ...

    def validate_relation_columns(self, conn: Any, table_name: str, columns: list[str]) -> bool: ...

    def get_schema_catalog(self, conn: Any) -> list[dict[str, Any]]: ...

    def get_bounded_relation_index(
        self,
        conn: Any,
        *,
        max_relations: int,
        after: str | None = None,
    ) -> BoundedRelationIndex: ...

    def get_bounded_relation_schema(
        self,
        conn: Any,
        *,
        table_name: str,
        max_columns: int,
    ) -> dict[str, Any]: ...

    def get_bounded_schema_catalog(
        self,
        conn: Any,
        *,
        max_relations: int,
        max_columns_per_relation: int,
        max_total_columns: int,
    ) -> BoundedSchemaCatalog: ...


def _catalog_entry(name: str, kind: str, *, schema: str | None = None) -> dict[str, Any]:
    return {
        "name": name,
        "schema": schema,
        "kind": kind,
        "column_metadata_status": "available",
        "constraint_metadata_status": "available",
        "columns": [],
        "primary_key": None,
        "foreign_keys": [],
        "unique_constraints": [],
    }


def _relation_index_entry(
    name: str,
    kind: str,
    *,
    schema: str | None,
    comment: Any = None,
) -> dict[str, Any]:
    normalized_comment = str(comment).strip() if comment is not None else ""
    return {
        "name": name,
        "schema": schema,
        "kind": kind,
        "comment": normalized_comment or None,
    }


def _relation_kind(raw_kind: Any) -> str:
    normalized = str(raw_kind or "").strip().casefold().replace(" ", "_")
    return {
        "base_table": "table",
        "table": "table",
        "view": "view",
        "materialized_view": "materialized_view",
        "foreign_table": "foreign_table",
        "partitioned_table": "partitioned_table",
    }.get(normalized, normalized or "unknown")


def _mark_columns_unavailable(entries: dict[str, dict[str, Any]]) -> None:
    for entry in entries.values():
        entry["column_metadata_status"] = "unavailable"
        entry["constraint_metadata_status"] = "unavailable"
        entry["columns"] = []
        entry["primary_key"] = None
        entry["foreign_keys"] = None
        entry["unique_constraints"] = None


def _mark_constraints_unavailable(entries: dict[str, dict[str, Any]]) -> None:
    for entry in entries.values():
        entry["constraint_metadata_status"] = "unavailable"
        entry["primary_key"] = None
        entry["foreign_keys"] = None
        entry["unique_constraints"] = None
        for column in entry["columns"]:
            column["primary_key"] = None
            column["unique"] = None


def _apply_constraint_column_flags(entry: dict[str, Any]) -> None:
    primary_key = entry.get("primary_key") or {}
    primary_columns = set(primary_key.get("columns") or [])
    unique_columns = {
        str(item["columns"][0])
        for item in entry.get("unique_constraints") or []
        if len(item.get("columns") or []) == 1 and not item.get("partial", False)
    }
    if len(primary_columns) == 1:
        unique_columns.update(primary_columns)
    for column in entry["columns"]:
        name = str(column["name"])
        column["primary_key"] = name in primary_columns
        column["unique"] = name in unique_columns


def _mysql_value(row: dict[str, Any], key: str) -> Any:
    if key in row:
        return row[key]
    folded = key.casefold()
    return next((value for name, value in row.items() if name.casefold() == folded), None)


_DORIS_SAFE_PRIVILEGES = {
    "SELECT_PRIV",
    "SHOW_VIEW_PRIV",
    "USAGE_PRIV",
    "CLUSTER_USAGE_PRIV",
    "STAGE_USAGE_PRIV",
}
_DORIS_LEGACY_WRITE_PRIVILEGES = {"ALL", "READ_WRITE"}


def _validate_doris_select_only_grants(rows: list[dict[str, Any]]) -> None:
    """Reject a Doris account unless SHOW GRANTS proves a select-only boundary."""

    flattened = " ".join(
        str(value)
        for row in rows
        for value in (row.values() if isinstance(row, dict) else row)
        if value is not None
    )
    privileges = {
        token.upper()
        for token in re.findall(r"\b(?:[A-Za-z][A-Za-z_]*_priv|ALL|READ_WRITE)\b", flattened, re.I)
    }
    if "SELECT_PRIV" not in privileges:
        raise PermissionError("Doris connection requires an explicit Select_priv grant")
    unsafe = (privileges - _DORIS_SAFE_PRIVILEGES) | (privileges & _DORIS_LEGACY_WRITE_PRIVILEGES)
    if unsafe:
        raise PermissionError(
            "Doris connection has write or administrative privileges: " + ", ".join(sorted(unsafe))
        )


def _apply_mysql_constraint_rows(
    entries: dict[str, dict[str, Any]], rows: list[dict[str, Any]]
) -> None:
    grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for row in rows:
        table_name = str(_mysql_value(row, "TABLE_NAME"))
        constraint_name = str(_mysql_value(row, "CONSTRAINT_NAME"))
        constraint_type = str(_mysql_value(row, "CONSTRAINT_TYPE")).upper()
        if table_name not in entries:
            continue
        grouped.setdefault((table_name, constraint_name, constraint_type), []).append(row)

    for (table_name, constraint_name, constraint_type), constraint_rows in grouped.items():
        entry = entries[table_name]
        columns = [str(_mysql_value(row, "COLUMN_NAME")) for row in constraint_rows]
        if constraint_type == "PRIMARY KEY":
            entry["primary_key"] = {"name": constraint_name, "columns": columns}
        elif constraint_type == "UNIQUE":
            entry["unique_constraints"].append(
                {
                    "name": constraint_name,
                    "columns": columns,
                    "origin": "constraint",
                    "partial": False,
                }
            )
        elif constraint_type == "FOREIGN KEY":
            first = constraint_rows[0]
            entry["foreign_keys"].append(
                {
                    "name": constraint_name,
                    "columns": columns,
                    "referenced_schema": _mysql_value(first, "REFERENCED_TABLE_SCHEMA"),
                    "referenced_table": _mysql_value(first, "REFERENCED_TABLE_NAME"),
                    "referenced_columns": [
                        _mysql_value(row, "REFERENCED_COLUMN_NAME") for row in constraint_rows
                    ],
                    "on_update": _mysql_value(first, "UPDATE_RULE"),
                    "on_delete": _mysql_value(first, "DELETE_RULE"),
                }
            )

    for entry in entries.values():
        _apply_constraint_column_flags(entry)


def _apply_postgresql_constraint_rows(entries: dict[str, dict[str, Any]], rows: list[Any]) -> None:
    action_names = {
        "a": "NO ACTION",
        "r": "RESTRICT",
        "c": "CASCADE",
        "n": "SET NULL",
        "d": "SET DEFAULT",
    }
    for row in rows:
        (
            table_name,
            constraint_name,
            constraint_type,
            columns,
            referenced_schema,
            referenced_table,
            referenced_columns,
            update_action,
            delete_action,
        ) = row
        entry = entries.get(str(table_name))
        if entry is None:
            continue
        normalized_columns = [str(column) for column in columns or []]
        if constraint_type == "p":
            entry["primary_key"] = {
                "name": str(constraint_name),
                "columns": normalized_columns,
            }
        elif constraint_type == "u":
            entry["unique_constraints"].append(
                {
                    "name": str(constraint_name),
                    "columns": normalized_columns,
                    "origin": "constraint",
                    "partial": False,
                }
            )
        elif constraint_type == "f":
            entry["foreign_keys"].append(
                {
                    "name": str(constraint_name),
                    "columns": normalized_columns,
                    "referenced_schema": (str(referenced_schema) if referenced_schema else None),
                    "referenced_table": (str(referenced_table) if referenced_table else None),
                    "referenced_columns": [str(column) for column in referenced_columns or []],
                    "on_update": action_names.get(str(update_action), None),
                    "on_delete": action_names.get(str(delete_action), None),
                }
            )

    for entry in entries.values():
        _apply_constraint_column_flags(entry)


class MySQLAdapter:
    @staticmethod
    def quote_identifier(identifier: str) -> str:
        if not identifier or "\x00" in identifier:
            raise ValueError("Invalid database identifier")
        return f"`{identifier.replace('`', '``')}`"

    def create_connection(self, config: DatabaseConfig) -> Any:
        import pymysql

        return pymysql.connect(
            host=config.host,
            port=config.get_port(),
            user=config.user,
            password=config.password,
            database=config.database,
            cursorclass=pymysql.cursors.DictCursor,
            connect_timeout=10,
            read_timeout=60,
            write_timeout=60,
            **self._tls_kwargs(config),
        )

    @staticmethod
    def _tls_kwargs(config: DatabaseConfig) -> dict[str, Any]:
        options = config.extra_options
        sslmode = options.get("sslmode", "prefer")
        if sslmode == "disable":
            return {"ssl_disabled": True}

        kwargs: dict[str, Any] = {}
        if sslmode == "require":
            # A non-empty ssl mapping makes PyMySQL require TLS while explicitly
            # leaving certificate verification disabled for this mode.
            kwargs["ssl"] = {"verify_mode": False, "check_hostname": False}
        elif sslmode in {"verify-ca", "verify-full"}:
            kwargs["ssl_verify_cert"] = True
            kwargs["ssl_verify_identity"] = sslmode == "verify-full"

        if options.get("sslrootcert"):
            kwargs["ssl_ca"] = options["sslrootcert"]
        if options.get("sslcert"):
            kwargs["ssl_cert"] = options["sslcert"]
            kwargs["ssl_key"] = options["sslkey"]
        return kwargs

    def _create_control_connection(self, config: DatabaseConfig) -> Any:
        """Open a short-lived connection used only to cancel one target thread."""

        import pymysql

        return pymysql.connect(
            host=config.host,
            port=config.get_port(),
            user=config.user,
            password=config.password,
            database=config.database,
            cursorclass=pymysql.cursors.DictCursor,
            connect_timeout=3,
            read_timeout=3,
            write_timeout=3,
            autocommit=True,
            **self._tls_kwargs(config),
        )

    def _cancel_query(
        self,
        conn: Any,
        connection_config: DatabaseConfig | None,
        target_thread_id: int | None,
    ) -> None:
        control_connection: Any | None = None
        try:
            if connection_config is None or target_thread_id is None:
                raise RuntimeError("MySQL cancellation requires the target connection config")
            control_connection = self._create_control_connection(connection_config)
            with control_connection.cursor() as cursor:
                # thread_id() is supplied by the target DB-API connection and is
                # converted to int before interpolation, so this cannot carry SQL.
                cursor.execute(f"KILL QUERY {target_thread_id}")
        except Exception:
            # KILL QUERY can fail when the account lacks permission, the control
            # connection cannot be established, or the server has already gone
            # away. Closing the target socket is the fail-closed local boundary.
            _force_close_mysql_connection(conn)
        finally:
            if control_connection is not None:
                _close_connection_quietly(control_connection)

    @staticmethod
    def _server_kind(conn: Any) -> str:
        cached = getattr(conn, "_receiptbi_server_kind", None)
        if cached in {"mysql", "doris"}:
            return str(cached)
        with conn.cursor() as cursor:
            cursor.execute("SELECT @@version_comment AS version_comment")
            row = cursor.fetchone()
        comment = _mysql_value(row, "version_comment") if isinstance(row, dict) else row[0]
        server_kind = "doris" if "doris" in str(comment or "").casefold() else "mysql"
        with contextlib.suppress(Exception):
            setattr(conn, "_receiptbi_server_kind", server_kind)
        return server_kind

    def _apply_query_timeout(
        self,
        conn: Any,
        *,
        server_kind: str,
        timeout_seconds: float,
    ) -> None:
        with conn.cursor() as cursor:
            if server_kind == "doris":
                timeout = max(1, min(math.ceil(float(timeout_seconds)), 60))
                cursor.execute(f"SET query_timeout = {timeout}")
            else:
                milliseconds = max(1, min(int(float(timeout_seconds) * 1000), 60_000))
                cursor.execute(
                    "SET SESSION MAX_EXECUTION_TIME = %s",
                    (milliseconds,),
                )

    def enforce_read_only(self, conn: Any, *, timeout_seconds: float) -> None:
        """Apply the server's real read-only boundary before any business query.

        Doris speaks the MySQL wire protocol but does not provide MySQL's
        transaction-level read-only mode.  In that branch we fail closed unless
        SHOW GRANTS proves the account has Select_priv and no write/admin grant.
        """

        server_kind = self._server_kind(conn)
        with conn.cursor() as cursor:
            if server_kind == "doris":
                cursor.execute("SHOW GRANTS")
                _validate_doris_select_only_grants(list(cursor.fetchall()))
            else:
                cursor.execute("SET SESSION TRANSACTION READ ONLY")
        self._apply_query_timeout(
            conn,
            server_kind=server_kind,
            timeout_seconds=timeout_seconds,
        )

    def get_db_info(self, conn: Any) -> tuple[str, int]:
        with conn.cursor() as cursor:
            cursor.execute("SELECT VERSION()")
            raw_version = _mysql_value(cursor.fetchone(), "VERSION()")
            prefix = "Apache Doris" if self._server_kind(conn) == "doris" else "MySQL"
            version = f"{prefix} {raw_version}"
            cursor.execute(
                "SELECT COUNT(*) AS table_count FROM information_schema.tables "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')"
            )
            tables_count = int(_mysql_value(cursor.fetchone(), "table_count") or 0)
        return version, tables_count

    def execute_sql(
        self,
        conn: Any,
        sql: str,
        max_rows: int | None = None,
        cancellation_event: threading.Event | None = None,
        timeout_seconds: float | None = None,
        connection_config: DatabaseConfig | None = None,
        read_only_prepared: bool = False,
    ) -> AdapterQueryResult:
        _raise_if_cancelled(cancellation_event)
        target_thread_id: int | None = None
        with contextlib.suppress(Exception):
            target_thread_id = int(conn.thread_id())

        with _cancellable_query(
            cancellation_event,
            lambda: self._cancel_query(conn, connection_config, target_thread_id),
            driver="mysql",
        ):
            effective_timeout = 60.0 if timeout_seconds is None else timeout_seconds
            if read_only_prepared:
                self._apply_query_timeout(
                    conn,
                    server_kind=self._server_kind(conn),
                    timeout_seconds=effective_timeout,
                )
            else:
                self.enforce_read_only(conn, timeout_seconds=effective_timeout)

            import pymysql

            # PyMySQL's default DictCursor buffers the complete result before
            # fetchmany() is called.  SSDictCursor keeps the client-side memory
            # boundary real for accidental wide queries against large databases.
            # SSCursor.close() normally drains every unread row from the socket;
            # bounded reads therefore dispose this one-shot connection instead.
            cursor = conn.cursor(pymysql.cursors.SSDictCursor)
            try:
                cursor.execute(sql)
                data = list(
                    cursor.fetchmany(max_rows) if max_rows is not None else cursor.fetchall()
                )
            finally:
                if max_rows is not None:
                    with contextlib.suppress(Exception):
                        setattr(conn, "_receiptbi_stream_connection_disposed", True)
                    _force_close_mysql_connection(conn)
                else:
                    cursor.close()
            return AdapterQueryResult(
                data=data,
                metadata={
                    "streaming": True,
                    "connection_disposed_after_bounded_read": max_rows is not None,
                },
            )

    def get_tables(self, conn: Any) -> list[str]:
        with conn.cursor() as cursor:
            cursor.execute("SHOW TABLES")
            return [list(row.values())[0] for row in cursor.fetchall()]

    def get_table_columns(self, conn: Any, table_name: str) -> list[dict[str, Any]]:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY "
                "FROM information_schema.columns "
                "WHERE table_schema = DATABASE() AND table_name = %s "
                "ORDER BY ORDINAL_POSITION",
                (table_name,),
            )
            return [
                {
                    "name": _mysql_value(row, "COLUMN_NAME"),
                    "type": _mysql_value(row, "COLUMN_TYPE"),
                    "nullable": str(_mysql_value(row, "IS_NULLABLE")).upper() == "YES",
                    "primary_key": str(_mysql_value(row, "COLUMN_KEY")).upper() == "PRI",
                    "unique": (
                        True if str(_mysql_value(row, "COLUMN_KEY")).upper() == "UNI" else None
                    ),
                }
                for row in cursor.fetchall()
            ]

    def validate_relation_columns(self, conn: Any, table_name: str, columns: list[str]) -> bool:
        if not columns:
            return False
        placeholders = ", ".join(["%s"] * len(columns))
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT COLUMN_NAME FROM information_schema.columns "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s "
                f"AND COLUMN_NAME IN ({placeholders}) LIMIT {len(columns) + 1}",
                (table_name, *columns),
            )
            found = {str(_mysql_value(row, "COLUMN_NAME")) for row in cursor.fetchall()}
        return found == set(columns)

    def get_bounded_relation_index(
        self,
        conn: Any,
        *,
        max_relations: int,
        after: str | None = None,
    ) -> BoundedRelationIndex:
        with conn.cursor() as cursor:
            query = (
                "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, TABLE_COMMENT "
                "FROM information_schema.tables "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')"
            )
            if after is None:
                cursor.execute(f"{query} ORDER BY TABLE_NAME LIMIT {max_relations + 1}")
            else:
                cursor.execute(
                    f"{query} AND TABLE_NAME > %s ORDER BY TABLE_NAME LIMIT {max_relations + 1}",
                    (after,),
                )
            rows = list(cursor.fetchall())
        truncated = len(rows) > max_relations
        relations = [
            _relation_index_entry(
                str(_mysql_value(row, "TABLE_NAME")),
                _relation_kind(_mysql_value(row, "TABLE_TYPE")),
                schema=(
                    str(_mysql_value(row, "TABLE_SCHEMA"))
                    if _mysql_value(row, "TABLE_SCHEMA") is not None
                    else None
                ),
                comment=_mysql_value(row, "TABLE_COMMENT"),
            )
            for row in rows[:max_relations]
        ]
        return BoundedRelationIndex(
            relations=relations,
            truncated=truncated,
            unread_relations_at_least=int(truncated),
        )

    def get_bounded_relation_schema(
        self,
        conn: Any,
        *,
        table_name: str,
        max_columns: int,
    ) -> dict[str, Any]:
        """Read one named relation and its declared constraints with hard bounds."""

        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, TABLE_COMMENT "
                "FROM information_schema.tables "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s "
                "AND TABLE_TYPE IN ('BASE TABLE', 'VIEW') LIMIT 1",
                (table_name,),
            )
            relation_rows = list(cursor.fetchall())
        if not relation_rows:
            raise ValueError("所选表不存在或不可读取")
        relation = relation_rows[0]
        entry = _catalog_entry(
            str(_mysql_value(relation, "TABLE_NAME")),
            _relation_kind(_mysql_value(relation, "TABLE_TYPE")),
            schema=(
                str(_mysql_value(relation, "TABLE_SCHEMA"))
                if _mysql_value(relation, "TABLE_SCHEMA") is not None
                else None
            ),
        )
        entry["comment"] = _mysql_value(relation, "TABLE_COMMENT")
        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE "
                    "FROM information_schema.columns "
                    "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s "
                    f"ORDER BY ORDINAL_POSITION LIMIT {max_columns + 1}",
                    (table_name,),
                )
                column_rows = list(cursor.fetchall())
        except Exception:
            _mark_columns_unavailable({table_name: entry})
            return entry
        columns_truncated = len(column_rows) > max_columns
        for row in column_rows[:max_columns]:
            entry["columns"].append(
                {
                    "name": str(_mysql_value(row, "COLUMN_NAME")),
                    "type": str(_mysql_value(row, "COLUMN_TYPE") or ""),
                    "nullable": str(_mysql_value(row, "IS_NULLABLE")).upper() == "YES",
                    "primary_key": False,
                    "unique": False,
                }
            )
        if columns_truncated:
            entry["column_metadata_status"] = "truncated"
            entry["unread_columns_at_least"] = 1
            _mark_constraints_unavailable({table_name: entry})
            return entry

        constraint_row_budget = max_columns * 4
        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        tc.TABLE_NAME,
                        tc.CONSTRAINT_NAME,
                        tc.CONSTRAINT_TYPE,
                        kcu.COLUMN_NAME,
                        kcu.ORDINAL_POSITION,
                        kcu.REFERENCED_TABLE_SCHEMA,
                        kcu.REFERENCED_TABLE_NAME,
                        kcu.REFERENCED_COLUMN_NAME,
                        rc.UPDATE_RULE,
                        rc.DELETE_RULE
                    FROM information_schema.TABLE_CONSTRAINTS AS tc
                    JOIN information_schema.KEY_COLUMN_USAGE AS kcu
                      ON kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
                     AND kcu.TABLE_NAME = tc.TABLE_NAME
                     AND kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
                    LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS AS rc
                      ON rc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
                     AND rc.TABLE_NAME = tc.TABLE_NAME
                     AND rc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
                    WHERE tc.TABLE_SCHEMA = DATABASE()
                      AND tc.TABLE_NAME = %s
                      AND tc.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY')
                    ORDER BY tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
                    """
                    + f" LIMIT {constraint_row_budget + 1}",
                    (table_name,),
                )
                constraint_rows = list(cursor.fetchall())
        except Exception:
            _mark_constraints_unavailable({table_name: entry})
            return entry
        if len(constraint_rows) > constraint_row_budget:
            _mark_constraints_unavailable({table_name: entry})
            return entry
        _apply_mysql_constraint_rows({table_name: entry}, constraint_rows)
        return entry

    def get_bounded_schema_catalog(
        self,
        conn: Any,
        *,
        max_relations: int,
        max_columns_per_relation: int,
        max_total_columns: int,
    ) -> BoundedSchemaCatalog:
        relation_limit = max_relations + 1
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM information_schema.tables "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE IN ('BASE TABLE', 'VIEW') "
                f"ORDER BY TABLE_NAME LIMIT {relation_limit}"
            )
            relation_rows = list(cursor.fetchall())

        relations_truncated = len(relation_rows) > max_relations
        relation_rows = relation_rows[:max_relations]
        entries = {
            str(_mysql_value(row, "TABLE_NAME")): _catalog_entry(
                str(_mysql_value(row, "TABLE_NAME")),
                _relation_kind(_mysql_value(row, "TABLE_TYPE")),
                schema=(
                    str(_mysql_value(row, "TABLE_SCHEMA"))
                    if _mysql_value(row, "TABLE_SCHEMA") is not None
                    else None
                ),
            )
            for row in relation_rows
        }
        remaining_columns = max_total_columns
        unread_columns_at_least = 0
        complete_entries: dict[str, dict[str, Any]] = {}
        for table_name, entry in entries.items():
            capacity = min(max_columns_per_relation, max(remaining_columns, 0))
            sentinel_limit = capacity + 1 if capacity else 1
            with conn.cursor() as cursor:
                cursor.execute(
                    "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM "
                    "information_schema.columns WHERE TABLE_SCHEMA = DATABASE() "
                    "AND TABLE_NAME = %s ORDER BY ORDINAL_POSITION "
                    f"LIMIT {sentinel_limit}",
                    (table_name,),
                )
                column_rows = list(cursor.fetchall())
            has_unread = len(column_rows) > capacity
            if has_unread:
                unread_columns_at_least += 1
                entry["column_metadata_status"] = "truncated"
            else:
                complete_entries[table_name] = entry
            for row in column_rows[:capacity]:
                entry["columns"].append(
                    {
                        "name": str(_mysql_value(row, "COLUMN_NAME")),
                        "type": str(_mysql_value(row, "COLUMN_TYPE") or ""),
                        "nullable": str(_mysql_value(row, "IS_NULLABLE")).upper() == "YES",
                        "primary_key": False,
                        "unique": False,
                    }
                )
            remaining_columns -= min(len(column_rows), capacity)
            if has_unread:
                _mark_constraints_unavailable({table_name: entry})

        if complete_entries:
            placeholders = ", ".join(["%s"] * len(complete_entries))
            constraint_row_budget = max_total_columns * 4
            try:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT
                            tc.TABLE_NAME, tc.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE,
                            kcu.COLUMN_NAME, kcu.ORDINAL_POSITION,
                            kcu.REFERENCED_TABLE_SCHEMA, kcu.REFERENCED_TABLE_NAME,
                            kcu.REFERENCED_COLUMN_NAME, rc.UPDATE_RULE, rc.DELETE_RULE
                        FROM information_schema.TABLE_CONSTRAINTS AS tc
                        JOIN information_schema.KEY_COLUMN_USAGE AS kcu
                          ON kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
                         AND kcu.TABLE_NAME = tc.TABLE_NAME
                         AND kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
                        LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS AS rc
                          ON rc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
                         AND rc.TABLE_NAME = tc.TABLE_NAME
                         AND rc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
                        WHERE tc.TABLE_SCHEMA = DATABASE()
                          AND tc.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY')
                          AND tc.TABLE_NAME IN ("""
                        + placeholders
                        + ") ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION "
                        + f"LIMIT {constraint_row_budget + 1}",
                        tuple(complete_entries),
                    )
                    constraint_rows = list(cursor.fetchall())
                    if len(constraint_rows) > constraint_row_budget:
                        _mark_constraints_unavailable(complete_entries)
                    else:
                        _apply_mysql_constraint_rows(
                            complete_entries,
                            constraint_rows,
                        )
            except Exception:
                _mark_constraints_unavailable(complete_entries)

        return BoundedSchemaCatalog(
            tables=list(entries.values()),
            relations_truncated=relations_truncated,
            unread_relations_at_least=int(relations_truncated),
            columns_truncated=bool(unread_columns_at_least),
            unread_columns_at_least=unread_columns_at_least,
        )

    def get_schema_catalog(self, conn: Any) -> list[dict[str, Any]]:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM information_schema.tables "
                "WHERE TABLE_SCHEMA = DATABASE() "
                "AND TABLE_TYPE IN ('BASE TABLE', 'VIEW') ORDER BY TABLE_NAME"
            )
            relation_rows = list(cursor.fetchall())

        entries = {
            str(_mysql_value(row, "TABLE_NAME")): _catalog_entry(
                str(_mysql_value(row, "TABLE_NAME")),
                _relation_kind(_mysql_value(row, "TABLE_TYPE")),
                schema=(
                    str(_mysql_value(row, "TABLE_SCHEMA"))
                    if _mysql_value(row, "TABLE_SCHEMA") is not None
                    else None
                ),
            )
            for row in relation_rows
        }
        if not entries:
            return []

        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE "
                    "FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() "
                    "ORDER BY TABLE_NAME, ORDINAL_POSITION"
                )
                column_rows = list(cursor.fetchall())
        except Exception:
            _mark_columns_unavailable(entries)
            return list(entries.values())

        for row in column_rows:
            table_name = str(_mysql_value(row, "TABLE_NAME"))
            entry = entries.get(table_name)
            if entry is None:
                continue
            entry["columns"].append(
                {
                    "name": str(_mysql_value(row, "COLUMN_NAME")),
                    "type": str(_mysql_value(row, "COLUMN_TYPE") or ""),
                    "nullable": str(_mysql_value(row, "IS_NULLABLE")).upper() == "YES",
                    "primary_key": False,
                    "unique": False,
                }
            )

        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        tc.TABLE_NAME,
                        tc.CONSTRAINT_NAME,
                        tc.CONSTRAINT_TYPE,
                        kcu.COLUMN_NAME,
                        kcu.ORDINAL_POSITION,
                        kcu.REFERENCED_TABLE_SCHEMA,
                        kcu.REFERENCED_TABLE_NAME,
                        kcu.REFERENCED_COLUMN_NAME,
                        rc.UPDATE_RULE,
                        rc.DELETE_RULE
                    FROM information_schema.TABLE_CONSTRAINTS AS tc
                    JOIN information_schema.KEY_COLUMN_USAGE AS kcu
                      ON kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
                     AND kcu.TABLE_NAME = tc.TABLE_NAME
                     AND kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
                    LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS AS rc
                      ON rc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
                     AND rc.TABLE_NAME = tc.TABLE_NAME
                     AND rc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
                    WHERE tc.TABLE_SCHEMA = DATABASE()
                      AND tc.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY')
                    ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
                    """
                )
                constraint_rows = list(cursor.fetchall())
        except Exception:
            _mark_constraints_unavailable(entries)
            return list(entries.values())

        grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
        for row in constraint_rows:
            table_name = str(_mysql_value(row, "TABLE_NAME"))
            constraint_name = str(_mysql_value(row, "CONSTRAINT_NAME"))
            constraint_type = str(_mysql_value(row, "CONSTRAINT_TYPE")).upper()
            if table_name not in entries:
                continue
            grouped.setdefault((table_name, constraint_name, constraint_type), []).append(row)

        for (table_name, constraint_name, constraint_type), rows in grouped.items():
            entry = entries[table_name]
            columns = [str(_mysql_value(row, "COLUMN_NAME")) for row in rows]
            if constraint_type == "PRIMARY KEY":
                entry["primary_key"] = {"name": constraint_name, "columns": columns}
            elif constraint_type == "UNIQUE":
                entry["unique_constraints"].append(
                    {
                        "name": constraint_name,
                        "columns": columns,
                        "origin": "constraint",
                        "partial": False,
                    }
                )
            elif constraint_type == "FOREIGN KEY":
                first = rows[0]
                entry["foreign_keys"].append(
                    {
                        "name": constraint_name,
                        "columns": columns,
                        "referenced_schema": _mysql_value(first, "REFERENCED_TABLE_SCHEMA"),
                        "referenced_table": _mysql_value(first, "REFERENCED_TABLE_NAME"),
                        "referenced_columns": [
                            _mysql_value(row, "REFERENCED_COLUMN_NAME") for row in rows
                        ],
                        "on_update": _mysql_value(first, "UPDATE_RULE"),
                        "on_delete": _mysql_value(first, "DELETE_RULE"),
                    }
                )

        for entry in entries.values():
            _apply_constraint_column_flags(entry)
        return list(entries.values())


class PostgreSQLAdapter:
    def __init__(self) -> None:
        self._schema = "public"

    @staticmethod
    def quote_identifier(identifier: str) -> str:
        if not identifier or "\x00" in identifier:
            raise ValueError("Invalid database identifier")
        return f'"{identifier.replace(chr(34), chr(34) * 2)}"'

    def create_connection(self, config: DatabaseConfig) -> Any:
        import psycopg2

        options = config.extra_options
        sslmode = options.get("sslmode", "prefer")
        connect_options: dict[str, Any] = {"sslmode": sslmode}
        for source, target in (
            ("sslrootcert", "sslrootcert"),
            ("sslcert", "sslcert"),
            ("sslkey", "sslkey"),
        ):
            if options.get(source):
                connect_options[target] = options[source]

        conn = psycopg2.connect(
            host=config.host,
            port=config.get_port(),
            user=config.user,
            password=config.password,
            database=config.database,
            connect_timeout=10,
            options="-c statement_timeout=60000",
            **connect_options,
        )
        schema = options.get("schema") or "public"
        self._schema = schema

        previous_autocommit = conn.autocommit
        try:
            conn.autocommit = True
            with conn.cursor() as cursor:
                cursor.execute(
                    "SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname = %s",
                    (schema,),
                )
                if cursor.fetchone() is None:
                    raise ValueError(f"PostgreSQL schema 不存在: {schema}")
                cursor.execute(
                    "SELECT set_config('search_path', quote_ident(%s), false)",
                    (schema,),
                )
        except Exception:
            conn.close()
            raise
        finally:
            if not getattr(conn, "closed", False):
                conn.autocommit = previous_autocommit
        return conn

    def enforce_read_only(self, conn: Any, *, timeout_seconds: float) -> None:
        conn.set_session(readonly=True)
        self._apply_query_timeout(conn, timeout_seconds=timeout_seconds)

    @staticmethod
    def _apply_query_timeout(conn: Any, *, timeout_seconds: float) -> None:
        milliseconds = max(1, min(int(float(timeout_seconds) * 1000), 60_000))
        with conn.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = %s", (milliseconds,))

    def get_db_info(self, conn: Any) -> tuple[str, int]:
        with conn.cursor() as cursor:
            cursor.execute("SELECT version()")
            version = cursor.fetchone()[0].split(",")[0]
            cursor.execute(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = %s",
                (self._schema,),
            )
            tables_count = cursor.fetchone()[0]
        return version, tables_count

    def execute_sql(
        self,
        conn: Any,
        sql: str,
        max_rows: int | None = None,
        cancellation_event: threading.Event | None = None,
        timeout_seconds: float | None = None,
        connection_config: DatabaseConfig | None = None,
        read_only_prepared: bool = False,
    ) -> AdapterQueryResult:
        _raise_if_cancelled(cancellation_event)
        import psycopg2.extras

        del connection_config

        def cancel_query() -> None:
            try:
                # psycopg2 explicitly supports cancel() from a different thread.
                conn.cancel()
            except Exception:
                # A failed cancel request must not leave the blocking connection
                # eligible for later reuse.
                _close_connection_quietly(conn)

        with _cancellable_query(
            cancellation_event,
            cancel_query,
            driver="postgresql",
        ):
            effective_timeout = 60.0 if timeout_seconds is None else timeout_seconds
            if read_only_prepared:
                self._apply_query_timeout(conn, timeout_seconds=effective_timeout)
            else:
                self.enforce_read_only(conn, timeout_seconds=effective_timeout)

            # A named cursor fetches rows from PostgreSQL incrementally instead
            # of materializing the entire result inside psycopg2 first.
            cursor_name = f"receiptbi_{time.monotonic_ns()}"
            with conn.cursor(
                name=cursor_name,
                cursor_factory=psycopg2.extras.RealDictCursor,
            ) as cursor:
                cursor.itersize = max(1, min(max_rows or 1000, 1000))
                cursor.execute(sql)
                rows = cursor.fetchmany(max_rows) if max_rows is not None else cursor.fetchall()
                return AdapterQueryResult(
                    data=[dict(row) for row in rows],
                    metadata={"streaming": True},
                )

    def get_tables(self, conn: Any) -> list[str]:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = %s
                  AND table_type IN ('BASE TABLE', 'VIEW')
                ORDER BY table_name
                """,
                (self._schema,),
            )
            return [row[0] for row in cursor.fetchall()]

    def get_table_columns(self, conn: Any, table_name: str) -> list[dict[str, Any]]:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT column_name, data_type, is_nullable
                FROM information_schema.columns
                WHERE table_schema = %s AND table_name = %s
                ORDER BY ordinal_position
                """,
                (self._schema, table_name),
            )
            return [
                {
                    "name": row[0],
                    "type": row[1],
                    "nullable": str(row[2]).upper() == "YES",
                    "primary_key": None,
                    "unique": None,
                }
                for row in cursor.fetchall()
            ]

    def validate_relation_columns(self, conn: Any, table_name: str, columns: list[str]) -> bool:
        if not columns:
            return False
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = %s AND table_name = %s "
                "AND column_name = ANY(%s) LIMIT %s",
                (self._schema, table_name, columns, len(columns) + 1),
            )
            found = {str(row[0]) for row in cursor.fetchall()}
        return found == set(columns)

    def get_bounded_relation_index(
        self,
        conn: Any,
        *,
        max_relations: int,
        after: str | None = None,
    ) -> BoundedRelationIndex:
        with conn.cursor() as cursor:
            after_clause = " AND relation.relname > %s" if after is not None else ""
            cursor.execute(
                f"""
                SELECT
                    relation.relname,
                    CASE relation.relkind
                        WHEN 'r' THEN 'table'
                        WHEN 'p' THEN 'partitioned_table'
                        WHEN 'v' THEN 'view'
                        WHEN 'm' THEN 'materialized_view'
                        WHEN 'f' THEN 'foreign_table'
                        ELSE 'unknown'
                    END,
                    pg_catalog.obj_description(relation.oid, 'pg_class')
                FROM pg_catalog.pg_class AS relation
                JOIN pg_catalog.pg_namespace AS namespace
                  ON namespace.oid = relation.relnamespace
                WHERE namespace.nspname = %s
                  AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
                  AND (
                      pg_catalog.has_table_privilege(relation.oid, 'SELECT')
                      OR pg_catalog.has_any_column_privilege(relation.oid, 'SELECT')
                  )
                  {after_clause}
                ORDER BY relation.relname
                LIMIT %s
                """,
                (
                    (self._schema, after, max_relations + 1)
                    if after is not None
                    else (self._schema, max_relations + 1)
                ),
            )
            rows = list(cursor.fetchall())
        truncated = len(rows) > max_relations
        relations = [
            _relation_index_entry(
                str(row[0]),
                _relation_kind(row[1]),
                schema=self._schema,
                comment=row[2] if len(row) > 2 else None,
            )
            for row in rows[:max_relations]
        ]
        return BoundedRelationIndex(
            relations=relations,
            truncated=truncated,
            unread_relations_at_least=int(truncated),
        )

    def get_bounded_relation_schema(
        self,
        conn: Any,
        *,
        table_name: str,
        max_columns: int,
    ) -> dict[str, Any]:
        """Read one named relation and its declared constraints with hard bounds."""

        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    relation.relname,
                    CASE relation.relkind
                        WHEN 'r' THEN 'table'
                        WHEN 'p' THEN 'partitioned_table'
                        WHEN 'v' THEN 'view'
                        WHEN 'm' THEN 'materialized_view'
                        WHEN 'f' THEN 'foreign_table'
                        ELSE 'unknown'
                    END,
                    pg_catalog.obj_description(relation.oid, 'pg_class')
                FROM pg_catalog.pg_class AS relation
                JOIN pg_catalog.pg_namespace AS namespace
                  ON namespace.oid = relation.relnamespace
                WHERE namespace.nspname = %s
                  AND relation.relname = %s
                  AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
                  AND (
                      pg_catalog.has_table_privilege(relation.oid, 'SELECT')
                      OR pg_catalog.has_any_column_privilege(relation.oid, 'SELECT')
                  )
                LIMIT 1
                """,
                (self._schema, table_name),
            )
            relation_rows = list(cursor.fetchall())
        if not relation_rows:
            raise ValueError("所选表不存在或不可读取")
        relation = relation_rows[0]
        entry = _catalog_entry(
            str(relation[0]),
            str(relation[1] or "unknown"),
            schema=self._schema,
        )
        entry["comment"] = relation[2]
        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    "SELECT column_name, data_type, is_nullable "
                    "FROM information_schema.columns "
                    "WHERE table_schema = %s AND table_name = %s "
                    "ORDER BY ordinal_position LIMIT %s",
                    (self._schema, table_name, max_columns + 1),
                )
                column_rows = list(cursor.fetchall())
        except Exception:
            _mark_columns_unavailable({table_name: entry})
            return entry
        columns_truncated = len(column_rows) > max_columns
        for column_name, data_type, is_nullable in column_rows[:max_columns]:
            entry["columns"].append(
                {
                    "name": str(column_name),
                    "type": str(data_type or ""),
                    "nullable": str(is_nullable).upper() == "YES",
                    "primary_key": False,
                    "unique": False,
                }
            )
        if columns_truncated:
            entry["column_metadata_status"] = "truncated"
            entry["unread_columns_at_least"] = 1
            _mark_constraints_unavailable({table_name: entry})
            return entry

        constraint_row_budget = max_columns * 4
        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        relation.relname AS table_name,
                        constraint_record.conname AS constraint_name,
                        constraint_record.contype AS constraint_type,
                        ARRAY(
                            SELECT attribute.attname
                            FROM unnest(constraint_record.conkey)
                                WITH ORDINALITY AS source_key(attnum, position)
                            JOIN pg_catalog.pg_attribute AS attribute
                              ON attribute.attrelid = constraint_record.conrelid
                             AND attribute.attnum = source_key.attnum
                            ORDER BY source_key.position
                        ) AS columns,
                        referenced_namespace.nspname AS referenced_schema,
                        referenced_relation.relname AS referenced_table,
                        CASE WHEN constraint_record.contype = 'f' THEN ARRAY(
                            SELECT attribute.attname
                            FROM unnest(constraint_record.confkey)
                                WITH ORDINALITY AS target_key(attnum, position)
                            JOIN pg_catalog.pg_attribute AS attribute
                              ON attribute.attrelid = constraint_record.confrelid
                             AND attribute.attnum = target_key.attnum
                            ORDER BY target_key.position
                        ) ELSE NULL END AS referenced_columns,
                        constraint_record.confupdtype AS update_action,
                        constraint_record.confdeltype AS delete_action
                    FROM pg_catalog.pg_constraint AS constraint_record
                    JOIN pg_catalog.pg_class AS relation
                      ON relation.oid = constraint_record.conrelid
                    JOIN pg_catalog.pg_namespace AS namespace
                      ON namespace.oid = relation.relnamespace
                    LEFT JOIN pg_catalog.pg_class AS referenced_relation
                      ON referenced_relation.oid = constraint_record.confrelid
                    LEFT JOIN pg_catalog.pg_namespace AS referenced_namespace
                      ON referenced_namespace.oid = referenced_relation.relnamespace
                    WHERE namespace.nspname = %s
                      AND relation.relname = %s
                      AND constraint_record.contype IN ('p', 'u', 'f')
                    ORDER BY constraint_record.conname
                    LIMIT %s
                    """,
                    (self._schema, table_name, constraint_row_budget + 1),
                )
                constraint_rows = list(cursor.fetchall())
        except Exception:
            _mark_constraints_unavailable({table_name: entry})
            return entry
        if len(constraint_rows) > constraint_row_budget:
            _mark_constraints_unavailable({table_name: entry})
            return entry
        _apply_postgresql_constraint_rows({table_name: entry}, constraint_rows)
        return entry

    def get_bounded_schema_catalog(
        self,
        conn: Any,
        *,
        max_relations: int,
        max_columns_per_relation: int,
        max_total_columns: int,
    ) -> BoundedSchemaCatalog:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT table_name, table_type
                FROM information_schema.tables
                WHERE table_schema = %s
                  AND table_type IN ('BASE TABLE', 'VIEW')
                ORDER BY table_name
                LIMIT %s
                """,
                (self._schema, max_relations + 1),
            )
            relation_rows = list(cursor.fetchall())

        relations_truncated = len(relation_rows) > max_relations
        entries = {
            str(row[0]): _catalog_entry(str(row[0]), _relation_kind(row[1]), schema=self._schema)
            for row in relation_rows[:max_relations]
        }
        remaining_columns = max_total_columns
        unread_columns_at_least = 0
        complete_entries: dict[str, dict[str, Any]] = {}
        for table_name, entry in entries.items():
            capacity = min(max_columns_per_relation, max(remaining_columns, 0))
            sentinel_limit = capacity + 1 if capacity else 1
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT column_name, data_type, is_nullable
                    FROM information_schema.columns
                    WHERE table_schema = %s AND table_name = %s
                    ORDER BY ordinal_position
                    LIMIT %s
                    """,
                    (self._schema, table_name, sentinel_limit),
                )
                column_rows = list(cursor.fetchall())
            has_unread = len(column_rows) > capacity
            if has_unread:
                unread_columns_at_least += 1
                entry["column_metadata_status"] = "truncated"
            else:
                complete_entries[table_name] = entry
            for column_name, data_type, is_nullable in column_rows[:capacity]:
                entry["columns"].append(
                    {
                        "name": str(column_name),
                        "type": str(data_type or ""),
                        "nullable": str(is_nullable).upper() == "YES",
                        "primary_key": False,
                        "unique": False,
                    }
                )
            remaining_columns -= min(len(column_rows), capacity)
            if has_unread:
                _mark_constraints_unavailable({table_name: entry})

        if complete_entries:
            constraint_row_budget = max_total_columns * 4
            try:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT
                            relation.relname AS table_name,
                            constraint_record.conname AS constraint_name,
                            constraint_record.contype AS constraint_type,
                            ARRAY(
                                SELECT attribute.attname
                                FROM unnest(constraint_record.conkey)
                                    WITH ORDINALITY AS source_key(attnum, position)
                                JOIN pg_catalog.pg_attribute AS attribute
                                  ON attribute.attrelid = constraint_record.conrelid
                                 AND attribute.attnum = source_key.attnum
                                ORDER BY source_key.position
                            ) AS columns,
                            referenced_namespace.nspname AS referenced_schema,
                            referenced_relation.relname AS referenced_table,
                            CASE WHEN constraint_record.contype = 'f' THEN ARRAY(
                                SELECT attribute.attname
                                FROM unnest(constraint_record.confkey)
                                    WITH ORDINALITY AS target_key(attnum, position)
                                JOIN pg_catalog.pg_attribute AS attribute
                                  ON attribute.attrelid = constraint_record.confrelid
                                 AND attribute.attnum = target_key.attnum
                                ORDER BY target_key.position
                            ) ELSE NULL END AS referenced_columns,
                            constraint_record.confupdtype AS update_action,
                            constraint_record.confdeltype AS delete_action
                        FROM pg_catalog.pg_constraint AS constraint_record
                        JOIN pg_catalog.pg_class AS relation
                          ON relation.oid = constraint_record.conrelid
                        JOIN pg_catalog.pg_namespace AS namespace
                          ON namespace.oid = relation.relnamespace
                        LEFT JOIN pg_catalog.pg_class AS referenced_relation
                          ON referenced_relation.oid = constraint_record.confrelid
                        LEFT JOIN pg_catalog.pg_namespace AS referenced_namespace
                          ON referenced_namespace.oid = referenced_relation.relnamespace
                        WHERE namespace.nspname = %s
                          AND constraint_record.contype IN ('p', 'u', 'f')
                          AND relation.relname = ANY(%s)
                        ORDER BY relation.relname, constraint_record.conname
                        LIMIT %s
                        """,
                        (
                            self._schema,
                            list(complete_entries),
                            constraint_row_budget + 1,
                        ),
                    )
                    constraint_rows = list(cursor.fetchall())
                    if len(constraint_rows) > constraint_row_budget:
                        _mark_constraints_unavailable(complete_entries)
                    else:
                        _apply_postgresql_constraint_rows(
                            complete_entries,
                            constraint_rows,
                        )
            except Exception:
                _mark_constraints_unavailable(complete_entries)

        return BoundedSchemaCatalog(
            tables=list(entries.values()),
            relations_truncated=relations_truncated,
            unread_relations_at_least=int(relations_truncated),
            columns_truncated=bool(unread_columns_at_least),
            unread_columns_at_least=unread_columns_at_least,
        )

    def get_schema_catalog(self, conn: Any) -> list[dict[str, Any]]:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT table_name, table_type
                FROM information_schema.tables
                WHERE table_schema = %s
                  AND table_type IN ('BASE TABLE', 'VIEW')
                ORDER BY table_name
                """,
                (self._schema,),
            )
            relation_rows = list(cursor.fetchall())

        entries = {
            str(row[0]): _catalog_entry(str(row[0]), _relation_kind(row[1]), schema=self._schema)
            for row in relation_rows
        }
        if not entries:
            return []

        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT table_name, column_name, data_type, is_nullable
                    FROM information_schema.columns
                    WHERE table_schema = %s
                    ORDER BY table_name, ordinal_position
                    """,
                    (self._schema,),
                )
                column_rows = list(cursor.fetchall())
        except Exception:
            _mark_columns_unavailable(entries)
            return list(entries.values())

        for table_name, column_name, data_type, is_nullable in column_rows:
            entry = entries.get(str(table_name))
            if entry is None:
                continue
            entry["columns"].append(
                {
                    "name": str(column_name),
                    "type": str(data_type or ""),
                    "nullable": str(is_nullable).upper() == "YES",
                    "primary_key": False,
                    "unique": False,
                }
            )

        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        relation.relname AS table_name,
                        constraint_record.conname AS constraint_name,
                        constraint_record.contype AS constraint_type,
                        ARRAY(
                            SELECT attribute.attname
                            FROM unnest(constraint_record.conkey)
                                WITH ORDINALITY AS source_key(attnum, position)
                            JOIN pg_catalog.pg_attribute AS attribute
                              ON attribute.attrelid = constraint_record.conrelid
                             AND attribute.attnum = source_key.attnum
                            ORDER BY source_key.position
                        ) AS columns,
                        referenced_namespace.nspname AS referenced_schema,
                        referenced_relation.relname AS referenced_table,
                        CASE WHEN constraint_record.contype = 'f' THEN ARRAY(
                            SELECT attribute.attname
                            FROM unnest(constraint_record.confkey)
                                WITH ORDINALITY AS target_key(attnum, position)
                            JOIN pg_catalog.pg_attribute AS attribute
                              ON attribute.attrelid = constraint_record.confrelid
                             AND attribute.attnum = target_key.attnum
                            ORDER BY target_key.position
                        ) ELSE NULL END AS referenced_columns,
                        constraint_record.confupdtype AS update_action,
                        constraint_record.confdeltype AS delete_action
                    FROM pg_catalog.pg_constraint AS constraint_record
                    JOIN pg_catalog.pg_class AS relation
                      ON relation.oid = constraint_record.conrelid
                    JOIN pg_catalog.pg_namespace AS namespace
                      ON namespace.oid = relation.relnamespace
                    LEFT JOIN pg_catalog.pg_class AS referenced_relation
                      ON referenced_relation.oid = constraint_record.confrelid
                    LEFT JOIN pg_catalog.pg_namespace AS referenced_namespace
                      ON referenced_namespace.oid = referenced_relation.relnamespace
                    WHERE namespace.nspname = %s
                      AND constraint_record.contype IN ('p', 'u', 'f')
                    ORDER BY relation.relname, constraint_record.conname
                    """,
                    (self._schema,),
                )
                constraint_rows = list(cursor.fetchall())
        except Exception:
            _mark_constraints_unavailable(entries)
            return list(entries.values())

        action_names = {
            "a": "NO ACTION",
            "r": "RESTRICT",
            "c": "CASCADE",
            "n": "SET NULL",
            "d": "SET DEFAULT",
        }
        for row in constraint_rows:
            (
                table_name,
                constraint_name,
                constraint_type,
                columns,
                referenced_schema,
                referenced_table,
                referenced_columns,
                update_action,
                delete_action,
            ) = row
            entry = entries.get(str(table_name))
            if entry is None:
                continue
            normalized_columns = [str(column) for column in columns or []]
            if constraint_type == "p":
                entry["primary_key"] = {
                    "name": str(constraint_name),
                    "columns": normalized_columns,
                }
            elif constraint_type == "u":
                entry["unique_constraints"].append(
                    {
                        "name": str(constraint_name),
                        "columns": normalized_columns,
                        "origin": "constraint",
                        "partial": False,
                    }
                )
            elif constraint_type == "f":
                entry["foreign_keys"].append(
                    {
                        "name": str(constraint_name),
                        "columns": normalized_columns,
                        "referenced_schema": (
                            str(referenced_schema) if referenced_schema else None
                        ),
                        "referenced_table": (str(referenced_table) if referenced_table else None),
                        "referenced_columns": [str(column) for column in referenced_columns or []],
                        "on_update": action_names.get(str(update_action), None),
                        "on_delete": action_names.get(str(delete_action), None),
                    }
                )

        for entry in entries.values():
            _apply_constraint_column_flags(entry)
        return list(entries.values())


def is_valid_sqlite_identifier(identifier: str) -> bool:
    """Validate a SQLite identifier used in non-parameterized PRAGMA calls."""
    if not identifier or len(identifier) > 128:
        return False

    if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", identifier):
        return False

    sqlite_keywords = {
        "ABORT",
        "ACTION",
        "ADD",
        "AFTER",
        "ALL",
        "ALTER",
        "ANALYZE",
        "AND",
        "AS",
        "ASC",
        "ATTACH",
        "AUTOINCREMENT",
        "BEFORE",
        "BEGIN",
        "BETWEEN",
        "BY",
        "CASCADE",
        "CASE",
        "CAST",
        "CHECK",
        "COLLATE",
        "COLUMN",
        "COMMIT",
        "CONFLICT",
        "CONSTRAINT",
        "CREATE",
        "CROSS",
        "CURRENT",
        "CURRENT_DATE",
        "CURRENT_TIME",
        "CURRENT_TIMESTAMP",
        "DATABASE",
        "DEFAULT",
        "DEFERRABLE",
        "DEFERRED",
        "DELETE",
        "DESC",
        "DETACH",
        "DISTINCT",
        "DO",
        "DROP",
        "EACH",
        "ELSE",
        "END",
        "ESCAPE",
        "EXCEPT",
        "EXCLUSIVE",
        "EXISTS",
        "EXPLAIN",
        "FAIL",
        "FILTER",
        "FOLLOWING",
        "FOR",
        "FOREIGN",
        "FROM",
        "FULL",
        "GLOB",
        "GROUP",
        "HAVING",
        "IF",
        "IGNORE",
        "IMMEDIATE",
        "IN",
        "INDEX",
        "INDEXED",
        "INITIALLY",
        "INNER",
        "INSERT",
        "INSTEAD",
        "INTERSECT",
        "INTO",
        "IS",
        "ISNULL",
        "JOIN",
        "KEY",
        "LEFT",
        "LIKE",
        "LIMIT",
        "MATCH",
        "NATURAL",
        "NO",
        "NOT",
        "NOTNULL",
        "NULL",
        "OF",
        "OFFSET",
        "ON",
        "OR",
        "ORDER",
        "OUTER",
        "PLAN",
        "PRAGMA",
        "PRIMARY",
        "QUERY",
        "RAISE",
        "RANGE",
        "RECURSIVE",
        "REFERENCES",
        "REGEXP",
        "REINDEX",
        "RELEASE",
        "RENAME",
        "REPLACE",
        "RESTRICT",
        "RIGHT",
        "ROLLBACK",
        "ROW",
        "ROWS",
        "SAVEPOINT",
        "SELECT",
        "SET",
        "TABLE",
        "TEMP",
        "TEMPORARY",
        "THEN",
        "TO",
        "TRANSACTION",
        "TRIGGER",
        "UNION",
        "UNIQUE",
        "UPDATE",
        "USING",
        "VACUUM",
        "VALUES",
        "VIEW",
        "VIRTUAL",
        "WHEN",
        "WHERE",
        "WINDOW",
        "WITH",
        "WITHOUT",
    }
    return identifier.upper() not in sqlite_keywords


class SQLiteAdapter:
    def __init__(self, trusted_executor_path: Path | None = None):
        self._trusted_executor = (
            RustSQLiteSidecarExecutor(trusted_executor_path) if trusted_executor_path else None
        )

    @staticmethod
    def quote_identifier(identifier: str) -> str:
        if not identifier or "\x00" in identifier:
            raise ValueError("Invalid database identifier")
        return f'"{identifier.replace(chr(34), chr(34) * 2)}"'

    @staticmethod
    def _is_internal_metadata_database(database_path: Path) -> bool:
        if database_path.name.lower() in {"receiptbi.db", "querygpt.db"}:
            return True
        from app.core.config import settings

        db_url = str(settings.DATABASE_URL or "")
        for prefix in ("sqlite+aiosqlite:///", "sqlite:///"):
            if db_url.startswith(prefix):
                raw_target = db_url[len(prefix) :].split("?", 1)[0]
                if raw_target and raw_target != ":memory:":
                    with contextlib.suppress(OSError):
                        if database_path == Path(raw_target).expanduser().resolve():
                            return True
        return False

    def create_connection(self, config: DatabaseConfig) -> Any:
        import sqlite3

        if config.database != ":memory:":
            database_path = Path(config.database).expanduser().resolve()
            if self._is_internal_metadata_database(database_path):
                raise PermissionError("禁止连接 ReceiptBI 内部元数据数据库")
            if not database_path.is_file():
                raise FileNotFoundError(f"SQLite database does not exist: {database_path}")
            conn = sqlite3.connect(f"{database_path.as_uri()}?mode=ro", uri=True)
        else:
            conn = sqlite3.connect(config.database)
        conn.row_factory = sqlite3.Row
        return conn

    @staticmethod
    def enforce_read_only(conn: Any, *, timeout_seconds: float) -> None:
        del timeout_seconds
        conn.execute("PRAGMA query_only=ON")

    def get_db_info(self, conn: Any) -> tuple[str, int]:
        cursor = conn.cursor()
        cursor.execute("SELECT sqlite_version()")
        version = f"SQLite {cursor.fetchone()[0]}"
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
        tables_count = cursor.fetchone()[0]
        return version, tables_count

    def execute_sql(
        self,
        conn: Any,
        sql: str,
        max_rows: int | None = None,
        cancellation_event: threading.Event | None = None,
        timeout_seconds: float | None = None,
        connection_config: DatabaseConfig | None = None,
        read_only_prepared: bool = False,
    ) -> AdapterQueryResult:
        del connection_config, read_only_prepared
        _raise_if_cancelled(cancellation_event)

        database_path = self._database_path(conn)
        if self._trusted_executor is not None and database_path is not None:
            allowed_relations = self._get_allowed_relations(conn)
            if len(allowed_relations) > 128:
                raise RuntimeError("Trusted SQLite executor supports at most 128 relations")
            try:
                result = self._trusted_executor.execute(
                    database_path=database_path,
                    sql=sql,
                    allowed_relations=allowed_relations,
                    max_rows=max_rows if max_rows is not None else MAX_CORE_ROWS,
                    cancellation_event=cancellation_event,
                    **({"timeout_seconds": timeout_seconds} if timeout_seconds is not None else {}),
                )
            except TrustedSQLiteExecutionCancelledError as exc:
                raise DatabaseQueryCancelledError("Database query was cancelled") from exc
            return AdapterQueryResult(
                data=result.data,
                truncated=result.truncated,
                backend="rust-sidecar",
                metadata={
                    "source_identity": result.source_identity,
                    "duration_ms": result.duration_ms,
                    "byte_count": result.byte_count,
                    "truncation_reason": result.truncation_reason,
                },
            )

        cursor = conn.cursor()
        deadline = time.monotonic() + (
            max(0.01, min(float(timeout_seconds), 60.0)) if timeout_seconds is not None else 60.0
        )
        conn.execute("PRAGMA query_only=ON")
        conn.set_progress_handler(
            lambda: int(
                time.monotonic() >= deadline
                or (cancellation_event is not None and cancellation_event.is_set())
            ),
            10_000,
        )
        try:
            cursor.execute(sql)
            rows = cursor.fetchmany(max_rows) if max_rows is not None else cursor.fetchall()
            return AdapterQueryResult(data=[dict(row) for row in rows])
        except Exception as exc:
            if cancellation_event is not None and cancellation_event.is_set():
                raise DatabaseQueryCancelledError("Database query was cancelled") from exc
            raise
        finally:
            conn.set_progress_handler(None, 0)

    @staticmethod
    def _database_path(conn: Any) -> Path | None:
        row = conn.execute("PRAGMA database_list").fetchone()
        if row is None or not row[2]:
            return None
        return Path(str(row[2])).expanduser().resolve()

    @staticmethod
    def _get_allowed_relations(conn: Any) -> list[str]:
        rows = conn.execute(
            "SELECT name FROM sqlite_schema "
            "WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
        return [str(row[0]) for row in rows]

    def get_tables(self, conn: Any) -> list[str]:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT name FROM sqlite_schema "
            "WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        return [row[0] for row in cursor.fetchall()]

    def get_table_columns(self, conn: Any, table_name: str) -> list[dict[str, Any]]:
        entries = {table_name: _catalog_entry(table_name, "unknown")}
        entry = entries[table_name]
        try:
            self._populate_sqlite_columns(conn, entry)
            self._populate_sqlite_constraints(conn, entry)
            _apply_constraint_column_flags(entry)
        except Exception:
            if not entry["columns"]:
                raise
            _mark_constraints_unavailable(entries)
        return list(entry["columns"])

    def validate_relation_columns(self, conn: Any, table_name: str, columns: list[str]) -> bool:
        if not columns:
            return False
        relation = conn.execute(
            "SELECT 1 FROM sqlite_schema WHERE name = ? "
            "AND type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' LIMIT 1",
            (table_name,),
        ).fetchone()
        if relation is None:
            return False
        placeholders = ", ".join(["?"] * len(columns))
        rows = conn.execute(
            f"SELECT name FROM pragma_table_xinfo(?) WHERE hidden != 1 "
            f"AND name IN ({placeholders}) LIMIT ?",
            (table_name, *columns, len(columns) + 1),
        ).fetchall()
        return {str(row[0]) for row in rows} == set(columns)

    def get_bounded_relation_index(
        self,
        conn: Any,
        *,
        max_relations: int,
        after: str | None = None,
    ) -> BoundedRelationIndex:
        after_clause = "AND name > ? " if after is not None else ""
        rows = conn.execute(
            "SELECT name, type FROM sqlite_schema "
            "WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' "
            f"{after_clause}ORDER BY name LIMIT ?",
            ((after, max_relations + 1) if after is not None else (max_relations + 1,)),
        ).fetchall()
        truncated = len(rows) > max_relations
        return BoundedRelationIndex(
            relations=[
                _relation_index_entry(
                    str(row[0]),
                    _relation_kind(row[1]),
                    schema="main",
                )
                for row in rows[:max_relations]
            ],
            truncated=truncated,
            unread_relations_at_least=int(truncated),
        )

    def get_bounded_relation_schema(
        self,
        conn: Any,
        *,
        table_name: str,
        max_columns: int,
    ) -> dict[str, Any]:
        """Read one SQLite relation's columns and declared constraints."""

        relation = conn.execute(
            "SELECT name, type FROM sqlite_schema "
            "WHERE name = ? AND type IN ('table', 'view') "
            "AND name NOT LIKE 'sqlite_%' LIMIT 1",
            (table_name,),
        ).fetchone()
        if relation is None:
            raise ValueError("所选表不存在或不可读取")
        entry = _catalog_entry(
            str(relation[0]),
            _relation_kind(relation[1]),
            schema="main",
        )
        try:
            columns_truncated = self._populate_sqlite_columns(
                conn,
                entry,
                max_columns=max_columns,
            )
        except Exception:
            _mark_columns_unavailable({table_name: entry})
            return entry
        if columns_truncated:
            entry["column_metadata_status"] = "truncated"
            entry["unread_columns_at_least"] = 1
            _mark_constraints_unavailable({table_name: entry})
            return entry
        try:
            self._populate_sqlite_constraints(conn, entry)
            _apply_constraint_column_flags(entry)
        except Exception:
            _mark_constraints_unavailable({table_name: entry})
        return entry

    def get_bounded_schema_catalog(
        self,
        conn: Any,
        *,
        max_relations: int,
        max_columns_per_relation: int,
        max_total_columns: int,
    ) -> BoundedSchemaCatalog:
        rows = conn.execute(
            "SELECT name, type FROM sqlite_schema "
            "WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' "
            "ORDER BY name LIMIT ?",
            (max_relations + 1,),
        ).fetchall()
        relations_truncated = len(rows) > max_relations
        entries = {
            str(row[0]): _catalog_entry(str(row[0]), _relation_kind(row[1]), schema="main")
            for row in rows[:max_relations]
        }
        remaining_columns = max_total_columns
        unread_columns_at_least = 0
        for table_name, entry in entries.items():
            capacity = min(max_columns_per_relation, max(remaining_columns, 0))
            try:
                columns_truncated = self._populate_sqlite_columns(
                    conn,
                    entry,
                    max_columns=capacity,
                )
            except Exception:
                entry["column_metadata_status"] = "unavailable"
                _mark_constraints_unavailable({table_name: entry})
                continue
            remaining_columns -= len(entry["columns"])
            if columns_truncated:
                unread_columns_at_least += 1
                entry["column_metadata_status"] = "truncated"
                _mark_constraints_unavailable({table_name: entry})
                continue
            try:
                self._populate_sqlite_constraints(conn, entry)
                _apply_constraint_column_flags(entry)
            except Exception:
                _mark_constraints_unavailable({table_name: entry})

        return BoundedSchemaCatalog(
            tables=list(entries.values()),
            relations_truncated=relations_truncated,
            unread_relations_at_least=int(relations_truncated),
            columns_truncated=bool(unread_columns_at_least),
            unread_columns_at_least=unread_columns_at_least,
        )

    def get_schema_catalog(self, conn: Any) -> list[dict[str, Any]]:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT name, type FROM sqlite_schema "
            "WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        entries = {
            str(row[0]): _catalog_entry(str(row[0]), _relation_kind(row[1]), schema="main")
            for row in cursor.fetchall()
        }
        for table_name, entry in entries.items():
            try:
                self._populate_sqlite_columns(conn, entry)
            except Exception:
                entry["column_metadata_status"] = "unavailable"
                entry["constraint_metadata_status"] = "unavailable"
                entry["columns"] = []
                entry["primary_key"] = None
                entry["foreign_keys"] = None
                entry["unique_constraints"] = None
                continue
            try:
                self._populate_sqlite_constraints(conn, entry)
                _apply_constraint_column_flags(entry)
            except Exception:
                _mark_constraints_unavailable({table_name: entry})
        return list(entries.values())

    def _populate_sqlite_columns(
        self,
        conn: Any,
        entry: dict[str, Any],
        *,
        max_columns: int | None = None,
    ) -> bool:
        table_name = str(entry["name"])
        cursor = conn.cursor()
        if max_columns is None:
            cursor.execute(f"PRAGMA table_xinfo({self.quote_identifier(table_name)})")
            rows = list(cursor.fetchall())
            truncated = False
        else:
            sentinel_limit = max_columns + 1 if max_columns else 1
            cursor.execute(
                'SELECT cid, name, type, "notnull", dflt_value, pk, hidden '
                "FROM pragma_table_xinfo(?) WHERE hidden != 1 "
                "ORDER BY cid LIMIT ?",
                (table_name, sentinel_limit),
            )
            bounded_rows = list(cursor.fetchall())
            truncated = len(bounded_rows) > max_columns
            rows = bounded_rows[:max_columns]
        primary_parts: list[tuple[int, str]] = []
        declared_types: dict[str, str] = {}
        for row in rows:
            hidden = int(row[6]) if len(row) > 6 else 0
            if hidden == 1:
                continue
            primary_position = int(row[5] or 0)
            column_name = str(row[1])
            declared_type = str(row[2] or "")
            declared_types[column_name] = declared_type
            entry["columns"].append(
                {
                    "name": column_name,
                    "type": declared_type,
                    # SQLite rowid tables historically allow NULL in non-INTEGER
                    # PRIMARY KEY columns unless NOT NULL was declared explicitly.
                    "nullable": not bool(row[3]),
                    "primary_key": primary_position > 0,
                    "unique": False,
                }
            )
            if primary_position > 0:
                primary_parts.append((primary_position, column_name))
        if primary_parts:
            ordered_primary_columns = [name for _, name in sorted(primary_parts)]
            entry["primary_key"] = {
                "name": None,
                "columns": ordered_primary_columns,
            }
            table_list_cursor = conn.cursor()
            table_list_cursor.execute(f"PRAGMA table_list({self.quote_identifier(table_name)})")
            table_flags = table_list_cursor.fetchone()
            without_rowid = bool(table_flags[4]) if table_flags is not None else False
            strict = bool(table_flags[5]) if table_flags is not None else False
            integer_rowid_primary_key = (
                len(ordered_primary_columns) == 1
                and declared_types[ordered_primary_columns[0]].strip().upper() == "INTEGER"
            )
            if without_rowid or strict or integer_rowid_primary_key:
                primary_column_names = set(ordered_primary_columns)
                for column in entry["columns"]:
                    if column["name"] in primary_column_names:
                        column["nullable"] = False
        return truncated

    def _populate_sqlite_constraints(self, conn: Any, entry: dict[str, Any]) -> None:
        table_name = str(entry["name"])
        quoted_table = self.quote_identifier(table_name)
        cursor = conn.cursor()
        cursor.execute(f"PRAGMA index_list({quoted_table})")
        for row in cursor.fetchall():
            if not bool(row[2]):
                continue
            index_name = str(row[1])
            origin = str(row[3]) if len(row) > 3 else "c"
            partial = bool(row[4]) if len(row) > 4 else False
            if origin == "pk":
                continue
            index_cursor = conn.cursor()
            index_cursor.execute(f"PRAGMA index_info({self.quote_identifier(index_name)})")
            column_names = [
                str(index_row[2])
                for index_row in index_cursor.fetchall()
                if index_row[2] is not None
            ]
            if not column_names:
                continue
            entry["unique_constraints"].append(
                {
                    "name": index_name,
                    "columns": column_names,
                    "origin": "constraint" if origin == "u" else "unique_index",
                    "partial": partial,
                }
            )

        cursor = conn.cursor()
        cursor.execute(f"PRAGMA foreign_key_list({quoted_table})")
        grouped_foreign_keys: dict[int, list[Any]] = {}
        for row in cursor.fetchall():
            grouped_foreign_keys.setdefault(int(row[0]), []).append(row)
        for foreign_key_id, rows in sorted(grouped_foreign_keys.items()):
            ordered_rows = sorted(rows, key=lambda item: int(item[1]))
            first = ordered_rows[0]
            entry["foreign_keys"].append(
                {
                    "name": None,
                    "catalog_id": foreign_key_id,
                    "columns": [str(row[3]) for row in ordered_rows],
                    "referenced_schema": "main",
                    "referenced_table": str(first[2]),
                    "referenced_columns": [
                        str(row[4]) if row[4] is not None else None for row in ordered_rows
                    ],
                    "on_update": str(first[5]),
                    "on_delete": str(first[6]),
                    "match": str(first[7]),
                }
            )


def build_database_adapter(
    driver: str, *, trusted_sqlite_executor_path: Path | None = None
) -> DatabaseAdapter:
    if driver == "mysql":
        return MySQLAdapter()
    if driver == "postgresql":
        return PostgreSQLAdapter()
    if driver == "sqlite":
        return SQLiteAdapter(trusted_sqlite_executor_path)
    raise ValueError(f"不支持的数据库类型: {driver}")
