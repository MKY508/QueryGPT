"""Model-callable source queries using the shared deterministic data services."""

from __future__ import annotations

import asyncio
import contextlib
import re
import threading
from typing import Any

import duckdb
from pydantic_ai import ModelRetry, RunContext

from app.models.query import (
    SemanticDimensionFilter,
    StructuredQueryFilter,
    StructuredQueryMetric,
    StructuredQuerySort,
)
from app.services.analyst.result_store import (
    _ensure_result_budget,
    _ensure_result_write_allowed,
)
from app.services.analyst.semantics import (
    _compile_semantic_dimension_filter,
    _enforce_connection_semantic_query,
    _opened_semantic_scope_receipt,
    _reject_ordinary_database_sql,
    _resolve_confirmed_dimension,
    _resolve_confirmed_metric,
    _resolve_structured_source,
    _validate_semantic_scope_receipt,
)
from app.services.analyst.session import (
    AnalystSession,
)
from app.services.checkpoint_contract import stable_payload_hash
from app.services.database import create_database_manager
from app.services.file_query import query_project_file_rows
from app.services.query_compiler import (
    _table_identity_equal,
    compile_structured_query,
    validate_read_only,
)
from app.services.result_values import json_result_value


async def query_source_data(
    ctx: RunContext[AnalystSession],
    purpose: str,
    result_name: str,
    source_id: str | None = None,
    table: str | None = None,
    semantic_scope_receipt: str | None = None,
    dimensions: list[str] | None = None,
    semantic_dimension_keys: list[str] | None = None,
    metrics: list[StructuredQueryMetric] | None = None,
    semantic_metric_key: str | None = None,
    filters: list[StructuredQueryFilter] | None = None,
    semantic_dimension_filters: list[SemanticDimensionFilter] | None = None,
    sort: list[StructuredQuerySort] | None = None,
    limit: int = 1000,
) -> dict[str, Any]:
    """Read files by schema or databases only through confirmed semantic keys."""

    _ensure_result_write_allowed(ctx.deps)
    ctx.deps.queue_progress("prepare_materials")
    selected_dimensions = dimensions or []
    selected_metrics = metrics or []
    selected_filters = filters or []
    selected_sort = sort or []
    semantic_metric_receipt: dict[str, Any] | None = None
    semantic_dimension_receipts: list[dict[str, Any]] = []
    semantic_filter_receipts: list[dict[str, Any]] = []
    opened_scope_receipt: dict[str, Any] | None = None
    try:
        governed_request = bool(
            semantic_metric_key or semantic_dimension_keys or semantic_dimension_filters
        )
        if governed_request and (
            selected_dimensions or selected_metrics or selected_filters or selected_sort
        ):
            raise ValueError(
                "使用已确认语义时不能混入模型自选的 dimensions、metrics、filters 或 sort"
            )
        if governed_request:
            opened_scope_receipt = _opened_semantic_scope_receipt(
                ctx.deps,
                semantic_scope_receipt,
            )

        governed_source_id: str | None = None
        governed_table: str | None = None

        def bind_governed_scope(
            entry: dict[str, Any],
            bound_source: dict[str, Any],
            binding_receipt: dict[str, Any],
            *,
            label: str,
        ) -> None:
            nonlocal source_id, table, governed_source_id, governed_table
            bound_source_id = str(bound_source.get("id") or "")
            if opened_scope_receipt is None:
                raise ValueError("缺少本次运行的语义作用域 receipt")
            _validate_semantic_scope_receipt(
                opened_scope_receipt,
                entry=entry,
                source=bound_source,
                binding_receipt=binding_receipt,
            )
            binding = binding_receipt.get("source_binding") or {}
            bound_table = str(binding.get("table_or_view") or "")
            if governed_source_id and governed_source_id != bound_source_id:
                raise ValueError("所选已确认语义不在同一数据源，当前查询无法安全组合")
            if source_id:
                requested_source = _resolve_structured_source(
                    ctx.deps.project.sources,
                    source_id,
                )
                if str(requested_source.get("id") or "") != bound_source_id:
                    raise ValueError(f"{label}不属于所选数据源")
            governed_source_id = bound_source_id
            source_id = bound_source_id
            if bound_source.get("kind") == "connection":
                if governed_table and not _table_identity_equal(
                    governed_table,
                    bound_table,
                ):
                    raise ValueError("所选已确认语义不在同一数据表，当前查询无法安全组合")
                if table and not _table_identity_equal(table, bound_table):
                    raise ValueError(f"{label}不属于所选数据表")
                governed_table = bound_table
                table = bound_table
            else:
                # File contracts bind to a logical role; the query compiler
                # addresses the current physical working view.
                table = None

        seen_dimension_keys: set[str] = set()
        for dimension_key in semantic_dimension_keys or []:
            normalized_key = dimension_key.strip()
            if normalized_key in seen_dimension_keys:
                raise ValueError("semantic_dimension_keys 不能包含重复维度")
            seen_dimension_keys.add(normalized_key)
            entry, bound_source, bound_column, receipt = _resolve_confirmed_dimension(
                ctx.deps.project,
                normalized_key,
            )
            bind_governed_scope(entry, bound_source, receipt, label="已确认维度")
            selected_dimensions.append(bound_column)
            semantic_dimension_receipts.append(receipt)

        for semantic_filter in semantic_dimension_filters or []:
            entry, bound_source, bound_column, receipt = _resolve_confirmed_dimension(
                ctx.deps.project,
                semantic_filter.dimension_key,
            )
            bind_governed_scope(
                entry,
                bound_source,
                receipt,
                label="已确认维度筛选",
            )
            selected_filters.extend(
                _compile_semantic_dimension_filter(
                    semantic_filter,
                    column=bound_column,
                    receipt=receipt,
                )
            )
            semantic_filter_receipts.append(
                {
                    **receipt,
                    "operator": semantic_filter.operator,
                    "requested_value": semantic_filter.value,
                }
            )

        if semantic_metric_key:
            entry, bound_source, bound_metric, semantic_metric_receipt = _resolve_confirmed_metric(
                ctx.deps.project,
                semantic_metric_key,
            )
            bind_governed_scope(
                entry,
                bound_source,
                semantic_metric_receipt,
                label="已确认指标",
            )
            selected_metrics = [bound_metric]
        source = _resolve_structured_source(ctx.deps.project.sources, source_id)
        _enforce_connection_semantic_query(
            source,
            governed_request=governed_request,
            dimensions=dimensions or [],
            metrics=metrics or [],
            filters=filters or [],
            sort=sort or [],
        )
        source_key = str(source.get("id") or "")
        if not source_key:
            raise ValueError("数据源缺少稳定 source id，不能生成可追溯结果")
        connection_config = (
            ctx.deps.project.connection_configs.get(source_key)
            if source.get("kind") == "connection"
            else None
        )
        sql, query_plan = compile_structured_query(
            source,
            connection_config=connection_config,
            table=table,
            dimensions=selected_dimensions,
            metrics=selected_metrics,
            filters=selected_filters,
            sort=selected_sort,
            limit=limit,
        )
        if semantic_metric_receipt is not None:
            query_plan = {
                **query_plan,
                "semantic_metric": semantic_metric_receipt,
            }
        if semantic_dimension_receipts:
            query_plan = {
                **query_plan,
                "semantic_dimensions": semantic_dimension_receipts,
            }
        if semantic_filter_receipts:
            query_plan = {
                **query_plan,
                "semantic_dimension_filters": semantic_filter_receipts,
            }
        if opened_scope_receipt is not None:
            query_plan = {
                **query_plan,
                "semantic_scope_receipt": opened_scope_receipt,
            }
        validate_read_only(sql)
        semantic_source = "files" if source.get("kind") == "file" else source_key
        ctx.deps.semantic_adapter.validate_sql(sql, source_id=semantic_source)
        planned_sql = ctx.deps.semantic_adapter.transform_sql(sql, source_id=semantic_source)
    except Exception as exc:
        raise ModelRetry(f"结构化查询无法匹配当前数据，请按真实字段修正：{exc}") from exc

    execution_backend = "duckdb"
    execution_metadata: dict[str, Any] | None = None
    engine_truncated = False
    cancellation_event = threading.Event()
    try:
        if source.get("kind") == "file":
            connection_holder: dict[str, Any] = {}
            query_task = asyncio.create_task(
                asyncio.to_thread(
                    query_project_file_rows,
                    [source],
                    planned_sql,
                    ctx.deps.project.project_dir,
                    connection_holder=connection_holder,
                )
            )
            try:
                rows, engine_truncated, _ = await asyncio.wait_for(
                    asyncio.shield(query_task), timeout=85
                )
            except (TimeoutError, asyncio.CancelledError):
                connection = connection_holder.get("connection")
                if connection is not None:
                    connection.interrupt()
                with contextlib.suppress(Exception):
                    await query_task
                raise
        else:
            configs = ctx.deps.project.connection_configs
            if source_key not in configs:
                raise ValueError("该数据库连接当前不可用")
            manager = create_database_manager(configs[source_key])
            result = await asyncio.to_thread(
                manager.execute_query,
                planned_sql,
                True,
                cancellation_event=cancellation_event,
            )
            rows = result.data
            engine_truncated = bool(result.truncated)
            execution_backend = result.execution_backend
            execution_metadata = result.execution_metadata
    except asyncio.CancelledError:
        cancellation_event.set()
        raise
    except Exception as exc:
        raise ModelRetry(f"结构化查询执行失败，请缩小范围或修正字段：{exc}") from exc

    rows = json_result_value(rows)

    boundary_reached = bool(len(rows) >= limit and (selected_dimensions or not selected_metrics))
    truncated = engine_truncated or boundary_reached
    name = re.sub(r"\W+", "_", result_name).strip("_") or f"data_{len(ctx.deps.dataframes) + 1}"
    _ensure_result_write_allowed(ctx.deps)
    _ensure_result_budget(ctx.deps, {name: rows})
    ctx.deps.dataframes[name] = rows
    source_kind = str(source.get("kind") or "")
    table_or_view = str(query_plan.get("table_or_view") or query_plan.get("table") or "")
    query_scope = str(query_plan.get("query_scope") or "derived")
    result_completeness = "partial" if truncated else "complete"
    source_refs = [
        {
            "source_id": source_key,
            "source_logical_name": str(
                (source.get("profile") or {}).get("logical_name")
                or source.get("name")
                or source_key
            ),
            "source_kind": source_kind,
            "table_or_view": table_or_view,
            "query_scope": query_scope,
        }
    ]
    ctx.deps.result_metadata[name] = {
        "materialized_rows": len(rows),
        "truncated": truncated,
        "request_limit": limit,
        "source_id": source_key,
        "table_or_view": table_or_view,
        "query_scope": query_scope,
        "result_completeness": result_completeness,
        "query_plan": query_plan,
        "execution_backend": execution_backend,
        "execution_metadata": execution_metadata,
        "source_refs": source_refs,
        "semantic_metric": semantic_metric_receipt,
        "semantic_dimensions": semantic_dimension_receipts,
        "semantic_dimension_filters": semantic_filter_receipts,
        "semantic_scope_receipt": opened_scope_receipt,
    }
    ctx.deps.tool_history.append(
        {
            "kind": "structured_query",
            "source_kind": source_kind,
            "source_id": source_key,
            "table_or_view": table_or_view,
            "query_scope": query_scope,
            "result_completeness": result_completeness,
            "source_refs": source_refs,
            "purpose": purpose,
            "query_plan": query_plan,
            "semantic_metric": semantic_metric_receipt,
            "semantic_dimensions": semantic_dimension_receipts,
            "semantic_dimension_filters": semantic_filter_receipts,
            "semantic_scope_receipt": opened_scope_receipt,
            "compiled_sql": sql,
            "result_name": name,
            "rows": len(rows),
            "truncated": truncated,
        }
    )
    metadata = ctx.deps.result_metadata[name]
    ctx.deps.replay_journal.append(
        {
            "op": "query_source_data",
            "purpose": purpose,
            "source_id": source_key,
            "source_kind": source_kind,
            "table_or_view": table_or_view,
            "query_scope": query_scope,
            "result_completeness": result_completeness,
            "query_plan": query_plan,
            "semantic_metric": semantic_metric_receipt,
            "semantic_dimensions": semantic_dimension_receipts,
            "semantic_dimension_filters": semantic_filter_receipts,
            "semantic_scope_receipt": opened_scope_receipt,
            "planned_sql": planned_sql,
            "result_name": name,
            "result_hash": stable_payload_hash(rows),
            "metadata_hash": stable_payload_hash(metadata),
        }
    )
    await ctx.deps.checkpoint()
    return {
        "result_name": name,
        "rows": len(rows),
        "truncated": truncated,
        "source_id": source_key,
        "table_or_view": table_or_view,
        "query_scope": query_scope,
        "result_completeness": result_completeness,
        "columns": list(rows[0]) if rows else [],
        "semantic_metric": semantic_metric_receipt,
        "semantic_dimensions": semantic_dimension_receipts,
        "semantic_dimension_filters": semantic_filter_receipts,
        "semantic_scope_receipt": opened_scope_receipt,
        "sample": rows[:30],
    }


