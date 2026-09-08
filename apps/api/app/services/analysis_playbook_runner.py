"""Deterministic runner for the narrow v3 system-structured-query playbook lane."""

from __future__ import annotations

import hashlib
import json
import threading
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.models.workspace import (
    AnalysisPlaybookResponse,
    AnalysisPlaybookSourceRole,
    AnalysisPlaybookStructuredQueryPlan,
)
from app.services.checkpoint_contract import stable_payload_hash
from app.services.result_profile import profile_result
from app.services.structured_query import (
    StructuredQueryExecutionError,
    execute_structured_query,
    profile_schema_signature,
)


class AnalysisPlaybookRunnerError(ValueError):
    """A v3 playbook cannot be safely rebound and executed by the system."""


class AnalysisPlaybookExecutionReceipt(BaseModel):
    """Strict, SQL-free proof that one v3 playbook ran and was validated."""

    version: Literal[1] = 1
    kind: Literal["analysis_playbook_execution"] = "analysis_playbook_execution"
    status: Literal["validated"] = "validated"
    playbook_id: str = Field(..., pattern=r"^pb_[0-9a-f]{20}$")
    playbook_shape_hash: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    source_role: str = Field(..., min_length=1, max_length=255)
    source_kind: Literal["file", "connection"]
    source_id: str = Field(..., min_length=1, max_length=160)
    source_schema_signature: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    plan_hash: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    result_name: str = Field(..., pattern=r"^result_[1-9][0-9]*$")
    row_count: int = Field(..., ge=0)
    truncated: Literal[False] = False
    execution_backend: str = Field(..., min_length=1, max_length=80)
    result_hash: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    metadata_hash: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    profile_hash: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    validation_hash: str = Field(..., pattern=r"^[0-9a-f]{64}$")

    model_config = {"extra": "forbid", "frozen": True}


@dataclass(frozen=True, slots=True)
class AnalysisPlaybookRunResult:
    """State that can directly hydrate the deterministic portion of a runtime."""

    result_name: str
    rows: list[dict[str, Any]]
    metadata: dict[str, Any]
    tool_history: list[dict[str, Any]]
    replay_journal: list[dict[str, Any]]
    validated_results: set[str]
    validation: dict[str, Any]
    receipt: AnalysisPlaybookExecutionReceipt

    @property
    def dataframes(self) -> dict[str, list[dict[str, Any]]]:
        return {self.result_name: self.rows}

    @property
    def result_metadata(self) -> dict[str, dict[str, Any]]:
        return {self.result_name: self.metadata}


def _shape_hash(playbook: AnalysisPlaybookResponse) -> str:
    payload = {
        "schema_version": playbook.schema_version,
        "execution_mode": playbook.execution_mode,
        "binding_policy": playbook.binding_policy,
        "requires_revalidation": playbook.requires_revalidation,
        "source_roles": [item.model_dump(mode="json") for item in playbook.source_roles],
        "steps": [item.model_dump(mode="json") for item in playbook.steps],
        "validation": playbook.validation.model_dump(mode="json"),
    }
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _source_logical_name(source: dict[str, Any]) -> str:
    profile = source.get("profile") if isinstance(source.get("profile"), dict) else {}
    return str(profile.get("logical_name") or source.get("name") or "").strip()


def _bind_source_role(
    role: AnalysisPlaybookSourceRole,
    sources: list[dict[str, Any]],
) -> tuple[dict[str, Any], str]:
    role_sources = [
        source
        for source in sources
        if source.get("status") != "superseded"
        and str(source.get("kind") or "") == role.source_kind
        and _source_logical_name(source) == role.logical_name
    ]
    pending = [
        source
        for source in role_sources
        if (source.get("profile") or {}).get("is_current") is False
        or (source.get("profile") or {}).get("activation_state") == "pending_confirmation"
        or bool((source.get("profile") or {}).get("replacement_of"))
    ]
    if pending:
        raise AnalysisPlaybookRunnerError(
            f"source role {role.logical_name!r} has a pending replacement"
        )
    active = [
        source
        for source in role_sources
        if (source.get("profile") or {}).get("is_current") is not False
    ]
    if not active:
        raise AnalysisPlaybookRunnerError(
            f"source role {role.logical_name!r} has no current binding"
        )
    if len(active) != 1:
        raise AnalysisPlaybookRunnerError(f"source role {role.logical_name!r} is ambiguous")
    source = active[0]
    if source.get("status") != "ready":
        raise AnalysisPlaybookRunnerError(f"source role {role.logical_name!r} is not ready")
    current_signature = profile_schema_signature(source.get("profile") or {})
    if current_signature != role.schema_signature:
        raise AnalysisPlaybookRunnerError(f"source role {role.logical_name!r} schema has drifted")
    if not str(source.get("id") or "").strip():
        raise AnalysisPlaybookRunnerError(
            f"source role {role.logical_name!r} has no stable source id"
        )
    return source, current_signature


