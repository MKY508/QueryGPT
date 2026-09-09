"""Public contracts for the zero-config analyst workspace."""

import math
from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, Discriminator, Field, StringConstraints, Tag, model_validator

from app.models.analysis_state import AnalysisState

KnowledgeState = Literal["candidate", "confirmed", "locked"]
RelationshipValidity = Literal["active", "unverified", "stale"]
SemanticEntryAction = Literal["ignore", "queue_validation", "remember", "restore", "attest"]
SemanticExecutionState = Literal[
    "definition_only",
    "needs_validation",
    "verified",
    "blocked",
]
SemanticSourceScope = Literal[
    "project",
    "local_database",
    "remote_database",
    "csv",
    "excel",
    "parquet",
    "json",
    "other_file",
    "cross_source",
    "unresolved",
]
SemanticScopeKind = Literal["project", "source", "table", "context", "period"]
SanitationRevisionState = Literal["candidate", "confirmed", "reverted"]

SemanticSynonym = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=120),
]


class RelationshipEndpoint(BaseModel):
    source_logical_name: str = Field(..., min_length=1, max_length=255)
    source_kind: Literal["file", "connection"]
    table_or_view: str = Field(..., min_length=1, max_length=255)
    column: str = Field(..., min_length=1, max_length=255)
    data_type: str = Field(default="unknown", max_length=120)
    schema_signature: str = Field(..., min_length=64, max_length=64)

    model_config = {"extra": "forbid"}


class RelationshipDefinition(BaseModel):
    kind: Literal["relationship"] = Field(default="relationship", exclude=True)
    version: Literal[1] = 1
    left: RelationshipEndpoint
    right: RelationshipEndpoint
    normalization: Literal["exact", "trim_casefold", "identifier", "auto"] = "auto"
    cardinality: Literal["one_to_one", "one_to_many", "many_to_one", "many_to_many"] | None = None
    default_join: Literal["left", "inner"] = "left"
    minimum_left_match_rate: float = Field(default=0.8, ge=0, le=1)
    maximum_expansion_ratio: float = Field(default=1.2, ge=1)
    business_name: str | None = Field(
        default=None,
        min_length=1,
        max_length=160,
    )
    description: str | None = Field(
        default=None,
        min_length=1,
        max_length=1000,
    )
    synonyms: list[SemanticSynonym] = Field(
        default_factory=list,
        max_length=20,
    )
    example_questions: list[str] = Field(
        default_factory=list,
        max_length=5,
    )

    model_config = {"extra": "forbid"}


class BusinessRuleValueFilterAction(BaseModel):
    kind: Literal["value_filter"]
    column: str = Field(..., min_length=1, max_length=255)
    operator: Literal["include", "exclude"]
    values: list[str] = Field(..., min_length=1, max_length=1000)
    observed_values: list[str] = Field(..., min_length=1, max_length=1000)

    model_config = {"extra": "forbid"}


class BusinessRuleIdentityAction(BaseModel):
    kind: Literal["identity"]
    column: str = Field(..., min_length=1, max_length=255)
    observed_values: list[str] = Field(default_factory=list, max_length=1000)

    model_config = {"extra": "forbid"}


class BusinessRuleMetricColumnAction(BaseModel):
    kind: Literal["metric_column"]
    column: str = Field(..., min_length=1, max_length=255)

    model_config = {"extra": "forbid"}


class BusinessRuleMetricFormulaAction(BaseModel):
    """A declarative metric formula; the recursive expression is data, never code."""

    kind: Literal["metric_formula"]
    output_column: str = Field(..., min_length=1, max_length=128)
    expression: dict[str, Any]
    evaluation_order: Literal["row_then_aggregate"]
    null_policy: Literal["propagate", "zero", "error"]
    divide_by_zero: Literal["error", "null"]

    @model_validator(mode="after")
    def validate_formula_contract(self):
        # Imported lazily so the public model module does not participate in the
        # services package's execution-runtime import cycle.
        from app.services.metric_formula import validate_metric_formula_action

        validate_metric_formula_action(self.model_dump(mode="python"))
        return self

    model_config = {"extra": "forbid"}


class BusinessRuleSourceBinding(BaseModel):
    """Stable logical source/field scope for a compiled business rule.

    A project source UUID identifies one physical attachment and changes when a
    monthly file replaces the previous one.  Business knowledge therefore binds
    to the source's maintained logical role and schema instead.
    """

    source_logical_name: str = Field(..., min_length=1, max_length=255)
    source_kind: Literal["file", "connection"]
    table_or_view: str = Field(..., min_length=1, max_length=255)
    action_column: str = Field(..., min_length=1, max_length=255)
    canonical_type: Literal["boolean", "number", "datetime", "text"]
    schema_signature: str = Field(..., pattern=r"^[0-9a-f]{64}$")

    model_config = {"extra": "forbid"}


class AggregateMetricDefinition(BaseModel):
    """A schema-bound aggregate that was observed in a verified final result."""

    version: Literal[1] = 1
    kind: Literal["aggregate_metric"]
    operation: Literal["sum", "avg"]
    source: BusinessRuleSourceBinding
    null_policy: Literal["ignore"] = "ignore"
    business_name: str | None = Field(
        default=None,
        min_length=1,
        max_length=160,
        exclude_if=lambda value: value is None,
    )
    description: str | None = Field(
        default=None,
        min_length=1,
        max_length=1000,
        exclude_if=lambda value: value is None,
    )
    synonyms: list[SemanticSynonym] = Field(
        default_factory=list,
        max_length=20,
        exclude_if=lambda value: not value,
    )
    example_questions: list[str] = Field(
        default_factory=list,
        max_length=5,
        exclude_if=lambda value: not value,
    )

    model_config = {"extra": "forbid"}


class DimensionDefinition(BaseModel):
    """A schema-bound grouping field with business-facing presentation."""

    version: Literal[1] = 1
    kind: Literal["dimension"]
    role: Literal["time", "category", "identifier"]
    source: BusinessRuleSourceBinding
    business_name: str = Field(..., min_length=1, max_length=160)
    description: str | None = Field(
        default=None,
        min_length=1,
        max_length=1000,
        exclude_if=lambda value: value is None,
    )
    synonyms: list[SemanticSynonym] = Field(
        default_factory=list,
        max_length=20,
        exclude_if=lambda value: not value,
    )
    example_questions: list[str] = Field(
        default_factory=list,
        max_length=5,
        exclude_if=lambda value: not value,
    )
    time_granularities: list[Literal["year", "quarter", "month", "week", "day"]] = Field(
        default_factory=list, max_length=5
    )
    timezone: str | None = Field(default=None, min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_time_presentation(self):
        if self.role != "time" and (self.time_granularities or self.timezone):
            raise ValueError("time_granularities and timezone require a time dimension")
        return self

    model_config = {"extra": "forbid"}


class DerivedMetricDefinition(BaseModel):
    """A bounded row formula followed by one deterministic aggregate."""

    version: Literal[1] = 1
    kind: Literal["derived_metric"]
    aggregate: Literal["sum", "avg"]
    formula: BusinessRuleMetricFormulaAction
    sources: list[BusinessRuleSourceBinding] = Field(..., min_length=1, max_length=8)
    business_name: str = Field(..., min_length=1, max_length=160)
    description: str | None = Field(
        default=None,
        min_length=1,
        max_length=1000,
        exclude_if=lambda value: value is None,
    )
    synonyms: list[SemanticSynonym] = Field(
        default_factory=list,
        max_length=20,
        exclude_if=lambda value: not value,
    )
    example_questions: list[str] = Field(
        default_factory=list,
        max_length=5,
        exclude_if=lambda value: not value,
    )

    @model_validator(mode="after")
    def validate_formula_bindings(self):
        from app.services.metric_formula import metric_formula_columns

        referenced = set(metric_formula_columns(self.formula.model_dump(mode="python")))
        bound_columns = [binding.action_column for binding in self.sources]
        if len(bound_columns) != len(set(bound_columns)) or set(bound_columns) != referenced:
            raise ValueError("derived metric bindings must exactly match formula columns")
        if any(binding.canonical_type != "number" for binding in self.sources):
            raise ValueError("derived metric bindings must be numeric")
        physical_scopes = {
            (
                binding.source_logical_name,
                binding.source_kind,
                binding.table_or_view,
                binding.schema_signature,
            )
            for binding in self.sources
        }
        if len(physical_scopes) != 1:
            raise ValueError("derived metric bindings must share one source and table")
        return self

    model_config = {"extra": "forbid"}


class ScopePresentationDefinition(BaseModel):
    """Governed display metadata for one physical source or table scope.

    This mirrors the label/synonym split used by mature semantic layers: the
    stable source/table binding remains machine-owned while business-facing
    names can be reviewed, versioned, and localized independently.
    """

    version: Literal[1] = 1
    kind: Literal["scope_presentation"]
    scope_kind: Literal["source", "table"]
    source_logical_name: str = Field(..., min_length=1, max_length=255)
    source_kind: Literal["file", "connection"]
    table_or_view: str | None = Field(default=None, min_length=1, max_length=255)
    business_name: str = Field(..., min_length=1, max_length=160)
    description: str | None = Field(default=None, min_length=1, max_length=1000)
    synonyms: list[SemanticSynonym] = Field(default_factory=list, max_length=20)
    example_questions: list[str] = Field(default_factory=list, max_length=5)

    @model_validator(mode="after")
    def validate_scope_binding(self):
        if self.scope_kind == "table" and not self.table_or_view:
            raise ValueError("table scope presentation requires table_or_view")
        if self.scope_kind == "source" and self.table_or_view is not None:
            raise ValueError("source scope presentation cannot bind a table")
        return self

    model_config = {"extra": "forbid"}


BusinessRuleStrategyAction = Annotated[
    BusinessRuleValueFilterAction
    | BusinessRuleIdentityAction
    | BusinessRuleMetricColumnAction
    | BusinessRuleMetricFormulaAction,
    Field(discriminator="kind"),
]


class BusinessRuleStrategyDefinition(BaseModel):
    version: Literal[1] = 1
    kind: Literal["business_rule_strategy"]
    rule_key: str = Field(..., min_length=1, max_length=160)
    selected_option: str = Field(..., min_length=1, max_length=1000)
    action: BusinessRuleStrategyAction
    applies_to: BusinessRuleSourceBinding | list[BusinessRuleSourceBinding] | None = Field(
        default=None,
        exclude_if=lambda value: value is None,
    )

    @model_validator(mode="after")
    def validate_source_binding_shape(self):
        if isinstance(self.action, BusinessRuleMetricFormulaAction):
            from app.services.metric_formula import metric_formula_columns

            if not isinstance(self.applies_to, list):
                raise ValueError("metric_formula requires one stable binding per source column")
            referenced = set(metric_formula_columns(self.action.model_dump(mode="python")))
            bound = [binding.action_column for binding in self.applies_to]
            if len(bound) != len(set(bound)) or set(bound) != referenced:
                raise ValueError("metric_formula bindings must exactly match referenced columns")
        elif isinstance(self.applies_to, list):
            raise ValueError("non-formula strategies accept only one stable source binding")
        return self

    model_config = {"extra": "forbid"}


SemanticEntryType = Literal[
    "metric",
    "dimension",
    "relationship",
    "scope_presentation",
    "business_rule",
    "cleaning_rule",
    "verified_query",
]
SemanticDefinitionVariant = Literal[
    "relationship",
    "aggregate_metric",
    "derived_metric",
    "dimension",
    "scope_presentation",
    "business_rule_strategy",
    "raw",
]


def semantic_definition_variant(value: Any) -> SemanticDefinitionVariant:
    """Classify executable contracts while leaving namespaced custom objects raw.

    The three recognized variants are reserved execution contracts and therefore
    receive strict validation.  Other JSON objects remain legal project metadata.
    An untagged object containing a relationship endpoint is treated as an
    attempted relationship so an incomplete executable contract cannot silently
    fall back to custom metadata.  Custom objects that use ``left`` or ``right``
    can opt out explicitly with their own non-reserved ``kind``.
    """

    if isinstance(value, dict):
        kind = value.get("kind")
        if kind == "aggregate_metric":
            return "aggregate_metric"
        if kind == "derived_metric":
            return "derived_metric"
        if kind == "dimension":
            return "dimension"
        if kind == "scope_presentation":
            return "scope_presentation"
        if kind == "business_rule_strategy":
            return "business_rule_strategy"
        if kind == "relationship" or (kind is None and ("left" in value or "right" in value)):
            return "relationship"
        return "raw"
    if isinstance(value, BusinessRuleStrategyDefinition):
        return "business_rule_strategy"
    if isinstance(value, AggregateMetricDefinition):
        return "aggregate_metric"
    if isinstance(value, DerivedMetricDefinition):
        return "derived_metric"
    if isinstance(value, DimensionDefinition):
        return "dimension"
    if isinstance(value, ScopePresentationDefinition):
        return "scope_presentation"
    if isinstance(value, RelationshipDefinition):
        return "relationship"
    return "raw"


_SEMANTIC_DEFINITION_ENTRY_TYPES: dict[SemanticDefinitionVariant, SemanticEntryType] = {
    "relationship": "relationship",
    "aggregate_metric": "metric",
    "derived_metric": "metric",
    "dimension": "dimension",
    "scope_presentation": "scope_presentation",
    "business_rule_strategy": "business_rule",
}
_SEMANTIC_DEFINITION_COMPATIBILITY_ERRORS: dict[SemanticDefinitionVariant, str] = {
    "relationship": "数据关联定义只能用于数据关联类型",
    "aggregate_metric": "聚合指标定义只能用于指标类型",
    "derived_metric": "派生指标定义只能用于指标类型",
    "dimension": "维度定义只能用于维度类型",
    "scope_presentation": "数据范围名称只能用于范围说明类型",
    "business_rule_strategy": "业务规则执行定义只能用于业务口径类型",
}


def validate_semantic_definition_compatibility(
    entry_type: SemanticEntryType,
    definition: Any,
) -> None:
    """Reject a known executable contract attached to the wrong semantic type.

    Raw/custom JSON is intentionally accepted for every semantic type.  It is
    stored as descriptive project understanding and is never considered an
    executable contract by :func:`is_executable_semantic_definition`.
    """

    if definition is None:
        return
    variant = semantic_definition_variant(definition)
    expected_entry_type = _SEMANTIC_DEFINITION_ENTRY_TYPES.get(variant)
    if expected_entry_type is not None and entry_type != expected_entry_type:
        raise ValueError(_SEMANTIC_DEFINITION_COMPATIBILITY_ERRORS[variant])


def is_executable_semantic_definition(definition: Any) -> bool:
    return semantic_definition_variant(definition) in {
        "relationship",
        "aggregate_metric",
        "derived_metric",
        "dimension",
        "business_rule_strategy",
    }


SemanticDefinition = Annotated[
    Annotated[RelationshipDefinition, Tag("relationship")]
    | Annotated[BusinessRuleStrategyDefinition, Tag("business_rule_strategy")]
    | Annotated[AggregateMetricDefinition, Tag("aggregate_metric")]
    | Annotated[DerivedMetricDefinition, Tag("derived_metric")]
    | Annotated[DimensionDefinition, Tag("dimension")]
    | Annotated[ScopePresentationDefinition, Tag("scope_presentation")]
    | Annotated[dict[str, Any], Tag("raw")],
    Discriminator(semantic_definition_variant),
]


ProjectName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=120),
]


