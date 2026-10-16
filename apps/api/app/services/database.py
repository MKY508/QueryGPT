"""
数据库连接管理器
统一管理 MySQL、PostgreSQL、SQLite 的连接和查询
"""

from __future__ import annotations

import re
import threading
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any

import structlog

from app.services.database_adapters import (
    AdapterQueryResult,
    BoundedRelationIndex,
    BoundedSchemaCatalog,
    DatabaseQueryCancelledError,
    build_database_adapter,
    is_valid_sqlite_identifier,
)
from app.services.result_values import json_result_value
from app.services.sqlite_trusted_executor import configured_sidecar_path

logger = structlog.get_logger()

MAX_DATABASE_PROFILE_SAMPLE_ROWS = 257
_REMOTE_SSL_MODES = {"disable", "prefer", "require", "verify-ca", "verify-full"}
_POSTGRESQL_SCHEMA_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")


def _normalize_connection_extra_options(
    driver: str,
    raw_options: Any,
) -> dict[str, str]:
    """Fail closed on unsafe persisted values while ignoring legacy keys."""

    if raw_options is None:
        raw_options = {}
    if hasattr(raw_options, "model_dump"):
        raw_options = raw_options.model_dump(exclude_none=True)
    if not isinstance(raw_options, dict):
        raise ValueError("数据库连接选项格式无效")

    sslmode = raw_options.get("sslmode", "prefer")
    if not isinstance(sslmode, str) or sslmode not in _REMOTE_SSL_MODES:
        raise ValueError("数据库 TLS 模式无效")

    normalized: dict[str, str] = {}
    if sslmode != "prefer":
        normalized["sslmode"] = sslmode

    for key in ("sslrootcert", "sslcert", "sslkey"):
        value = raw_options.get(key)
        if value in (None, ""):
            continue
        if not isinstance(value, str):
            raise ValueError("数据库证书选项必须是文件路径")
        value = value.strip()
        if (
            not value
            or len(value) > 4096
            or "\x00" in value
            or "\n" in value
            or "\r" in value
            or "-----BEGIN " in value.upper()
        ):
            raise ValueError("数据库证书路径无效")
        normalized[key] = value

    if bool(normalized.get("sslcert")) != bool(normalized.get("sslkey")):
        raise ValueError("客户端证书与私钥路径必须同时配置")
    if sslmode in {"verify-ca", "verify-full"} and not normalized.get("sslrootcert"):
        raise ValueError("验证服务器证书时必须配置 CA 证书")
    if sslmode == "disable" and any(
        normalized.get(key) for key in ("sslrootcert", "sslcert", "sslkey")
    ):
        raise ValueError("关闭 TLS 时不能配置证书")

    schema = raw_options.get("schema")
    if schema not in (None, ""):
        if not isinstance(schema, str):
            raise ValueError("PostgreSQL schema 必须是文本")
        schema = schema.strip()
        if driver != "postgresql" or not _POSTGRESQL_SCHEMA_PATTERN.fullmatch(schema):
            raise ValueError("PostgreSQL schema 名称无效")
        normalized["schema"] = schema

    if driver == "sqlite" and normalized:
        raise ValueError("SQLite 不支持远程连接选项")
    return normalized


@dataclass
class DatabaseConfig:
    """数据库连接配置"""

    driver: str
    host: str = "localhost"
    port: int | None = None
    user: str = ""
    password: str = ""
    database: str = ""
    extra_options: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.extra_options = _normalize_connection_extra_options(
            self.driver,
            self.extra_options,
        )

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DatabaseConfig:
        return cls(
            driver=data.get("driver", "mysql"),
            host=data.get("host", "localhost"),
            port=data.get("port"),
            user=data.get("user", data.get("username", "")),
            password=data.get("password", ""),
            database=data.get("database", data.get("database_name", "")),
            extra_options=data.get("extra_options") or {},
        )

    def get_port(self) -> int:
        if self.port:
            return self.port
        return {"mysql": 3306, "postgresql": 5432, "sqlite": 0}.get(self.driver, 3306)


@dataclass
class ConnectionTestResult:
    """连接测试结果"""

    connected: bool
    version: str | None = None
    tables_count: int | None = None
    message: str = ""


