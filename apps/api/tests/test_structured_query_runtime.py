from __future__ import annotations

import sqlite3
from contextlib import nullcontext
from pathlib import Path

import pandas as pd
import pytest
from pydantic_ai import models
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

from app.core.config import settings
from app.models import SSEEventType
from app.models.query import (
    SemanticDimensionFilter,
    StructuredQueryFilter,
    StructuredQueryMetric,
    StructuredQuerySort,
)
from app.services import analyst_runtime
from app.services.analyst import semantics
from app.services.analyst.semantics import (
    _compile_semantic_dimension_filter,
    _enforce_connection_semantic_query,
    _opened_semantic_scope_receipt,
    _reject_ordinary_database_sql,
    _resolve_confirmed_aggregate_metric,
    _resolve_confirmed_derived_metric,
    _resolve_confirmed_dimension,
    _resolve_structured_source,
    _validate_semantic_scope_receipt,
)
from app.services.analyst.session import AnalystSession
from app.services.analyst_runtime import PydanticAnalystRuntime
from app.services.checkpoint_contract import stable_payload_hash
from app.services.file_query import query_project_file_rows
from app.services.project_context import ProjectRuntimeContext
from app.services.query_compiler import (
    _resolve_runtime_semantic_table,
    compile_structured_query,
    validate_read_only,
)
from app.services.result_filters import stable_field_binding_candidates
from tests.model_fixtures import synthetic_model_config


def _file_source(path: Path) -> dict:
    return {
        "id": "orders-source",
        "name": "线上订单",
        "kind": "file",
        "format": "parquet",
        "view_name": "online_orders",
        "working_uri": str(path),
        "profile": {
            "logical_name": "订单明细",
            "schema": {
                "columns": [
                    {"name": "商品品类", "dtype": "object"},
                    {"name": "实付金额", "dtype": "float64"},
                    {"name": "退款状态", "dtype": "object"},
                ]
            },
        },
    }


def _table_scope_fields(source: dict, *, scope_id: str = "scope:table") -> dict:
    logical_name = str(
        (source.get("profile") or {}).get("logical_name") or source.get("name") or ""
    )
    if source.get("kind") == "file":
        table_or_view = logical_name
    else:
        table = (source.get("profile") or {}).get("tables", [{}])[0]
        table_name = str(table.get("name") or "")
        table_schema = str(table.get("schema") or "")
        table_or_view = (
            f"{table_schema}.{table_name}" if table_schema and table_name else table_name
        )
    return {
        "scope_id": scope_id,
        "scope_kind": "table",
        "scope_source_logical_name": logical_name,
        "scope_table_or_view": table_or_view,
        "scope_context_facts": {
            "year": 2024,
            "period_evidence": "preanalysis_time_range",
            "business_topic": "Sales",
            "business_topic_status": "explicit",
        },
        "scope_path": [
            {"id": "scope:project", "kind": "project", "business_name": "测试项目"},
            {"id": "scope:source", "kind": "source", "business_name": logical_name},
            {"id": scope_id, "kind": "table", "business_name": table_or_view},
        ],
    }


def test_semantic_scope_receipt_is_current_run_and_exact_table_bound() -> None:
    deps = AnalystSession(
        project=ProjectRuntimeContext(),
        python_sandbox=None,  # type: ignore[arg-type]
        dependency_manager=None,  # type: ignore[arg-type]
    )
    with pytest.raises(ValueError, match="必须先打开对应表"):
        _opened_semantic_scope_receipt(deps, "not-opened")

    receipt = {
        "kind": "semantic_table_scope_opened",
        "receipt": "receipt-a",
        "scope_id": "scope-a",
        "source_id": "source-a",
        "scope_table_or_view": "orders",
        "scope_context_facts": {},
        "scope_context_hash": stable_payload_hash({}),
        "semantic_entry_ids": ["metric-a"],
    }
    deps.semantic_scope_receipts["receipt-a"] = receipt
    opened = _opened_semantic_scope_receipt(deps, "receipt-a")
    _validate_semantic_scope_receipt(
        opened,
        entry={"id": "metric-a", "scope_id": "scope-a"},
        source={"id": "source-a"},
        binding_receipt={"source_binding": {"table_or_view": "orders"}},
    )

    with pytest.raises(ValueError, match="不属于当前数据源"):
        _validate_semantic_scope_receipt(
            opened,
            entry={"id": "metric-a", "scope_id": "scope-a"},
            source={"id": "source-b"},
            binding_receipt={"source_binding": {"table_or_view": "orders"}},
        )
    with pytest.raises(ValueError, match="不属于当前数据表"):
        _validate_semantic_scope_receipt(
            opened,
            entry={"id": "metric-a", "scope_id": "scope-a"},
            source={"id": "source-a"},
            binding_receipt={"source_binding": {"table_or_view": "customers"}},
        )


