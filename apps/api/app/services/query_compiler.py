"""Compile schema-bound queries without an agent or a model SDK."""

from __future__ import annotations

import math
import re
from typing import Any, Literal

from app.models.query import (
    StructuredFormulaMetric,
    StructuredQueryFilter,
    StructuredQueryMetric,
    StructuredQuerySort,
)
from app.services.checkpoint_contract import stable_payload_hash
from app.services.metric_formula import metric_formula_columns, validate_metric_formula_action


def validate_read_only(sql: str) -> None:
    normalized = sql.strip().rstrip(";")
    if ";" in normalized or not re.match(
        r"^(select|with|show|describe|explain)\b", normalized, re.I
    ):
        raise ValueError("只允许单条只读查询")
    without_strings = re.sub(r"'[^']*'|\"[^\"]*\"", "", normalized)
    if re.search(
        r"\b(insert|update|delete|drop|alter|create|attach|copy|install|load|pragma|into|outfile|dumpfile)\b",
        without_strings,
        re.I,
    ):
        raise ValueError("查询包含不允许的操作")
    if re.search(
        r"\b(pg_read_file|pg_read_binary_file|pg_ls_dir|lo_import|load_file|dblink)\s*\(",
        without_strings,
        re.I,
    ):
        raise ValueError("查询包含不允许的服务器文件或外部连接函数")


def _canonical_schema_name(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff]+", "", value).casefold()


def _catalog_table_identity(table: dict[str, Any]) -> str:
    name = str(table.get("name") or "").strip()
    schema = str(table.get("schema") or "").strip()
    return f"{schema}.{name}" if schema and name else name


def _match_table_identity(requested: str, available: list[str], *, label: str) -> str:
    """Resolve a table while keeping schema segments meaningful and fail-closed."""

    candidate = requested.strip()
    if not candidate:
        raise ValueError(f"{label}不能为空")
    unique_available = list(dict.fromkeys(item for item in available if item))
    exact = [item for item in unique_available if item.casefold() == candidate.casefold()]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        raise ValueError(f"{label}“{requested}”有多个可能匹配，请使用完整 Schema 和真实表名")

    requested_schema, separator, requested_bare = candidate.rpartition(".")
    if separator:
        schema_matches = [
            item
            for item in unique_available
            if "." in item
            and item.rsplit(".", 1)[0].casefold() == requested_schema.casefold()
            and _canonical_schema_name(item.rsplit(".", 1)[1])
            == _canonical_schema_name(requested_bare)
        ]
        if len(schema_matches) == 1:
            return schema_matches[0]
        if len(schema_matches) > 1:
            raise ValueError(f"{label}“{requested}”有多个可能匹配，请使用真实表名")
    else:
        bare_matches = [
            item
            for item in unique_available
            if _canonical_schema_name(item.rsplit(".", 1)[-1]) == _canonical_schema_name(candidate)
        ]
        if len(bare_matches) == 1:
            return bare_matches[0]
        if len(bare_matches) > 1:
            raise ValueError(f"{label}“{requested}”存在于多个 Schema，请使用完整的 Schema.表名")
    preview = "、".join(unique_available[:20])
    raise ValueError(f"找不到{label}“{requested}”；可用名称：{preview or '无'}")


def _table_identity_equal(left: Any, right: Any) -> bool:
    return str(left or "").strip().casefold() == str(right or "").strip().casefold()


def _configured_connection_schema(
    source: dict[str, Any],
    connection_config: dict[str, Any] | None,
) -> str | None:
    if connection_config is None:
        return None
    source_driver = str(source.get("format") or "").strip().casefold()
    config_driver = str(connection_config.get("driver") or source_driver).strip().casefold()
    if source_driver and config_driver and source_driver != config_driver:
        raise ValueError("数据源结构与当前连接类型不一致，不能执行")
    if config_driver == "postgresql":
        options = connection_config.get("extra_options") or {}
        return str(options.get("schema") or "public").strip()
    if config_driver == "mysql":
        return str(
            connection_config.get("database") or connection_config.get("database_name") or ""
        ).strip()
    if config_driver == "sqlite":
        return "main"
    return None


