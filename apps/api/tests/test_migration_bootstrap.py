"""Desktop SQLite bootstrap upgrades only complete, recognized schemas."""

from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.db.base import Base
from app.db.session import configure_sqlite_foreign_keys
from app.db.tables import Project
from app.services.migration_bootstrap import (
    _LEGACY_SEED_METADATA,
    UnsafeLocalSchemaError,
    _create_legacy_seed_tables,
    migrate_local_sqlite_to_head,
)

HEAD = "0030_analysis_history"


def _engine(path: Path) -> AsyncEngine:
    database_url = f"sqlite+aiosqlite:///{path}"
    engine = create_async_engine(database_url)
    configure_sqlite_foreign_keys(engine, database_url)
    return engine


def _drop_correction_target_ref(sync_connection) -> None:
    """Make a Base-created fixture accurately represent a pre-0011 schema."""

    sync_connection.exec_driver_sql("DROP INDEX ix_analysis_corrections_target_ref")
    sync_connection.exec_driver_sql("ALTER TABLE analysis_corrections DROP COLUMN target_ref")


def _create_pre_retirement_schema(sync_connection) -> None:
    _create_legacy_seed_tables(sync_connection)
    Base.metadata.create_all(sync_connection)
    # Historical fixtures predate the editable report document migration.
    sync_connection.exec_driver_sql("DROP TABLE semantic_inventory_job_items")
    sync_connection.exec_driver_sql("DROP TABLE semantic_inventory_jobs")
    operations = Operations(MigrationContext.configure(sync_connection))
    with operations.batch_alter_table(
        "semantic_entries",
        recreate="always",
        naming_convention={"fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"},
    ) as batch_op:
        batch_op.drop_index("ix_semantic_entries_scope_id")
        batch_op.drop_constraint(
            "fk_semantic_entries_scope_id_semantic_scope_nodes",
            type_="foreignkey",
        )
        batch_op.drop_column("scope_id")
    operations.drop_table("semantic_scope_nodes")
    sync_connection.exec_driver_sql("DROP TABLE semantic_validation_job_items")
    sync_connection.exec_driver_sql("DROP TABLE semantic_validation_jobs")
    sync_connection.exec_driver_sql("DROP INDEX ix_semantic_entries_recommendation_batch_id")
    sync_connection.exec_driver_sql(
        "ALTER TABLE semantic_entries DROP COLUMN recommendation_batch_id"
    )
    sync_connection.exec_driver_sql("DROP INDEX ix_analysis_history_updated")
    sync_connection.exec_driver_sql("ALTER TABLE analysis_runs DROP COLUMN history_search_text")
    sync_connection.exec_driver_sql("DROP TABLE file_upload_receipts")
    sync_connection.exec_driver_sql("DROP TABLE report_copy_receipts")
    sync_connection.exec_driver_sql("DROP TABLE report_revisions")
    sync_connection.exec_driver_sql("DROP TABLE report_save_receipts")
    sync_connection.exec_driver_sql("DROP TABLE report_blocks")
    sync_connection.exec_driver_sql("DROP TABLE report_pages")
    sync_connection.exec_driver_sql("DROP TABLE report_documents")


async def _revision(engine: AsyncEngine) -> str | None:
    async with engine.connect() as connection:
        result = await connection.execute(text("SELECT version_num FROM alembic_version"))
        return result.scalar_one_or_none()


async def _create_packaged_seed(engine: AsyncEngine) -> str:
    connection_id = uuid4()

    def create(sync_connection):
        _create_legacy_seed_tables(sync_connection)
        sync_connection.execute(
            _LEGACY_SEED_METADATA.tables["connections"]
            .insert()
            .values(
                id=connection_id,
                name="Sample Database",
                driver="sqlite",
                database_name="__DEMO_DB_PATH__",
                extra_options={},
                is_default=True,
            )
        )

    async with engine.begin() as connection:
        await connection.run_sync(create)
    return str(connection_id)