class ProjectCreate(BaseModel):
    name: ProjectName
    description: str | None = None


class ProjectUpdate(BaseModel):
    name: ProjectName


class SuggestedQuestionsRequest(BaseModel):
    model_id: UUID | None = None
    locale: Literal["zh", "en"] = "zh"


class SuggestedQuestion(BaseModel):
    label: str = Field(..., min_length=4, max_length=80)
    prompt: str = Field(..., min_length=6, max_length=300)
    reason: str = Field(..., min_length=4, max_length=120)


class SuggestedQuestionsResponse(BaseModel):
    items: list[SuggestedQuestion] = Field(default_factory=list, max_length=3)
    generated_by: Literal["ai", "preflight"]
    context_signature: str


class ProjectResponse(BaseModel):
    id: UUID
    name: str
    description: str | None = None
    status: str = "active"
    extra_data: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ConnectionSourceCreate(BaseModel):
    connection_id: UUID
    name: str | None = Field(default=None, max_length=255)


class DataSourceResponse(BaseModel):
    id: UUID
    project_id: UUID
    connection_id: UUID | None = None
    kind: Literal["file", "connection"]
    name: str
    format: str | None = None
    status: str
    fingerprint: str | None = None
    profile_data: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RelationIndexRelation(BaseModel):
    """One selectable table or view discovered from database metadata only."""

    name: str = Field(..., min_length=1)
    schema: str | None = None
    kind: str = Field(..., min_length=1)
    comment: str | None = None


class RelationIndexSnapshot(BaseModel):
    relations: list[RelationIndexRelation] = Field(default_factory=list, max_length=512)
    relations_loaded: int = Field(..., ge=0, le=512)
    relations_total: int | None = Field(default=None, ge=0)
    relations_total_at_least: int = Field(..., ge=0)
    complete: bool
    truncated: bool
    unread_relations_at_least: int = Field(..., ge=0)


class RelationIndexRefreshResponse(BaseModel):
    source_id: UUID
    relation_index: RelationIndexSnapshot
    semantic_scope_table_count: int = Field(..., ge=0)


class PreflightIssue(BaseModel):
    code: str
    title: str
    detail: str
    severity: Literal["info", "warning", "critical"] = "info"
    automatic: bool = True
    count: int | None = None
    presentation_code: str | None = Field(default=None, exclude_if=lambda value: value is None)
    presentation_facts: dict[str, str | int] = Field(default_factory=dict, exclude_if=lambda value: not value)


class PreflightAmbiguity(BaseModel):
    key: str
    question: str
    reason: str
    options: list[str] = Field(default_factory=list)
    presentation_code: str | None = Field(
        default=None,
        exclude_if=lambda value: value is None,
    )
    presentation_facts: dict[str, str] = Field(
        default_factory=dict,
        exclude_if=lambda value: not value,
    )
    option_codes: dict[str, str] = Field(
        default_factory=dict,
        exclude_if=lambda value: not value,
    )


class PreflightReportResponse(BaseModel):
    id: UUID
    project_id: UUID
    data_source_id: UUID
    status: str
    summary: str
    issues: list[PreflightIssue] = Field(default_factory=list)
    ambiguities: list[PreflightAmbiguity] = Field(default_factory=list)
    inferred_schema: dict[str, Any] = Field(default_factory=dict)
    source_snapshot: dict[str, Any] = Field(default_factory=dict)
    fingerprint: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SanitationRecipeResponse(BaseModel):
    id: UUID
    project_id: UUID
    data_source_id: UUID
    name: str
    status: str
    operations: list[dict[str, Any]] = Field(default_factory=list)
    input_fingerprint: str | None = None
    output_fingerprint: str | None = None
    active_revision_id: UUID | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SanitationRecipeRevisionAppendRequest(BaseModel):
    """Append a cleaning revision only when the caller still owns the current head."""

    expected_active_revision_id: UUID
    state: SanitationRevisionState = "confirmed"
    operations: list[dict[str, Any]] = Field(default_factory=list)
    input_contract: dict[str, Any] = Field(default_factory=dict)
    output_contract: dict[str, Any] = Field(default_factory=dict)
    reason: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def normalize_reason(self):
        if self.reason is not None:
            self.reason = self.reason.strip() or None
        return self


class SanitationRecipeRevisionResponse(BaseModel):
    id: UUID
    recipe_id: UUID
    revision_number: int
    parent_revision_id: UUID | None = None
    state: SanitationRevisionState
    operations: list[dict[str, Any]] = Field(default_factory=list)
    input_contract: dict[str, Any] = Field(default_factory=dict)
    output_contract: dict[str, Any] = Field(default_factory=dict)
    actor_source: str
    reason: str | None = None
    source_correction_id: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class SanitationRecipeRevisionRestoreRequest(BaseModel):
    expected_active_revision_id: UUID
    reason: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def normalize_reason(self):
        if self.reason is not None:
            self.reason = self.reason.strip() or None
        return self


class SanitationTemplateSummaryResponse(BaseModel):
    """One imported cleaning method that is not yet attached to a data source."""

    id: UUID
    name: str
    active_revision_id: UUID
    revision_count: int = Field(..., ge=1)
    compatible_source_ids: list[UUID] = Field(default_factory=list)


class SanitationTemplatePreviewRequest(BaseModel):
    source_id: UUID


class SanitationTemplateShape(BaseModel):
    rows: int = Field(..., ge=0)
    columns: int = Field(..., ge=0)


class SanitationTemplatePreviewResponse(BaseModel):
    """Non-persistent proof of what an imported method would change."""

    template_id: UUID
    template_name: str
    template_active_revision_id: UUID
    template_operations_hash: str = Field(..., min_length=64, max_length=64)
    source_id: UUID
    source_fingerprint: str = Field(..., min_length=64, max_length=64)
    preview_output_fingerprint: str = Field(..., min_length=64, max_length=64)
    current_working_fingerprint: str | None = Field(default=None, min_length=64, max_length=64)
    current_recipe_active_revision_id: UUID | None = None
    before: SanitationTemplateShape
    after: SanitationTemplateShape
    summary: str
    issues: list[PreflightIssue] = Field(default_factory=list)
    can_apply: bool


class SanitationTemplateBindRequest(BaseModel):
    source_id: UUID
    expected_template_active_revision_id: UUID
    expected_template_operations_hash: str = Field(..., min_length=64, max_length=64)
    expected_source_fingerprint: str = Field(..., min_length=64, max_length=64)
    expected_preview_output_fingerprint: str = Field(..., min_length=64, max_length=64)
    expected_current_working_fingerprint: str | None = Field(
        ...,
        min_length=64,
        max_length=64,
    )
    expected_current_recipe_active_revision_id: UUID | None


