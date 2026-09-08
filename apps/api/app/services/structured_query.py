"""System-owned execution for one portable, typed structured query plan."""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import threading
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.models.query import StructuredQueryFilter, StructuredQueryMetric, StructuredQuerySort
from app.models.workspace import AnalysisPlaybookStructuredQueryPlan
from app.services.database import create_database_manager
from app.services.file_query import query_project_file_rows
from app.services.query_compiler import compile_structured_query, validate_read_only


class StructuredQueryExecutionError(ValueError):
    """The portable query cannot be safely bound, compiled, or executed."""


@dataclass(frozen=True, slots=True)
class StructuredQueryExecution:
    """Observable output of one freshly compiled structured query."""

    rows: list[dict[str, Any]]
    metadata: dict[str, Any]
    query_plan: dict[str, Any]
    compiled_sql: str
    execution_backend: str


def profile_schema_signature(profile: dict[str, Any]) -> str:
    """Match the source-role signature used by playbook capture."""

    columns: list[dict[str, str]] = []
    for column in (profile.get("schema") or {}).get("columns") or []:
        columns.append(
            {
                "name": str(column.get("name") or ""),
                "type": str(column.get("type") or column.get("dtype") or "unknown"),
            }
        )
    for table in profile.get("tables") or []:
        for column in table.get("columns") or []:
            columns.append(
                {
                    "name": str(column.get("name") or ""),
                    "type": str(column.get("type") or column.get("dtype") or "unknown"),
                }
            )
    payload = json.dumps(
        sorted(columns, key=lambda item: (item["name"], item["type"])),
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _runtime_plan_models(
    plan: AnalysisPlaybookStructuredQueryPlan,
) -> tuple[
    list[StructuredQueryMetric],
    list[StructuredQueryFilter],
    list[StructuredQuerySort],
]:
    metrics = [
        StructuredQueryMetric.model_validate(item.model_dump(mode="python"))
        for item in plan.metrics
    ]
    filters = [
        StructuredQueryFilter.model_validate(item.model_dump(mode="python"))
        for item in plan.filters
    ]
    sort = [
        StructuredQuerySort.model_validate(item.model_dump(mode="python")) for item in plan.sort
    ]
    return metrics, filters, sort


async def execute_structured_query(
    source: dict[str, Any],
    plan: AnalysisPlaybookStructuredQueryPlan,
    *,
    project_dir: Path,
    connection_configs: Mapping[str, dict[str, Any]] | None = None,
    cancellation_event: threading.Event | None = None,
) -> StructuredQueryExecution:
    """Recompile and execute a typed plan against exactly one current source."""

    source_kind = str(source.get("kind") or "")
    if source_kind not in {"file", "connection"}:
        raise StructuredQueryExecutionError("structured queries require a file or connection")
    source_id = str(source.get("id") or "").strip()
    if not source_id:
        raise StructuredQueryExecutionError("the bound source has no stable source id")

    try:
        metrics, filters, sort = _runtime_plan_models(plan)
        compiled_sql, query_plan = compile_structured_query(
            source,
            table=plan.table,
            dimensions=list(plan.dimensions),
            metrics=metrics,
            filters=filters,
            sort=sort,
            limit=plan.limit,
        )
        validate_read_only(compiled_sql)
    except (TypeError, ValueError) as exc:
        raise StructuredQueryExecutionError(
            f"the structured query no longer matches the bound schema: {exc}"
        ) from exc

    execution_backend = "duckdb"
    execution_metadata: dict[str, Any] | None = None
    cancellation = cancellation_event or threading.Event()
    try:
        if source_kind == "file":
            if not source.get("working_uri"):
                raise StructuredQueryExecutionError(
                    "the bound file source has no approved working copy"
                )
            connection_holder: dict[str, Any] = {}
            query_task = asyncio.create_task(
                asyncio.to_thread(
                    query_project_file_rows,
                    [source],
                    compiled_sql,
                    project_dir,
                    limit=plan.limit,
                    connection_holder=connection_holder,
                )
            )
            try:
                rows, engine_truncated, _available = await asyncio.shield(query_task)
            except asyncio.CancelledError:
                cancellation.set()
                connection = connection_holder.get("connection")
                if connection is not None:
                    with contextlib.suppress(Exception):
                        connection.interrupt()
                with contextlib.suppress(Exception):
                    await query_task
                raise
        else:
            configs = connection_configs or {}
            config = configs.get(source_id)
            if config is None:
                raise StructuredQueryExecutionError(
                    "the bound database connection is not available"
                )
            manager = create_database_manager(config)
            query_task = asyncio.create_task(
                asyncio.to_thread(
                    manager.execute_query,
                    compiled_sql,
                    read_only=True,
                    max_rows=plan.limit,
                    timeout_seconds=85,
                    cancellation_event=cancellation,
                )
            )
            try:
                result = await asyncio.shield(query_task)
            except asyncio.CancelledError:
                cancellation.set()
                with contextlib.suppress(Exception):
                    await query_task
                raise
            rows = result.data
            engine_truncated = bool(result.truncated)
            execution_backend = result.execution_backend
            execution_metadata = result.execution_metadata
    except StructuredQueryExecutionError:
        raise
    except Exception as exc:
        raise StructuredQueryExecutionError(f"structured query execution failed: {exc}") from exc

    rows = json.loads(json.dumps(rows, default=str, ensure_ascii=False))
    boundary_reached = bool(len(rows) >= plan.limit and (plan.dimensions or not plan.metrics))
    if engine_truncated or boundary_reached:
        raise StructuredQueryExecutionError(
            "the structured query result is truncated; a complete result is required"
        )

    logical_name = str(
        (source.get("profile") or {}).get("logical_name") or source.get("name") or source_id
    )
    table_or_view = str(query_plan.get("table_or_view") or query_plan.get("table") or "")
    query_scope = str(query_plan.get("query_scope") or "derived")
    source_refs = [
        {
            "source_id": source_id,
            "source_logical_name": logical_name,
            "source_kind": source_kind,
            "table_or_view": table_or_view,
            "query_scope": query_scope,
        }
    ]
    metadata = {
        "materialized_rows": len(rows),
        "truncated": False,
        "request_limit": plan.limit,
        "source_id": source_id,
        "table_or_view": table_or_view,
        "query_scope": query_scope,
        "result_completeness": "complete",
        "query_plan": query_plan,
        "execution_backend": execution_backend,
        "execution_metadata": execution_metadata,
        "source_refs": source_refs,
    }
    return StructuredQueryExecution(
        rows=rows,
        metadata=metadata,
        query_plan=query_plan,
        compiled_sql=compiled_sql,
        execution_backend=execution_backend,
    )


__all__ = [
    "StructuredQueryExecution",
    "StructuredQueryExecutionError",
    "execute_structured_query",
    "profile_schema_signature",
]
