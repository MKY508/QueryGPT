"""Focused contracts for fail-closed report-correction compilation."""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import AnalysisRun, ArtifactRecord, Project, ProjectDataSource, SemanticEntry
from app.services.checkpoint_contract import stable_payload_hash
from app.services.result_filters import resolve_confirmed_rule_strategy
from app.services.semantic_learning import (
    _relationship_schema_signature,
    compile_report_correction,
    discover_metric_column_correction_candidates,
)


def _profile(logical_name: str, columns: list[tuple[str, str]]) -> dict:
    return {
        "logical_name": logical_name,
        "is_current": True,
        "schema": {"columns": [{"name": name, "type": data_type} for name, data_type in columns]},
    }


def _source_ref(source: ProjectDataSource) -> dict[str, str]:
    return {
        "source_id": str(source.id),
        "source_logical_name": str((source.profile_data or {})["logical_name"]),
        "source_kind": source.kind,
    }


async def _seed_single_source_result(
    db: AsyncSession,
    *,
    columns: list[tuple[str, str]],
    rows: list[dict],
    truncated: bool = False,
    sampled: bool = False,
    include_validation: bool = True,
) -> tuple[ProjectDataSource, AnalysisRun]:
    project = Project(name="稳定语义编译")
    db.add(project)
    await db.flush()
    source = ProjectDataSource(
        project_id=project.id,
        kind="file",
        name="orders-july.xlsx",
        format="xlsx",
        status="ready",
        profile_data=_profile("orders", columns),
    )
    db.add(source)
    await db.flush()
    source_ref = _source_ref(source)
    tool_history = [
        {
            "kind": "structured_query",
            "source_id": str(source.id),
            "result_name": "final_orders",
            "source_refs": [source_ref],
        }
    ]
    if include_validation:
        tool_history.append(
            {
                "kind": "validation",
                "result_name": "final_orders",
                "result_hash": stable_payload_hash(rows),
                "profile": {
                    "materialized_rows": len(rows),
                    "truncated": truncated,
                    "source_refs": [source_ref],
                },
            }
        )
    run = AnalysisRun(
        project_id=project.id,
        query="核对收入",
        state="completed",
        stage="completed",
        report={"status": "completed"},
        checkpoint={"tool_history": tool_history},
    )
    db.add(run)
    await db.flush()
    db.add(
        ArtifactRecord(
            project_id=project.id,
            analysis_run_id=run.id,
            kind="table",
            title="最终结果",
            payload={"rows": rows, "rows_count": len(rows), "sampled": sampled},
            technical_details={"result_name": "final_orders"},
        )
    )
    await db.commit()
    return source, run


@pytest.mark.asyncio
async def test_metric_compiler_uses_stable_logical_binding_across_monthly_source_ids(
    db_session: AsyncSession,
):
    rows = [
        {"order_id": "o-1", "paid_amount": 18.5},
        {"order_id": "o-2", "paid_amount": 22.0},
    ]
    source, run = await _seed_single_source_result(
        db_session,
        columns=[("order_id", "VARCHAR"), ("paid_amount", "DOUBLE")],
        rows=rows,
    )

    compiled = await compile_report_correction(
        db_session,
        run=run,
        correction_id=uuid4(),
        target_key="revenue_metric",
        text="收入按 paid_amount 计算",
        correction_type="metric_definition",
    )

    assert compiled.validity == "active"
    assert compiled.execution_state == "needs_validation"
    assert compiled.definition is not None
    assert compiled.definition["action"] == {"kind": "metric_column", "column": "paid_amount"}
    binding = compiled.definition["applies_to"]
    assert binding == {
        "source_logical_name": "orders",
        "source_kind": "file",
        "table_or_view": "orders",
        "action_column": "paid_amount",
        "canonical_type": "number",
        "schema_signature": binding["schema_signature"],
    }
    assert len(binding["schema_signature"]) == 64
    assert "source_ids" not in compiled.definition
    assert str(source.id) not in str(compiled.definition)

    august_id = uuid4()
    current_catalog = [
        {
            "id": str(august_id),
            "kind": "file",
            "status": "ready",
            # FLOAT and DOUBLE share the same canonical numeric schema contract.
            "profile": _profile(
                "orders",
                [("order_id", "TEXT"), ("paid_amount", "FLOAT")],
            ),
        }
    ]
    resolved = resolve_confirmed_rule_strategy(
        {
            "key": "revenue_metric",
            "value": "收入按 paid_amount 计算",
            "definition": compiled.definition,
        },
        rows,
        source_refs=[
            {
                "source_id": str(august_id),
                "source_logical_name": "orders",
                "source_kind": "file",
            }
        ],
        source_catalog=current_catalog,
    )
    assert resolved == compiled.definition

    drifted_catalog = [
        {
            **current_catalog[0],
            "profile": _profile(
                "orders",
                [
                    ("order_id", "TEXT"),
                    ("paid_amount", "FLOAT"),
                    ("currency", "TEXT"),
                ],
            ),
        }
    ]
    with pytest.raises(ValueError, match="字段或结构已经变化"):
        resolve_confirmed_rule_strategy(
            {
                "key": "revenue_metric",
                "value": "收入按 paid_amount 计算",
                "definition": compiled.definition,
            },
            rows,
            source_refs=[
                {
                    "source_id": str(august_id),
                    "source_logical_name": "orders",
                    "source_kind": "file",
                }
            ],
            source_catalog=drifted_catalog,
        )