class SanitationTemplateBindResponse(BaseModel):
    recipe: SanitationRecipeResponse
    revision: SanitationRecipeRevisionResponse
    preflight: PreflightReportResponse


class SourceCleaningPreviewRequest(BaseModel):
    """A bounded set of user-selected operations for a non-persistent trial run."""

    operations: list[dict[str, Any]] = Field(..., max_length=100)

    model_config = {"extra": "forbid"}


class SourceCleaningSnapshot(BaseModel):
    rows: int = Field(..., ge=0)
    columns: int = Field(..., ge=0)
    sample: list[dict[str, Any]] = Field(default_factory=list, max_length=8)


class SourceCleaningColumnChange(BaseModel):
    column: str = Field(..., min_length=1, max_length=10_000)
    changed_count: int = Field(..., ge=0)


class SourceCleaningPreviewResponse(BaseModel):
    """Proof that can be replayed verbatim before switching the working copy."""

    source_id: UUID
    operations_hash: str = Field(..., min_length=64, max_length=64)
    source_fingerprint: str = Field(..., min_length=64, max_length=64)
    preview_output_fingerprint: str = Field(..., min_length=64, max_length=64)
    current_working_fingerprint: str | None = Field(default=None, min_length=64, max_length=64)
    current_recipe_active_revision_id: UUID | None = None
    before: SourceCleaningSnapshot
    after: SourceCleaningSnapshot
    changes: list[SourceCleaningColumnChange] = Field(default_factory=list, max_length=100_000)
    can_apply: bool


class SourceCleaningApplyRequest(BaseModel):
    operations: list[dict[str, Any]] = Field(..., max_length=100)
    expected_operations_hash: str = Field(..., min_length=64, max_length=64)
    expected_source_fingerprint: str = Field(..., min_length=64, max_length=64)
    expected_preview_output_fingerprint: str = Field(..., min_length=64, max_length=64)
    expected_current_working_fingerprint: str | None = Field(..., min_length=64, max_length=64)
    expected_current_recipe_active_revision_id: UUID | None

    model_config = {"extra": "forbid"}


class SourceCleaningApplyResponse(BaseModel):
    recipe: SanitationRecipeResponse
    revision: SanitationRecipeRevisionResponse
    preflight: PreflightReportResponse


class SemanticEntryCreate(BaseModel):
    scope_id: UUID | None = None
    key: str = Field(..., min_length=1, max_length=160)
    value: str = Field(..., min_length=1)
    entry_type: SemanticEntryType = "business_rule"
    state: KnowledgeState = "candidate"
    confidence: float = Field(default=0.5, ge=0, le=1)
    definition: SemanticDefinition | None = None
    validity: RelationshipValidity = "active"
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    source: Literal["inferred", "user", "verified_analysis", "imported"] = "inferred"

    @model_validator(mode="after")
    def validate_definition_matches_entry_type(self):
        validate_semantic_definition_compatibility(self.entry_type, self.definition)
        return self


class SemanticEntryUpdate(BaseModel):
    expected_active_revision_id: UUID | None = None
    scope_id: UUID | None = None
    key: str | None = Field(default=None, min_length=1, max_length=160)
    value: str | None = Field(default=None, min_length=1)
    entry_type: SemanticEntryType | None = None
    state: KnowledgeState | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    definition: SemanticDefinition | None = None
    validity: RelationshipValidity | None = None
    evidence: list[dict[str, Any]] | None = None
    source: Literal["inferred", "user", "verified_analysis", "imported"] | None = None

    @model_validator(mode="after")
    def reject_empty_updates(self):
        required_when_present = {
            "key",
            "value",
            "entry_type",
            "state",
            "confidence",
            "validity",
            "evidence",
            "source",
        }
        for field_name in required_when_present & self.model_fields_set:
            if getattr(self, field_name) is None:
                raise ValueError(f"{field_name} cannot be null")
        if self.value is not None:
            self.value = self.value.strip()
            if not self.value:
                raise ValueError("value cannot be blank")
        if self.key is not None:
            self.key = self.key.strip()
            if not self.key:
                raise ValueError("key cannot be blank")
        if self.entry_type is not None and self.definition is not None:
            validate_semantic_definition_compatibility(self.entry_type, self.definition)
        return self


class SemanticSourceRef(BaseModel):
    source_id: UUID
    logical_name: str
    name: str
    kind: Literal["file", "connection"]
    format: str | None = None


class SemanticScopePathItem(BaseModel):
    id: UUID
    kind: SemanticScopeKind
    stable_key: str
    business_name: str
    source_logical_name: str | None = None
    table_or_view: str | None = None

    model_config = {"from_attributes": True}


class SemanticScopeNodeResponse(BaseModel):
    id: UUID
    project_id: UUID
    parent_id: UUID | None = None
    kind: SemanticScopeKind
    stable_key: str
    business_name: str
    description: str | None = None
    synonyms: list[str] = Field(default_factory=list, max_length=20)
    source_logical_name: str | None = None
    table_or_view: str | None = None
    context_facts: dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True
    direct_entry_count: int = Field(default=0, ge=0)
    child_count: int = Field(default=0, ge=0)
    path: list[SemanticScopePathItem] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SemanticEntryResponse(SemanticEntryCreate):
    id: UUID
    project_id: UUID
    is_active: bool = True
    revision_number: int = 0
    active_revision_id: UUID | None = None
    execution_state: SemanticExecutionState = "definition_only"
    execution_details: dict[str, Any] = Field(default_factory=dict)
    allowed_actions: list[SemanticEntryAction] = Field(default_factory=list)
    source_refs: list[SemanticSourceRef] = Field(default_factory=list)
    source_scope: SemanticSourceScope = "project"
    scope_path: list[SemanticScopePathItem] = Field(default_factory=list)
    recommendation_batch_id: UUID | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SemanticEntryPageResponse(BaseModel):
    """Stable server-side page for large project-understanding workspaces."""

    items: list[SemanticEntryResponse]
    total: int = Field(..., ge=0)
    offset: int = Field(..., ge=0)
    limit: int = Field(..., ge=1, le=100)
    has_more: bool
    next_offset: int | None = Field(default=None, ge=0)


class SemanticEntrySummaryResponse(BaseModel):
    active_total: int = Field(..., ge=0)
    pending_total: int = Field(..., ge=0)
    relationship_total: int = Field(..., ge=0)
    confirmed_total: int = Field(..., ge=0)
    locked_total: int = Field(..., ge=0)


class SemanticEntryBatchItem(BaseModel):
    entry_id: UUID
    expected_active_revision_id: UUID

    model_config = {"extra": "forbid"}


class SemanticEntryBatchRequest(BaseModel):
    action: SemanticEntryAction
    items: list[SemanticEntryBatchItem] = Field(..., min_length=1, max_length=100)
    reason: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def normalize_and_validate_batch(self):
        entry_ids = [item.entry_id for item in self.items]
        if len(entry_ids) != len(set(entry_ids)):
            raise ValueError("batch items must reference unique entries")
        if self.reason is not None:
            self.reason = self.reason.strip() or None
        return self

    model_config = {"extra": "forbid"}


class SemanticEntryBatchResponse(BaseModel):
    action: SemanticEntryAction
    items: list[SemanticEntryResponse]
    queued_entry_ids: list[UUID] = Field(default_factory=list)
    validation_job_id: UUID | None = None
    validation_status: Literal["queued", "running", "completed", "failed"] | None = None


class SemanticRecommendationScope(BaseModel):
    source_id: UUID
    tables: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def normalize_tables(self):
        normalized = [table.strip() for table in self.tables if table.strip()]
        if len(normalized) != len(set(table.casefold() for table in normalized)):
            raise ValueError("scope tables must be unique")
        self.tables = normalized
        return self

    model_config = {"extra": "forbid"}


class SemanticRecommendationRequest(BaseModel):
    locale: Literal["zh", "en"]
    model_id: UUID | None = None
    scopes: list[SemanticRecommendationScope] = Field(..., min_length=1, max_length=20)
    limit: int = Field(..., ge=1, le=50)

    @model_validator(mode="after")
    def validate_unique_sources(self):
        source_ids = [scope.source_id for scope in self.scopes]
        if len(source_ids) != len(set(source_ids)):
            raise ValueError("recommendation scopes must reference unique sources")
        return self

    model_config = {"extra": "forbid"}


class SemanticRecommendationResponse(BaseModel):
    batch_id: UUID
    generated_by: Literal["ai", "preflight"]
    items: list[SemanticEntryResponse]


SemanticInventoryDepth = Literal["structure", "sampled"]
SemanticInventoryJobStatus = Literal[
    "queued",
    "running",
    "completed",
    "completed_with_errors",
    "cancelled",
    "failed",
]
SemanticInventoryItemStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]
SemanticInventoryItemPhase = Literal["structure", "sample", "recommend", "complete"]
SemanticInventoryTableName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=512),
]


class SemanticInventoryJobRequest(BaseModel):
    """Explicit user consent for a bounded source inventory job.

    An empty table list means all relations in the captured metadata index. A
    sampled run must stay explicitly bounded to user-selected relations.
    """

    locale: Literal["zh", "en"]
    model_id: UUID | None = None
    tables: list[SemanticInventoryTableName] = Field(default_factory=list)
    depth: SemanticInventoryDepth

    @model_validator(mode="after")
    def validate_selection(self):
        if len(self.tables) != len({table.casefold() for table in self.tables}):
            raise ValueError("inventory tables must be unique")
        if self.depth == "sampled" and not self.tables:
            raise ValueError("sampled inventory requires explicit tables")
        if self.depth == "sampled" and len(self.tables) > 512:
            raise ValueError("sampled inventory accepts at most 512 explicit tables")
        return self

    model_config = {"extra": "forbid"}


class SemanticInventoryJobProgress(BaseModel):
    total: int = Field(..., ge=0)
    queued: int = Field(..., ge=0)
    running: int = Field(..., ge=0)
    succeeded: int = Field(..., ge=0)
    failed: int = Field(..., ge=0)
    cancelled: int = Field(..., ge=0)


class SemanticInventoryJobItemResponse(BaseModel):
    id: UUID
    ordinal: int = Field(..., ge=0)
    table: str = Field(..., min_length=1, max_length=512, validation_alias="table_name")
    status: SemanticInventoryItemStatus
    phase: SemanticInventoryItemPhase
    attempt_count: int = Field(..., ge=0)
    retryable: bool
    code: str | None = None
    message: str | None = None
    recommendation_batch_id: UUID | None = None
    candidate_count: int = Field(..., ge=0)
    started_at: datetime | None = None
    completed_at: datetime | None = None

    model_config = {"from_attributes": True, "populate_by_name": True}


class SemanticInventoryJobResponse(BaseModel):
    id: UUID
    project_id: UUID
    source_id: UUID
    status: SemanticInventoryJobStatus
    depth: SemanticInventoryDepth
    locale: Literal["zh", "en"]
    model_id: UUID | None = None
    retryable: bool = False
    candidate_count: int = Field(default=0, ge=0)
    reviewable_count: int = Field(default=0, ge=0)
    next_review_item: SemanticInventoryJobItemResponse | None = None
    failed_item_preview: list[SemanticInventoryJobItemResponse] = Field(default_factory=list)
    tables: list[str] = Field(default_factory=list)
    progress: SemanticInventoryJobProgress
    items: list[SemanticInventoryJobItemResponse] = Field(default_factory=list)
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None

    model_config = {"from_attributes": True}


