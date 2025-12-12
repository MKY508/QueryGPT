"""
数据库连接管理器
统一管理 MySQL、PostgreSQL、SQLite 的连接和查询
"""

from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

import structlog

logger = structlog.get_logger()


@dataclass
class DatabaseConfig:
    """数据库连接配置"""

    driver: str  # mysql, postgresql, sqlite
    host: str = "localhost"
    port: int | None = None
    user: str = ""
    password: str = ""
    database: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DatabaseConfig":
        """从字典创建配置"""
        return cls(
            driver=data.get("driver", "mysql"),
            host=data.get("host", "localhost"),
            port=data.get("port"),
            user=data.get("user", data.get("username", "")),
            password=data.get("password", ""),
            database=data.get("database", data.get("database_name", "")),
        )

    def get_port(self) -> int:
        """获取端口，使用默认值"""
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
    READ_ONLY_PREFIXES = ("SELECT", "SHOW", "DESCRIBE", "EXPLAIN")

    def __init__(self, config: DatabaseConfig):
        self.config = config
        self._validate_driver()

    def _validate_driver(self) -> None:
        """验证数据库驱动类型"""
        if self.config.driver not in self.SUPPORTED_DRIVERS:
            raise ValueError(f"不支持的数据库类型: {self.config.driver}")

    @contextmanager
    def connect(self) -> Generator[Any, None, None]:
        """获取数据库连接（上下文管理器）"""
        conn = None
        try:
            conn = self._create_connection()
            yield conn
        finally:
            if conn:
                conn.close()

    def _create_connection(self) -> Any:
        """创建数据库连接"""
        if self.config.driver == "mysql":
            import pymysql

            return pymysql.connect(
                host=self.config.host,
                port=self.config.get_port(),
                user=self.config.user,
                password=self.config.password,
                database=self.config.database,
                cursorclass=pymysql.cursors.DictCursor,
            )

        elif self.config.driver == "postgresql":
            import psycopg2

            return psycopg2.connect(
                host=self.config.host,
                port=self.config.get_port(),
                user=self.config.user,
                password=self.config.password,
                database=self.config.database,
            )

        elif self.config.driver == "sqlite":
            import sqlite3

            conn = sqlite3.connect(self.config.database)
            conn.row_factory = sqlite3.Row
            return conn

        raise ValueError(f"不支持的数据库类型: {self.config.driver}")

    def test_connection(self) -> ConnectionTestResult:
        """测试数据库连接"""
        try:
            with self.connect() as conn:
                version, tables_count = self._get_db_info(conn)
                return ConnectionTestResult(
                    connected=True,
                    version=version,
                    tables_count=tables_count,
                    message="连接成功",
                )
        except Exception as e:
            logger.error("Database connection test failed", error=str(e))
            return ConnectionTestResult(
                connected=False,
                message=f"连接失败: {str(e)}",
            )

    def _get_db_info(self, conn: Any) -> tuple[str, int]:
        """获取数据库版本和表数量"""
        if self.config.driver == "mysql":
            with conn.cursor() as cursor:
                cursor.execute("SELECT VERSION()")
                version = f"MySQL {cursor.fetchone()['VERSION()']}"
                cursor.execute("SHOW TABLES")
                tables_count = len(cursor.fetchall())
            return version, tables_count

        elif self.config.driver == "postgresql":
            with conn.cursor() as cursor:
                cursor.execute("SELECT version()")
                version = cursor.fetchone()[0].split(",")[0]
                cursor.execute(
                    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'"
                )
                tables_count = cursor.fetchone()[0]
            return version, tables_count

        elif self.config.driver == "sqlite":
            cursor = conn.cursor()
            cursor.execute("SELECT sqlite_version()")
            version = f"SQLite {cursor.fetchone()[0]}"
            cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
            tables_count = cursor.fetchone()[0]
            return version, tables_count

        return "Unknown", 0

    def execute_query(self, sql: str, read_only: bool = True) -> QueryResult:
        """执行 SQL 查询"""
        if read_only:
            self._validate_read_only(sql)

        with self.connect() as conn:
            data = self._execute_sql(conn, sql)
            return QueryResult(data=data, rows_count=len(data))

    def _validate_read_only(self, sql: str) -> None:
        """验证是否为只读查询"""
        sql_upper = sql.strip().upper()
        if not sql_upper.startswith(self.READ_ONLY_PREFIXES):
            raise ValueError("只允许执行只读查询 (SELECT, SHOW, DESCRIBE, EXPLAIN)")

    def _execute_sql(self, conn: Any, sql: str) -> list[dict[str, Any]]:
        """执行 SQL 并返回结果"""
        if self.config.driver == "mysql":
            with conn.cursor() as cursor:
                cursor.execute(sql)
                return list(cursor.fetchall())

        elif self.config.driver == "postgresql":
            import psycopg2.extras

            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cursor:
                cursor.execute(sql)
                return [dict(row) for row in cursor.fetchall()]

        elif self.config.driver == "sqlite":
            cursor = conn.cursor()
            cursor.execute(sql)
            return [dict(row) for row in cursor.fetchall()]

        return []

    def get_schema_info(self) -> str:
        """获取数据库表结构信息"""
        try:
            with self.connect() as conn:
                tables = self._get_tables(conn)
                schema_parts = []

                for table_name in tables:
                    columns = self._get_table_columns(conn, table_name)
                    col_info = ", ".join([f"{col['name']} ({col['type']})" for col in columns])
                    schema_parts.append(f"- {table_name}: {col_info}")

                return "\n".join(schema_parts) if schema_parts else "无表结构信息"

        except Exception as e:
            logger.error("Failed to get schema info", error=str(e))
            return f"无法获取表结构: {str(e)}"

    def _get_tables(self, conn: Any) -> list[str]:
        """获取所有表名"""
        if self.config.driver == "mysql":
            with conn.cursor() as cursor:
                cursor.execute("SHOW TABLES")
                # DictCursor 返回的是字典，需要取第一个值
                return [list(row.values())[0] for row in cursor.fetchall()]

        elif self.config.driver == "postgresql":
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT table_name FROM information_schema.tables
                    WHERE table_schema = 'public'
                """)
                return [row[0] for row in cursor.fetchall()]

        elif self.config.driver == "sqlite":
            cursor = conn.cursor()
            cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
            return [row[0] for row in cursor.fetchall()]

        return []

    def _get_table_columns(self, conn: Any, table_name: str) -> list[dict[str, str]]:
        """获取表的列信息"""
        if self.config.driver == "mysql":
            with conn.cursor() as cursor:
                # 使用参数化查询防止 SQL 注入
                cursor.execute(
                    "SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.columns "
                    "WHERE table_schema = DATABASE() AND table_name = %s",
                    (table_name,),
                )
                return [
                    {"name": row["COLUMN_NAME"], "type": row["DATA_TYPE"]}
                    for row in cursor.fetchall()
                ]

        elif self.config.driver == "postgresql":
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

        elif self.config.driver == "sqlite":
            cursor = conn.cursor()
            # SQLite 的 PRAGMA 不支持参数化，但 table_name 来自我们自己的查询结果
            # 这里做一个简单的验证
            if not table_name.replace("_", "").isalnum():
                raise ValueError(f"Invalid table name: {table_name}")
            cursor.execute(f"PRAGMA table_info({table_name})")
            return [{"name": row[1], "type": row[2]} for row in cursor.fetchall()]

        return []


def create_database_manager(config: dict[str, Any] | DatabaseConfig) -> DatabaseManager:
    """工厂函数：创建数据库管理器"""
    if isinstance(config, dict):
        config = DatabaseConfig.from_dict(config)
    return DatabaseManager(config)
