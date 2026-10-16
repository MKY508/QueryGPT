"""Use text-affinity storage for SQLite UUID identities and references.

Revision ID: 0024_sqlite_uuid_text
Revises: 0023_report_library
"""

import sqlalchemy as sa

from alembic import op

revision = "0024_sqlite_uuid_text"
down_revision = "0023_report_library"
branch_labels = None
depends_on = None

# Frozen at this revision, including logical UUID references without FK
# constraints. Do not derive a historical migration from future ORM metadata.
UUID_COLUMNS = {
    "analysis_corrections": ("project_id", "analysis_run_id", "semantic_entry_id", "id"),
    "analysis_runs": ("project_id", "conversation_id", "id"),
    "app_settings": ("default_model_id", "default_connection_id"),
    "artifacts": ("project_id", "analysis_run_id", "id"),
    "connections": ("id",),
    "conversations": ("connection_id", "model_id", "id"),
    "messages": ("conversation_id", "id"),
    "models": ("id",),
    "preflight_reports": ("project_id", "data_source_id", "id"),
    "project_data_sources": ("project_id", "connection_id", "id"),
    "projects": ("id",),
    "report_blocks": ("page_id", "analysis_run_id", "artifact_id", "id"),
    "report_documents": ("project_id", "id"),
    "report_pages": ("report_id", "id"),
    "sanitation_recipe_revisions": ("recipe_id", "parent_revision_id", "id"),
    "sanitation_recipes": ("project_id", "data_source_id", "active_revision_id", "id"),
    "semantic_entries": (
        "project_id",
        "scope_id",
        "active_revision_id",
        "recommendation_batch_id",
        "id",
    ),
    "semantic_entry_revisions": (
        "project_id",
        "semantic_entry_id",
        "parent_revision_id",
        "restored_from_revision_id",
        "id",
    ),
    "semantic_inventory_job_items": ("job_id", "recommendation_batch_id", "id"),
    "semantic_inventory_jobs": ("project_id", "source_id", "model_id", "id"),
    "semantic_scope_nodes": ("project_id", "parent_id", "id"),
    "semantic_validation_job_items": ("job_id", "semantic_entry_id", "semantic_revision_id", "id"),
    "semantic_validation_jobs": ("project_id", "id"),
}


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "sqlite":
        # SQLAlchemy Uuid keeps PostgreSQL's native UUID representation.
        return
    if bind.exec_driver_sql("PRAGMA foreign_keys").scalar_one():
        raise RuntimeError("UUID migration requires the maintained SQLite migration transaction")
    inspector = sa.inspect(bind)
    changes = {}
    for table, names in UUID_COLUMNS.items():
        columns = {column["name"]: column for column in inspector.get_columns(table)}
        if not set(names) <= columns.keys():
            raise RuntimeError(f"Incomplete UUID schema: {table}")
        for name in names:
            # Inspect raw storage without ORM numeric/UUID conversion. A numeric
            # value may already have lost digits; casting it cannot restore it.
            invalid = f'"{name}" IS NOT NULL AND (typeof("{name}") != \'text\' OR length("{name}") != 32 OR "{name}" GLOB \'*[^0-9a-f]*\')'
            if not columns[name]["nullable"]:
                invalid = f'"{name}" IS NULL OR ({invalid})'
            if bind.exec_driver_sql(f'SELECT 1 FROM "{table}" WHERE {invalid} LIMIT 1').first():
                raise RuntimeError(
                    f"Unsafe stored UUID in {table}.{name}; restore from a verified backup before upgrading"
                )
        changes[table] = {
            name: columns[name]
            for name in names
            if not isinstance(columns[name]["type"], sa.String)
        }

    # Complete preflight before recreating any table. Custom triggers/views or
    # unreflectable indexes must not disappear silently in a batch recreation.
    for table, columns in changes.items():
        if not columns:
            continue
        if bind.execute(
            sa.text("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND tbl_name=:table LIMIT 1"),
            {"table": table},
        ).first():
            raise RuntimeError(f"Custom trigger on {table}; UUID migration requires manual review")
        if inspector.get_view_names():
            raise RuntimeError("Custom SQLite views require manual review before UUID migration")
        reflected_indexes = {index["name"] for index in inspector.get_indexes(table)}
        actual_indexes = set(
            bind.execute(
                sa.text(
                    "SELECT name FROM sqlite_schema WHERE type='index' AND tbl_name=:table AND sql IS NOT NULL"
                ),
                {"table": table},
            ).scalars()
        )
        if actual_indexes - reflected_indexes:
            raise RuntimeError(
                f"Unreflectable index on {table}; UUID migration requires manual review"
            )
    if bind.exec_driver_sql("PRAGMA foreign_key_check").first():
        raise RuntimeError("Invalid existing associations; UUID migration was not applied")

    for table, columns in changes.items():
        if not columns:
            continue
        # Alembic reflects named constraints and indexes. Preserve unnamed CHECK
        # constraints explicitly, as documented by its SQLite batch workflow.
        unnamed_checks = [
            sa.CheckConstraint(check["sqltext"])
            for check in inspector.get_check_constraints(table)
            if not check.get("name")
        ]
        with op.batch_alter_table(table, recreate="always", table_args=unnamed_checks) as batch:
            for name, column in columns.items():
                batch.alter_column(
                    name,
                    type_=sa.Uuid(as_uuid=True),
                    existing_type=column["type"],
                    existing_nullable=column["nullable"],
                )
    if bind.exec_driver_sql("PRAGMA foreign_key_check").first():
        raise RuntimeError("Invalid associations after UUID migration; transaction must roll back")


def downgrade() -> None:
    raise RuntimeError(
        "Restoring SQLite numeric-affinity UUID columns could lose identities; downgrade is unsupported"
    )