@pytest.mark.asyncio
async def test_structured_metric_selection_uses_the_rebuilt_stable_binding(
    db_session: AsyncSession,
):
    _, run = await _seed_single_source_result(
        db_session,
        columns=[
            ("order_id", "VARCHAR"),
            ("paid_amount", "DOUBLE"),
            ("list_price", "DOUBLE"),
        ],
        rows=[
            {"order_id": "o-1", "paid_amount": 18.5, "list_price": 20},
            {"order_id": "o-2", "paid_amount": 22, "list_price": 25},
        ],
    )
    candidates = await discover_metric_column_correction_candidates(db_session, run)
    paid_amount = next(item for item in candidates if item.column == "paid_amount")

    compiled = await compile_report_correction(
        db_session,
        run=run,
        correction_id=uuid4(),
        target_key="revenue_metric",
        # The human description deliberately does not name a schema column.
        text="收入按我选中的实际成交字段计算",
        correction_type="metric_definition",
        selected_metric_column=paid_amount.column,
        selected_metric_binding=paid_amount.binding,
    )

    assert compiled.execution_state == "needs_validation"
    assert compiled.definition is not None
    assert compiled.definition["action"] == {
        "kind": "metric_column",
        "column": "paid_amount",
    }
    assert compiled.definition["applies_to"] == paid_amount.binding

    stale_binding = {**paid_amount.binding, "schema_signature": "0" * 64}
    blocked = await compile_report_correction(
        db_session,
        run=run,
        correction_id=uuid4(),
        target_key="revenue_metric",
        text="收入按我选中的实际成交字段计算",
        correction_type="metric_definition",
        selected_metric_column=paid_amount.column,
        selected_metric_binding=stale_binding,
    )
    assert blocked.definition is None
    assert blocked.execution_state == "definition_only"
    assert blocked.execution_details["reason_code"] == "INVALID_METRIC_FIELD_SELECTION"