@pytest.mark.asyncio
async def test_source_then_table_semantics_expose_ancestors_without_sibling_entries(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "WORKSPACE_ROOT", tmp_path / "projects")
    source = {
        "id": "warehouse-source",
        "name": "销售数仓",
        "kind": "connection",
        "format": "sqlite",
        "profile": {
            "logical_name": "sales_warehouse",
            "preanalysis": {
                "relation_index": {
                    "relations": [
                        {"name": "sales_2024", "schema": "main", "kind": "table"},
                        {"name": "customers", "schema": "main", "kind": "table"},
                    ]
                }
            },
            "tables": [],
        },
    }
    project_scope = {
        "id": "scope:project",
        "parent_id": None,
        "kind": "project",
        "business_name": "销售项目",
        "description": "项目级通用口径。",
        "context_facts": {},
        "path": [{"id": "scope:project", "kind": "project", "business_name": "销售项目"}],
    }
    source_scope = {
        "id": "scope:source",
        "parent_id": "scope:project",
        "kind": "source",
        "business_name": "销售数仓",
        "description": "包含各年度销售与客户资料。",
        "source_logical_name": "sales_warehouse",
        "table_or_view": None,
        "context_facts": {
            "source_id": "warehouse-source",
            "synonyms": ["销售库"],
        },
        "path": [
            {"id": "scope:project", "kind": "project", "business_name": "销售项目"},
            {"id": "scope:source", "kind": "source", "business_name": "销售数仓"},
        ],
    }
    sales_scope = {
        "id": "scope:sales",
        "parent_id": "scope:source",
        "kind": "table",
        "business_name": "2024 年销售明细",
        "description": "记录 2024 年订单销售。",
        "source_logical_name": "sales_warehouse",
        "table_or_view": "main.sales_2024",
        "context_facts": {"year": 2024, "profile_status": "catalog_only"},
        "path": [
            {"id": "scope:project", "kind": "project", "business_name": "销售项目"},
            {"id": "scope:source", "kind": "source", "business_name": "销售数仓"},
            {"id": "scope:sales", "kind": "table", "business_name": "2024 年销售明细"},
        ],
    }
    customer_scope = {
        **sales_scope,
        "id": "scope:customers",
        "business_name": "客户资料",
        "description": "记录客户主数据。",
        "table_or_view": "main.customers",
        "context_facts": {"profile_status": "catalog_only"},
        "path": [
            {"id": "scope:project", "kind": "project", "business_name": "销售项目"},
            {"id": "scope:source", "kind": "source", "business_name": "销售数仓"},
            {"id": "scope:customers", "kind": "table", "business_name": "客户资料"},
        ],
    }
    source_entry = {
        "id": "semantic:source",
        "active_revision_id": "revision:source",
        "key": "source-presentation",
        "value": "销售数仓",
        "type": "scope_presentation",
        "state": "confirmed",
        "validity": "active",
        "execution_state": "definition_only",
        "definition": {"kind": "scope_presentation", "scope_kind": "source"},
        "scope_id": "scope:source",
        "scope_kind": "source",
    }
    sales_entry = {
        "id": "semantic:sales",
        "active_revision_id": "revision:sales",
        "key": "sales-presentation",
        "value": "2024 年销售明细",
        "type": "scope_presentation",
        "state": "confirmed",
        "validity": "active",
        "execution_state": "definition_only",
        "definition": {"kind": "scope_presentation", "scope_kind": "table"},
        "scope_id": "scope:sales",
        "scope_kind": "table",
        "scope_source_logical_name": "sales_warehouse",
        "scope_table_or_view": "main.sales_2024",
    }
    sibling_entry = {
        **sales_entry,
        "id": "semantic:customers",
        "active_revision_id": "revision:customers",
        "key": "customers-presentation",
        "value": "客户资料",
        "scope_id": "scope:customers",
        "scope_table_or_view": "main.customers",
    }
    calls = 0

    def model(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        nonlocal calls
        calls += 1
        if calls == 1:
            return ModelResponse(
                parts=[ToolCallPart("inspect_source_semantics", {"source_id": source["id"]})]
            )
        if calls == 2:
            returned = next(
                part
                for message in messages
                if isinstance(message, ModelRequest)
                for part in message.parts
                if isinstance(part, ToolReturnPart) and part.tool_name == "inspect_source_semantics"
            )
            assert isinstance(returned.content, dict)
            assert [item["id"] for item in returned.content["semantics"]] == ["semantic:source"]
            assert {item["table_or_view"] for item in returned.content["tables"]} == {
                "main.sales_2024",
                "main.customers",
            }
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "inspect_table_semantics",
                        {"source_id": source["id"], "table": "main.sales_2024"},
                    )
                ]
            )
        if calls == 3:
            returned = next(
                part
                for message in messages
                if isinstance(message, ModelRequest)
                for part in message.parts
                if isinstance(part, ToolReturnPart) and part.tool_name == "inspect_table_semantics"
            )
            assert isinstance(returned.content, dict)
            assert [item["id"] for item in returned.content["semantics"]] == ["semantic:sales"]
            assert returned.content["ancestor_context"][-1]["description"] == (
                "包含各年度销售与客户资料。"
            )
            assert returned.content["ancestor_context"][-1]["synonyms"] == ["销售库"]
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "status": "completed",
                        "title": "销售表说明",
                        "summary": "已读取目标表的已确认业务说明。",
                    },
                )
            ]
        )

    monkeypatch.setattr(models, "ALLOW_MODEL_REQUESTS", False)
    monkeypatch.setattr(
        analyst_runtime,
        "model_session",
        lambda _config, **_kwargs: nullcontext(FunctionModel(model)),
    )
    runtime = PydanticAnalystRuntime(
        model_config=synthetic_model_config(),
        project_context=ProjectRuntimeContext(
            name="层级语义",
            sources=[source],
            semantic_scopes=[project_scope, source_scope, sales_scope, customer_scope],
            confirmed_knowledge=[source_entry, sales_entry, sibling_entry],
            connection_configs={
                "warehouse-source": {
                    "driver": "sqlite",
                    "database": str(tmp_path / "warehouse.db"),
                    "extra_options": {},
                }
            },
        ),
    )

    _ = [event async for event in runtime.execute(query="2024 年销售表记录了什么")]

    assert runtime.deps.tool_history[0]["kind"] == "semantic_table_scope_opened"
    assert runtime.deps.tool_history[0]["scope_table_or_view"] == "main.sales_2024"


def test_structured_query_compiles_real_schema_and_executes_file(tmp_path: Path):
    source_path = tmp_path / "orders.parquet"
    pd.DataFrame(
        [
            {"商品品类": "办公用品", "实付金额": 32.0, "退款状态": "否"},
            {"商品品类": "办公用品", "实付金额": 30.0, "退款状态": "否"},
            {"商品品类": "耗材", "实付金额": 28.0, "退款状态": "已退款"},
        ]
    ).to_parquet(source_path, index=False)
    source = _file_source(source_path)

    sql, plan = compile_structured_query(
        source,
        table=None,
        dimensions=["商品 品类"],
        metrics=[StructuredQueryMetric(operation="sum", column="实付金额", alias="销售额")],
        filters=[StructuredQueryFilter(column="退款状态", operator="eq", value="否")],
        sort=[StructuredQuerySort(field="销售额", direction="desc")],
        limit=100,
    )
    rows, truncated, available = query_project_file_rows([source], sql, tmp_path / "project")

    assert plan["table"] == "online_orders"
    assert plan["table_or_view"] == "online_orders"
    assert plan["query_scope"] == "aggregated"
    assert plan["dimensions"] == ["商品品类"]
    assert rows == [{"商品品类": "办公用品", "销售额": 62.0}]
    assert truncated is False
    assert available == ["online_orders"]


