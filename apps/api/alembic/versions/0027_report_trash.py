"""Preserve deleted report documents and their saved versions."""

import sqlalchemy as sa

from alembic import op

revision = "0027_report_trash"
down_revision = "0026_report_revisions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("report_documents", sa.Column("deleted_at", sa.DateTime(timezone=True)))
    op.create_index("ix_report_trash", "report_documents", ["project_id", "deleted_at", "id"])


def downgrade() -> None:
    op.drop_index("ix_report_trash", table_name="report_documents")
    op.drop_column("report_documents", "deleted_at")