class SemanticInventoryJobItemPageResponse(BaseModel):
    job_id: UUID
    items: list[SemanticInventoryJobItemResponse] = Field(
        default_factory=list,
        max_length=100,
    )
    next_after_ordinal: int | None = Field(default=None, ge=0)
    has_more: bool = False

    model_config = {"extra": "forbid"}


SemanticValidationJobStatus = Literal["queued", "running", "completed", "failed"]
SemanticValidationItemStatus = Literal["queued", "running", "verified", "blocked", "failed"]


class SemanticValidationProgress(BaseModel):
    total: int = Field(..., ge=0)
    queued: int = Field(..., ge=0)
    running: int = Field(..., ge=0)
    verified: int = Field(..., ge=0)
    blocked: int = Field(..., ge=0)
    failed: int = Field(..., ge=0)


class SemanticValidationItemResponse(BaseModel):
    id: UUID
    entry_id: UUID
    semantic_revision_id: UUID
    definition_hash: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    status: SemanticValidationItemStatus
    code: str | None = None
    facts: dict[str, Any] = Field(default_factory=dict)
    details: dict[str, Any] = Field(default_factory=dict)
    started_at: datetime | None = None
    completed_at: datetime | None = None


class SemanticValidationJobResponse(BaseModel):
    id: UUID
    project_id: UUID
    status: SemanticValidationJobStatus
    progress: SemanticValidationProgress
    items: list[SemanticValidationItemResponse]
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None


class SemanticRevisionSnapshot(BaseModel):
    scope_id: UUID | None = None
    key: str
    value: str
    entry_type: SemanticEntryType
    state: KnowledgeState
    confidence: float
    definition: SemanticDefinition | None = None
    validity: RelationshipValidity
    execution_state: SemanticExecutionState
    execution_details: dict[str, Any] = Field(default_factory=dict)
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    source: Literal["inferred", "user", "verified_analysis", "imported"]
    is_active: bool = True

    @model_validator(mode="after")
    def validate_definition_matches_entry_type(self):
        validate_semantic_definition_compatibility(self.entry_type, self.definition)
        return self


class SemanticEntryRevisionResponse(BaseModel):
    id: UUID
    project_id: UUID
    semantic_entry_id: UUID
    revision_number: int
    parent_revision_id: UUID | None = None
    restored_from_revision_id: UUID | None = None
    mutation_kind: str
    actor_source: str
    reason: str | None = None
    source_correction_id: str | None = None
    snapshot: SemanticRevisionSnapshot
    created_at: datetime

    model_config = {"from_attributes": True}


class SemanticEntryRestoreRequest(BaseModel):
    expected_active_revision_id: UUID
    reason: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def normalize_reason(self):
        if self.reason is not None:
            self.reason = self.reason.strip() or None
        return self


CorrectionType = Literal[
    "business_rule",
    "metric_definition",
    "filter_rule",
    "relationship_rule",
    "interpretation",
]


class AnalysisCorrectionTargetResponse(BaseModel):
    target_ref: str = Field(..., min_length=1, max_length=96)
    label: str = Field(..., min_length=1, max_length=240)
    description: str = Field(..., min_length=1, max_length=240)
    correction_type: CorrectionType


class MetricColumnCorrectionSelection(BaseModel):
    """Public, opaque choice for one server-resolved metric field."""

    kind: Literal["metric_column"]
    field_ref: str = Field(..., min_length=1, max_length=96)

    model_config = {"extra": "forbid"}


class AnalysisCorrectionTargetOptionResponse(BaseModel):
    kind: Literal["metric_column"]
    field_ref: str = Field(..., min_length=1, max_length=96)
    label: str = Field(..., min_length=1, max_length=240)
    description: str = Field(..., min_length=1, max_length=240)

    model_config = {"extra": "forbid"}


class AnalysisCorrectionCreate(BaseModel):
    analysis_run_id: UUID
    text: str = Field(..., min_length=1, max_length=10000)
    target_ref: str | None = Field(default=None, min_length=1, max_length=96)
    target_key: str | None = Field(default=None, min_length=1, max_length=160)
    selection: MetricColumnCorrectionSelection | None = None
    correction_type: CorrectionType = "business_rule"
    scope: Literal["run", "project"] = "run"
    report_title: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def normalize_text(self):
        self.text = self.text.strip()
        if not self.text:
            raise ValueError("text cannot be blank")
        if self.report_title is not None:
            self.report_title = self.report_title.strip() or None
        if self.target_key is not None:
            self.target_key = self.target_key.strip() or None
        if self.target_ref is not None:
            self.target_ref = self.target_ref.strip() or None
        if self.selection is not None and self.target_ref is None:
            raise ValueError("structured correction selection requires target_ref")
        if self.selection is not None and self.scope != "project":
            raise ValueError("structured correction selection requires project scope")
        return self


class AnalysisCorrectionResponse(BaseModel):
    id: UUID
    project_id: UUID
    analysis_run_id: UUID
    semantic_entry_id: UUID | None = None
    target_ref: str | None = None
    target_key: str | None = None
    selection: MetricColumnCorrectionSelection | None = None
    correction_type: CorrectionType
    text: str
    scope: Literal["run", "project"]
    state: Literal["recorded", "promoted"]
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @model_validator(mode="after")
    def hide_opaque_target_key(self):
        if self.target_ref is not None:
            self.target_key = None
            # Raw correction evidence is an internal execution contract and can
            # contain semantic keys inside compiled definitions or prior
            # snapshots. The ordinary opaque-target response exposes none of it.
            self.evidence = []
        return self


class AnalysisCorrectionDeleteResponse(BaseModel):
    deleted: bool
    correction_id: UUID
    project_rule_removed: bool = False


class AnalysisRunCreate(BaseModel):
    query: str = Field(..., min_length=1, max_length=10000)
    conversation_id: UUID | None = None


class ProjectDependencyInstall(BaseModel):
    packages: list[str] = Field(..., min_length=1, max_length=8)


class AnalysisRunResponse(BaseModel):
    id: UUID
    project_id: UUID
    conversation_id: UUID | None = None
    query: str
    state: AnalysisState
    stage: str
    report: dict[str, Any] = Field(default_factory=dict)
    checkpoint: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ArtifactResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    project_id: UUID
    analysis_run_id: UUID
    kind: Literal[
        "report",
        "metric",
        "table",
        "chart",
        "file",
        "evidence",
        "result_snapshot",
        "change_brief",
    ]
    title: str
    payload: dict[str, Any] = Field(default_factory=dict)
    technical_details: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class ReportDraftCurrentReportContext(BaseModel):
    """Bounded context used to make a draft complement an existing report."""

    title: str = Field(default="", max_length=200)
    description: str = Field(default="", max_length=1200)
    pages: list[
        Annotated[
            str,
            StringConstraints(strip_whitespace=True, min_length=1, max_length=160),
        ]
    ] = Field(default_factory=list, max_length=30)
    existing_artifact_ids: list[UUID] = Field(default_factory=list, max_length=200)
    has_user_edits: bool = False

    model_config = {"extra": "forbid"}


class ReportDraftPlanRequest(BaseModel):
    analysis_run_id: UUID
    language: Literal["zh", "en"] = "zh"
    current_report: ReportDraftCurrentReportContext | None = None

    model_config = {"extra": "forbid"}


class ReportDraftSectionResponse(BaseModel):
    role: Literal["overview", "detail", "evidence"]
    title: str = Field(..., min_length=1, max_length=160)
    purpose: str = Field(..., min_length=1, max_length=400)
    narrative: str | None = Field(default=None, max_length=800)
    artifact_ids: list[UUID] = Field(default_factory=list, max_length=12)


class ReportDraftPlanResponse(BaseModel):
    title: str
    description: str
    overview_text: str | None = None
    sections: list[ReportDraftSectionResponse] = Field(..., min_length=2, max_length=4)
    selected_overview: list[UUID] = Field(default_factory=list, max_length=4)
    selected_detail: list[UUID] = Field(default_factory=list, max_length=8)
    selected_evidence: list[UUID] = Field(default_factory=list, max_length=6)
    highlights: dict[UUID, str] = Field(default_factory=dict)
    generated_by: Literal["ai", "fallback"] = "ai"

    model_config = {"from_attributes": True}


class TrustedProjectReferenceCapture(BaseModel):
    analysis_run_id: UUID

    model_config = {"extra": "forbid"}


class TrustedProjectReferenceMetric(BaseModel):
    label: str = Field(..., min_length=1, max_length=160)
    value: str = Field(..., min_length=1, max_length=1000)
    context: str | None = Field(default=None, max_length=1000)
    historical: Literal[True] = True

    model_config = {"extra": "forbid"}


class TrustedProjectReferenceReport(BaseModel):
    summary: str = Field(default="", max_length=5000)
    metrics: list[TrustedProjectReferenceMetric] = Field(default_factory=list, max_length=100)
    conclusions: list[str] = Field(default_factory=list, max_length=100)
    historical: Literal[True] = True

    model_config = {"extra": "forbid"}


class TrustedProjectReferenceSourceRole(BaseModel):
    logical_name: str = Field(..., min_length=1, max_length=255)
    source_kind: Literal["file", "connection"]
    tables: list[str] = Field(default_factory=list, max_length=50)
    fingerprint: str | None = Field(default=None, max_length=128)
    schema_signature: str = Field(..., pattern=r"^[0-9a-f]{64}$")

    model_config = {"extra": "forbid"}


class TrustedProjectReferenceValidationEvidence(BaseModel):
    kind: Literal[
        "validation",
        "relationship_validation",
        "relationship_application",
        "golden_regression_validation",
    ]
    purpose: str | None = Field(default=None, max_length=1000)
    result_name: str | None = Field(default=None, max_length=255)
    status: str | None = Field(default=None, max_length=40)
    relationship_key: str | None = Field(default=None, max_length=160)
    contract_id: str | None = Field(default=None, max_length=160)
    profile: dict[str, Any] = Field(default_factory=dict)
    historical: Literal[True] = True

    model_config = {"extra": "forbid"}


class TrustedProjectReferenceResponse(BaseModel):
    version: Literal[1] = 1
    id: str = Field(..., pattern=r"^ref_[0-9a-f]{20}$")
    run_id: UUID
    query: str = Field(..., min_length=1, max_length=10000)
    title: str = Field(..., min_length=1, max_length=200)
    report: TrustedProjectReferenceReport
    source_roles: list[TrustedProjectReferenceSourceRole] = Field(..., min_length=1, max_length=20)
    confirmed_knowledge_keys: list[str] = Field(default_factory=list, max_length=100)
    validation_evidence: list[TrustedProjectReferenceValidationEvidence] = Field(
        ..., min_length=1, max_length=20
    )
    state: Literal["active", "revoked"] = "active"
    historical: Literal[True] = True
    usage_policy: Literal["historical_hypothesis_only"] = "historical_hypothesis_only"
    created_at: datetime
    updated_at: datetime
    revoked_at: datetime | None = None

    model_config = {"extra": "forbid"}


