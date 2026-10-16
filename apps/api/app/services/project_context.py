"""Resolve project-scoped sources, knowledge and safe runtime configuration."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import encryptor
from app.core.config import settings
from app.db.tables import (
    AnalysisRun,
    Connection,
    PreflightReportRecord,
    Project,
    ProjectDataSource,
    SemanticEntry,
    SemanticScopeNode,
)
from app.models.workspace import (
    AnalysisPlaybookResponse,
    RelationshipDefinition,
    TrustedProjectReferenceResponse,
    is_executable_semantic_definition,
)
from app.services.business_decision_slots import canonicalize_decision_key
from app.services.conversation_context import compact_report_context
from app.services.correction_completion import is_reusable_full_relationship_evidence
from app.services.semantic_scopes import (
    ensure_semantic_scope_tree,
    reconcile_unscoped_semantic_entries,
    semantic_scope_runtime_payload,
)
from app.services.source_activation import (
    BLOCKING_FILE_DRIFT_ISSUE_CODES,
    file_source_blockers,
    is_current_source,
)


def _view_name(source: ProjectDataSource) -> str:
    logical_name = str((source.profile_data or {}).get("logical_name") or "").strip()
    if logical_name:
        return logical_name
    stem = re.sub(r"[^a-zA-Z0-9_]+", "_", Path(source.name).stem).strip("_").lower()
    return f"{stem or 'source'}_{str(source.id).replace('-', '')[:6]}"


def _canonical_column(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff]", "", value.lower())
    aliases = {
        "门店id": "storeid",
        "门店编号": "storeid",
        "店铺id": "storeid",
        "shopid": "storeid",
        "订单id": "orderid",
        "订单编号": "orderid",
        "商品id": "productid",
        "产品id": "productid",
    }
    return aliases.get(normalized, normalized)


_PLAYBOOK_STEP_PUBLIC_FIELDS = (
    "order",
    "kind",
    "summary",
    "input_results",
    "output_result",
    "source_roles",
    "required_columns",
    "rule_key",
    "action_kind",
    "column",
    "operator",
    "values",
    "relationship_key",
    "definition_hash",
    "left_key",
    "right_key",
    "join_mode",
    "normalization",
    "group_by",
    "operation",
    "value_column",
    "output_column",
    "analysis_kind",
    "requires_replanning",
    "key_columns",
    "numeric_columns",
    "must_not_be_truncated",
    "chart_type",
    "x",
    "y",
    "value",
    "color",
)

_RUNTIME_TRUSTED_REFERENCE_LIMIT = 5
_RUNTIME_CONFIRMED_KNOWLEDGE_LIMIT = 48
_RUNTIME_CANDIDATE_KNOWLEDGE_LIMIT = 24
_RUNTIME_CONFIRMED_RELATIONSHIP_LIMIT = 32
_RUNTIME_CANDIDATE_RELATIONSHIP_LIMIT = 12
_RUNTIME_RECENT_ANALYSIS_SOURCE_LIMIT = 32
_RUNTIME_RECENT_ANALYSIS_LIMIT = 8
_RUNTIME_RECENT_ANALYSIS_CHAR_BUDGET = 8_000


def _globally_visible_semantic(item: dict[str, Any]) -> bool:
    scope_kind = item.get("scope_kind")
    if scope_kind == "project":
        return True
    if scope_kind is not None:
        return False
    # Compatibility for old in-memory/test contexts that predate scope fields.
    # Production DB payloads always carry `type`; an unresolved executable
    # definition therefore remains hidden rather than falling back to global.
    return "type" not in item or not is_executable_semantic_definition(item.get("definition"))


def _semantic_query_terms(query: str | None) -> tuple[str, ...]:
    """Return deterministic lexical terms without retaining the user's query."""

    if not query or not query.strip():
        return ()
    normalized = unicodedata.normalize("NFKC", query).casefold()[:512]
    terms: set[str] = set()
    for token in re.findall(r"[a-z0-9_]+|[\u4e00-\u9fff]+", normalized):
        if not token:
            continue
        terms.add(token)
        if re.fullmatch(r"[\u4e00-\u9fff]+", token) and len(token) > 2:
            # Chinese questions normally do not contain word separators. Short
            # n-grams let table, column and business terms still rank naturally.
            for size in range(2, min(4, len(token)) + 1):
                terms.update(token[index : index + size] for index in range(len(token) - size + 1))
    return tuple(sorted(terms, key=lambda value: (-len(value), value))[:96])


def _semantic_search_fields(item: dict[str, Any]) -> tuple[tuple[str, int], ...]:
    fields: list[tuple[str, int]] = []
    for key, weight in (
        ("key", 8),
        ("value", 6),
        ("column", 5),
        ("table", 5),
        ("source", 4),
        ("sources", 4),
    ):
        value = item.get(key)
        if value not in (None, ""):
            fields.append((str(value), weight))
    for key, weight in (("definition", 5), ("resolved_sources", 5), ("evidence", 3)):
        value = item.get(key)
        if value not in (None, {}, []):
            fields.append(
                (
                    json.dumps(
                        value,
                        ensure_ascii=False,
                        sort_keys=True,
                        separators=(",", ":"),
                        default=str,
                    ),
                    weight,
                )
            )
    return tuple(fields)


def _semantic_relevance(item: dict[str, Any], query_terms: tuple[str, ...]) -> int:
    if not query_terms:
        return 0
    score = 0
    for raw_value, weight in _semantic_search_fields(item):
        value = unicodedata.normalize("NFKC", raw_value).casefold()
        score += sum(weight * min(len(term), 12) for term in query_terms if term in value)
    return score


