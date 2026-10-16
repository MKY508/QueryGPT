"""Add bounded, transactional report-save replay receipts.

Revision ID: 0025_report_save_receipts
Revises: 0024_sqlite_uuid_text
"""

import sqlalchemy as sa

from alembic import op

revision = "0025_report_save_receipts"
down_revision = "0024_sqlite_uuid_text"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "report_save_receipts",
        sa.Column("request_id", sa.String(36), primary_key=True),
        sa.Column(
            "report_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("report_documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("result_version", sa.Integer(), nullable=False),
        sa.Column("snapshot", sa.LargeBinary(), nullable=False),
    )
    op.create_index(
        "ix_report_save_receipts_version", "report_save_receipts", ["report_id", "result_version"]
    )


def downgrade() -> None:
    op.drop_table("report_save_receipts")