def _match_schema_name(requested: str, available: list[str], *, label: str) -> str:
    """Resolve an exact schema name with conservative case/canonical repair."""

    candidate = requested.strip()
    if not candidate:
        raise ValueError(f"{label}不能为空")
    unique_available = list(dict.fromkeys(item for item in available if item))
    if candidate in unique_available:
        return candidate
    case_matches = [item for item in unique_available if item.casefold() == candidate.casefold()]
    if len(case_matches) == 1:
        return case_matches[0]
    canonical = _canonical_schema_name(candidate)
    canonical_matches = [
        item for item in unique_available if _canonical_schema_name(item) == canonical
    ]
    if len(canonical_matches) == 1:
        return canonical_matches[0]
    if len(case_matches) > 1 or len(canonical_matches) > 1:
        raise ValueError(f"{label}“{requested}”有多个可能匹配，请使用真实名称")
    preview = "、".join(unique_available[:20])
    raise ValueError(f"找不到{label}“{requested}”；可用名称：{preview or '无'}")


def _quote_structured_identifier(value: str, *, driver: str) -> str:
    if driver == "mysql":
        return f"`{value.replace('`', '``')}`"
    return f'"{value.replace(chr(34), chr(34) * 2)}"'


def _structured_sql_literal(value: Any, *, driver: str) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("筛选值必须是有限数字")
        return repr(value)
    if isinstance(value, str):
        if any(ord(char) < 32 for char in value):
            raise ValueError("筛选文本包含无效字符")
        # Structured queries currently cross Wren, DuckDB/the SQLite sidecar, and
        # DB-API drivers as SQL text, so there is no single parameter container we
        # can preserve end-to-end. MySQL's backslash escaping and `#` comments make
        # hand-built literals especially sensitive to server SQL modes. Fail closed
        # before quoting rather than accepting a value whose parse could change.
        if driver == "mysql" and (
            "\\" in value
            or "#" in value
            or ";" in value
            or "--" in value
            or "/*" in value
            or "*/" in value
        ):
            raise ValueError("MySQL 筛选文本包含不安全字符；请移除反斜杠、分号或 SQL 注释标记")
        return f"'{value.replace(chr(39), chr(39) * 2)}'"
    raise ValueError("筛选值只能是文本、数字、布尔值或空值")


_STRUCTURED_NUMERIC_TYPES = {
    "bigint",
    "bigserial",
    "decimal",
    "double",
    "double precision",
    "float",
    "integer",
    "mediumint",
    "money",
    "numeric",
    "real",
    "serial",
    "smallint",
    "smallmoney",
    "smallserial",
    "tinyint",
}


def _structured_column_is_numeric(column: dict[str, Any]) -> bool:
    """Accept only an explicit numeric dtype/type recorded by source preflight."""

    raw_type = str(column.get("type") or column.get("dtype") or "").strip().casefold()
    if not raw_type:
        return False
    normalized = re.sub(r"\s+", " ", raw_type)
    if re.fullmatch(r"(?:u?int|float)(?:8|16|32|64|128)?(?:\[pyarrow\])?", normalized):
        return True
    base_type = re.sub(r"\s*\([^)]*\)", "", normalized).strip()
    base_type = re.sub(r"\s+(?:signed|unsigned)$", "", base_type).strip()
    return base_type in _STRUCTURED_NUMERIC_TYPES


def _structured_source_tables(
    source: dict[str, Any],
) -> list[tuple[str, list[dict[str, Any]]]]:
    profile = source.get("profile") or {}
    if source.get("kind") == "file":
        view_name = str(source.get("view_name") or "")
        columns = list((profile.get("schema") or {}).get("columns") or [])
        return [(view_name, columns)] if view_name and columns else []
    return [
        (_catalog_table_identity(table), list(table.get("columns") or []))
        for table in (profile.get("tables") or [])
        if str(table.get("name") or "") and table.get("columns")
    ]


