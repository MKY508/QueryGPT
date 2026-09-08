"""Source and table semantics scoped to one analysis session."""

from __future__ import annotations

from typing import Any, Literal, cast
from uuid import uuid4

from pydantic_ai import ModelRetry, RunContext

from app.models.query import (
    SemanticDimensionFilter,
    StructuredFormulaMetric,
    StructuredQueryFilter,
    StructuredQueryMetric,
    StructuredQuerySort,
)
from app.services.analysis_checkpoint import stable_payload_hash
from app.services.analyst.session import (
    AnalystSession,
)
from app.services.metric_formula import (
    metric_formula_columns,
    validate_metric_formula_action,
)
from app.services.project_context import (
    ProjectRuntimeContext,
)
from app.services.query_compiler import (
    _canonical_schema_name,
    _resolve_runtime_semantic_table,
    _structured_source_tables,
    _table_identity_equal,
)
from app.services.result_filters import (
    stable_field_binding_candidates,
)


def _resolve_source_reference(
    sources: list[dict[str, Any]],
    source_ref: str | None,
    *,
    require_structured_tables: bool,
) -> dict[str, Any]:
    available = (
        [source for source in sources if _structured_source_tables(source)]
        if require_structured_tables
        else list(sources)
    )
    if source_ref is None or not source_ref.strip():
        if len(available) == 1:
            return available[0]
        raise ValueError("项目中有多个数据源，请使用 inspect_project_data 返回的 source id")

    requested = source_ref.strip()
    exact_matches: list[dict[str, Any]] = []
    case_matches: list[dict[str, Any]] = []
    canonical_matches: list[dict[str, Any]] = []
    requested_canonical = _canonical_schema_name(requested)
    for source in available:
        profile = source.get("profile") or {}
        names = {
            str(source.get("id") or ""),
            str(source.get("name") or ""),
            str(source.get("view_name") or source.get("connection_name") or ""),
            str(profile.get("logical_name") or ""),
        }
        names.discard("")
        if requested in names:
            exact_matches.append(source)
        elif any(name.casefold() == requested.casefold() for name in names):
            case_matches.append(source)
        elif any(_canonical_schema_name(name) == requested_canonical for name in names):
            canonical_matches.append(source)
    for matches in (exact_matches, case_matches, canonical_matches):
        unique = {str(item.get("id") or ""): item for item in matches}
        if len(unique) == 1:
            return next(iter(unique.values()))
        if len(unique) > 1:
            raise ValueError("数据源名称不唯一，请改用 source id")
    raise ValueError("找不到该数据源，请先调用 inspect_project_data 查看当前 source id")


def _resolve_structured_source(
    sources: list[dict[str, Any]], source_ref: str | None
) -> dict[str, Any]:
    return _resolve_source_reference(
        sources,
        source_ref,
        require_structured_tables=True,
    )


def _resolve_semantic_source(
    sources: list[dict[str, Any]], source_ref: str | None
) -> dict[str, Any]:
    """Resolve a source for catalog semantics even before any table is profiled."""

    return _resolve_source_reference(
        sources,
        source_ref,
        require_structured_tables=False,
    )


def _semantic_scope_public_payload(scope: dict[str, Any]) -> dict[str, Any]:
    facts = dict(scope.get("context_facts") or {})
    return {
        "id": str(scope.get("id") or ""),
        "kind": scope.get("kind"),
        "business_name": scope.get("business_name"),
        "description": scope.get("description"),
        "synonyms": list(facts.get("synonyms") or []),
        "source_logical_name": scope.get("source_logical_name"),
        "table_or_view": scope.get("table_or_view"),
        "context_facts": {
            key: value
            for key, value in facts.items()
            if key
            not in {
                "presentation_entry_id",
                "presentation_revision_id",
            }
        },
    }


def _semantic_entry_public_payload(item: dict[str, Any]) -> dict[str, Any]:
    return {
        key: item.get(key)
        for key in (
            "id",
            "active_revision_id",
            "key",
            "value",
            "type",
            "state",
            "validity",
            "execution_state",
            "definition",
            "definition_hash",
            "scope_id",
            "scope_path",
        )
    }


