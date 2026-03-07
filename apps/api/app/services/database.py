"""
数据库连接管理器
统一管理 MySQL、PostgreSQL、SQLite 的连接和查询
"""

from __future__ import annotations

import re
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

import structlog

from app.services.database_adapters import build_database_adapter, is_valid_sqlite_identifier

logger = structlog.get_logger()


@dataclass
class DatabaseConfig:
    """数据库连接配置"""

    driver: str
    host: str = "localhost"
    port: int | None = None
    user: str = ""
    password: str = ""
    database: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DatabaseConfig:
        return cls(
            driver=data.get("driver", "mysql"),
            host=data.get("host", "localhost"),
            port=data.get("port"),
            user=data.get("user", data.get("username", "")),
            password=data.get("password", ""),
            database=data.get("database", data.get("database_name", "")),
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


class DatabaseManager:
    """数据库连接管理器"""

    SUPPORTED_DRIVERS = ("mysql", "postgresql", "sqlite")
    READ_ONLY_PREFIXES = ("SELECT", "SHOW", "DESCRIBE", "EXPLAIN", "WITH")

    def __init__(self, config: DatabaseConfig):
        self.config = config
        self._validate_driver()
        self._adapter = build_database_adapter(config.driver)

    def _validate_driver(self) -> None:
        if self.config.driver not in self.SUPPORTED_DRIVERS:
            raise ValueError(f"不支持的数据库类型: {self.config.driver}")

    @contextmanager
    def connect(self) -> Generator[Any, None, None]:
        conn = None
        try:
            conn = self._create_connection()
            yield conn
        finally:
            if conn:
                conn.close()

    def _create_connection(self) -> Any:
        return self._adapter.create_connection(self.config)

    def test_connection(self) -> ConnectionTestResult:
        try:
            with self.connect() as conn:
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

    def execute_query(self, sql: str, read_only: bool = True) -> QueryResult:
        if read_only:
            self._validate_read_only(sql)

        with self.connect() as conn:
            data = self._execute_sql(conn, sql)
            return QueryResult(data=data, rows_count=len(data))

    def _validate_read_only(self, sql: str) -> None:
        sql_clean = sql.strip()
        sql_without_trailing_semicolon = sql_clean.rstrip(";")
        if ";" in sql_without_trailing_semicolon:
            raise ValueError("禁止执行多语句查询")

        if re.search(r"--|/\*|\*/", sql_clean):
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
        ]

        sql_without_strings = re.sub(r"'[^']*'|\"[^\"]*\"", "", sql_clean)
        words = re.findall(r"\b[A-Z_]+\b", sql_without_strings.upper())
        for word in words:
            if word in dangerous_keywords:
                raise ValueError(f"检测到危险关键字: {word}")

        first_word = words[0] if words else ""
        if first_word not in self.READ_ONLY_PREFIXES:
            raise ValueError("只允许执行只读查询 (SELECT, SHOW, DESCRIBE, EXPLAIN, WITH)")

    def _execute_sql(self, conn: Any, sql: str) -> list[dict[str, Any]]:
        return self._adapter.execute_sql(conn, sql)

    def get_schema_info(self) -> str:
        try:
            with self.connect() as conn:
                schema_parts = []
                for table_name in self._get_tables(conn):
                    columns = self._get_table_columns(conn, table_name)
                    col_info = ", ".join(f"{col['name']} ({col['type']})" for col in columns)
                    schema_parts.append(f"- {table_name}: {col_info}")
                return "\n".join(schema_parts) if schema_parts else "无表结构信息"
        except Exception as exc:
            logger.error("Failed to get schema info", error=str(exc))
            return f"无法获取表结构: {exc}"

    def _get_tables(self, conn: Any) -> list[str]:
        return self._adapter.get_tables(conn)

    @staticmethod
    def _is_valid_sqlite_identifier(identifier: str) -> bool:
        return is_valid_sqlite_identifier(identifier)

    def _get_table_columns(self, conn: Any, table_name: str) -> list[dict[str, str]]:
        return self._adapter.get_table_columns(conn, table_name)


def create_database_manager(config: dict[str, Any] | DatabaseConfig) -> DatabaseManager:
    """工厂函数：创建数据库管理器"""
    if isinstance(config, dict):
        config = DatabaseConfig.from_dict(config)
    return DatabaseManager(config)
