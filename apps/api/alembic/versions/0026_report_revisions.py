"""Retain immutable saved report versions without inventing old history.

Revision ID: 0026_report_revisions
Revises: 0025_report_save_receipts
"""

import sqlalchemy as sa

from alembic import op

revision = "0026_report_revisions"
down_revision = "0025_report_save_receipts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "report_revisions",
        sa.Column(
            "report_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("report_documents.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("version", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("saved_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reason", sa.String(32), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=False),
        sa.Column("block_count", sa.Integer(), nullable=False),
        sa.Column("snapshot", sa.LargeBinary(), nullable=False),
        sa.Column("snapshot_hash", sa.String(64), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("report_revisions")