async def query_database(
    ctx: RunContext[AnalystSession],
    sql: str,
    result_name: str,
    purpose: str,
    source_id: str | None = None,
) -> dict[str, Any]:
    """Legacy free-SQL tool; ordinary project database analysis is rejected."""

    _ensure_result_write_allowed(ctx.deps)
    ctx.deps.queue_progress("read_database")
    cancellation_event = threading.Event()
    try:
        _reject_ordinary_database_sql(ctx.deps.project)
        validate_read_only(sql)
        configs = ctx.deps.project.connection_configs
        key = source_id or (next(iter(configs)) if configs else None)
        if key is None or key not in configs:
            raise ValueError("项目中没有可查询的数据库")
        manager = create_database_manager(configs[key])
        ctx.deps.semantic_adapter.validate_sql(sql, source_id=str(key))
        planned_sql = ctx.deps.semantic_adapter.transform_sql(sql, source_id=str(key))
        result = await asyncio.to_thread(
            manager.execute_query,
            planned_sql,
            True,
            cancellation_event=cancellation_event,
        )
    except asyncio.CancelledError:
        cancellation_event.set()
        raise
    except Exception as exc:
        raise ModelRetry(f"数据库查询失败，请检查真实表结构后修正：{exc}") from exc
    name = re.sub(r"\W+", "_", result_name).strip("_") or f"data_{len(ctx.deps.dataframes) + 1}"
    _ensure_result_write_allowed(ctx.deps)
    _ensure_result_budget(ctx.deps, {name: result.data})
    ctx.deps.dataframes[name] = result.data
    source = next(
        (item for item in ctx.deps.project.sources if str(item.get("id") or "") == str(key)),
        {},
    )
    ctx.deps.result_metadata[name] = {
        "source_rows": result.rows_count,
        "materialized_rows": len(result.data),
        "truncated": getattr(result, "truncated", False),
        # Raw SQL may contain joins, filters, CTEs, or projections. Without
        # a parsed table binding it is current-result evidence only.
        "query_scope": "derived",
        "result_completeness": ("partial" if getattr(result, "truncated", False) else "complete"),
        "execution_backend": getattr(result, "execution_backend", "python"),
        "execution_metadata": getattr(result, "execution_metadata", None),
        "source_refs": [
            {
                "source_id": str(key),
                "source_logical_name": str(
                    (source.get("profile") or {}).get("logical_name") or source.get("name") or key
                ),
                "source_kind": "connection",
                "query_scope": "derived",
            }
        ],
    }
    ctx.deps.tool_history.append(
        {
            "kind": "sql",
            "source_id": key,
            "purpose": purpose,
            "sql": sql,
            "result_name": name,
            "rows": result.rows_count,
        }
    )
    metadata = ctx.deps.result_metadata[name]
    ctx.deps.replay_journal.append(
        {
            "op": "query_database",
            "purpose": purpose,
            "source_id": key,
            "sql": sql,
            "planned_sql": planned_sql,
            "result_name": name,
            "result_hash": stable_payload_hash(result.data),
            "metadata_hash": stable_payload_hash(metadata),
        }
    )
    await ctx.deps.checkpoint()
    return {
        "result_name": name,
        "rows": result.rows_count,
        "materialized_rows": len(result.data),
        "truncated": getattr(result, "truncated", False),
        "sample": result.data[:30],
    }


