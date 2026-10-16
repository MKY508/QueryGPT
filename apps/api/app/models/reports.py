"""Editable report API contracts."""

from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ReportStatus = Literal["draft", "published", "archived"]
ReportSourceKind = Literal["manual", "analysis_run", "artifact"]
ReportBlockType = Literal["metric", "chart", "table", "text", "evidence", "filter"]


class _ReportModel(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)


class ReportBlockCreate(_ReportModel):
    block_type: ReportBlockType
    title: str | None = Field(default=None, max_length=200)
    order_index: int = Field(default=0, ge=0)
    source_kind: ReportSourceKind
    analysis_run_id: UUID | None = None
    artifact_id: UUID | None = None
    content: dict[str, Any] = Field(default_factory=dict)
    layout: dict[str, Any] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_source_reference(self) -> "ReportBlockCreate":
        if self.source_kind == "manual" and (
            self.analysis_run_id is not None or self.artifact_id is not None
        ):
            raise ValueError("人工区块不能冒充调查或产物来源")
        if self.source_kind == "analysis_run":
            if self.analysis_run_id is None:
                raise ValueError("调查区块必须引用 analysis_run_id")
            if self.artifact_id is not None:
                raise ValueError("调查区块不能同时声明 artifact_id")
        if self.source_kind == "artifact" and self.artifact_id is None:
            raise ValueError("产物区块必须引用 artifact_id")
        return self


class ReportBlockSync(_ReportModel):
    id: UUID | None = None
    # A new block may inherit trusted provenance from this same report's
    # saved block. This is a request-only reference, never stored as identity.
    copy_source_block_id: UUID | None = None
    block_type: ReportBlockType
    title: str | None = Field(default=None, max_length=200)
    order_index: int = Field(default=0, ge=0)
    source_kind: ReportSourceKind
    analysis_run_id: UUID | None = None
    artifact_id: UUID | None = None
    # Read-only provenance returned by the server. It is accepted so a client
    # can round-trip a detached source, but the API always preserves/rebuilds
    # the trusted database value instead of accepting client changes.
    source_ref: dict[str, Any] = Field(default_factory=dict)
    content: dict[str, Any] = Field(default_factory=dict)
    layout: dict[str, Any] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_source_reference(self) -> "ReportBlockSync":
        if self.source_kind == "manual" and (
            self.analysis_run_id is not None or self.artifact_id is not None
        ):
            raise ValueError("人工区块不能冒充调查或产物来源")
        if self.source_kind == "analysis_run" and self.artifact_id is not None:
            raise ValueError("调查区块不能同时声明 artifact_id")
        if self.id is not None and self.copy_source_block_id is not None:
            raise ValueError("已有区块不能同时声明复制来源")
        if self.id is None and self.copy_source_block_id is None:
            if self.source_kind == "analysis_run" and self.analysis_run_id is None:
                raise ValueError("新调查区块必须引用 analysis_run_id")
            if self.source_kind == "artifact" and self.artifact_id is None:
                raise ValueError("新产物区块必须引用 artifact_id")
        return self


class ReportBlockUpdate(_ReportModel):
    expected_version: int = Field(ge=1)
    block_type: ReportBlockType | None = None
    title: str | None = Field(default=None, max_length=200)
    order_index: int | None = Field(default=None, ge=0)
    source_kind: ReportSourceKind | None = None
    analysis_run_id: UUID | None = None
    artifact_id: UUID | None = None
    content: dict[str, Any] | None = None
    layout: dict[str, Any] | None = None
    config: dict[str, Any] | None = None

    @model_validator(mode="after")
    def reject_null_required_fields(self) -> "ReportBlockUpdate":
        for field_name in (
            "block_type",
            "order_index",
            "source_kind",
            "content",
            "layout",
            "config",
        ):
            if field_name in self.model_fields_set and getattr(self, field_name) is None:
                raise ValueError(f"{field_name} 不能设为空")
        return self


class ReportBlockRefreshRequest(_ReportModel):
    expected_version: int = Field(ge=1)
    source_plan: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")


class ReportPageRefreshRequest(_ReportModel):
    expected_version: int = Field(ge=1)
    source_plan: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")


class ReportRefreshSourceLabel(_ReportModel):
    source_id: UUID
    name: str
    kind: Literal["file", "connection"]
    data_version: int | None = Field(default=None, ge=1)


class ReportRefreshReceipt(_ReportModel):
    version: Literal[1] = 1
    refreshed_at: datetime
    source: ReportRefreshSourceLabel
    source_catalog_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    content_hash: str = Field(pattern=r"^[0-9a-f]{64}$")


class ReportRefreshPlanBlock(_ReportModel):
    block_id: UUID
    title: str
    previous_source: ReportRefreshSourceLabel | None = None
    refreshed_at: datetime | None = None
    next_source: ReportRefreshSourceLabel


