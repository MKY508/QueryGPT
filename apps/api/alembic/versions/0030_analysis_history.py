"""Add the portable analysis-history search projection and ordering index.

Revision ID: 0030_analysis_history
Revises: 0029_file_upload_receipts
"""

import sqlalchemy as sa

from alembic import op
from app.core.analysis_history_keys import analysis_search_text

revision = "0030_analysis_history"
down_revision = "0029_file_upload_receipts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "analysis_runs",
        sa.Column("history_search_text", sa.Text(), nullable=False, server_default=""),
    )
    bind = op.get_bind()
    runs = sa.table(
        "analysis_runs",
        sa.column("id"),
        sa.column("query"),
        sa.column("report", sa.JSON()),
        sa.column("history_search_text"),
    )
    last_id = None
    while True:
        # Extract only business strings, never checkpoints or full report bodies.
        query = (
            sa.select(
                runs.c.id,
                runs.c.query,
                runs.c.report["title"].label("title"),
                runs.c.report["summary"].label("summary"),
            )
            .order_by(runs.c.id)
            .limit(250)
        )
        if last_id is not None:
            query = query.where(runs.c.id > last_id)
        rows = bind.execute(query).mappings().all()
        if not rows:
            break
        bind.execute(
            runs.update()
            .where(runs.c.id == sa.bindparam("run_id"))
            .values(history_search_text=sa.bindparam("search_value")),
            [
                {"run_id": row["id"], "search_value": analysis_search_text(row["query"], dict(row))}
                for row in rows
            ],
        )
        last_id = rows[-1]["id"]
    op.create_index(
        "ix_analysis_history_updated",
        "analysis_runs",
        ["project_id", "updated_at", "created_at", "id"],
    )


def downgrade() -> None:
    op.drop_index("ix_analysis_history_updated", table_name="analysis_runs")
    op.drop_column("analysis_runs", "history_search_text")
