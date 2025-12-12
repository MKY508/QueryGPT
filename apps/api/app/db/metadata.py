"""独立的 SQLite 元数据库 - 存储布局、配置等元数据

类似 Metabase 的做法，将元数据与用户业务数据库分离。
"""

import json
import logging
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

logger = logging.getLogger(__name__)

# 允许更新的字段白名单（防止 SQL 注入）
ALLOWED_UPDATE_FIELDS = {
    "name",
    "layout_data",
    "visible_tables",
    "is_default",
    "zoom",
    "viewport_x",
    "viewport_y",
}

# 元数据库文件路径（支持环境变量覆盖）
METADATA_DB_PATH = Path(
    os.getenv(
        "METADATA_DB_PATH", str(Path(__file__).parent.parent.parent.parent / "data" / "metadata.db")
    )
)


def _ensure_db_dir():
    """确保数据目录存在"""
    METADATA_DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def _dict_factory(cursor: sqlite3.Cursor, row: tuple) -> dict:
    """将 SQLite 行转换为字典"""
    return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}


@contextmanager
def get_metadata_db():
    """获取元数据库连接"""
    _ensure_db_dir()
    conn = sqlite3.connect(str(METADATA_DB_PATH))
    conn.row_factory = _dict_factory
    try:
        yield conn
        conn.commit()
    except Exception as e:
        conn.rollback()
        logger.error(f"Database error: {e}")
        raise
    finally:
        conn.close()


def init_metadata_db():
    """初始化元数据库表结构"""
    with get_metadata_db() as conn:
        cursor = conn.cursor()

        # 创建布局表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS schema_layouts (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                connection_id TEXT NOT NULL,
                name TEXT NOT NULL,
                is_default INTEGER DEFAULT 0,
                layout_data TEXT DEFAULT '{}',
                visible_tables TEXT,
                zoom REAL DEFAULT 1.0,
                viewport_x REAL DEFAULT 0.0,
                viewport_y REAL DEFAULT 0.0,
                created_at TEXT,
                updated_at TEXT,
                UNIQUE(user_id, connection_id, name)
            )
        """)

        # 创建索引
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_layouts_user_connection
            ON schema_layouts(user_id, connection_id)
        """)

        # 为默认布局查询创建索引
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_layouts_default
            ON schema_layouts(user_id, connection_id, is_default)
        """)

        # 为单个布局查询创建索引
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_layouts_id_user
            ON schema_layouts(id, user_id)
        """)

        conn.commit()


# ===== 布局 CRUD 操作 =====