def test_structured_query_scope_distinguishes_full_filtered_and_aggregated(tmp_path: Path):
    source = _file_source(tmp_path / "orders.parquet")
    _, full_plan = compile_structured_query(
        source,
        table=None,
        dimensions=["商品品类", "实付金额", "退款状态"],
        metrics=[],
        filters=[],
        sort=[],
        limit=100,
    )
    _, filtered_plan = compile_structured_query(
        source,
        table=None,
        dimensions=["商品品类", "实付金额"],
        metrics=[],
        filters=[StructuredQueryFilter(column="退款状态", operator="eq", value="否")],
        sort=[],
        limit=100,
    )
    _, aggregated_plan = compile_structured_query(
        source,
        table=None,
        dimensions=["商品品类"],
        metrics=[StructuredQueryMetric(operation="sum", column="实付金额")],
        filters=[],
        sort=[],
        limit=100,
    )

    assert full_plan["query_scope"] == "full"
    assert filtered_plan["query_scope"] == "filtered"
    assert aggregated_plan["query_scope"] == "aggregated"


def test_structured_query_escapes_values_and_rejects_unknown_schema_names():
    source = {
        "id": "shop-db",
        "name": "门店库",
        "kind": "connection",
        "format": "mysql",
        "profile": {
            "tables": [
                {
                    "name": "order-items",
                    "columns": [
                        {"name": "store name", "type": "varchar"},
                        {"name": "amount", "type": "decimal"},
                    ],
                }
            ]
        },
    }
    sql, _ = compile_structured_query(
        source,
        table="order items",
        dimensions=["store_name"],
        metrics=[StructuredQueryMetric(operation="sum", column="amount")],
        filters=[
            StructuredQueryFilter(
                column="store name",
                operator="eq",
                value="店铺'精选",
            )
        ],
        sort=[],
        limit=50,
    )

    assert "FROM `order-items`" in sql
    assert "`store name`" in sql
    assert "'店铺''精选'" in sql
    validate_read_only(sql)

    with pytest.raises(ValueError, match="找不到汇总字段"):
        compile_structured_query(
            source,
            table=None,
            dimensions=[],
            metrics=[StructuredQueryMetric(operation="sum", column="invented_revenue")],
            filters=[],
            sort=[],
            limit=50,
        )


def test_canonical_database_table_identity_is_schema_safe_at_runtime():
    source = {
        "id": "warehouse-source",
        "name": "销售数仓",
        "kind": "connection",
        "format": "postgresql",
        "profile": {
            "logical_name": "sales_warehouse",
            "tables": [
                {
                    "schema": "public",
                    "name": "orders",
                    "columns": [{"name": "amount", "type": "numeric"}],
                },
                {
                    "schema": "archive",
                    "name": "orders",
                    "columns": [{"name": "legacy_amount", "type": "numeric"}],
                },
            ],
        },
    }
    public_config = {
        "driver": "postgresql",
        "database": "warehouse",
        "extra_options": {"schema": "public"},
    }

    with pytest.raises(ValueError, match="多个 Schema"):
        _resolve_runtime_semantic_table(source, "orders", public_config)

    assert _resolve_runtime_semantic_table(
        source,
        "public.orders",
        public_config,
    ) == ("orders", "public.orders")

    sql, plan = compile_structured_query(
        source,
        connection_config=public_config,
        table="public.orders",
        dimensions=[],
        metrics=[StructuredQueryMetric(operation="sum", column="amount")],
        filters=[],
        sort=[],
        limit=50,
    )
    assert 'FROM "orders"' in sql
    assert '"public.orders"' not in sql
    assert plan["table_or_view"] == "public.orders"

    archive_config = {
        **public_config,
        "extra_options": {"schema": "archive"},
    }
    with pytest.raises(ValueError, match="当前连接仅允许 Schema.*archive"):
        compile_structured_query(
            source,
            connection_config=archive_config,
            table="public.orders",
            dimensions=[],
            metrics=[StructuredQueryMetric(operation="sum", column="amount")],
            filters=[],
            sort=[],
            limit=50,
        )


def test_database_query_gates_require_confirmed_semantics_and_reject_raw_sort() -> None:
    source = {"id": "warehouse", "kind": "connection", "format": "sqlite"}
    with pytest.raises(ValueError, match="只能使用项目理解中已确认"):
        _enforce_connection_semantic_query(
            source,
            governed_request=False,
            dimensions=[],
            metrics=[],
            filters=[],
            sort=[],
        )
    with pytest.raises(ValueError, match="筛选或排序"):
        _enforce_connection_semantic_query(
            source,
            governed_request=True,
            dimensions=[],
            metrics=[],
            filters=[],
            sort=[StructuredQuerySort(field="amount", direction="desc")],
        )
    with pytest.raises(ValueError, match="不能直接执行自由 SQL"):
        _reject_ordinary_database_sql(
            ProjectRuntimeContext(
                sources=[source],
                connection_configs={"warehouse": {"driver": "sqlite"}},
            )
        )


