"""Database driver adapters used by DatabaseManager."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any, Protocol

if TYPE_CHECKING:
    from app.services.database import DatabaseConfig


class DatabaseAdapter(Protocol):
    """Interface implemented by each database driver adapter."""

    def create_connection(self, config: DatabaseConfig) -> Any: ...

    def get_db_info(self, conn: Any) -> tuple[str, int]: ...

    def execute_sql(self, conn: Any, sql: str) -> list[dict[str, Any]]: ...

    def get_tables(self, conn: Any) -> list[str]: ...

    def get_table_columns(self, conn: Any, table_name: str) -> list[dict[str, str]]: ...


class MySQLAdapter:
    def create_connection(self, config: DatabaseConfig) -> Any:
        import pymysql

        return pymysql.connect(
            host=config.host,
            port=config.get_port(),
            user=config.user,
            password=config.password,
            database=config.database,
            cursorclass=pymysql.cursors.DictCursor,
        )

    def get_db_info(self, conn: Any) -> tuple[str, int]:
        with conn.cursor() as cursor:
            cursor.execute("SELECT VERSION()")
            version = f"MySQL {cursor.fetchone()['VERSION()']}"
            cursor.execute("SHOW TABLES")
            tables_count = len(cursor.fetchall())
        return version, tables_count

    def execute_sql(self, conn: Any, sql: str) -> list[dict[str, Any]]:
        with conn.cursor() as cursor:
            cursor.execute(sql)
            return list(cursor.fetchall())

    def get_tables(self, conn: Any) -> list[str]:
        with conn.cursor() as cursor:
            cursor.execute("SHOW TABLES")
            return [list(row.values())[0] for row in cursor.fetchall()]

    def get_table_columns(self, conn: Any, table_name: str) -> list[dict[str, str]]:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.columns "
                "WHERE table_schema = DATABASE() AND table_name = %s",
                (table_name,),
            )
            return [
                {"name": row["COLUMN_NAME"], "type": row["DATA_TYPE"]} for row in cursor.fetchall()
            ]


class PostgreSQLAdapter:
    def create_connection(self, config: DatabaseConfig) -> Any:
        import psycopg2

        return psycopg2.connect(
            host=config.host,
            port=config.get_port(),
            user=config.user,
            password=config.password,
            database=config.database,
        )

    def get_db_info(self, conn: Any) -> tuple[str, int]:
        with conn.cursor() as cursor:
            cursor.execute("SELECT version()")
            version = cursor.fetchone()[0].split(",")[0]
            cursor.execute(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'"
            )
            tables_count = cursor.fetchone()[0]
        return version, tables_count

    def execute_sql(self, conn: Any, sql: str) -> list[dict[str, Any]]:
        import psycopg2.extras

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cursor:
            cursor.execute(sql)
            return [dict(row) for row in cursor.fetchall()]

    def get_tables(self, conn: Any) -> list[str]:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public'
                """
            )
            return [row[0] for row in cursor.fetchall()]

    def get_table_columns(self, conn: Any, table_name: str) -> list[dict[str, str]]:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_name = %s
                """,
                (table_name,),
            )
            return [{"name": row[0], "type": row[1]} for row in cursor.fetchall()]


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
    def create_connection(self, config: DatabaseConfig) -> Any:
        import sqlite3

        conn = sqlite3.connect(config.database)
        conn.row_factory = sqlite3.Row
        return conn

    def get_db_info(self, conn: Any) -> tuple[str, int]:
        cursor = conn.cursor()
        cursor.execute("SELECT sqlite_version()")
        version = f"SQLite {cursor.fetchone()[0]}"
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
        tables_count = cursor.fetchone()[0]
        return version, tables_count

    def execute_sql(self, conn: Any, sql: str) -> list[dict[str, Any]]:
        cursor = conn.cursor()
        cursor.execute(sql)
        return [dict(row) for row in cursor.fetchall()]

    def get_tables(self, conn: Any) -> list[str]:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
        return [row[0] for row in cursor.fetchall()]

    def get_table_columns(self, conn: Any, table_name: str) -> list[dict[str, str]]:
        if not is_valid_sqlite_identifier(table_name):
            raise ValueError(f"Invalid table name: {table_name}")

        cursor = conn.cursor()
        cursor.execute(f"PRAGMA table_info({table_name})")
        return [{"name": row[1], "type": row[2]} for row in cursor.fetchall()]


def build_database_adapter(driver: str) -> DatabaseAdapter:
    if driver == "mysql":
        return MySQLAdapter()
    if driver == "postgresql":
        return PostgreSQLAdapter()
    if driver == "sqlite":
        return SQLiteAdapter()
    raise ValueError(f"不支持的数据库类型: {driver}")
