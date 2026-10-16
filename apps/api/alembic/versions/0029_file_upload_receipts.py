"""Retain committed file-upload identities independently from source lifetime."""

import sqlalchemy as sa

from alembic import op

revision = "0029_file_upload_receipts"
down_revision = "0028_report_copy_receipts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "file_upload_receipts",
        sa.Column(
            "project_id",
            sa.Uuid(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("request_id", sa.Uuid(), primary_key=True),
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )


def downgrade() -> None:
    op.drop_table("file_upload_receipts")
