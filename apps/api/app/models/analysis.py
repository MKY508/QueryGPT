"""Reports and chart contracts, independent of the analyst engine."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.services.business_decision_slots import canonicalize_decision_key


class ReportMetric(BaseModel):
    label: str
    value: str
    context: str | None = None


class ConfirmationRequest(BaseModel):
    key: str = Field(min_length=1, max_length=160)
    question: str = Field(min_length=4, max_length=500)
    options: list[str] = Field(min_length=2, max_length=8)
    reason: str = Field(min_length=4, max_length=500)
    presentation_code: str | None = Field(
        default=None,
        max_length=160,
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

    @field_validator("key", "question", "reason")
    @classmethod
    def normalize_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("确认问题字段不能为空")
        return normalized

    @field_validator("options")
    @classmethod
    def normalize_options(cls, options: list[str]) -> list[str]:
        normalized = [option.strip() for option in options]
        if any(not option for option in normalized):
            raise ValueError("确认选项不能为空")
        if len(set(normalized)) != len(normalized):
            raise ValueError("确认选项不能重复")
        return normalized

    @model_validator(mode="after")
    def canonicalize_key(self) -> ConfirmationRequest:
        """Bind model-authored wording to the system-owned decision slot."""

        self.key = canonicalize_decision_key(
            self.key,
            question=self.question,
            reason=self.reason,
            options=self.options,
        )
        return self


class ReportAction(BaseModel):
    """The one thing the product needs the user to do before work can continue."""

    kind: Literal["add_data", "confirm"]
    label: str = Field(min_length=2, max_length=80)
    reason: str = Field(min_length=4, max_length=500)
    requested_data: list[str] = Field(default_factory=list, max_length=5)
    confirmation_key: str | None = Field(default=None, max_length=160)
    options: list[str] = Field(default_factory=list, max_length=8)


class ReportNextAction(BaseModel):
    """A finding-specific next step, rather than a generic suggested prompt."""

    kind: Literal["deepen", "compare", "verify", "repeat"]
    label: str = Field(min_length=2, max_length=40)
    prompt: str = Field(min_length=5, max_length=500)
    reason: str = Field(min_length=4, max_length=300)
    recommended: bool = False


class ChartDataRef(BaseModel):
    """A verified retained result that supplies chart rows."""

    model_config = {"extra": "forbid"}

    result_name: str = Field(min_length=1, max_length=160)
    # Drafts may name a result before the runtime has bound its verified hash.
    result_hash: str = Field(default="", max_length=128)


class ChartFieldEncoding(BaseModel):
    """One library-independent field binding."""

    model_config = {"extra": "forbid"}

    field: str = Field(min_length=1, max_length=160)
    label: str | None = Field(default=None, max_length=160)
    kind: Literal["category", "number", "temporal"] | None = None


class ChartMeasureEncoding(ChartFieldEncoding):
    """A quantitative series and its business-facing presentation metadata."""

    aggregate: Literal["sum", "avg", "count", "count_distinct", "min", "max"] | None = None
    format: Literal["auto", "number", "integer", "compact", "currency", "percent"] | None = None


class ChartEncoding(BaseModel):
    """Fields used by a deterministic chart renderer."""

    model_config = {"extra": "forbid"}

    x: ChartFieldEncoding | None = None
    y: list[ChartMeasureEncoding] = Field(default_factory=list, max_length=12)

    @field_validator("y", mode="before")
    @classmethod
    def normalize_measure_shorthand(cls, value: Any) -> Any:
        if not isinstance(value, list):
            return value
        return [{"field": item} if isinstance(item, str) else item for item in value]


class ChartPresentation(BaseModel):
    """A small, governed set of renderer-neutral display choices."""

    model_config = {"extra": "forbid"}

    orientation: Literal["vertical", "horizontal"] = "vertical"
    stack: Literal["none", "normal", "percent"] = "none"
    palette: Literal[
        "receiptbi",
        "receiptbi-muted",
        "categorical",
        "monochrome",
    ] = "receiptbi"

    @field_validator("stack", mode="before")
    @classmethod
    def normalize_boolean_stack(cls, value: Any) -> Any:
        if isinstance(value, bool):
            return "normal" if value else "none"
        return value


class ChartSpec(BaseModel):
    """Versioned chart DSL; executable code and model-authored rows are forbidden."""

    model_config = {"extra": "forbid"}

    version: Literal[1] = 1
    type: Literal["bar", "horizontal_bar", "line", "area", "pie", "scatter"]
    title: str | None = Field(default=None, max_length=300)
    data_ref: ChartDataRef | None = None
    encoding: ChartEncoding = Field(default_factory=ChartEncoding)
    presentation: ChartPresentation = Field(default_factory=ChartPresentation)
    # This field is always discarded at model-validation time and populated only by
    # _bind_structured_visualization after the referenced result has been validated.
    data: list[dict[str, Any]] = Field(default_factory=list, max_length=1000)

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_chart_shape(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        payload = dict(value)

        # Never allow a model or stored draft to smuggle rows into the final chart.
        payload.pop("data", None)
        if "chart_type" in payload and "type" not in payload:
            payload["type"] = payload.pop("chart_type")
        else:
            payload.pop("chart_type", None)

        legacy_x = payload.pop("xKey", None)
        legacy_y = payload.pop("yKeys", None)
        encoding = payload.get("encoding")
        encoding_payload = dict(encoding) if isinstance(encoding, dict) else {}
        if legacy_x and "x" not in encoding_payload:
            encoding_payload["x"] = {"field": legacy_x}
        if isinstance(legacy_y, list) and "y" not in encoding_payload:
            encoding_payload["y"] = [{"field": item} for item in legacy_y]
        payload["encoding"] = encoding_payload

        legacy_result_name = payload.pop("result_name", None)
        legacy_result_hash = payload.pop("result_hash", None)
        data_ref = payload.get("data_ref")
        if not isinstance(data_ref, dict) and legacy_result_name:
            payload["data_ref"] = {
                "result_name": legacy_result_name,
                "result_hash": legacy_result_hash or "",
            }

        presentation = payload.get("presentation")
        presentation_payload = dict(presentation) if isinstance(presentation, dict) else {}
        # Accept old top-level display hints while keeping the serialized contract flat-free.
        for legacy_key in ("orientation", "stack", "palette"):
            if legacy_key in payload and legacy_key not in presentation_payload:
                presentation_payload[legacy_key] = payload.pop(legacy_key)
            else:
                payload.pop(legacy_key, None)
        if payload.get("type") == "horizontal_bar":
            presentation_payload["orientation"] = "horizontal"
        payload["presentation"] = presentation_payload
        return payload


class AnalysisReport(BaseModel):
    """A business-facing report. Technical evidence is collected separately by tools."""

    status: Literal["completed", "waiting_confirmation", "needs_data"]
    title: str
    summary: str
    primary_result: str | None = None
    findings: list[str] = Field(default_factory=list)
    metrics: list[ReportMetric] = Field(default_factory=list)
    evidence: list[str] = Field(default_factory=list)
    action: ReportAction | None = None
    next_actions: list[ReportNextAction] = Field(default_factory=list, max_length=3)
    # Kept for stored reports and older clients. New reports derive this from next_actions.
    follow_ups: list[str] = Field(default_factory=list)
    confirmation: ConfirmationRequest | None = None
    visualization: ChartSpec | None = None
