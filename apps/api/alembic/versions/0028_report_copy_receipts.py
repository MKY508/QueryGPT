"""Keep report-copy request identities independent from copied report lifetime."""

import sqlalchemy as sa

from alembic import op

revision = "0028_report_copy_receipts"
down_revision = "0027_report_trash"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "report_copy_receipts",
        sa.Column(
            "project_id",
            sa.Uuid(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("request_id", sa.Uuid(), primary_key=True),
        sa.Column("source_report_id", sa.Uuid(), nullable=False),
        sa.Column("source_version", sa.Integer(), nullable=False),
        sa.Column("target_report_id", sa.Uuid(), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )


def downgrade() -> None:
    op.drop_table("report_copy_receipts")