class ReportRefreshPlanResponse(_ReportModel):
    project_id: UUID
    report_id: UUID
    page_id: UUID
    block_id: UUID | None = None
    expected_version: int
    source_plan: str
    blocks: list[ReportRefreshPlanBlock]


class ReportBlockRefreshBinding(_ReportModel):
    """Server-owned contract for deterministic report block refreshes."""

    version: Literal[1] = 1
    kind: Literal["analysis_playbook"] = "analysis_playbook"
    playbook_id: str = Field(pattern=r"^pb_[0-9a-f]{20}$")
    playbook_shape_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    result_name: str = Field(pattern=r"^result_[1-9][0-9]*$")
    value_column: str | None = Field(
        default=None, min_length=1, max_length=1000, exclude_if=lambda value: value is None
    )

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ReportPageCreate(_ReportModel):
    title: str = Field(default="概览", min_length=1, max_length=160)
    order_index: int = Field(default=0, ge=0)
    config: dict[str, Any] = Field(default_factory=dict)
    blocks: list[ReportBlockCreate] = Field(default_factory=list)


class ReportPageSync(_ReportModel):
    id: UUID | None = None
    title: str = Field(default="概览", min_length=1, max_length=160)
    order_index: int = Field(default=0, ge=0)
    config: dict[str, Any] = Field(default_factory=dict)
    blocks: list[ReportBlockSync] = Field(default_factory=list)


class ReportPageUpdate(_ReportModel):
    expected_version: int = Field(ge=1)
    title: str | None = Field(default=None, min_length=1, max_length=160)
    order_index: int | None = Field(default=None, ge=0)
    config: dict[str, Any] | None = None

    @model_validator(mode="after")
    def reject_null_required_fields(self) -> "ReportPageUpdate":
        for field_name in ("title", "order_index", "config"):
            if field_name in self.model_fields_set and getattr(self, field_name) is None:
                raise ValueError(f"{field_name} 不能设为空")
        return self


class ReportCreate(_ReportModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    status: ReportStatus = "draft"
    extra_data: dict[str, Any] = Field(default_factory=dict)
    pages: list[ReportPageCreate] = Field(default_factory=list)


class ReportUpdate(_ReportModel):
    expected_version: int = Field(ge=1)
    save_request_id: UUID | None = None
    # A retry may execute only if this base is still current, or replay a receipt.
    retry_save: bool = False
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    status: ReportStatus | None = None
    extra_data: dict[str, Any] | None = None
    # When present, pages are the complete desired document tree. Existing
    # pages/blocks omitted from this list are removed from the editable report
    # only; referenced immutable analysis artifacts are never changed.
    pages: list[ReportPageSync] | None = None

    @model_validator(mode="after")
    def reject_null_required_fields(self) -> "ReportUpdate":
        for field_name in ("title", "status", "extra_data", "pages"):
            if field_name in self.model_fields_set and getattr(self, field_name) is None:
                raise ValueError(f"{field_name} 不能设为空")
        return self


class ReportBlockResponse(_ReportModel):
    id: UUID
    block_type: ReportBlockType
    title: str | None
    order_index: int
    source_kind: ReportSourceKind
    analysis_run_id: UUID | None
    artifact_id: UUID | None
    source_ref: dict[str, Any]
    source_available: bool
    content: dict[str, Any]
    layout: dict[str, Any]
    config: dict[str, Any]
    version: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ReportPageResponse(_ReportModel):
    id: UUID
    title: str
    order_index: int
    config: dict[str, Any]
    version: int
    blocks: list[ReportBlockResponse]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class _ReportDeletionResponse(_ReportModel):
    deleted_at: datetime | None = None

    @field_validator("deleted_at")
    @classmethod
    def explicit_deletion_timezone(cls, value: datetime | None) -> datetime | None:
        # SQLite strips timezone information from a UTC DateTime column.
        return value.replace(tzinfo=UTC) if value is not None and value.tzinfo is None else value


class ReportDocumentResponse(_ReportDeletionResponse):
    id: UUID
    project_id: UUID
    title: str
    description: str | None
    status: ReportStatus
    version: int
    extra_data: dict[str, Any]
    pages: list[ReportPageResponse]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ReportSummaryResponse(_ReportDeletionResponse):
    id: UUID
    project_id: UUID
    title: str
    description: str | None
    status: ReportStatus
    version: int
    page_count: int
    block_count: int
    created_at: datetime
    updated_at: datetime


class ReportLibraryResponse(_ReportModel):
    items: list[ReportSummaryResponse]
    total: int
    count: int
    page: int
    page_size: int
    page_count: int


class ReportDeleteResponse(_ReportModel):
    id: UUID
    deleted: bool = True