def _system_steps(
    playbook: AnalysisPlaybookResponse,
) -> tuple[Any, AnalysisPlaybookStructuredQueryPlan, str, Any]:
    if playbook.schema_version != 3:
        raise AnalysisPlaybookRunnerError("only schema version 3 can use the system runner")
    if playbook.execution_mode != "system_structured_query":
        raise AnalysisPlaybookRunnerError("the playbook requires agent replanning")
    if playbook.confirmed_knowledge_keys or playbook.relationship_keys:
        raise AnalysisPlaybookRunnerError("system playbooks cannot contain semantic side effects")
    if len(playbook.source_roles) != 1 or len(playbook.steps) != 2:
        raise AnalysisPlaybookRunnerError(
            "system playbooks require one source, one query, and one validation"
        )
    if _shape_hash(playbook) != playbook.shape_hash:
        raise AnalysisPlaybookRunnerError("the playbook shape hash does not match its contract")

    query_steps = [
        step for step in playbook.steps if step.kind in {"structured_query", "read_data"}
    ]
    validation_steps = [step for step in playbook.steps if step.kind == "validate_result"]
    if len(query_steps) != 1 or len(validation_steps) != 1:
        raise AnalysisPlaybookRunnerError(
            "system playbooks require one typed query and one validation"
        )
    query_step = query_steps[0]
    validation_step = validation_steps[0]
    if [query_step.order, validation_step.order] != [1, 2]:
        raise AnalysisPlaybookRunnerError(
            "system playbook steps must be ordered query then validate"
        )

    if query_step.kind == "structured_query":
        source_role = str(query_step.source_role)
        raw_plan = query_step.plan
    else:  # compatibility for an alternate v3 read_data + query_plan representation
        source_roles = list(getattr(query_step, "source_roles", []) or [])
        if len(source_roles) != 1:
            raise AnalysisPlaybookRunnerError("the typed query must bind exactly one source role")
        source_role = str(source_roles[0])
        raw_plan = getattr(query_step, "query_plan", None)
        if raw_plan is None:
            raise AnalysisPlaybookRunnerError("the read step has no typed query plan")
    try:
        plan = AnalysisPlaybookStructuredQueryPlan.model_validate(raw_plan)
    except (TypeError, ValueError) as exc:
        raise AnalysisPlaybookRunnerError("the stored query plan is not strictly typed") from exc

    output_result = str(query_step.output_result)
    if source_role != playbook.source_roles[0].logical_name:
        raise AnalysisPlaybookRunnerError("the query source role does not match its binding")
    if list(getattr(query_step, "input_results", []) or []):
        raise AnalysisPlaybookRunnerError("the system query cannot consume a prior result")
    if (
        list(validation_step.input_results) != [output_result]
        or playbook.validation.input_result != output_result
    ):
        raise AnalysisPlaybookRunnerError("the query output is not the final validated result")
    if (
        validation_step.key_columns != playbook.validation.key_columns
        or validation_step.numeric_columns != playbook.validation.numeric_columns
        or not validation_step.must_not_be_truncated
        or not playbook.validation.must_not_be_truncated
    ):
        raise AnalysisPlaybookRunnerError("the final validation contract is inconsistent")
    return query_step, plan, output_result, validation_step


def bind_analysis_playbook_source(
    playbook: AnalysisPlaybookResponse,
    sources: list[dict[str, Any]],
) -> tuple[dict[str, Any], str]:
    """Resolve the same governed source for execution and publication checks."""

    _system_steps(playbook)
    return _bind_source_role(playbook.source_roles[0], sources)