async def _create_versioned_0011_legacy_settings(engine: AsyncEngine) -> dict[str, str]:
    ids = {
        name: uuid4()
        for name in (
            "user_connection",
            "orphan_connection",
            "demo_connection",
            "user_project",
            "user_demo_only_project",
            "system_demo_project",
            "user_source",
            "user_demo_source",
            "user_demo_only_source",
            "system_demo_source",
            "user_preflight",
            "demo_preflight",
            "conversation",
            "message",
            "user_term",
            "collision_term",
            "orphan_term",
            "demo_term",
            "relationship",
            "prompt",
            "existing_entry",
            "derived_entry",
            "derived_revision",
            "protected_entry",
            "protected_revision",
        )
    }

    def create(sync_connection):
        _create_pre_retirement_schema(sync_connection)
        sync_connection.exec_driver_sql(
            "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)"
        )
        sync_connection.exec_driver_sql(
            "INSERT INTO alembic_version (version_num) VALUES (?)",
            ("0011_correction_target_ref",),
        )

        current = Base.metadata.tables
        legacy = _LEGACY_SEED_METADATA.tables
        sync_connection.execute(
            current["connections"].insert(),
            [
                {
                    "id": ids["user_connection"],
                    "name": "Customer SQLite",
                    "driver": "sqlite",
                    "database_name": "/Users/example/.querygpt-desktop/customer.db",
                    "extra_options": {},
                    "is_default": False,
                },
                {
                    "id": ids["orphan_connection"],
                    "name": "Unmapped Warehouse",
                    "driver": "sqlite",
                    "database_name": "/data/customer.sqlite",
                    "extra_options": {},
                    "is_default": False,
                },
                {
                    "id": ids["demo_connection"],
                    "name": "Sample Database",
                    "driver": "sqlite",
                    "database_name": "/Users/example/.querygpt-desktop/demo.db",
                    "extra_options": {},
                    "is_default": True,
                },
            ],
        )
        sync_connection.execute(
            legacy["app_settings"]
            .insert()
            .values(
                id=1,
                default_connection_id=ids["demo_connection"],
                context_rounds=5,
                python_enabled=True,
                diagnostics_enabled=True,
                auto_repair_enabled=True,
                demo_initialized=True,
            )
        )
        sync_connection.execute(
            current["projects"].insert(),
            [
                {
                    "id": ids["user_project"],
                    "name": "用户经营项目",
                    "status": "active",
                    "extra_data": {},
                },
                {
                    "id": ids["user_demo_only_project"],
                    "name": "我的示例练习",
                    "status": "active",
                    "extra_data": {},
                },
                {
                    "id": ids["system_demo_project"],
                    "name": "Sample Project",
                    "status": "active",
                    "extra_data": {"system_demo": True},
                },
            ],
        )
        sync_connection.execute(
            current["project_data_sources"].insert(),
            [
                {
                    "id": ids["user_source"],
                    "project_id": ids["user_project"],
                    "connection_id": ids["user_connection"],
                    "kind": "connection",
                    "name": "Customer SQLite",
                    "source_uri": "/Users/example/.querygpt-desktop/source.db",
                    "working_uri": "/Users/example/.querygpt-desktop/work/source.db",
                    "status": "ready",
                    "profile_data": {
                        "preanalysis": {
                            "available_lenses": ["trend", "matrix"],
                            "nested": {"available_lenses": ["heatmap"]},
                            "candidate_grain": ["store"],
                        }
                    },
                },
                {
                    "id": ids["user_demo_source"],
                    "project_id": ids["user_project"],
                    "connection_id": ids["demo_connection"],
                    "kind": "connection",
                    "name": "Sample Database",
                    "source_uri": None,
                    "working_uri": None,
                    "status": "ready",
                    "profile_data": {},
                },
                {
                    "id": ids["user_demo_only_source"],
                    "project_id": ids["user_demo_only_project"],
                    "connection_id": ids["demo_connection"],
                    "kind": "connection",
                    "name": "Sample Database",
                    "source_uri": None,
                    "working_uri": None,
                    "status": "ready",
                    "profile_data": {},
                },
                {
                    "id": ids["system_demo_source"],
                    "project_id": ids["system_demo_project"],
                    "connection_id": ids["demo_connection"],
                    "kind": "connection",
                    "name": "Sample Database",
                    "source_uri": None,
                    "working_uri": None,
                    "status": "ready",
                    "profile_data": {},
                },
            ],
        )
        sync_connection.execute(
            current["preflight_reports"].insert(),
            [
                {
                    "id": ids["user_preflight"],
                    "project_id": ids["user_project"],
                    "data_source_id": ids["user_source"],
                    "status": "ready",
                    "summary": "用户数据",
                    "issues": [],
                    "ambiguities": [],
                    "inferred_schema": {},
                    "source_snapshot": {
                        "preanalysis": {
                            "available_lenses": ["ranking"],
                            "shape": {"rows": 10},
                        }
                    },
                },
                {
                    "id": ids["demo_preflight"],
                    "project_id": ids["system_demo_project"],
                    "data_source_id": ids["system_demo_source"],
                    "status": "ready",
                    "summary": "示例数据",
                    "issues": [],
                    "ambiguities": [],
                    "inferred_schema": {},
                    "source_snapshot": {},
                },
            ],
        )
        sync_connection.execute(
            current["conversations"]
            .insert()
            .values(
                id=ids["conversation"],
                connection_id=ids["demo_connection"],
                title="保留的用户会话",
                status="active",
                extra_data={
                    "artifact_path": "/Users/example/.querygpt-desktop/artifacts/report.json"
                },
            )
        )
        sync_connection.execute(
            current["messages"]
            .insert()
            .values(
                id=ids["message"],
                conversation_id=ids["conversation"],
                role="assistant",
                content="已完成",
                extra_data={"files": ["/Users/example/.querygpt-desktop/artifacts/chart.png"]},
            )
        )
        sync_connection.execute(
            current["semantic_entries"]
            .insert()
            .values(
                id=ids["existing_entry"],
                project_id=ids["user_project"],
                key=f"legacy_term:{ids['collision_term']}",
                value="用户已经确认的定义",
                entry_type="metric",
                state="confirmed",
                confidence=1.0,
                definition=None,
                validity="active",
                execution_state="definition_only",
                execution_details={},
                evidence=[],
                source="user",
                is_active=True,
                revision_number=0,
                active_revision_id=None,
            )
        )
        now = datetime.now(UTC)
        derived_snapshot = {
            "key": "relationship:demo-mixed",
            "value": "真实订单与 Sample Database 客户表的候选关系",
            "entry_type": "relationship",
            "state": "candidate",
            "confidence": 0.7,
            "definition": None,
            "validity": "unverified",
            "execution_state": "definition_only",
            "execution_details": {},
            "evidence": [
                {
                    "sources": [
                        "orders.csv.orders.customer_id",
                        "Sample Database.customers.id",
                    ],
                }
            ],
            "source": "inferred",
            "is_active": True,
        }
        protected_snapshot = {
            "key": "metric:user-confirmed-demo",
            "value": "用户曾确认但绑定了旧示例源",
            "entry_type": "metric",
            "state": "confirmed",
            "confidence": 1.0,
            "definition": None,
            "validity": "active",
            "execution_state": "verified",
            "execution_details": {"verified": True},
            "evidence": [{"source": "Sample Database.sales.amount"}],
            "source": "user",
            "is_active": True,
        }
        sync_connection.execute(
            current["semantic_entries"].insert(),
            [
                {
                    "id": ids["derived_entry"],
                    "project_id": ids["user_project"],
                    **derived_snapshot,
                    "revision_number": 1,
                    "active_revision_id": ids["derived_revision"],
                },
                {
                    "id": ids["protected_entry"],
                    "project_id": ids["user_project"],
                    **protected_snapshot,
                    "revision_number": 1,
                    "active_revision_id": ids["protected_revision"],
                },
            ],
        )
        sync_connection.execute(
            current["semantic_entry_revisions"].insert(),
            [
                {
                    "id": ids["derived_revision"],
                    "project_id": ids["user_project"],
                    "semantic_entry_id": ids["derived_entry"],
                    "revision_number": 1,
                    "parent_revision_id": None,
                    "restored_from_revision_id": None,
                    "mutation_kind": "candidate_created",
                    "actor_source": "system",
                    "reason": "测试 demo 派生候选",
                    "source_correction_id": None,
                    "snapshot": derived_snapshot,
                    "created_at": now,
                },
                {
                    "id": ids["protected_revision"],
                    "project_id": ids["user_project"],
                    "semantic_entry_id": ids["protected_entry"],
                    "revision_number": 1,
                    "parent_revision_id": None,
                    "restored_from_revision_id": None,
                    "mutation_kind": "user_confirmed",
                    "actor_source": "user",
                    "reason": "测试需保留的用户定义",
                    "source_correction_id": None,
                    "snapshot": protected_snapshot,
                    "created_at": now,
                },
            ],
        )
        sync_connection.execute(
            legacy["semantic_terms"].insert(),
            [
                {
                    "id": ids["user_term"],
                    "connection_id": ids["user_connection"],
                    "term": "Net revenue",
                    "expression": "SUM(paid_amount - refund_amount)",
                    "term_type": "metric",
                    "description": "用户旧指标",
                    "examples": ["net revenue by month"],
                    "is_active": True,
                },
                {
                    "id": ids["collision_term"],
                    "connection_id": ids["user_connection"],
                    "term": "Do not overwrite",
                    "expression": "SUM(other_amount)",
                    "term_type": "metric",
                    "description": None,
                    "examples": [],
                    "is_active": True,
                },
                {
                    "id": ids["orphan_term"],
                    "connection_id": ids["orphan_connection"],
                    "term": "Legacy region",
                    "expression": "region_name",
                    "term_type": "dimension",
                    "description": None,
                    "examples": [],
                    "is_active": True,
                },
                {
                    "id": ids["demo_term"],
                    "connection_id": ids["demo_connection"],
                    "term": "GMV",
                    "expression": "SUM(sales.amount)",
                    "term_type": "metric",
                    "description": None,
                    "examples": [],
                    "is_active": True,
                },
            ],
        )
        sync_connection.execute(
            legacy["table_relationships"]
            .insert()
            .values(
                id=ids["relationship"],
                connection_id=ids["user_connection"],
                source_table="orders",
                source_column="customer_id",
                target_table="customers",
                target_column="id",
                relationship_type="N:1",
                join_type="LEFT",
                description="旧关系",
                is_active=True,
            )
        )
        sync_connection.execute(
            legacy["prompts"]
            .insert()
            .values(
                id=ids["prompt"],
                name="Legacy analyst",
                content="Always use SQL + Python + chart",
                version=1,
                is_active=True,
                is_default=True,
            )
        )

    async with engine.begin() as connection:
        await connection.run_sync(create)
    return {name: str(value) for name, value in ids.items()}