@pytest.mark.asyncio
async def test_connection_query_executes_confirmed_metric_and_dimension_only(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "WORKSPACE_ROOT", tmp_path / "projects")
    database_path = tmp_path / "governed.sqlite3"
    with sqlite3.connect(database_path) as connection:
        connection.executescript(
            """
            CREATE TABLE orders (department TEXT, amount REAL);
            INSERT INTO orders VALUES ('华东部', 10), ('华东部', 5), ('华北部', 7);
            """
        )
    source = {
        "id": "warehouse-source",
        "name": "销售数仓",
        "kind": "connection",
        "format": "sqlite",
        "profile": {
            "logical_name": "销售仓库",
            "tables": [
                {
                    "schema": "main",
                    "name": "orders",
                    "columns": [
                        {"name": "department", "type": "TEXT"},
                        {"name": "amount", "type": "REAL"},
                    ],
                }
            ],
        },
    }
    amount_binding = stable_field_binding_candidates(source, "amount")[0]
    department_binding = stable_field_binding_candidates(source, "department")[0]
    metric_definition = {
        "version": 1,
        "kind": "aggregate_metric",
        "operation": "sum",
        "source": amount_binding,
        "null_policy": "ignore",
        "business_name": "销售额",
    }
    dimension_definition = {
        "version": 1,
        "kind": "dimension",
        "role": "category",
        "source": department_binding,
        "business_name": "部门",
    }
    scope_facts = {"source_id": source["id"], "business_topic": "销售"}
    scope_path = [
        {
            "id": "scope:orders",
            "kind": "table",
            "business_name": "订单明细",
            "table_or_view": "main.orders",
        }
    ]

    def governed_entry(
        entry_id: str,
        key: str,
        entry_type: str,
        definition: dict,
    ) -> dict:
        return {
            "id": entry_id,
            "active_revision_id": f"{entry_id}:revision",
            "key": key,
            "value": definition["business_name"],
            "type": entry_type,
            "state": "confirmed",
            "validity": "active",
            "execution_state": "verified",
            "definition": definition,
            "definition_hash": stable_payload_hash(definition),
            "scope_id": "scope:orders",
            "scope_kind": "table",
            "scope_source_logical_name": "销售仓库",
            "scope_table_or_view": "main.orders",
            "scope_context_facts": scope_facts,
            "scope_path": scope_path,
        }

    metric_key = "metric:sales-amount"
    dimension_key = "dimension:department"
    metric_entry = governed_entry(
        "semantic:amount",
        metric_key,
        "metric",
        metric_definition,
    )
    dimension_entry = governed_entry(
        "semantic:department",
        dimension_key,
        "dimension",
        dimension_definition,
    )
    table_scope = {
        "id": "scope:orders",
        "parent_id": "scope:source",
        "kind": "table",
        "business_name": "订单明细",
        "description": "已确认的订单业务范围。",
        "source_logical_name": "销售仓库",
        "table_or_view": "main.orders",
        "context_facts": scope_facts,
        "path": scope_path,
    }
    receipt_token = "scope-receipt-database-orders"
    metric_alias = f"metric_{stable_payload_hash(metric_definition)[:12]}"
    calls = 0

    def model(_messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        nonlocal calls
        calls += 1
        if calls == 1:
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "inspect_table_semantics",
                        {"source_id": source["id"], "table": "main.orders"},
                    )
                ]
            )
        if calls == 2:
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "query_source_data",
                        {
                            "purpose": "按部门查看已确认销售额",
                            "result_name": "department_sales",
                            "semantic_metric_key": metric_key,
                            "semantic_dimension_keys": [dimension_key],
                            "semantic_scope_receipt": receipt_token,
                        },
                    )
                ]
            )
        if calls == 3:
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "validate_result",
                        {
                            "result_name": "department_sales",
                            "purpose": "核对部门销售额",
                            "key_columns": ["department"],
                            "numeric_columns": [metric_alias],
                        },
                    )
                ]
            )
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "status": "completed",
                        "title": "部门销售额",
                        "summary": "已按确认定义完成计算。",
                        "primary_result": "department_sales",
                    },
                )
            ]
        )

    monkeypatch.setattr(models, "ALLOW_MODEL_REQUESTS", False)
    monkeypatch.setattr(semantics, "uuid4", lambda: receipt_token)
    monkeypatch.setattr(
        analyst_runtime,
        "model_session",
        lambda _config, **_kwargs: nullcontext(FunctionModel(model)),
    )
    runtime = PydanticAnalystRuntime(
        model_config=synthetic_model_config(),
        project_context=ProjectRuntimeContext(
            name="已治理销售库",
            sources=[source],
            confirmed_knowledge=[metric_entry, dimension_entry],
            semantic_scopes=[table_scope],
            connection_configs={
                source["id"]: {
                    "driver": "sqlite",
                    "database": str(database_path),
                    "extra_options": {},
                }
            },
        ),
    )

    _ = [event async for event in runtime.execute(query="各部门销售额是多少")]

    assert sorted(
        runtime.deps.dataframes["department_sales"],
        key=lambda row: row["department"],
    ) == [
        {"department": "华东部", metric_alias: 15.0},
        {"department": "华北部", metric_alias: 7.0},
    ]
    metadata = runtime.deps.result_metadata["department_sales"]
    assert metadata["table_or_view"] == "main.orders"
    assert metadata["semantic_metric"]["metric_key"] == metric_key
    assert metadata["semantic_dimensions"][0]["dimension_key"] == dimension_key


@pytest.mark.parametrize(
    "unsafe_value",
    [
        "店铺\\' OR 1=1 #",
        "店铺#绕过",
        "店铺-- 注释",
        "店铺/*注释*/",
        "店铺; SELECT 1",
        "店铺\n下一行",
    ],
)
def test_structured_query_rejects_unsafe_mysql_literals(unsafe_value: str):
    source = {
        "id": "shop-db",
        "name": "门店库",
        "kind": "connection",
        "format": "mysql",
        "profile": {
            "tables": [
                {
                    "name": "shops",
                    "columns": [{"name": "store_name", "type": "varchar"}],
                }
            ]
        },
    }

    with pytest.raises(ValueError, match="不安全字符|无效字符"):
        compile_structured_query(
            source,
            table=None,
            dimensions=["store_name"],
            metrics=[],
            filters=[StructuredQueryFilter(column="store_name", operator="eq", value=unsafe_value)],
            sort=[],
            limit=50,
        )


@pytest.mark.parametrize("operator", ["in", "not_in"])
def test_structured_query_rejects_null_inside_list_filter(operator: str):
    source = _file_source(Path("orders.parquet"))

    with pytest.raises(ValueError, match="列表不能包含空值.*is_null.*not_null"):
        compile_structured_query(
            source,
            table=None,
            dimensions=["商品品类"],
            metrics=[],
            filters=[
                StructuredQueryFilter(
                    column="退款状态",
                    operator=operator,
                    value=["否", None],
                )
            ],
            sort=[],
            limit=50,
        )


