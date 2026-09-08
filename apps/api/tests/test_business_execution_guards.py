"""Fail-closed contracts for executable business analysis."""

from __future__ import annotations

from contextlib import nullcontext
from copy import deepcopy
from pathlib import Path

import pytest
from httpx import AsyncClient
from openpyxl import Workbook
from pydantic_ai import (
    ModelMessage,
    ModelResponse,
    ToolCallPart,
    capture_run_messages,
    models,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import AnalysisRun, Conversation, Project, ProjectDataSource, SemanticEntry
from app.services import analyst_runtime
from app.services.analysis_checkpoint import CheckpointDriftError, stable_payload_hash
from app.services.analyst import knowledge_tools, python_tools
from app.services.analyst.relationships import _enforce_relationship_acceptance
from app.services.analyst_runtime import PydanticAnalystRuntime
from app.services.data_preflight import run_preflight
from app.services.metric_formula import aggregate_decimal_metric, apply_metric_formula
from app.services.project_context import ProjectRuntimeContext
from app.services.result_filters import resolve_confirmed_rule_strategy
from app.services.result_profile import profile_result
from tests.model_fixtures import synthetic_model_config


def _write_orders(path: Path) -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["订单号", "实付金额", "退款状态"])
    sheet.append(["O-1", 32, "否"])
    sheet.append(["O-2", 28, "已退款"])
    workbook.save(path)


def test_preflight_refund_options_carry_hidden_executable_strategies(tmp_path: Path):
    source = tmp_path / "orders.xlsx"
    _write_orders(source)

    result = run_preflight(source, tmp_path / "working")

    ambiguity = next(item for item in result.ambiguities if item["key"] == "revenue_refund_policy")
    assert ambiguity["options"] == ["扣除退款", "保留退款订单"]
    deduct = ambiguity["option_strategies"]["扣除退款"]
    assert deduct["action"] == {
        "kind": "value_filter",
        "column": "退款状态",
        "operator": "exclude",
        "values": ["已退款"],
        "observed_values": ["否", "已退款"],
    }
    assert ambiguity["option_strategies"]["保留退款订单"]["action"] == {
        "kind": "identity",
        "column": "退款状态",
        "observed_values": ["否", "已退款"],
    }


