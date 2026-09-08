"""Persistent report-correction contract tests."""

from uuid import UUID

import pytest
from httpx import AsyncClient

from app.db.tables import (
    AnalysisCorrection,
    AnalysisRun,
    ArtifactRecord,
    Conversation,
    Project,
    ProjectDataSource,
    SemanticEntry,
)
from app.services.checkpoint_contract import stable_payload_hash
from app.services.execution import ExecutionService
from app.services.project_context import load_project_context
from app.services.semantic_revisions import append_semantic_revision


async def _project_and_run(client: AsyncClient) -> tuple[dict, dict]:
    project_response = await client.post(
        "/api/v1/projects",
        json={"name": "纠正闭环测试"},
    )
    assert project_response.status_code == 200, project_response.text
    project = project_response.json()["data"]

    run_response = await client.post(
        f"/api/v1/projects/{project['id']}/analysis-runs",
        json={"query": "检查本月收入"},
    )
    assert run_response.status_code == 200, run_response.text
    return project, run_response.json()["data"]


async def _seed_structured_metric_correction(
    client: AsyncClient,
    db_session,
) -> tuple[dict, AnalysisRun, dict]:
    project, run_payload = await _project_and_run(client)
    run = await db_session.get(AnalysisRun, UUID(run_payload["id"]))
    assert run is not None
    source = ProjectDataSource(
        project_id=UUID(project["id"]),
        kind="file",
        name="orders.xlsx",
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
            {
                "kind": "business_rule_application",
                "rule_key": "revenue_metric",
                "rule_value": "当前收入口径",
                "action_kind": "metric_column",
                "column": "paid_amount",
            },
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
    target_response = await client.get(
        f"/api/v1/projects/{project['id']}/analysis-runs/{run.id}/correction-targets"
    )
    assert target_response.status_code == 200, target_response.text
    target = next(
        item
        for item in target_response.json()["data"]
        if item["correction_type"] == "metric_definition"
    )
    return project, run, target


@pytest.mark.asyncio
async def test_structured_metric_selection_persists_public_ref_and_stays_unverified(
    client: AsyncClient,
    db_session,
):
    project, run, target = await _seed_structured_metric_correction(client, db_session)
    options_url = (
        f"/api/v1/projects/{project['id']}/analysis-runs/{run.id}"
        f"/correction-targets/{target['target_ref']}/options"
    )
    options_response = await client.get(options_url)
    assert options_response.status_code == 200, options_response.text
    options = options_response.json()["data"]
    paid_amount = next(option for option in options if option["label"].startswith("paid amount"))

    created = await client.post(
        f"/api/v1/projects/{project['id']}/corrections",
        json={
            "analysis_run_id": str(run.id),
            "target_ref": target["target_ref"],
            "selection": {
                "kind": "metric_column",
                "field_ref": paid_amount["field_ref"],
            },
            "text": "收入按我选择的实际成交字段计算",
            "scope": "project",
        },
    )
    assert created.status_code == 200, created.text
    public = created.json()["data"]
    assert public["selection"] == {
        "kind": "metric_column",
        "field_ref": paid_amount["field_ref"],
    }
    assert public["target_key"] is None
    assert public["evidence"] == []
    assert "paid_amount" not in str(public)

    correction = await db_session.get(AnalysisCorrection, UUID(public["id"]))
    assert correction is not None
    entry = await db_session.get(SemanticEntry, correction.semantic_entry_id)
    assert entry is not None
    assert entry.definition["action"] == {
        "kind": "metric_column",
        "column": "paid_amount",
    }
    assert entry.definition["applies_to"]["source_logical_name"] == "订单明细"
    assert entry.execution_state == "needs_validation"
    assert entry.execution_details["status"] == "needs_validation"

    contract = await ExecutionService(
        db_session,
        project_id=UUID(project["id"]),
    )._required_correction_contract(correction)
    assert contract["executable"] is True
    assert contract["execution_state"] == "needs_validation"
    assert entry.execution_state != "verified"

    listed = await client.get(f"/api/v1/projects/{project['id']}/corrections")
    listed_item = next(item for item in listed.json()["data"] if item["id"] == public["id"])
    assert listed_item["selection"] == public["selection"]

    text_only_update = await client.put(
        f"/api/v1/projects/{project['id']}/corrections/{public['id']}",
        json={
            "analysis_run_id": str(run.id),
            "target_ref": target["target_ref"],
            "text": "收入仍按我选择的实际成交字段计算",
            "scope": "project",
        },
    )
    assert text_only_update.status_code == 200, text_only_update.text
    assert text_only_update.json()["data"]["selection"] == public["selection"]

    # Creating the project definition makes the original report target leave
    # the general target list.  The owned correction can still rebuild safe
    # options and be edited without exposing the internal field identity.
    restored_options = await client.get(options_url)
    assert restored_options.status_code == 200, restored_options.text
    list_price = next(
        option
        for option in restored_options.json()["data"]
        if option["label"].startswith("list price")
    )
    updated = await client.put(
        f"/api/v1/projects/{project['id']}/corrections/{public['id']}",
        json={
            "analysis_run_id": str(run.id),
            "target_ref": target["target_ref"],
            "selection": {
                "kind": "metric_column",
                "field_ref": list_price["field_ref"],
            },
            "text": "收入按我选择的标价字段计算",
            "scope": "project",
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["data"]["selection"]["field_ref"] == list_price["field_ref"]
    await db_session.refresh(entry)
    assert entry.definition["action"] == {
        "kind": "metric_column",
        "column": "list_price",
    }
    assert entry.execution_state == "needs_validation"


@pytest.mark.asyncio
async def test_required_relationship_correction_can_trial_only_its_user_candidate(
    client: AsyncClient,
    db_session,
):
    project, source_run_payload = await _project_and_run(client)
    source_run = await db_session.get(AnalysisRun, UUID(source_run_payload["id"]))
    assert source_run is not None
    relationship_key = "relationship:orders:stores"
    entry = SemanticEntry(
        project_id=UUID(project["id"]),
        key=relationship_key,
        value="订单按 store_id 关联门店",
        entry_type="relationship",
        state="candidate",
        confidence=1,
        definition={"version": 1, "left": {}, "right": {}},
        validity="unverified",
        execution_state="needs_validation",
        source="user",
    )
    db_session.add(entry)
    await db_session.flush()
    correction = AnalysisCorrection(
        project_id=UUID(project["id"]),
        analysis_run_id=source_run.id,
        semantic_entry_id=entry.id,
        target_key=relationship_key,
        correction_type="relationship_rule",
        text="订单和门店应按 store_id 关联",
        scope="project",
        state="promoted",
        fingerprint="f" * 64,
    )
    db_session.add(correction)
    await db_session.flush()
    await append_semantic_revision(
        db_session,
        entry,
        mutation_kind="correction_promoted",
        actor_source="user",
        source_correction_id=correction.id,
    )
    await db_session.commit()

    service = ExecutionService(db_session, project_id=UUID(project["id"]))
    contract = await service._required_correction_contract(correction)

    assert contract["executable"] is True
    assert contract["entry_type"] == "relationship"
    assert contract["correction_type"] == "relationship_rule"
    assert contract["execution_state"] == "needs_validation"
    assert contract["expected_active_revision_id"] == str(entry.active_revision_id)

    entry.source = "inferred"
    await db_session.commit()
    contract = await service._required_correction_contract(correction)
    assert contract["executable"] is False

    entry.source = "user"
    await db_session.commit()
    rerun = AnalysisRun(
        project_id=UUID(project["id"]),
        query="按修正关系重新核对",
        state="investigating",
        stage="investigating",
        checkpoint={
            "correction_context": {
                "correction_id": str(correction.id),
                "source_run_id": str(source_run.id),
                "target_key": relationship_key,
            }
        },
    )
    db_session.add(rerun)
    await db_session.flush()
    definition_hash = stable_payload_hash(entry.definition)
    joined_rows = [{"store": "一店", "sales": 100}]
    input_hashes = {"orders": "a" * 64, "stores": "b" * 64}
    relationship_profile = {
        "left_key": "store_id",
        "right_key": "store_id",
        "left_match_rate": 1,
        "right_match_rate": 1,
        "cardinality": "many_to_one",
        "expansion_ratio": 1,
        "truncated": False,
    }
    relationship_identity = {
        "relationship_key": relationship_key,
        "candidate_relationship_key": relationship_key,
        "definition_hash": definition_hash,
        "left_result": "orders",
        "right_result": "stores",
        "input_hashes": input_hashes,
        "profile": relationship_profile,
        "evidence_origin": "system",
        "evidence_scope": "full_relation",
        "completeness": "complete",
        "reusable_proof_eligible": True,
        "source_refs": [
            {
                "source_id": "orders-source",
                "table_or_view": "orders",
                "query_scope": "full",
            },
            {
                "source_id": "stores-source",
                "table_or_view": "stores",
                "query_scope": "full",
            },
        ],
    }
    outcome = await service._persist_project_result(
        rerun,
        {
            "analysis_state": "completed",
            "report": {
                "status": "completed",
                "title": "门店销售复核",
                "summary": "已按修正后的关系复核。",
                "metrics": [],
                "findings": [],
            },
            "data": joined_rows,
            "rows_count": 1,
            "result_name": "joined_orders",
            "tool_history": [
                {
                    "kind": "structured_query",
                    "result_name": "orders",
                    "source_refs": [relationship_identity["source_refs"][0]],
                },
                {
                    "kind": "structured_query",
                    "result_name": "stores",
                    "source_refs": [relationship_identity["source_refs"][1]],
                },
                {"kind": "relationship_validation", **relationship_identity},
                {
                    "kind": "join",
                    **relationship_identity,
                    "result_name": "joined_orders",
                    "result_hash": stable_payload_hash(joined_rows),
                },
                {
                    "kind": "validation",
                    "result_name": "joined_orders",
                    "result_hash": stable_payload_hash(joined_rows),
                    "profile": {"materialized_rows": 1, "truncated": False},
                },
            ],
            "knowledge_proposals": [],
            "confirmed_corrections": [],
        },
    )

    assert outcome.accepted is True
    await db_session.refresh(entry)
    assert entry.state == "confirmed"
    assert entry.validity == "active"
    assert entry.execution_state == "verified"
    assert entry.active_revision_id is not None
    assert entry.execution_details["checks"] == [
        "current_relationship_definition_tested",
        "relationship_validation_passed",
        "full_relation_reusable_proof",
        "join_reaches_final_result",
        "final_result_revalidated_after_join",
    ]


@pytest.mark.asyncio
async def test_run_scoped_correction_persists_without_becoming_project_knowledge(
    client: AsyncClient,
):
    project, run = await _project_and_run(client)
    response = await client.post(
        f"/api/v1/projects/{project['id']}/corrections",
        json={
            "analysis_run_id": run["id"],
            "text": "折扣属于促销，不应直接解释为亏损。",
            "scope": "run",
            "report_title": "本月收入检查",
        },
    )
    assert response.status_code == 200, response.text
    correction = response.json()["data"]
    assert correction["state"] == "recorded"
    assert correction["scope"] == "run"
    assert correction["semantic_entry_id"] is None

    listed = await client.get(
        f"/api/v1/projects/{project['id']}/corrections",
        params={"analysis_run_id": run["id"]},
    )
    assert listed.status_code == 200, listed.text
    assert [item["id"] for item in listed.json()["data"]] == [correction["id"]]

    knowledge = await client.get(f"/api/v1/projects/{project['id']}/knowledge")
    assert knowledge.status_code == 200, knowledge.text
    assert knowledge.json()["data"] == []


@pytest.mark.asyncio
async def test_relationship_correction_reuses_only_one_relationship_key_from_the_report(
    client: AsyncClient,
    db_session,
):
    project, run = await _project_and_run(client)
    run_record = await db_session.get(AnalysisRun, UUID(run["id"]))
    assert run_record is not None
    run_record.checkpoint = {
        "confirmation_receipt": {
            "key": "revenue_refund_policy",
            "applied": True,
            "conflict": False,
        },
        "tool_history": [
            {
                "kind": "relationship_validation",
                "relationship_key": None,
                "candidate_relationship_key": "relationship_candidate:store_id:abc",
            },
            {
                "kind": "join",
                "relationship_key": None,
                "candidate_relationship_key": "relationship_candidate:store_id:abc",
                "result_name": "orders_with_stores",
            },
        ],
    }
    await db_session.commit()

    response = await client.post(
        f"/api/v1/projects/{project['id']}/corrections",
        json={
            "analysis_run_id": run["id"],
            "text": "订单和门店应通过 store_id 关联，不要使用门店名称。",
            "correction_type": "relationship_rule",
            "scope": "run",
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["data"]["target_key"] == ("relationship_candidate:store_id:abc")


@pytest.mark.asyncio
async def test_relationship_correction_stays_unbound_when_the_report_used_multiple_relations(
    client: AsyncClient,
    db_session,
):
    project, run = await _project_and_run(client)
    run_record = await db_session.get(AnalysisRun, UUID(run["id"]))
    assert run_record is not None
    run_record.checkpoint = {
        "confirmation_receipt": {
            "key": "unrelated_business_question",
            "applied": True,
            "conflict": False,
        },
        "tool_history": [
            {
                "kind": "join",
                "candidate_relationship_key": "relationship_candidate:store_id:one",
            },
            {
                "kind": "join",
                "candidate_relationship_key": "relationship_candidate:product_id:two",
            },
        ],
    }
    await db_session.commit()

    response = await client.post(
        f"/api/v1/projects/{project['id']}/corrections",
        json={
            "analysis_run_id": run["id"],
            "text": "这里的关联不对。",
            "correction_type": "relationship_rule",
            "scope": "project",
        },
    )

    assert response.status_code == 200, response.text
    correction = response.json()["data"]
    assert correction["target_key"] is None
    assert correction["semantic_entry_id"] is None
    assert correction["state"] == "recorded"


@pytest.mark.asyncio
async def test_project_correction_is_stable_reused_and_reversible(client: AsyncClient, db_session):
    project, run = await _project_and_run(client)
    payload = {
        "analysis_run_id": run["id"],
        "target_key": "metric:revenue",
        "text": "收入按实付金额计算，退款订单不计入收入。",
        "correction_type": "metric_definition",
        "scope": "project",
        "report_title": "收入核对",
    }
    first = await client.post(
        f"/api/v1/projects/{project['id']}/corrections",
        json=payload,
    )
    assert first.status_code == 200, first.text
    correction = first.json()["data"]
    assert correction["state"] == "promoted"
    assert correction["semantic_entry_id"]

    duplicate = await client.post(
        f"/api/v1/projects/{project['id']}/corrections",
        json=payload,
    )
    assert duplicate.status_code == 200, duplicate.text
    assert duplicate.json()["data"]["id"] == correction["id"]

    project_id = UUID(project["id"])
    context = await load_project_context(db_session, project_id)
    learned = [item for item in context.confirmed_knowledge if item["key"] == "metric:revenue"]
    assert len(learned) == 1
    assert learned[0]["value"] == payload["text"]

    removed = await client.delete(
        f"/api/v1/projects/{project['id']}/corrections/{correction['id']}"
    )
    assert removed.status_code == 200, removed.text
    assert removed.json()["data"] == {
        "deleted": True,
        "correction_id": correction["id"],
        "project_rule_removed": True,
    }

    context_after = await load_project_context(db_session, project_id)
    assert not any(item["key"] == "metric:revenue" for item in context_after.confirmed_knowledge)


@pytest.mark.asyncio
async def test_project_correction_can_be_reviewed_edited_and_demoted(
    client: AsyncClient,
    db_session,
):
    project, run = await _project_and_run(client)
    created = await client.post(
        f"/api/v1/projects/{project['id']}/corrections",
        json={
            "analysis_run_id": run["id"],
            "target_key": "metric:revenue",
            "text": "收入先按订单标价计算。",
            "correction_type": "metric_definition",
            "scope": "project",
        },
    )
    assert created.status_code == 200, created.text
    correction = created.json()["data"]

    updated = await client.put(
        f"/api/v1/projects/{project['id']}/corrections/{correction['id']}",
        json={
            "analysis_run_id": run["id"],
            "target_key": "metric:revenue",
            "text": "收入按实付金额计算。",
            "correction_type": "metric_definition",
            "scope": "project",
        },
    )
    assert updated.status_code == 200, updated.text
    learned = updated.json()["data"]
    assert learned["id"] == correction["id"]
    assert learned["text"] == "收入按实付金额计算。"
    assert learned["state"] == "promoted"

    context = await load_project_context(db_session, UUID(project["id"]))
    user_rules = [item for item in context.confirmed_knowledge if item["key"] == "metric:revenue"]
    assert [item["value"] for item in user_rules] == ["收入按实付金额计算。"]

    demoted = await client.put(
        f"/api/v1/projects/{project['id']}/corrections/{correction['id']}",
        json={
            "analysis_run_id": run["id"],
            "target_key": "metric:revenue",
            "text": "这次只按实付金额复核。",
            "correction_type": "metric_definition",
            "scope": "run",
        },
    )
    assert demoted.status_code == 200, demoted.text
    assert demoted.json()["data"]["state"] == "recorded"
    assert demoted.json()["data"]["semantic_entry_id"] is None

    context_after = await load_project_context(db_session, UUID(project["id"]))
    assert not any(item["key"] == "metric:revenue" for item in context_after.confirmed_knowledge)


@pytest.mark.asyncio
async def test_project_correction_without_canonical_key_does_not_invent_reusable_rule(
    client: AsyncClient,
):
    project, run = await _project_and_run(client)
    response = await client.post(
        f"/api/v1/projects/{project['id']}/corrections",
        json={
            "analysis_run_id": run["id"],
            "text": "这个结论过度解释了折扣。",
            "correction_type": "interpretation",
            "scope": "project",
        },
    )

    assert response.status_code == 200, response.text
    correction = response.json()["data"]
    assert correction["state"] == "recorded"
    assert correction["semantic_entry_id"] is None
    knowledge = await client.get(f"/api/v1/projects/{project['id']}/knowledge")
    assert knowledge.json()["data"] == []


@pytest.mark.asyncio
async def test_project_correction_never_overwrites_a_locked_definition(client: AsyncClient):
    project, run = await _project_and_run(client)
    locked = await client.post(
        f"/api/v1/projects/{project['id']}/knowledge",
        json={
            "key": "metric:revenue",
            "value": "收入按开票金额计算",
            "entry_type": "metric",
            "state": "locked",
            "confidence": 1,
            "source": "user",
        },
    )
    assert locked.status_code == 200, locked.text

    response = await client.post(
        f"/api/v1/projects/{project['id']}/corrections",
        json={
            "analysis_run_id": run["id"],
            "target_key": "metric:revenue",
            "text": "收入按实付金额计算",
            "correction_type": "metric_definition",
            "scope": "project",
        },
    )

    assert response.status_code == 409, response.text
    knowledge = await client.get(f"/api/v1/projects/{project['id']}/knowledge")
    entry = next(item for item in knowledge.json()["data"] if item["key"] == "metric:revenue")
    assert entry["value"] == "收入按开票金额计算"
    assert entry["state"] == "locked"


@pytest.mark.asyncio
async def test_removing_project_correction_restores_previous_definition(client: AsyncClient):
    project, run = await _project_and_run(client)
    original = await client.post(
        f"/api/v1/projects/{project['id']}/knowledge",
        json={
            "key": "metric:revenue",
            "value": "收入按开票金额计算",
            "entry_type": "metric",
            "state": "confirmed",
            "confidence": 1,
            "source": "user",
        },
    )
    assert original.status_code == 200, original.text
    response = await client.post(
        f"/api/v1/projects/{project['id']}/corrections",
        json={
            "analysis_run_id": run["id"],
            "target_key": "metric:revenue",
            "text": "收入按实付金额计算",
            "correction_type": "metric_definition",
            "scope": "project",
        },
    )
    assert response.status_code == 200, response.text
    correction = response.json()["data"]

    removed = await client.delete(
        f"/api/v1/projects/{project['id']}/corrections/{correction['id']}"
    )
    assert removed.status_code == 200, removed.text
    knowledge = await client.get(f"/api/v1/projects/{project['id']}/knowledge")
    entry = next(item for item in knowledge.json()["data"] if item["key"] == "metric:revenue")
    assert entry["value"] == "收入按开票金额计算"
    assert entry["state"] == "confirmed"


@pytest.mark.asyncio
async def test_report_correction_reuses_the_run_canonical_business_key(
    client: AsyncClient,
    db_session,
):
    project, run = await _project_and_run(client)
    run_record = await db_session.get(AnalysisRun, UUID(run["id"]))
    assert run_record is not None
    run_record.checkpoint = {
        "confirmation_receipt": {
            "key": "revenue_refund_policy",
            "selected_option": "扣除退款",
            "applied": True,
            "conflict": False,
        }
    }
    await db_session.commit()

    response = await client.post(
        f"/api/v1/projects/{project['id']}/corrections",
        json={
            "analysis_run_id": run["id"],
            "text": "退款订单不计入收入。",
            "correction_type": "filter_rule",
            "scope": "project",
        },
    )
    assert response.status_code == 200, response.text
    correction = response.json()["data"]
    assert correction["target_key"] == "revenue_refund_policy"

    context = await load_project_context(db_session, UUID(project["id"]))
    learned = [
        item for item in context.confirmed_knowledge if item["key"] == "revenue_refund_policy"
    ]
    assert [item["value"] for item in learned] == ["退款订单不计入收入。"]

    knowledge = await client.get(f"/api/v1/projects/{project['id']}/knowledge")
    entry = next(
        item for item in knowledge.json()["data"] if item["key"] == "revenue_refund_policy"
    )
    stopped = await client.put(
        f"/api/v1/projects/{project['id']}/knowledge/{entry['id']}",
        json={"validity": "stale", "source": "user"},
    )
    assert stopped.status_code == 200, stopped.text

    inactive_context = await load_project_context(db_session, UUID(project["id"]))
    assert not any(
        item["key"] == "revenue_refund_policy" for item in inactive_context.confirmed_knowledge
    )


@pytest.mark.asyncio
async def test_correction_rerun_links_the_new_run_to_its_source(
    client: AsyncClient,
    db_session,
):
    project, source_run = await _project_and_run(client)
    created = await client.post(
        f"/api/v1/projects/{project['id']}/corrections",
        json={
            "analysis_run_id": source_run["id"],
            "target_key": "revenue_refund_policy",
            "text": "退款订单不计入收入。",
            "correction_type": "filter_rule",
            "scope": "run",
        },
    )
    assert created.status_code == 200, created.text
    correction = created.json()["data"]

    conversation = Conversation(title="按修正重新调查")
    db_session.add(conversation)
    await db_session.commit()
    await db_session.refresh(conversation)

    service = ExecutionService(db_session, project_id=UUID(project["id"]))
    rerun, rerun_query, _, _ = await service._prepare_analysis_run(
        query="重新核对收入",
        conversation_id=conversation.id,
        resume_run_id=None,
        correction_id=UUID(correction["id"]),
    )

    assert rerun is not None
    assert rerun_query == "重新核对收入"
    assert rerun.checkpoint["correction_context"] == {
        "correction_id": correction["id"],
        "source_run_id": source_run["id"],
        "target_key": "revenue_refund_policy",
    }


@pytest.mark.asyncio
async def test_verified_correction_receipt_promotes_execution_state_atomically(
    client: AsyncClient,
    db_session,
):
    project, source_run = await _project_and_run(client)
    created = await client.post(
        f"/api/v1/projects/{project['id']}/corrections",
        json={
            "analysis_run_id": source_run["id"],
            "target_key": "revenue_refund_policy",
            "text": "退款订单不计入收入。",
            "correction_type": "filter_rule",
            "scope": "project",
        },
    )
    assert created.status_code == 200, created.text
    correction = created.json()["data"]
    entry = await db_session.get(SemanticEntry, UUID(correction["semantic_entry_id"]))
    assert entry is not None
    entry.definition = {
        "version": 1,
        "kind": "business_rule_strategy",
        "rule_key": "revenue_refund_policy",
        "selected_option": "退款订单不计入收入。",
        "action": {
            "kind": "value_filter",
            "column": "refund_status",
            "operator": "exclude",
            "values": ["refunded"],
            "observed_values": ["paid", "refunded"],
        },
    }
    entry.validity = "active"
    entry.execution_state = "needs_validation"
    await append_semantic_revision(
        db_session,
        entry,
        mutation_kind="definition_completed",
        actor_source="user",
        reason="补全可执行筛选定义",
        expected_active_revision_id=entry.active_revision_id,
    )
    await db_session.commit()

    conversation = Conversation(title="按项目修正复核")
    db_session.add(conversation)
    await db_session.commit()
    await db_session.refresh(conversation)
    service = ExecutionService(db_session, project_id=UUID(project["id"]))
    rerun, _, _, _ = await service._prepare_analysis_run(
        query="重新核对收入",
        conversation_id=conversation.id,
        resume_run_id=None,
        correction_id=UUID(correction["id"]),
    )
    assert rerun is not None
    definition_hash = stable_payload_hash(entry.definition)
    rows = [{"revenue": 100}]
    result = await service._persist_project_result(
        rerun,
        {
            "analysis_state": "completed",
            "report": {
                "status": "completed",
                "title": "收入复核",
                "summary": "退款已排除。",
                "metrics": [],
                "findings": [],
            },
            "data": rows,
            "rows_count": 1,
            "result_name": "orders_without_refunds",
            "tool_history": [
                {
                    "kind": "business_rule_application",
                    "semantic_entry_id": str(entry.id),
                    "active_revision_id": str(entry.active_revision_id),
                    "definition_hash": definition_hash,
                    "rule_key": "revenue_refund_policy",
                    "rule_value": "退款订单不计入收入。",
                    "action_kind": "value_filter",
                    "column": "refund_status",
                    "operator": "exclude",
                    "values": ["refunded"],
                    "source_result": "orders",
                    "result_name": "orders_without_refunds",
                    "before_rows": 2,
                    "after_rows": 1,
                    "excluded_rows": 1,
                    "input_hash": "a" * 64,
                    "output_hash": stable_payload_hash(rows),
                    "source_refs": [],
                },
                {
                    "kind": "validation",
                    "result_name": "orders_without_refunds",
                    "result_hash": stable_payload_hash(rows),
                    "profile": {"materialized_rows": 1, "truncated": False},
                },
            ],
            "knowledge_proposals": [],
            "confirmed_corrections": [],
        },
    )

    assert result.accepted is True
    await db_session.refresh(entry)
    assert entry.execution_state == "verified"
    assert entry.execution_details["definition_hash"] == definition_hash
    assert entry.execution_details["last_verified_run_id"] == str(rerun.id)
    targets = await client.get(
        f"/api/v1/projects/{project['id']}/analysis-runs/{rerun.id}/correction-targets"
    )
    assert targets.status_code == 200, targets.text
    assert len(targets.json()["data"]) == 1
    project_record = await db_session.get(Project, UUID(project["id"]))
    assert project_record is not None
    golden = list((project_record.extra_data or {}).get("golden_scenarios") or [])
    assert len(golden) == 1
    assert golden[0]["required_rule_applications"][0]["definition_hash"] == definition_hash

    failed_run, _, _, _ = await service._prepare_analysis_run(
        query="再次核对但遗漏规则",
        conversation_id=conversation.id,
        resume_run_id=None,
        correction_id=UUID(correction["id"]),
    )
    assert failed_run is not None
    rejected = await service._persist_project_result(
        failed_run,
        {
            "analysis_state": "completed",
            "report": {
                "status": "completed",
                "title": "错误复核",
                "summary": "模型声称完成，但没有应用修正。",
                "metrics": [],
                "findings": [],
            },
            "data": rows,
            "rows_count": 1,
            "result_name": "unrelated_result",
            "tool_history": [
                {
                    "kind": "validation",
                    "result_name": "unrelated_result",
                    "result_hash": stable_payload_hash(rows),
                }
            ],
            "knowledge_proposals": [],
            "confirmed_corrections": [],
        },
    )
    assert rejected.accepted is False
    assert rejected.error_code == "CORRECTION_RESULT_REJECTED"
    assert rejected.correction_application["status"] == "failed"
    assert rejected.correction_application["summary_code"] == "correction_failed"
    await db_session.refresh(failed_run)
    assert failed_run.state == "needs_attention"