class LayoutRepository:
    """布局数据仓库"""

    @staticmethod
    def list_layouts(user_id: UUID, connection_id: UUID) -> list[dict]:
        """获取用户的所有布局"""
        with get_metadata_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, name, is_default
                FROM schema_layouts
                WHERE user_id = ? AND connection_id = ?
                ORDER BY is_default DESC, name ASC
                """,
                (str(user_id), str(connection_id)),
            )
            return cursor.fetchall()

    @staticmethod
    def _parse_json_fields(row: dict) -> dict:
        """安全解析 JSON 字段"""
        if not row:
            return row
        try:
            row["layout_data"] = json.loads(row["layout_data"] or "{}")
        except (json.JSONDecodeError, TypeError) as e:
            logger.warning(f"Failed to parse layout_data: {e}")
            row["layout_data"] = {}
        try:
            row["visible_tables"] = (
                json.loads(row["visible_tables"]) if row["visible_tables"] else None
            )
        except (json.JSONDecodeError, TypeError) as e:
            logger.warning(f"Failed to parse visible_tables: {e}")
            row["visible_tables"] = None
        row["is_default"] = bool(row.get("is_default", 0))
        return row

    @staticmethod
    def get_layout(layout_id: UUID, user_id: UUID) -> dict | None:
        """获取单个布局"""
        with get_metadata_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM schema_layouts
                WHERE id = ? AND user_id = ?
                """,
                (str(layout_id), str(user_id)),
            )
            row = cursor.fetchone()
            return LayoutRepository._parse_json_fields(row) if row else None

    @staticmethod
    def get_default_layout(user_id: UUID, connection_id: UUID) -> dict | None:
        """获取默认布局"""
        with get_metadata_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM schema_layouts
                WHERE user_id = ? AND connection_id = ? AND is_default = 1
                """,
                (str(user_id), str(connection_id)),
            )
            row = cursor.fetchone()
            return LayoutRepository._parse_json_fields(row) if row else None

    @staticmethod
    def create_layout(
        user_id: UUID,
        connection_id: UUID,
        name: str,
        is_default: bool = False,
        layout_data: dict[str, Any] | None = None,
        visible_tables: list[str] | None = None,
    ) -> dict:
        """创建布局"""
        layout_id = str(uuid4())
        now = datetime.utcnow().isoformat()

        with get_metadata_db() as conn:
            cursor = conn.cursor()

            # 如果设为默认，取消其他默认
            if is_default:
                cursor.execute(
                    """
                    UPDATE schema_layouts SET is_default = 0
                    WHERE user_id = ? AND connection_id = ?
                    """,
                    (str(user_id), str(connection_id)),
                )

            cursor.execute(
                """
                INSERT INTO schema_layouts
                (id, user_id, connection_id, name, is_default, layout_data, visible_tables, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    layout_id,
                    str(user_id),
                    str(connection_id),
                    name,
                    1 if is_default else 0,
                    json.dumps(layout_data or {}),
                    json.dumps(visible_tables) if visible_tables else None,
                    now,
                    now,
                ),
            )

        return LayoutRepository.get_layout(UUID(layout_id), user_id)

    @staticmethod
    def update_layout(
        layout_id: UUID,
        user_id: UUID,
        connection_id: UUID | None = None,
        **kwargs,
    ) -> dict | None:
        """更新布局（使用白名单防止 SQL 注入）"""
        # 构建更新字段（只允许白名单中的字段）
        updates = []
        values = []

        for key, value in kwargs.items():
            # 安全检查：只允许白名单中的字段
            if key not in ALLOWED_UPDATE_FIELDS:
                logger.warning(f"Attempted to update disallowed field: {key}")
                continue
            if value is not None:
                if key == "layout_data":
                    updates.append("layout_data = ?")
                    values.append(json.dumps(value))
                elif key == "visible_tables":
                    updates.append("visible_tables = ?")
                    values.append(json.dumps(value) if value else None)
                elif key == "is_default":
                    updates.append("is_default = ?")
                    values.append(1 if value else 0)
                elif key in ("name", "zoom", "viewport_x", "viewport_y"):
                    # 这些字段直接使用参数化查询
                    updates.append(f"{key} = ?")
                    values.append(value)

        if not updates:
            return LayoutRepository.get_layout(layout_id, user_id)

        updates.append("updated_at = ?")
        values.append(datetime.utcnow().isoformat())
        values.extend([str(layout_id), str(user_id)])

        with get_metadata_db() as conn:
            cursor = conn.cursor()

            # 如果设为默认，取消其他默认
            if kwargs.get("is_default") and connection_id:
                cursor.execute(
                    """
                    UPDATE schema_layouts SET is_default = 0
                    WHERE user_id = ? AND connection_id = ? AND id != ?
                    """,
                    (str(user_id), str(connection_id), str(layout_id)),
                )

            cursor.execute(
                f"""
                UPDATE schema_layouts
                SET {", ".join(updates)}
                WHERE id = ? AND user_id = ?
                """,
                values,
            )

        return LayoutRepository.get_layout(layout_id, user_id)

    @staticmethod
    def delete_layout(layout_id: UUID, user_id: UUID) -> bool:
        """删除布局"""
        with get_metadata_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                DELETE FROM schema_layouts
                WHERE id = ? AND user_id = ?
                """,
                (str(layout_id), str(user_id)),
            )
            return cursor.rowcount > 0

    @staticmethod
    def duplicate_layout(layout_id: UUID, user_id: UUID) -> dict | None:
        """复制布局"""
        source = LayoutRepository.get_layout(layout_id, user_id)
        if not source:
            return None

        # 生成新名称
        base_name = f"{source['name']} (副本)"
        new_name = base_name
        counter = 1

        with get_metadata_db() as conn:
            cursor = conn.cursor()
            while True:
                cursor.execute(
                    """
                    SELECT 1 FROM schema_layouts
                    WHERE user_id = ? AND connection_id = ? AND name = ?
                    """,
                    (str(user_id), source["connection_id"], new_name),
                )
                if not cursor.fetchone():
                    break
                counter += 1
                new_name = f"{base_name} {counter}"

        return LayoutRepository.create_layout(
            user_id=user_id,
            connection_id=UUID(source["connection_id"]),
            name=new_name,
            is_default=False,
            layout_data=source["layout_data"],
            visible_tables=source["visible_tables"],
        )

    @staticmethod
    def list_layouts_full(user_id: UUID, connection_id: UUID) -> list[dict]:
        """获取用户的所有布局（完整数据，用于导出）"""
        with get_metadata_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM schema_layouts
                WHERE user_id = ? AND connection_id = ?
                ORDER BY is_default DESC, name ASC
                """,
                (str(user_id), str(connection_id)),
            )
            rows = cursor.fetchall()
            return [LayoutRepository._parse_json_fields(dict(row)) for row in rows]

    @staticmethod
    def get_layout_by_name(user_id: UUID, connection_id: UUID, name: str) -> dict | None:
        """根据名称获取布局"""
        with get_metadata_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM schema_layouts
                WHERE user_id = ? AND connection_id = ? AND name = ?
                """,
                (str(user_id), str(connection_id), name),
            )
            row = cursor.fetchone()
            return LayoutRepository._parse_json_fields(dict(row)) if row else None

    @staticmethod
    def delete_all_layouts(user_id: UUID, connection_id: UUID) -> int:
        """删除指定连接的所有布局（用于导入时的 replace 模式）"""
        with get_metadata_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                DELETE FROM schema_layouts
                WHERE user_id = ? AND connection_id = ?
                """,
                (str(user_id), str(connection_id)),
            )
            return cursor.rowcount

    @staticmethod
    def layout_name_exists(
        user_id: UUID, connection_id: UUID, name: str, exclude_id: UUID | None = None
    ) -> bool:
        """检查布局名称是否已存在"""
        with get_metadata_db() as conn:
            cursor = conn.cursor()
            if exclude_id:
                cursor.execute(
                    """
                    SELECT 1 FROM schema_layouts
                    WHERE user_id = ? AND connection_id = ? AND name = ? AND id != ?
                    """,
                    (str(user_id), str(connection_id), name, str(exclude_id)),
                )
            else:
                cursor.execute(
                    """
                    SELECT 1 FROM schema_layouts
                    WHERE user_id = ? AND connection_id = ? AND name = ?
                    """,
                    (str(user_id), str(connection_id), name),
                )
            return cursor.fetchone() is not None


# 应用启动时初始化元数据库
init_metadata_db()