@pytest.mark.asyncio
async def test_relationship_compiler_binds_an_explicit_candidate_for_trial_only(
    db_session: AsyncSession,
):
    project = Project(name="关系修正编译")
    db_session.add(project)
    await db_session.flush()
    order_columns = [
        {"name": "order_id", "type": "TEXT"},
        {"name": "store_id", "type": "TEXT"},
        {"name": "paid_amount", "type": "DOUBLE"},
    ]
    store_columns = [
        {"name": "store_id", "type": "TEXT"},
        {"name": "store_name", "type": "TEXT"},
    ]
    orders = ProjectDataSource(
        project_id=project.id,
        kind="file",
        name="orders.csv",
        format="csv",
        status="ready",
        profile_data={
            "logical_name": "orders",
            "is_current": True,
            "schema": {"columns": order_columns},
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
            "is_current": True,
            "schema": {"columns": store_columns},
        },
    )
    db_session.add_all([orders, stores])
    await db_session.flush()
    relationship_key = "relationship:orders:stores"
    definition = {
        "version": 1,
        "left": {
            "source_logical_name": "orders",
            "source_kind": "file",
            "table_or_view": "orders",
            "column": "order_id",
            "data_type": "TEXT",
            "schema_signature": _relationship_schema_signature(order_columns),
        },
        "right": {
            "source_logical_name": "stores",
            "source_kind": "file",
            "table_or_view": "stores",
            "column": "store_name",
            "data_type": "TEXT",
            "schema_signature": _relationship_schema_signature(store_columns),
        },
        "normalization": "trim_casefold",
        "cardinality": "one_to_one",
        "default_join": "left",
        "minimum_left_match_rate": 0.8,
        "maximum_expansion_ratio": 1.2,
    }
    db_session.add(
        SemanticEntry(
            project_id=project.id,
            key=relationship_key,
            value="订单按 store_id 关联门店",
            entry_type="relationship",
            state="candidate",
            validity="unverified",
            definition=definition,
            source="inferred",
        )
    )
    refs = [_source_ref(orders), _source_ref(stores)]
    rows = [{"store_name": "一店", "sales": 100.0}]
    run = AnalysisRun(
        project_id=project.id,
        query="按门店核对销售",
        state="completed",
        stage="completed",
        report={"status": "completed"},
        checkpoint={
            "tool_history": [
                {
                    "kind": "structured_query",
                    "result_name": "orders",
                    "source_refs": [refs[0]],
                },
                {
                    "kind": "structured_query",
                    "result_name": "stores",
                    "source_refs": [refs[1]],
                },
                {
                    "kind": "join",
                    "left_result": "orders",
                    "right_result": "stores",
                    "result_name": "store_sales",
                    "source_refs": refs,
                },
                {
                    "kind": "validation",
                    "result_name": "store_sales",
                    "result_hash": stable_payload_hash(rows),
                    "profile": {
                        "materialized_rows": 1,
                        "truncated": False,
                        "source_refs": refs,
                    },
                },
            ]
        },
    )
    db_session.add(run)
    await db_session.flush()
    db_session.add(
        ArtifactRecord(
            project_id=project.id,
            analysis_run_id=run.id,
            kind="table",
            title="门店销售",
            payload={"rows": rows, "rows_count": 1, "sampled": False},
            technical_details={"result_name": "store_sales"},
        )
    )
    await db_session.commit()

    compiled = await compile_report_correction(
        db_session,
        run=run,
        correction_id=uuid4(),
        target_key=relationship_key,
        text="订单和门店必须按 store_id 关联",
        correction_type="relationship_rule",
    )

    assert compiled.definition is not None
    assert compiled.definition["left"]["column"] == "store_id"
    assert compiled.definition["right"]["column"] == "store_id"
    assert compiled.definition["normalization"] == "auto"
    assert compiled.definition["cardinality"] is None
    assert compiled.validity == "unverified"
    assert compiled.execution_state == "needs_validation"
    assert compiled.execution_details["status"] == "needs_validation"
    assert compiled.evidence["action_kind"] == "relationship"

    ambiguous = await compile_report_correction(
        db_session,
        run=run,
        correction_id=uuid4(),
        target_key=relationship_key,
        text="这次关联不对",
        correction_type="relationship_rule",
    )
    assert ambiguous.definition is None
    assert ambiguous.execution_state == "definition_only"
    assert ambiguous.execution_details["reason_code"] == ("AMBIGUOUS_RELATIONSHIP_CORRECTION")


