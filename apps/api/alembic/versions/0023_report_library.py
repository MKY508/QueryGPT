"""Add portable report search keys and project/date pagination indexes.

Revision ID: 0023_report_library
Revises: 0022_retire_legacy_user_scope
"""

import sqlalchemy as sa

from alembic import op
from app.core.report_library_keys import report_name_key, report_search_text

revision = "0023_report_library"
down_revision = "0022_retire_legacy_user_scope"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "report_documents", sa.Column("search_text", sa.Text(), nullable=False, server_default="")
    )
    op.add_column(
        "report_documents", sa.Column("name_key", sa.Text(), nullable=False, server_default="")
    )
    # Keyset batches keep the upgrade bounded without touching content, versions
    # or timestamps. No ORM listeners / onupdate defaults run during the backfill.
    bind = op.get_bind()
    reports = sa.table(
        "report_documents",
        sa.column("id"),
        sa.column("title"),
        sa.column("description"),
        sa.column("search_text"),
        sa.column("name_key"),
    )
    last_id = None
    while True:
        query = (
            sa.select(reports.c.id, reports.c.title, reports.c.description)
            .order_by(reports.c.id)
            .limit(500)
        )
        if last_id is not None:
            query = query.where(reports.c.id > last_id)
        rows = bind.execute(query).all()
        if not rows:
            break
        bind.execute(
            reports.update()
            .where(reports.c.id == sa.bindparam("report_id"))
            .values(search_text=sa.bindparam("search_value"), name_key=sa.bindparam("name_value")),
            [
                {
                    "report_id": row.id,
                    "search_value": report_search_text(row.title, row.description),
                    "name_value": report_name_key(row.title),
                }
                for row in rows
            ],
        )
        last_id = rows[-1].id
    for field in ("updated", "created"):
        op.create_index(
            f"ix_report_library_{field}", "report_documents", ["project_id", f"{field}_at", "id"]
        )


def downgrade() -> None:
    for field in ("updated", "created"):
        op.drop_index(f"ix_report_library_{field}", table_name="report_documents")
    op.drop_column("report_documents", "name_key")
    op.drop_column("report_documents", "search_text")
