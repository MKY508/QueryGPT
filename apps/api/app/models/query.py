"""Typed query inputs shared by autonomous and deterministic execution."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class StructuredQueryFilter(BaseModel):
    """A schema-bound filter that the runtime compiles instead of trusting raw SQL."""

    column: str = Field(min_length=1, max_length=160)
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
    value: Any | None = None


class SemanticDimensionFilter(BaseModel):
    """A filter bound to a confirmed dimension instead of a physical column name."""

    dimension_key: str = Field(min_length=1, max_length=160)
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
        "year_eq",
    ] = "eq"
    value: Any | None = None


class StructuredQueryMetric(BaseModel):
    """A deterministic aggregation over a real source column."""

    operation: Literal["count", "count_distinct", "sum", "avg", "min", "max"]
    column: str | None = Field(default=None, max_length=160)
    alias: str | None = Field(default=None, max_length=80)


class StructuredFormulaMetric(BaseModel):
    """Server-resolved metric formula that is never exposed as a model tool input."""

    operation: Literal["sum", "avg"]
    formula: dict[str, Any]
    alias: str


class StructuredQuerySort(BaseModel):
    """Ordering over a selected dimension or metric alias."""

    field: str = Field(min_length=1, max_length=160)
    direction: Literal["asc", "desc"] = "desc"