def _semantic_sort_key(item: dict[str, Any], query_terms: tuple[str, ...]) -> tuple[Any, ...]:
    state_rank = {"locked": 0, "confirmed": 1, "candidate": 2}
    validity_rank = {"active": 0, "unverified": 1, "stale": 2}
    stable_identity = json.dumps(
        {
            "id": item.get("id"),
            "key": item.get("key"),
            "value": item.get("value"),
            "definition": item.get("definition"),
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return (
        -_semantic_relevance(item, query_terms),
        state_rank.get(str(item.get("state") or ""), 3),
        validity_rank.get(str(item.get("validity") or ""), 3),
        item.get("execution_state") != "verified",
        -float(item.get("confidence") or 0),
        stable_identity,
    )


def _budget_semantic_items(
    items: list[dict[str, Any]],
    *,
    limit: int,
    query_terms: tuple[str, ...],
) -> tuple[list[dict[str, Any]], dict[str, int | bool]]:
    ranked = sorted(items, key=lambda item: _semantic_sort_key(item, query_terms))
    included = ranked[:limit]
    return included, {
        "total": len(items),
        "included": len(included),
        "truncated": len(included) < len(items),
    }


def required_relationship_validation_status(
    required_validations: list[dict[str, Any]],
    tool_history: list[dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    """Match every required semantic head to exact, full-scope runtime evidence."""

    matched: dict[str, dict[str, Any]] = {}
    for evidence in tool_history:
        if evidence.get("kind") not in {
            "relationship_validation",
            "relationship_application",
        }:
            continue
        entry_id = str(evidence.get("semantic_entry_id") or "")
        if not entry_id or entry_id in matched:
            continue
        required = next(
            (
                item
                for item in required_validations
                if str(item.get("semantic_entry_id") or "") == entry_id
            ),
            None,
        )
        if required is None:
            continue
        evidence_key = str(
            evidence.get("candidate_relationship_key") or evidence.get("relationship_key") or ""
        )
        if (
            str(evidence.get("active_revision_id") or "")
            != str(required.get("expected_active_revision_id") or "")
            or str(evidence.get("definition_hash") or "")
            != str(required.get("definition_hash") or "")
            or evidence_key != str(required.get("relationship_key") or "")
            or not is_reusable_full_relationship_evidence(evidence)
        ):
            continue
        matched[entry_id] = evidence
    missing = [
        item
        for item in required_validations
        if str(item.get("semantic_entry_id") or "") not in matched
    ]
    return matched, missing


def _compact_playbook_step(step: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for key in _PLAYBOOK_STEP_PUBLIC_FIELDS:
        value = step.get(key)
        if value is None:
            continue
        if isinstance(value, list):
            value = value[:40]
        payload[key] = value
    return payload


def _compact_trusted_reference(item: dict[str, Any]) -> dict[str, Any]:
    report = item.get("report") or {}
    return {
        "id": item.get("id"),
        "run_id": item.get("run_id"),
        "query": item.get("query"),
        "title": item.get("title"),
        "historical": True,
        "usage_policy": "historical_hypothesis_only",
        "requires_current_revalidation": True,
        "report": {
            "summary": report.get("summary"),
            "metrics": list(report.get("metrics") or [])[:20],
            "conclusions": list(report.get("conclusions") or [])[:20],
            "historical": True,
        },
        "source_roles": list(item.get("source_roles") or [])[:20],
        "confirmed_knowledge_keys": list(item.get("confirmed_knowledge_keys") or [])[:50],
        "validation_evidence": list(item.get("validation_evidence") or [])[:10],
        "created_at": item.get("created_at"),
        "updated_at": item.get("updated_at"),
    }


def _compact_recent_analysis(
    run: Any,
    *,
    same_conversation: bool,
) -> dict[str, Any] | None:
    report = compact_report_context(run.report)
    if report is None or report.get("status") not in {None, "completed"}:
        return None
    query = re.sub(r"\s+", " ", str(run.query or "")).strip()
    if not query:
        return None
    return {
        "analysis_run_id": str(run.id),
        "same_conversation": same_conversation,
        "query": query[:1_000],
        "report": report,
        "updated_at": run.updated_at.isoformat() if run.updated_at else None,
        "historical": True,
        "usage_policy": "continue_task_but_revalidate_current_data",
        "requires_current_revalidation": True,
    }


def _recent_analysis_relevance(
    item: dict[str, Any],
    query_terms: tuple[str, ...],
) -> int:
    if not query_terms:
        return 0
    report = item.get("report") or {}
    searchable = json.dumps(
        {
            "query": item.get("query"),
            "title": report.get("title"),
            "summary": report.get("summary"),
            "findings": report.get("findings"),
            "metrics": report.get("metrics"),
            "visualization": report.get("visualization"),
        },
        ensure_ascii=False,
        separators=(",", ":"),
        default=str,
    ).casefold()
    return sum(min(len(term), 12) for term in query_terms if term in searchable)


def _budget_recent_analyses(
    items: list[dict[str, Any]],
    *,
    query_terms: tuple[str, ...],
) -> tuple[list[dict[str, Any]], dict[str, int | bool]]:
    indexed = list(enumerate(items))

    def rank(value: tuple[int, dict[str, Any]]) -> tuple[int, int, int]:
        index, item = value
        same_conversation = bool(item.get("same_conversation"))
        if same_conversation and index < 2:
            continuity_rank = 0
        elif same_conversation:
            continuity_rank = 1
        else:
            continuity_rank = 2
        return (
            continuity_rank,
            -_recent_analysis_relevance(item, query_terms),
            index,
        )

    selected: list[dict[str, Any]] = []
    used = 0
    for _, item in sorted(indexed, key=rank):
        serialized = json.dumps(
            item,
            ensure_ascii=False,
            separators=(",", ":"),
            default=str,
        )
        if selected and used + len(serialized) > _RUNTIME_RECENT_ANALYSIS_CHAR_BUDGET:
            continue
        selected.append(item)
        used += len(serialized)
        if len(selected) >= _RUNTIME_RECENT_ANALYSIS_LIMIT:
            break
    return selected, {
        "total": len(items),
        "included": len(selected),
        "same_conversation_included": sum(1 for item in selected if item.get("same_conversation")),
        "truncated": len(selected) < len(items),
    }


def _compact_column_profile(item: dict[str, Any]) -> dict[str, Any]:
    allowed = (
        "table",
        "column",
        "name",
        "type",
        "dtype",
        "declared_type",
        "role",
        "status",
        "missing",
        "non_null",
        "sample_unique",
        "uniqueness",
        "value_visibility",
        "distribution",
        "range",
        "sampled",
        "nullable",
        "primary_key",
        "unique",
    )
    payload = {key: item[key] for key in allowed if item.get(key) is not None}
    if isinstance(item.get("top_values"), list):
        payload["top_values"] = list(item["top_values"])[:12]
    return payload


def _compact_preanalysis(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    payload = {
        key: value[key]
        for key in (
            "generated_by",
            "requires_query_verification",
            "read_only",
            "shape",
            "budget",
        )
        if value.get(key) is not None
    }
    payload["candidate_roles"] = [
        _compact_column_profile(item)
        for item in (value.get("candidate_roles") or [])[:240]
        if isinstance(item, dict)
    ]
    payload["candidate_grain"] = [
        dict(item) for item in (value.get("candidate_grain") or [])[:60] if isinstance(item, dict)
    ]
    payload["relationship_evidence"] = [
        {
            key: item.get(key)
            for key in (
                "kind",
                "state",
                "validity",
                "catalog_verified",
                "binding_complete",
                "automatic_confirmation",
                "requires_value_validation",
                "constraint_name",
                "source",
                "target",
                "on_update",
                "on_delete",
            )
            if item.get(key) is not None
        }
        for item in (value.get("relationship_evidence") or [])[:60]
        if isinstance(item, dict)
    ]
    payload["partial_failures"] = [
        {
            key: item.get(key)
            for key in ("table", "code", "message", "error_type")
            if item.get(key) is not None
        }
        for item in (value.get("partial_failures") or [])[:24]
        if isinstance(item, dict)
    ]
    payload["tables"] = [
        {
            "table": item.get("table"),
            "status": item.get("status"),
            "sample": item.get("sample"),
            "candidate_grain": list(item.get("candidate_grain") or [])[:12],
        }
        for item in (value.get("tables") or [])[:24]
        if isinstance(item, dict)
    ]
    return payload


def _compact_source_profile(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    payload = {
        key: value[key]
        for key in (
            "summary",
            "logical_name",
            "version",
            "is_current",
            "activation_state",
            "replacement_of",
            "profile_status",
        )
        if value.get(key) is not None
    }
    schema = value.get("schema") or {}
    if isinstance(schema, dict):
        payload["schema"] = {
            key: schema[key]
            for key in ("shape", "types", "candidate_grain")
            if schema.get(key) is not None
        }
        payload["schema"]["columns"] = [
            _compact_column_profile(item)
            for item in (schema.get("columns") or [])[:240]
            if isinstance(item, dict)
        ]
    payload["tables"] = [
        {
            "name": table.get("name"),
            "schema": table.get("schema"),
            "kind": table.get("kind"),
            "column_metadata_status": table.get("column_metadata_status"),
            "constraint_metadata_status": table.get("constraint_metadata_status"),
            "primary_key": table.get("primary_key"),
            "unique_constraints": list(table.get("unique_constraints") or [])[:24]
            if table.get("unique_constraints") is not None
            else None,
            "foreign_keys": list(table.get("foreign_keys") or [])[:24]
            if table.get("foreign_keys") is not None
            else None,
            "columns": [
                _compact_column_profile(column)
                for column in (table.get("columns") or [])[:80]
                if isinstance(column, dict)
            ],
        }
        for table in (value.get("tables") or [])[:24]
        if isinstance(table, dict)
    ]
    payload["preanalysis"] = _compact_preanalysis(value.get("preanalysis"))
    payload["issues"] = [
        {
            key: issue.get(key)
            for key in ("code", "title", "detail", "severity", "automatic")
            if issue.get(key) is not None
        }
        for issue in (value.get("issues") or [])[:30]
        if isinstance(issue, dict)
    ]
    payload["ambiguities"] = [
        {
            key: ambiguity.get(key)
            for key in ("key", "question", "options", "impact", "status")
            if ambiguity.get(key) is not None
        }
        for ambiguity in (value.get("ambiguities") or [])[:20]
        if isinstance(ambiguity, dict)
    ]
    return payload


def _public_source(source: dict[str, Any]) -> dict[str, Any]:
    profile = _compact_source_profile(source.get("profile"))
    preanalysis = profile.pop("preanalysis", {})
    return {
        "id": source["id"],
        "name": source["name"],
        "kind": source["kind"],
        "format": source.get("format"),
        "status": source.get("status"),
        "query_name": source.get("view_name") or source.get("connection_name"),
        "preanalysis": preanalysis,
        "profile": profile,
    }


@dataclass(slots=True)
class ProjectRuntimeContext:
    project_id: UUID | None = None
    name: str = "临时分析"
    sources: list[dict[str, Any]] = field(default_factory=list)
    pending_sources: list[dict[str, Any]] = field(default_factory=list)
    connection_configs: dict[str, dict[str, Any]] = field(default_factory=dict)
    confirmed_knowledge: list[dict[str, Any]] = field(default_factory=list)
    semantic_scopes: list[dict[str, Any]] = field(default_factory=list)
    candidate_knowledge: list[dict[str, Any]] = field(default_factory=list)
    candidate_relationships: list[dict[str, Any]] = field(default_factory=list)
    executable_relationships: dict[str, dict[str, Any]] = field(default_factory=dict)
    stale_relationships: list[dict[str, Any]] = field(default_factory=list)
    semantic_diagnostics: list[dict[str, Any]] = field(default_factory=list)
    reusable_analyses: list[dict[str, Any]] = field(default_factory=list)
    required_analysis: dict[str, Any] | None = None
    required_correction: dict[str, Any] | None = None
    required_relationship_validations: list[dict[str, Any]] = field(default_factory=list)
    golden_scenarios: list[dict[str, Any]] = field(default_factory=list)
    active_trusted_references: list[dict[str, Any]] = field(default_factory=list)
    recent_analyses: list[dict[str, Any]] = field(default_factory=list)

    @property
    def project_dir(self) -> Path:
        identifier = str(self.project_id) if self.project_id else "temporary"
        return settings.WORKSPACE_ROOT / identifier

    def public_summary(self, query: str | None = None) -> dict[str, Any]:
        query_terms = _semantic_query_terms(query)
        globally_visible_knowledge = [
            item for item in self.confirmed_knowledge if _globally_visible_semantic(item)
        ]
        confirmed_knowledge, confirmed_knowledge_meta = _budget_semantic_items(
            globally_visible_knowledge,
            limit=_RUNTIME_CONFIRMED_KNOWLEDGE_LIMIT,
            query_terms=query_terms,
        )
        # Candidates remain available to system-owned validation contracts, but
        # they are never part of the ordinary model prompt.  In particular,
        # exposing a candidate metric definition here would let the model copy
        # its operation/column into a raw query without a semantic receipt.
        candidate_knowledge, candidate_knowledge_meta = _budget_semantic_items(
            [],
            limit=_RUNTIME_CANDIDATE_KNOWLEDGE_LIMIT,
            query_terms=query_terms,
        )
        confirmed_relationships, confirmed_relationships_meta = _budget_semantic_items(
            [
                item
                for item in self.executable_relationships.values()
                if _globally_visible_semantic(item)
            ],
            limit=_RUNTIME_CONFIRMED_RELATIONSHIP_LIMIT,
            query_terms=query_terms,
        )
        relationship_hints, candidate_relationships_meta = _budget_semantic_items(
            [],
            limit=_RUNTIME_CANDIDATE_RELATIONSHIP_LIMIT,
            query_terms=query_terms,
        )
        recent_analyses, recent_analyses_meta = _budget_recent_analyses(
            self.recent_analyses,
            query_terms=query_terms,
        )
        return {
            "project": self.name,
            "sources": [_public_source(source) for source in self.sources],
            "pending_sources": [
                {
                    "id": source["id"],
                    "name": source["name"],
                    "status": source.get("status"),
                    "replaces_source_id": source.get("replaces_source_id"),
                    "summary": source.get("summary"),
                    "attention_reason": source.get("attention_reason"),
                    "issues": source.get("issues", []),
                }
                for source in self.pending_sources
            ],
            "confirmed_knowledge": confirmed_knowledge,
            "candidate_knowledge": candidate_knowledge,
            "candidate_relationships": [
                {
                    key: relationship.get(key)
                    for key in ("key", "value", "validity", "column", "sources")
                    if relationship.get(key) is not None
                }
                for relationship in relationship_hints
            ],
            "confirmed_relationships": confirmed_relationships,
            "semantic_context": {
                "query_scoped": bool(query_terms),
                "confirmed_knowledge": confirmed_knowledge_meta,
                "candidate_knowledge": candidate_knowledge_meta,
                "confirmed_relationships": confirmed_relationships_meta,
                "candidate_relationships": candidate_relationships_meta,
            },
            "recent_analyses": recent_analyses,
            "recent_analysis_context": {
                **recent_analyses_meta,
                "query_scoped": bool(query_terms),
                "policy": "historical_context_only_revalidate_current_data",
            },
            "reusable_analyses": [
                {
                    "schema_version": item.get("schema_version"),
                    "execution_mode": item.get("execution_mode"),
                    "id": item.get("id"),
                    "name": item.get("name"),
                    "query": item.get("query"),
                    "binding_policy": item.get("binding_policy"),
                    "requires_revalidation": item.get("requires_revalidation"),
                    "shape_hash": item.get("shape_hash"),
                    "source_roles": [
                        {
                            "logical_name": source.get("logical_name"),
                            "source_kind": source.get("source_kind"),
                            "tables": list(source.get("tables") or [])[:20],
                            "columns": [
                                {
                                    "table": column.get("table"),
                                    "name": column.get("name"),
                                    "data_type": column.get("data_type"),
                                    "canonical_type": column.get("canonical_type"),
                                }
                                for column in (source.get("columns") or [])[:80]
                            ],
                            "schema_signature": source.get("schema_signature"),
                        }
                        for source in (item.get("source_roles") or [])[:12]
                    ],
                    "confirmed_knowledge_keys": list(item.get("confirmed_knowledge_keys") or [])[
                        :20
                    ],
                    "relationship_keys": list(item.get("relationship_keys") or [])[:20],
                    "steps": [
                        _compact_playbook_step(step) for step in (item.get("steps") or [])[:20]
                    ],
                    "validation": {
                        "input_result": (item.get("validation") or {}).get("input_result"),
                        "columns": list((item.get("validation") or {}).get("columns") or [])[:40],
                        "key_columns": list(
                            (item.get("validation") or {}).get("key_columns") or []
                        )[:20],
                        "numeric_columns": list(
                            (item.get("validation") or {}).get("numeric_columns") or []
                        )[:20],
                        "must_not_be_truncated": (item.get("validation") or {}).get(
                            "must_not_be_truncated"
                        ),
                    },
                }
                for item in self.reusable_analyses[-20:]
            ],
            "required_analysis": (
                {
                    "id": self.required_analysis.get("id"),
                    "shape_hash": self.required_analysis.get("shape_hash"),
                    "execution_mode": self.required_analysis.get("execution_mode"),
                    "enforcement": "execute_current_data_and_revalidate_every_required_step",
                }
                if self.required_analysis is not None
                else None
            ),
            "required_correction": (
                {
                    "id": self.required_correction.get("id"),
                    "target_key": self.required_correction.get("target_key"),
                    "text": self.required_correction.get("text"),
                    "correction_type": self.required_correction.get("correction_type"),
                    "source_run_id": self.required_correction.get("source_run_id"),
                    "semantic_entry_id": self.required_correction.get("semantic_entry_id"),
                    "expected_active_revision_id": self.required_correction.get(
                        "expected_active_revision_id"
                    ),
                    "definition_hash": self.required_correction.get("definition_hash"),
                    "execution_state": self.required_correction.get("execution_state"),
                    "executable": bool(self.required_correction.get("executable")),
                    "requirement": "reinvestigate_current_data_and_record_how_the_correction_was_used",
                }
                if self.required_correction is not None
                else None
            ),
            "required_relationship_validations": [
                {
                    "semantic_entry_id": item.get("semantic_entry_id"),
                    "expected_active_revision_id": item.get("expected_active_revision_id"),
                    "relationship_key": item.get("relationship_key"),
                    "definition_hash": item.get("definition_hash"),
                    "value": item.get("value"),
                    "definition": item.get("definition"),
                    "requirement": (
                        "validate_this_exact_revision_on_complete_current_data_and_record_evidence"
                    ),
                }
                for item in self.required_relationship_validations
            ],
            "active_trusted_references": [
                _compact_trusted_reference(item)
                for item in self.active_trusted_references[:_RUNTIME_TRUSTED_REFERENCE_LIMIT]
            ],
            "learned_regressions": len(self.golden_scenarios),
        }


def _logical_source_name(source: dict[str, Any]) -> str:
    profile = source.get("profile") or {}
    return str(profile.get("logical_name") or source.get("name") or "")


def _profile_issues(profile: dict[str, Any]) -> list[dict[str, Any]]:
    issues = profile.get("issues")
    if not isinstance(issues, list):
        return []
    return [dict(item) for item in issues if isinstance(item, dict)]


def _file_source_runtime_blockers(
    source: ProjectDataSource,
    profile: dict[str, Any],
) -> set[str]:
    """Return data-drift reasons that make a file unsafe for analysis."""

    return file_source_blockers(source.kind, profile)


def _pending_source_payload(
    source: ProjectDataSource,
    profile: dict[str, Any],
    *,
    blockers: set[str],
) -> dict[str, Any]:
    issues = _profile_issues(profile)
    if blockers:
        attention_reason = (
            "整理方法与当前文件不再一致，需要核对后才能用于分析。"
            if blockers & BLOCKING_FILE_DRIFT_ISSUE_CODES
            else "这个数据版本尚未确认，当前分析不会使用它。"
        )
    else:
        attention_reason = "这个数据版本尚未启用，当前分析不会使用它。"
    return {
        "id": str(source.id),
        "name": source.name,
        "kind": source.kind,
        "format": source.format,
        "status": "needs_attention" if blockers else source.status,
        "replaces_source_id": profile.get("replacement_of"),
        "activation_state": profile.get("activation_state"),
        "summary": profile.get("summary") or attention_reason,
        "attention_reason": attention_reason,
        "issues": issues,
    }


def _candidate_references_pending_source(
    entry: SemanticEntry,
    pending_sources: list[dict[str, Any]],
) -> bool:
    """Keep inferred knowledge from a blocked file out of the runtime prompt."""

    pending_ids = {str(item.get("id") or "") for item in pending_sources}
    pending_names = {str(item.get("name") or "") for item in pending_sources}
    for evidence in entry.evidence or []:
        if not isinstance(evidence, dict):
            continue
        if str(evidence.get("source_id") or "") in pending_ids:
            return True
        labels = evidence.get("sources")
        if not isinstance(labels, list):
            continue
        for label in labels:
            label_text = str(label)
            if any(
                name and (label_text == name or label_text.startswith(f"{name}."))
                for name in pending_names
            ):
                return True
    return False


def _source_column_details(source: dict[str, Any], table_or_view: str) -> list[dict[str, Any]]:
    profile = source.get("profile") or {}
    if source.get("kind") == "file":
        return list((profile.get("schema") or {}).get("columns") or [])
    tables = [table for table in profile.get("tables") or [] if isinstance(table, dict)]
    exact_matches = []
    for table in tables:
        name = str(table.get("name") or "").strip()
        schema = str(table.get("schema") or "").strip()
        canonical = f"{schema}.{name}" if schema and name else name
        if canonical.casefold() == table_or_view.strip().casefold():
            exact_matches.append(table)
    if len(exact_matches) == 1:
        return list(exact_matches[0].get("columns") or [])
    if "." not in table_or_view:
        bare_matches = [
            table
            for table in tables
            if str(table.get("name") or "").strip().casefold() == table_or_view.strip().casefold()
        ]
        if len(bare_matches) == 1:
            return list(bare_matches[0].get("columns") or [])
    return []


def _schema_signature(columns: list[dict[str, Any]]) -> str:
    payload = json.dumps(
        sorted(
            [
                {
                    "name": str(column.get("name") or ""),
                    "type": str(column.get("type") or column.get("dtype") or "unknown"),
                }
                for column in columns
            ],
            key=lambda item: (item["name"], item["type"]),
        ),
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _resolve_relationship(
    entry: SemanticEntry,
    sources: list[dict[str, Any]],
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    try:
        definition = RelationshipDefinition.model_validate(entry.definition).model_dump()
    except Exception as exc:
        return None, {
            "key": entry.key,
            "kind": "invalid_relationship_definition",
            "detail": str(exc),
        }

    resolved_sources: dict[str, dict[str, Any]] = {}
    validity = str(entry.validity or "unverified")
    stale_reasons: list[str] = []
    for side in ("left", "right"):
        endpoint = definition[side]
        matching_sources = [
            item
            for item in sources
            if item.get("kind") == endpoint["source_kind"]
            and _logical_source_name(item) == endpoint["source_logical_name"]
        ]
        if not matching_sources:
            stale_reasons.append(f"找不到数据源 {endpoint['source_logical_name']}")
            continue
        if len(matching_sources) != 1:
            return None, {
                "key": entry.key,
                "kind": "ambiguous_relationship_source",
                "detail": (
                    f"数据源名称 {endpoint['source_logical_name']} 对应多个当前来源，"
                    "关系已停止使用，请先为来源设置可区分的名称"
                ),
            }
        source = matching_sources[0]
        columns = _source_column_details(source, endpoint["table_or_view"])
        current_column = next(
            (column for column in columns if str(column.get("name") or "") == endpoint["column"]),
            None,
        )
        if current_column is None:
            stale_reasons.append(f"{endpoint['source_logical_name']} 缺少字段 {endpoint['column']}")
            continue
        if _schema_signature(columns) != endpoint["schema_signature"]:
            validity = "unverified"
        resolved_sources[side] = {
            "source_id": str(source.get("id") or ""),
            "source_logical_name": _logical_source_name(source),
            "source_kind": source.get("kind"),
            "table_or_view": endpoint["table_or_view"],
            "column": endpoint["column"],
        }

    if stale_reasons:
        validity = "stale"
    definition_payload = json.dumps(
        definition, sort_keys=True, ensure_ascii=False, separators=(",", ":")
    )
    resolved = {
        "id": str(entry.id),
        "active_revision_id": (str(entry.active_revision_id) if entry.active_revision_id else None),
        "key": entry.key,
        "value": entry.value,
        "state": entry.state,
        "confidence": entry.confidence,
        "validity": validity,
        "execution_state": entry.execution_state,
        "definition": definition,
        "definition_hash": hashlib.sha256(definition_payload.encode("utf-8")).hexdigest(),
        "evidence": list(entry.evidence or []),
        "resolved_sources": resolved_sources,
        "stale_reasons": stale_reasons,
    }
    return resolved, None


async def load_project_context(
    db: AsyncSession,
    project_id: UUID | None,
    fallback_db_config: dict[str, Any] | None = None,
    semantic_validation_selection: list[dict[str, Any]] | None = None,
    conversation_id: UUID | None = None,
) -> ProjectRuntimeContext:
    if project_id is None:
        context = ProjectRuntimeContext()
        if fallback_db_config:
            context.connection_configs["default"] = fallback_db_config
            context.sources.append(
                {
                    "id": "default",
                    "name": "当前数据库",
                    "kind": "connection",
                    "format": fallback_db_config.get("driver"),
                    "status": "ready",
                    "connection_name": "default",
                    "profile": {},
                }
            )
        return context

    project = await db.get(Project, project_id)
    if project is None:
        raise ValueError("项目不存在")
    # Governance screens keep strict scope validation, while analysis runtime
    # degrades safely: ambiguous sources are omitted from the scope tree and
    # their definitions are diagnosed below instead of blocking the project.
    await ensure_semantic_scope_tree(
        db,
        project_id,
        tolerate_ambiguous_sources=True,
    )
    await reconcile_unscoped_semantic_entries(
        db,
        project_id,
        tolerate_ambiguous_sources=True,
    )
    scope_result = await db.execute(
        select(SemanticScopeNode).where(SemanticScopeNode.project_id == project_id)
    )
    semantic_scope_nodes = list(scope_result.scalars())
    semantic_scope_by_id = {item.id: item for item in semantic_scope_nodes}
    extra_data = project.extra_data or {}
    reusable_playbooks: list[AnalysisPlaybookResponse] = []
    for item in extra_data.get("analysis_playbooks") or []:
        try:
            reusable_playbooks.append(AnalysisPlaybookResponse.model_validate(item))
        except ValueError:
            continue
    reusable_playbooks.sort(key=lambda item: item.updated_at)
    reusable_analyses = [item.model_dump(mode="json") for item in reusable_playbooks]
    active_references: list[TrustedProjectReferenceResponse] = []
    for item in extra_data.get("trusted_references") or []:
        try:
            reference = TrustedProjectReferenceResponse.model_validate(item)
        except ValueError:
            continue
        if reference.state == "active":
            active_references.append(reference)
    active_references.sort(key=lambda item: item.updated_at, reverse=True)
    context = ProjectRuntimeContext(
        project_id=project_id,
        name=project.name,
        semantic_scopes=[
            {
                "id": str(node.id),
                "parent_id": str(node.parent_id) if node.parent_id else None,
                "kind": node.kind,
                "business_name": node.business_name,
                "description": node.description,
                "source_logical_name": node.source_logical_name,
                "table_or_view": node.table_or_view,
                "context_facts": dict(node.context_facts or {}),
                "path": semantic_scope_runtime_payload(
                    node,
                    semantic_scope_nodes,
                )["scope_path"],
            }
            for node in semantic_scope_nodes
            if node.is_active
        ],
        reusable_analyses=reusable_analyses,
        golden_scenarios=list(extra_data.get("golden_scenarios") or []),
        active_trusted_references=[
            item.model_dump(mode="json")
            for item in active_references[:_RUNTIME_TRUSTED_REFERENCE_LIMIT]
        ],
    )
    analysis_history_result = await db.execute(
        select(
            AnalysisRun.id,
            AnalysisRun.conversation_id,
            AnalysisRun.query,
            AnalysisRun.report,
            AnalysisRun.updated_at,
        )
        .where(
            AnalysisRun.project_id == project_id,
            AnalysisRun.state == "completed",
        )
        .order_by(AnalysisRun.updated_at.desc(), AnalysisRun.created_at.desc())
        .limit(_RUNTIME_RECENT_ANALYSIS_SOURCE_LIMIT)
    )
    for previous_run in analysis_history_result:
        compact = _compact_recent_analysis(
            previous_run,
            same_conversation=bool(
                conversation_id is not None and previous_run.conversation_id == conversation_id
            ),
        )
        if compact is not None:
            context.recent_analyses.append(compact)
    selected_relationship_ids = (
        {
            str(item.get("semantic_entry_id") or item.get("entry_id") or "")
            for item in semantic_validation_selection
        }
        if semantic_validation_selection is not None
        else None
    )
    source_result = await db.execute(
        select(ProjectDataSource)
        .where(
            ProjectDataSource.project_id == project_id,
            ProjectDataSource.status != "superseded",
        )
        .order_by(ProjectDataSource.created_at)
    )
    sources = list(source_result.scalars())
    for source in sources:
        profile = source.profile_data or {}
        runtime_blockers = _file_source_runtime_blockers(source, profile)
        if not is_current_source(source):
            context.pending_sources.append(
                _pending_source_payload(
                    source,
                    profile,
                    blockers=runtime_blockers,
                )
            )
            continue
        item: dict[str, Any] = {
            "id": str(source.id),
            "name": source.name,
            "kind": source.kind,
            "format": source.format,
            "status": source.status,
            "fingerprint": source.fingerprint,
            "profile": source.profile_data or {},
        }
        if source.kind == "file":
            item["view_name"] = _view_name(source)
            item["working_uri"] = source.working_uri
            item["source_uri"] = source.source_uri
        elif source.connection_id:
            connection = await db.get(Connection, source.connection_id)
            if connection:
                key = str(source.id)
                password = (
                    encryptor.decrypt(connection.password_encrypted)
                    if connection.password_encrypted
                    else ""
                )
                context.connection_configs[key] = {
                    "driver": connection.driver,
                    "host": connection.host,
                    "port": connection.port,
                    "user": connection.username,
                    "password": password,
                    "database": connection.database_name,
                    "extra_options": connection.extra_options or {},
                }
                item["connection_name"] = key
        context.sources.append(item)

    knowledge_result = await db.execute(
        select(SemanticEntry)
        .where(SemanticEntry.project_id == project_id)
        .order_by(SemanticEntry.key)
    )
    knowledge_entries = list(knowledge_result.scalars())
    durable_decision_groups: dict[str, list[SemanticEntry]] = {}
    for entry in knowledge_entries:
        if (
            entry.entry_type != "relationship"
            and entry.state in {"confirmed", "locked"}
            and entry.is_active
            and entry.validity != "stale"
        ):
            durable_decision_groups.setdefault(
                canonicalize_decision_key(entry.key),
                [],
            ).append(entry)

    preferred_decision_entry: dict[str, UUID] = {}
    conflicted_decision_slots: set[str] = set()
    for slot, entries in durable_decision_groups.items():
        meanings = {
            json.dumps(
                {"value": entry.value, "definition": entry.definition},
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            )
            for entry in entries
        }
        if len(meanings) > 1:
            conflicted_decision_slots.add(slot)
            context.semantic_diagnostics.append(
                {
                    "key": slot,
                    "kind": "decision_slot_conflict",
                    "detail": "同一业务问题存在互相冲突的历史答案，解决前不会自动复用。",
                }
            )
            continue
        preferred = sorted(
            entries,
            key=lambda entry: (
                entry.state != "locked",
                entry.key != slot,
                str(entry.id),
            ),
        )[0]
        preferred_decision_entry[slot] = preferred.id

    for entry in knowledge_entries:
        if not entry.is_active or entry.validity == "stale":
            context.semantic_diagnostics.append(
                {
                    "key": entry.key,
                    "kind": "inactive_knowledge_hidden",
                    "detail": "这条项目理解已停用，不再提供给分析运行时。",
                }
            )
            continue
        if entry.state not in {"confirmed", "locked"} and _candidate_references_pending_source(
            entry,
            context.pending_sources,
        ):
            context.semantic_diagnostics.append(
                {
                    "key": entry.key,
                    "kind": "pending_source_candidate_hidden",
                    "detail": "候选理解来自尚待核对的数据版本，确认前不会提供给分析运行时。",
                }
            )
            continue
        decision_slot = (
            canonicalize_decision_key(entry.key)
            if entry.entry_type != "relationship"
            else entry.key
        )
        if entry.entry_type != "relationship" and decision_slot in conflicted_decision_slots:
            continue
        preferred_id = preferred_decision_entry.get(decision_slot)
        if (
            entry.entry_type != "relationship"
            and entry.state in {"confirmed", "locked"}
            and preferred_id is not None
            and entry.id != preferred_id
        ):
            continue
        if (
            entry.entry_type != "relationship"
            and entry.state == "candidate"
            and preferred_id is not None
        ):
            context.semantic_diagnostics.append(
                {
                    "key": decision_slot,
                    "kind": "candidate_shadowed_by_confirmed_decision",
                    "detail": "候选说法与已确认的同一业务问题重复，未提供给运行时。",
                }
            )
            continue
        payload = {
            "id": str(entry.id),
            "active_revision_id": (
                str(entry.active_revision_id) if entry.active_revision_id else None
            ),
            "key": decision_slot,
            "value": entry.value,
            "type": entry.entry_type,
            "state": entry.state,
            "confidence": entry.confidence,
            "definition": entry.definition,
            "definition_hash": hashlib.sha256(
                json.dumps(
                    entry.definition,
                    sort_keys=True,
                    ensure_ascii=False,
                    separators=(",", ":"),
                ).encode("utf-8")
            ).hexdigest(),
            "validity": entry.validity,
            "execution_state": entry.execution_state,
            "execution_details": entry.execution_details,
            "evidence": entry.evidence,
            **semantic_scope_runtime_payload(
                semantic_scope_by_id.get(entry.scope_id) if entry.scope_id else None,
                semantic_scope_nodes,
            ),
        }
        if entry.entry_type != "relationship":
            if entry.state in {"confirmed", "locked"}:
                context.confirmed_knowledge.append(payload)
            else:
                context.candidate_knowledge.append(payload)
        if entry.entry_type == "relationship":
            relationship, diagnostic = _resolve_relationship(entry, context.sources)
            if relationship is not None:
                relationship.update(
                    semantic_scope_runtime_payload(
                        semantic_scope_by_id.get(entry.scope_id) if entry.scope_id else None,
                        semantic_scope_nodes,
                    )
                )
            if diagnostic is not None:
                context.semantic_diagnostics.append(diagnostic)
            elif relationship is not None and relationship["validity"] == "stale":
                context.stale_relationships.append(relationship)
            elif (
                relationship is not None
                and relationship["validity"] == "active"
                and entry.state in {"confirmed", "locked"}
                and entry.execution_state == "verified"
            ):
                context.executable_relationships[entry.key] = relationship
            elif relationship is not None:
                if selected_relationship_ids is None or str(entry.id) in selected_relationship_ids:
                    context.candidate_relationships.append(relationship)

    column_sources: dict[str, list[str]] = {}
    for source in context.sources:
        profile = source.get("profile", {})
        schema = profile.get("schema", {})
        for column in schema.get("columns", []):
            column_name = str(column.get("name", ""))
            normalized = _canonical_column(column_name)
            if normalized:
                column_sources.setdefault(normalized, []).append(f"{source['name']}.{column_name}")
        for table in profile.get("tables", []):
            for column in table.get("columns", []):
                column_name = str(column.get("name", ""))
                normalized = _canonical_column(column_name)
                if normalized:
                    column_sources.setdefault(normalized, []).append(
                        f"{source['name']}.{table.get('name')}.{column_name}"
                    )
    fallback_relationships = [
        {
            "key": f"runtime_hint:{column}",
            "column": column,
            "sources": "、".join(names),
            "evidence": "字段名称和类型相近，使用前仍需检查唯一性与匹配率",
        }
        for column, names in column_sources.items()
        if len(set(names)) > 1
    ]
    existing_candidate_keys = {
        str(item.get("key") or "") for item in context.candidate_relationships
    }
    if selected_relationship_ids is None:
        context.candidate_relationships.extend(
            item for item in fallback_relationships if item["key"] not in existing_candidate_keys
        )
    return context


async def resolve_confirmed_ambiguity(
    db: AsyncSession,
    project_id: UUID,
    key: str,
) -> None:
    """Clear a preflight question once project knowledge contains its answer."""

    canonical_key = canonicalize_decision_key(key)

    def is_resolved(item: dict[str, Any]) -> bool:
        return (
            canonicalize_decision_key(
                str(item.get("key") or ""),
                question=str(item.get("question") or ""),
                reason=str(item.get("reason") or ""),
                options=[str(option) for option in item.get("options") or []],
            )
            == canonical_key
        )

    report_result = await db.execute(
        select(PreflightReportRecord).where(
            PreflightReportRecord.project_id == project_id,
            PreflightReportRecord.status == "needs_confirmation",
        )
    )
    touched_sources: set[UUID] = set()
    for report in report_result.scalars():
        remaining = [item for item in (report.ambiguities or []) if not is_resolved(item)]
        if len(remaining) == len(report.ambiguities or []):
            continue
        report.ambiguities = remaining
        schema_drift = (report.source_snapshot or {}).get("schema_drift") or {}
        has_blocking_drift = bool(schema_drift.get("requires_confirmation")) or any(
            item.get("code") in {"recipe_replay_drift", "recipe_input_changed"}
            for item in (report.issues or [])
        )
        report.status = "needs_confirmation" if remaining or has_blocking_drift else "ready"
        if not remaining:
            report.summary = (
                re.sub(r"，有 \d+ 个业务口径需要确认", "", report.summary) + "，已应用确认口径"
            )
        touched_sources.add(report.data_source_id)

    for source_id in touched_sources:
        source = await db.get(ProjectDataSource, source_id)
        if source is None:
            continue
        profile = dict(source.profile_data or {})
        profile["ambiguities"] = [
            item for item in (profile.get("ambiguities") or []) if not is_resolved(item)
        ]
        if not profile["ambiguities"]:
            profile["summary"] = (
                re.sub(
                    r"，有 \d+ 个业务口径需要确认",
                    "",
                    str(profile.get("summary") or "数据已准备好"),
                )
                + "，已应用确认口径"
            )
        source.profile_data = profile
        if profile.get("superseded_by"):
            source.status = "superseded"
        elif profile["ambiguities"] or profile.get("is_current") is False:
            source.status = "needs_confirmation"
        else:
            source.status = "ready"