@pytest.mark.asyncio
async def test_refund_compiler_emits_only_a_schema_bound_value_filter(
    db_session: AsyncSession,
):
    rows = [
        {"order_id": "o-1", "refund_status": "正常", "paid_amount": 20},
        {"order_id": "o-2", "refund_status": "已退款", "paid_amount": 30},
    ]
    _source, run = await _seed_single_source_result(
        db_session,
        columns=[
            ("order_id", "VARCHAR"),
            ("refund_status", "VARCHAR"),
            ("paid_amount", "DOUBLE"),
        ],
        rows=rows,
    )

    compiled = await compile_report_correction(
        db_session,
        run=run,
        correction_id=uuid4(),
        target_key="revenue_refund_policy",
        text="退款订单不计入收入",
        correction_type="filter_rule",
    )

    assert compiled.definition is not None
    assert compiled.definition["action"] == {
        "kind": "value_filter",
        "column": "refund_status",
        "operator": "exclude",
        "values": ["已退款"],
        "observed_values": ["已退款", "正常"],
    }
    assert compiled.definition["applies_to"]["action_column"] == "refund_status"
    assert compiled.definition["applies_to"]["canonical_type"] == "text"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("include_validation", "truncated", "sampled", "reason_code"),
    [
        (False, False, False, "NO_FINAL_VALIDATION"),
        (True, True, False, "TRUNCATED_FINAL_RESULT"),
        (True, False, True, "RETAINED_RESULT_NOT_COMPLETE"),
    ],
)
async def test_compiler_keeps_untrusted_results_definition_only(
    db_session: AsyncSession,
    include_validation: bool,
    truncated: bool,
    sampled: bool,
    reason_code: str,
):
    _source, run = await _seed_single_source_result(
        db_session,
        columns=[("paid_amount", "DOUBLE")],
        rows=[{"paid_amount": 10.0}],
        include_validation=include_validation,
        truncated=truncated,
        sampled=sampled,
    )

    compiled = await compile_report_correction(
        db_session,
        run=run,
        correction_id=uuid4(),
        target_key="revenue_metric",
        text="收入按 paid_amount 计算",
        correction_type="metric_definition",
    )

    assert compiled.definition is None
    assert compiled.validity == "unverified"
    assert compiled.execution_state == "definition_only"
    assert compiled.execution_details["reason_code"] == reason_code


@pytest.mark.asyncio
async def test_compiler_rejects_a_derived_only_action_column(db_session: AsyncSession):
    _source, run = await _seed_single_source_result(
        db_session,
        columns=[("gross_amount", "DOUBLE"), ("cost", "DOUBLE")],
        rows=[{"derived_margin": 12.0}],
    )

    compiled = await compile_report_correction(
        db_session,
        run=run,
        correction_id=uuid4(),
        target_key="margin_metric",
        text="利润按 derived_margin 计算",
        correction_type="metric_definition",
    )

    assert compiled.definition is None
    assert compiled.execution_details["reason_code"] == "DERIVED_OR_UNPROFILED_ACTION_COLUMN"


@pytest.mark.asyncio
async def test_compiler_rejects_an_action_column_with_ambiguous_source_origin(
    db_session: AsyncSession,
):
    project = Project(name="歧义来源")
    db_session.add(project)
    await db_session.flush()
    first = ProjectDataSource(
        project_id=project.id,
        kind="file",
        name="online.xlsx",
        format="xlsx",
        status="ready",
        profile_data=_profile("online_orders", [("paid_amount", "DOUBLE")]),
    )
    second = ProjectDataSource(
        project_id=project.id,
        kind="file",
        name="offline.xlsx",
        format="xlsx",
        status="ready",
        profile_data=_profile("offline_orders", [("paid_amount", "DOUBLE")]),
    )
    db_session.add_all([first, second])
    await db_session.flush()
    refs = [_source_ref(first), _source_ref(second)]
    rows = [{"paid_amount": 42.0}]
    run = AnalysisRun(
        project_id=project.id,
        query="核对收入",
        state="completed",
        stage="completed",
        report={"status": "completed"},
        checkpoint={
            "tool_history": [
                {
                    "kind": "structured_query",
                    "source_id": str(first.id),
                    "result_name": "online",
                },
                {
                    "kind": "structured_query",
                    "source_id": str(second.id),
                    "result_name": "offline",
                },
                {
                    "kind": "join",
                    "left_result": "online",
                    "right_result": "offline",
                    "result_name": "combined",
                    "source_refs": refs,
                },
                {
                    "kind": "validation",
                    "result_name": "combined",
                    "result_hash": stable_payload_hash(rows),
                    "profile": {
                        "materialized_rows": 1,
                        "truncated": False,
                        "source_refs": refs,
                    },
                },
            ]
        },
    )
    db_session.add(run)
    await db_session.flush()
    db_session.add(
        ArtifactRecord(
            project_id=project.id,
            analysis_run_id=run.id,
            kind="table",
            title="最终结果",
            payload={"rows": rows, "rows_count": 1, "sampled": False},
            technical_details={"result_name": "combined"},
        )
    )
    await db_session.commit()

    compiled = await compile_report_correction(
        db_session,
        run=run,
        correction_id=uuid4(),
        target_key="revenue_metric",
        text="收入按 paid_amount 计算",
        correction_type="metric_definition",
    )

    assert compiled.definition is None
    assert compiled.execution_details["reason_code"] == "AMBIGUOUS_ACTION_COLUMN_SOURCE"


