"""Opaque report-correction target contracts."""

from __future__ import annotations

import json
from uuid import UUID

import pytest
from httpx import AsyncClient

from app.db.tables import (
    AnalysisCorrection,
    AnalysisRun,
    ArtifactRecord,
    ProjectDataSource,
    SemanticEntry,
)
from app.services.checkpoint_contract import stable_payload_hash
from app.services.execution import ExecutionService
from app.services.semantic_revisions import append_semantic_revision


async def _project_and_run(client: AsyncClient, *, name: str = "修正目标测试") -> tuple[dict, dict]:
    project_response = await client.post("/api/v1/projects", json={"name": name})
    assert project_response.status_code == 200, project_response.text
    project = project_response.json()["data"]
    run_response = await client.post(
        f"/api/v1/projects/{project['id']}/analysis-runs",
        json={"query": "核对经营结果"},
    )
    assert run_response.status_code == 200, run_response.text
    return project, run_response.json()["data"]


async def _new_run(client: AsyncClient, project_id: str) -> dict:
    response = await client.post(
        f"/api/v1/projects/{project_id}/analysis-runs",
        json={"query": "再次核对经营结果"},
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def _set_run_evidence(
    db_session,
    run_id: str,
    *,
    tool_history: list[dict] | None = None,
    confirmation_receipt: dict | None = None,
    state: str = "completed",
    report_status: str = "completed",
) -> AnalysisRun:
    run = await db_session.get(AnalysisRun, UUID(run_id))
    assert run is not None
    checkpoint: dict = {"tool_history": tool_history or []}
    if confirmation_receipt is not None:
        checkpoint["confirmation_receipt"] = confirmation_receipt
    run.state = state
    run.stage = state
    run.report = {
        "status": report_status,
        "title": "经营结果核对",
        "summary": "系统已完成核对。",
        "metrics": [],
        "findings": [],
    }
    run.checkpoint = checkpoint
    await db_session.commit()
    return run


async def _create_knowledge(
    client: AsyncClient,
    project_id: str,
    *,
    key: str,
    value: str,
    entry_type: str = "business_rule",
    state: str = "confirmed",
) -> dict:
    response = await client.post(
        f"/api/v1/projects/{project_id}/knowledge",
        json={
            "key": key,
            "value": value,
            "entry_type": entry_type,
            "state": state,
            "confidence": 1,
            "source": "user",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _rule_application(
    key: str,
    value: str,
    *,
    action_kind: str = "value_filter",
    semantic_entry_id: str | None = None,
    active_revision_id: str | None = None,
    definition_hash: str | None = None,
) -> dict:
    return {
        "kind": "business_rule_application",
        "rule_key": key,
        "rule_value": value,
        "action_kind": action_kind,
        "semantic_entry_id": semantic_entry_id,
        "active_revision_id": active_revision_id,
        "definition_hash": definition_hash,
        "column": "refund_status" if action_kind == "value_filter" else "paid_amount",
    }


async def _targets(client: AsyncClient, project_id: str, run_id: str) -> list[dict]:
    response = await client.get(
        f"/api/v1/projects/{project_id}/analysis-runs/{run_id}/correction-targets"
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def _seed_metric_target_with_retained_result(
    client: AsyncClient,
    db_session,
) -> tuple[dict, AnalysisRun, ProjectDataSource, dict]:
    project, run_payload = await _project_and_run(client, name="指标字段选项")
    run = await db_session.get(AnalysisRun, UUID(run_payload["id"]))
    assert run is not None
    source = ProjectDataSource(
        project_id=UUID(project["id"]),
        kind="file",
        name="orders-july.xlsx",
        format="xlsx",
        status="ready",
        profile_data={
            "logical_name": "订单明细",
            "is_current": True,
            "schema": {
                "columns": [
                    {"name": "order_id", "type": "VARCHAR"},
                    {"name": "paid_amount", "type": "DOUBLE"},
                    {"name": "list_price", "type": "DOUBLE"},
                ]
            },
        },
    )
    db_session.add(source)
    await db_session.flush()
    rows = [
        {"order_id": "o-1", "paid_amount": 18.5, "list_price": 20},
        {"order_id": "o-2", "paid_amount": 22, "list_price": 25},
    ]
    source_ref = {
        "source_id": str(source.id),
        "source_logical_name": "订单明细",
        "source_kind": "file",
    }
    run.state = "completed"
    run.stage = "completed"
    run.report = {
        "status": "completed",
        "title": "收入核对",
        "summary": "已完成收入核对。",
        "metrics": [],
        "findings": [],
    }
    run.checkpoint = {
        "tool_history": [
            {
                "kind": "structured_query",
                "source_id": str(source.id),
                "result_name": "final_orders",
                "source_refs": [source_ref],
            },
            _rule_application(
                "revenue_metric",
                "当前收入口径",
                action_kind="metric_column",
            ),
            {
                "kind": "validation",
                "result_name": "final_orders",
                "result_hash": stable_payload_hash(rows),
                "profile": {
                    "materialized_rows": len(rows),
                    "truncated": False,
                    "source_refs": [source_ref],
                },
            },
        ]
    }
    db_session.add(
        ArtifactRecord(
            project_id=UUID(project["id"]),
            analysis_run_id=run.id,
            kind="table",
            title="最终结果",
            payload={"rows": rows, "rows_count": len(rows), "sampled": False},
            technical_details={"result_name": "final_orders"},
        )
    )
    await db_session.commit()
    targets = await _targets(client, project["id"], str(run.id))
    target = next(item for item in targets if item["correction_type"] == "metric_definition")
    return project, run, source, target


@pytest.mark.asyncio
async def test_target_ref_is_stable_opaque_run_bound_and_tamper_evident(
    client: AsyncClient,
    db_session,
):
    project, first_run = await _project_and_run(client)
    second_run = await _new_run(client, project["id"])
    history = [_rule_application("revenue_refund_policy", "退款订单不计入收入")]
    await _set_run_evidence(db_session, first_run["id"], tool_history=history)
    await _set_run_evidence(db_session, second_run["id"], tool_history=history)

    first_targets = await _targets(client, project["id"], first_run["id"])
    repeated_targets = await _targets(client, project["id"], first_run["id"])
    assert first_targets == repeated_targets
    assert len(first_targets) == 1
    target = first_targets[0]
    assert set(target) == {"target_ref", "label", "description", "correction_type"}
    assert target["target_ref"].startswith("crt1_")
    assert "revenue_refund_policy" not in target["target_ref"]

    cross_run = await client.post(
        f"/api/v1/projects/{project['id']}/corrections",
        json={
            "analysis_run_id": second_run["id"],
            "target_ref": target["target_ref"],
            "text": "退款需要从本次结果中扣除。",
            "scope": "run",
        },
    )
    assert cross_run.status_code == 409, cross_run.text

    tampered_ref = target["target_ref"][:-1] + ("0" if target["target_ref"][-1] != "0" else "1")
    tampered = await client.post(
        f"/api/v1/projects/{project['id']}/corrections",
        json={
            "analysis_run_id": first_run["id"],
            "target_ref": tampered_ref,
            "text": "退款需要从本次结果中扣除。",
            "scope": "run",
        },
    )
    assert tampered.status_code == 409, tampered.text

    created = await client.post(
        f"/api/v1/projects/{project['id']}/corrections",
        json={
            "analysis_run_id": first_run["id"],
            "target_ref": target["target_ref"],
            "target_key": "tampered-browser-key",
            "correction_type": "relationship_rule",
            "text": "退款需要从本次结果中扣除。",
            "scope": "run",
        },
    )
    assert created.status_code == 200, created.text
    correction = created.json()["data"]
    assert correction["target_ref"] == target["target_ref"]
    assert correction["target_key"] is None
    assert correction["correction_type"] == "filter_rule"
    assert correction["evidence"] == []
    assert "revenue_refund_policy" not in json.dumps(correction, ensure_ascii=False)


@pytest.mark.asyncio
async def test_metric_target_options_are_opaque_run_bound_and_fail_closed(
    client: AsyncClient,
    db_session,
):
    project, run, source, target = await _seed_metric_target_with_retained_result(
        client,
        db_session,
    )
    endpoint = (
        f"/api/v1/projects/{project['id']}/analysis-runs/{run.id}"
        f"/correction-targets/{target['target_ref']}/options"
    )
    first = await client.get(endpoint)
    repeated = await client.get(endpoint)
    assert first.status_code == 200, first.text
    assert repeated.status_code == 200, repeated.text
    assert first.json()["data"] == repeated.json()["data"]
    options = first.json()["data"]
    assert len(options) == 2
    assert all(set(option) == {"kind", "field_ref", "label", "description"} for option in options)
    assert all(option["kind"] == "metric_column" for option in options)
    assert all(option["field_ref"].startswith("mcf1_") for option in options)
    public_payload = json.dumps(options, ensure_ascii=False)
    assert "paid_amount" not in public_payload
    assert "list_price" not in public_payload
    assert "schema_signature" not in public_payload
    assert "revenue_metric" not in public_payload

    tampered_ref = options[0]["field_ref"][:-1] + (
        "0" if options[0]["field_ref"][-1] != "0" else "1"
    )
    rejected = await client.post(
        f"/api/v1/projects/{project['id']}/corrections",
        json={
            "analysis_run_id": str(run.id),
            "target_ref": target["target_ref"],
            "selection": {"kind": "metric_column", "field_ref": tampered_ref},
            "text": "收入按我选择的字段计算",
            "scope": "project",
        },
    )
    assert rejected.status_code == 409, rejected.text

    # A schema change rebuilds the option identities; an old ref cannot be
    # replayed against a different current source contract.
    source.profile_data = {
        **source.profile_data,
        "schema": {
            "columns": [
                *(source.profile_data["schema"]["columns"]),
                {"name": "currency", "type": "VARCHAR"},
            ]
        },
    }
    await db_session.commit()
    drifted = await client.get(endpoint)
    assert drifted.status_code == 200, drifted.text
    assert {option["field_ref"] for option in drifted.json()["data"]}.isdisjoint(
        {option["field_ref"] for option in options}
    )
    stale = await client.post(
        f"/api/v1/projects/{project['id']}/corrections",
        json={
            "analysis_run_id": str(run.id),
            "target_ref": target["target_ref"],
            "selection": {
                "kind": "metric_column",
                "field_ref": options[0]["field_ref"],
            },
            "text": "收入按之前选择的字段计算",
            "scope": "project",
        },
    )
    assert stale.status_code == 409, stale.text


@pytest.mark.asyncio
async def test_incomplete_run_cannot_mint_or_accept_a_target_ref(client: AsyncClient, db_session):
    project, completed_run = await _project_and_run(client)
    incomplete_run = await _new_run(client, project["id"])
    history = [_rule_application("revenue_refund_policy", "退款订单不计入收入")]
    await _set_run_evidence(db_session, completed_run["id"], tool_history=history)
    valid_ref = (await _targets(client, project["id"], completed_run["id"]))[0]["target_ref"]
    await _set_run_evidence(
        db_session,
        incomplete_run["id"],
        tool_history=history,
        state="needs_attention",
    )

    assert await _targets(client, project["id"], incomplete_run["id"]) == []
    rejected = await client.post(
        f"/api/v1/projects/{project['id']}/corrections",
        json={
            "analysis_run_id": incomplete_run["id"],
            "target_ref": valid_ref,
            "text": "不要保存失败调查中的口径。",
            "scope": "project",
        },
    )
    assert rejected.status_code == 409, rejected.text


@pytest.mark.asyncio
async def test_explicit_null_target_does_not_infer_or_promote(client: AsyncClient, db_session):
    project, run = await _project_and_run(client)
    await _set_run_evidence(
        db_session,
        run["id"],
        tool_history=[_rule_application("revenue_refund_policy", "退款订单不计入收入")],
    )

    response = await client.post(
        f"/api/v1/projects/{project['id']}/corrections",
        json={
            "analysis_run_id": run["id"],
            "target_ref": None,
            "target_key": "revenue_refund_policy",
            "text": "这只是对整份报告结论的补充。",
            "scope": "project",
        },
    )
    assert response.status_code == 200, response.text
    correction = response.json()["data"]
    assert correction["state"] == "recorded"
    assert correction["semantic_entry_id"] is None
    assert correction["target_key"] is None
    knowledge = await client.get(f"/api/v1/projects/{project['id']}/knowledge")
    assert knowledge.json()["data"] == []


@pytest.mark.asyncio
async def test_same_target_edits_same_entry_but_stale_head_cannot_overwrite(
    client: AsyncClient,
    db_session,
):
    project, run = await _project_and_run(client)
    original = await _create_knowledge(
        client,
        project["id"],
        key="returns_policy",
        value="退货不冲减本期收入",
    )
    await _set_run_evidence(
        db_session,
        run["id"],
        tool_history=[
            _rule_application(
                "returns_policy",
                original["value"],
                semantic_entry_id=original["id"],
                active_revision_id=original["active_revision_id"],
                definition_hash=stable_payload_hash(None),
            )
        ],
    )
    target_ref = (await _targets(client, project["id"], run["id"]))[0]["target_ref"]

    created = await client.post(
        f"/api/v1/projects/{project['id']}/corrections",
        json={
            "analysis_run_id": run["id"],
            "target_ref": target_ref,
            "text": "退货应冲减本期收入",
            "scope": "project",
        },
    )
    assert created.status_code == 200, created.text
    correction = created.json()["data"]
    assert correction["semantic_entry_id"] == original["id"]

    edited = await client.put(
        f"/api/v1/projects/{project['id']}/corrections/{correction['id']}",
        json={
            "analysis_run_id": run["id"],
            "target_ref": target_ref,
            "text": "退货在完成退款时冲减本期收入",
            "scope": "project",
        },
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["data"]["semantic_entry_id"] == original["id"]

    entry = await db_session.get(SemanticEntry, UUID(original["id"]))
    assert entry is not None
    externally_updated = await client.put(
        f"/api/v1/projects/{project['id']}/knowledge/{original['id']}",
        json={
            "expected_active_revision_id": str(entry.active_revision_id),
            "value": "管理员已改为按完成退款日冲减收入",
            "source": "user",
        },
    )
    assert externally_updated.status_code == 200, externally_updated.text

    stale_edit = await client.put(
        f"/api/v1/projects/{project['id']}/corrections/{correction['id']}",
        json={
            "analysis_run_id": run["id"],
            "target_ref": target_ref,
            "text": "旧报告不能覆盖管理员的新版本",
            "scope": "project",
        },
    )
    assert stale_edit.status_code == 409, stale_edit.text
    current = await db_session.get(SemanticEntry, UUID(original["id"]))
    assert current is not None
    assert current.value == "管理员已改为按完成退款日冲减收入"


@pytest.mark.asyncio
async def test_fresh_discovery_drops_old_business_evidence_after_external_edit(
    client: AsyncClient,
    db_session,
):
    project, run = await _project_and_run(client)
    original = await _create_knowledge(
        client,
        project["id"],
        key="returns_policy",
        value="退货不冲减本期收入",
    )
    await _set_run_evidence(
        db_session,
        run["id"],
        tool_history=[
            _rule_application(
                "returns_policy",
                original["value"],
                semantic_entry_id=original["id"],
                active_revision_id=original["active_revision_id"],
                definition_hash=stable_payload_hash(None),
            )
        ],
    )
    stale_ref = (await _targets(client, project["id"], run["id"]))[0]["target_ref"]
    entry = await db_session.get(SemanticEntry, UUID(original["id"]))
    assert entry is not None
    updated = await client.put(
        f"/api/v1/projects/{project['id']}/knowledge/{original['id']}",
        json={
            "expected_active_revision_id": str(entry.active_revision_id),
            "value": "管理员已调整退货口径",
            "source": "user",
        },
    )
    assert updated.status_code == 200, updated.text
    assert await _targets(client, project["id"], run["id"]) == []
    stale_create = await client.post(
        f"/api/v1/projects/{project['id']}/corrections",
        json={
            "analysis_run_id": run["id"],
            "target_ref": stale_ref,
            "text": "旧报告不能覆盖新口径",
            "scope": "project",
        },
    )
    assert stale_create.status_code == 409, stale_create.text


@pytest.mark.asyncio
async def test_old_business_evidence_cannot_bind_same_value_new_revision(
    client: AsyncClient,
    db_session,
):
    project, run = await _project_and_run(client)
    original = await _create_knowledge(
        client,
        project["id"],
        key="returns_policy",
        value="退货不冲减本期收入",
    )
    await _set_run_evidence(
        db_session,
        run["id"],
        tool_history=[
            _rule_application(
                "returns_policy",
                original["value"],
                semantic_entry_id=original["id"],
                active_revision_id=original["active_revision_id"],
                definition_hash=stable_payload_hash(None),
            )
        ],
    )
    assert len(await _targets(client, project["id"], run["id"])) == 1

    updated = await client.put(
        f"/api/v1/projects/{project['id']}/knowledge/{original['id']}",
        json={
            "expected_active_revision_id": original["active_revision_id"],
            "value": original["value"],
            "source": "user",
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["data"]["active_revision_id"] != original["active_revision_id"]
    assert await _targets(client, project["id"], run["id"]) == []


@pytest.mark.asyncio
async def test_confirmation_receipt_requires_current_semantic_identity(
    client: AsyncClient,
    db_session,
):
    project, run = await _project_and_run(client)
    entry = await _create_knowledge(
        client,
        project["id"],
        key="revenue_refund_policy",
        value="退款订单不计入收入",
    )
    receipt = {
        "key": "revenue_refund_policy",
        "value": entry["value"],
        "selected_value": entry["value"],
        "semantic_entry_id": entry["id"],
        "active_revision_id": entry["active_revision_id"],
        "definition_hash": stable_payload_hash(None),
        "value_hash": stable_payload_hash(entry["value"]),
        "applied": True,
        "conflict": False,
    }
    await _set_run_evidence(db_session, run["id"], confirmation_receipt=receipt)
    assert len(await _targets(client, project["id"], run["id"])) == 1

    identityless = dict(receipt)
    for field in (
        "semantic_entry_id",
        "active_revision_id",
        "definition_hash",
        "value_hash",
    ):
        identityless.pop(field)
    await _set_run_evidence(db_session, run["id"], confirmation_receipt=identityless)
    assert await _targets(client, project["id"], run["id"]) == []

    await _set_run_evidence(db_session, run["id"], confirmation_receipt=receipt)
    current = await db_session.get(SemanticEntry, UUID(entry["id"]))
    assert current is not None
    updated = await client.put(
        f"/api/v1/projects/{project['id']}/knowledge/{entry['id']}",
        json={
            "expected_active_revision_id": str(current.active_revision_id),
            "value": "管理员已调整退款口径",
            "source": "user",
        },
    )
    assert updated.status_code == 200, updated.text
    assert await _targets(client, project["id"], run["id"]) == []


@pytest.mark.asyncio
async def test_neighboring_same_label_targets_do_not_merge(client: AsyncClient, db_session):
    project, run = await _project_and_run(client)
    revenue = await _create_knowledge(
        client,
        project["id"],
        key="metric:revenue",
        value="按已结算金额计算",
        entry_type="metric",
    )
    margin = await _create_knowledge(
        client,
        project["id"],
        key="metric:margin",
        value="按已结算金额计算",
        entry_type="metric",
    )
    await _set_run_evidence(
        db_session,
        run["id"],
        tool_history=[
            _rule_application(
                "metric:revenue",
                revenue["value"],
                action_kind="metric_column",
                semantic_entry_id=revenue["id"],
                active_revision_id=revenue["active_revision_id"],
                definition_hash=stable_payload_hash(None),
            ),
            _rule_application(
                "metric:margin",
                margin["value"],
                action_kind="metric_column",
                semantic_entry_id=margin["id"],
                active_revision_id=margin["active_revision_id"],
                definition_hash=stable_payload_hash(None),
            ),
        ],
    )
    targets = await _targets(client, project["id"], run["id"])
    assert len(targets) == 2
    assert {item["label"] for item in targets} == {"按已结算金额计算"}
    assert len({item["target_ref"] for item in targets}) == 2

    semantic_ids = []
    for index, target in enumerate(targets, start=1):
        response = await client.post(
            f"/api/v1/projects/{project['id']}/corrections",
            json={
                "analysis_run_id": run["id"],
                "target_ref": target["target_ref"],
                "text": f"第 {index} 个指标使用独立口径",
                "scope": "project",
            },
        )
        assert response.status_code == 200, response.text
        semantic_ids.append(response.json()["data"]["semantic_entry_id"])
    assert set(semantic_ids) == {revenue["id"], margin["id"]}


@pytest.mark.asyncio
async def test_locked_target_still_rejects_opaque_correction(client: AsyncClient, db_session):
    project, run = await _project_and_run(client)
    locked = await _create_knowledge(
        client,
        project["id"],
        key="returns_policy",
        value="按签收日确认退货",
        state="locked",
    )
    await _set_run_evidence(
        db_session,
        run["id"],
        tool_history=[
            _rule_application(
                "returns_policy",
                locked["value"],
                semantic_entry_id=locked["id"],
                active_revision_id=locked["active_revision_id"],
                definition_hash=stable_payload_hash(None),
            )
        ],
    )
    target_ref = (await _targets(client, project["id"], run["id"]))[0]["target_ref"]

    response = await client.post(
        f"/api/v1/projects/{project['id']}/corrections",
        json={
            "analysis_run_id": run["id"],
            "target_ref": target_ref,
            "text": "尝试修改固定口径",
            "scope": "project",
        },
    )
    assert response.status_code == 409, response.text
    entry = await db_session.get(SemanticEntry, UUID(locked["id"]))
    assert entry is not None
    assert entry.value == locked["value"]
    assert entry.state == "locked"


@pytest.mark.asyncio
async def test_aliases_collapse_to_one_canonical_target(client: AsyncClient, db_session):
    project, run = await _project_and_run(client)
    await _set_run_evidence(
        db_session,
        run["id"],
        tool_history=[
            _rule_application("refund_handling", "退款订单不计入收入"),
            _rule_application("revenue_refund_policy", "退款订单不计入收入"),
        ],
    )
    targets = await _targets(client, project["id"], run["id"])
    assert len(targets) == 1

    response = await client.post(
        f"/api/v1/projects/{project['id']}/corrections",
        json={
            "analysis_run_id": run["id"],
            "target_ref": targets[0]["target_ref"],
            "text": "退款订单应从收入中扣除",
            "scope": "run",
        },
    )
    assert response.status_code == 200, response.text
    correction = await db_session.get(
        AnalysisCorrection,
        UUID(response.json()["data"]["id"]),
    )
    assert correction is not None
    assert correction.target_key == "revenue_refund_policy"

    db_session.add_all(
        [
            SemanticEntry(
                project_id=UUID(project["id"]),
                key="refund_handling",
                value="退款计入收入",
                entry_type="business_rule",
                state="candidate",
                confidence=0.5,
                validity="active",
                evidence=[],
                source="inferred",
            ),
            SemanticEntry(
                project_id=UUID(project["id"]),
                key="revenue_refund_policy",
                value="退款不计入收入",
                entry_type="business_rule",
                state="candidate",
                confidence=0.5,
                validity="active",
                evidence=[],
                source="inferred",
            ),
        ]
    )
    await db_session.commit()
    assert await _targets(client, project["id"], run["id"]) == []


def _reusable_relationship_evidence(
    key: str,
    definition_hash: str,
    *,
    semantic_entry_id: str | None = None,
    active_revision_id: str | None = None,
) -> dict:
    return {
        "kind": "relationship_validation",
        "relationship_key": key,
        "semantic_entry_id": semantic_entry_id,
        "active_revision_id": active_revision_id,
        "definition_hash": definition_hash,
        "left_result": "orders",
        "right_result": "stores",
        "source_refs": [
            {
                "source_id": "orders-source",
                "source_logical_name": "orders",
                "table_or_view": "orders",
                "query_scope": "full",
            },
            {
                "source_id": "stores-source",
                "source_logical_name": "stores",
                "table_or_view": "stores",
                "query_scope": "full",
            },
        ],
        "profile": {"truncated": False},
        "evidence_origin": "system",
        "evidence_scope": "full_relation",
        "completeness": "complete",
        "reusable_proof_eligible": True,
    }


@pytest.mark.asyncio
async def test_relationship_target_requires_reusable_proof_and_current_definition(
    client: AsyncClient,
    db_session,
):
    project, run = await _project_and_run(client)
    relationship_key = "relationship:orders:stores"
    definition = {"version": 1, "left": {"column": "store_id"}, "right": {"column": "id"}}
    entry = SemanticEntry(
        project_id=UUID(project["id"]),
        key=relationship_key,
        value="订单按门店编号关联门店",
        entry_type="relationship",
        state="confirmed",
        confidence=1,
        definition=definition,
        validity="active",
        evidence=[],
        source="verified_analysis",
    )
    db_session.add(entry)
    await db_session.flush()
    await append_semantic_revision(
        db_session,
        entry,
        mutation_kind="created",
        actor_source="verified_analysis",
        reason="建立测试关系口径",
    )
    definition_hash = stable_payload_hash(definition)
    unsafe = {
        "kind": "relationship_validation",
        "relationship_key": relationship_key,
        "definition_hash": definition_hash,
        "profile": {"truncated": False},
    }
    await _set_run_evidence(db_session, run["id"], tool_history=[unsafe])
    assert await _targets(client, project["id"], run["id"]) == []

    await _set_run_evidence(
        db_session,
        run["id"],
        tool_history=[
            _reusable_relationship_evidence(
                relationship_key,
                definition_hash,
                semantic_entry_id=str(entry.id),
                active_revision_id=str(entry.active_revision_id),
            )
        ],
    )
    assert len(await _targets(client, project["id"], run["id"])) == 1

    previous_revision_id = entry.active_revision_id
    entry.value = "订单按新的门店归属规则关联"
    await append_semantic_revision(
        db_session,
        entry,
        mutation_kind="user_update",
        actor_source="user",
        reason="只调整关系口径的说明",
        expected_active_revision_id=previous_revision_id,
    )
    await db_session.commit()
    assert entry.active_revision_id != previous_revision_id
    assert await _targets(client, project["id"], run["id"]) == []

    entry.definition = {
        "version": 1,
        "left": {"column": "store_code"},
        "right": {"column": "code"},
    }
    await db_session.commit()
    assert await _targets(client, project["id"], run["id"]) == []

    entry.definition = definition
    entry.is_active = False
    await db_session.commit()
    assert await _targets(client, project["id"], run["id"]) == []


@pytest.mark.asyncio
async def test_completed_full_relationship_observation_keeps_its_report_target(
    client: AsyncClient,
    db_session,
):
    project, run_payload = await _project_and_run(client)
    run = await db_session.get(AnalysisRun, UUID(run_payload["id"]))
    assert run is not None
    relationship_key = "relationship:orders:stores"
    definition = {
        "version": 1,
        "left": {"column": "store_id"},
        "right": {"column": "id"},
    }
    entry = SemanticEntry(
        project_id=UUID(project["id"]),
        key=relationship_key,
        value="订单按门店编号关联门店",
        entry_type="relationship",
        state="confirmed",
        confidence=1,
        definition=definition,
        validity="active",
        evidence=[],
        source="verified_analysis",
    )
    db_session.add(entry)
    await db_session.flush()
    await append_semantic_revision(
        db_session,
        entry,
        mutation_kind="created",
        actor_source="verified_analysis",
        reason="建立待复核关系",
    )
    initial_revision_id = str(entry.active_revision_id)
    definition_hash = stable_payload_hash(definition)
    relationship_evidence = _reusable_relationship_evidence(
        relationship_key,
        definition_hash,
        semantic_entry_id=str(entry.id),
        active_revision_id=initial_revision_id,
    )
    await db_session.commit()

    outcome = await ExecutionService(
        db_session,
        project_id=UUID(project["id"]),
    )._stage_project_result(
        run,
        {
            "analysis_state": "completed",
            "report": {
                "status": "completed",
                "title": "门店关联核对",
                "summary": "完整数据已通过关系核对。",
                "metrics": [],
                "findings": [],
            },
            "data": [{"store_id": "S-1", "id": "S-1"}],
            "rows_count": 1,
            "result_name": "orders_with_stores",
            "tool_history": [relationship_evidence],
            "knowledge_proposals": [
                {
                    "key": relationship_key,
                    "value": entry.value,
                    "entry_type": "relationship",
                    "state": "candidate",
                    "confidence": 1,
                    "definition": definition,
                    "validity": "active",
                    "evidence": [relationship_evidence],
                    "source": "verified_analysis",
                }
            ],
            "confirmed_corrections": [],
        },
    )

    assert outcome.accepted is True
    await db_session.refresh(entry)
    await db_session.refresh(run)
    assert str(entry.active_revision_id) != initial_revision_id
    assert run.checkpoint["semantic_revision_transitions"][0]["transition"] == (
        "relationship_observation_verified"
    )
    targets = await _targets(client, project["id"], run_payload["id"])
    assert len(targets) == 1