StandingScalar = str | int | float | bool | None


def _is_finite_number(value: object) -> bool:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(float(value))
    except OverflowError:
        return False


class StandingMaterialityRule(BaseModel):
    id: str = Field(..., pattern=r"^rule_[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    metric: str = Field(..., min_length=1, max_length=255)
    scope: Literal["overall", "by_key", "either"] = "either"
    direction: Literal["any", "increase", "decrease"] = "any"
    change_kind: Literal["absolute", "percent"]
    threshold: float = Field(..., gt=0, allow_inf_nan=False)

    model_config = {"extra": "forbid"}

    @model_validator(mode="after")
    def validate_metric_name(self):
        if not self.metric.strip():
            raise ValueError("metric must not be blank")
        return self


class StandingMaterialityPolicy(BaseModel):
    version: Literal[1] = 1
    match: Literal["any"] = "any"
    percent_unit: Literal["ratio"] = "ratio"
    top_driver_limit: int = Field(default=10, ge=1, le=50)
    rules: list[StandingMaterialityRule] = Field(..., min_length=1, max_length=50)

    model_config = {"extra": "forbid"}

    @model_validator(mode="after")
    def require_unique_rule_ids(self):
        rule_ids = [rule.id for rule in self.rules]
        if len(rule_ids) != len(set(rule_ids)):
            raise ValueError("materiality rule ids must be unique")
        return self


class ValidatedResultSnapshot(BaseModel):
    schema_version: Literal[1] = 1
    snapshot_id: str = Field(..., pattern=r"^snap_[0-9a-f]{20}$")
    analysis_run_id: UUID
    result_name: str = Field(..., min_length=1, max_length=255)
    input_token: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    shape_hash: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    columns: list[str] = Field(..., min_length=1, max_length=500)
    key_columns: list[str] = Field(..., min_length=1, max_length=20)
    numeric_columns: list[str] = Field(..., min_length=1, max_length=100)
    row_count: int = Field(..., ge=0, le=20000)
    truncated: Literal[False] = False
    rows: list[dict[str, StandingScalar]] = Field(default_factory=list, max_length=20000)

    model_config = {"extra": "forbid"}

    @model_validator(mode="after")
    def validate_result_contract(self):
        for field_name, values in (
            ("columns", self.columns),
            ("key_columns", self.key_columns),
            ("numeric_columns", self.numeric_columns),
        ):
            if any(not value.strip() or len(value) > 255 for value in values):
                raise ValueError(f"{field_name} contains an invalid column name")
            if len(values) != len(set(values)):
                raise ValueError(f"{field_name} must be unique")

        column_set = set(self.columns)
        if not set(self.key_columns).issubset(column_set):
            raise ValueError("key_columns must be present in columns")
        if not set(self.numeric_columns).issubset(column_set):
            raise ValueError("numeric_columns must be present in columns")
        if set(self.key_columns) & set(self.numeric_columns):
            raise ValueError("key_columns and numeric_columns must not overlap")
        if self.row_count != len(self.rows):
            raise ValueError("row_count must equal the number of rows")

        expected_columns = set(self.columns)
        seen_keys: set[tuple[StandingScalar, ...]] = set()
        for row in self.rows:
            if len(row) > 500 or set(row) != expected_columns:
                raise ValueError("every row must match the declared result shape exactly")
            for value in row.values():
                if isinstance(value, str) and len(value) > 10000:
                    raise ValueError("result text cells cannot exceed 10000 characters")
                if isinstance(value, float) and not math.isfinite(value):
                    raise ValueError("result cells cannot contain NaN or infinity")
            key = tuple(row[column] for column in self.key_columns)
            if any(value is None for value in key):
                raise ValueError("key columns cannot contain null values")
            if key in seen_keys:
                raise ValueError("key columns must uniquely identify every row")
            seen_keys.add(key)
            for column in self.numeric_columns:
                if not _is_finite_number(row[column]):
                    raise ValueError(f"numeric column {column!r} must contain finite numbers")
        return self


class StandingBaselineRef(BaseModel):
    snapshot_id: str = Field(..., pattern=r"^snap_[0-9a-f]{20}$")
    analysis_run_id: UUID
    artifact_id: UUID
    input_token: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    shape_hash: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    validation_state: Literal["validated"] = "validated"
    validation_evidence: list[str] = Field(..., min_length=1, max_length=20)
    accepted_at: datetime

    model_config = {"extra": "forbid"}

    @model_validator(mode="after")
    def validate_evidence(self):
        if any(not item.strip() or len(item) > 160 for item in self.validation_evidence):
            raise ValueError("validation evidence identifiers must be non-empty and bounded")
        if len(self.validation_evidence) != len(set(self.validation_evidence)):
            raise ValueError("validation evidence identifiers must be unique")
        return self


class StandingInFlightClaim(BaseModel):
    input_token: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    idempotency_key: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    analysis_run_id: UUID
    conversation_id: UUID
    user_message_id: UUID
    trigger: Literal["manual", "source_version", "app_start_overdue"]
    claimed_at: datetime
    expires_at: datetime

    model_config = {"extra": "forbid"}

    @model_validator(mode="after")
    def validate_lease_window(self):
        if self.expires_at <= self.claimed_at:
            raise ValueError("in-flight claim must expire after it is claimed")
        if (self.expires_at - self.claimed_at).total_seconds() > 86400:
            raise ValueError("in-flight claim cannot reserve work for more than 24 hours")
        return self


class StandingMetricDelta(BaseModel):
    metric: str = Field(..., min_length=1, max_length=255)
    before: float = Field(..., allow_inf_nan=False)
    after: float = Field(..., allow_inf_nan=False)
    delta: float = Field(..., allow_inf_nan=False)
    absolute_change: float = Field(..., ge=0, allow_inf_nan=False)
    percent_change: float | None = Field(default=None, allow_inf_nan=False)
    baseline_zero: bool = False

    model_config = {"extra": "forbid"}

    @model_validator(mode="after")
    def validate_computed_delta(self):
        expected_delta = self.after - self.before
        tolerance = max(1e-12, abs(expected_delta) * 1e-12)
        if not math.isclose(self.delta, expected_delta, rel_tol=1e-12, abs_tol=tolerance):
            raise ValueError("delta must equal after minus before")
        if not math.isclose(
            self.absolute_change,
            abs(expected_delta),
            rel_tol=1e-12,
            abs_tol=tolerance,
        ):
            raise ValueError("absolute_change must equal the absolute delta")
        if self.baseline_zero != (self.before == 0):
            raise ValueError("baseline_zero must reflect whether before is zero")
        if self.before == 0:
            expected_percent = 0.0 if self.after == 0 else None
        else:
            expected_percent = expected_delta / abs(self.before)
        if expected_percent is None:
            if self.percent_change is not None:
                raise ValueError("percent_change is undefined when a zero baseline changes")
        elif self.percent_change is None or not math.isclose(
            self.percent_change,
            expected_percent,
            rel_tol=1e-12,
            abs_tol=1e-12,
        ):
            raise ValueError("percent_change does not match the numeric delta")
        return self


class StandingKeyDelta(BaseModel):
    key: dict[str, StandingScalar] = Field(..., min_length=1, max_length=20)
    row_state: Literal["added", "removed", "changed"] = "changed"
    changes: list[StandingMetricDelta] = Field(..., min_length=1, max_length=100)

    model_config = {"extra": "forbid"}

    @model_validator(mode="after")
    def validate_key_and_metrics(self):
        if any(not name.strip() or len(name) > 255 for name in self.key):
            raise ValueError("key column names must be non-empty and bounded")
        if any(value is None for value in self.key.values()):
            raise ValueError("key values cannot be null")
        if any(
            isinstance(value, float) and not math.isfinite(value) for value in self.key.values()
        ):
            raise ValueError("key values cannot contain NaN or infinity")
        if any(isinstance(value, str) and len(value) > 10000 for value in self.key.values()):
            raise ValueError("key text values cannot exceed 10000 characters")
        metrics = [change.metric for change in self.changes]
        if len(metrics) != len(set(metrics)):
            raise ValueError("a key delta cannot repeat a metric")
        return self


class StandingDriverDelta(BaseModel):
    rank: int = Field(..., ge=1, le=50)
    key: dict[str, StandingScalar] = Field(..., min_length=1, max_length=20)
    row_state: Literal["added", "removed", "changed"] = "changed"
    change: StandingMetricDelta

    model_config = {"extra": "forbid"}

    @model_validator(mode="after")
    def validate_key_values(self):
        if any(not name.strip() or len(name) > 255 for name in self.key):
            raise ValueError("key column names must be non-empty and bounded")
        if any(value is None for value in self.key.values()):
            raise ValueError("key values cannot be null")
        if any(
            isinstance(value, float) and not math.isfinite(value) for value in self.key.values()
        ):
            raise ValueError("key values cannot contain NaN or infinity")
        if any(isinstance(value, str) and len(value) > 10000 for value in self.key.values()):
            raise ValueError("key text values cannot exceed 10000 characters")
        return self


class StandingChangeBrief(BaseModel):
    schema_version: Literal[1] = 1
    brief_id: str = Field(..., pattern=r"^brief_[0-9a-f]{20}$")
    baseline_snapshot_id: str = Field(..., pattern=r"^snap_[0-9a-f]{20}$")
    current_snapshot_id: str = Field(..., pattern=r"^snap_[0-9a-f]{20}$")
    current_input_token: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    shape_hash: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    status: Literal["material_change", "no_material_change"]
    matched_rule_ids: list[str] = Field(default_factory=list, max_length=50)
    overall: list[StandingMetricDelta] = Field(..., min_length=1, max_length=100)
    by_key: list[StandingKeyDelta] = Field(default_factory=list, max_length=20000)
    top_drivers: list[StandingDriverDelta] = Field(default_factory=list, max_length=50)

    model_config = {"extra": "forbid"}

    @model_validator(mode="after")
    def validate_materiality_and_ranks(self):
        if len(self.matched_rule_ids) != len(set(self.matched_rule_ids)):
            raise ValueError("matched_rule_ids must be unique")
        if self.status == "material_change" and not self.matched_rule_ids:
            raise ValueError("material_change requires at least one matched rule")
        if self.status == "no_material_change" and self.matched_rule_ids:
            raise ValueError("no_material_change cannot contain matched rules")
        if [driver.rank for driver in self.top_drivers] != list(
            range(1, len(self.top_drivers) + 1)
        ):
            raise ValueError("top driver ranks must be contiguous and ordered")
        return self


StandingAttentionReasonCode = Literal[
    "standing_playbook_unavailable",
    "standing_playbook_changed",
    "standing_playbook_sources_unbound",
    "standing_source_pending_confirmation",
    "standing_source_not_unique",
    "standing_source_changed_since_baseline",
    "standing_source_not_ready",
    "standing_source_working_copy_missing",
    "standing_source_schema_changed",
    "standing_source_version_invalid",
    "standing_source_recipe_changed_since_baseline",
    "standing_semantic_definition_missing",
    "standing_semantic_definition_inactive",
    "standing_semantic_definition_changed_since_baseline",
    "standing_relationship_definition_unavailable",
    "standing_relationship_definition_changed",
    "standing_project_input_unavailable",
    "standing_in_flight_run_missing",
    "standing_result_rejected",
    "standing_execution_failed",
]


class StandingAnalysisResponse(BaseModel):
    schema_version: Literal[1] = 1
    id: str = Field(..., pattern=r"^standing_[0-9a-f]{20}$")
    project_id: UUID
    name: str = Field(..., min_length=1, max_length=160)
    query: str = Field(..., min_length=1, max_length=10000)
    playbook_id: str = Field(..., pattern=r"^pb_[0-9a-f]{20}$")
    playbook_shape_hash: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    watched_source_roles: list[str] = Field(..., min_length=1, max_length=50)
    state: Literal["active", "paused", "needs_attention"] = "active"
    trigger_policy: Literal["app_open_and_source_change"] = "app_open_and_source_change"
    overdue_after_seconds: int = Field(default=86400, ge=300, le=31536000)
    materiality: StandingMaterialityPolicy
    baseline: StandingBaselineRef | None = None
    in_flight: StandingInFlightClaim | None = None
    last_evaluated_token: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    last_run_id: UUID | None = None
    last_brief_artifact_id: UUID | None = None
    attention_reason: str | None = Field(default=None, min_length=1, max_length=1000)
    attention_reason_code: StandingAttentionReasonCode | None = None
    attention_reason_params: dict[str, str] = Field(default_factory=dict, max_length=4)
    created_at: datetime
    updated_at: datetime

    model_config = {"extra": "forbid"}

    @model_validator(mode="after")
    def validate_state(self):
        if self.updated_at < self.created_at:
            raise ValueError("updated_at cannot be earlier than created_at")
        if any(not role.strip() or len(role) > 255 for role in self.watched_source_roles):
            raise ValueError("watched source roles must be non-empty and bounded")
        if len(self.watched_source_roles) != len(set(self.watched_source_roles)):
            raise ValueError("watched source roles must be unique")
        if self.state == "needs_attention" and self.attention_reason is None:
            raise ValueError("needs_attention requires attention_reason")
        if self.state != "needs_attention" and self.attention_reason is not None:
            raise ValueError("attention_reason is only valid in needs_attention state")
        if self.attention_reason is not None and not self.attention_reason.strip():
            raise ValueError("attention_reason must not be blank")
        if self.state != "needs_attention" and (
            self.attention_reason_code is not None or self.attention_reason_params
        ):
            raise ValueError("attention reason metadata is only valid in needs_attention state")
        if self.attention_reason_code is None and self.attention_reason_params:
            raise ValueError("attention reason params require a reason code")
        if any(
            not key.strip() or len(key) > 80 or not value.strip() or len(value) > 255
            for key, value in self.attention_reason_params.items()
        ):
            raise ValueError("attention reason params must be non-empty and bounded")
        if self.in_flight is not None and self.state != "active":
            raise ValueError("only an active standing analysis can hold an in-flight claim")
        if self.last_brief_artifact_id is not None and (
            self.last_run_id is None or self.last_evaluated_token is None
        ):
            raise ValueError("last_brief_artifact_id requires last run and input references")
        return self


class StandingAnalysisCreate(BaseModel):
    analysis_run_id: UUID
    name: str | None = Field(default=None, min_length=1, max_length=160)
    materiality: StandingMaterialityPolicy
    overdue_after_seconds: int | None = Field(default=None, ge=300, le=31536000)

    model_config = {"extra": "forbid"}

    @model_validator(mode="after")
    def validate_name(self):
        if self.name is not None and not self.name.strip():
            raise ValueError("name must not be blank")
        return self


class StandingAnalysisUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    state: Literal["active", "paused"] | None = None
    materiality: StandingMaterialityPolicy | None = None
    overdue_after_seconds: int | None = Field(default=None, ge=300, le=31536000)

    model_config = {"extra": "forbid"}

    @model_validator(mode="after")
    def require_a_change(self):
        if all(
            value is None
            for value in (self.name, self.state, self.materiality, self.overdue_after_seconds)
        ):
            raise ValueError("at least one standing analysis field must be updated")
        if self.name is not None and not self.name.strip():
            raise ValueError("name must not be blank")
        return self


class StandingPrepareRequest(BaseModel):
    trigger: Literal["manual", "source_version", "app_start_overdue"]
    request_id: UUID | None = None
    force: bool = False

    model_config = {"extra": "forbid"}


class StandingPrepareResponse(BaseModel):
    outcome: Literal[
        "no_change",
        "prepared",
        "already_running",
        "already_completed",
        "needs_attention",
        "paused",
    ]
    standing_analysis: StandingAnalysisResponse
    run_id: UUID | None = None
    conversation_id: UUID | None = None
    user_message_id: UUID | None = None
    input_token: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    brief_artifact_id: UUID | None = None
    attention_reason: str | None = Field(default=None, min_length=1, max_length=1000)
    attention_reason_code: StandingAttentionReasonCode | None = None
    attention_reason_params: dict[str, str] = Field(default_factory=dict, max_length=4)

    model_config = {"extra": "forbid"}

    @model_validator(mode="after")
    def validate_outcome(self):
        identity = (self.run_id, self.conversation_id, self.user_message_id)
        if self.outcome in {"prepared", "already_running"}:
            if any(value is None for value in (*identity, self.input_token)):
                raise ValueError(f"{self.outcome} requires the complete claimed run identity")
            claim = self.standing_analysis.in_flight
            if claim is None:
                raise ValueError(f"{self.outcome} requires an in-flight claim")
            if (
                identity
                != (
                    claim.analysis_run_id,
                    claim.conversation_id,
                    claim.user_message_id,
                )
                or self.input_token != claim.input_token
            ):
                raise ValueError("prepare response identity must match the in-flight claim")
        if self.outcome == "already_completed":
            if self.run_id is None or self.input_token is None or self.brief_artifact_id is None:
                raise ValueError("already_completed requires run, input, and brief references")
        if self.outcome == "no_change" and self.input_token is None:
            raise ValueError("no_change requires the current input token")
        if self.brief_artifact_id is not None and self.run_id is None:
            raise ValueError("brief_artifact_id requires run_id")
        if self.outcome == "needs_attention":
            if not self.attention_reason or not self.attention_reason.strip():
                raise ValueError("needs_attention requires attention_reason")
            if self.attention_reason != self.standing_analysis.attention_reason:
                raise ValueError("attention reason must match the standing analysis state")
            if self.attention_reason_code != self.standing_analysis.attention_reason_code:
                raise ValueError("attention reason code must match the standing analysis state")
            if self.attention_reason_params != self.standing_analysis.attention_reason_params:
                raise ValueError("attention reason params must match the standing analysis state")
        elif (
            self.attention_reason is not None
            or self.attention_reason_code is not None
            or self.attention_reason_params
        ):
            raise ValueError("attention reason fields are only valid for needs_attention")
        if self.outcome == "paused" and self.standing_analysis.state != "paused":
            raise ValueError("paused outcome requires a paused standing analysis")
        if self.outcome == "needs_attention" and self.standing_analysis.state != "needs_attention":
            raise ValueError("needs_attention outcome requires needs_attention state")
        return self


class GoldenScenarioSourceContract(BaseModel):
    logical_name: str = Field(..., min_length=1, max_length=255)
    fingerprint: str | None = Field(default=None, max_length=128)
    schema_columns: list[str] = Field(default_factory=list, max_length=1000)

    model_config = {"extra": "forbid"}


class GoldenScenarioResultContract(BaseModel):
    required_columns: list[str] = Field(default_factory=list, max_length=1000)
    key_columns: list[str] = Field(default_factory=list, max_length=1000)
    numeric_columns: list[str] = Field(default_factory=list, max_length=1000)
    must_not_be_truncated: bool = True
    same_input_rows_hash: str = Field(..., pattern=r"^[0-9a-f]{64}$")

    model_config = {"extra": "forbid"}


class GoldenScenarioRelationshipSourceRef(BaseModel):
    source_logical_name: str = Field(..., min_length=1, max_length=255)
    source_kind: Literal["file", "connection"]

    model_config = {"extra": "forbid"}


class GoldenScenarioRelationshipContract(BaseModel):
    relationship_key: str | None = Field(default=None, max_length=160)
    definition_hash: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    source_refs: list[GoldenScenarioRelationshipSourceRef] = Field(
        default_factory=list, max_length=20
    )
    left_key: str = Field(..., min_length=1, max_length=255)
    right_key: str = Field(..., min_length=1, max_length=255)
    normalization: Literal["exact", "trim_casefold", "identifier"] = "exact"
    cardinality: Literal["one_to_one", "one_to_many", "many_to_one", "many_to_many"] | None = None
    left_match_rate: float = Field(default=0, ge=0, le=1)
    expansion_ratio: float = Field(default=1, ge=0)
    minimum_left_match_rate: float = Field(default=0.5, ge=0, le=1)
    maximum_expansion_ratio: float = Field(default=1, ge=0)

    model_config = {"extra": "forbid"}


class GoldenScenarioRuleApplicationContract(BaseModel):
    rule_key: str = Field(..., min_length=1, max_length=160)
    rule_value: str = Field(..., min_length=1, max_length=1000)
    action_kind: Literal["value_filter", "identity", "metric_column", "metric_formula"] = (
        "value_filter"
    )
    column: str = Field(..., min_length=1, max_length=255)
    operator: Literal["include", "exclude"] | None = None
    values: list[str] = Field(default_factory=list, max_length=1000)
    before_rows: int = Field(..., ge=0)
    after_rows: int = Field(..., ge=0)
    excluded_rows: int = Field(..., ge=0)
    input_hash: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    output_hash: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    definition_hash: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    formula_hash: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    metric_consumed: bool | None = None

    @model_validator(mode="after")
    def validate_action_evidence(self):
        if self.action_kind == "value_filter":
            if self.operator is None or not self.values:
                raise ValueError("value_filter requires operator and values")
        elif self.operator is not None or self.values:
            raise ValueError(f"{self.action_kind} must be lossless evidence")
        if self.action_kind == "metric_formula":
            if self.definition_hash is None or self.formula_hash is None:
                raise ValueError("metric_formula requires definition and formula hashes")
        elif self.formula_hash is not None:
            raise ValueError("formula_hash is only valid for metric_formula")
        return self

    model_config = {"extra": "forbid"}


class GoldenScenarioReferenceReport(BaseModel):
    metrics: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    findings: list[str] = Field(default_factory=list, max_length=100)

    model_config = {"extra": "forbid"}


class GoldenScenarioContract(BaseModel):
    version: Literal[1] = 1
    id: str = Field(..., pattern=r"^[0-9a-f]{20}$")
    query: str = Field(..., min_length=1, max_length=10000)
    query_key: str = Field(..., min_length=1, max_length=10000)
    confirmed_knowledge: dict[str, str] = Field(default_factory=dict)
    sources: list[GoldenScenarioSourceContract] = Field(default_factory=list, max_length=100)
    result: GoldenScenarioResultContract
    relationships: list[GoldenScenarioRelationshipContract] = Field(
        default_factory=list, max_length=100
    )
    required_rule_applications: list[GoldenScenarioRuleApplicationContract] = Field(
        default_factory=list, max_length=100
    )
    created_at: datetime
    reference_report: GoldenScenarioReferenceReport = Field(
        default_factory=GoldenScenarioReferenceReport
    )

    model_config = {"extra": "forbid"}


class AnalysisPlaybookCapture(BaseModel):
    analysis_run_id: UUID
    name: str | None = Field(default=None, min_length=1, max_length=160)

    model_config = {"extra": "forbid"}


class AnalysisPlaybookColumnContract(BaseModel):
    table: str | None = Field(default=None, max_length=255)
    name: str = Field(..., min_length=1, max_length=255)
    data_type: str = Field(default="unknown", min_length=1, max_length=120)
    canonical_type: Literal["boolean", "number", "datetime", "text", "unknown"] = "unknown"

    model_config = {"extra": "forbid"}


class AnalysisPlaybookSourceRole(BaseModel):
    logical_name: str = Field(..., min_length=1, max_length=255)
    source_kind: Literal["file", "connection"]
    tables: list[str] = Field(default_factory=list, max_length=100)
    columns: list[AnalysisPlaybookColumnContract] = Field(default_factory=list, max_length=500)
    schema_signature: str = Field(..., pattern=r"^[0-9a-f]{64}$")

    model_config = {"extra": "forbid"}


PlaybookResultAlias = Annotated[str, Field(pattern=r"^result_[1-9][0-9]*$")]
AnalysisPlaybookFilterScalar = str | int | float | bool


class AnalysisPlaybookStructuredQueryMetric(BaseModel):
    operation: Literal["count", "count_distinct", "sum", "avg", "min", "max"]
    column: str | None = Field(default=None, min_length=1, max_length=160)
    alias: str | None = Field(default=None, min_length=1, max_length=80)

    @model_validator(mode="after")
    def require_metric_column(self):
        if self.operation != "count" and self.column is None:
            raise ValueError(f"{self.operation} requires a source column")
        return self

    model_config = {"extra": "forbid"}


class AnalysisPlaybookStructuredQueryFilter(BaseModel):
    column: str = Field(..., min_length=1, max_length=160)
    operator: Literal[
        "eq",
        "ne",
        "gt",
        "gte",
        "lt",
        "lte",
        "in",
        "not_in",
        "contains",
        "is_null",
        "not_null",
    ] = "eq"
    value: AnalysisPlaybookFilterScalar | list[AnalysisPlaybookFilterScalar] | None = None

    @model_validator(mode="after")
    def validate_filter_value(self):
        if self.operator in {"is_null", "not_null"}:
            if self.value is not None:
                raise ValueError(f"{self.operator} forbids a value")
            return self
        if self.operator in {"in", "not_in"}:
            if not isinstance(self.value, list) or not self.value:
                raise ValueError(f"{self.operator} requires a non-empty value list")
            if len(self.value) > 1000:
                raise ValueError(f"{self.operator} accepts at most 1000 values")
            return self
        if isinstance(self.value, list):
            raise ValueError(f"{self.operator} accepts one scalar value")
        if self.operator == "contains" and not isinstance(self.value, str):
            raise ValueError("contains requires a text value")
        return self

    model_config = {"extra": "forbid"}


class AnalysisPlaybookStructuredQuerySort(BaseModel):
    field: str = Field(..., min_length=1, max_length=160)
    direction: Literal["asc", "desc"] = "desc"

    model_config = {"extra": "forbid"}


class AnalysisPlaybookStructuredQueryPlan(BaseModel):
    """Portable query intent; physical source ids and compiled SQL never belong here."""

    table: str = Field(..., min_length=1, max_length=255)
    dimensions: list[str] = Field(default_factory=list, max_length=20)
    metrics: list[AnalysisPlaybookStructuredQueryMetric] = Field(
        default_factory=list,
        max_length=20,
    )
    filters: list[AnalysisPlaybookStructuredQueryFilter] = Field(
        default_factory=list,
        max_length=30,
    )
    sort: list[AnalysisPlaybookStructuredQuerySort] = Field(default_factory=list, max_length=10)
    limit: int = Field(default=1000, ge=1, le=10_000)

    model_config = {"extra": "forbid"}


class _AnalysisPlaybookStepBase(BaseModel):
    order: int = Field(..., ge=1, le=100)
    summary: str = Field(..., min_length=1, max_length=500)

    model_config = {"extra": "forbid"}


class AnalysisPlaybookReadStep(_AnalysisPlaybookStepBase):
    kind: Literal["read_data"]
    input_results: list[PlaybookResultAlias] = Field(default_factory=list, max_length=0)
    output_result: PlaybookResultAlias
    source_roles: list[str] = Field(..., min_length=1, max_length=20)
    required_columns: list[str] = Field(default_factory=list, max_length=200)


class AnalysisPlaybookStructuredQueryStep(_AnalysisPlaybookStepBase):
    kind: Literal["structured_query"]
    input_results: list[PlaybookResultAlias] = Field(default_factory=list, max_length=0)
    output_result: PlaybookResultAlias
    source_role: str = Field(..., min_length=1, max_length=255)
    plan: AnalysisPlaybookStructuredQueryPlan


class AnalysisPlaybookRuleStep(_AnalysisPlaybookStepBase):
    kind: Literal["apply_rule"]
    input_results: list[PlaybookResultAlias] = Field(..., min_length=1, max_length=1)
    output_result: PlaybookResultAlias
    rule_key: str = Field(..., min_length=1, max_length=160)
    action_kind: Literal["value_filter", "identity", "metric_column", "metric_formula"]
    column: str = Field(..., min_length=1, max_length=255)
    operator: Literal["include", "exclude"] | None = None
    values: list[str] | None = Field(default=None, min_length=1, max_length=1000)
    definition_hash: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")

    @model_validator(mode="after")
    def require_action_bindings(self):
        if self.action_kind == "value_filter":
            if self.operator is None or not self.values:
                raise ValueError("value_filter requires operator and values")
        elif self.operator is not None or self.values is not None:
            raise ValueError("lossless rule actions forbid filter parameters")
        if self.action_kind == "metric_formula" and self.definition_hash is None:
            raise ValueError("metric_formula requires a semantic definition hash")
        return self


class AnalysisPlaybookRelationshipStep(_AnalysisPlaybookStepBase):
    kind: Literal["validate_relationship"]
    input_results: list[PlaybookResultAlias] = Field(..., min_length=2, max_length=2)
    output_result: None = None
    relationship_key: str | None = Field(default=None, max_length=160)
    definition_hash: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    left_key: str | None = Field(default=None, max_length=255)
    right_key: str | None = Field(default=None, max_length=255)
    normalization: Literal["exact", "trim_casefold", "identifier"]

    @model_validator(mode="after")
    def require_relationship_binding(self):
        if not self.relationship_key and not (self.left_key and self.right_key):
            raise ValueError("relationship_key or both join keys are required")
        return self


class AnalysisPlaybookJoinStep(_AnalysisPlaybookStepBase):
    kind: Literal["join"]
    input_results: list[PlaybookResultAlias] = Field(..., min_length=2, max_length=2)
    output_result: PlaybookResultAlias
    relationship_key: str | None = Field(default=None, max_length=160)
    definition_hash: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    left_key: str | None = Field(default=None, max_length=255)
    right_key: str | None = Field(default=None, max_length=255)
    join_mode: Literal["left", "inner"]
    normalization: Literal["exact", "trim_casefold", "identifier"]

    @model_validator(mode="after")
    def require_join_binding(self):
        if not self.relationship_key and not (self.left_key and self.right_key):
            raise ValueError("relationship_key or both join keys are required")
        return self


class AnalysisPlaybookAggregateStep(_AnalysisPlaybookStepBase):
    kind: Literal["aggregate"]
    input_results: list[PlaybookResultAlias] = Field(..., min_length=1, max_length=1)
    output_result: PlaybookResultAlias
    group_by: list[str] = Field(default_factory=list, max_length=100)
    operation: Literal["count", "sum", "mean", "min", "max", "nunique"]
    value_column: str | None = Field(default=None, max_length=255)
    output_column: str = Field(..., min_length=1, max_length=255)

    @model_validator(mode="after")
    def require_aggregate_value(self):
        if self.operation != "count" and not self.value_column:
            raise ValueError("value_column is required for this aggregate operation")
        return self


class AnalysisPlaybookAnalysisStep(_AnalysisPlaybookStepBase):
    kind: Literal["analyze"]
    input_results: list[PlaybookResultAlias] = Field(..., min_length=1, max_length=20)
    output_result: None = None
    analysis_kind: Literal["custom"] = "custom"
    requires_replanning: Literal[True] = True


class AnalysisPlaybookVisualizationStep(_AnalysisPlaybookStepBase):
    kind: Literal["visualize"]
    input_results: list[PlaybookResultAlias] = Field(..., min_length=1, max_length=1)
    output_result: None = None
    chart_type: Literal["heatmap", "bar", "line", "scatter", "histogram", "box"]
    x: str = Field(..., min_length=1, max_length=255)
    y: str | None = Field(default=None, max_length=255)
    value: str | None = Field(default=None, max_length=255)
    color: str | None = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def require_chart_bindings(self):
        if self.chart_type == "heatmap" and not (self.y and self.value):
            raise ValueError("heatmap requires y and value bindings")
        if self.chart_type in {"bar", "line", "scatter"} and not self.y:
            raise ValueError("this chart type requires a y binding")
        return self


class AnalysisPlaybookValidationStep(_AnalysisPlaybookStepBase):
    kind: Literal["validate_result"]
    input_results: list[PlaybookResultAlias] = Field(..., min_length=1, max_length=1)
    output_result: None = None
    key_columns: list[str] = Field(default_factory=list, max_length=100)
    numeric_columns: list[str] = Field(default_factory=list, max_length=100)
    must_not_be_truncated: Literal[True] = True


AnalysisPlaybookStep = Annotated[
    AnalysisPlaybookReadStep
    | AnalysisPlaybookStructuredQueryStep
    | AnalysisPlaybookRuleStep
    | AnalysisPlaybookRelationshipStep
    | AnalysisPlaybookJoinStep
    | AnalysisPlaybookAggregateStep
    | AnalysisPlaybookAnalysisStep
    | AnalysisPlaybookVisualizationStep
    | AnalysisPlaybookValidationStep,
    Field(discriminator="kind"),
]


class AnalysisPlaybookValidationSummary(BaseModel):
    input_result: PlaybookResultAlias
    columns: list[str] = Field(default_factory=list, max_length=500)
    key_columns: list[str] = Field(default_factory=list, max_length=100)
    numeric_columns: list[str] = Field(default_factory=list, max_length=100)
    must_not_be_truncated: Literal[True] = True

    model_config = {"extra": "forbid"}


class AnalysisPlaybookResponse(BaseModel):
    schema_version: Literal[2, 3] = 2
    execution_mode: Literal["system_structured_query", "agent_replan_required"] = (
        "agent_replan_required"
    )
    id: str = Field(..., pattern=r"^pb_[0-9a-f]{20}$")
    name: str = Field(..., min_length=1, max_length=160)
    query: str = Field(..., min_length=1, max_length=10000)
    binding_policy: Literal["logical_role_then_schema"] = "logical_role_then_schema"
    requires_revalidation: Literal[True] = True
    source_roles: list[AnalysisPlaybookSourceRole] = Field(default_factory=list, max_length=50)
    confirmed_knowledge_keys: list[str] = Field(default_factory=list, max_length=100)
    relationship_keys: list[str] = Field(default_factory=list, max_length=100)
    steps: list[AnalysisPlaybookStep] = Field(..., min_length=1, max_length=100)
    validation: AnalysisPlaybookValidationSummary
    shape_hash: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def validate_execution_contract(self):
        structured_steps = [step for step in self.steps if step.kind == "structured_query"]
        if self.schema_version == 2:
            if self.execution_mode != "agent_replan_required":
                raise ValueError("schema version 2 cannot claim system execution")
            if structured_steps:
                raise ValueError("schema version 2 cannot contain structured query steps")
            return self
        if self.execution_mode != "system_structured_query":
            return self
        validation_steps = [step for step in self.steps if step.kind == "validate_result"]
        if len(self.source_roles) != 1 or len(structured_steps) != 1:
            raise ValueError("system structured query playbooks require exactly one source role")
        if len(validation_steps) != 1 or len(self.steps) != 2:
            raise ValueError("system structured query playbooks require one final validation")
        query_step = structured_steps[0]
        validation_step = validation_steps[0]
        if query_step.source_role != self.source_roles[0].logical_name:
            raise ValueError("structured query source role does not match its binding")
        if (
            validation_step.input_results != [query_step.output_result]
            or self.validation.input_result != query_step.output_result
        ):
            raise ValueError("structured query output must be the final validated result")
        if self.confirmed_knowledge_keys or self.relationship_keys:
            raise ValueError("system structured query playbooks cannot hide semantic side effects")
        return self

    model_config = {"extra": "forbid"}


class AnalysisPlaybookDeleteResponse(BaseModel):
    deleted: bool
    playbook_id: str


class ProjectBundleSemanticRevision(BaseModel):
    """Portable immutable revision using bundle-local source identifiers."""

    id: UUID
    revision_number: int = Field(..., ge=1)
    parent_revision_id: UUID | None = None
    restored_from_revision_id: UUID | None = None
    mutation_kind: str = Field(..., min_length=1, max_length=40)
    actor_source: str = Field(..., min_length=1, max_length=30)
    reason: str | None = None
    source_correction_id: str | None = Field(default=None, max_length=36)
    snapshot: SemanticRevisionSnapshot
    created_at: datetime

    model_config = {"extra": "forbid"}


class ProjectBundleSemanticHead(SemanticRevisionSnapshot):
    """Materialized head paired with the immutable revisions that produced it."""

    revision_number: int = Field(..., ge=1)
    active_revision_id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"extra": "forbid"}