def _resolve_runtime_semantic_table(
    source: dict[str, Any],
    requested_table: str,
    connection_config: dict[str, Any] | None = None,
) -> tuple[str, str]:
    """Return physical query table plus stable semantic table for one source."""

    profile = source.get("profile") or {}
    if source.get("kind") == "file":
        physical = str(source.get("view_name") or "").strip()
        logical = str(profile.get("logical_name") or source.get("name") or "").strip()
        requested = requested_table.strip()
        if not requested:
            raise ValueError("文件表名不能为空")
        aliases = list(dict.fromkeys(item for item in (physical, logical) if item))
        _match_schema_name(requested, aliases, label="文件表")
        if not physical or not logical:
            raise ValueError("文件数据源缺少可验证的物理表或逻辑表")
        return physical, logical

    available = [name for name, _columns in _structured_source_tables(source)]
    relation_index = (profile.get("preanalysis") or {}).get("relation_index") or {}
    available.extend(
        _catalog_table_identity(item)
        for item in relation_index.get("relations") or []
        if isinstance(item, dict) and str(item.get("name") or "").strip()
    )
    available = list(dict.fromkeys(item for item in available if item))
    semantic_table = _match_table_identity(requested_table, available, label="数据表")
    schema, separator, physical_table = semantic_table.rpartition(".")
    if not separator:
        return semantic_table, semantic_table

    configured_schema = _configured_connection_schema(source, connection_config)
    if not configured_schema:
        raise ValueError("该数据表包含 Schema，但当前连接缺少可验证的 Schema 配置")
    if configured_schema.casefold() != schema.casefold():
        raise ValueError(f"数据表属于 Schema“{schema}”，当前连接仅允许 Schema“{configured_schema}”")
    return physical_table, semantic_table


def _structured_metric_alias(
    metric: StructuredQueryMetric | StructuredFormulaMetric,
    column: str | None,
) -> str:
    if metric.alias is not None:
        alias = metric.alias.strip()
    elif metric.operation == "count" and column is None:
        alias = "row_count"
    else:
        suffix = _canonical_schema_name(column or "rows") or "value"
        alias = f"{metric.operation}_{suffix}"
    if not alias or any(ord(char) < 32 for char in alias):
        raise ValueError("汇总结果名称无效")
    return alias


def _structured_query_scope(
    *,
    metrics: list[StructuredQueryMetric | StructuredFormulaMetric],
    filters: list[StructuredQueryFilter],
) -> Literal["full", "filtered", "aggregated", "derived"]:
    """Classify the source rows represented by one schema-bound query."""

    if metrics:
        return "aggregated"
    if filters:
        return "filtered"
    return "full"