def test_stable_binding_contract_rejects_the_old_physical_source_id_shape():
    rows = [{"paid_amount": 10.0}]
    with pytest.raises(ValueError, match="不是稳定的逻辑字段绑定"):
        resolve_confirmed_rule_strategy(
            {
                "key": "revenue_metric",
                "value": "收入按 paid_amount 计算",
                "definition": {
                    "version": 1,
                    "kind": "business_rule_strategy",
                    "rule_key": "revenue_metric",
                    "selected_option": "收入按 paid_amount 计算",
                    "action": {"kind": "metric_column", "column": "paid_amount"},
                    "applies_to": {"source_ids": [str(UUID(int=1))]},
                },
            },
            rows,
        )


@pytest.mark.asyncio
async def test_formula_compiler_binds_every_numeric_source_column(db_session: AsyncSession):
    rows = [
        {"order_id": "o-1", "gross_amount": "100.00", "refund_amount": "8.50"},
        {"order_id": "o-2", "gross_amount": "40", "refund_amount": "0"},
    ]
    _source, run = await _seed_single_source_result(
        db_session,
        columns=[
            ("order_id", "VARCHAR"),
            ("gross_amount", "DECIMAL(18,2)"),
            ("refund_amount", "DOUBLE"),
        ],
        rows=rows,
    )

    text = "net_amount = gross_amount - refund_amount"
    compiled = await compile_report_correction(
        db_session,
        run=run,
        correction_id=uuid4(),
        target_key="net_revenue",
        text=text,
        correction_type="metric_definition",
    )

    assert compiled.validity == "active"
    assert compiled.execution_state == "needs_validation"
    assert compiled.definition is not None
    assert compiled.definition["action"] == {
        "kind": "metric_formula",
        "output_column": "net_amount",
        "expression": {
            "op": "subtract",
            "left": {"op": "column", "name": "gross_amount"},
            "right": {"op": "column", "name": "refund_amount"},
        },
        "evaluation_order": "row_then_aggregate",
        "null_policy": "propagate",
        "divide_by_zero": "error",
    }
    bindings = compiled.definition["applies_to"]
    assert [binding["action_column"] for binding in bindings] == [
        "gross_amount",
        "refund_amount",
    ]
    assert {binding["canonical_type"] for binding in bindings} == {"number"}
    assert all(len(binding["schema_signature"]) == 64 for binding in bindings)

    catalog = [
        {
            "id": str(uuid4()),
            "kind": "file",
            "status": "ready",
            "profile": _profile(
                "orders",
                [
                    ("order_id", "TEXT"),
                    ("gross_amount", "NUMERIC"),
                    ("refund_amount", "FLOAT"),
                ],
            ),
        }
    ]
    assert (
        resolve_confirmed_rule_strategy(
            {
                "key": "net_revenue",
                "value": text,
                "definition": compiled.definition,
            },
            rows,
            source_refs=[
                {
                    "source_id": catalog[0]["id"],
                    "source_logical_name": "orders",
                    "source_kind": "file",
                }
            ],
            source_catalog=catalog,
        )
        == compiled.definition
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "text",
    [
        "净收入就是毛收入减退款",
        "net_amount = gross_amount - unknown_amount",
        "net_amount = gross_amount - category",
        "gross_amount = gross_amount - refund_amount",
    ],
)
async def test_formula_compiler_keeps_ambiguous_or_unsafe_formula_definition_only(
    db_session: AsyncSession,
    text: str,
):
    _source, run = await _seed_single_source_result(
        db_session,
        columns=[
            ("gross_amount", "DOUBLE"),
            ("refund_amount", "DOUBLE"),
            ("category", "VARCHAR"),
        ],
        rows=[
            {"gross_amount": 100, "refund_amount": 8, "category": "office_supplies"},
        ],
    )

    compiled = await compile_report_correction(
        db_session,
        run=run,
        correction_id=uuid4(),
        target_key="net_revenue",
        text=text,
        correction_type="metric_definition",
    )

    assert compiled.definition is None
    assert compiled.execution_state == "definition_only"
    assert compiled.execution_details["reason_code"] == "NO_UNIQUE_TYPED_ACTION"
