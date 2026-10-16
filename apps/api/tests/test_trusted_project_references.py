"""Explicit, project-scoped historical analysis reference tests."""

from __future__ import annotations

from contextlib import nullcontext
from copy import deepcopy
from uuid import UUID

import pytest
from httpx import AsyncClient
from pydantic_ai.models.test import TestModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import AnalysisRun, Project, ProjectDataSource
from app.models.analysis import AnalysisReport
from app.services import analyst_runtime
from app.services.analyst.report_validation import _trusted_reference_revalidation_failure
from app.services.analyst_runtime import PydanticAnalystRuntime
from app.services.checkpoint_contract import stable_payload_hash
from app.services.project_context import load_project_context
from tests.model_fixtures import synthetic_model_config


async def _seed_validated_reference_run(
    db: AsyncSession,
) -> tuple[Project, AnalysisRun]:
    project = Project(name="可信项目依据")
    db.add(project)
    await db.flush()
    source = ProjectDataSource(
        project_id=project.id,
        kind="file",
        name="orders-july.xlsx",
        format="xlsx",
        fingerprint="f" * 64,
        status="ready",
        profile_data={
            "logical_name": "orders",
            "schema": {
                "columns": [
                    {"name": "order_id", "type": "VARCHAR"},
                    {"name": "refund_status", "type": "VARCHAR"},
                    {"name": "net_revenue", "type": "DOUBLE"},
                ]
            },
        },
    )
    db.add(source)
    await db.flush()
    source_ref = {
        "source_id": str(source.id),
        "source_logical_name": "orders",
        "source_kind": "file",
    }
    run = AnalysisRun(
        project_id=project.id,
        query="七月线上订单表现如何？",
        state="completed",
        stage="completed",
        report={
            "status": "completed",
            "title": "七月线上订单复盘",
            "summary": "七月完成 126 笔有效订单。",
            "findings": ["拿铁订单占比最高。"],
            "metrics": [{"label": "有效订单", "value": "126", "context": "七月"}],
        },
        checkpoint={
            "tool_history": [
                {
                    "kind": "file_sql",
                    "purpose": "读取七月订单",
                    "sql": "SELECT * FROM orders",
                    "result_name": "orders_raw",
                    "source_refs": [source_ref],
                },
                {
                    "kind": "business_rule_application",
                    "purpose": "扣除退款订单",
                    "rule_key": "revenue_refund_policy",
                    "source_result": "orders_raw",
                    "column": "refund_status",
                    "operator": "exclude",
                    "values": ["refunded"],
                    "result_name": "orders_final",
                },
                {
                    "kind": "validation",
                    "purpose": "核对七月最终结果",
                    "result_name": "orders_final",
                    "profile": {
                        "materialized_rows": 126,
                        "columns": ["order_id", "net_revenue"],
                        "keys": {"order_id": {"missing": 0, "unique": 126}},
                        "numeric": {"net_revenue": {"count": 126, "sum": 8800}},
                        "truncated": False,
                        "source_refs": [source_ref],
                    },
                },
            ]
        },
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    return project, run


@pytest.mark.asyncio
async def test_capture_trusted_reference_is_typed_and_idempotent(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project, run = await _seed_validated_reference_run(db_session)
    url = f"/api/v1/projects/{project.id}/trusted-references"

    first = await client.post(url, json={"analysis_run_id": str(run.id)})
    assert first.status_code == 200, first.text
    reference = first.json()["data"]
    assert reference["id"].startswith("ref_")
    assert reference["run_id"] == str(run.id)
    assert reference["query"] == run.query
    assert reference["title"] == "七月线上订单复盘"
    assert reference["report"] == {
        "summary": "七月完成 126 笔有效订单。",
        "metrics": [
            {
                "label": "有效订单",
                "value": "126",
                "context": "七月",
                "historical": True,
            }
        ],
        "conclusions": ["拿铁订单占比最高。"],
        "historical": True,
    }
    assert reference["historical"] is True
    assert reference["usage_policy"] == "historical_hypothesis_only"
    assert reference["state"] == "active"
    assert reference["confirmed_knowledge_keys"] == ["revenue_refund_policy"]
    assert reference["source_roles"][0]["logical_name"] == "orders"
    assert reference["source_roles"][0]["fingerprint"] == "f" * 64
    assert reference["validation_evidence"][-1]["kind"] == "validation"
    assert reference["created_at"] and reference["updated_at"]

    repeated = await client.post(url, json={"analysis_run_id": str(run.id)})
    assert repeated.status_code == 200
    assert repeated.json()["data"] == reference
    listed = await client.get(url)
    assert listed.status_code == 200
    assert listed.json()["data"] == [reference]


@pytest.mark.asyncio
async def test_capture_rejects_completed_run_without_final_validation(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project, run = await _seed_validated_reference_run(db_session)
    run.checkpoint = {
        **run.checkpoint,
        "tool_history": [
            item for item in run.checkpoint["tool_history"] if item.get("kind") != "validation"
        ],
    }
    await db_session.commit()

    response = await client.post(
        f"/api/v1/projects/{project.id}/trusted-references",
        json={"analysis_run_id": str(run.id)},
    )
    assert response.status_code == 422
    assert "校验" in response.json()["detail"]


@pytest.mark.asyncio
async def test_active_trusted_references_have_a_bounded_project_limit(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project, first_run = await _seed_validated_reference_run(db_session)
    runs = [first_run]
    for index in range(20):
        run = AnalysisRun(
            project_id=project.id,
            query=f"第 {index + 2} 次已验证调查",
            state="completed",
            stage="completed",
            report=deepcopy(first_run.report),
            checkpoint=deepcopy(first_run.checkpoint),
        )
        db_session.add(run)
        runs.append(run)
    await db_session.commit()

    url = f"/api/v1/projects/{project.id}/trusted-references"
    for run in runs[:20]:
        response = await client.post(url, json={"analysis_run_id": str(run.id)})
        assert response.status_code == 200, response.text
    overflow = await client.post(url, json={"analysis_run_id": str(runs[20].id)})
    assert overflow.status_code == 409
    assert "最多保留 20 条" in overflow.json()["detail"]
    context = await load_project_context(db_session, project.id)
    assert len(context.active_trusted_references) == 5


@pytest.mark.asyncio
async def test_trusted_references_are_project_isolated_and_revocation_removes_runtime_context(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project, run = await _seed_validated_reference_run(db_session)
    other = Project(name="其他项目")
    db_session.add(other)
    await db_session.commit()
    await db_session.refresh(other)

    wrong_capture = await client.post(
        f"/api/v1/projects/{other.id}/trusted-references",
        json={"analysis_run_id": str(run.id)},
    )
    assert wrong_capture.status_code == 404
    captured = await client.post(
        f"/api/v1/projects/{project.id}/trusted-references",
        json={"analysis_run_id": str(run.id)},
    )
    reference_id = captured.json()["data"]["id"]
    before = await load_project_context(db_session, project.id)
    assert [item["id"] for item in before.active_trusted_references] == [reference_id]

    wrong_revoke = await client.post(
        f"/api/v1/projects/{other.id}/trusted-references/{reference_id}/revoke"
    )
    assert wrong_revoke.status_code == 404
    revoked = await client.post(
        f"/api/v1/projects/{project.id}/trusted-references/{reference_id}/revoke"
    )
    assert revoked.status_code == 200
    assert revoked.json()["data"]["state"] == "revoked"
    after = await load_project_context(db_session, project.id)
    assert after.active_trusted_references == []
    assert after.public_summary()["active_trusted_references"] == []


@pytest.mark.asyncio
async def test_historical_numbers_require_a_fresh_query_and_final_validation(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    project, run = await _seed_validated_reference_run(db_session)
    captured = await client.post(
        f"/api/v1/projects/{project.id}/trusted-references",
        json={"analysis_run_id": str(run.id)},
    )
    assert captured.status_code == 200
    context = await load_project_context(db_session, project.id)
    public_reference = context.public_summary()["active_trusted_references"][0]
    assert public_reference["report"]["metrics"][0]["value"] == "126"
    assert public_reference["historical"] is True
    assert public_reference["requires_current_revalidation"] is True

    monkeypatch.setattr(
        analyst_runtime, "model_session", lambda _config, **_kwargs: nullcontext(TestModel())
    )
    runtime = PydanticAnalystRuntime(model_config=synthetic_model_config(), project_context=context)
    report = AnalysisReport(
        status="completed",
        title="本期订单",
        summary="本期仍有 126 笔订单。",
        findings=["拿铁仍然最高。"],
    )
    try:
        instructions = runtime._instructions()
        failure = _trusted_reference_revalidation_failure(
            runtime.deps,
            report,
            latest_result=None,
        )
        assert failure is not None
        assert "historical" in failure
        assert "重新查询" in failure
        assert "active_trusted_references" in instructions
        assert "绝不能直接当作当前答案" in instructions

        current_rows = [{"order_count": 126}]
        runtime.deps.dataframes = {"current_orders": current_rows}
        runtime.deps.tool_history = [
            {"kind": "file_sql", "result_name": "current_orders"},
            {
                "kind": "validation",
                "result_name": "current_orders",
                "result_hash": stable_payload_hash(current_rows),
                "profile": {},
            },
        ]
        runtime.deps.validated_results = {"current_orders"}
        assert (
            _trusted_reference_revalidation_failure(
                runtime.deps,
                report,
                latest_result="current_orders",
            )
            is None
        )
    finally:
        runtime.deps.python_sandbox.cleanup()


@pytest.mark.asyncio
async def test_project_bundle_roundtrips_active_and_revoked_trusted_references(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project, first_run = await _seed_validated_reference_run(db_session)
    second_run = AnalysisRun(
        project_id=project.id,
        query="八月线上订单表现如何？",
        state="completed",
        stage="completed",
        report=deepcopy(first_run.report),
        checkpoint=deepcopy(first_run.checkpoint),
    )
    db_session.add(second_run)
    await db_session.commit()
    await db_session.refresh(second_run)

    url = f"/api/v1/projects/{project.id}/trusted-references"
    first = await client.post(url, json={"analysis_run_id": str(first_run.id)})
    second = await client.post(url, json={"analysis_run_id": str(second_run.id)})
    assert first.status_code == second.status_code == 200
    revoked = await client.post(f"{url}/{first.json()['data']['id']}/revoke")
    assert revoked.status_code == 200

    exported = await client.get(f"/api/v1/projects/{project.id}/export")
    assert exported.status_code == 200
    bundle = exported.json()["data"]
    assert {item["state"] for item in bundle["trusted_references"]} == {
        "active",
        "revoked",
    }

    imported = await client.post("/api/v1/projects/import", json=bundle)
    assert imported.status_code == 200, imported.text
    imported_id = imported.json()["data"]["id"]
    listed = await client.get(f"/api/v1/projects/{imported_id}/trusted-references")
    assert listed.status_code == 200
    assert listed.json()["data"] == bundle["trusted_references"]

    context = await load_project_context(db_session, UUID(imported_id))
    assert len(context.active_trusted_references) == 1
    assert context.active_trusted_references[0]["state"] == "active"
