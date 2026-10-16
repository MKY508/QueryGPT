"""数据库表定义"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    event,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.analysis_history_keys import analysis_search_text
from app.core.report_library_keys import report_name_key, report_search_text
from app.db.base import Base, TimestampMixin, UUIDMixin


class Connection(Base, UUIDMixin, TimestampMixin):
    """数据库连接表"""

    __tablename__ = "connections"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    driver: Mapped[str] = mapped_column(String(20), nullable=False)  # mysql, postgresql, sqlite
    host: Mapped[str | None] = mapped_column(String(255))
    port: Mapped[int | None] = mapped_column(Integer)
    username: Mapped[str | None] = mapped_column(String(100))
    password_encrypted: Mapped[str | None] = mapped_column(Text)
    database_name: Mapped[str | None] = mapped_column(String(100))
    extra_options: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)


class Model(Base, UUIDMixin, TimestampMixin):
    """模型配置表"""

    __tablename__ = "models"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    model_id: Mapped[str] = mapped_column(String(100), nullable=False)
    base_url: Mapped[str | None] = mapped_column(String(500))
    api_key_encrypted: Mapped[str | None] = mapped_column(Text)
    extra_options: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Credential presence and provider health are deliberately separate.  The
    # encrypted value may exist while being unreadable or rejected upstream;
    # health is evidence from a real completion request, not a storage flag.
    health_status: Mapped[str] = mapped_column(
        String(20), default="unknown", server_default="unknown"
    )
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error_category: Mapped[str | None] = mapped_column(String(30))
    last_response_time_ms: Mapped[int | None] = mapped_column(Integer)


class Conversation(Base, UUIDMixin, TimestampMixin):
    """对话表"""

    __tablename__ = "conversations"

    connection_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("connections.id", ondelete="SET NULL")
    )
    model_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("models.id", ondelete="SET NULL")
    )
    title: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    extra_data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan", order_by="Message.created_at"
    )


class Message(Base, UUIDMixin):
    """消息表"""

    __tablename__ = "messages"

    conversation_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    extra_data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
    )

    conversation: Mapped["Conversation"] = relationship(back_populates="messages")


class AppSettings(Base, TimestampMixin):
    """单工作区设置表"""

    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    default_model_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("models.id", ondelete="SET NULL")
    )
    default_connection_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("connections.id", ondelete="SET NULL")
    )
    context_rounds: Mapped[int] = mapped_column(Integer, default=5)
    python_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    diagnostics_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    auto_repair_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    preprocessing_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    self_analysis_enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class Project(Base, UUIDMixin, TimestampMixin):
    """An isolated business analysis workspace."""

    __tablename__ = "projects"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)
    extra_data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    data_sources: Mapped[list["ProjectDataSource"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    semantic_entries: Mapped[list["SemanticEntry"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    semantic_scope_nodes: Mapped[list["SemanticScopeNode"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    semantic_revisions: Mapped[list["SemanticEntryRevision"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    semantic_validation_jobs: Mapped[list["SemanticValidationJob"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    semantic_inventory_jobs: Mapped[list["SemanticInventoryJob"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    reports: Mapped[list["ReportDocument"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


class ProjectDataSource(Base, UUIDMixin, TimestampMixin):
    """A file or database connection attached to a project."""

    __tablename__ = "project_data_sources"

    project_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    connection_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("connections.id", ondelete="SET NULL")
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    format: Mapped[str | None] = mapped_column(String(30))
    source_uri: Mapped[str | None] = mapped_column(Text)
    working_uri: Mapped[str | None] = mapped_column(Text)
    fingerprint: Mapped[str | None] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(30), default="attached")
    profile_data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    project: Mapped["Project"] = relationship(back_populates="data_sources")
    connection: Mapped["Connection | None"] = relationship()
    semantic_inventory_jobs: Mapped[list["SemanticInventoryJob"]] = relationship(
        back_populates="source", cascade="all, delete-orphan"
    )


class PreflightReportRecord(Base, UUIDMixin, TimestampMixin):
    """Stored, human-readable data readiness report."""

    __tablename__ = "preflight_reports"

    project_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    data_source_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("project_data_sources.id", ondelete="CASCADE"),
        index=True,
    )
    status: Mapped[str] = mapped_column(String(30), default="ready")
    summary: Mapped[str] = mapped_column(Text, default="")
    issues: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    ambiguities: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    inferred_schema: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    source_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    fingerprint: Mapped[str | None] = mapped_column(String(64))


class SanitationRecipeRecord(Base, UUIDMixin, TimestampMixin):
    """Reversible data-cleaning operations for one source."""

    __tablename__ = "sanitation_recipes"

    project_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    data_source_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("project_data_sources.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="applied")
    operations: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    input_fingerprint: Mapped[str | None] = mapped_column(String(64))
    output_fingerprint: Mapped[str | None] = mapped_column(String(64))
    # Application-enforced pointer: keeping this FK-free avoids a circular DDL
    # dependency while revision rows remain append-only.
    active_revision_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), index=True)


class SanitationRecipeRevisionRecord(Base, UUIDMixin):
    """Immutable cleaning history for a materialized sanitation recipe head."""

    __tablename__ = "sanitation_recipe_revisions"
    __table_args__ = (
        UniqueConstraint(
            "recipe_id",
            "revision_number",
            name="uq_sanitation_recipe_revision_number",
        ),
        CheckConstraint(
            "state IN ('candidate', 'confirmed', 'reverted')",
            name="ck_sanitation_recipe_revision_state",
        ),
    )

    recipe_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("sanitation_recipes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    revision_number: Mapped[int] = mapped_column(Integer, nullable=False)
    parent_revision_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey(
            "sanitation_recipe_revisions.id",
            name="fk_sanitation_recipe_revisions_parent_revision_id",
            ondelete="NO ACTION",
            deferrable=True,
            initially="DEFERRED",
        ),
        index=True,
    )
    state: Mapped[str] = mapped_column(String(20), nullable=False)
    operations: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    input_contract: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    output_contract: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    actor_source: Mapped[str] = mapped_column(String(30), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    # Stored as durable provenance rather than an FK: deleting a correction must
    # not rewrite immutable cleaning history.
    source_correction_id: Mapped[str | None] = mapped_column(String(36), index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        index=True,
    )


class SemanticScopeNode(Base, UUIDMixin, TimestampMixin):
    """One direct node in the governed project -> source -> table hierarchy."""

    __tablename__ = "semantic_scope_nodes"
    __table_args__ = (
        UniqueConstraint(
            "project_id",
            "stable_key",
            name="uq_semantic_scope_project_stable_key",
        ),
        CheckConstraint(
            "kind IN ('project', 'source', 'table', 'context', 'period')",
            name="ck_semantic_scope_kind",
        ),
        CheckConstraint(
            "(kind = 'project' AND parent_id IS NULL) OR "
            "(kind != 'project' AND parent_id IS NOT NULL)",
            name="ck_semantic_scope_parent_shape",
        ),
        CheckConstraint(
            "kind != 'table' OR (source_logical_name IS NOT NULL AND table_or_view IS NOT NULL)",
            name="ck_semantic_scope_table_binding",
        ),
    )

    project_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    parent_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("semantic_scope_nodes.id", ondelete="CASCADE"),
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    stable_key: Mapped[str] = mapped_column(String(255), nullable=False)
    business_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    source_logical_name: Mapped[str | None] = mapped_column(String(255))
    table_or_view: Mapped[str | None] = mapped_column(String(255))
    context_facts: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)

    project: Mapped["Project"] = relationship(back_populates="semantic_scope_nodes")
    parent: Mapped["SemanticScopeNode | None"] = relationship(
        remote_side="SemanticScopeNode.id",
        back_populates="children",
    )
    children: Mapped[list["SemanticScopeNode"]] = relationship(
        back_populates="parent",
        cascade="all, delete-orphan",
    )
    semantic_entries: Mapped[list["SemanticEntry"]] = relationship(back_populates="scope")


class SemanticEntry(Base, UUIDMixin, TimestampMixin):
    """Three-level project knowledge: candidate, confirmed or locked."""

    __tablename__ = "semantic_entries"
    __table_args__ = (UniqueConstraint("project_id", "key", name="uq_semantic_entry_project_key"),)

    project_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    scope_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("semantic_scope_nodes.id", ondelete="SET NULL"),
        index=True,
    )
    key: Mapped[str] = mapped_column(String(160), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    entry_type: Mapped[str] = mapped_column(String(30), default="business_rule")
    state: Mapped[str] = mapped_column(String(20), default="candidate", index=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.5)
    definition: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    validity: Mapped[str] = mapped_column(String(20), default="active")
    execution_state: Mapped[str] = mapped_column(String(30), default="definition_only")
    execution_details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    evidence: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    source: Mapped[str] = mapped_column(String(30), default="inferred")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    revision_number: Mapped[int] = mapped_column(Integer, default=0)
    # Kept as an application-enforced pointer to avoid a circular DDL dependency.
    # Semantic revisions are immutable, so a successfully written pointer cannot dangle
    # unless the whole project is removed.
    active_revision_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), index=True)
    recommendation_batch_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), index=True)

    project: Mapped["Project"] = relationship(back_populates="semantic_entries")
    scope: Mapped["SemanticScopeNode | None"] = relationship(back_populates="semantic_entries")


class SemanticEntryRevision(Base, UUIDMixin):
    """Immutable semantic history; SemanticEntry remains the materialized read head."""

    __tablename__ = "semantic_entry_revisions"
    __table_args__ = (
        UniqueConstraint(
            "semantic_entry_id",
            "revision_number",
            name="uq_semantic_revision_entry_number",
        ),
    )

    project_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    semantic_entry_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("semantic_entries.id", ondelete="RESTRICT"),
        index=True,
    )
    revision_number: Mapped[int] = mapped_column(Integer, nullable=False)
    parent_revision_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("semantic_entry_revisions.id", ondelete="RESTRICT"),
        index=True,
    )
    restored_from_revision_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("semantic_entry_revisions.id", ondelete="RESTRICT"),
        index=True,
    )
    mutation_kind: Mapped[str] = mapped_column(String(40), nullable=False)
    actor_source: Mapped[str] = mapped_column(String(30), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    source_correction_id: Mapped[str | None] = mapped_column(String(36), index=True)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        index=True,
    )

    project: Mapped["Project"] = relationship(back_populates="semantic_revisions")


class SemanticValidationJob(Base, UUIDMixin, TimestampMixin):
    """Durable, model-free validation of exact semantic revision heads."""

    __tablename__ = "semantic_validation_jobs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('queued', 'running', 'completed', 'failed')",
            name="ck_semantic_validation_job_status",
        ),
    )

    project_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    requested_by: Mapped[str] = mapped_column(String(30), default="user")
    reason: Mapped[str | None] = mapped_column(Text)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    project: Mapped["Project"] = relationship(back_populates="semantic_validation_jobs")
    items: Mapped[list["SemanticValidationJobItem"]] = relationship(
        back_populates="job",
        cascade="all, delete-orphan",
        order_by="SemanticValidationJobItem.created_at",
    )


class SemanticValidationJobItem(Base, UUIDMixin, TimestampMixin):
    """One immutable validation target plus its terminal machine-readable result."""

    __tablename__ = "semantic_validation_job_items"
    __table_args__ = (
        UniqueConstraint(
            "job_id",
            "semantic_entry_id",
            name="uq_semantic_validation_job_entry",
        ),
        CheckConstraint(
            "status IN ('queued', 'running', 'verified', 'blocked', 'failed')",
            name="ck_semantic_validation_item_status",
        ),
    )

    job_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("semantic_validation_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    semantic_entry_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("semantic_entries.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    semantic_revision_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("semantic_entry_revisions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    definition_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    code: Mapped[str | None] = mapped_column(String(80))
    facts: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    job: Mapped["SemanticValidationJob"] = relationship(back_populates="items")


class SemanticInventoryJob(Base, UUIDMixin, TimestampMixin):
    """Durable user-requested profiling and semantic recommendation work."""

    __tablename__ = "semantic_inventory_jobs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('queued', 'running', 'completed', "
            "'completed_with_errors', 'cancelled', 'failed')",
            name="ck_semantic_inventory_job_status",
        ),
        CheckConstraint(
            "depth IN ('structure', 'sampled')",
            name="ck_semantic_inventory_job_depth",
        ),
        CheckConstraint(
            "locale IN ('zh', 'en')",
            name="ck_semantic_inventory_job_locale",
        ),
    )

    project_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("project_data_sources.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    status: Mapped[str] = mapped_column(String(30), default="queued", index=True)
    depth: Mapped[str] = mapped_column(String(20), nullable=False)
    locale: Mapped[str] = mapped_column(String(5), nullable=False)
    model_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("models.id", ondelete="SET NULL"), index=True
    )
    tables: Mapped[list[str]] = mapped_column(JSON, default=list)
    relation_index_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    selection_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    lease_owner: Mapped[str | None] = mapped_column(String(160))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    project: Mapped["Project"] = relationship(back_populates="semantic_inventory_jobs")
    source: Mapped["ProjectDataSource"] = relationship(back_populates="semantic_inventory_jobs")
    model: Mapped["Model | None"] = relationship()
    items: Mapped[list["SemanticInventoryJobItem"]] = relationship(
        back_populates="job",
        cascade="all, delete-orphan",
        order_by="SemanticInventoryJobItem.ordinal",
    )


class SemanticInventoryJobItem(Base, UUIDMixin, TimestampMixin):
    """One independently retryable table in a semantic inventory job."""

    __tablename__ = "semantic_inventory_job_items"
    __table_args__ = (
        UniqueConstraint(
            "job_id",
            "table_name",
            name="uq_semantic_inventory_job_table",
        ),
        CheckConstraint(
            "status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')",
            name="ck_semantic_inventory_item_status",
        ),
        CheckConstraint(
            "phase IN ('structure', 'sample', 'recommend', 'complete')",
            name="ck_semantic_inventory_item_phase",
        ),
        CheckConstraint(
            "ordinal >= 0",
            name="ck_semantic_inventory_item_ordinal",
        ),
        CheckConstraint(
            "attempt_count >= 0",
            name="ck_semantic_inventory_item_attempt_count",
        ),
        CheckConstraint(
            "candidate_count >= 0",
            name="ck_semantic_inventory_item_candidate_count",
        ),
    )

    job_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("semantic_inventory_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    table_name: Mapped[str] = mapped_column(String(512), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    phase: Mapped[str] = mapped_column(String(20), default="structure")
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    retryable: Mapped[bool] = mapped_column(Boolean, default=True)
    code: Mapped[str | None] = mapped_column(String(80))
    message: Mapped[str | None] = mapped_column(Text)
    profile_result: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    recommendation_batch_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), index=True)
    candidate_count: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    job: Mapped["SemanticInventoryJob"] = relationship(back_populates="items")


class AnalysisCorrection(Base, UUIDMixin, TimestampMixin):
    """A user correction tied to one report, optionally promoted to project knowledge."""

    __tablename__ = "analysis_corrections"
    __table_args__ = (
        UniqueConstraint(
            "project_id",
            "analysis_run_id",
            "fingerprint",
            name="uq_analysis_correction_run_fingerprint",
        ),
    )

    project_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    analysis_run_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("analysis_runs.id", ondelete="CASCADE"), index=True
    )
    semantic_entry_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("semantic_entries.id", ondelete="SET NULL"), index=True
    )
    target_key: Mapped[str | None] = mapped_column(String(160), index=True)
    target_ref: Mapped[str | None] = mapped_column(String(96), index=True)
    correction_type: Mapped[str] = mapped_column(String(30), default="business_rule")
    text: Mapped[str] = mapped_column(Text, nullable=False)
    scope: Mapped[str] = mapped_column(String(20), default="run")
    state: Mapped[str] = mapped_column(String(20), default="recorded", index=True)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    evidence: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)


class AnalysisRun(Base, UUIDMixin, TimestampMixin):
    """Persisted state for an autonomous analysis investigation."""

    __tablename__ = "analysis_runs"
    __table_args__ = (
        Index("ix_analysis_history_updated", "project_id", "updated_at", "created_at", "id"),
    )

    project_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    conversation_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("conversations.id", ondelete="SET NULL")
    )
    query: Mapped[str] = mapped_column(Text, nullable=False)
    state: Mapped[str] = mapped_column(String(30), default="understanding", index=True)
    stage: Mapped[str] = mapped_column(String(30), default="understanding")
    report: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    history_search_text: Mapped[str] = mapped_column(Text, default="", server_default="")
    checkpoint: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text)


@event.listens_for(AnalysisRun, "before_insert")
@event.listens_for(AnalysisRun, "before_update")
def _analysis_history_keys(_mapper, _connection, run: AnalysisRun) -> None:
    run.history_search_text = analysis_search_text(run.query, run.report)


class ArtifactRecord(Base, UUIDMixin, TimestampMixin):
    """Business artifact with technical evidence kept separately."""

    __tablename__ = "artifacts"

    project_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    analysis_run_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("analysis_runs.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    technical_details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class ReportDocument(Base, UUIDMixin, TimestampMixin):
    """An editable report assembled from manual and immutable analysis sources."""

    __tablename__ = "report_documents"
    __table_args__ = (
        CheckConstraint(
            "status IN ('draft', 'published', 'archived')",
            name="ck_report_document_status",
        ),
        Index("ix_report_library_updated", "project_id", "updated_at", "id"),
        Index("ix_report_library_created", "project_id", "created_at", "id"),
        Index("ix_report_trash", "project_id", "deleted_at", "id"),
    )

    project_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    search_text: Mapped[str] = mapped_column(Text, default="", server_default="")
    name_key: Mapped[str] = mapped_column(Text, default="", server_default="")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    extra_data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    project: Mapped["Project"] = relationship(back_populates="reports")
    pages: Mapped[list["ReportPage"]] = relationship(
        back_populates="report",
        cascade="all, delete-orphan",
        order_by="ReportPage.order_index",
    )


@event.listens_for(ReportDocument, "before_insert")
@event.listens_for(ReportDocument, "before_update")
def _update_report_library_keys(_mapper, _connection, report: ReportDocument) -> None:
    # All current title/description writes use ORM flush. Bulk metadata writes
    # must supply these derived keys too; version-only CAS does not change them.
    report.search_text = report_search_text(report.title, report.description)
    report.name_key = report_name_key(report.title)


class FileUploadReceipt(Base):
    """One committed upload intent, retained after the imported source is removed."""

    __tablename__ = "file_upload_receipts"
    project_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
    )
    request_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    source_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ReportCopyReceipt(Base):
    """Creation identity survives source/target purge; retries never create again."""

    __tablename__ = "report_copy_receipts"
    project_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
    )
    request_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    source_report_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    source_version: Mapped[int] = mapped_column(Integer, nullable=False)
    target_report_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ReportRevision(Base):
    """Immutable saved report versions, independent from short-lived save retries."""

    __tablename__ = "report_revisions"
    report_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("report_documents.id", ondelete="CASCADE"), primary_key=True
    )
    version: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    reason: Mapped[str] = mapped_column(String(32), nullable=False)
    page_count: Mapped[int] = mapped_column(Integer, nullable=False)
    block_count: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    snapshot_hash: Mapped[str] = mapped_column(String(64), nullable=False)


class ReportSaveReceipt(Base):
    """Bounded replay responses, committed atomically with a report save."""

    __tablename__ = "report_save_receipts"
    __table_args__ = (Index("ix_report_save_receipts_version", "report_id", "result_version"),)

    request_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    report_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("report_documents.id", ondelete="CASCADE")
    )
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    result_version: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)


class ReportPage(Base, UUIDMixin, TimestampMixin):
    """One ordered page inside an editable report document."""

    __tablename__ = "report_pages"

    report_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("report_documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, default=0, index=True)
    config: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)

    report: Mapped["ReportDocument"] = relationship(back_populates="pages")
    blocks: Mapped[list["ReportBlock"]] = relationship(
        back_populates="page",
        cascade="all, delete-orphan",
        order_by="ReportBlock.order_index",
    )


class ReportBlock(Base, UUIDMixin, TimestampMixin):
    """Editable report content whose original analysis records remain untouched."""

    __tablename__ = "report_blocks"
    __table_args__ = (
        CheckConstraint(
            "source_kind IN ('manual', 'analysis_run', 'artifact')",
            name="ck_report_block_source_kind",
        ),
    )

    page_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("report_pages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    block_type: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str | None] = mapped_column(String(200))
    order_index: Mapped[int] = mapped_column(Integer, default=0, index=True)
    source_kind: Mapped[str] = mapped_column(String(20), nullable=False)
    analysis_run_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("analysis_runs.id", ondelete="SET NULL"),
        index=True,
    )
    artifact_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("artifacts.id", ondelete="SET NULL"),
        index=True,
    )
    # Durable provenance and source payload snapshot. The nullable FKs above
    # are only live links; this value survives normal investigation cleanup.
    source_ref: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    content: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    layout: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    config: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)

    page: Mapped["ReportPage"] = relationship(back_populates="blocks")
    analysis_run: Mapped["AnalysisRun | None"] = relationship()
    artifact: Mapped["ArtifactRecord | None"] = relationship()

    @property
    def source_available(self) -> bool:
        if self.source_kind == "manual":
            return True
        if self.source_kind == "analysis_run":
            return self.analysis_run_id is not None
        return self.artifact_id is not None