@pytest.mark.asyncio
async def test_confirmation_persists_selected_preflight_strategy(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project = Project(name="可执行口径")
    conversation = Conversation(title="收入", status="completed")
    db_session.add_all([project, conversation])
    await db_session.flush()
    strategy = {
        "version": 1,
        "kind": "business_rule_strategy",
        "rule_key": "revenue_refund_policy",
        "selected_option": "扣除退款",
        "action": {
            "kind": "value_filter",
            "column": "退款状态",
            "operator": "exclude",
            "values": ["已退款"],
            "observed_values": ["否", "已退款"],
        },
    }
    ambiguity = {
        "key": "revenue_refund_policy",
        "question": "计算收入时，退款订单需要扣除吗？",
        "reason": "会改变收入结论",
        "options": ["扣除退款", "保留退款订单"],
        "option_strategies": {"扣除退款": strategy},
    }
    source = ProjectDataSource(
        project_id=project.id,
        kind="file",
        name="orders.xlsx",
        status="needs_confirmation",
        profile_data={"is_current": True, "ambiguities": [ambiguity]},
    )
    run = AnalysisRun(
        project_id=project.id,
        conversation_id=conversation.id,
        query="收入是多少",
        state="waiting_confirmation",
        stage="waiting_confirmation",
        report={
            "status": "waiting_confirmation",
            "confirmation": {
                key: ambiguity[key] for key in ("key", "question", "reason", "options")
            },
        },
    )
    db_session.add_all([source, run])
    await db_session.commit()

    response = await client.post(
        "/api/v1/chat/confirm",
        json={
            "analysis_run_id": str(run.id),
            "key": "revenue_refund_policy",
            "selected_option": "扣除退款",
        },
    )

    assert response.status_code == 200, response.text
    entry = (
        await db_session.execute(
            select(SemanticEntry).where(
                SemanticEntry.project_id == project.id,
                SemanticEntry.key == "revenue_refund_policy",
            )
        )
    ).scalar_one()
    assert entry.definition == strategy
    knowledge = await client.get(f"/api/v1/projects/{project.id}/knowledge")
    assert knowledge.status_code == 200, knowledge.text
    assert knowledge.json()["data"][0]["definition"] == strategy


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("report_key", "request_key"),
    [
        ("refund_handling", "refund_policy"),
        ("refund_revenue_decision", "refund_revenue_decision"),
    ],
)
async def test_confirmation_aliases_share_canonical_strategy_receipt_and_knowledge(
    client: AsyncClient,
    db_session: AsyncSession,
    report_key: str,
    request_key: str,
):
    project = Project(name="口径别名归一化")
    conversation = Conversation(title="退款收入", status="completed")
    db_session.add_all([project, conversation])
    await db_session.flush()
    question = "计算收入时，退款订单需要扣除吗？"
    options = ["扣除退款", "保留退款订单"]
    source_strategy = {
        "version": 1,
        "kind": "business_rule_strategy",
        "rule_key": "refund_handling",
        "selected_option": "扣除退款",
        "action": {
            "kind": "value_filter",
            "column": "退款状态",
            "operator": "exclude",
            "values": ["已退款"],
            "observed_values": ["否", "已退款"],
        },
    }
    source = ProjectDataSource(
        project_id=project.id,
        kind="file",
        name="orders.xlsx",
        status="needs_confirmation",
        profile_data={
            "is_current": True,
            "ambiguities": [
                {
                    "key": "refund_policy",
                    "question": question,
                    "reason": "退款是否计入收入会改变销售额结论。",
                    "options": options,
                    "option_strategies": {"扣除退款": source_strategy},
                }
            ],
        },
    )
    run = AnalysisRun(
        project_id=project.id,
        conversation_id=conversation.id,
        query="收入是多少",
        state="waiting_confirmation",
        stage="waiting_confirmation",
        report={
            "status": "waiting_confirmation",
            "confirmation": {
                "key": report_key,
                "question": question,
                "reason": "退款是否计入收入会改变销售额结论。",
                "options": options,
            },
        },
    )
    db_session.add_all([source, run])
    await db_session.commit()

    response = await client.post(
        "/api/v1/chat/confirm",
        json={
            "analysis_run_id": str(run.id),
            "key": request_key,
            "selected_option": "扣除退款",
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["data"]["key"] == "revenue_refund_policy"
    await db_session.refresh(run)
    assert run.checkpoint["confirmation_receipt"]["key"] == "revenue_refund_policy"
    entry = (
        await db_session.execute(
            select(SemanticEntry).where(SemanticEntry.project_id == project.id)
        )
    ).scalar_one()
    assert entry.key == "revenue_refund_policy"
    assert entry.definition == {
        **source_strategy,
        "rule_key": "revenue_refund_policy",
    }
    knowledge = await client.get(f"/api/v1/projects/{project.id}/knowledge")
    assert knowledge.status_code == 200, knowledge.text
    assert knowledge.json()["data"][0]["key"] == "revenue_refund_policy"


def test_confirmed_rule_rejects_model_selected_filter_parameters():
    confirmed = {
        "key": "revenue_refund_policy",
        "value": "扣除退款",
        "definition": {
            "version": 1,
            "kind": "business_rule_strategy",
            "rule_key": "revenue_refund_policy",
            "selected_option": "扣除退款",
            "action": {
                "kind": "value_filter",
                "column": "退款状态",
                "operator": "exclude",
                "values": ["已退款"],
                "observed_values": ["否", "已退款"],
            },
        },
    }
    rows = [{"退款状态": "否"}, {"退款状态": "已退款"}]

    with pytest.raises(ValueError, match="已确认策略"):
        resolve_confirmed_rule_strategy(
            confirmed,
            rows,
            proposed_column="订单状态",
            proposed_operator="include",
            proposed_values=["完成"],
        )


def test_confirmed_rule_uses_stored_strategy_without_model_filter_parameters():
    confirmed = {
        "key": "revenue_refund_policy",
        "value": "扣除退款",
        "definition": {
            "version": 1,
            "kind": "business_rule_strategy",
            "rule_key": "revenue_refund_policy",
            "selected_option": "扣除退款",
            "action": {
                "kind": "value_filter",
                "column": "退款状态",
                "operator": "exclude",
                "values": ["已退款"],
                "observed_values": ["否", "已退款"],
            },
        },
    }

    strategy = resolve_confirmed_rule_strategy(
        confirmed,
        [{"退款状态": "否"}, {"退款状态": "已退款"}],
    )

    assert strategy["action"] == confirmed["definition"]["action"]


@pytest.mark.parametrize(
    ("keys", "numeric"),
    [(["missing_key"], []), ([], ["missing_amount"])],
)
def test_result_validation_rejects_requested_missing_columns(keys: list[str], numeric: list[str]):
    with pytest.raises(ValueError, match="不存在"):
        profile_result(
            [{"store": "一店", "amount": 12}],
            key_columns=keys,
            numeric_columns=numeric,
        )


def test_result_validation_rejects_numeric_column_without_finite_values():
    with pytest.raises(ValueError, match="有限数值"):
        profile_result(
            [{"amount": "N/A"}, {"amount": None}, {"amount": float("inf")}],
            key_columns=[],
            numeric_columns=["amount"],
        )


@pytest.mark.asyncio
async def test_python_join_is_rejected_before_execution_or_history_pollution(
    monkeypatch: pytest.MonkeyPatch,
):
    calls = 0

    def model(_messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        nonlocal calls
        calls += 1
        if calls == 1:
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "analyze_with_python",
                        {
                            "code": "result = orders.merge(stores, on='store_id')",
                            "purpose": "绕过统一关系工具",
                        },
                    )
                ]
            )
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {"status": "completed", "title": "已停止错误关联", "summary": "未执行。"},
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
        project_context=ProjectRuntimeContext(name="Python 关联门禁"),
    )
    runtime.deps.dataframes.update(
        {
            "orders": [{"store_id": "S-1", "amount": 32}],
            "stores": [{"store_id": "S-1", "name": "一店"}],
        }
    )
    runtime.deps.result_metadata.update(
        {
            "orders": {"source_refs": [{"source_id": "orders-file"}]},
            "stores": {"source_refs": [{"source_id": "stores-db"}]},
        }
    )
    executed = 0

    async def should_not_execute(*_args, **_kwargs):
        nonlocal executed
        executed += 1
        raise AssertionError("Python join must be rejected before execution")

    monkeypatch.setattr(python_tools, "execute_python_code", should_not_execute)

    with capture_run_messages() as messages:
        _ = [event async for event in runtime.execute(query="检查这段 Python 关联")]

    assert executed == 0
    assert runtime.deps.tool_history == []
    assert runtime.deps.replay_journal == []
    assert any(
        getattr(part, "part_kind", None) == "retry-prompt"
        and "join_results" in str(getattr(part, "content", ""))
        for message in messages
        for part in message.parts
    )