@pytest.mark.parametrize("operation", ["sum", "avg"])
def test_structured_query_rejects_non_numeric_or_unknown_metric_types(operation: str):
    source = _file_source(Path("orders.parquet"))

    with pytest.raises(ValueError, match="必须是预检明确识别的数值字段.*object"):
        compile_structured_query(
            source,
            table=None,
            dimensions=[],
            metrics=[StructuredQueryMetric(operation=operation, column="商品品类")],
            filters=[],
            sort=[],
            limit=50,
        )

    source["profile"]["schema"]["columns"].append({"name": "口径待定"})
    with pytest.raises(ValueError, match="必须是预检明确识别的数值字段.*unknown"):
        compile_structured_query(
            source,
            table=None,
            dimensions=[],
            metrics=[StructuredQueryMetric(operation=operation, column="口径待定")],
            filters=[],
            sort=[],
            limit=50,
        )


def test_structured_source_resolution_accepts_product_names_but_rejects_ambiguity(
    tmp_path: Path,
):
    first = _file_source(tmp_path / "first.parquet")
    assert _resolve_structured_source([first], "订单明细") is first
    second = {
        **_file_source(tmp_path / "second.parquet"),
        "id": "orders-source-2",
        "name": "线上订单",
    }
    with pytest.raises(ValueError, match="不唯一"):
        _resolve_structured_source([first, second], "线上订单")


@pytest.mark.asyncio
async def test_agent_structured_query_is_executed_validated_and_bound_to_report(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "WORKSPACE_ROOT", tmp_path / "projects")
    source_path = tmp_path / "orders.parquet"
    pd.DataFrame(
        [
            {"商品品类": "办公用品", "实付金额": 32.0, "退款状态": "否"},
            {"商品品类": "办公用品", "实付金额": 30.0, "退款状态": "否"},
            {"商品品类": "耗材", "实付金额": 28.0, "退款状态": "已退款"},
        ]
    ).to_parquet(source_path, index=False)
    source = _file_source(source_path)
    calls = 0

    def model(_messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        nonlocal calls
        calls += 1
        if calls == 1:
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "query_source_data",
                        {
                            "purpose": "按品类核对有效销售额",
                            "result_name": "category_sales",
                            "source_id": "订单明细",
                            "dimensions": ["商品品类"],
                            "metrics": [
                                {
                                    "operation": "sum",
                                    "column": "实付金额",
                                    "alias": "销售额",
                                }
                            ],
                            "filters": [{"column": "退款状态", "operator": "eq", "value": "否"}],
                            "sort": [{"field": "销售额", "direction": "desc"}],
                            "limit": 100,
                        },
                    )
                ]
            )
        if calls == 2:
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "validate_result",
                        {
                            "result_name": "category_sales",
                            "purpose": "核对最终品类汇总",
                            "key_columns": ["商品品类"],
                            "numeric_columns": ["销售额"],
                        },
                    )
                ]
            )
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "status": "completed",
                        "title": "有效销售额",
                        "summary": "办公用品有效销售额为 62。",
                        "primary_result": "category_sales",
                        "metrics": [{"label": "办公用品销售额", "value": "62"}],
                        "visualization": {
                            "type": "bar",
                            "title": "品类有效销售额",
                            "result_name": "category_sales",
                            "xKey": "商品品类",
                            "yKeys": ["销售额"],
                        },
                    },
                )
            ]
        )

    monkeypatch.setattr(models, "ALLOW_MODEL_REQUESTS", False)
    monkeypatch.setattr(
        analyst_runtime,
        "model_session",
        lambda _config, **_kwargs: nullcontext(FunctionModel(model)),
    )
    runtime = PydanticAnalystRuntime(
        model_config=synthetic_model_config(),
        project_context=ProjectRuntimeContext(name="销售项目", sources=[source]),
    )

    events = [event async for event in runtime.execute(query="比较各商品品类有效销售额")]
    result = next(event for event in events if event.type == SSEEventType.RESULT)

    assert [item["kind"] for item in runtime.deps.tool_history] == [
        "structured_query",
        "validation",
    ]
    assert runtime.deps.dataframes["category_sales"] == [{"商品品类": "办公用品", "销售额": 62.0}]
    assert runtime.deps.replay_journal[0]["op"] == "query_source_data"
    assert runtime.deps.result_metadata["category_sales"]["source_id"] == "orders-source"
    assert runtime.deps.result_metadata["category_sales"]["table_or_view"] == "online_orders"
    assert runtime.deps.result_metadata["category_sales"]["query_scope"] == "aggregated"
    assert runtime.deps.result_metadata["category_sales"]["source_refs"] == [
        {
            "source_id": "orders-source",
            "source_logical_name": "订单明细",
            "source_kind": "file",
            "table_or_view": "online_orders",
            "query_scope": "aggregated",
        }
    ]
    assert result.data["report"]["visualization"]["data"] == [
        {"商品品类": "办公用品", "销售额": 62.0}
    ]


