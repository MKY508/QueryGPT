"""独立的 SQLite 元数据库 - 存储单工作区布局等元数据"""

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

ALLOWED_UPDATE_FIELDS = {
    "name",
    "layout_data",
    "visible_tables",
    "is_default",
    "zoom",
    "viewport_x",
    "viewport_y",
}

METADATA_DB_PATH = Path(
    os.getenv(
        "METADATA_DB_PATH", str(Path(__file__).parent.parent.parent.parent / "data" / "metadata.db")
    )
)


def _ensure_db_dir() -> None:
    METADATA_DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def _dict_factory(cursor: sqlite3.Cursor, row: tuple) -> dict:
    return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}


@contextmanager
def get_metadata_db():
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


def init_metadata_db() -> None:
    with get_metadata_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_layouts (
                id TEXT PRIMARY KEY,
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
                UNIQUE(connection_id, name)
            )
            """
        )
        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_layouts_connection
            ON schema_layouts(connection_id)
            """
        )
        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_layouts_default
            ON schema_layouts(connection_id, is_default)
            """
        )
        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_layouts_id
            ON schema_layouts(id)
            """
        )


class LayoutRepository:
    """布局数据仓库"""

    @staticmethod
    def _parse_json_fields(row: dict | None) -> dict | None:
        if not row:
            return row
        try:
            row["layout_data"] = json.loads(row["layout_data"] or "{}")
        except (json.JSONDecodeError, TypeError):
            row["layout_data"] = {}
        try:
            row["visible_tables"] = (
                json.loads(row["visible_tables"]) if row["visible_tables"] else None
            )
        except (json.JSONDecodeError, TypeError):
            row["visible_tables"] = None
        row["is_default"] = bool(row.get("is_default", 0))
        return row

    @staticmethod
    def list_layouts(connection_id: UUID) -> list[dict]:
        with get_metadata_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, name, is_default
                FROM schema_layouts
                WHERE connection_id = ?
                ORDER BY is_default DESC, name ASC
                """,
                (str(connection_id),),
            )
            return cursor.fetchall()

    @staticmethod
    def get_layout(layout_id: UUID) -> dict | None:
        with get_metadata_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM schema_layouts
                WHERE id = ?
                """,
                (str(layout_id),),
            )
            row = cursor.fetchone()
            return LayoutRepository._parse_json_fields(row) if row else None

    @staticmethod
    def create_layout(
        connection_id: UUID,
        name: str,
        is_default: bool = False,
        layout_data: dict[str, Any] | None = None,
        visible_tables: list[str] | None = None,
    ) -> dict:
        layout_id = str(uuid4())
        now = datetime.utcnow().isoformat()

        with get_metadata_db() as conn:
            cursor = conn.cursor()
            if is_default:
                cursor.execute(
                    """
                    UPDATE schema_layouts SET is_default = 0
                    WHERE connection_id = ?
                    """,
                    (str(connection_id),),
                )
            cursor.execute(
                """
                INSERT INTO schema_layouts
                (id, connection_id, name, is_default, layout_data, visible_tables, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    layout_id,
                    str(connection_id),
                    name,
                    1 if is_default else 0,
                    json.dumps(layout_data or {}),
                    json.dumps(visible_tables) if visible_tables else None,
                    now,
                    now,
                ),
            )
        created = LayoutRepository.get_layout(UUID(layout_id))
        assert created is not None
        return created

    @staticmethod
    def update_layout(
        layout_id: UUID,
        connection_id: UUID | None = None,
        **kwargs,
    ) -> dict | None:
        updates: list[str] = []
        values: list[Any] = []
        for key, value in kwargs.items():
            if key not in ALLOWED_UPDATE_FIELDS or value is None:
                continue
            if key == "layout_data":
                updates.append("layout_data = ?")
                values.append(json.dumps(value))
            elif key == "visible_tables":
                updates.append("visible_tables = ?")
                values.append(json.dumps(value) if value else None)
            elif key == "is_default":
                updates.append("is_default = ?")
                values.append(1 if value else 0)
            else:
                updates.append(f"{key} = ?")
                values.append(value)

        if not updates:
            return LayoutRepository.get_layout(layout_id)

        updates.append("updated_at = ?")
        values.append(datetime.utcnow().isoformat())
        values.append(str(layout_id))

        with get_metadata_db() as conn:
            cursor = conn.cursor()
            if kwargs.get("is_default") and connection_id:
                cursor.execute(
                    """
                    UPDATE schema_layouts SET is_default = 0
                    WHERE connection_id = ? AND id != ?
                    """,
                    (str(connection_id), str(layout_id)),
                )
            cursor.execute(
                f"""
                UPDATE schema_layouts
                SET {", ".join(updates)}
                WHERE id = ?
                """,
                values,
            )
        return LayoutRepository.get_layout(layout_id)

    @staticmethod
    def delete_layout(layout_id: UUID) -> bool:
        with get_metadata_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                DELETE FROM schema_layouts
                WHERE id = ?
                """,
                (str(layout_id),),
            )
            return cursor.rowcount > 0

    @staticmethod
    def duplicate_layout(layout_id: UUID) -> dict | None:
        source = LayoutRepository.get_layout(layout_id)
        if not source:
            return None

        base_name = f"{source['name']} (副本)"
        new_name = base_name
        counter = 1

        while LayoutRepository.layout_name_exists(UUID(source["connection_id"]), new_name):
            counter += 1
            new_name = f"{base_name} {counter}"

        return LayoutRepository.create_layout(
            connection_id=UUID(source["connection_id"]),
            name=new_name,
            is_default=False,
            layout_data=source["layout_data"],
            visible_tables=source["visible_tables"],
        )

    @staticmethod
    def list_layouts_full(connection_id: UUID) -> list[dict]:
        with get_metadata_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM schema_layouts
                WHERE connection_id = ?
                ORDER BY is_default DESC, name ASC
                """,
                (str(connection_id),),
            )
            rows = cursor.fetchall()
            return [LayoutRepository._parse_json_fields(dict(row)) for row in rows]

    @staticmethod
    def get_layout_by_name(connection_id: UUID, name: str) -> dict | None:
        with get_metadata_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM schema_layouts
                WHERE connection_id = ? AND name = ?
                """,
                (str(connection_id), name),
            )
            row = cursor.fetchone()
            return LayoutRepository._parse_json_fields(dict(row)) if row else None

    @staticmethod
    def delete_all_layouts(connection_id: UUID) -> int:
        with get_metadata_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                DELETE FROM schema_layouts
                WHERE connection_id = ?
                """,
                (str(connection_id),),
            )
            return cursor.rowcount

    @staticmethod
    def layout_name_exists(connection_id: UUID, name: str, exclude_id: UUID | None = None) -> bool:
        with get_metadata_db() as conn:
            cursor = conn.cursor()
            if exclude_id:
                cursor.execute(
                    """
                    SELECT 1 FROM schema_layouts
                    WHERE connection_id = ? AND name = ? AND id != ?
                    """,
                    (str(connection_id), name, str(exclude_id)),
                )
            else:
                cursor.execute(
                    """
                    SELECT 1 FROM schema_layouts
                    WHERE connection_id = ? AND name = ?
                    """,
                    (str(connection_id), name),
                )
            return cursor.fetchone() is not None


init_metadata_db()