async def query_project_files(
    ctx: RunContext[AnalystSession],
    sql: str,
    result_name: str,
    purpose: str,
) -> dict[str, Any]:
    """Query one or more analysis-ready project files with DuckDB view names from inspect_project_data."""

    _ensure_result_write_allowed(ctx.deps)
    ctx.deps.queue_progress("read_files")
    try:
        validate_read_only(sql)
        try:
            ctx.deps.semantic_adapter.validate_sql(sql, source_id="files")
            planned_sql = ctx.deps.semantic_adapter.transform_sql(sql, source_id="files")
        except Exception as exc:
            # The semantic planner may use an optional external engine whose
            # exception types are not part of our public contract. A guessed
            # table/column must remain a model-repairable mistake instead of
            # terminating the entire investigation.
            raise ModelRetry(
                f"文件查询规划失败，请使用 inspect_project_data 返回的 query_name 修正：{exc}"
            ) from exc
        connection_holder: dict[str, Any] = {}
        query_task = asyncio.create_task(
            asyncio.to_thread(
                query_project_file_rows,
                ctx.deps.project.sources,
                planned_sql,
                ctx.deps.project.project_dir,
                connection_holder=connection_holder,
            )
        )
        try:
            rows, truncated, _ = await asyncio.wait_for(asyncio.shield(query_task), timeout=85)
        except (TimeoutError, asyncio.CancelledError):
            connection = connection_holder.get("connection")
            if connection is not None:
                connection.interrupt()
            with contextlib.suppress(Exception):
                await query_task
            raise
    except (duckdb.Error, ValueError, OSError, TimeoutError) as exc:
        raise ModelRetry(
            f"文件查询失败，请使用 inspect_project_data 返回的 query_name 修正：{exc}"
        ) from exc
    name = re.sub(r"\W+", "_", result_name).strip("_") or f"data_{len(ctx.deps.dataframes) + 1}"
    _ensure_result_write_allowed(ctx.deps)
    _ensure_result_budget(ctx.deps, {name: rows})
    ctx.deps.dataframes[name] = rows
    file_sources = [source for source in ctx.deps.project.sources if source.get("kind") == "file"]
    referenced_sources = [
        source
        for source in file_sources
        if str(source.get("view_name") or "") and str(source.get("view_name")) in planned_sql
    ] or file_sources
    ctx.deps.result_metadata[name] = {
        "returned_rows": len(rows),
        "materialized_rows": len(rows),
        "truncated": truncated,
        # Free-form SQL does not provide deterministic per-result table
        # lineage, even when a view name happens to occur in the text.
        "query_scope": "derived",
        "result_completeness": "partial" if truncated else "complete",
        "source_refs": [
            {
                "source_id": str(source.get("id") or ""),
                "source_logical_name": str(
                    (source.get("profile") or {}).get("logical_name") or source.get("name") or ""
                ),
                "source_kind": "file",
                "query_scope": "derived",
            }
            for source in referenced_sources
        ],
    }
    ctx.deps.tool_history.append(
        {
            "kind": "file_sql",
            "purpose": purpose,
            "sql": sql,
            "result_name": name,
            "rows": len(rows),
            "truncated": truncated,
        }
    )
    metadata = ctx.deps.result_metadata[name]
    ctx.deps.replay_journal.append(
        {
            "op": "query_project_files",
            "purpose": purpose,
            "sql": sql,
            "planned_sql": planned_sql,
            "result_name": name,
            "result_hash": stable_payload_hash(rows),
            "metadata_hash": stable_payload_hash(metadata),
        }
    )
    await ctx.deps.checkpoint()
    return {
        "result_name": name,
        "rows": len(rows),
        "truncated": truncated,
        "sample": rows[:30],
    }