@pytest.mark.asyncio
async def test_confirmed_verified_aggregate_metric_is_server_bound_and_receipted(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "WORKSPACE_ROOT", tmp_path / "projects")
    source_path = tmp_path / "orders.parquet"
    pd.DataFrame(
        [
            {"商品品类": "办公用品", "实付金额": 32.0, "退款状态": "否"},
            {"商品品类": "办公用品", "实付金额": 30.0, "退款状态": "否"},
            {"商品品类": "耗材", "实付金额": 28.0, "退款状态": "已退款"},
        ]
    ).to_parquet(source_path, index=False)
    source = _file_source(source_path)
    binding = stable_field_binding_candidates(source, "实付金额")[0]
    definition = {
        "version": 1,
        "kind": "aggregate_metric",
        "operation": "sum",
        "source": binding,
        "null_policy": "ignore",
        "business_name": "实付金额",
        "synonyms": ["付款金额", "实际支付金额"],
    }
    definition_hash = stable_payload_hash(definition)
    metric_key = "metric:verified-paid-amount"
    knowledge = {
        "id": "semantic-metric",
        "active_revision_id": "semantic-revision",
        "key": metric_key,
        "value": "实付金额合计",
        "type": "metric",
        "state": "confirmed",
        "validity": "active",
        "execution_state": "verified",
        "definition": definition,
        "definition_hash": definition_hash,
        **_table_scope_fields(source),
    }
    sibling_knowledge = {
        **knowledge,
        "id": "semantic-sibling-metric",
        "active_revision_id": "semantic-sibling-revision",
        "key": "metric:sibling-only",
        "scope_id": "scope:sibling-table",
        "scope_table_or_view": "customers",
        "definition": {
            **definition,
            "business_name": "客户表专用金额",
            "synonyms": ["不应出现在订单表"],
        },
    }
    sibling_knowledge["definition_hash"] = stable_payload_hash(sibling_knowledge["definition"])
    scope_receipt = "scope-receipt-paid-amount"
    calls = 0
    opened_semantics: list[dict] = []

    def model(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        nonlocal calls
        calls += 1
        if calls == 1:
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "inspect_table_semantics",
                        {"source_id": source["id"], "table": source["view_name"]},
                    )
                ]
            )
        if calls == 2:
            tool_return = next(
                part
                for message in messages
                if isinstance(message, ModelRequest)
                for part in message.parts
                if isinstance(part, ToolReturnPart) and part.tool_name == "inspect_table_semantics"
            )
            assert isinstance(tool_return.content, dict)
            opened_semantics.extend(tool_return.content["semantics"])
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "query_source_data",
                        {
                            "purpose": "按已确认指标计算实付金额",
                            "result_name": "paid_amount",
                            "semantic_metric_key": metric_key,
                            "semantic_scope_receipt": scope_receipt,
                        },
                    )
                ]
            )
        if calls == 3:
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "validate_result",
                        {
                            "result_name": "paid_amount",
                            "purpose": "核对已确认指标结果",
                            "numeric_columns": [f"metric_{definition_hash[:12]}"],
                        },
                    )
                ]
            )
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "status": "completed",
                        "title": "实付金额合计",
                        "summary": "已按确认并验证过的指标定义完成计算。",
                        "primary_result": "paid_amount",
                    },
                )
            ]
        )

    monkeypatch.setattr(models, "ALLOW_MODEL_REQUESTS", False)
    monkeypatch.setattr(semantics, "uuid4", lambda: scope_receipt)
    monkeypatch.setattr(
        analyst_runtime,
        "model_session",
        lambda _config, **_kwargs: nullcontext(FunctionModel(model)),
    )
    runtime = PydanticAnalystRuntime(
        model_config=synthetic_model_config(),
        project_context=ProjectRuntimeContext(
            name="确认指标执行",
            sources=[source],
            confirmed_knowledge=[knowledge, sibling_knowledge],
        ),
    )

    _ = [event async for event in runtime.execute(query="实付金额合计是多少")]

    alias = f"metric_{definition_hash[:12]}"
    assert runtime.deps.dataframes["paid_amount"] == [{alias: 90.0}]
    receipt = runtime.deps.result_metadata["paid_amount"]["semantic_metric"]
    assert receipt == {
        "kind": "semantic_metric_binding",
        "semantic_entry_id": knowledge["id"],
        "active_revision_id": knowledge["active_revision_id"],
        "metric_key": metric_key,
        "definition_hash": definition_hash,
        "operation": "sum",
        "source_binding": binding,
        "output_alias": alias,
    }
    assert runtime.deps.tool_history[0]["kind"] == "semantic_table_scope_opened"
    assert [item["id"] for item in opened_semantics] == [knowledge["id"]]
    assert opened_semantics[0]["definition"]["business_name"] == "实付金额"
    assert opened_semantics[0]["definition"]["synonyms"] == [
        "付款金额",
        "实际支付金额",
    ]
    assert runtime.deps.tool_history[1]["semantic_metric"] == receipt
    assert (
        runtime.deps.result_metadata["paid_amount"]["semantic_scope_receipt"]["receipt"]
        == scope_receipt
    )
    scope_context = runtime.deps.result_metadata["paid_amount"]["semantic_scope_receipt"][
        "scope_context_facts"
    ]
    assert scope_context == {
        "year": 2024,
        "period_evidence": "preanalysis_time_range",
        "business_topic": "Sales",
        "business_topic_status": "explicit",
    }
    assert runtime.deps.tool_history[0]["scope_context_facts"] == scope_context
    assert (
        runtime.deps.replay_journal[0]["semantic_scope_receipt"]["scope_context_facts"]
        == scope_context
    )
    assert runtime.deps.replay_journal[0]["semantic_metric"] == receipt


@pytest.mark.parametrize(
    "state,execution_state", [("candidate", "verified"), ("confirmed", "needs_validation")]
)
def test_aggregate_metric_binding_rejects_unconfirmed_or_unverified_definition(
    state: str,
    execution_state: str,
):
    source = _file_source(Path("orders.parquet"))
    definition = {
        "version": 1,
        "kind": "aggregate_metric",
        "operation": "sum",
        "source": stable_field_binding_candidates(source, "实付金额")[0],
        "null_policy": "ignore",
    }
    context = ProjectRuntimeContext(
        sources=[source],
        confirmed_knowledge=[
            {
                "id": "semantic-metric",
                "active_revision_id": "semantic-revision",
                "key": "metric:paid-amount",
                "type": "metric",
                "state": state,
                "validity": "active",
                "execution_state": execution_state,
                "definition": definition,
                "definition_hash": stable_payload_hash(definition),
            }
        ],
    )

    with pytest.raises(ValueError, match="尚未确认并通过当前版本验证"):
        _resolve_confirmed_aggregate_metric(context, "metric:paid-amount")


def test_confirmed_time_dimension_compiles_year_as_half_open_range():
    source = _file_source(Path("orders.parquet"))
    source["profile"]["schema"]["columns"].append({"name": "下单日期", "dtype": "datetime64[us]"})
    binding = stable_field_binding_candidates(source, "下单日期")[0]
    definition = {
        "version": 1,
        "kind": "dimension",
        "role": "time",
        "source": binding,
        "business_name": "下单日期",
        "time_granularities": ["year", "month", "day"],
        "timezone": "Asia/Shanghai",
    }
    entry = {
        "id": "semantic-date",
        "active_revision_id": "semantic-date-revision",
        "key": "dimension:order-date",
        "type": "dimension",
        "state": "confirmed",
        "validity": "active",
        "execution_state": "verified",
        "definition": definition,
        "definition_hash": stable_payload_hash(definition),
    }
    context = ProjectRuntimeContext(sources=[source], confirmed_knowledge=[entry])

    resolved_entry, resolved_source, column, receipt = _resolve_confirmed_dimension(
        context,
        entry["key"],
    )
    filters = _compile_semantic_dimension_filter(
        SemanticDimensionFilter(
            dimension_key=entry["key"],
            operator="year_eq",
            value=2023,
        ),
        column=column,
        receipt=receipt,
    )

    assert resolved_entry is entry
    assert resolved_source is source
    assert [item.model_dump() for item in filters] == [
        {"column": "下单日期", "operator": "gte", "value": "2023-01-01"},
        {"column": "下单日期", "operator": "lt", "value": "2024-01-01"},
    ]


