"""Explicit, preview-bound replacement of one project's current file version."""

from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.workspace import (
    CsvSelectionRequest,
    SourceCleaningSnapshot,
    WorkbookSelectionRequest,
)


class SourceReplacementPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candidate_source_id: UUID
    selection: WorkbookSelectionRequest | CsvSelectionRequest | None = None


class SourceReplacementApplyRequest(SourceReplacementPreviewRequest):
    proof: str = Field(pattern=r"^[0-9a-f]{64}$")


class SourceReplacementPreviewResponse(BaseModel):
    source_id: UUID
    candidate_source_id: UUID
    proof: str
    before: SourceCleaningSnapshot
    after: SourceCleaningSnapshot
    input_rows: int = Field(ge=0)
    added_columns: list[str]
    removed_columns: list[str]
    type_changes: list[dict[str, str]]
    issues: list[dict[str, Any]]
    unresolved_questions: int = Field(ge=0)
    can_apply: bool