async def run_analysis_playbook(
    playbook: AnalysisPlaybookResponse,
    *,
    sources: list[dict[str, Any]],
    project_dir: Path,
    connection_configs: Mapping[str, dict[str, Any]] | None = None,
    cancellation_event: threading.Event | None = None,
) -> AnalysisPlaybookRunResult:
    """Run the only v3 lane that is safe without model replanning."""

    query_step, plan, result_name, validation_step = _system_steps(playbook)
    role = playbook.source_roles[0]
    source, source_schema_signature = bind_analysis_playbook_source(playbook, sources)
    try:
        execution = await execute_structured_query(
            source,
            plan,
            project_dir=project_dir,
            connection_configs=connection_configs,
            cancellation_event=cancellation_event,
        )
    except StructuredQueryExecutionError as exc:
        raise AnalysisPlaybookRunnerError(str(exc)) from exc

    result_hash = stable_payload_hash(execution.rows)
    metadata = dict(execution.metadata)
    metadata_hash = stable_payload_hash(metadata)
    source_id = str(source["id"])
    source_kind = str(source["kind"])
    table_or_view = str(metadata.get("table_or_view") or "")
    query_scope = str(metadata.get("query_scope") or "derived")
    source_refs = list(metadata.get("source_refs") or [])
    query_evidence = {
        "kind": "structured_query",
        "source_role": role.logical_name,
        "source_kind": source_kind,
        "source_id": source_id,
        "source_schema_signature": source_schema_signature,
        "table_or_view": table_or_view,
        "query_scope": query_scope,
        "result_completeness": "complete",
        "source_refs": source_refs,
        "purpose": str(query_step.summary),
        "query_plan": execution.query_plan,
        "compiled_sql": execution.compiled_sql,
        "result_name": result_name,
        "rows": len(execution.rows),
        "truncated": False,
    }
    query_replay = {
        "op": "query_source_data",
        "purpose": str(query_step.summary),
        "source_id": source_id,
        "source_kind": source_kind,
        "source_schema_signature": source_schema_signature,
        "table_or_view": table_or_view,
        "query_scope": query_scope,
        "result_completeness": "complete",
        "query_plan": execution.query_plan,
        "planned_sql": execution.compiled_sql,
        "result_name": result_name,
        "result_hash": result_hash,
        "metadata_hash": metadata_hash,
    }

    try:
        profile = profile_result(
            execution.rows,
            key_columns=list(validation_step.key_columns),
            numeric_columns=list(validation_step.numeric_columns),
        )
    except ValueError as exc:
        raise AnalysisPlaybookRunnerError(f"final result validation failed: {exc}") from exc
    profile.update(metadata)
    if (
        list(profile.get("columns") or []) != playbook.validation.columns
        or [str(item) for item in (profile.get("keys") or {})] != playbook.validation.key_columns
        or [str(item) for item in (profile.get("numeric") or {})]
        != playbook.validation.numeric_columns
        or profile.get("truncated") is not False
    ):
        raise AnalysisPlaybookRunnerError("the current result has drifted from validation shape")

    profile_hash = stable_payload_hash(profile)
    validation_evidence = {
        "kind": "validation",
        "purpose": str(validation_step.summary),
        "result_name": result_name,
        "result_hash": result_hash,
        "profile": profile,
    }
    validation_hash = stable_payload_hash(validation_evidence)
    validation_replay = {
        "op": "validate_result",
        "purpose": str(validation_step.summary),
        "result_name": result_name,
        "key_columns": list(validation_step.key_columns),
        "numeric_columns": list(validation_step.numeric_columns),
        "result_hash": result_hash,
        "profile_hash": profile_hash,
    }
    receipt = AnalysisPlaybookExecutionReceipt(
        playbook_id=playbook.id,
        playbook_shape_hash=playbook.shape_hash,
        source_role=role.logical_name,
        source_kind=source_kind,
        source_id=source_id,
        source_schema_signature=source_schema_signature,
        plan_hash=stable_payload_hash(plan.model_dump(mode="json")),
        result_name=result_name,
        row_count=len(execution.rows),
        truncated=False,
        execution_backend=execution.execution_backend,
        result_hash=result_hash,
        metadata_hash=metadata_hash,
        profile_hash=profile_hash,
        validation_hash=validation_hash,
    )
    receipt_evidence = receipt.model_dump(mode="json")
    return AnalysisPlaybookRunResult(
        result_name=result_name,
        rows=execution.rows,
        metadata=metadata,
        tool_history=[query_evidence, validation_evidence, receipt_evidence],
        replay_journal=[query_replay, validation_replay],
        validated_results={result_name},
        validation=validation_evidence,
        receipt=receipt,
    )


run_system_analysis_playbook = run_analysis_playbook


__all__ = [
    "AnalysisPlaybookExecutionReceipt",
    "AnalysisPlaybookRunResult",
    "AnalysisPlaybookRunnerError",
    "bind_analysis_playbook_source",
    "run_analysis_playbook",
    "run_system_analysis_playbook",
]