class ProjectBundleSemanticHistory(BaseModel):
    """One semantic entry and its complete, project-local append-only history."""

    entry_id: UUID
    head: ProjectBundleSemanticHead
    revisions: list[ProjectBundleSemanticRevision] = Field(..., min_length=1)

    model_config = {"extra": "forbid"}


class ProjectBundleSanitationRevision(BaseModel):
    """One immutable cleaning-method revision in a portable project backup."""

    id: UUID
    revision_number: int = Field(..., ge=1)
    parent_revision_id: UUID | None = None
    state: SanitationRevisionState
    operations: list[dict[str, Any]] = Field(default_factory=list)
    input_contract: dict[str, Any] = Field(default_factory=dict)
    output_contract: dict[str, Any] = Field(default_factory=dict)
    actor_source: str = Field(..., min_length=1, max_length=30)
    reason: str | None = None
    source_correction_id: str | None = Field(default=None, max_length=36)
    created_at: datetime

    model_config = {"extra": "forbid"}


class ProjectBundleSanitationHead(BaseModel):
    """Materialized recipe head paired with its append-only history."""

    name: str = Field(..., min_length=1, max_length=160)
    status: str = Field(..., min_length=1, max_length=30)
    operations: list[dict[str, Any]] = Field(default_factory=list)
    input_fingerprint: str | None = Field(default=None, max_length=64)
    output_fingerprint: str | None = Field(default=None, max_length=64)
    active_revision_id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"extra": "forbid"}