def compile_structured_query(
    source: dict[str, Any],
    *,
    connection_config: dict[str, Any] | None = None,
    table: str | None,
    dimensions: list[str],
    metrics: list[StructuredQueryMetric | StructuredFormulaMetric],
    filters: list[StructuredQueryFilter],
    sort: list[StructuredQuerySort],
    limit: int,
) -> tuple[str, dict[str, Any]]:
    """Compile a bounded SELECT using only identifiers present in the source profile."""

    if not 1 <= limit <= 10_000:
        raise ValueError("limit 必须在 1 到 10000 之间")
    if len(dimensions) > 20 or len(metrics) > 20 or len(filters) > 30 or len(sort) > 10:
        raise ValueError("一次查询选择的字段、汇总或筛选过多，请缩小调查范围")

    tables = _structured_source_tables(source)
    if not tables:
        raise ValueError("该数据源尚无可用结构，请先完成数据预检")
    table_names = [name for name, _ in tables]
    if table is None or not table.strip():
        if len(tables) != 1:
            raise ValueError(f"该数据源有多个表，请指定其中一个：{'、'.join(table_names[:20])}")
        selected_table, column_details = tables[0]
    else:
        selected_table = _match_table_identity(table, table_names, label="表")
        column_details = next(columns for name, columns in tables if name == selected_table)

    physical_table = selected_table
    if source.get("kind") == "connection":
        physical_table, selected_table = _resolve_runtime_semantic_table(
            source,
            selected_table,
            connection_config,
        )

    columns = [str(item.get("name") or "") for item in column_details]
    columns = [column for column in columns if column]
    if not columns:
        raise ValueError("该表没有可用字段")
    driver = str(source.get("format") or "").casefold()

    resolved_dimensions = [
        _match_schema_name(dimension, columns, label="字段") for dimension in dimensions
    ]
    if len(set(resolved_dimensions)) != len(resolved_dimensions):
        raise ValueError("dimensions 不能包含重复字段")

    def quote(value: str) -> str:
        return _quote_structured_identifier(value, driver=driver)

    select_parts = [quote(column) for column in resolved_dimensions]
    metric_aliases: list[str] = []
    metric_columns: list[str | None] = []
    metric_formula_plans: list[dict[str, Any] | None] = []
    operation_sql = {
        "count": "COUNT",
        "count_distinct": "COUNT",
        "sum": "SUM",
        "avg": "AVG",
        "min": "MIN",
        "max": "MAX",
    }
    for metric in metrics:
        if isinstance(metric, StructuredFormulaMetric):
            action = validate_metric_formula_action(metric.formula)
            resolved_formula_columns: dict[str, str] = {}
            for requested_column in metric_formula_columns(action):
                resolved_column = _match_schema_name(
                    requested_column,
                    columns,
                    label="公式字段",
                )
                column_profile = next(
                    item
                    for item in column_details
                    if str(item.get("name") or "") == resolved_column
                )
                if not _structured_column_is_numeric(column_profile):
                    profile_type = str(
                        column_profile.get("type") or column_profile.get("dtype") or "unknown"
                    )
                    raise ValueError(
                        f"派生指标字段“{resolved_column}”必须是预检明确识别的数值字段；"
                        f"当前类型为 {profile_type}"
                    )
                resolved_formula_columns[requested_column] = resolved_column

            def formula_sql(node: dict[str, Any]) -> str:
                operation = node["op"]
                if operation == "decimal":
                    # validate_metric_formula_action has already canonicalized and
                    # bounded this string, so it is safe as a numeric SQL literal.
                    return str(node["value"])
                if operation == "column":
                    expression = quote(resolved_formula_columns[str(node["name"])])
                    if action["null_policy"] == "zero":
                        return f"COALESCE({expression}, 0)"
                    return expression
                if operation == "negate":
                    return f"(-({formula_sql(node['operand'])}))"
                left = formula_sql(node["left"])
                right = formula_sql(node["right"])
                operator = {
                    "add": "+",
                    "subtract": "-",
                    "multiply": "*",
                    "divide": "/",
                }[operation]
                if operation == "divide" and action["divide_by_zero"] == "null":
                    right = f"NULLIF(({right}), 0)"
                return f"(({left}) {operator} ({right}))"

            metric_column = None
            alias = _structured_metric_alias(metric, None)
            if alias in metric_aliases or alias in resolved_dimensions:
                raise ValueError(f"结果名称“{alias}”重复")
            metric_aliases.append(alias)
            metric_columns.append(None)
            metric_formula_plans.append(
                {
                    "kind": "derived_metric",
                    "formula_hash": stable_payload_hash(action),
                    "referenced_columns": [
                        resolved_formula_columns[column]
                        for column in metric_formula_columns(action)
                    ],
                    "null_policy": action["null_policy"],
                    "divide_by_zero": action["divide_by_zero"],
                }
            )
            expression = f"{operation_sql[metric.operation]}({formula_sql(action['expression'])})"
            select_parts.append(f"{expression} AS {quote(alias)}")
            continue
        if metric.column is None or not metric.column.strip():
            if metric.operation != "count":
                raise ValueError(f"{metric.operation} 汇总必须指定真实字段")
            metric_column = None
        else:
            metric_column = _match_schema_name(metric.column, columns, label="汇总字段")
        if metric.operation in {"sum", "avg"} and metric_column is not None:
            column_profile = next(
                item for item in column_details if str(item.get("name") or "") == metric_column
            )
            if not _structured_column_is_numeric(column_profile):
                profile_type = str(
                    column_profile.get("type") or column_profile.get("dtype") or "unknown"
                )
                raise ValueError(
                    f"{metric.operation} 汇总字段“{metric_column}”必须是预检明确识别的"
                    f"数值字段；当前类型为 {profile_type}"
                )
        alias = _structured_metric_alias(metric, metric_column)
        if alias in metric_aliases or alias in resolved_dimensions:
            raise ValueError(f"结果名称“{alias}”重复")
        metric_aliases.append(alias)
        metric_columns.append(metric_column)
        metric_formula_plans.append(None)
        if metric.operation == "count" and metric_column is None:
            expression = "COUNT(*)"
        elif metric.operation == "count_distinct":
            expression = f"COUNT(DISTINCT {quote(str(metric_column))})"
        else:
            expression = f"{operation_sql[metric.operation]}({quote(str(metric_column))})"
        select_parts.append(f"{expression} AS {quote(alias)}")
    if not select_parts:
        select_parts = ["*"]

    where_parts: list[str] = []
    for item in filters:
        column = _match_schema_name(item.column, columns, label="筛选字段")
        expression = quote(column)
        if item.operator == "is_null":
            where_parts.append(f"{expression} IS NULL")
            continue
        if item.operator == "not_null":
            where_parts.append(f"{expression} IS NOT NULL")
            continue
        if item.operator in {"in", "not_in"}:
            if not isinstance(item.value, list) or not item.value:
                raise ValueError(f"{item.operator} 筛选需要非空 value 列表")
            if any(value is None for value in item.value):
                raise ValueError(
                    f"{item.operator} 筛选列表不能包含空值；请移除 null，"
                    "并根据意图单独使用 is_null 或 not_null"
                )
            values = ", ".join(
                _structured_sql_literal(value, driver=driver) for value in item.value
            )
            keyword = "IN" if item.operator == "in" else "NOT IN"
            where_parts.append(f"{expression} {keyword} ({values})")
            continue
        if item.operator == "contains":
            if not isinstance(item.value, str):
                raise ValueError("contains 筛选需要文本 value")
            literal = _structured_sql_literal(item.value, driver=driver)
            if driver == "mysql":
                where_parts.append(
                    f"LOCATE(LOWER({literal}), LOWER(CAST({expression} AS CHAR))) > 0"
                )
            elif driver == "postgresql":
                where_parts.append(
                    f"STRPOS(LOWER(CAST({expression} AS TEXT)), LOWER({literal})) > 0"
                )
            else:
                where_parts.append(
                    f"INSTR(LOWER(CAST({expression} AS TEXT)), LOWER({literal})) > 0"
                )
            continue
        comparison = {
            "eq": "=",
            "ne": "<>",
            "gt": ">",
            "gte": ">=",
            "lt": "<",
            "lte": "<=",
        }[item.operator]
        if item.value is None:
            if item.operator not in {"eq", "ne"}:
                raise ValueError("空值只能使用 eq 或 ne 筛选")
            where_parts.append(f"{expression} IS {'NOT ' if item.operator == 'ne' else ''}NULL")
        else:
            literal = _structured_sql_literal(item.value, driver=driver)
            where_parts.append(f"{expression} {comparison} {literal}")

    order_parts: list[str] = []
    output_names = [*resolved_dimensions, *metric_aliases]
    for item in sort:
        field = _match_schema_name(item.field, output_names or columns, label="排序字段")
        order_parts.append(f"{quote(field)} {item.direction.upper()}")

    clauses = [f"SELECT {', '.join(select_parts)}", f"FROM {quote(physical_table)}"]
    if where_parts:
        clauses.append(f"WHERE {' AND '.join(where_parts)}")
    if metrics and resolved_dimensions:
        clauses.append(f"GROUP BY {', '.join(quote(item) for item in resolved_dimensions)}")
    if order_parts:
        clauses.append(f"ORDER BY {', '.join(order_parts)}")
    clauses.append(f"LIMIT {limit}")
    sql = "\n".join(clauses)
    query_scope = _structured_query_scope(metrics=metrics, filters=filters)
    return sql, {
        "source_id": str(source.get("id") or ""),
        "table": selected_table,
        "table_or_view": selected_table,
        "query_scope": query_scope,
        "dimensions": resolved_dimensions,
        "metrics": [
            {
                "operation": metric.operation,
                "column": column,
                "alias": alias,
                **({"formula": formula_plan} if formula_plan is not None else {}),
            }
            for metric, column, alias, formula_plan in zip(
                metrics,
                metric_columns,
                metric_aliases,
                metric_formula_plans,
                strict=True,
            )
        ],
        "filters": [item.model_dump(mode="json") for item in filters],
        "sort": [item.model_dump(mode="json") for item in sort],
        "limit": limit,
        "is_aggregate": bool(metrics),
    }