@dataclass
class QueryResult:
    """查询结果"""

    data: list[dict[str, Any]]
    rows_count: int
    truncated: bool = False
    execution_backend: str = "python"
    execution_metadata: dict[str, Any] | None = None

    def __post_init__(self) -> None:
        # One boundary for raw queries, structured queries, samples and replay.
        # Do not let FastAPI/pandas turn Decimal or BIGINT into rounded numbers.
        self.data = json_result_value(self.data)


class DatabaseManager:
    """数据库连接管理器"""

    SUPPORTED_DRIVERS = ("mysql", "postgresql", "sqlite")
    READ_ONLY_PREFIXES = ("SELECT", "SHOW", "DESCRIBE", "EXPLAIN", "WITH")

    def __init__(self, config: DatabaseConfig):
        self.config = config
        self._validate_driver()
        self._adapter = build_database_adapter(
            config.driver,
            trusted_sqlite_executor_path=(
                configured_sidecar_path() if config.driver == "sqlite" else None
            ),
        )

    def _validate_driver(self) -> None:
        if self.config.driver not in self.SUPPORTED_DRIVERS:
            raise ValueError(f"不支持的数据库类型: {self.config.driver}")

    @contextmanager
    def connect(self) -> Generator[Any, None, None]:
        conn = None
        body_failed = False
        try:
            conn = self._create_connection()
            yield conn
        except BaseException:
            body_failed = True
            raise
        finally:
            if conn and not getattr(
                conn,
                "_receiptbi_stream_connection_disposed",
                False,
            ):
                try:
                    conn.close()
                except Exception as exc:
                    # Cancellation may already have force-closed the DB-API
                    # connection or its socket. A second close must not replace
                    # the explicit DatabaseQueryCancelledError seen by callers.
                    logger.warning(
                        "Database connection close failed",
                        driver=self.config.driver,
                        error=str(exc),
                    )
                    if not body_failed:
                        raise

    def _create_connection(self) -> Any:
        return self._adapter.create_connection(self.config)

    def test_connection(self) -> ConnectionTestResult:
        try:
            with self.connect() as conn:
                self._adapter.enforce_read_only(conn, timeout_seconds=15.0)
                version, tables_count = self._get_db_info(conn)
                return ConnectionTestResult(
                    connected=True,
                    version=version,
                    tables_count=tables_count,
                    message="连接成功",
                )
        except Exception as exc:
            logger.error("Database connection test failed", error=str(exc))
            return ConnectionTestResult(connected=False, message=f"连接失败: {exc}")

    def _get_db_info(self, conn: Any) -> tuple[str, int]:
        return self._adapter.get_db_info(conn)

    def execute_query(
        self,
        sql: str,
        read_only: bool = True,
        max_rows: int | None = 10_000,
        *,
        cancellation_event: threading.Event | None = None,
        timeout_seconds: float | None = None,
    ) -> QueryResult:
        if cancellation_event is not None and cancellation_event.is_set():
            raise DatabaseQueryCancelledError("Database query was cancelled before execution")
        if read_only:
            self.validate_read_only(sql)

        with self.connect() as conn:
            fetch_limit = max_rows + 1 if max_rows is not None else None
            adapter_result = self._execute_sql(
                conn,
                sql,
                fetch_limit,
                cancellation_event=cancellation_event,
                timeout_seconds=timeout_seconds,
            )
            data = adapter_result.data
            materialized_overflow = max_rows is not None and len(data) > max_rows
            truncated = adapter_result.truncated or materialized_overflow
            if materialized_overflow:
                data = data[:max_rows]
            return QueryResult(
                data=data,
                rows_count=len(data),
                truncated=truncated,
                execution_backend=adapter_result.backend,
                execution_metadata=adapter_result.metadata or None,
            )

    def sample_table(
        self,
        table_name: str,
        columns: list[str] | None = None,
        *,
        max_rows: int = MAX_DATABASE_PROFILE_SAMPLE_ROWS,
        timeout_seconds: float = 5.0,
        cancellation_event: threading.Event | None = None,
    ) -> QueryResult:
        """Read a bounded table sample using catalog-verified, quoted identifiers.

        This is intentionally narrower than ``execute_query``. It never accepts SQL,
        verifies every identifier against the live catalog, and hard-caps the fetch at
        257 rows (256 profiling rows plus one row used to detect truncation).
        """

        if not 1 <= max_rows <= MAX_DATABASE_PROFILE_SAMPLE_ROWS:
            raise ValueError(f"数据库画像单表最多读取 {MAX_DATABASE_PROFILE_SAMPLE_ROWS} 行")
        if timeout_seconds <= 0:
            raise ValueError("数据库画像查询超时必须大于 0")
        if cancellation_event is not None and cancellation_event.is_set():
            raise DatabaseQueryCancelledError("Database query was cancelled before execution")

        with self.connect() as conn:
            self._adapter.enforce_read_only(
                conn,
                timeout_seconds=timeout_seconds,
            )
            selected_columns = (
                [str(item["name"]) for item in self._get_table_columns(conn, table_name)]
                if columns is None
                else list(columns)
            )
            if not selected_columns:
                raise ValueError("数据库画像至少需要一个字段")
            if len(selected_columns) != len(set(selected_columns)):
                raise ValueError("数据库画像字段不能重复")
            if not self._adapter.validate_relation_columns(
                conn,
                table_name,
                selected_columns,
            ):
                raise ValueError("数据库画像请求包含不在当前目录中的字段")
            if cancellation_event is not None and cancellation_event.is_set():
                raise DatabaseQueryCancelledError("Database query was cancelled before execution")

            quoted_columns = ", ".join(
                self._adapter.quote_identifier(column) for column in selected_columns
            )
            quoted_table = self._adapter.quote_identifier(table_name)
            sql = f"SELECT {quoted_columns} FROM {quoted_table} LIMIT {int(max_rows)}"
            adapter_result = self._execute_sql(
                conn,
                sql,
                max_rows=max_rows,
                cancellation_event=cancellation_event,
                timeout_seconds=timeout_seconds,
                read_only_prepared=True,
            )
            data = adapter_result.data[:max_rows]
            return QueryResult(
                data=data,
                rows_count=len(data),
                truncated=adapter_result.truncated or len(adapter_result.data) > max_rows,
                execution_backend=adapter_result.backend,
                execution_metadata=adapter_result.metadata or None,
            )

    def validate_read_only(self, sql: str) -> None:
        sql_clean = sql.strip()
        sql_without_trailing_semicolon = sql_clean.rstrip(";")
        sql_without_strings = re.sub(r"'[^']*'|\"[^\"]*\"", "", sql_without_trailing_semicolon)
        if ";" in sql_without_strings:
            raise ValueError("禁止执行多语句查询")

        if re.search(r"--|/\*|\*/", sql_without_strings):
            raise ValueError("禁止在查询中使用 SQL 注释")

        dangerous_keywords = [
            "DROP",
            "DELETE",
            "INSERT",
            "UPDATE",
            "CREATE",
            "ALTER",
            "TRUNCATE",
            "REPLACE",
            "MERGE",
            "GRANT",
            "REVOKE",
            "COMMIT",
            "ROLLBACK",
            "EXEC",
            "EXECUTE",
            "ATTACH",
            "COPY",
            "INSTALL",
            "LOAD",
            "PRAGMA",
            "INTO",
            "OUTFILE",
            "DUMPFILE",
        ]

        words = re.findall(r"\b[A-Z_]+\b", sql_without_strings.upper())
        for word in words:
            if word in dangerous_keywords:
                raise ValueError(f"检测到危险关键字: {word}")

        first_word = words[0] if words else ""
        if first_word not in self.READ_ONLY_PREFIXES:
            raise ValueError("只允许执行只读查询 (SELECT, SHOW, DESCRIBE, EXPLAIN, WITH)")
        if re.search(
            r"\b(pg_read_file|pg_read_binary_file|pg_ls_dir|lo_import|load_file|dblink)\s*\(",
            sql_without_strings,
            re.I,
        ):
            raise ValueError("禁止读取服务器文件或建立外部连接")

    def _execute_sql(
        self,
        conn: Any,
        sql: str,
        max_rows: int | None = None,
        *,
        cancellation_event: threading.Event | None = None,
        timeout_seconds: float | None = None,
        read_only_prepared: bool = False,
    ) -> AdapterQueryResult:
        return self._adapter.execute_sql(
            conn,
            sql,
            max_rows=max_rows,
            cancellation_event=cancellation_event,
            timeout_seconds=timeout_seconds,
            connection_config=self.config,
            read_only_prepared=read_only_prepared,
        )

    def get_schema_info(self) -> str:
        try:
            catalog = self.get_schema_catalog()
            schema_parts = []
            for table in catalog:
                col_info = ", ".join(
                    f"{column['name']} ({column['type']})" for column in table["columns"]
                )
                schema_parts.append(f"- {table['name']}: {col_info}")
            return "\n".join(schema_parts) if schema_parts else "无表结构信息"
        except Exception as exc:
            logger.error("Failed to get schema info", error=str(exc))
            return f"无法获取表结构: {exc}"

    def get_schema_catalog(self) -> list[dict[str, Any]]:
        """Return structured table metadata for project preflight and semantics."""

        with self.connect() as conn:
            self._adapter.enforce_read_only(conn, timeout_seconds=10.0)
            return self._adapter.get_schema_catalog(conn)

    def get_bounded_schema_catalog(
        self,
        *,
        max_relations: int,
        max_columns_per_relation: int,
        max_total_columns: int,
    ) -> BoundedSchemaCatalog:
        """Return a server-bounded catalog slice for automatic preflight."""

        if min(max_relations, max_columns_per_relation, max_total_columns) <= 0:
            raise ValueError("数据库目录预算必须大于 0")
        with self.connect() as conn:
            self._adapter.enforce_read_only(conn, timeout_seconds=10.0)
            return self._adapter.get_bounded_schema_catalog(
                conn,
                max_relations=max_relations,
                max_columns_per_relation=max_columns_per_relation,
                max_total_columns=max_total_columns,
            )

    def get_bounded_relation_index(
        self,
        *,
        max_relations: int,
        after: str | None = None,
    ) -> BoundedRelationIndex:
        """Return a metadata-only relation directory without reading business rows."""

        if max_relations <= 0:
            raise ValueError("数据库目录预算必须大于 0")
        with self.connect() as conn:
            self._adapter.enforce_read_only(conn, timeout_seconds=10.0)
            if after is not None:
                return self._adapter.get_bounded_relation_index(
                    conn,
                    max_relations=max_relations,
                    after=after,
                )
            return self._adapter.get_bounded_relation_index(
                conn,
                max_relations=max_relations,
            )

    def get_bounded_relation_schema(
        self,
        table_name: str,
        *,
        max_columns: int,
    ) -> dict[str, Any]:
        """Read one explicitly selected relation's bounded column directory.

        Unlike :meth:`get_bounded_schema_catalog`, this method never advances from
        the first alphabetical relation.  It is the narrow primitive used by the
        resumable semantic inventory worker after the user has selected a table
        from the relation index.  Only metadata is read here; business rows are
        sampled separately and only for the explicit ``sampled`` job depth.
        """

        normalized_table = table_name.strip()
        if not normalized_table:
            raise ValueError("数据库目录必须指定表")
        if not 1 <= max_columns <= 240:
            raise ValueError("单表字段目录预算必须在 1 到 240 之间")

        with self.connect() as conn:
            self._adapter.enforce_read_only(conn, timeout_seconds=10.0)
            entry = self._adapter.get_bounded_relation_schema(
                conn,
                table_name=normalized_table,
                max_columns=max_columns,
            )
        if not entry.get("columns"):
            raise ValueError("所选表不存在或没有可读取字段")
        return dict(entry)

    def _get_tables(self, conn: Any) -> list[str]:
        return self._adapter.get_tables(conn)

    @staticmethod
    def _is_valid_sqlite_identifier(identifier: str) -> bool:
        return is_valid_sqlite_identifier(identifier)

    def _get_table_columns(self, conn: Any, table_name: str) -> list[dict[str, Any]]:
        return self._adapter.get_table_columns(conn, table_name)


def create_database_manager(config: dict[str, Any] | DatabaseConfig) -> DatabaseManager:
    """工厂函数：创建数据库管理器"""
    if isinstance(config, dict):
        config = DatabaseConfig.from_dict(config)
    return DatabaseManager(config)