class ProjectBundleSanitationHistory(BaseModel):
    """A portable cleaning method and every revision that produced its head."""

    recipe_id: UUID
    head: ProjectBundleSanitationHead
    revisions: list[ProjectBundleSanitationRevision] = Field(..., min_length=1)

    model_config = {"extra": "forbid"}


class ProjectBundle(BaseModel):
    # Version 1 is retained as the default because early backups may omit the
    # field. Version 2 adds semantic history; version 3 also carries immutable
    # cleaning-method history without pretending that source files are portable.
    version: Literal[1, 2, 3] = 1
    project: ProjectCreate
    semantic_entries: list[SemanticEntryCreate] = Field(default_factory=list)
    semantic_histories: list[ProjectBundleSemanticHistory] = Field(default_factory=list)
    sanitation_recipes: list[dict[str, Any]] = Field(default_factory=list)
    sanitation_histories: list[ProjectBundleSanitationHistory] = Field(default_factory=list)
    golden_scenarios: list[GoldenScenarioContract] = Field(default_factory=list, max_length=100)
    analysis_playbooks: list[AnalysisPlaybookResponse] = Field(default_factory=list, max_length=100)
    trusted_references: list[TrustedProjectReferenceResponse] = Field(
        default_factory=list,
        max_length=100,
    )
    standing_analyses: list[StandingAnalysisResponse] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def validate_semantic_history_contract(self):
        if self.version == 1:
            if self.semantic_histories:
                raise ValueError("version 1 bundle cannot contain semantic_histories")
            return self

        entry_ids: set[UUID] = set()
        revision_ids: set[UUID] = set()
        history_by_key: dict[str, ProjectBundleSemanticHistory] = {}
        snapshot_fields = tuple(SemanticRevisionSnapshot.model_fields)

        for history in self.semantic_histories:
            if history.entry_id in entry_ids:
                raise ValueError("semantic history entry_id must be unique")
            entry_ids.add(history.entry_id)
            if history.head.key in history_by_key:
                raise ValueError("semantic history keys must be unique")
            history_by_key[history.head.key] = history

            local_revision_ids = {revision.id for revision in history.revisions}
            if len(local_revision_ids) != len(history.revisions):
                raise ValueError("semantic revision ids must be unique")
            if revision_ids & local_revision_ids:
                raise ValueError("semantic revision ids must be unique across the bundle")
            revision_ids.update(local_revision_ids)

            prior_ids: set[UUID] = set()
            previous_revision_id: UUID | None = None
            for expected_number, revision in enumerate(history.revisions, start=1):
                if revision.revision_number != expected_number:
                    raise ValueError("semantic revisions must be ordered and contiguous")
                if revision.parent_revision_id != previous_revision_id:
                    raise ValueError("semantic revision parent chain is invalid")
                if (
                    revision.restored_from_revision_id is not None
                    and revision.restored_from_revision_id not in prior_ids
                ):
                    raise ValueError("restored revision must reference an earlier local revision")
                prior_ids.add(revision.id)
                previous_revision_id = revision.id

            active_revision = history.revisions[-1]
            if history.head.active_revision_id != active_revision.id:
                raise ValueError("semantic active head must reference the final revision")
            if history.head.revision_number != active_revision.revision_number:
                raise ValueError("semantic head revision number does not match active revision")
            head_snapshot = history.head.model_dump(
                mode="python",
                include=set(snapshot_fields),
            )
            if head_snapshot != active_revision.snapshot.model_dump(mode="python"):
                raise ValueError("semantic active head does not match its immutable snapshot")

        projected_entries: dict[str, SemanticEntryCreate] = {}
        for entry in self.semantic_entries:
            if entry.key in projected_entries:
                raise ValueError("semantic entry keys must be unique")
            projected_entries[entry.key] = entry
        active_histories = {
            key: history for key, history in history_by_key.items() if history.head.is_active
        }
        if set(projected_entries) != set(active_histories):
            raise ValueError("semantic_entries must project every active v2 history head")
        for key, history in active_histories.items():
            head_projection = SemanticEntryCreate.model_validate(
                {
                    field_name: getattr(history.head, field_name)
                    for field_name in SemanticEntryCreate.model_fields
                }
            )
            if projected_entries[key].model_dump(mode="python") != head_projection.model_dump(
                mode="python"
            ):
                raise ValueError("semantic_entries projection does not match v2 history head")
        return self

    @model_validator(mode="after")
    def validate_sanitation_history_contract(self):
        if self.version in {1, 2}:
            if self.sanitation_histories:
                raise ValueError("only version 3 bundles can contain sanitation_histories")
            return self
        if self.sanitation_recipes:
            raise ValueError(
                "version 3 uses sanitation_histories instead of legacy sanitation_recipes"
            )

        recipe_ids: set[UUID] = set()
        revision_ids: set[UUID] = set()
        for history in self.sanitation_histories:
            if history.recipe_id in recipe_ids:
                raise ValueError("sanitation history recipe_id must be unique")
            recipe_ids.add(history.recipe_id)

            local_revision_ids = {revision.id for revision in history.revisions}
            if len(local_revision_ids) != len(history.revisions):
                raise ValueError("sanitation revision ids must be unique")
            if revision_ids & local_revision_ids:
                raise ValueError("sanitation revision ids must be unique across the bundle")
            revision_ids.update(local_revision_ids)

            previous_revision_id: UUID | None = None
            for expected_number, revision in enumerate(history.revisions, start=1):
                if revision.revision_number != expected_number:
                    raise ValueError("sanitation revisions must be ordered and contiguous")
                if revision.parent_revision_id != previous_revision_id:
                    raise ValueError("sanitation revision parent chain is invalid")
                previous_revision_id = revision.id

            active_revision = history.revisions[-1]
            if history.head.active_revision_id != active_revision.id:
                raise ValueError("sanitation active head must reference the final revision")
            if history.head.operations != active_revision.operations:
                raise ValueError("sanitation head operations do not match the active revision")
            if active_revision.input_contract.get("fingerprint") != history.head.input_fingerprint:
                raise ValueError("sanitation input fingerprint does not match the active revision")
            if (
                active_revision.output_contract.get("fingerprint")
                != history.head.output_fingerprint
            ):
                raise ValueError("sanitation output fingerprint does not match the active revision")
            expected_state = (
                "reverted"
                if history.head.status == "reverted"
                else "candidate"
                if history.head.status in {"needs_attention", "candidate"}
                else "confirmed"
            )
            if active_revision.state != expected_state:
                raise ValueError("sanitation head status does not match the active revision state")
        return self
