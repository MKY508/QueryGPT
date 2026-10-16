"""Review and explicitly publish one saved cleaning method."""

from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.workspace import SourceCleaningSnapshot


class RecipeReplayRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision_id: UUID | None = None


class RecipeReplayApplyRequest(RecipeReplayRequest):
    proof: str = Field(pattern=r"^[0-9a-f]{64}$")


class RecipeReplayPreview(BaseModel):
    source_id: UUID
    recipe_id: UUID
    revision_id: UUID
    revision_number: int
    proof: str
    before: SourceCleaningSnapshot | None
    after: SourceCleaningSnapshot
    input_changed: bool
    pending_replacement: bool
    added_columns: list[str]
    removed_columns: list[str]
    type_changes: list[dict[str, str]]
    unresolved_questions: int
    issues: list[dict[str, Any]]
    can_apply: bool