@pytest.mark.asyncio
async def test_confirmed_year_department_and_sales_semantics_execute_together(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "WORKSPACE_ROOT", tmp_path / "projects")
    source_path = tmp_path / "department-sales.parquet"
    pd.DataFrame(
        [
            {"业务日期": "2023-02-01", "部门": "华东部", "销量": 5},
            {"业务日期": "2023-08-01", "部门": "华北部", "销量": 8},
            {"业务日期": "2024-01-01", "部门": "华东部", "销量": 10},
        ]
    ).assign(业务日期=lambda frame: pd.to_datetime(frame["业务日期"])).to_parquet(
        source_path,
        index=False,
    )
    source = {
        "id": "department-sales-source",
        "name": "部门销量",
        "kind": "file",
        "format": "parquet",
        "view_name": "department_sales",
        "working_uri": str(source_path),
        "profile": {
            "logical_name": "部门销量明细",
            "schema": {
                "columns": [
                    {"name": "业务日期", "dtype": "datetime64[us]"},
                    {"name": "部门", "dtype": "object"},
                    {"name": "销量", "dtype": "int64"},
                ]
            },
        },
    }

    def governed_entry(
        *,
        entry_id: str,
        key: str,
        entry_type: str,
        definition: dict,
    ) -> dict:
        return {
            "id": entry_id,
            "active_revision_id": f"{entry_id}-revision",
            "key": key,
            "value": definition.get("business_name") or key,
            "type": entry_type,
            "state": "confirmed",
            "validity": "active",
            "execution_state": "verified",
            "definition": definition,
            "definition_hash": stable_payload_hash(definition),
            **_table_scope_fields(source, scope_id="scope:department-sales"),
        }

    metric_key = "metric:sales-volume"
    department_key = "dimension:department"
    date_key = "dimension:business-date"
    metric_definition = {
        "version": 1,
        "kind": "aggregate_metric",
        "operation": "sum",
        "source": stable_field_binding_candidates(source, "销量")[0],
        "null_policy": "ignore",
        "business_name": "销量",
    }
    department_definition = {
        "version": 1,
        "kind": "dimension",
        "role": "category",
        "source": stable_field_binding_candidates(source, "部门")[0],
        "business_name": "部门",
    }
    date_definition = {
        "version": 1,
        "kind": "dimension",
        "role": "time",
        "source": stable_field_binding_candidates(source, "业务日期")[0],
        "business_name": "业务日期",
        "time_granularities": ["year", "month", "day"],
        "timezone": "Asia/Shanghai",
    }
    knowledge = [
        governed_entry(
            entry_id="semantic-sales",
            key=metric_key,
            entry_type="metric",
            definition=metric_definition,
        ),
        governed_entry(
            entry_id="semantic-department",
            key=department_key,
            entry_type="dimension",
            definition=department_definition,
        ),
        governed_entry(
            entry_id="semantic-business-date",
            key=date_key,
            entry_type="dimension",
            definition=date_definition,
        ),
    ]
    metric_alias = f"metric_{stable_payload_hash(metric_definition)[:12]}"
    scope_receipt = "scope-receipt-department-sales"
    calls = 0

    def model(_messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        nonlocal calls
        calls += 1
        if calls == 1:
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "inspect_table_semantics",
                        {"source_id": source["id"], "table": source["view_name"]},
                    )
                ]
            )
        if calls == 2:
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "query_source_data",
                        {
                            "purpose": "比较 2023 年各部门销量",
                            "result_name": "department_sales_2023",
                            "semantic_metric_key": metric_key,
                            "semantic_dimension_keys": [department_key],
                            "semantic_scope_receipt": scope_receipt,
                            "semantic_dimension_filters": [
                                {
                                    "dimension_key": date_key,
                                    "operator": "year_eq",
                                    "value": 2023,
                                }
                            ],
                        },
                    )
                ]
            )
        if calls == 3:
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "validate_result",
                        {
                            "result_name": "department_sales_2023",
                            "purpose": "核对分部门销量",
                            "key_columns": ["部门"],
                            "numeric_columns": [metric_alias],
                        },
                    )
                ]
            )
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "status": "completed",
                        "title": "2023 年部门销量",
                        "summary": "已按确认的日期、部门和销量口径完成计算。",
                        "primary_result": "department_sales_2023",
                    },
                )
            ]
        )

    monkeypatch.setattr(models, "ALLOW_MODEL_REQUESTS", False)
    monkeypatch.setattr(semantics, "uuid4", lambda: scope_receipt)
    monkeypatch.setattr(
        analyst_runtime,
        "model_session",
        lambda _config, **_kwargs: nullcontext(FunctionModel(model)),
    )
    runtime = PydanticAnalystRuntime(
        model_config=synthetic_model_config(),
        project_context=ProjectRuntimeContext(
            name="已治理部门销量",
            sources=[source],
            confirmed_knowledge=knowledge,
        ),
    )

    _ = [event async for event in runtime.execute(query="看 2023 年哪个部门的销量")]

    assert runtime.deps.dataframes["department_sales_2023"] == [
        {"部门": "华东部", metric_alias: 5.0},
        {"部门": "华北部", metric_alias: 8.0},
    ]
    metadata = runtime.deps.result_metadata["department_sales_2023"]
    assert [item["dimension_key"] for item in metadata["semantic_dimensions"]] == [department_key]
    assert metadata["semantic_dimension_filters"][0]["dimension_key"] == date_key
    assert metadata["semantic_dimension_filters"][0]["operator"] == "year_eq"
    assert metadata["semantic_metric"]["metric_key"] == metric_key
    assert metadata["semantic_scope_receipt"]["receipt"] == scope_receipt


