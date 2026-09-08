"""Project-level reusable analysis playbook tests."""

from __future__ import annotations

import json
from contextlib import nullcontext
from copy import deepcopy
from datetime import UTC, datetime
from uuid import UUID

import pytest
from httpx import AsyncClient
from pydantic import TypeAdapter, ValidationError
from pydantic_ai.models.test import TestModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import AnalysisRun, Project, ProjectDataSource
from app.models.workspace import AnalysisPlaybookResponse, AnalysisPlaybookStep
from app.services import analyst_runtime
from app.services.analyst_runtime import PydanticAnalystRuntime
from app.services.checkpoint_contract import stable_payload_hash
from app.services.project_context import load_project_context
from app.services.standing_workspace import (
    StandingWorkspaceError,
    validate_playbook_execution_evidence,
)
from tests.model_fixtures import synthetic_model_config


async def _seed_validated_run(
    db: AsyncSession,
    *,
    query: str = "比较各门店订单量",
    state: str = "completed",
) -> tuple[Project, AnalysisRun]:
    project = Project(name="可复用分析项目")
    db.add(project)
    await db.flush()
    orders = ProjectDataSource(
        project_id=project.id,
        kind="file",
        name="orders.xlsx",
        format="xlsx",
        status="ready",
        profile_data={
            "logical_name": "orders",
            "schema": {
                "columns": [
                    {"name": "store_id", "type": "VARCHAR"},
                    {"name": "refund_status", "type": "VARCHAR"},
                    {"name": "net_revenue", "type": "DOUBLE"},
                ]
            },
        },
    )
    stores = ProjectDataSource(
        project_id=project.id,
        kind="file",
        name="stores.csv",
        format="csv",
        status="ready",
        profile_data={
            "logical_name": "stores",
            "schema": {
                "columns": [
                    {"name": "store_id", "type": "VARCHAR"},
                    {"name": "store_name", "type": "VARCHAR"},
                ]
            },
        },
    )
    db.add_all([orders, stores])
    await db.flush()
    refs = [
        {
            "source_id": str(orders.id),
            "source_logical_name": "orders",
            "source_kind": "file",
        },
        {
            "source_id": str(stores.id),
            "source_logical_name": "stores",
            "source_kind": "file",
        },
    ]
    tool_history = [
        {
            "kind": "file_sql",
            "purpose": "读取线上订单 SELECT 不应进入配方",
            "sql": "SELECT * FROM orders",
            "result_name": "orders_raw",
        },
        {
            "kind": "business_rule_application",
            "purpose": "按确认口径扣除退款",
            "rule_key": "revenue_refund_policy",
            "source_result": "orders_raw",
            "column": "refund_status",
            "operator": "exclude",
            "values": ["refunded"],
            "result_name": "orders_filtered",
        },
        {
            "kind": "file_sql",
            "purpose": "读取门店档案",
            "sql": "SELECT * FROM stores",
            "result_name": "stores_ready",
        },
        {
            "kind": "relationship_application",
            "purpose": "重新核对订单与门店的匹配率",
            "relationship_key": "relationship:orders_store",
            "definition_hash": "a" * 64,
            "left_result": "orders_filtered",
            "right_result": "stores_ready",
            "profile": {
                "left_key": "store_id",
                "right_key": "store_id",
                "normalization": "exact",
            },
        },
        {
            "kind": "join",
            "purpose": "把订单匹配到门店",
            "left_result": "orders_filtered",
            "right_result": "stores_ready",
            "result_name": "joined_orders",
            "relationship_key": "relationship:orders_store",
            "definition_hash": "a" * 64,
            "left_key": "store_id",
            "right_key": "store_id",
            "how": "left",
            "profile": {"normalization": "exact"},
            "source_refs": refs,
        },
        {
            "kind": "aggregate",
            "purpose": "按门店汇总订单数",
            "source_result": "joined_orders",
            "result_name": "store_order_summary",
            "group_by": ["store_name"],
            "operation": "count",
            "value_column": None,
            "output_column": "orders",
        },
        {
            "kind": "validation",
            "purpose": "核对门店订单量最终汇总",
            "result_name": "store_order_summary",
            "profile": {
                "materialized_rows": 12,
                "columns": ["store_name", "orders"],
                "keys": {"store_name": {}},
                "numeric": {"orders": {"count": 12}},
                "truncated": False,
                "source_refs": refs,
            },
        },
        {
            "kind": "python",
            "purpose": "生成门店订单量比较",
            "chart_type": "bar",
            "result_name": "store_order_summary",
            "generated": True,
            "code": "import seaborn as sns",
        },
    ]
    run = AnalysisRun(
        project_id=project.id,
        query=query,
        state=state,
        stage=state,
        report={"status": state, "title": "门店订单量分析"},
        checkpoint={"tool_history": tool_history, "resumable": False},
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    return project, run


async def _seed_structured_query_run(
    db: AsyncSession,
    *,
    query: str = "比较各商品品类有效销售额",
) -> tuple[Project, AnalysisRun]:
    project = Project(name="系统复跑项目")
    db.add(project)
    await db.flush()
    orders = ProjectDataSource(
        project_id=project.id,
        kind="file",
        name="orders.csv",
        format="csv",
        status="ready",
        profile_data={
            "logical_name": "orders",
            "schema": {
                "columns": [
                    {"name": "category", "type": "VARCHAR"},
                    {"name": "paid_amount", "type": "DOUBLE"},
                    {"name": "refund_status", "type": "VARCHAR"},
                ]
            },
        },
    )
    db.add(orders)
    await db.flush()
    source_ref = {
        "source_id": str(orders.id),
        "source_logical_name": "orders",
        "source_kind": "file",
        "table_or_view": "orders",
        "query_scope": "aggregated",
    }
    tool_history = [
        {
            "kind": "structured_query",
            "source_kind": "file",
            "source_id": str(orders.id),
            "source_refs": [source_ref],
            "purpose": "按品类核对有效销售额",
            "query_plan": {
                "source_id": str(orders.id),
                "table": "orders",
                "table_or_view": "orders",
                "query_scope": "aggregated",
                "dimensions": ["category"],
                "metrics": [{"operation": "sum", "column": "paid_amount", "alias": "sales"}],
                "filters": [{"column": "refund_status", "operator": "eq", "value": "paid"}],
                "sort": [{"field": "sales", "direction": "desc"}],
                "limit": 100,
                "is_aggregate": True,
            },
            "compiled_sql": "SELECT category, SUM(paid_amount) AS sales FROM orders",
            "result_name": "category_sales",
            "rows": 3,
            "truncated": False,
            "result_completeness": "complete",
        },
        {
            "kind": "validation",
            "purpose": "核对最终品类汇总",
            "result_name": "category_sales",
            "profile": {
                "materialized_rows": 3,
                "columns": ["category", "sales"],
                "keys": {"category": {}},
                "numeric": {"sales": {"count": 3}},
                "truncated": False,
                "source_refs": [source_ref],
            },
        },
    ]
    run = AnalysisRun(
        project_id=project.id,
        query=query,
        state="completed",
        stage="completed",
        report={"status": "completed", "title": "品类有效销售额"},
        checkpoint={"tool_history": tool_history, "resumable": False},
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    return project, run


def _nested_keys(value: object) -> set[str]:
    if isinstance(value, dict):
        return set(value) | {key for nested in value.values() for key in _nested_keys(nested)}
    if isinstance(value, list):
        return {key for nested in value for key in _nested_keys(nested)}
    return set()


def _rename_runtime_results(tool_history: list[dict]) -> list[dict]:
    renamed = deepcopy(tool_history)
    mapping = {
        "orders_raw": "本月订单输入",
        "orders_filtered": "本月口径结果",
        "stores_ready": "本月门店输入",
        "joined_orders": "本月关联结果",
        "store_order_summary": "本月门店订单汇总",
    }
    for item in renamed:
        for key in ("result_name", "source_result", "left_result", "right_result"):
            if item.get(key) in mapping:
                item[key] = mapping[item[key]]
        profile = item.get("profile")
        if isinstance(profile, dict) and "materialized_rows" in profile:
            profile["materialized_rows"] = 999
    return renamed


def test_typed_playbook_steps_reject_raw_execution_payloads():
    adapter = TypeAdapter(AnalysisPlaybookStep)
    with pytest.raises(ValidationError):
        adapter.validate_python(
            {
                "order": 1,
                "kind": "read_data",
                "summary": "读取订单",
                "input_results": [],
                "output_result": "result_1",
                "source_roles": ["orders"],
                "required_columns": ["store_id"],
                "sql": "SELECT * FROM orders",
            }
        )
    with pytest.raises(ValidationError):
        adapter.validate_python(
            {
                "order": 2,
                "kind": "apply_rule",
                "summary": "应用退款口径",
                "input_results": ["result_1"],
                "output_result": "result_2",
                "rule_key": "revenue_refund_policy",
            }
        )
    with pytest.raises(ValidationError):
        adapter.validate_python(
            {
                "order": 1,
                "kind": "structured_query",
                "summary": "按品类汇总",
                "input_results": [],
                "output_result": "result_1",
                "source_role": "orders",
                "plan": {
                    "table": "orders",
                    "dimensions": ["category"],
                    "metrics": [{"operation": "count", "alias": "orders"}],
                    "filters": [],
                    "sort": [],
                    "limit": 100,
                    "source_id": "physical-source-id",
                },
            }
        )


def test_rule_step_action_kinds_enforce_filter_boundaries():
    adapter = TypeAdapter(AnalysisPlaybookStep)
    base = {
        "order": 2,
        "kind": "apply_rule",
        "summary": "应用确认口径",
        "input_results": ["result_1"],
        "output_result": "result_2",
        "rule_key": "confirmed_policy",
        "column": "status",
    }
    value_filter = adapter.validate_python(
        {
            **base,
            "action_kind": "value_filter",
            "operator": "exclude",
            "values": ["refunded"],
        }
    )
    identity = adapter.validate_python({**base, "action_kind": "identity"})
    metric = adapter.validate_python(
        {**base, "action_kind": "metric_column", "column": "net_revenue"}
    )
    formula = adapter.validate_python(
        {
            **base,
            "action_kind": "metric_formula",
            "column": "net_revenue",
            "definition_hash": "b" * 64,
        }
    )
    assert value_filter.action_kind == "value_filter"
    assert identity.operator is None and identity.values is None
    assert metric.operator is None and metric.values is None
    assert formula.definition_hash == "b" * 64

    with pytest.raises(ValidationError):
        adapter.validate_python({**base, "action_kind": "value_filter"})
    with pytest.raises(ValidationError):
        adapter.validate_python({**base, "action_kind": "identity", "values": []})
    with pytest.raises(ValidationError):
        adapter.validate_python({**base, "action_kind": "metric_column", "operator": "include"})
    with pytest.raises(ValidationError):
        adapter.validate_python({**base, "action_kind": "metric_formula"})


def test_formula_playbook_requires_decimal_metric_to_survive_into_final_result():
    now = datetime.now(UTC)
    playbook = AnalysisPlaybookResponse.model_validate(
        {
            "schema_version": 2,
            "id": "pb_" + "a" * 20,
            "name": "净收入复核",
            "query": "按门店计算净收入",
            "source_roles": [],
            "confirmed_knowledge_keys": ["metric:net_revenue"],
            "relationship_keys": [],
            "steps": [
                {
                    "order": 1,
                    "kind": "apply_rule",
                    "summary": "应用净收入公式",
                    "input_results": ["result_1"],
                    "output_result": "result_2",
                    "rule_key": "metric:net_revenue",
                    "action_kind": "metric_formula",
                    "column": "net_revenue",
                    "definition_hash": "c" * 64,
                }
            ],
            "validation": {
                "input_result": "result_2",
                "columns": ["store", "net_total"],
                "key_columns": ["store"],
                "numeric_columns": ["net_total"],
                "must_not_be_truncated": True,
            },
            "shape_hash": "d" * 64,
            "created_at": now,
            "updated_at": now,
        }
    )
    assert playbook.schema_version == 2
    assert playbook.execution_mode == "agent_replan_required"
    history = [
        {
            "kind": "business_rule_application",
            "rule_key": "metric:net_revenue",
            "action_kind": "metric_formula",
            "column": "net_revenue",
            "definition_hash": "c" * 64,
            "result_name": "formula_rows",
        },
        {
            "kind": "aggregate",
            "source_result": "formula_rows",
            "result_name": "net_summary",
            "operation": "sum",
            "value_column": "net_revenue",
            "output_column": "net_total",
            "required_metric_column": "net_revenue",
            "metric_input_column": "net_revenue",
            "metric_output_column": "net_total",
            "required_metric_definition_hash": "c" * 64,
            "metric_policy_satisfied": True,
            "numeric_backend": "decimal",
            "decimal_aggregate_evidence": {"kind": "decimal_aggregate"},
        },
    ]
    validation = {
        "result_name": "net_summary",
        "profile": {
            "columns": ["store", "net_total"],
            "keys": {"store": {}},
            "numeric": {"net_total": {}},
        },
    }
    validate_playbook_execution_evidence(playbook, history, validation)

    counted = [
        *history,
        {
            "kind": "aggregate",
            "source_result": "net_summary",
            "result_name": "count_only",
            "operation": "count",
            # Reusing the same alias must not make a destructive count look
            # like the earlier Decimal metric survived.
            "output_column": "net_total",
            "required_metric_column": "net_revenue",
            "required_metric_definition_hash": "c" * 64,
            "metric_policy_satisfied": True,
            "metric_input_column": None,
            "metric_output_column": "net_total",
        },
    ]
    with pytest.raises(StandingWorkspaceError, match="没有重新执行"):
        validate_playbook_execution_evidence(
            playbook,
            counted,
            {
                "result_name": "count_only",
                "profile": {
                    "columns": ["store", "net_total"],
                    "keys": {"store": {}},
                    "numeric": {"net_total": {}},
                },
            },
        )


@pytest.mark.asyncio
async def test_capture_requires_completed_run_with_final_validation(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project, run = await _seed_validated_run(db_session, state="waiting_confirmation")

    incomplete = await client.post(
        f"/api/v1/projects/{project.id}/analysis-playbooks",
        json={"analysis_run_id": str(run.id)},
    )
    assert incomplete.status_code == 409

    original_history = deepcopy(run.checkpoint["tool_history"])
    run.state = "completed"
    run.stage = "completed"
    run.checkpoint = {
        **run.checkpoint,
        "tool_history": [
            item for item in run.checkpoint["tool_history"] if item.get("kind") != "validation"
        ],
    }
    await db_session.commit()
    unvalidated = await client.post(
        f"/api/v1/projects/{project.id}/analysis-playbooks",
        json={"analysis_run_id": str(run.id)},
    )
    assert unvalidated.status_code == 422

    run.checkpoint = {
        **run.checkpoint,
        "tool_history": [
            *original_history,
            {
                "kind": "aggregate",
                "purpose": "校验后又改变了最终结果",
                "source_result": "store_order_summary",
                "result_name": "unvalidated_final",
            },
        ],
    }
    await db_session.commit()
    stale_validation = await client.post(
        f"/api/v1/projects/{project.id}/analysis-playbooks",
        json={"analysis_run_id": str(run.id)},
    )
    assert stale_validation.status_code == 422

    run.checkpoint = {
        **run.checkpoint,
        "tool_history": [
            *original_history,
            {
                "kind": "python",
                "purpose": "校验后又运行自定义统计",
                "code": "print('unvalidated')",
            },
        ],
    }
    await db_session.commit()
    untyped_after_validation = await client.post(
        f"/api/v1/projects/{project.id}/analysis-playbooks",
        json={"analysis_run_id": str(run.id)},
    )
    assert untyped_after_validation.status_code == 422


@pytest.mark.asyncio
async def test_capture_rejects_binding_an_old_run_to_changed_sources(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project, run = await _seed_validated_run(db_session)
    source = (
        await db_session.execute(
            select(ProjectDataSource).where(
                ProjectDataSource.project_id == project.id,
                ProjectDataSource.name == "orders.xlsx",
            )
        )
    ).scalar_one()
    source.profile_data = {**source.profile_data, "version": 2}
    await db_session.commit()

    response = await client.post(
        f"/api/v1/projects/{project.id}/analysis-playbooks",
        json={"analysis_run_id": str(run.id)},
    )

    assert response.status_code == 409
    assert "调查完成后已经变化" in response.json()["detail"]


@pytest.mark.parametrize(
    ("action_kind", "column", "definition_hash"),
    [
        ("identity", "category", None),
        ("metric_column", "net_revenue", None),
        ("metric_formula", "net_revenue", "c" * 64),
    ],
)
@pytest.mark.asyncio
async def test_capture_supports_nonfilter_business_rule_strategies(
    client: AsyncClient,
    db_session: AsyncSession,
    action_kind: str,
    column: str,
    definition_hash: str | None,
):
    project, run = await _seed_validated_run(db_session)
    history = deepcopy(run.checkpoint["tool_history"])
    rule_application = next(
        item for item in history if item.get("kind") == "business_rule_application"
    )
    rule_application.update(
        {
            "action_kind": action_kind,
            "column": column,
            "operator": None,
            "values": [],
            "definition_hash": definition_hash,
        }
    )
    run.checkpoint = {**run.checkpoint, "tool_history": history}
    await db_session.commit()

    captured = await client.post(
        f"/api/v1/projects/{project.id}/analysis-playbooks",
        json={"analysis_run_id": str(run.id)},
    )
    assert captured.status_code == 200, captured.text
    rule_step = next(
        item for item in captured.json()["data"]["steps"] if item["kind"] == "apply_rule"
    )
    assert rule_step["action_kind"] == action_kind
    assert rule_step["column"] == column
    assert rule_step["operator"] is None
    assert rule_step["values"] is None
    assert rule_step["definition_hash"] == definition_hash

    context = await load_project_context(db_session, project.id)
    public_rule_step = next(
        item
        for item in context.public_summary()["reusable_analyses"][0]["steps"]
        if item["kind"] == "apply_rule"
    )
    assert public_rule_step["action_kind"] == action_kind
    assert "operator" not in public_rule_step
    assert "values" not in public_rule_step


@pytest.mark.asyncio
async def test_capture_v3_system_query_keeps_only_portable_typed_plan(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project, run = await _seed_structured_query_run(db_session)

    captured = await client.post(
        f"/api/v1/projects/{project.id}/analysis-playbooks",
        json={"analysis_run_id": str(run.id)},
    )

    assert captured.status_code == 200, captured.text
    playbook = captured.json()["data"]
    assert playbook["schema_version"] == 3
    assert playbook["execution_mode"] == "system_structured_query"
    assert [step["kind"] for step in playbook["steps"]] == [
        "structured_query",
        "validate_result",
    ]
    query_step = playbook["steps"][0]
    assert query_step["source_role"] == "orders"
    assert query_step["plan"] == {
        "table": "orders",
        "dimensions": ["category"],
        "metrics": [{"operation": "sum", "column": "paid_amount", "alias": "sales"}],
        "filters": [{"column": "refund_status", "operator": "eq", "value": "paid"}],
        "sort": [{"field": "sales", "direction": "desc"}],
        "limit": 100,
    }
    assert not (_nested_keys(playbook) & {"source_id", "sql", "compiled_sql"})
    serialized = json.dumps(playbook, ensure_ascii=False)
    assert str(run.checkpoint["tool_history"][0]["source_id"]) not in serialized
    assert "SELECT category" not in serialized

    changed_history = deepcopy(run.checkpoint["tool_history"])
    changed_history[0]["query_plan"]["limit"] = 250
    changed_run = AnalysisRun(
        project_id=project.id,
        query=run.query,
        state="completed",
        stage="completed",
        report=deepcopy(run.report),
        checkpoint={"tool_history": changed_history, "resumable": False},
    )
    db_session.add(changed_run)
    await db_session.commit()
    await db_session.refresh(changed_run)
    changed = await client.post(
        f"/api/v1/projects/{project.id}/analysis-playbooks",
        json={"analysis_run_id": str(changed_run.id)},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["data"]["shape_hash"] != playbook["shape_hash"]


@pytest.mark.asyncio
async def test_system_rerun_receipt_recaptures_as_system_mode(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project, run = await _seed_structured_query_run(db_session)
    first = await client.post(
        f"/api/v1/projects/{project.id}/analysis-playbooks",
        json={"analysis_run_id": str(run.id)},
    )
    assert first.status_code == 200, first.text
    playbook = first.json()["data"]
    query = deepcopy(run.checkpoint["tool_history"][0])
    source_ref = deepcopy(query["source_refs"][0])
    query.update(
        {
            "result_name": "result_1",
            "source_schema_signature": playbook["source_roles"][0]["schema_signature"],
        }
    )
    metadata = {
        "materialized_rows": 3,
        "truncated": False,
        "request_limit": 100,
        "source_id": query["source_id"],
        "table_or_view": "orders",
        "query_scope": "aggregated",
        "result_completeness": "complete",
        "query_plan": deepcopy(query["query_plan"]),
        "execution_backend": "duckdb",
        "execution_metadata": None,
        "source_refs": [source_ref],
    }
    profile = {
        "materialized_rows": 3,
        "columns": ["category", "sales"],
        "keys": {"category": {}},
        "numeric": {"sales": {"count": 3}},
        **metadata,
    }
    validation = {
        "kind": "validation",
        "purpose": "核对最终品类汇总",
        "result_name": "result_1",
        "result_hash": "a" * 64,
        "profile": profile,
    }
    receipt = {
        "version": 1,
        "kind": "analysis_playbook_execution",
        "status": "validated",
        "playbook_id": playbook["id"],
        "playbook_shape_hash": playbook["shape_hash"],
        "source_role": "orders",
        "source_kind": "file",
        "source_id": query["source_id"],
        "source_schema_signature": playbook["source_roles"][0]["schema_signature"],
        "plan_hash": stable_payload_hash(playbook["steps"][0]["plan"]),
        "result_name": "result_1",
        "row_count": 3,
        "truncated": False,
        "execution_backend": "duckdb",
        "result_hash": validation["result_hash"],
        "metadata_hash": stable_payload_hash(metadata),
        "profile_hash": stable_payload_hash(profile),
        "validation_hash": stable_payload_hash(validation),
    }
    run.checkpoint = {
        **run.checkpoint,
        "tool_history": [query, validation, receipt],
    }
    await db_session.commit()

    recaptured = await client.post(
        f"/api/v1/projects/{project.id}/analysis-playbooks",
        json={"analysis_run_id": str(run.id)},
    )

    assert recaptured.status_code == 200, recaptured.text
    assert recaptured.json()["data"]["execution_mode"] == "system_structured_query"
    assert recaptured.json()["data"]["shape_hash"] == playbook["shape_hash"]


@pytest.mark.asyncio
async def test_capture_v3_marks_independent_aggregate_for_agent_replanning(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project, run = await _seed_structured_query_run(db_session)
    history = deepcopy(run.checkpoint["tool_history"])
    validation = history.pop()
    history.extend(
        [
            {
                "kind": "aggregate",
                "purpose": "再次独立汇总",
                "source_result": "category_sales",
                "result_name": "category_counts",
                "group_by": ["category"],
                "operation": "count",
                "value_column": None,
                "output_column": "rows",
            },
            {
                **validation,
                "result_name": "category_counts",
                "profile": {
                    **validation["profile"],
                    "columns": ["category", "rows"],
                    "numeric": {"rows": {"count": 3}},
                },
            },
        ]
    )
    run.checkpoint = {**run.checkpoint, "tool_history": history}
    await db_session.commit()

    captured = await client.post(
        f"/api/v1/projects/{project.id}/analysis-playbooks",
        json={"analysis_run_id": str(run.id)},
    )

    assert captured.status_code == 200, captured.text
    playbook = captured.json()["data"]
    assert playbook["schema_version"] == 3
    assert playbook["execution_mode"] == "agent_replan_required"
    assert [step["kind"] for step in playbook["steps"]] == [
        "structured_query",
        "aggregate",
        "validate_result",
    ]
    parsed_playbook = AnalysisPlaybookResponse.model_validate(playbook)
    validate_playbook_execution_evidence(parsed_playbook, history, history[-1])

    unrelated_branch = deepcopy(history)
    required_aggregate = deepcopy(unrelated_branch[1])
    unrelated_branch[1] = {
        **unrelated_branch[1],
        "operation": "max",
        "value_column": "sales",
    }
    unrelated_branch.insert(
        2,
        {
            **required_aggregate,
            "source_result": "unrelated_rows",
            "result_name": "unrelated_count",
        },
    )
    with pytest.raises(StandingWorkspaceError, match="没有重新执行"):
        validate_playbook_execution_evidence(
            parsed_playbook,
            unrelated_branch,
            unrelated_branch[-1],
        )


@pytest.mark.asyncio
async def test_capture_keeps_chart_as_presentation_outside_system_method(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project, run = await _seed_structured_query_run(db_session)
    history = deepcopy(run.checkpoint["tool_history"])
    history.append(
        {
            "kind": "python",
            "purpose": "展示已校验结果",
            "generated": True,
            "chart_type": "bar",
            "result_name": "category_sales",
            "input_results": ["category_sales"],
            "images": 1,
            "x": "category",
            "y": "sales",
        }
    )
    run.checkpoint = {**run.checkpoint, "tool_history": history}
    await db_session.commit()

    captured = await client.post(
        f"/api/v1/projects/{project.id}/analysis-playbooks",
        json={"analysis_run_id": str(run.id)},
    )

    assert captured.status_code == 200, captured.text
    playbook = captured.json()["data"]
    assert playbook["execution_mode"] == "system_structured_query"
    assert [step["kind"] for step in playbook["steps"]] == [
        "structured_query",
        "validate_result",
    ]


@pytest.mark.asyncio
async def test_capture_is_stable_and_idempotently_updates_latest_run(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project, first_run = await _seed_validated_run(db_session)
    first = await client.post(
        f"/api/v1/projects/{project.id}/analysis-playbooks",
        json={"analysis_run_id": str(first_run.id), "name": "月度门店订单分析"},
    )
    assert first.status_code == 200, first.text
    first_playbook = first.json()["data"]
    assert first_playbook["id"].startswith("pb_")
    assert first_playbook["confirmed_knowledge_keys"] == ["revenue_refund_policy"]
    assert first_playbook["relationship_keys"] == ["relationship:orders_store"]
    assert {item["logical_name"] for item in first_playbook["source_roles"]} == {
        "orders",
        "stores",
    }
    assert first_playbook["schema_version"] == 3
    assert first_playbook["execution_mode"] == "agent_replan_required"
    assert first_playbook["binding_policy"] == "logical_role_then_schema"
    assert first_playbook["requires_revalidation"] is True
    assert len(first_playbook["shape_hash"]) == 64
    assert first_playbook["validation"] == {
        "input_result": "result_5",
        "columns": ["store_name", "orders"],
        "key_columns": ["store_name"],
        "numeric_columns": ["orders"],
        "must_not_be_truncated": True,
    }
    steps = first_playbook["steps"]
    assert [item["kind"] for item in steps] == [
        "read_data",
        "apply_rule",
        "read_data",
        "validate_relationship",
        "join",
        "aggregate",
        "validate_result",
        "visualize",
    ]
    assert steps[0]["source_roles"] == ["orders"]
    assert set(steps[0]["required_columns"]) == {
        "refund_status",
        "store_id",
    }
    assert steps[1]["input_results"] == ["result_1"]
    assert steps[1]["output_result"] == "result_2"
    assert steps[1]["rule_key"] == "revenue_refund_policy"
    assert steps[1]["action_kind"] == "value_filter"
    assert steps[1]["operator"] == "exclude"
    assert steps[1]["values"] == ["refunded"]
    assert steps[4]["input_results"] == ["result_2", "result_3"]
    assert steps[4]["output_result"] == "result_4"
    assert steps[4]["join_mode"] == "left"
    assert steps[5]["input_results"] == ["result_4"]
    assert steps[5]["output_result"] == "result_5"
    assert steps[5]["group_by"] == ["store_name"]
    assert steps[5]["operation"] == "count"
    assert steps[5]["output_column"] == "orders"
    assert steps[7] == {
        "order": 8,
        "summary": "用当前结果重新生成 bar 图表",
        "kind": "visualize",
        "input_results": ["result_5"],
        "output_result": None,
        "chart_type": "bar",
        "x": "store_name",
        "y": "orders",
        "value": None,
        "color": None,
    }
    forbidden_keys = {
        "source_id",
        "sql",
        "code",
        "output",
        "rows",
        "row_count",
        "truncated",
        "last_run_id",
    }
    assert not (_nested_keys(first_playbook) & forbidden_keys)
    serialized_playbook = json.dumps(first_playbook, ensure_ascii=False)
    assert "orders_raw" not in serialized_playbook
    assert "store_order_summary" not in serialized_playbook
    source_ids = {
        str(ref["source_id"]) for ref in first_run.checkpoint["tool_history"][4]["source_refs"]
    }
    assert not any(source_id in serialized_playbook for source_id in source_ids)

    second_run = AnalysisRun(
        project_id=project.id,
        query=first_run.query,
        state="completed",
        stage="completed",
        report=deepcopy(first_run.report),
        checkpoint={
            **deepcopy(first_run.checkpoint),
            "tool_history": _rename_runtime_results(first_run.checkpoint["tool_history"]),
        },
    )
    db_session.add(second_run)
    await db_session.commit()
    await db_session.refresh(second_run)
    second = await client.post(
        f"/api/v1/projects/{project.id}/analysis-playbooks",
        json={"analysis_run_id": str(second_run.id), "name": "更新后的门店订单分析"},
    )
    assert second.status_code == 200, second.text
    second_playbook = second.json()["data"]
    assert second_playbook["id"] == first_playbook["id"]
    assert second_playbook["created_at"] == first_playbook["created_at"]
    assert second_playbook["name"] == "更新后的门店订单分析"
    assert second_playbook["source_roles"] == first_playbook["source_roles"]
    assert second_playbook["steps"] == first_playbook["steps"]
    assert second_playbook["validation"] == first_playbook["validation"]
    assert second_playbook["shape_hash"] == first_playbook["shape_hash"]

    listed = await client.get(f"/api/v1/projects/{project.id}/analysis-playbooks")
    assert listed.status_code == 200
    assert len(listed.json()["data"]) == 1


@pytest.mark.asyncio
async def test_playbooks_are_project_isolated_and_deletable(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project, run = await _seed_validated_run(db_session)
    other = Project(name="其他项目")
    db_session.add(other)
    await db_session.commit()
    await db_session.refresh(other)

    wrong_capture = await client.post(
        f"/api/v1/projects/{other.id}/analysis-playbooks",
        json={"analysis_run_id": str(run.id)},
    )
    assert wrong_capture.status_code == 404
    captured = await client.post(
        f"/api/v1/projects/{project.id}/analysis-playbooks",
        json={"analysis_run_id": str(run.id)},
    )
    playbook_id = captured.json()["data"]["id"]

    wrong_delete = await client.delete(
        f"/api/v1/projects/{other.id}/analysis-playbooks/{playbook_id}"
    )
    assert wrong_delete.status_code == 404
    assert (await client.get(f"/api/v1/projects/{other.id}/analysis-playbooks")).json()[
        "data"
    ] == []

    deleted = await client.delete(f"/api/v1/projects/{project.id}/analysis-playbooks/{playbook_id}")
    assert deleted.status_code == 200
    assert deleted.json()["data"] == {"deleted": True, "playbook_id": playbook_id}
    assert (await client.get(f"/api/v1/projects/{project.id}/analysis-playbooks")).json()[
        "data"
    ] == []


@pytest.mark.asyncio
async def test_runtime_context_exposes_compact_candidate_and_prompt_requires_revalidation(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    project, run = await _seed_validated_run(db_session)
    captured = await client.post(
        f"/api/v1/projects/{project.id}/analysis-playbooks",
        json={"analysis_run_id": str(run.id)},
    )
    assert captured.status_code == 200, captured.text

    context = await load_project_context(db_session, project.id)
    reusable = context.public_summary()["reusable_analyses"]
    assert len(reusable) == 1
    assert reusable[0]["query"] == run.query
    assert "last_run_id" not in reusable[0]
    assert "created_at" not in reusable[0]
    assert reusable[0]["schema_version"] == 3
    assert reusable[0]["binding_policy"] == "logical_role_then_schema"
    assert reusable[0]["requires_revalidation"] is True
    assert len(reusable[0]["source_roles"][0]["schema_signature"]) == 64
    assert reusable[0]["steps"][4]["relationship_key"] == "relationship:orders_store"
    assert reusable[0]["steps"][5]["group_by"] == ["store_name"]
    assert reusable[0]["steps"][-1]["kind"] == "visualize"
    assert reusable[0]["steps"][-1]["x"] == "store_name"
    assert reusable[0]["steps"][-1]["y"] == "orders"
    assert reusable[0]["steps"][-1].get("value") is None
    assert reusable[0]["validation"]["input_result"] == "result_5"
    assert not (
        _nested_keys(reusable[0])
        & {"source_id", "sql", "code", "last_run_id", "row_count", "truncated"}
    )

    monkeypatch.setattr(analyst_runtime, "model_session", lambda _config, **_kwargs: nullcontext(TestModel()))
    runtime = PydanticAnalystRuntime(model_config=synthetic_model_config(), project_context=context)
    try:
        instructions = runtime._instructions()
    finally:
        runtime.deps.python_sandbox.cleanup()
    assert "reusable_analyses" in instructions
    assert "不得复用旧结果" in instructions
    assert "重验关系" in instructions
    assert "validate_result" in instructions


@pytest.mark.asyncio
async def test_project_bundle_roundtrips_analysis_playbooks(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project, run = await _seed_validated_run(db_session)
    captured = await client.post(
        f"/api/v1/projects/{project.id}/analysis-playbooks",
        json={"analysis_run_id": str(run.id)},
    )
    assert captured.status_code == 200, captured.text

    exported = await client.get(f"/api/v1/projects/{project.id}/export")
    assert exported.status_code == 200, exported.text
    bundle = exported.json()["data"]
    assert bundle["analysis_playbooks"][0]["id"] == captured.json()["data"]["id"]
    assert not (
        _nested_keys(bundle["analysis_playbooks"][0])
        & {"source_id", "sql", "code", "last_run_id", "row_count", "truncated"}
    )

    imported = await client.post("/api/v1/projects/import", json=bundle)
    assert imported.status_code == 200, imported.text
    imported_project_id = imported.json()["data"]["id"]
    imported_list = await client.get(f"/api/v1/projects/{imported_project_id}/analysis-playbooks")
    assert imported_list.status_code == 200
    imported_playbook = imported_list.json()["data"][0]
    assert imported_playbook == bundle["analysis_playbooks"][0]

    imported_context = await load_project_context(db_session, UUID(imported_project_id))
    assert imported_context.public_summary()["reusable_analyses"][0]["query"] == run.query