@pytest.mark.asyncio
async def test_required_relationship_candidate_can_trial_and_complete_only_after_final_validation(
    monkeypatch: pytest.MonkeyPatch,
):
    relationship_key = "relationship:orders:stores"
    definition_hash = "d" * 64
    candidate = {
        "id": "semantic-relationship",
        "active_revision_id": "semantic-revision",
        "key": relationship_key,
        "value": "订单按 store_id 关联门店",
        "state": "candidate",
        "validity": "unverified",
        "execution_state": "needs_validation",
        "definition_hash": definition_hash,
        "definition": {
            "version": 1,
            "left": {"table_or_view": "orders", "column": "store_id"},
            "right": {"table_or_view": "stores", "column": "store_id"},
            "normalization": "identifier",
            "cardinality": "many_to_one",
            "default_join": "left",
            "minimum_left_match_rate": 0.8,
            "maximum_expansion_ratio": 1.2,
        },
        "resolved_sources": {
            "left": {"source_id": "warehouse", "table_or_view": "orders"},
            "right": {"source_id": "warehouse", "table_or_view": "stores"},
        },
        "evidence": [],
    }
    context = ProjectRuntimeContext(
        name="关系修正试跑",
        candidate_relationships=[candidate],
        required_correction={
            "id": "correction-1",
            "source_run_id": "old-run",
            "semantic_entry_id": candidate["id"],
            "expected_active_revision_id": candidate["active_revision_id"],
            "target_key": relationship_key,
            "text": "订单和门店应按 store_id 关联",
            "correction_type": "relationship_rule",
            "definition_hash": definition_hash,
            "execution_state": "needs_validation",
            "executable": True,
        },
    )
    steps = [
        (
            "validate_relationship",
            {
                "left_result": "orders",
                "right_result": "stores",
                "purpose": "核对修正后的关联",
                "relationship_key": relationship_key,
            },
        ),
        (
            "join_results",
            {
                "left_result": "orders",
                "right_result": "stores",
                "result_name": "joined_orders",
                "purpose": "应用修正后的关联",
                "relationship_key": relationship_key,
            },
        ),
        (
            "validate_result",
            {
                "result_name": "joined_orders",
                "purpose": "核对最终关联结果",
                "key_columns": ["order_id"],
                "numeric_columns": ["amount"],
            },
        ),
    ]
    calls = 0

    def model(_messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        nonlocal calls
        calls += 1
        if calls <= len(steps):
            tool_name, arguments = steps[calls - 1]
            return ModelResponse(parts=[ToolCallPart(tool_name, arguments)])
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "status": "completed",
                        "title": "门店关联复核",
                        "summary": "修正后的门店关联已完成核对。",
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
    runtime = PydanticAnalystRuntime(model_config=synthetic_model_config(), project_context=context)
    runtime.deps.dataframes.update(
        {
            "orders": [{"order_id": "O-1", "store_id": "S-1", "amount": 32}],
            "stores": [{"store_id": "S-1", "store_name": "一店"}],
        }
    )
    runtime.deps.result_metadata.update(
        {
            "orders": {
                "query_scope": "full",
                "result_completeness": "complete",
                "source_refs": [
                    {
                        "source_id": "warehouse",
                        "table_or_view": "orders",
                        "query_scope": "full",
                    }
                ],
            },
            "stores": {
                "query_scope": "full",
                "result_completeness": "complete",
                "source_refs": [
                    {
                        "source_id": "warehouse",
                        "table_or_view": "stores",
                        "query_scope": "full",
                    }
                ],
            },
        }
    )

    _ = [event async for event in runtime.execute(query="按修正后的关系重新核对")]

    join = next(item for item in runtime.deps.tool_history if item.get("kind") == "join")
    receipt = next(
        item for item in runtime.deps.tool_history if item.get("kind") == "correction_application"
    )
    assert join["candidate_relationship_key"] == relationship_key
    assert join["definition_hash"] == definition_hash
    assert join["evidence_scope"] == "full_relation"
    assert join["reusable_proof_eligible"] is True
    assert receipt["status"] == "verified"
    assert receipt["application_result_name"] == "joined_orders"
    assert "final_result_revalidated_after_join" in receipt["checks"]


@pytest.mark.asyncio
async def test_ordinary_candidate_is_not_auto_selected_or_post_bound_by_join(
    monkeypatch: pytest.MonkeyPatch,
):
    candidate = {
        "id": "semantic-candidate",
        "active_revision_id": "candidate-revision",
        "key": "relationship:orders:stores",
        "value": "订单按 store_id 关联门店",
        "state": "candidate",
        "validity": "unverified",
        "execution_state": "needs_validation",
        "definition_hash": "a" * 64,
        "definition": {
            "version": 1,
            "left": {"table_or_view": "orders", "column": "store_id"},
            "right": {"table_or_view": "stores", "column": "store_id"},
            "normalization": "identifier",
            "cardinality": "many_to_one",
            "default_join": "left",
            "minimum_left_match_rate": 0.8,
            "maximum_expansion_ratio": 1.2,
        },
        "resolved_sources": {
            "left": {"source_id": "warehouse", "table_or_view": "orders"},
            "right": {"source_id": "warehouse", "table_or_view": "stores"},
        },
        "evidence": [],
    }
    context = ProjectRuntimeContext(
        name="普通候选关系门禁",
        candidate_relationships=[candidate],
    )
    steps = [
        (
            "join_results",
            {
                "left_result": "orders",
                "right_result": "stores",
                "result_name": "implicit_join",
                "purpose": "尝试自动采用候选关系",
            },
        ),
        (
            "join_results",
            {
                "left_result": "orders",
                "right_result": "stores",
                "result_name": "ad_hoc_join",
                "purpose": "只按当前结果显式核对字段",
                "left_key": "store_id",
                "right_key": "store_id",
                "normalization": "identifier",
            },
        ),
        (
            "validate_result",
            {
                "result_name": "ad_hoc_join",
                "purpose": "核对当前关联结果",
                "key_columns": ["order_id"],
                "numeric_columns": ["amount"],
            },
        ),
    ]
    calls = 0

    def model(_messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        nonlocal calls
        calls += 1
        if calls <= len(steps):
            tool_name, arguments = steps[calls - 1]
            return ModelResponse(parts=[ToolCallPart(tool_name, arguments)])
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "status": "completed",
                        "title": "当前结果关联",
                        "summary": "已按当前结果中的明确字段完成关联和核对。",
                        "primary_result": "ad_hoc_join",
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
    runtime = PydanticAnalystRuntime(model_config=synthetic_model_config(), project_context=context)
    runtime.deps.dataframes.update(
        {
            "orders": [{"order_id": "O-1", "store_id": "S-1", "amount": 32}],
            "stores": [{"store_id": "S-1", "store_name": "一店"}],
        }
    )
    runtime.deps.result_metadata.update(
        {
            "orders": {
                "query_scope": "full",
                "result_completeness": "complete",
                "source_refs": [
                    {
                        "source_id": "warehouse",
                        "table_or_view": "orders",
                        "query_scope": "full",
                    }
                ],
            },
            "stores": {
                "query_scope": "full",
                "result_completeness": "complete",
                "source_refs": [
                    {
                        "source_id": "warehouse",
                        "table_or_view": "stores",
                        "query_scope": "full",
                    }
                ],
            },
        }
    )

    with capture_run_messages() as messages:
        _ = [event async for event in runtime.execute(query="关联订单与门店")]

    joins = [item for item in runtime.deps.tool_history if item.get("kind") == "join"]
    assert [item["result_name"] for item in joins] == ["ad_hoc_join"]
    assert joins[0]["candidate_relationship_key"] is None
    assert joins[0]["definition_hash"] is None
    relationship_evidence = next(
        item for item in runtime.deps.tool_history if item.get("kind") == "relationship_validation"
    )
    assert relationship_evidence["semantic_entry_id"] is None
    assert relationship_evidence["active_revision_id"] is None
    assert relationship_evidence["definition_hash"] is None
    assert any(
        getattr(part, "part_kind", None) == "retry-prompt"
        and "不能自动采用待核对关系" in str(getattr(part, "content", ""))
        for message in messages
        for part in message.parts
    )


@pytest.mark.asyncio
async def test_metric_column_strategy_blocks_wrong_amount_aggregate_and_recovers(
    monkeypatch: pytest.MonkeyPatch,
):
    steps = [
        {
            "source_result": "policy_rows",
            "group_by": ["store"],
            "operation": "sum",
            "value_column": "毛收入",
            "output_column": "收入",
            "result_name": "wrong_revenue",
            "purpose": "错误使用毛收入",
        },
        {
            "source_result": "policy_rows",
            "group_by": ["store"],
            "operation": "sum",
            "value_column": "净收入",
            "output_column": "收入",
            "result_name": "net_revenue",
            "purpose": "按确认净额字段汇总",
        },
    ]
    calls = 0

    def model(_messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        nonlocal calls
        calls += 1
        if calls <= len(steps):
            return ModelResponse(parts=[ToolCallPart("aggregate_result", steps[calls - 1])])
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {"status": "completed", "title": "净收入", "summary": "已按净额字段汇总。"},
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
        project_context=ProjectRuntimeContext(name="净收入门禁"),
    )
    runtime.deps.dataframes["policy_rows"] = [
        {"store": "一店", "毛收入": 100, "净收入": 80},
        {"store": "一店", "毛收入": 50, "净收入": 40},
    ]
    runtime.deps.result_metadata["policy_rows"] = {
        "required_metric_column": "净收入",
        "business_rule": {"action_kind": "metric_column", "column": "净收入"},
    }

    with capture_run_messages() as messages:
        _ = [event async for event in runtime.execute(query="按确认口径汇总收入")]

    aggregates = [item for item in runtime.deps.tool_history if item["kind"] == "aggregate"]
    assert [item["result_name"] for item in aggregates] == ["net_revenue"]
    assert runtime.deps.result_metadata["net_revenue"]["required_metric_column"] == "净收入"
    assert any(
        getattr(part, "part_kind", None) == "retry-prompt"
        and "净收入" in str(getattr(part, "content", ""))
        for message in messages
        for part in message.parts
    )


@pytest.mark.asyncio
async def test_metric_formula_is_materialized_and_aggregated_with_decimal(
    monkeypatch: pytest.MonkeyPatch,
):
    definition = {
        "version": 1,
        "kind": "business_rule_strategy",
        "rule_key": "metric:net_revenue",
        "selected_option": "净收入 = 实付金额 - 退款金额",
        "action": {
            "kind": "metric_formula",
            "output_column": "净收入",
            "expression": {
                "op": "subtract",
                "left": {"op": "column", "name": "实付金额"},
                "right": {"op": "column", "name": "退款金额"},
            },
            "evaluation_order": "row_then_aggregate",
            "null_policy": "propagate",
            "divide_by_zero": "error",
        },
        "applies_to": [],
    }
    knowledge = {
        "id": "semantic-formula-1",
        "key": "metric:net_revenue",
        "value": "净收入 = 实付金额 - 退款金额",
        "state": "confirmed",
        "validity": "active",
        "execution_state": "verified",
        "definition": definition,
    }
    steps = [
        (
            "apply_confirmed_rule",
            {
                "source_result": "orders",
                "rule_key": "metric:net_revenue",
                "result_name": "orders_with_net_revenue",
                "purpose": "计算逐单净收入",
            },
        ),
        (
            "aggregate_result",
            {
                "source_result": "orders_with_net_revenue",
                "group_by": ["store"],
                "operation": "sum",
                "value_column": "净收入",
                "output_column": "净收入合计",
                "result_name": "net_revenue_by_store",
                "purpose": "按门店汇总净收入",
            },
        ),
        (
            "validate_result",
            {
                "result_name": "net_revenue_by_store",
                "purpose": "核对最终净收入",
                "key_columns": ["store"],
                "numeric_columns": ["净收入合计"],
            },
        ),
    ]
    calls = 0

    def model(_messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        nonlocal calls
        calls += 1
        if calls <= len(steps):
            tool_name, arguments = steps[calls - 1]
            return ModelResponse(parts=[ToolCallPart(tool_name, arguments)])
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "status": "completed",
                        "title": "门店净收入",
                        "summary": "已按确认公式完成逐单计算和汇总。",
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
    monkeypatch.setattr(
        knowledge_tools,
        "resolve_confirmed_rule_strategy",
        lambda *_args, **_kwargs: definition,
    )
    runtime = PydanticAnalystRuntime(
        model_config=synthetic_model_config(),
        project_context=ProjectRuntimeContext(
            name="公式指标门禁",
            confirmed_knowledge=[knowledge],
        ),
    )
    runtime.deps.dataframes["orders"] = [
        {"store": "一店", "实付金额": "0.3", "退款金额": "0.1"},
        {"store": "一店", "实付金额": "0.2", "退款金额": "0.1"},
    ]
    runtime.deps.result_metadata["orders"] = {"source_refs": []}

    _ = [event async for event in runtime.execute(query="按门店汇总净收入")]

    assert runtime.deps.dataframes["orders_with_net_revenue"] == [
        {"store": "一店", "实付金额": "0.3", "退款金额": "0.1", "净收入": "0.2"},
        {"store": "一店", "实付金额": "0.2", "退款金额": "0.1", "净收入": "0.1"},
    ]
    assert runtime.deps.dataframes["net_revenue_by_store"] == [
        {"store": "一店", "净收入合计": "0.3"}
    ]
    application = next(
        item
        for item in runtime.deps.tool_history
        if item.get("kind") == "business_rule_application"
    )
    aggregate = next(item for item in runtime.deps.tool_history if item.get("kind") == "aggregate")
    assert application["action_kind"] == "metric_formula"
    assert application["definition_hash"] == stable_payload_hash(definition)
    assert aggregate["required_metric_definition_hash"] == application["definition_hash"]
    assert aggregate["numeric_backend"] == "decimal"
    assert aggregate["decimal_aggregate_evidence"]["kind"] == "decimal_aggregate"
    formula_step = next(
        item for item in runtime.deps.replay_journal if item.get("op") == "apply_confirmed_rule"
    )
    assert formula_step["action"] == definition["action"]
    assert formula_step["formula_hash"] == application["formula_hash"]


@pytest.mark.asyncio
async def test_metric_formula_checkpoint_replay_rejects_semantic_hash_drift(
    monkeypatch: pytest.MonkeyPatch,
):
    action = {
        "kind": "metric_formula",
        "output_column": "net_revenue",
        "expression": {
            "op": "subtract",
            "left": {"op": "column", "name": "paid_amount"},
            "right": {"op": "column", "name": "refund_amount"},
        },
        "evaluation_order": "row_then_aggregate",
        "null_policy": "propagate",
        "divide_by_zero": "error",
    }
    definition = {
        "version": 1,
        "kind": "business_rule_strategy",
        "rule_key": "metric:net_revenue",
        "selected_option": "net_revenue = paid_amount - refund_amount",
        "action": action,
        "applies_to": [],
    }
    knowledge = {
        "id": "semantic-formula-1",
        "key": "metric:net_revenue",
        "value": definition["selected_option"],
        "state": "confirmed",
        "validity": "active",
        "execution_state": "verified",
        "definition": definition,
    }
    source_rows = [
        {"store": "A", "paid_amount": "0.3", "refund_amount": "0.1"},
        {"store": "A", "paid_amount": "0.2", "refund_amount": "0.1"},
    ]
    formula_rows, formula_evidence = apply_metric_formula(
        source_rows,
        rule_key=knowledge["key"],
        rule_value=knowledge["value"],
        action=action,
    )
    aggregate_rows, aggregate_evidence = aggregate_decimal_metric(
        formula_rows,
        value_column="net_revenue",
        operation="sum",
        group_by=["store"],
        output_column="net_revenue_total",
        limit=5000,
        null_policy="propagate",
    )
    definition_hash = stable_payload_hash(definition)
    result_metadata = {
        "orders": {"source_refs": []},
        "orders_with_net_revenue": {
            "source_result": "orders",
            "required_metric_column": "net_revenue",
            "required_metric_definition_hash": definition_hash,
            "required_metric_action_kind": "metric_formula",
            "metric_null_policy": "propagate",
            "metric_policy_satisfied": False,
            "source_refs": [],
        },
        "net_revenue_by_store": {
            "source_result": "orders_with_net_revenue",
            "required_metric_column": "net_revenue",
            "required_metric_definition_hash": definition_hash,
            "required_metric_action_kind": "metric_formula",
            "metric_policy_satisfied": True,
            "metric_input_column": "net_revenue",
            "metric_output_column": "net_revenue_total",
            "numeric_backend": "decimal",
            "decimal_aggregate_evidence": aggregate_evidence,
            "source_refs": [],
        },
    }
    dataframes = {
        "orders": source_rows,
        "orders_with_net_revenue": formula_rows,
        "net_revenue_by_store": aggregate_rows,
    }
    journal = [
        {
            "op": "query_project_files",
            "purpose": "读取订单",
            "planned_sql": "SELECT * FROM orders",
            "result_name": "orders",
            "result_hash": stable_payload_hash(source_rows),
        },
        {
            "op": "apply_confirmed_rule",
            "purpose": "计算逐单净收入",
            "source_result": "orders",
            "rule_key": knowledge["key"],
            "rule_value": knowledge["value"],
            "action_kind": "metric_formula",
            "semantic_entry_id": knowledge["id"],
            "definition_hash": definition_hash,
            "column": "net_revenue",
            "operator": None,
            "values": [],
            "action": action,
            "formula_hash": formula_evidence["formula_hash"],
            "result_name": "orders_with_net_revenue",
            "input_hash": stable_payload_hash(source_rows),
            "result_hash": stable_payload_hash(formula_rows),
        },
        {
            "op": "aggregate_result",
            "purpose": "按门店汇总净收入",
            "source_result": "orders_with_net_revenue",
            "group_by": ["store"],
            "operation": "sum",
            "value_column": "net_revenue",
            "output_column": "net_revenue_total",
            "result_name": "net_revenue_by_store",
            "limit": 5000,
            "input_hash": stable_payload_hash(formula_rows),
            "result_hash": stable_payload_hash(aggregate_rows),
            "required_metric_column": "net_revenue",
            "required_metric_definition_hash": definition_hash,
            "required_metric_action_kind": "metric_formula",
            "metric_policy_satisfied": True,
            "metric_input_column": "net_revenue",
            "metric_output_column": "net_revenue_total",
            "numeric_backend": "decimal",
            "decimal_aggregate_evidence": aggregate_evidence,
        },
        {
            "op": "validate_result",
            "purpose": "核对最终净收入",
            "result_name": "net_revenue_by_store",
            "result_hash": stable_payload_hash(aggregate_rows),
        },
    ]
    manifest = {
        "replay_journal": journal,
        "tool_history": [],
        "result_metadata": result_metadata,
    }

    monkeypatch.setattr(
        analyst_runtime,
        "model_session",
        lambda _config, **_kwargs: nullcontext(FunctionModel(lambda _messages, _info: ModelResponse(parts=[]))),
    )
    monkeypatch.setattr(
        analyst_runtime,
        "resolve_confirmed_rule_strategy",
        lambda *_args, **_kwargs: definition,
    )
    project_context = ProjectRuntimeContext(
        name="公式恢复",
        confirmed_knowledge=[knowledge],
    )
    runtime = PydanticAnalystRuntime(
        model_config=synthetic_model_config(),
        project_context=project_context,
        resume_state={
            "manifest": deepcopy(manifest),
            "dataframes": deepcopy(dataframes),
            "python_output": [],
            "python_images": [],
        },
    )
    await runtime.replay_checkpoint()
    assert runtime.deps.dataframes["net_revenue_by_store"] == aggregate_rows

    drifted_definition = deepcopy(definition)
    drifted_definition["action"]["null_policy"] = "zero"
    project_context.confirmed_knowledge[0]["definition"] = drifted_definition
    drifted_runtime = PydanticAnalystRuntime(
        model_config=synthetic_model_config(),
        project_context=project_context,
        resume_state={
            "manifest": deepcopy(manifest),
            "dataframes": deepcopy(dataframes),
            "python_output": [],
            "python_images": [],
        },
    )
    with pytest.raises(CheckpointDriftError, match="语义定义已经变化"):
        await drifted_runtime.replay_checkpoint()


@pytest.mark.asyncio
async def test_checkpoint_replay_filters_legacy_unscoped_relationship_proposals(
    monkeypatch: pytest.MonkeyPatch,
):
    rows = [{"order_id": "O-1"}]
    strict_observation = {
        "kind": "relationship_observation",
        "evidence_origin": "system",
        "evidence_scope": "full_relation",
        "completeness": "complete",
        "reusable_proof_eligible": True,
        "profile": {"truncated": False},
        "source_refs": [
            {
                "source_id": "warehouse",
                "table_or_view": "orders",
                "query_scope": "full",
            },
            {
                "source_id": "warehouse",
                "table_or_view": "stores",
                "query_scope": "full",
            },
        ],
    }
    proposals = [
        {"key": "revenue_refund_policy", "entry_type": "business_rule"},
        {
            "key": "relationship:strict",
            "entry_type": "relationship",
            "evidence": [strict_observation],
        },
        {
            "key": "relationship:legacy-source-only",
            "evidence": [
                {
                    **strict_observation,
                    "source_refs": [{"source_id": "warehouse"}],
                }
            ],
        },
        {
            "key": "relationship:legacy-partial",
            "entry_type": "relationship",
            "evidence": [
                {
                    **strict_observation,
                    "evidence_scope": "current_result",
                    "reusable_proof_eligible": False,
                }
            ],
        },
        {
            "key": "relationship:truncated",
            "entry_type": "relationship",
            "evidence": [{**strict_observation, "profile": {"truncated": True}}],
        },
    ]
    manifest = {
        "replay_journal": [
            {
                "op": "query_source_data",
                "planned_sql": "SELECT order_id FROM orders",
                "result_name": "orders",
                "result_hash": stable_payload_hash(rows),
            }
        ],
        "tool_history": [],
        "result_metadata": {},
        "knowledge_proposals": proposals,
    }
    monkeypatch.setattr(
        analyst_runtime,
        "model_session",
        lambda _config, **_kwargs: nullcontext(FunctionModel(lambda _messages, _info: ModelResponse(parts=[]))),
    )
    runtime = PydanticAnalystRuntime(
        model_config=synthetic_model_config(),
        project_context=ProjectRuntimeContext(name="旧关系证据恢复"),
        resume_state={
            "manifest": manifest,
            "dataframes": {"orders": rows},
            "python_output": [],
            "python_images": [],
        },
    )

    await runtime.replay_checkpoint()

    assert [item["key"] for item in runtime.deps.knowledge_proposals] == [
        "revenue_refund_policy",
        "relationship:strict",
    ]


def test_relationship_acceptance_inverts_confirmed_cardinality_by_direction():
    definition = {
        "cardinality": "one_to_many",
        "minimum_left_match_rate": 0.8,
        "maximum_expansion_ratio": 2,
    }
    reverse_profile = {
        "cardinality": "many_to_one",
        "left_match_rate": 1,
        "right_match_rate": 1,
        "expansion_ratio": 1,
    }

    _enforce_relationship_acceptance(
        reverse_profile,
        definition=definition,
        reversed_direction=True,
    )

    with pytest.raises(ValueError, match="基数"):
        _enforce_relationship_acceptance(
            {**reverse_profile, "cardinality": "one_to_many"},
            definition=definition,
            reversed_direction=True,
        )


def test_unconfirmed_many_to_many_relationship_is_rejected():
    with pytest.raises(ValueError, match="多对多"):
        _enforce_relationship_acceptance(
            {
                "cardinality": "many_to_many",
                "left_match_rate": 1,
                "expansion_ratio": 1,
            },
            definition=None,
            reversed_direction=False,
        )