def _scope_ancestor_context(
    project: ProjectRuntimeContext,
    scope: dict[str, Any] | None,
    *,
    include_current: bool,
) -> list[dict[str, Any]]:
    if scope is None:
        return []
    path = list(scope.get("path") or [])
    path_ids = [str(item.get("id") or "") for item in path if item.get("id")]
    if not include_current:
        current_id = str(scope.get("id") or "")
        path_ids = [item for item in path_ids if item != current_id]
    scopes_by_id = {
        str(item.get("id") or ""): item for item in project.semantic_scopes if item.get("id")
    }
    return [
        _semantic_scope_public_payload(scopes_by_id[scope_id])
        for scope_id in path_ids
        if scope_id in scopes_by_id
    ]


def _direct_confirmed_scope_semantics(
    project: ProjectRuntimeContext,
    scope: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    if scope is None:
        return []
    scope_id = str(scope.get("id") or "")
    return [
        item
        for item in project.confirmed_knowledge
        if item.get("state") in {"confirmed", "locked"}
        and item.get("validity") != "stale"
        and str(item.get("scope_id") or "") == scope_id
    ]


def _opened_semantic_scope_receipt(
    deps: AnalystSession,
    receipt_token: str | None,
) -> dict[str, Any]:
    token = str(receipt_token or "").strip()
    receipt = deps.semantic_scope_receipts.get(token)
    if not token or receipt is None:
        raise ValueError("使用已确认语义前必须先打开对应表的语义，并传回本次运行的 receipt")
    if receipt.get("kind") != "semantic_table_scope_opened":
        raise ValueError("语义作用域 receipt 类型无效")
    return receipt


def _validate_semantic_scope_receipt(
    receipt: dict[str, Any],
    *,
    entry: dict[str, Any],
    source: dict[str, Any],
    binding_receipt: dict[str, Any],
) -> None:
    """Bind a governed entry to the exact table opened earlier in this run."""

    entry_id = str(entry.get("id") or "")
    allowed_entry_ids = {str(value) for value in receipt.get("semantic_entry_ids") or []}
    if not entry_id or entry_id not in allowed_entry_ids:
        raise ValueError("所选语义定义不在已打开的表作用域中")
    if str(entry.get("scope_id") or "") != str(receipt.get("scope_id") or ""):
        raise ValueError("语义定义已移动到另一个作用域，请重新打开对应表")
    if stable_payload_hash(dict(entry.get("scope_context_facts") or {})) != str(
        receipt.get("scope_context_hash") or ""
    ):
        raise ValueError("语义作用域上下文已变化，请重新打开对应表")
    if str(source.get("id") or "") != str(receipt.get("source_id") or ""):
        raise ValueError("语义作用域 receipt 不属于当前数据源")
    binding = binding_receipt.get("source_binding") or {}
    if not _table_identity_equal(
        binding.get("table_or_view"),
        receipt.get("scope_table_or_view"),
    ):
        raise ValueError("语义作用域 receipt 不属于当前数据表")


def _resolve_confirmed_aggregate_metric(
    project: ProjectRuntimeContext,
    metric_key: str,
) -> tuple[dict[str, Any], dict[str, Any], StructuredQueryMetric, dict[str, Any]]:
    """Bind one governed aggregate metric to its exact current source schema.

    The model selects only the semantic key.  Operation, column, source and
    table are all recovered from the confirmed definition and checked against
    the current source profile before SQL compilation.
    """

    normalized_key = metric_key.strip()
    matches = [
        item for item in project.confirmed_knowledge if str(item.get("key") or "") == normalized_key
    ]
    if len(matches) != 1:
        raise ValueError("找不到唯一的已确认指标定义")
    entry = matches[0]
    definition = entry.get("definition")
    if (
        entry.get("type") != "metric"
        or entry.get("state") not in {"confirmed", "locked"}
        or entry.get("validity") != "active"
        or entry.get("execution_state") != "verified"
        or not isinstance(definition, dict)
        or definition.get("version") != 1
        or definition.get("kind") != "aggregate_metric"
        or definition.get("operation") not in {"sum", "avg"}
    ):
        raise ValueError("该指标尚未确认并通过当前版本验证，不能执行")
    definition_hash = stable_payload_hash(definition)
    if str(entry.get("definition_hash") or "") != definition_hash:
        raise ValueError("该指标定义指纹不一致，不能执行")
    binding = definition.get("source")
    if not isinstance(binding, dict):
        raise ValueError("该指标缺少稳定的数据来源绑定")
    action_column = str(binding.get("action_column") or "").strip()
    if not action_column:
        raise ValueError("该指标缺少真实字段绑定")

    source_matches: list[dict[str, Any]] = []
    for source in project.sources:
        if binding in stable_field_binding_candidates(source, action_column):
            source_matches.append(source)
    if len(source_matches) != 1:
        raise ValueError("该指标绑定的数据结构已变化或不再唯一，请重新验证")
    source = source_matches[0]
    output_alias = f"metric_{definition_hash[:12]}"
    metric = StructuredQueryMetric(
        operation=cast(Literal["sum", "avg"], definition["operation"]),
        column=action_column,
        alias=output_alias,
    )
    receipt = {
        "kind": "semantic_metric_binding",
        "semantic_entry_id": entry.get("id"),
        "active_revision_id": entry.get("active_revision_id"),
        "metric_key": normalized_key,
        "definition_hash": definition_hash,
        "operation": definition["operation"],
        "source_binding": binding,
        "output_alias": output_alias,
    }
    return entry, source, metric, receipt


def _resolve_confirmed_derived_metric(
    project: ProjectRuntimeContext,
    metric_key: str,
) -> tuple[dict[str, Any], dict[str, Any], StructuredFormulaMetric, dict[str, Any]]:
    """Bind a confirmed row-level formula to its current source columns.

    Formula structure and physical bindings are recovered from the immutable
    semantic definition.  The model supplies only ``metric_key``.
    """

    normalized_key = metric_key.strip()
    matches = [
        item for item in project.confirmed_knowledge if str(item.get("key") or "") == normalized_key
    ]
    if len(matches) != 1:
        raise ValueError("找不到唯一的已确认指标定义")
    entry = matches[0]
    definition = entry.get("definition")
    if (
        entry.get("type") != "metric"
        or entry.get("state") not in {"confirmed", "locked"}
        or entry.get("validity") != "active"
        or entry.get("execution_state") != "verified"
        or not isinstance(definition, dict)
        or definition.get("version") != 1
        or definition.get("kind") != "derived_metric"
        or definition.get("aggregate") not in {"sum", "avg"}
    ):
        raise ValueError("该派生指标尚未确认并通过当前版本验证，不能执行")
    definition_hash = stable_payload_hash(definition)
    if str(entry.get("definition_hash") or "") != definition_hash:
        raise ValueError("该派生指标定义指纹不一致，不能执行")

    formula = validate_metric_formula_action(definition.get("formula"))
    formula_columns = metric_formula_columns(formula)
    raw_bindings = definition.get("sources")
    if not isinstance(raw_bindings, list) or not raw_bindings:
        raise ValueError("该派生指标缺少稳定的数据来源绑定")
    bindings = [binding for binding in raw_bindings if isinstance(binding, dict)]
    if len(bindings) != len(raw_bindings):
        raise ValueError("该派生指标的数据来源绑定无效")
    bound_columns = [str(binding.get("action_column") or "").strip() for binding in bindings]
    if (
        any(not column for column in bound_columns)
        or len(bound_columns) != len(set(bound_columns))
        or set(bound_columns) != set(formula_columns)
    ):
        raise ValueError("该派生指标的公式字段与来源绑定不一致")

    resolved_sources: list[dict[str, Any]] = []
    for binding, column in zip(bindings, bound_columns, strict=True):
        source_matches = [
            source
            for source in project.sources
            if binding in stable_field_binding_candidates(source, column)
        ]
        if len(source_matches) != 1:
            raise ValueError("该派生指标绑定的数据结构已变化或不再唯一，请重新验证")
        resolved_sources.append(source_matches[0])
    source_ids = {str(source.get("id") or "") for source in resolved_sources}
    if len(source_ids) != 1:
        raise ValueError("当前仅支持同一数据源内的派生指标，请拆分或补充已验证关系")
    tables = {str(binding.get("table_or_view") or "").strip().casefold() for binding in bindings}
    if len(tables) != 1:
        raise ValueError("当前仅支持同一表内的派生指标，请先治理跨表关系")

    output_alias = f"metric_{definition_hash[:12]}"
    metric = StructuredFormulaMetric(
        operation=cast(Literal["sum", "avg"], definition["aggregate"]),
        formula=formula,
        alias=output_alias,
    )
    receipt = {
        "kind": "semantic_derived_metric_binding",
        "semantic_entry_id": entry.get("id"),
        "active_revision_id": entry.get("active_revision_id"),
        "metric_key": normalized_key,
        "definition_hash": definition_hash,
        "formula_hash": stable_payload_hash(formula),
        "operation": definition["aggregate"],
        "source_binding": bindings[0],
        "source_bindings": bindings,
        "output_alias": output_alias,
    }
    return entry, resolved_sources[0], metric, receipt


def _resolve_confirmed_metric(
    project: ProjectRuntimeContext,
    metric_key: str,
) -> tuple[
    dict[str, Any],
    dict[str, Any],
    StructuredQueryMetric | StructuredFormulaMetric,
    dict[str, Any],
]:
    """Resolve either an aggregate column metric or a governed formula metric."""

    matches = [
        item
        for item in project.confirmed_knowledge
        if str(item.get("key") or "") == metric_key.strip()
    ]
    if len(matches) != 1:
        raise ValueError("找不到唯一的已确认指标定义")
    definition = matches[0].get("definition")
    if isinstance(definition, dict) and definition.get("kind") == "derived_metric":
        return _resolve_confirmed_derived_metric(project, metric_key)
    return _resolve_confirmed_aggregate_metric(project, metric_key)


def _resolve_confirmed_dimension(
    project: ProjectRuntimeContext,
    dimension_key: str,
) -> tuple[dict[str, Any], dict[str, Any], str, dict[str, Any]]:
    """Bind a governed dimension key to one current, schema-matching column."""

    normalized_key = dimension_key.strip()
    matches = [
        item for item in project.confirmed_knowledge if str(item.get("key") or "") == normalized_key
    ]
    if len(matches) != 1:
        raise ValueError("找不到唯一的已确认维度定义")
    entry = matches[0]
    definition = entry.get("definition")
    if (
        entry.get("type") != "dimension"
        or entry.get("state") not in {"confirmed", "locked"}
        or entry.get("validity") != "active"
        or entry.get("execution_state") != "verified"
        or not isinstance(definition, dict)
        or definition.get("version") != 1
        or definition.get("kind") != "dimension"
        or definition.get("role") not in {"time", "category", "identifier"}
    ):
        raise ValueError("该维度尚未确认并通过当前版本验证，不能执行")
    definition_hash = stable_payload_hash(definition)
    if str(entry.get("definition_hash") or "") != definition_hash:
        raise ValueError("该维度定义指纹不一致，不能执行")
    binding = definition.get("source")
    if not isinstance(binding, dict):
        raise ValueError("该维度缺少稳定的数据来源绑定")
    action_column = str(binding.get("action_column") or "").strip()
    if not action_column:
        raise ValueError("该维度缺少真实字段绑定")

    source_matches = [
        source
        for source in project.sources
        if binding in stable_field_binding_candidates(source, action_column)
    ]
    if len(source_matches) != 1:
        raise ValueError("该维度绑定的数据结构已变化或不再唯一，请重新验证")
    source = source_matches[0]
    receipt = {
        "kind": "semantic_dimension_binding",
        "semantic_entry_id": entry.get("id"),
        "active_revision_id": entry.get("active_revision_id"),
        "dimension_key": normalized_key,
        "definition_hash": definition_hash,
        "role": definition["role"],
        "source_binding": binding,
        "time_granularities": list(definition.get("time_granularities") or []),
        "timezone": definition.get("timezone"),
        "output_column": action_column,
    }
    return entry, source, action_column, receipt


def _compile_semantic_dimension_filter(
    item: SemanticDimensionFilter,
    *,
    column: str,
    receipt: dict[str, Any],
) -> list[StructuredQueryFilter]:
    """Translate one governed filter without exposing its physical field to the model."""

    if item.operator != "year_eq":
        return [
            StructuredQueryFilter(
                column=column,
                operator=item.operator,
                value=item.value,
            )
        ]
    if receipt.get("role") != "time":
        raise ValueError("year_eq 只能用于已确认的时间维度")
    granularities = {str(value) for value in receipt.get("time_granularities") or []}
    if granularities and "year" not in granularities:
        raise ValueError("该时间维度没有声明按年筛选能力")
    if isinstance(item.value, bool):
        raise ValueError("年份必须是四位整数")
    try:
        year = int(str(item.value))
    except (TypeError, ValueError) as exc:
        raise ValueError("年份必须是四位整数") from exc
    if not 1000 <= year <= 9998:
        raise ValueError("年份必须在 1000 到 9998 之间")
    # A half-open range avoids timestamp end-of-day ambiguity and works for
    # DATE/TIMESTAMP values across every supported read-only backend.
    return [
        StructuredQueryFilter(column=column, operator="gte", value=f"{year:04d}-01-01"),
        StructuredQueryFilter(column=column, operator="lt", value=f"{year + 1:04d}-01-01"),
    ]


def _enforce_connection_semantic_query(
    source: dict[str, Any],
    *,
    governed_request: bool,
    dimensions: list[str],
    metrics: list[StructuredQueryMetric],
    filters: list[StructuredQueryFilter],
    sort: list[StructuredQuerySort],
) -> None:
    """Keep ordinary database analysis on adopted, table-scoped semantics."""

    if source.get("kind") != "connection":
        return
    if not governed_request:
        raise ValueError(
            "数据库分析只能使用项目理解中已确认的指标和维度；请先打开对应表并确认业务定义"
        )
    if dimensions or metrics or filters or sort:
        raise ValueError("数据库分析不能混入模型临时选择的字段、计算、筛选或排序；请使用已确认语义")


def _reject_ordinary_database_sql(project: ProjectRuntimeContext) -> None:
    if project.connection_configs or any(
        source.get("kind") == "connection" for source in project.sources
    ):
        raise ValueError(
            "普通分析不能直接执行自由 SQL；请先在项目理解中确认定义，再使用 query_source_data"
        )


async def inspect_project_data(ctx: RunContext[AnalystSession]) -> dict[str, Any]:
    """Inspect current sources, learned context and historical reference hypotheses."""

    ctx.deps.queue_progress("project_context_checked")
    return ctx.deps.project.public_summary(query=ctx.deps.current_query)


async def inspect_source_semantics(
    ctx: RunContext[AnalystSession],
    source_id: str,
) -> dict[str, Any]:
    """Read one source's confirmed context and child-table catalog, never child semantics."""

    source = _resolve_semantic_source(ctx.deps.project.sources, source_id)
    logical_name = str(
        (source.get("profile") or {}).get("logical_name") or source.get("name") or ""
    )
    scope_matches = [
        item
        for item in ctx.deps.project.semantic_scopes
        if item.get("kind") == "source"
        and _canonical_schema_name(str(item.get("source_logical_name") or ""))
        == _canonical_schema_name(logical_name)
    ]
    exact_source_matches = [
        item
        for item in scope_matches
        if str((item.get("context_facts") or {}).get("source_id") or "")
        == str(source.get("id") or "")
    ]
    if exact_source_matches:
        scope_matches = exact_source_matches
    if len(scope_matches) != 1:
        raise ModelRetry("当前数据源没有唯一可读的语义作用域，请先在项目理解中修复")
    source_scope = scope_matches[0]
    direct_semantics = _direct_confirmed_scope_semantics(
        ctx.deps.project,
        source_scope,
    )
    table_scopes = sorted(
        (
            item
            for item in ctx.deps.project.semantic_scopes
            if item.get("kind") == "table"
            and str(item.get("parent_id") or "") == str(source_scope.get("id") or "")
        ),
        key=lambda item: (
            str(item.get("business_name") or "").casefold(),
            str(item.get("table_or_view") or "").casefold(),
        ),
    )
    return {
        "source_id": str(source.get("id") or ""),
        "source": _semantic_scope_public_payload(source_scope),
        "ancestor_context": _scope_ancestor_context(
            ctx.deps.project,
            source_scope,
            include_current=False,
        ),
        "semantics": [_semantic_entry_public_payload(item) for item in direct_semantics],
        "tables": [_semantic_scope_public_payload(item) for item in table_scopes],
    }


async def inspect_table_semantics(
    ctx: RunContext[AnalystSession],
    source_id: str,
    table: str,
) -> dict[str, Any]:
    """Open only one table's confirmed semantics and issue an in-run receipt."""

    source = _resolve_semantic_source(ctx.deps.project.sources, source_id)
    connection_config = (
        ctx.deps.project.connection_configs.get(str(source.get("id") or ""))
        if source.get("kind") == "connection"
        else None
    )
    physical_table, scope_table = _resolve_runtime_semantic_table(
        source,
        table,
        connection_config,
    )
    logical_name = str(
        (source.get("profile") or {}).get("logical_name") or source.get("name") or ""
    )
    scope_matches = [
        item
        for item in ctx.deps.project.semantic_scopes
        if item.get("kind") == "table"
        and _canonical_schema_name(str(item.get("source_logical_name") or ""))
        == _canonical_schema_name(logical_name)
        and _table_identity_equal(item.get("table_or_view"), scope_table)
    ]
    if len(scope_matches) > 1:
        raise ModelRetry("当前数据表对应多个语义作用域，请先在项目理解中修复")
    table_scope = scope_matches[0] if scope_matches else None
    semantics = [
        item
        for item in ctx.deps.project.confirmed_knowledge
        if item.get("state") in {"confirmed", "locked"}
        and item.get("validity") != "stale"
        and item.get("scope_kind") == "table"
        and _canonical_schema_name(str(item.get("scope_source_logical_name") or ""))
        == _canonical_schema_name(logical_name)
        and _table_identity_equal(item.get("scope_table_or_view"), scope_table)
        and (
            table_scope is None
            or str(item.get("scope_id") or "") == str(table_scope.get("id") or "")
        )
    ]
    scope_ids = {str(item.get("scope_id") or "") for item in semantics if item.get("scope_id")}
    if len(scope_ids) > 1:
        raise ModelRetry("当前表存在互相冲突的直接语义作用域，请先在项目理解中修复")
    scope_id = (
        str(table_scope.get("id") or "") if table_scope is not None else next(iter(scope_ids), "")
    ) or None
    scope_context_facts = dict(
        (table_scope or {}).get("context_facts")
        or (semantics[0].get("scope_context_facts") if semantics else {})
        or {}
    )
    scope_path = list(
        (table_scope or {}).get("path")
        or (semantics[0].get("scope_path") if semantics else [])
        or []
    )
    ancestor_context = _scope_ancestor_context(
        ctx.deps.project,
        table_scope,
        include_current=False,
    )
    token = str(uuid4())
    receipt = {
        "kind": "semantic_table_scope_opened",
        "receipt": token,
        "scope_id": scope_id,
        "source_id": str(source.get("id") or ""),
        "source_logical_name": logical_name,
        "physical_table_or_view": physical_table,
        "scope_table_or_view": scope_table,
        "scope_context_facts": scope_context_facts,
        "scope_context_hash": stable_payload_hash(scope_context_facts),
        "scope_path": scope_path,
        "ancestor_context": ancestor_context,
        "semantic_entry_ids": [str(item.get("id") or "") for item in semantics],
        "semantic_revision_ids": [str(item.get("active_revision_id") or "") for item in semantics],
    }
    ctx.deps.semantic_scope_receipts[token] = receipt
    ctx.deps.tool_history.append(receipt)
    return {
        "source_id": receipt["source_id"],
        "table_or_view": physical_table,
        "scope_table_or_view": scope_table,
        "scope_context_facts": scope_context_facts,
        "scope_path": scope_path,
        "ancestor_context": ancestor_context,
        "semantic_scope_receipt": token,
        "semantics": [_semantic_entry_public_payload(item) for item in semantics],
    }