@pytest.mark.asyncio
async def test_confirmed_derived_metric_uses_governed_formula_with_year_and_department(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "WORKSPACE_ROOT", tmp_path / "projects")
    source_path = tmp_path / "department-profit.parquet"
    pd.DataFrame(
        [
            {"业务日期": "2023-02-01", "部门": "华东部", "销售额": 100, "成本": 60},
            {"业务日期": "2023-08-01", "部门": "华北部", "销售额": 80, "成本": 50},
            {"业务日期": "2024-01-01", "部门": "华东部", "销售额": 70, "成本": 40},
        ]
    ).assign(业务日期=lambda frame: pd.to_datetime(frame["业务日期"])).to_parquet(
        source_path,
        index=False,
    )
    source = {
        "id": "department-profit-source",
        "name": "部门损益",
        "kind": "file",
        "format": "parquet",
        "view_name": "department_profit",
        "working_uri": str(source_path),
        "profile": {
            "logical_name": "部门损益明细",
            "schema": {
                "columns": [
                    {"name": "业务日期", "dtype": "datetime64[us]"},
                    {"name": "部门", "dtype": "object"},
                    {"name": "销售额", "dtype": "int64"},
                    {"name": "成本", "dtype": "int64"},
                ]
            },
        },
    }

    formula = {
        "kind": "metric_formula",
        "output_column": "毛利",
        "expression": {
            "op": "subtract",
            "left": {"op": "column", "name": "销售额"},
            "right": {"op": "column", "name": "成本"},
        },
        "evaluation_order": "row_then_aggregate",
        "null_policy": "zero",
        "divide_by_zero": "error",
    }
    profit_definition = {
        "version": 1,
        "kind": "derived_metric",
        "aggregate": "sum",
        "formula": formula,
        "sources": [
            stable_field_binding_candidates(source, "销售额")[0],
            stable_field_binding_candidates(source, "成本")[0],
        ],
        "business_name": "毛利",
        "description": "销售额减去成本后按明细求和",
    }
    department_definition = {
        "version": 1,
        "kind": "dimension",
        "role": "category",
        "source": stable_field_binding_candidates(source, "部门")[0],
        "business_name": "部门",
    }
    date_definition = {
        "version": 1,
        "kind": "dimension",
        "role": "time",
        "source": stable_field_binding_candidates(source, "业务日期")[0],
        "business_name": "业务日期",
        "time_granularities": ["year", "month", "day"],
        "timezone": "Asia/Shanghai",
    }

    def entry(entry_id: str, key: str, entry_type: str, definition: dict) -> dict:
        return {
            "id": entry_id,
            "active_revision_id": f"{entry_id}-revision",
            "key": key,
            "value": definition["business_name"],
            "type": entry_type,
            "state": "confirmed",
            "validity": "active",
            "execution_state": "verified",
            "definition": definition,
            "definition_hash": stable_payload_hash(definition),
            **_table_scope_fields(source, scope_id="scope:department-profit"),
        }

    profit_key = "metric:gross-profit"
    department_key = "dimension:department"
    date_key = "dimension:business-date"
    knowledge = [
        entry("semantic-profit", profit_key, "metric", profit_definition),
        entry("semantic-department", department_key, "dimension", department_definition),
        entry("semantic-date", date_key, "dimension", date_definition),
    ]
    context = ProjectRuntimeContext(
        name="已治理部门毛利",
        sources=[source],
        confirmed_knowledge=knowledge,
    )
    _resolved_entry, _resolved_source, _metric, receipt = _resolve_confirmed_derived_metric(
        context, profit_key
    )
    assert receipt["formula_hash"] == stable_payload_hash(formula)
    metric_alias = receipt["output_alias"]
    scope_receipt = "scope-receipt-department-profit"
    calls = 0

    def model(_messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        nonlocal calls
        calls += 1
        if calls == 1:
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "inspect_table_semantics",
                        {"source_id": source["id"], "table": source["view_name"]},
                    )
                ]
            )
        if calls == 2:
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "query_source_data",
                        {
                            "purpose": "比较 2023 年各部门毛利",
                            "result_name": "department_profit_2023",
                            "semantic_metric_key": profit_key,
                            "semantic_dimension_keys": [department_key],
                            "semantic_scope_receipt": scope_receipt,
                            "semantic_dimension_filters": [
                                {
                                    "dimension_key": date_key,
                                    "operator": "year_eq",
                                    "value": 2023,
                                }
                            ],
                        },
                    )
                ]
            )
        if calls == 3:
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "validate_result",
                        {
                            "result_name": "department_profit_2023",
                            "purpose": "核对分部门毛利",
                            "key_columns": ["部门"],
                            "numeric_columns": [metric_alias],
                        },
                    )
                ]
            )
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "status": "completed",
                        "title": "2023 年部门毛利",
                        "summary": "已按确认的日期、部门和毛利公式完成计算。",
                        "primary_result": "department_profit_2023",
                    },
                )
            ]
        )

    monkeypatch.setattr(models, "ALLOW_MODEL_REQUESTS", False)
    monkeypatch.setattr(semantics, "uuid4", lambda: scope_receipt)
    monkeypatch.setattr(
        analyst_runtime,
        "model_session",
        lambda _config, **_kwargs: nullcontext(FunctionModel(model)),
    )
    runtime = PydanticAnalystRuntime(model_config=synthetic_model_config(), project_context=context)

    _ = [event async for event in runtime.execute(query="看 2023 年哪个部门的毛利")]

    assert runtime.deps.dataframes["department_profit_2023"] == [
        {"部门": "华东部", metric_alias: 40.0},
        {"部门": "华北部", metric_alias: 30.0},
    ]
    metadata = runtime.deps.result_metadata["department_profit_2023"]
    assert metadata["semantic_metric"]["kind"] == "semantic_derived_metric_binding"
    assert metadata["semantic_metric"]["metric_key"] == profit_key
    assert metadata["semantic_scope_receipt"]["receipt"] == scope_receipt