async def _create_unversioned_0006(engine: AsyncEngine, *, versioned: bool) -> tuple[str, str]:
    project_id = uuid4()
    entry_id = uuid4()

    def create(sync_connection):
        _create_pre_retirement_schema(sync_connection)
        _drop_correction_target_ref(sync_connection)
        sync_connection.exec_driver_sql("DROP TABLE sanitation_recipe_revisions")
        sync_connection.exec_driver_sql("DROP INDEX ix_sanitation_recipes_active_revision_id")
        sync_connection.exec_driver_sql(
            "ALTER TABLE sanitation_recipes DROP COLUMN active_revision_id"
        )
        sync_connection.exec_driver_sql("DROP TABLE semantic_entry_revisions")
        sync_connection.exec_driver_sql("DROP INDEX ix_semantic_entries_active_revision_id")
        sync_connection.exec_driver_sql("DROP INDEX ix_semantic_entries_is_active")
        sync_connection.exec_driver_sql(
            "ALTER TABLE semantic_entries DROP COLUMN active_revision_id"
        )
        sync_connection.exec_driver_sql("ALTER TABLE semantic_entries DROP COLUMN revision_number")
        sync_connection.exec_driver_sql("ALTER TABLE semantic_entries DROP COLUMN is_active")
        if versioned:
            sync_connection.exec_driver_sql(
                "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)"
            )
            sync_connection.exec_driver_sql(
                "INSERT INTO alembic_version (version_num) VALUES (?)",
                ("0006_semantic_execution_state",),
            )
        sync_connection.execute(
            Project.__table__.insert().values(
                id=project_id,
                name="历史项目",
                status="active",
                extra_data={},
            )
        )
        # The SQLAlchemy Table includes newer revision columns, while this fixture
        # intentionally represents 0006; compile an explicit legacy insert.
        sync_connection.exec_driver_sql(
            """
            INSERT INTO semantic_entries (
                id, project_id, key, value, entry_type, state, confidence,
                definition, validity, execution_state, execution_details,
                evidence, source, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            (
                entry_id.hex,
                project_id.hex,
                "metric:revenue",
                "收入按实付金额",
                "metric",
                "confirmed",
                1,
                None,
                "active",
                "definition_only",
                "{}",
                '[{"kind":"user_confirmation"}]',
                "user",
            ),
        )

    async with engine.begin() as connection:
        await connection.run_sync(create)
    return str(project_id), str(entry_id)


async def _create_versioned_0007_recipe(engine: AsyncEngine) -> tuple[str, str]:
    project_id = uuid4()
    source_id = uuid4()
    recipe_id = uuid4()

    def create(sync_connection):
        _create_pre_retirement_schema(sync_connection)
        _drop_correction_target_ref(sync_connection)
        sync_connection.exec_driver_sql("DROP TABLE sanitation_recipe_revisions")
        sync_connection.exec_driver_sql("DROP INDEX ix_sanitation_recipes_active_revision_id")
        sync_connection.exec_driver_sql(
            "ALTER TABLE sanitation_recipes DROP COLUMN active_revision_id"
        )
        sync_connection.exec_driver_sql(
            "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)"
        )
        sync_connection.exec_driver_sql(
            "INSERT INTO alembic_version (version_num) VALUES (?)",
            ("0007_semantic_revisions",),
        )
        sync_connection.exec_driver_sql(
            """
            INSERT INTO projects (
                id, name, status, extra_data, created_at, updated_at
            ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            (project_id.hex, "历史清洗项目", "active", "{}"),
        )
        sync_connection.exec_driver_sql(
            """
            INSERT INTO project_data_sources (
                id, project_id, kind, name, format, status, profile_data,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            (
                source_id.hex,
                project_id.hex,
                "file",
                "orders.csv",
                "csv",
                "ready",
                "{}",
            ),
        )
        sync_connection.exec_driver_sql(
            """
            INSERT INTO sanitation_recipes (
                id, project_id, data_source_id, name, status, operations,
                input_fingerprint, output_fingerprint, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            (
                recipe_id.hex,
                project_id.hex,
                source_id.hex,
                "历史订单整理",
                "needs_attention",
                '[{"operation":"trim_text","column":"store_id"}]',
                "a" * 64,
                "b" * 64,
            ),
        )

    async with engine.begin() as connection:
        await connection.run_sync(create)
    return str(project_id), str(recipe_id)


async def _create_versioned_0008_orphan_history(engine: AsyncEngine) -> None:
    missing_recipe_id = uuid4().hex
    first_revision_id = uuid4().hex
    second_revision_id = uuid4().hex

    def create(sync_connection):
        _create_pre_retirement_schema(sync_connection)
        _drop_correction_target_ref(sync_connection)
        sync_connection.exec_driver_sql(
            "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)"
        )
        sync_connection.exec_driver_sql(
            "INSERT INTO alembic_version (version_num) VALUES (?)",
            ("0008_sanitation_recipe_revisions",),
        )
        sync_connection.exec_driver_sql(
            """
            INSERT INTO sanitation_recipe_revisions (
                id, recipe_id, revision_number, parent_revision_id, state,
                operations, input_contract, output_contract, actor_source,
                reason, source_correction_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            (
                first_revision_id,
                missing_recipe_id,
                1,
                None,
                "confirmed",
                "[]",
                "{}",
                "{}",
                "system",
                "已失去父配方",
                None,
            ),
        )
        sync_connection.exec_driver_sql(
            """
            INSERT INTO sanitation_recipe_revisions (
                id, recipe_id, revision_number, parent_revision_id, state,
                operations, input_contract, output_contract, actor_source,
                reason, source_correction_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            (
                second_revision_id,
                missing_recipe_id,
                2,
                first_revision_id,
                "reverted",
                "[]",
                "{}",
                "{}",
                "user",
                "孤儿链的后继版本",
                None,
            ),
        )

    async with engine.begin() as connection:
        await connection.run_sync(create)


async def _create_versioned_0008_invalid_history(
    engine: AsyncEngine,
    *,
    corruption: str,
) -> None:
    project_id = uuid4().hex
    source_id = uuid4().hex
    recipe_id = uuid4().hex
    other_recipe_id = uuid4().hex
    revision_1 = uuid4().hex
    revision_2 = uuid4().hex
    revision_3 = uuid4().hex

    if corruption == "branch":
        active_revision_id = revision_2
        revision_rows = [
            (revision_1, recipe_id, 1, None),
            (revision_2, recipe_id, 2, revision_1),
            (revision_3, recipe_id, 3, revision_1),
        ]
    elif corruption == "gap":
        active_revision_id = revision_3
        revision_rows = [
            (revision_1, recipe_id, 1, None),
            (revision_3, recipe_id, 3, revision_1),
        ]
    elif corruption == "cycle":
        active_revision_id = revision_3
        revision_rows = [
            (revision_2, recipe_id, 2, revision_3),
            (revision_3, recipe_id, 3, revision_2),
        ]
    elif corruption == "cross_recipe":
        active_revision_id = revision_2
        revision_rows = [
            (revision_1, recipe_id, 1, None),
            (revision_2, recipe_id, 2, revision_3),
            (revision_3, other_recipe_id, 1, None),
        ]
    else:  # pragma: no cover - test helper contract
        raise ValueError(corruption)

    def create(sync_connection):
        _create_pre_retirement_schema(sync_connection)
        _drop_correction_target_ref(sync_connection)
        sync_connection.exec_driver_sql(
            "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)"
        )
        sync_connection.exec_driver_sql(
            "INSERT INTO alembic_version (version_num) VALUES (?)",
            ("0008_sanitation_recipe_revisions",),
        )
        sync_connection.exec_driver_sql(
            """
            INSERT INTO projects (
                id, name, status, extra_data, created_at, updated_at
            ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            (project_id, "损坏清洗历史", "active", "{}"),
        )
        sync_connection.exec_driver_sql(
            """
            INSERT INTO project_data_sources (
                id, project_id, kind, name, format, status, profile_data,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            (source_id, project_id, "file", "orders.csv", "csv", "ready", "{}"),
        )

        def insert_recipe(candidate_recipe_id: str, active_id: str) -> None:
            sync_connection.exec_driver_sql(
                """
                INSERT INTO sanitation_recipes (
                    id, project_id, data_source_id, name, status, operations,
                    input_fingerprint, output_fingerprint, active_revision_id,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """,
                (
                    candidate_recipe_id,
                    project_id,
                    source_id,
                    "损坏的整理方法",
                    "applied",
                    "[]",
                    None,
                    None,
                    active_id,
                ),
            )

        insert_recipe(recipe_id, active_revision_id)
        if corruption == "cross_recipe":
            insert_recipe(other_recipe_id, revision_3)

        for revision_id, owner_recipe_id, number, parent_id in revision_rows:
            sync_connection.exec_driver_sql(
                """
                INSERT INTO sanitation_recipe_revisions (
                    id, recipe_id, revision_number, parent_revision_id, state,
                    operations, input_contract, output_contract, actor_source,
                    reason, source_correction_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                (
                    revision_id,
                    owner_recipe_id,
                    number,
                    parent_id,
                    "confirmed",
                    "[]",
                    "{}",
                    "{}",
                    "system",
                    "故意构造的损坏历史",
                    None,
                ),
            )

    async with engine.begin() as connection:
        await connection.run_sync(create)


async def _create_versioned_0009_restrict_history(engine: AsyncEngine) -> str:
    project_id = uuid4().hex
    source_id = uuid4().hex
    recipe_id = uuid4().hex
    first_revision_id = uuid4().hex
    second_revision_id = uuid4().hex

    def create(sync_connection):
        _create_pre_retirement_schema(sync_connection)
        _drop_correction_target_ref(sync_connection)
        sync_connection.exec_driver_sql("DROP TABLE sanitation_recipe_revisions")
        sync_connection.exec_driver_sql(
            """
            CREATE TABLE sanitation_recipe_revisions (
                recipe_id UUID NOT NULL,
                revision_number INTEGER NOT NULL,
                parent_revision_id UUID,
                state VARCHAR(20) NOT NULL,
                operations JSON NOT NULL,
                input_contract JSON NOT NULL,
                output_contract JSON NOT NULL,
                actor_source VARCHAR(30) NOT NULL,
                reason TEXT,
                source_correction_id VARCHAR(36),
                id UUID NOT NULL PRIMARY KEY,
                created_at DATETIME NOT NULL,
                CONSTRAINT uq_sanitation_recipe_revision_number
                    UNIQUE (recipe_id, revision_number),
                CONSTRAINT ck_sanitation_recipe_revision_state
                    CHECK (state IN ('candidate', 'confirmed', 'reverted')),
                FOREIGN KEY(recipe_id) REFERENCES sanitation_recipes(id) ON DELETE CASCADE,
                FOREIGN KEY(parent_revision_id)
                    REFERENCES sanitation_recipe_revisions(id) ON DELETE RESTRICT
            )
            """
        )
        for column in (
            "recipe_id",
            "parent_revision_id",
            "source_correction_id",
            "created_at",
        ):
            sync_connection.exec_driver_sql(
                f"CREATE INDEX ix_sanitation_recipe_revisions_{column} "
                f"ON sanitation_recipe_revisions ({column})"
            )
        sync_connection.exec_driver_sql(
            "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)"
        )
        sync_connection.exec_driver_sql(
            "INSERT INTO alembic_version (version_num) VALUES (?)",
            ("0009_cleanup_orphan_sanitation",),
        )
        sync_connection.exec_driver_sql(
            """
            INSERT INTO projects (
                id, name, status, extra_data, created_at, updated_at
            ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            (project_id, "延迟外键迁移", "active", "{}"),
        )
        sync_connection.exec_driver_sql(
            """
            INSERT INTO project_data_sources (
                id, project_id, kind, name, format, status, profile_data,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            (source_id, project_id, "file", "orders.csv", "csv", "ready", "{}"),
        )
        sync_connection.exec_driver_sql(
            """
            INSERT INTO sanitation_recipes (
                id, project_id, data_source_id, name, status, operations,
                input_fingerprint, output_fingerprint, active_revision_id,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            (
                recipe_id,
                project_id,
                source_id,
                "多版本整理方法",
                "applied",
                "[]",
                None,
                None,
                second_revision_id,
            ),
        )
        for revision_id, number, parent_id in (
            (first_revision_id, 1, None),
            (second_revision_id, 2, first_revision_id),
        ):
            sync_connection.exec_driver_sql(
                """
                INSERT INTO sanitation_recipe_revisions (
                    id, recipe_id, revision_number, parent_revision_id, state,
                    operations, input_contract, output_contract, actor_source,
                    reason, source_correction_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                (
                    revision_id,
                    recipe_id,
                    number,
                    parent_id,
                    "confirmed",
                    "[]",
                    "{}",
                    "{}",
                    "system",
                    "迁移前历史",
                    None,
                ),
            )

    async with engine.begin() as connection:
        await connection.run_sync(create)
    return recipe_id


@pytest.mark.asyncio
async def test_empty_database_bootstraps_head_and_repeated_start_is_idempotent(tmp_path: Path):
    engine = _engine(tmp_path / "empty.db")
    try:
        assert await migrate_local_sqlite_to_head(engine, str(engine.url)) == HEAD
        assert await _revision(engine) == HEAD
        assert await migrate_local_sqlite_to_head(engine, str(engine.url)) == HEAD
        assert await _revision(engine) == HEAD
        async with engine.connect() as connection:
            tables, settings_columns, job_columns, item_columns = await connection.run_sync(
                lambda sync: (
                    set(inspect(sync).get_table_names()),
                    {column["name"] for column in inspect(sync).get_columns("app_settings")},
                    {
                        column["name"]
                        for column in inspect(sync).get_columns("semantic_inventory_jobs")
                    },
                    {
                        column["name"]
                        for column in inspect(sync).get_columns("semantic_inventory_job_items")
                    },
                )
            )
        assert {
            "projects",
            "semantic_entries",
            "semantic_entry_revisions",
            "sanitation_recipe_revisions",
            "semantic_inventory_jobs",
            "semantic_inventory_job_items",
        } <= tables
        assert {"semantic_terms", "table_relationships", "prompts"}.isdisjoint(tables)
        assert "demo_initialized" not in settings_columns
        assert {
            "preprocessing_enabled",
            "self_analysis_enabled",
        } <= settings_columns
        assert {
            "project_id",
            "source_id",
            "depth",
            "tables",
            "selection_hash",
            "lease_expires_at",
        } <= job_columns
        assert {
            "job_id",
            "ordinal",
            "table_name",
            "phase",
            "attempt_count",
            "retryable",
            "profile_result",
        } <= item_columns
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_partial_semantic_inventory_generation_fails_closed(tmp_path: Path):
    engine = _engine(tmp_path / "partial-semantic-inventory.db")
    try:
        assert await migrate_local_sqlite_to_head(engine, str(engine.url)) == HEAD
        async with engine.begin() as connection:
            await connection.execute(text("DROP TABLE semantic_inventory_job_items"))

        with pytest.raises(UnsafeLocalSchemaError, match="不完整.*0021"):
            await migrate_local_sqlite_to_head(engine, str(engine.url))
        assert await _revision(engine) == HEAD
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_packaged_legacy_seed_is_stamped_then_removes_the_injected_demo(tmp_path: Path):
    engine = _engine(tmp_path / "seed.db")
    try:
        connection_id = await _create_packaged_seed(engine)
        assert await migrate_local_sqlite_to_head(engine, str(engine.url)) == HEAD
        assert await _revision(engine) == HEAD
        async with engine.connect() as connection:
            result = await connection.execute(
                text("SELECT COUNT(*) FROM connections WHERE id = :id"),
                {"id": connection_id.replace("-", "")},
            )
            assert result.scalar_one() == 0
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_0012_migrates_legacy_knowledge_and_retires_only_exact_demo_state(
    tmp_path: Path,
):
    engine = _engine(tmp_path / "legacy-settings-0011.db")
    try:
        ids = await _create_versioned_0011_legacy_settings(engine)
        assert await migrate_local_sqlite_to_head(engine, str(engine.url)) == HEAD
        assert await _revision(engine) == HEAD

        def db_id(name: str) -> str:
            return ids[name].replace("-", "")

        async with engine.connect() as connection:
            tables, settings_columns = await connection.run_sync(
                lambda sync: (
                    set(inspect(sync).get_table_names()),
                    {column["name"] for column in inspect(sync).get_columns("app_settings")},
                )
            )
            assert {"semantic_terms", "table_relationships", "prompts"}.isdisjoint(tables)
            assert "demo_initialized" not in settings_columns

            demo_count = await connection.execute(
                text("SELECT COUNT(*) FROM connections WHERE id = :id"),
                {"id": db_id("demo_connection")},
            )
            assert demo_count.scalar_one() == 0
            retained_connections = await connection.execute(
                text("SELECT name, database_name FROM connections ORDER BY name")
            )
            assert retained_connections.all() == [
                (
                    "Customer SQLite",
                    "/Users/example/.querygpt-desktop/customer.db",
                ),
                ("Unmapped Warehouse", "/data/customer.sqlite"),
            ]
            default_connection = await connection.execute(
                text("SELECT default_connection_id FROM app_settings WHERE id = 1")
            )
            assert default_connection.scalar_one() is None

            project_counts = await connection.execute(
                text(
                    "SELECT "
                    "SUM(CASE WHEN id = :user_project THEN 1 ELSE 0 END), "
                    "SUM(CASE WHEN id = :user_demo_only_project THEN 1 ELSE 0 END), "
                    "SUM(CASE WHEN id = :system_demo_project THEN 1 ELSE 0 END) "
                    "FROM projects"
                ),
                {
                    "user_project": db_id("user_project"),
                    "user_demo_only_project": db_id("user_demo_only_project"),
                    "system_demo_project": db_id("system_demo_project"),
                },
            )
            assert project_counts.one() == (1, 1, 0)
            demo_bindings = await connection.execute(
                text(
                    "SELECT COUNT(*) FROM project_data_sources "
                    "WHERE id IN (:user_demo, :user_demo_only, :system_demo)"
                ),
                {
                    "user_demo": db_id("user_demo_source"),
                    "user_demo_only": db_id("user_demo_only_source"),
                    "system_demo": db_id("system_demo_source"),
                },
            )
            assert demo_bindings.scalar_one() == 0
            preflight_counts = await connection.execute(
                text(
                    "SELECT "
                    "SUM(CASE WHEN id = :user_preflight THEN 1 ELSE 0 END), "
                    "SUM(CASE WHEN id = :demo_preflight THEN 1 ELSE 0 END) "
                    "FROM preflight_reports"
                ),
                {
                    "user_preflight": db_id("user_preflight"),
                    "demo_preflight": db_id("demo_preflight"),
                },
            )
            assert preflight_counts.one() == (1, 0)

            source = await connection.execute(
                text(
                    "SELECT source_uri, working_uri, profile_data "
                    "FROM project_data_sources WHERE id = :id"
                ),
                {"id": db_id("user_source")},
            )
            source_uri, working_uri, profile_data = source.one()
            assert source_uri == "/Users/example/.receiptbi-desktop/source.db"
            assert working_uri == "/Users/example/.receiptbi-desktop/work/source.db"
            assert "available_lenses" not in profile_data
            assert "candidate_grain" in profile_data
            snapshot = await connection.execute(
                text("SELECT source_snapshot FROM preflight_reports WHERE id = :id"),
                {"id": db_id("user_preflight")},
            )
            source_snapshot = snapshot.scalar_one()
            assert "available_lenses" not in source_snapshot
            assert "shape" in source_snapshot

            conversation = await connection.execute(
                text("SELECT connection_id, extra_data FROM conversations WHERE id = :id"),
                {"id": db_id("conversation")},
            )
            conversation_connection_id, conversation_extra = conversation.one()
            assert conversation_connection_id is None
            assert "/.receiptbi-desktop/" in conversation_extra
            assert "/.querygpt-desktop/" not in conversation_extra
            message_extra = await connection.execute(
                text("SELECT extra_data FROM messages WHERE id = :id"),
                {"id": db_id("message")},
            )
            assert "/.receiptbi-desktop/" in message_extra.scalar_one()

            imported = await connection.execute(
                text(
                    "SELECT key, entry_type, state, source, is_active, validity, "
                    "execution_state, revision_number, active_revision_id "
                    "FROM semantic_entries WHERE source = 'imported' ORDER BY key"
                )
            )
            imported_rows = imported.all()
            imported_keys = {row[0] for row in imported_rows}
            assert imported_keys == {
                f"legacy_term:{ids['user_term']}",
                f"legacy_term:{ids['orphan_term']}",
                f"legacy_relationship:{ids['relationship']}",
                f"legacy_prompt:{ids['prompt']}",
            }
            assert f"legacy_term:{ids['demo_term']}" not in imported_keys
            assert all(row[2] == "candidate" and row[3] == "imported" for row in imported_rows)
            assert all(row[7] == 1 and row[8] is not None for row in imported_rows)

            archived_prompt = next(
                row for row in imported_rows if row[0] == f"legacy_prompt:{ids['prompt']}"
            )
            assert archived_prompt[1:8] == (
                "business_rule",
                "candidate",
                "imported",
                0,
                "stale",
                "blocked",
                1,
            )
            revision_count = await connection.execute(
                text(
                    "SELECT COUNT(*) FROM semantic_entries AS entry "
                    "JOIN semantic_entry_revisions AS revision "
                    "ON revision.id = entry.active_revision_id "
                    "WHERE entry.source = 'imported' "
                    "AND revision.semantic_entry_id = entry.id "
                    "AND revision.revision_number = 1"
                )
            )
            assert revision_count.scalar_one() == 4
            collision = await connection.execute(
                text("SELECT value, source FROM semantic_entries WHERE id = :id"),
                {"id": db_id("existing_entry")},
            )
            assert collision.one() == ("用户已经确认的定义", "user")
            removed_derived = await connection.execute(
                text(
                    "SELECT "
                    "(SELECT COUNT(*) FROM semantic_entries WHERE id = :entry_id), "
                    "(SELECT COUNT(*) FROM semantic_entry_revisions WHERE id = :revision_id)"
                ),
                {
                    "entry_id": db_id("derived_entry"),
                    "revision_id": db_id("derived_revision"),
                },
            )
            assert removed_derived.one() == (0, 0)
            protected = await connection.execute(
                text(
                    "SELECT state, source, validity, execution_state, is_active, "
                    "revision_number, active_revision_id, evidence "
                    "FROM semantic_entries WHERE id = :id"
                ),
                {"id": db_id("protected_entry")},
            )
            (
                protected_state,
                protected_source,
                protected_validity,
                protected_execution_state,
                protected_active,
                protected_revision_number,
                protected_revision_id,
                protected_evidence,
            ) = protected.one()
            assert (
                protected_state,
                protected_source,
                protected_validity,
                protected_execution_state,
                protected_active,
                protected_revision_number,
            ) == ("confirmed", "user", "stale", "blocked", 1, 2)
            assert protected_revision_id != db_id("protected_revision")
            assert "demo_source_retired" in protected_evidence
            protected_revisions = await connection.execute(
                text(
                    "SELECT revision_number, mutation_kind FROM semantic_entry_revisions "
                    "WHERE semantic_entry_id = :entry_id ORDER BY revision_number"
                ),
                {"entry_id": db_id("protected_entry")},
            )
            assert protected_revisions.all() == [
                (1, "user_confirmed"),
                (2, "demo_source_retired"),
            ]

            migrated_workspaces = await connection.execute(
                text(
                    "SELECT project.id, COUNT(source.id) "
                    "FROM projects AS project "
                    "LEFT JOIN project_data_sources AS source ON source.project_id = project.id "
                    "WHERE project.name = 'Migrated workspace' "
                    "GROUP BY project.id"
                )
            )
            assert sorted(row[1] for row in migrated_workspaces.all()) == [0, 1]
    finally:
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("versioned", [False, True])
async def test_0006_database_preserves_semantic_row_and_backfills_revision(
    tmp_path: Path,
    versioned: bool,
):
    engine = _engine(tmp_path / f"legacy-0006-{versioned}.db")
    try:
        _, entry_id = await _create_unversioned_0006(engine, versioned=versioned)
        assert await migrate_local_sqlite_to_head(engine, str(engine.url)) == HEAD
        assert await _revision(engine) == HEAD
        async with engine.connect() as connection:
            entry = await connection.execute(
                text(
                    "SELECT value, revision_number, active_revision_id "
                    "FROM semantic_entries WHERE id = :id"
                ),
                {"id": entry_id.replace("-", "")},
            )
            value, revision_number, active_revision_id = entry.one()
            assert value == "收入按实付金额"
            assert revision_number == 1
            revision = await connection.execute(
                text(
                    "SELECT mutation_kind, json_extract(snapshot, '$.value') "
                    "FROM semantic_entry_revisions WHERE id = :id"
                ),
                {"id": active_revision_id},
            )
            assert revision.one() == ("migration_backfill", "收入按实付金额")
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_0007_database_preserves_recipe_and_backfills_revision(tmp_path: Path):
    engine = _engine(tmp_path / "legacy-0007.db")
    try:
        _, recipe_id = await _create_versioned_0007_recipe(engine)
        assert await migrate_local_sqlite_to_head(engine, str(engine.url)) == HEAD
        assert await _revision(engine) == HEAD
        async with engine.connect() as connection:
            recipe = await connection.execute(
                text(
                    "SELECT active_revision_id, input_fingerprint, output_fingerprint, "
                    "json_extract(operations, '$[0].operation') "
                    "FROM sanitation_recipes WHERE id = :id"
                ),
                {"id": recipe_id.replace("-", "")},
            )
            active_revision_id, input_fingerprint, output_fingerprint, operation = recipe.one()
            assert input_fingerprint == "a" * 64
            assert output_fingerprint == "b" * 64
            assert operation == "trim_text"
            revision = await connection.execute(
                text(
                    "SELECT revision_number, state, actor_source, "
                    "json_extract(operations, '$[0].column'), "
                    "json_extract(input_contract, '$.fingerprint'), "
                    "json_extract(output_contract, '$.fingerprint') "
                    "FROM sanitation_recipe_revisions WHERE id = :id"
                ),
                {"id": active_revision_id},
            )
            assert revision.one() == (
                1,
                "candidate",
                "system",
                "store_id",
                "a" * 64,
                "b" * 64,
            )
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_0008_database_removes_orphan_recipe_history_before_enforcing_fks(
    tmp_path: Path,
):
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'orphan-0008.db'}"
    # Simulate an older desktop connection which had FK enforcement disabled.
    engine = create_async_engine(database_url)
    try:
        await _create_versioned_0008_orphan_history(engine)
        await engine.dispose()
        configure_sqlite_foreign_keys(engine, database_url)

        assert await migrate_local_sqlite_to_head(engine, str(engine.url)) == HEAD
        assert await _revision(engine) == HEAD
        async with engine.connect() as connection:
            assert (await connection.execute(text("PRAGMA foreign_keys"))).scalar_one() == 1
            remaining = await connection.execute(
                text("SELECT COUNT(*) FROM sanitation_recipe_revisions")
            )
            assert remaining.scalar_one() == 0
    finally:
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("corruption", "message"),
    [
        ("branch", "active revision is not the final revision"),
        ("gap", "revision numbers are not contiguous"),
        ("cycle", "contains a cycle"),
        ("cross_recipe", "crosses recipes"),
    ],
)
async def test_0008_database_rejects_invalid_non_orphan_revision_chains(
    tmp_path: Path,
    corruption: str,
    message: str,
):
    database_url = f"sqlite+aiosqlite:///{tmp_path / f'invalid-{corruption}.db'}"
    engine = create_async_engine(database_url)
    try:
        await _create_versioned_0008_invalid_history(engine, corruption=corruption)
        await engine.dispose()
        configure_sqlite_foreign_keys(engine, database_url)

        with pytest.raises(RuntimeError, match=message):
            await migrate_local_sqlite_to_head(engine, database_url)
        assert await _revision(engine) == "0008_sanitation_recipe_revisions"
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_0009_database_rebuilds_parent_fk_as_deferred_and_preserves_history(
    tmp_path: Path,
):
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'restrict-0009.db'}"
    engine = create_async_engine(database_url)
    try:
        recipe_id = await _create_versioned_0009_restrict_history(engine)
        await engine.dispose()
        configure_sqlite_foreign_keys(engine, database_url)

        assert await migrate_local_sqlite_to_head(engine, database_url) == HEAD
        async with engine.connect() as connection:
            foreign_keys = await connection.run_sync(
                lambda sync: inspect(sync).get_foreign_keys("sanitation_recipe_revisions")
            )
            parent_fk = next(
                item
                for item in foreign_keys
                if item["constrained_columns"] == ["parent_revision_id"]
            )
            assert parent_fk["options"]["deferrable"] is True
            assert parent_fk["options"]["initially"] == "DEFERRED"
            history_count = await connection.execute(
                text("SELECT COUNT(*) FROM sanitation_recipe_revisions")
            )
            assert history_count.scalar_one() == 2

        async with engine.begin() as connection:
            await connection.execute(
                text("DELETE FROM sanitation_recipes WHERE id = :recipe_id"),
                {"recipe_id": recipe_id},
            )
        async with engine.connect() as connection:
            history_count = await connection.execute(
                text("SELECT COUNT(*) FROM sanitation_recipe_revisions")
            )
            assert history_count.scalar_one() == 0
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_partial_0008_schema_fails_closed_at_recorded_0007(tmp_path: Path):
    engine = _engine(tmp_path / "partial-0008.db")
    try:
        await _create_versioned_0007_recipe(engine)
        async with engine.begin() as connection:
            await connection.execute(
                text("ALTER TABLE sanitation_recipes ADD COLUMN active_revision_id CHAR(32)")
            )
        with pytest.raises(UnsafeLocalSchemaError, match="不完整.*0008"):
            await migrate_local_sqlite_to_head(engine, str(engine.url))
        assert await _revision(engine) == "0007_semantic_revisions"
        async with engine.connect() as connection:
            tables = await connection.run_sync(lambda sync: set(inspect(sync).get_table_names()))
        assert "sanitation_recipe_revisions" not in tables
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_partial_mixed_schema_fails_closed_without_stamping(tmp_path: Path):
    engine = _engine(tmp_path / "mixed.db")
    try:
        connection_id = await _create_packaged_seed(engine)
        async with engine.begin() as connection:
            await connection.execute(
                text("CREATE TABLE projects (id CHAR(32) PRIMARY KEY, name VARCHAR(120))")
            )
        with pytest.raises(UnsafeLocalSchemaError, match="不完整"):
            await migrate_local_sqlite_to_head(engine, str(engine.url))
        async with engine.connect() as connection:
            preserved = await connection.execute(
                text("SELECT name FROM connections WHERE id = :id"),
                {"id": connection_id.replace("-", "")},
            )
            assert preserved.scalar_one() == "Sample Database"
            tables = await connection.run_sync(lambda sync: set(inspect(sync).get_table_names()))
        assert "alembic_version" not in tables
        assert "semantic_entries" not in tables
    finally:
        await engine.dispose()
