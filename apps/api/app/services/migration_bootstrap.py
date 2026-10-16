"""Fail-closed Alembic bootstrap for ReceiptBI's local SQLite metadata database.

Desktop releases historically shipped an unversioned seed database and older
development builds used ``Base.metadata.create_all``.  This module recognizes
only complete, known schema generations, stamps that exact generation, and then
runs the real Alembic chain.  It never guesses across a partial generation.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import sqlalchemy as sa
from alembic.config import Config
from alembic.runtime.environment import EnvironmentContext
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Connection, inspect
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.ext.asyncio import AsyncEngine

from app.db.base import Base
from app.db.sqlite_migration import run_sqlite_migration


class UnsafeLocalSchemaError(RuntimeError):
    """The local schema cannot be assigned to one complete known revision."""


@dataclass(frozen=True)
class SchemaGeneration:
    revision: str
    required_tables: frozenset[str] = frozenset()
    required_columns: tuple[tuple[str, frozenset[str]], ...] = ()

    def marker_state(self, schema: dict[str, frozenset[str]]) -> str:
        markers: list[bool] = [table in schema for table in self.required_tables]
        for table, columns in self.required_columns:
            actual = schema.get(table, frozenset())
            markers.extend(column in actual for column in columns)
        if markers and all(markers):
            return "complete"
        if not any(markers):
            return "absent"
        return "partial"


_RETAINED_BASE_TABLE_COLUMNS: Final[dict[str, frozenset[str]]] = {
    "connections": frozenset({"id", "name", "driver", "database_name"}),
    "models": frozenset({"id", "name", "provider", "model_id"}),
    "conversations": frozenset({"id", "title", "status"}),
    "messages": frozenset({"id", "conversation_id", "role", "content"}),
    "app_settings": frozenset({"id", "context_rounds", "python_enabled"}),
}

_RETIRED_LEGACY_TABLE_COLUMNS: Final[dict[str, frozenset[str]]] = {
    "semantic_terms": frozenset({"id", "term", "expression"}),
    "table_relationships": frozenset(
        {"id", "connection_id", "source_table", "source_column", "target_table", "target_column"}
    ),
    "prompts": frozenset({"id", "name", "content"}),
}

_LEGACY_TABLE_COLUMNS: Final[dict[str, frozenset[str]]] = {
    **_RETAINED_BASE_TABLE_COLUMNS,
    **_RETIRED_LEGACY_TABLE_COLUMNS,
}

_RETIRED_REVISION: Final[str] = "0012_retire_legacy_settings"


def _legacy_seed_metadata() -> sa.MetaData:
    """Describe the shipped single-user 0001 seed without retired ORM classes."""

    metadata = sa.MetaData()

    def uuid_column(name: str, *args, **kwargs):
        return sa.Column(name, PG_UUID(as_uuid=True), *args, **kwargs)

    def timestamps() -> tuple[sa.Column, sa.Column]:
        return (
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )

    sa.Table(
        "connections",
        metadata,
        uuid_column("id", primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("driver", sa.String(20), nullable=False),
        sa.Column("host", sa.String(255)),
        sa.Column("port", sa.Integer()),
        sa.Column("username", sa.String(100)),
        sa.Column("password_encrypted", sa.Text()),
        sa.Column("database_name", sa.String(100)),
        sa.Column("extra_options", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        *timestamps(),
    )
    sa.Table(
        "models",
        metadata,
        uuid_column("id", primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("model_id", sa.String(100), nullable=False),
        sa.Column("base_url", sa.String(500)),
        sa.Column("api_key_encrypted", sa.Text()),
        sa.Column("extra_options", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        *timestamps(),
    )
    sa.Table(
        "conversations",
        metadata,
        uuid_column("id", primary_key=True),
        uuid_column(
            "connection_id",
            sa.ForeignKey("connections.id", ondelete="SET NULL"),
            nullable=True,
        ),
        uuid_column(
            "model_id",
            sa.ForeignKey("models.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title", sa.String(200)),
        sa.Column("status", sa.String(20), nullable=False, server_default="active", index=True),
        sa.Column("is_favorite", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("extra_data", sa.JSON(), nullable=False, server_default="{}"),
        *timestamps(),
    )
    sa.Table(
        "messages",
        metadata,
        uuid_column("id", primary_key=True),
        uuid_column(
            "conversation_id",
            sa.ForeignKey("conversations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("extra_data", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    sa.Table(
        "app_settings",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        uuid_column(
            "default_model_id",
            sa.ForeignKey("models.id", ondelete="SET NULL"),
            nullable=True,
        ),
        uuid_column(
            "default_connection_id",
            sa.ForeignKey("connections.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("context_rounds", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("python_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("diagnostics_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("auto_repair_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("demo_initialized", sa.Boolean(), nullable=False, server_default=sa.false()),
        *timestamps(),
    )
    sa.Table(
        "semantic_terms",
        metadata,
        uuid_column("id", primary_key=True),
        uuid_column(
            "connection_id",
            sa.ForeignKey("connections.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("term", sa.String(100), nullable=False, index=True),
        sa.Column("expression", sa.Text(), nullable=False),
        sa.Column("term_type", sa.String(20), nullable=False, server_default="metric"),
        sa.Column("description", sa.Text()),
        sa.Column("examples", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        *timestamps(),
    )
    sa.Table(
        "table_relationships",
        metadata,
        uuid_column("id", primary_key=True),
        uuid_column(
            "connection_id",
            sa.ForeignKey("connections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source_table", sa.String(100), nullable=False),
        sa.Column("source_column", sa.String(100), nullable=False),
        sa.Column("target_table", sa.String(100), nullable=False),
        sa.Column("target_column", sa.String(100), nullable=False),
        sa.Column("relationship_type", sa.String(10), nullable=False, server_default="1:N"),
        sa.Column("join_type", sa.String(20), nullable=False, server_default="LEFT"),
        sa.Column("description", sa.Text()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        *timestamps(),
    )
    sa.Table(
        "prompts",
        metadata,
        uuid_column("id", primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        uuid_column(
            "parent_id",
            sa.ForeignKey("prompts.id", ondelete="SET NULL"),
            nullable=True,
        ),
        *timestamps(),
    )
    return metadata


_LEGACY_SEED_METADATA: Final[sa.MetaData] = _legacy_seed_metadata()


def _create_legacy_seed_tables(connection: Connection) -> None:
    _LEGACY_SEED_METADATA.create_all(connection)


_GENERATIONS: Final[tuple[SchemaGeneration, ...]] = (
    SchemaGeneration(
        revision="0002_zero_config_analyst",
        required_tables=frozenset(
            {
                "projects",
                "project_data_sources",
                "preflight_reports",
                "sanitation_recipes",
                "semantic_entries",
                "analysis_runs",
                "artifacts",
            }
        ),
        required_columns=(
            (
                "semantic_entries",
                frozenset(
                    {
                        "id",
                        "project_id",
                        "key",
                        "value",
                        "entry_type",
                        "state",
                        "confidence",
                        "evidence",
                        "source",
                    }
                ),
            ),
        ),
    ),
    SchemaGeneration(
        revision="0003_typed_semantic_relationships",
        required_columns=(("semantic_entries", frozenset({"definition", "validity"})),),
    ),
    SchemaGeneration(
        revision="0004_analysis_corrections",
        required_tables=frozenset({"analysis_corrections"}),
        required_columns=(
            (
                "analysis_corrections",
                frozenset(
                    {
                        "id",
                        "project_id",
                        "analysis_run_id",
                        "semantic_entry_id",
                        "correction_type",
                        "text",
                        "scope",
                        "state",
                        "fingerprint",
                        "evidence",
                    }
                ),
            ),
        ),
    ),
    SchemaGeneration(
        revision="0005_correction_target_key",
        required_columns=(("analysis_corrections", frozenset({"target_key"})),),
    ),
    SchemaGeneration(
        revision="0006_semantic_execution_state",
        required_columns=(
            ("semantic_entries", frozenset({"execution_state", "execution_details"})),
        ),
    ),
    SchemaGeneration(
        revision="0007_semantic_revisions",
        required_tables=frozenset({"semantic_entry_revisions"}),
        required_columns=(
            (
                "semantic_entries",
                frozenset({"is_active", "revision_number", "active_revision_id"}),
            ),
            (
                "semantic_entry_revisions",
                frozenset(
                    {
                        "id",
                        "project_id",
                        "semantic_entry_id",
                        "revision_number",
                        "parent_revision_id",
                        "restored_from_revision_id",
                        "mutation_kind",
                        "actor_source",
                        "snapshot",
                        "created_at",
                    }
                ),
            ),
        ),
    ),
    SchemaGeneration(
        revision="0008_sanitation_recipe_revisions",
        required_tables=frozenset({"sanitation_recipe_revisions"}),
        required_columns=(
            ("sanitation_recipes", frozenset({"active_revision_id"})),
            (
                "sanitation_recipe_revisions",
                frozenset(
                    {
                        "id",
                        "recipe_id",
                        "revision_number",
                        "parent_revision_id",
                        "state",
                        "operations",
                        "input_contract",
                        "output_contract",
                        "actor_source",
                        "reason",
                        "source_correction_id",
                        "created_at",
                    }
                ),
            ),
        ),
    ),
    SchemaGeneration(
        revision="0011_correction_target_ref",
        required_columns=(("analysis_corrections", frozenset({"target_ref"})),),
    ),
    SchemaGeneration(
        revision="0013_model_health",
        required_columns=(
            (
                "models",
                frozenset(
                    {
                        "health_status",
                        "last_checked_at",
                        "last_error_category",
                        "last_response_time_ms",
                    }
                ),
            ),
        ),
    ),
    SchemaGeneration(
        revision="0015_editable_reports",
        required_tables=frozenset({"report_documents", "report_pages", "report_blocks"}),
        required_columns=(
            (
                "report_documents",
                frozenset(
                    {
                        "id",
                        "project_id",
                        "title",
                        "status",
                        "version",
                        "extra_data",
                    }
                ),
            ),
            (
                "report_pages",
                frozenset({"id", "report_id", "title", "order_index", "config", "version"}),
            ),
            (
                "report_blocks",
                frozenset(
                    {
                        "id",
                        "page_id",
                        "block_type",
                        "source_kind",
                        "analysis_run_id",
                        "artifact_id",
                        "source_ref",
                        "content",
                        "layout",
                        "config",
                        "version",
                    }
                ),
            ),
        ),
    ),
    SchemaGeneration(
        revision="0016_processing_consent",
        required_columns=(
            (
                "app_settings",
                frozenset({"preprocessing_enabled", "self_analysis_enabled"}),
            ),
        ),
    ),
    SchemaGeneration(
        revision="0017_semantic_validation_jobs",
        required_tables=frozenset({"semantic_validation_jobs", "semantic_validation_job_items"}),
        required_columns=(
            (
                "semantic_entries",
                frozenset({"recommendation_batch_id"}),
            ),
            (
                "semantic_validation_jobs",
                frozenset(
                    {
                        "id",
                        "project_id",
                        "status",
                        "requested_by",
                        "cancel_requested",
                        "details",
                    }
                ),
            ),
            (
                "semantic_validation_job_items",
                frozenset(
                    {
                        "id",
                        "job_id",
                        "semantic_entry_id",
                        "semantic_revision_id",
                        "definition_hash",
                        "status",
                        "code",
                        "facts",
                        "details",
                    }
                ),
            ),
        ),
    ),
    SchemaGeneration(
        revision="0018_semantic_scope_nodes",
        required_tables=frozenset({"semantic_scope_nodes"}),
        required_columns=(
            ("semantic_entries", frozenset({"scope_id"})),
            (
                "semantic_scope_nodes",
                frozenset(
                    {
                        "id",
                        "project_id",
                        "parent_id",
                        "kind",
                        "stable_key",
                        "business_name",
                        "source_logical_name",
                        "table_or_view",
                        "context_facts",
                        "is_active",
                    }
                ),
            ),
        ),
    ),
    SchemaGeneration(
        revision="0021_semantic_inventory_jobs",
        required_tables=frozenset({"semantic_inventory_jobs", "semantic_inventory_job_items"}),
        required_columns=(
            (
                "semantic_inventory_jobs",
                frozenset(
                    {
                        "id",
                        "project_id",
                        "source_id",
                        "status",
                        "depth",
                        "locale",
                        "model_id",
                        "tables",
                        "relation_index_hash",
                        "selection_hash",
                        "cancel_requested",
                        "lease_owner",
                        "lease_expires_at",
                        "heartbeat_at",
                        "details",
                        "started_at",
                        "completed_at",
                        "created_at",
                        "updated_at",
                    }
                ),
            ),
            (
                "semantic_inventory_job_items",
                frozenset(
                    {
                        "id",
                        "job_id",
                        "ordinal",
                        "table_name",
                        "status",
                        "phase",
                        "attempt_count",
                        "next_attempt_at",
                        "retryable",
                        "code",
                        "message",
                        "profile_result",
                        "recommendation_batch_id",
                        "candidate_count",
                        "started_at",
                        "completed_at",
                        "created_at",
                        "updated_at",
                    }
                ),
            ),
        ),
    ),
    SchemaGeneration(
        revision="0023_report_library",
        required_columns=(("report_documents", frozenset({"search_text", "name_key"})),),
    ),
    SchemaGeneration(
        revision="0025_report_save_receipts",
        required_tables=frozenset({"report_save_receipts"}),
        required_columns=(
            (
                "report_save_receipts",
                frozenset(
                    {
                        "request_id",
                        "report_id",
                        "request_hash",
                        "result_version",
                        "snapshot",
                    }
                ),
            ),
        ),
    ),
    SchemaGeneration(
        revision="0026_report_revisions",
        required_tables=frozenset({"report_revisions"}),
        required_columns=(
            (
                "report_revisions",
                frozenset(
                    {
                        "report_id",
                        "version",
                        "title",
                        "saved_at",
                        "reason",
                        "page_count",
                        "block_count",
                        "snapshot",
                        "snapshot_hash",
                    }
                ),
            ),
        ),
    ),
    SchemaGeneration(
        revision="0027_report_trash",
        required_tables=frozenset(),
        required_columns=(("report_documents", frozenset({"deleted_at"})),),
    ),
    SchemaGeneration(
        revision="0028_report_copy_receipts",
        required_tables=frozenset({"report_copy_receipts"}),
        required_columns=(
            (
                "report_copy_receipts",
                frozenset(
                    {
                        "project_id",
                        "request_id",
                        "source_report_id",
                        "source_version",
                        "target_report_id",
                        "request_hash",
                        "created_at",
                    }
                ),
            ),
        ),
    ),
    SchemaGeneration(
        revision="0029_file_upload_receipts",
        required_tables=frozenset({"file_upload_receipts"}),
        required_columns=(
            (
                "file_upload_receipts",
                frozenset(
                    {
                        "project_id",
                        "request_id",
                        "source_id",
                        "filename",
                        "byte_size",
                        "fingerprint",
                        "created_at",
                    }
                ),
            ),
        ),
    ),
    SchemaGeneration(
        revision="0030_analysis_history",
        required_columns=(("analysis_runs", frozenset({"history_search_text"})),),
    ),
)

# Migrations without new tables or columns share the same markers as their last
# structural predecessor. Keeping this mapping explicit prevents an unversioned
# 0008 file from being stamped past integrity cleanup or constraint replacement.
_SCHEMA_REVISION_ALIASES: Final[dict[str, str]] = {
    "0009_cleanup_orphan_sanitation": "0008_sanitation_recipe_revisions",
    "0010_defer_sanitation_parent_fk": "0008_sanitation_recipe_revisions",
    "0014_candidate_hygiene": "0013_model_health",
    "0019_retire_legacy_candidates": "0018_semantic_scope_nodes",
    "0020_retire_stale_recos": "0018_semantic_scope_nodes",
    "0022_retire_legacy_user_scope": "0021_semantic_inventory_jobs",
    "0024_sqlite_uuid_text": "0023_report_library",
}


def _structural_revision(revision: str) -> str:
    return _SCHEMA_REVISION_ALIASES.get(revision, revision)


def _script_location() -> Path:
    candidates: list[Path] = []
    bundle_root = getattr(sys, "_MEIPASS", None)
    if bundle_root:
        candidates.append(Path(bundle_root) / "alembic")
    candidates.append(Path(__file__).resolve().parents[2] / "alembic")
    for candidate in candidates:
        if (candidate / "versions").is_dir():
            return candidate
    raise UnsafeLocalSchemaError("数据库迁移资源缺失，无法安全启动 ReceiptBI")


def _alembic_runtime(script_location: Path) -> tuple[Config, ScriptDirectory]:
    config = Config()
    config.set_main_option("script_location", str(script_location))
    return config, ScriptDirectory.from_config(config)


def _run_environment(
    connection: Connection,
    *,
    script_location: Path,
    destination: str,
    stamp: bool,
) -> None:
    config, scripts = _alembic_runtime(script_location)
    if stamp:

        def migrations(current, _context):
            return scripts._stamp_revs((destination,), current)
    else:

        def migrations(current, _context):
            return scripts._upgrade_revs(destination, current)

    with EnvironmentContext(
        config,
        scripts,
        fn=migrations,
        destination_rev=destination,
        purge=stamp,
    ) as environment:
        environment.configure(connection=connection, target_metadata=Base.metadata)
        with environment.begin_transaction():
            environment.run_migrations()


def _schema_snapshot(connection: Connection) -> dict[str, frozenset[str]]:
    inspector = inspect(connection)
    return {
        table: frozenset(column["name"] for column in inspector.get_columns(table))
        for table in inspector.get_table_names()
        if not table.startswith("sqlite_") and table != "alembic_version"
    }


def _assert_retained_base(schema: dict[str, frozenset[str]]) -> None:
    present = set(schema) & set(_RETAINED_BASE_TABLE_COLUMNS)
    if present != set(_RETAINED_BASE_TABLE_COLUMNS):
        missing = sorted(set(_RETAINED_BASE_TABLE_COLUMNS) - present)
        found = sorted(present)
        raise UnsafeLocalSchemaError(
            f"本地数据库基础表不完整，拒绝猜测迁移版本（已发现：{found or '无'}；缺少：{missing}）"
        )
    for table, required in _RETAINED_BASE_TABLE_COLUMNS.items():
        missing_columns = required - schema[table]
        if missing_columns:
            raise UnsafeLocalSchemaError(
                f"本地数据库表 {table} 结构不完整，缺少 {sorted(missing_columns)}"
            )


def _infer_revision(schema: dict[str, frozenset[str]]) -> str:
    _assert_retained_base(schema)
    retired_tables = set(_RETIRED_LEGACY_TABLE_COLUMNS)
    present_retired = set(schema) & retired_tables
    if present_retired not in (set(), retired_tables):
        raise UnsafeLocalSchemaError("本地数据库包含部分退役设置表，拒绝猜测迁移版本")
    for table in present_retired:
        missing_columns = _RETIRED_LEGACY_TABLE_COLUMNS[table] - schema[table]
        if missing_columns:
            raise UnsafeLocalSchemaError(
                f"本地数据库表 {table} 结构不完整，缺少 {sorted(missing_columns)}"
            )
    retired = not present_retired
    demo_column_present = "demo_initialized" in schema["app_settings"]
    if retired and demo_column_present:
        raise UnsafeLocalSchemaError("本地数据库只完成了部分旧设置退役，拒绝继续启动")

    inferred = "0001_initial"
    gap_seen = False
    for generation in _GENERATIONS:
        state = generation.marker_state(schema)
        if state == "partial":
            raise UnsafeLocalSchemaError(
                f"本地数据库包含不完整的 {generation.revision} 结构，拒绝继续迁移"
            )
        if state == "complete":
            if gap_seen:
                raise UnsafeLocalSchemaError(
                    f"本地数据库跨过缺失版本却包含 {generation.revision} 结构"
                )
            inferred = generation.revision
        else:
            gap_seen = True
    if retired:
        if inferred == "0011_correction_target_ref":
            inferred = _RETIRED_REVISION
        elif inferred not in {
            "0013_model_health",
            "0015_editable_reports",
            "0016_processing_consent",
            "0017_semantic_validation_jobs",
            "0018_semantic_scope_nodes",
            "0021_semantic_inventory_jobs",
            "0023_report_library",
            "0025_report_save_receipts",
            "0026_report_revisions",
            "0027_report_trash",
            "0028_report_copy_receipts",
            "0029_file_upload_receipts",
            "0030_analysis_history",
        }:
            raise UnsafeLocalSchemaError("本地数据库过早移除了旧设置表，拒绝猜测迁移版本")

    known_tables = set(_RETAINED_BASE_TABLE_COLUMNS) | retired_tables
    for generation in _GENERATIONS:
        known_tables.update(generation.required_tables)
    unexpected_app_tables = set(schema) - known_tables - {"users", "refresh_tokens"}
    if unexpected_app_tables:
        # Third-party/user tables do not belong in ReceiptBI's metadata file.
        raise UnsafeLocalSchemaError(
            f"本地元数据库包含未知表 {sorted(unexpected_app_tables)}，拒绝猜测迁移版本"
        )
    return inferred


def _current_revision(connection: Connection) -> str | None:
    return MigrationContext.configure(connection).get_current_revision()


def _bootstrap_sync(connection: Connection, script_location: Path) -> str:
    schema = _schema_snapshot(connection)
    version_table_present = inspect(connection).has_table("alembic_version")
    config, scripts = _alembic_runtime(script_location)
    del config
    head = scripts.get_current_head()
    if head is None:
        raise UnsafeLocalSchemaError("数据库迁移没有唯一 head，无法安全启动")

    current = _current_revision(connection)
    if not schema:
        if version_table_present:
            raise UnsafeLocalSchemaError("数据库已有迁移记录表但没有任何应用表，拒绝猜测")
        # The historical 0001 migration describes a removed multi-user server
        # schema, while every desktop build starts from the single-user seed.
        # Reproduce only that canonical seed for a provably empty file, stamp
        # 0001, and still execute every product-workspace migration to head.
        _create_legacy_seed_tables(connection)
        schema = _schema_snapshot(connection)

    inferred = _infer_revision(schema)
    if current is not None:
        try:
            scripts.get_revision(current)
        except Exception as exc:
            raise UnsafeLocalSchemaError(f"数据库记录了未知迁移版本 {current}") from exc
        if _structural_revision(current) != inferred:
            raise UnsafeLocalSchemaError(
                f"数据库版本记录为 {current}，但完整结构对应 {inferred}，拒绝猜测"
            )
    else:
        _run_environment(
            connection,
            script_location=script_location,
            destination=inferred,
            stamp=True,
        )

    _run_environment(
        connection,
        script_location=script_location,
        destination=head,
        stamp=False,
    )
    final_schema = _schema_snapshot(connection)
    final_revision = _current_revision(connection)
    if final_revision != head or _infer_revision(final_schema) != _structural_revision(head):
        raise UnsafeLocalSchemaError("数据库迁移没有得到完整 head 结构，拒绝启动")
    # Column names alone cannot distinguish SQLite's old NUMERIC-affinity UUID
    # declaration from the corrected CHAR representation. Check the current
    # runtime mapping after migration, including an already-stamped database.
    inspector = inspect(connection)
    for table in Base.metadata.tables.values():
        names = {column.name for column in table.columns if isinstance(column.type, sa.Uuid)}
        if not names:
            continue
        actual = {column["name"]: column["type"] for column in inspector.get_columns(table.name)}
        if any(not isinstance(actual.get(name), sa.String) for name in names):
            raise UnsafeLocalSchemaError(
                f"本地数据库表 {table.name} 的标识存储类型不完整，拒绝启动"
            )
    return head


async def migrate_local_sqlite_to_head(
    engine: AsyncEngine,
    database_url: str,
    *,
    script_location: Path | None = None,
) -> str:
    """Upgrade one local SQLite database before any application session is opened."""

    if not database_url.startswith(("sqlite://", "sqlite+aiosqlite://")):
        raise UnsafeLocalSchemaError("桌面数据库必须使用本地 SQLite")
    location = script_location or _script_location()
    _config, scripts = _alembic_runtime(location)
    target = scripts.get_current_head()
    if target is None:
        raise UnsafeLocalSchemaError("数据库迁移没有唯一 head，无法安全启动")
    # Share the same real DDL transaction and pre-commit association check as
    # the Alembic CLI. Never commit the upgraded schema before checking its graph.
    async with engine.connect() as connection:
        return await connection.run_sync(
            lambda sync: run_sqlite_migration(
                sync, lambda: _bootstrap_sync(sync, location), target_revision=target
            )
        )
