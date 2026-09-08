"""Live database freshness checks for resumable analysis checkpoints."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from app.services.analysis_checkpoint import revalidate_database_replay_journal
from app.services.checkpoint_contract import CheckpointDriftError, stable_payload_hash


def _create_store_database(path: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = [
        {"store_id": "S-01", "orders": 12},
        {"store_id": "S-02", "orders": 7},
    ]
    with sqlite3.connect(path) as connection:
        connection.execute("CREATE TABLE stores (store_id TEXT PRIMARY KEY, orders INTEGER)")
        connection.executemany(
            "INSERT INTO stores (store_id, orders) VALUES (?, ?)",
            [(row["store_id"], row["orders"]) for row in rows],
        )
    return rows


def _manifest(
    rows: list[dict[str, object]],
    *,
    sql: str = "SELECT store_id, orders FROM stores ORDER BY store_id",
    truncated: bool = False,
) -> dict[str, object]:
    metadata = {
        "source_rows": len(rows),
        "materialized_rows": len(rows),
        "truncated": truncated,
        "execution_backend": "python",
        "execution_metadata": None,
        "source_refs": [
            {
                "source_id": "stores-source",
                "source_logical_name": "stores-source",
                "source_kind": "connection",
            }
        ],
    }
    return {
        "result_metadata": {"stores": metadata},
        "replay_journal": [
            {
                "op": "query_database",
                "source_id": "stores-source",
                "planned_sql": sql,
                "result_name": "stores",
                "result_hash": stable_payload_hash(rows),
                "metadata_hash": stable_payload_hash(metadata),
            }
        ],
    }


def _sqlite_config(path: Path) -> dict[str, dict[str, str]]:
    return {
        "stores-source": {
            "driver": "sqlite",
            "database": str(path),
        }
    }


@pytest.mark.asyncio
async def test_database_checkpoint_revalidation_accepts_unchanged_rows(tmp_path: Path):
    database = tmp_path / "stores.sqlite"
    rows = _create_store_database(database)

    await revalidate_database_replay_journal(
        _manifest(rows),
        _sqlite_config(database),
    )


@pytest.mark.asyncio
async def test_structured_database_read_is_revalidated_but_structured_file_read_is_not(
    tmp_path: Path,
):
    database = tmp_path / "stores.sqlite"
    rows = _create_store_database(database)
    structured_manifest = _manifest(rows)
    database_step = structured_manifest["replay_journal"][0]
    structured_metadata = {
        "materialized_rows": len(rows),
        "truncated": False,
        "request_limit": 1_000,
        "query_plan": {"dimensions": ["store_id"], "metrics": []},
    }
    structured_manifest["result_metadata"]["stores"] = structured_metadata
    database_step.update(
        {
            "op": "query_source_data",
            "source_kind": "connection",
            "metadata_hash": stable_payload_hash(structured_metadata),
        }
    )
    await revalidate_database_replay_journal(
        structured_manifest,
        _sqlite_config(database),
    )

    await revalidate_database_replay_journal(
        {
            "replay_journal": [
                {
                    "op": "query_source_data",
                    "source_kind": "file",
                    "source_id": "file-source",
                    "planned_sql": 'SELECT * FROM "orders"',
                    "result_hash": "not-used-for-files",
                }
            ]
        },
        {},
    )


@pytest.mark.asyncio
async def test_database_checkpoint_revalidation_rejects_changed_rows(tmp_path: Path):
    database = tmp_path / "stores.sqlite"
    rows = _create_store_database(database)
    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE stores SET orders = 99 WHERE store_id = 'S-01'")

    with pytest.raises(CheckpointDriftError, match="发生了变化"):
        await revalidate_database_replay_journal(
            _manifest(rows),
            _sqlite_config(database),
        )


@pytest.mark.asyncio
async def test_database_checkpoint_revalidation_rejects_changed_truncation_at_row_limit(
    tmp_path: Path,
):
    database = tmp_path / "stores.sqlite"
    rows = [{"store_id": f"S-{index:05d}", "orders": index} for index in range(10_000)]
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE stores (store_id TEXT PRIMARY KEY, orders INTEGER)")
        connection.executemany(
            "INSERT INTO stores (store_id, orders) VALUES (?, ?)",
            [(row["store_id"], row["orders"]) for row in rows],
        )

    manifest = _manifest(rows)
    with sqlite3.connect(database) as connection:
        connection.execute(
            "INSERT INTO stores (store_id, orders) VALUES (?, ?)",
            ("S-10000", 10_000),
        )

    with pytest.raises(CheckpointDriftError, match="截断状态"):
        await revalidate_database_replay_journal(
            manifest,
            _sqlite_config(database),
        )


@pytest.mark.asyncio
async def test_database_checkpoint_revalidation_rejects_missing_source_or_target(
    tmp_path: Path,
):
    database = tmp_path / "stores.sqlite"
    rows = _create_store_database(database)
    manifest = _manifest(rows)

    with pytest.raises(CheckpointDriftError, match="已不在当前项目"):
        await revalidate_database_replay_journal(manifest, {})

    database.unlink()
    with pytest.raises(CheckpointDriftError, match="已无法访问"):
        await revalidate_database_replay_journal(
            manifest,
            _sqlite_config(database),
        )
    assert not database.exists()
