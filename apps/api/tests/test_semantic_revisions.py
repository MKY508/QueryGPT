"""Semantic history remains immutable while the materialized head evolves."""

import asyncio
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.tables import Project, SemanticEntry, SemanticEntryRevision
from app.services.execution import ExecutionService
from app.services.semantic_revisions import (
    SemanticRevisionConflictError,
    append_semantic_revision,
)


async def _project(client: AsyncClient) -> dict:
    response = await client.post("/api/v1/projects", json={"name": "语义版本测试"})
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def _knowledge(client: AsyncClient, project_id: str, value: str = "收入按开票金额") -> dict:
    response = await client.post(
        f"/api/v1/projects/{project_id}/knowledge",
        json={
            "key": "metric:revenue",
            "value": value,
            "entry_type": "metric",
            "state": "confirmed",
            "confidence": 1,
            "source": "user",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _source_binding(column: str = "amount") -> dict:
    return {
        "source_logical_name": "财务库",
        "source_kind": "connection",
        "table_or_view": "orders",
        "action_column": column,
        "canonical_type": "number",
        "schema_signature": "a" * 64,
    }


def _aggregate_definition() -> dict:
    return {
        "version": 1,
        "kind": "aggregate_metric",
        "operation": "sum",
        "source": _source_binding(),
        "null_policy": "ignore",
    }


def _relationship_definition() -> dict:
    endpoint = {
        "source_logical_name": "财务库",
        "source_kind": "connection",
        "table_or_view": "orders",
        "column": "store_id",
        "data_type": "number",
        "schema_signature": "b" * 64,
    }
    return {
        "version": 1,
        "left": endpoint,
        "right": {**endpoint, "table_or_view": "stores", "column": "id"},
    }


@pytest.mark.asyncio
async def test_exact_knowledge_lookup_is_project_scoped_and_never_writes(client: AsyncClient):
    project = await _project(client)
    other = await _project(client)
    entry = await _knowledge(client, project["id"])
    lookup = f"/api/v1/projects/{project['id']}/knowledge/lookup"
    result = await client.get(lookup, params={"key": entry["key"]})
    assert result.status_code == 200, result.text
    assert result.json()["data"]["id"] == entry["id"]
    for project_id, key in [(other["id"], entry["key"]), (project["id"], "metric:reven")]:
        missing = await client.get(
            f"/api/v1/projects/{project_id}/knowledge/lookup", params={"key": key}
        )
        assert missing.status_code == 200
        assert missing.json()["data"] is None
    unknown_project = await client.get(
        f"/api/v1/projects/{uuid4()}/knowledge/lookup", params={"key": entry["key"]}
    )
    assert unknown_project.status_code == 404
    history = await client.get(
        f"/api/v1/projects/{project['id']}/knowledge/{entry['id']}/revisions"
    )
    assert [item["id"] for item in history.json()["data"]] == [entry["active_revision_id"]]


@pytest.mark.asyncio
async def test_revision_api_uses_optimistic_head_and_restore_appends(client: AsyncClient):
    project = await _project(client)
    first = await _knowledge(client, project["id"])
    first_revision_id = first["active_revision_id"]
    assert first["revision_number"] == 1

    updated = await client.put(
        f"/api/v1/projects/{project['id']}/knowledge/{first['id']}",
        json={
            "value": "收入按实付金额",
            "source": "user",
            "expected_active_revision_id": first_revision_id,
        },
    )
    assert updated.status_code == 200, updated.text
    second = updated.json()["data"]
    assert second["revision_number"] == 2

    stale = await client.put(
        f"/api/v1/projects/{project['id']}/knowledge/{first['id']}",
        json={
            "value": "收入按合同金额",
            "source": "user",
            "expected_active_revision_id": first_revision_id,
        },
    )
    assert stale.status_code == 409, stale.text

    restored = await client.post(
        f"/api/v1/projects/{project['id']}/knowledge/{first['id']}"
        f"/revisions/{first_revision_id}/restore",
        json={
            "expected_active_revision_id": second["active_revision_id"],
            "reason": "恢复财务确认口径",
        },
    )
    assert restored.status_code == 200, restored.text
    head = restored.json()["data"]
    assert head["value"] == "收入按开票金额"
    assert head["revision_number"] == 3
    assert head["execution_state"] == "definition_only"

    history = await client.get(
        f"/api/v1/projects/{project['id']}/knowledge/{first['id']}/revisions"
    )
    assert history.status_code == 200, history.text
    revisions = history.json()["data"]
    assert [item["revision_number"] for item in revisions] == [3, 2, 1]
    assert revisions[0]["parent_revision_id"] == second["active_revision_id"]
    assert revisions[0]["restored_from_revision_id"] == first_revision_id
    assert revisions[1]["snapshot"]["value"] == "收入按实付金额"
    assert revisions[2]["snapshot"]["value"] == "收入按开票金额"


@pytest.mark.asyncio
async def test_user_can_fully_edit_semantic_identity_type_and_governance(
    client: AsyncClient,
):
    project = await _project(client)
    created_response = await client.post(
        f"/api/v1/projects/{project['id']}/knowledge",
        json={
            "key": "rule:revenue_scope",
            "value": "收入范围待核对",
            "entry_type": "business_rule",
            "state": "candidate",
            "confidence": 0.5,
            "validity": "active",
            "source": "user",
        },
    )
    assert created_response.status_code == 200, created_response.text
    created = created_response.json()["data"]

    updated_response = await client.put(
        f"/api/v1/projects/{project['id']}/knowledge/{created['id']}",
        json={
            "expected_active_revision_id": created["active_revision_id"],
            "key": "dimension:revenue_scope",
            "value": "收入按已审核订单范围划分",
            "entry_type": "dimension",
            "state": "locked",
            "definition": None,
            "source": "user",
        },
    )

    assert updated_response.status_code == 200, updated_response.text
    updated = updated_response.json()["data"]
    assert updated["key"] == "dimension:revenue_scope"
    assert updated["entry_type"] == "dimension"
    assert updated["state"] == "locked"
    assert updated["value"] == "收入按已审核订单范围划分"
    assert updated["source"] == "user"
    assert updated["revision_number"] == 2
    assert updated["execution_state"] == "definition_only"


@pytest.mark.asyncio
async def test_full_semantic_edit_rejects_duplicate_project_key(client: AsyncClient):
    project = await _project(client)
    first = await _knowledge(client, project["id"])
    second_response = await client.post(
        f"/api/v1/projects/{project['id']}/knowledge",
        json={
            "key": "metric:margin",
            "value": "毛利额",
            "entry_type": "metric",
            "state": "confirmed",
            "confidence": 1,
            "source": "user",
        },
    )
    assert second_response.status_code == 200, second_response.text
    second = second_response.json()["data"]

    duplicate_create = await client.post(
        f"/api/v1/projects/{project['id']}/knowledge",
        json={
            "key": first["key"],
            "value": "不能覆盖已有收入定义",
            "entry_type": "metric",
            "state": "candidate",
            "confidence": 0.5,
            "source": "user",
        },
    )
    assert duplicate_create.status_code == 409
    assert duplicate_create.json()["detail"] == "这个业务标识已被当前项目使用"

    duplicate = await client.put(
        f"/api/v1/projects/{project['id']}/knowledge/{second['id']}",
        json={
            "expected_active_revision_id": second["active_revision_id"],
            "key": first["key"],
            "source": "user",
        },
    )

    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "这个业务标识已被当前项目使用"


@pytest.mark.asyncio
async def test_executable_semantic_definitions_must_match_entry_type(client: AsyncClient):
    project = await _project(client)

    wrong_aggregate = await client.post(
        f"/api/v1/projects/{project['id']}/knowledge",
        json={
            "key": "dimension:revenue",
            "value": "收入层级",
            "entry_type": "dimension",
            "definition": _aggregate_definition(),
            "source": "user",
        },
    )
    assert wrong_aggregate.status_code == 422
    assert "聚合指标定义只能用于指标类型" in wrong_aggregate.text

    wrong_relationship = await client.post(
        f"/api/v1/projects/{project['id']}/knowledge",
        json={
            "key": "rule:store_scope",
            "value": "门店范围",
            "entry_type": "business_rule",
            "definition": _relationship_definition(),
            "source": "user",
        },
    )
    assert wrong_relationship.status_code == 422
    assert "数据关联定义只能用于数据关联类型" in wrong_relationship.text


@pytest.mark.asyncio
async def test_custom_semantic_definition_remains_descriptive_and_non_executable(
    client: AsyncClient,
):
    project = await _project(client)
    custom_definition = {
        "kind": "custom_display",
        "label": "区域层级",
        "levels": ["大区", "省份", "城市"],
    }

    response = await client.post(
        f"/api/v1/projects/{project['id']}/knowledge",
        json={
            "key": "dimension:region",
            "value": "区域按大区、省份和城市分层",
            "entry_type": "dimension",
            "definition": custom_definition,
            "source": "user",
        },
    )

    assert response.status_code == 200, response.text
    created = response.json()["data"]
    assert created["definition"] == custom_definition
    assert created["execution_state"] == "definition_only"
    assert created["execution_details"]["status"] == "definition_only"


@pytest.mark.asyncio
async def test_partial_semantic_updates_validate_the_merged_definition_type(
    client: AsyncClient,
):
    project = await _project(client)
    dimension_response = await client.post(
        f"/api/v1/projects/{project['id']}/knowledge",
        json={
            "key": "dimension:region",
            "value": "区域",
            "entry_type": "dimension",
            "source": "user",
        },
    )
    assert dimension_response.status_code == 200, dimension_response.text
    dimension = dimension_response.json()["data"]

    definition_only = await client.put(
        f"/api/v1/projects/{project['id']}/knowledge/{dimension['id']}",
        json={
            "expected_active_revision_id": dimension["active_revision_id"],
            "definition": _aggregate_definition(),
            "source": "user",
        },
    )
    assert definition_only.status_code == 422
    assert "聚合指标定义只能用于指标类型" in definition_only.text

    metric_response = await client.post(
        f"/api/v1/projects/{project['id']}/knowledge",
        json={
            "key": "metric:revenue_total",
            "value": "收入合计",
            "entry_type": "metric",
            "definition": _aggregate_definition(),
            "source": "user",
        },
    )
    assert metric_response.status_code == 200, metric_response.text
    metric = metric_response.json()["data"]
    assert metric["execution_state"] == "needs_validation"

    type_only = await client.put(
        f"/api/v1/projects/{project['id']}/knowledge/{metric['id']}",
        json={
            "expected_active_revision_id": metric["active_revision_id"],
            "entry_type": "dimension",
            "source": "user",
        },
    )
    assert type_only.status_code == 422
    assert "聚合指标定义只能用于指标类型" in type_only.text


@pytest.mark.asyncio
async def test_old_correction_update_conflicts_and_delete_preserves_newer_head(
    client: AsyncClient,
):
    project = await _project(client)
    run_response = await client.post(
        f"/api/v1/projects/{project['id']}/analysis-runs",
        json={"query": "核对收入"},
    )
    run = run_response.json()["data"]
    correction_payload = {
        "analysis_run_id": run["id"],
        "target_key": "metric:revenue",
        "text": "收入按实付金额",
        "correction_type": "metric_definition",
        "scope": "project",
    }
    created = await client.post(
        f"/api/v1/projects/{project['id']}/corrections",
        json=correction_payload,
    )
    assert created.status_code == 200, created.text
    correction = created.json()["data"]

    listed = await client.get(f"/api/v1/projects/{project['id']}/knowledge")
    correction_head = listed.json()["data"][0]
    user_edit = await client.put(
        f"/api/v1/projects/{project['id']}/knowledge/{correction_head['id']}",
        json={
            "value": "收入按财务最终入账金额",
            "source": "user",
            "expected_active_revision_id": correction_head["active_revision_id"],
        },
    )
    assert user_edit.status_code == 200, user_edit.text
    user_head = user_edit.json()["data"]

    correction_edit = await client.put(
        f"/api/v1/projects/{project['id']}/corrections/{correction['id']}",
        json={**correction_payload, "text": "收入改按合同金额"},
    )
    assert correction_edit.status_code == 409, correction_edit.text

    deleted = await client.delete(
        f"/api/v1/projects/{project['id']}/corrections/{correction['id']}"
    )
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["data"]["project_rule_removed"] is False
    final = await client.get(f"/api/v1/projects/{project['id']}/knowledge")
    assert final.json()["data"][0]["value"] == "收入按财务最终入账金额"
    assert final.json()["data"][0]["active_revision_id"] == user_head["active_revision_id"]


@pytest.mark.asyncio
async def test_deleting_only_correction_tombstones_head_but_keeps_history(
    client: AsyncClient,
    db_session,
):
    project = await _project(client)
    run_response = await client.post(
        f"/api/v1/projects/{project['id']}/analysis-runs",
        json={"query": "核对收入"},
    )
    run = run_response.json()["data"]
    created = await client.post(
        f"/api/v1/projects/{project['id']}/corrections",
        json={
            "analysis_run_id": run["id"],
            "target_key": "metric:revenue",
            "text": "收入按实付金额",
            "correction_type": "metric_definition",
            "scope": "project",
        },
    )
    correction = created.json()["data"]
    entry_id = UUID(correction["semantic_entry_id"])

    deleted = await client.delete(
        f"/api/v1/projects/{project['id']}/corrections/{correction['id']}"
    )
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["data"]["project_rule_removed"] is True
    assert (await client.get(f"/api/v1/projects/{project['id']}/knowledge")).json()["data"] == []

    entry = await db_session.get(SemanticEntry, entry_id)
    assert entry is not None
    assert entry.is_active is False
    history = await db_session.execute(
        select(SemanticEntryRevision).where(SemanticEntryRevision.semantic_entry_id == entry_id)
    )
    assert [item.revision_number for item in history.scalars()] == [1, 2]


@pytest.mark.asyncio
async def test_new_explicit_answer_clears_execution_proof_compiled_for_old_meaning(
    db_session,
):
    project_id = uuid4()
    db_session.add(Project(id=project_id, name="确认口径证明失效"))
    entry = SemanticEntry(
        project_id=project_id,
        key="revenue_refund_policy",
        value="保留退款订单",
        entry_type="business_rule",
        state="confirmed",
        confidence=1,
        definition={
            "version": 1,
            "kind": "business_rule_strategy",
            "rule_key": "revenue_refund_policy",
            "selected_option": "保留退款订单",
            "action": {
                "kind": "identity",
                "column": "退款状态",
                "observed_values": ["否", "已退款"],
            },
        },
        validity="active",
        execution_state="verified",
        execution_details={"status": "verified"},
        source="user",
    )
    db_session.add(entry)
    await db_session.flush()
    await append_semantic_revision(
        db_session,
        entry,
        mutation_kind="created",
        actor_source="user",
    )
    await db_session.commit()

    service = ExecutionService(db_session, project_id=project_id)
    receipt = await service._persist_explicit_confirmation(
        [
            {
                "role": "assistant",
                "content": "计算收入时怎么处理退款？",
                "confirmation": {
                    "key": "revenue_refund_policy",
                    "question": "计算收入时怎么处理退款？",
                    "options": ["扣除退款", "保留退款订单"],
                },
            }
        ],
        "我选择扣除退款，请继续。",
    )

    await db_session.refresh(entry)
    assert receipt and receipt["selected_value"] == "扣除退款"
    assert entry.value == "扣除退款"
    assert entry.definition is None
    assert entry.execution_state == "definition_only"
    assert entry.execution_details["status"] == "definition_only"
    assert entry.revision_number == 2


@pytest.mark.asyncio
async def test_legacy_confirmation_revision_conflict_rolls_back_materialized_head(
    db_session,
    monkeypatch: pytest.MonkeyPatch,
):
    project_id = uuid4()
    db_session.add(Project(id=project_id, name="确认冲突回滚"))
    entry = SemanticEntry(
        project_id=project_id,
        key="revenue_refund_policy",
        value="保留退款订单",
        entry_type="business_rule",
        state="confirmed",
        confidence=1,
        validity="active",
        source="user",
    )
    db_session.add(entry)
    await db_session.flush()
    await append_semantic_revision(
        db_session,
        entry,
        mutation_kind="created",
        actor_source="user",
    )
    await db_session.commit()
    original_revision_id = entry.active_revision_id

    async def fail_revision(*_args, **_kwargs):
        raise SemanticRevisionConflictError(
            expected_revision_id=original_revision_id,
            active_revision_id=uuid4(),
        )

    monkeypatch.setattr("app.services.execution.append_semantic_revision", fail_revision)
    service = ExecutionService(db_session, project_id=project_id)

    with pytest.raises(SemanticRevisionConflictError):
        await service._persist_explicit_confirmation(
            [
                {
                    "role": "assistant",
                    "confirmation": {
                        "key": "refund_policy",
                        "question": "计算收入时，退款订单需要扣除吗？",
                        "options": ["扣除退款", "保留退款订单"],
                    },
                }
            ],
            "我确认选择扣除退款。",
        )

    assert db_session.in_transaction() is False
    await db_session.commit()
    await db_session.refresh(entry)
    assert entry.key == "revenue_refund_policy"
    assert entry.value == "保留退款订单"
    assert entry.revision_number == 1
    assert entry.active_revision_id == original_revision_id


@pytest.mark.asyncio
async def test_sqlite_concurrent_revision_writer_becomes_refreshable_conflict(tmp_path):
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'semantic-race.db'}",
        connect_args={"timeout": 0.05},
    )
    sessions = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as seed:
            project = Project(name="并发语义版本")
            seed.add(project)
            await seed.flush()
            entry = SemanticEntry(
                project_id=project.id,
                key="metric:revenue",
                value="收入按实付金额",
                entry_type="metric",
                state="confirmed",
                confidence=1,
                source="user",
            )
            seed.add(entry)
            await seed.flush()
            await append_semantic_revision(
                seed,
                entry,
                mutation_kind="created",
                actor_source="user",
            )
            await seed.commit()
            entry_id = entry.id

        async with sessions() as left, sessions() as right:
            left_entry = await left.get(SemanticEntry, entry_id)
            right_entry = await right.get(SemanticEntry, entry_id)
            assert left_entry is not None and right_entry is not None
            expected = left_entry.active_revision_id
            assert right_entry.active_revision_id == expected
            left_entry.value = "收入按开票金额"
            right_entry.value = "收入按合同金额"

            async def write(session, entry):
                return await append_semantic_revision(
                    session,
                    entry,
                    mutation_kind="user_updated",
                    actor_source="user",
                    expected_active_revision_id=expected,
                )

            results = await asyncio.gather(
                write(left, left_entry),
                write(right, right_entry),
                return_exceptions=True,
            )
            conflicts = [item for item in results if isinstance(item, Exception)]
            successes = [item for item in results if not isinstance(item, Exception)]
            assert len(successes) == 1
            assert len(conflicts) == 1
            assert isinstance(conflicts[0], SemanticRevisionConflictError)
            winner = left if not isinstance(results[0], Exception) else right
            loser = right if winner is left else left
            await winner.commit()
            await loser.rollback()

        async with sessions() as verify:
            stored = await verify.get(SemanticEntry, entry_id)
            assert stored is not None
            assert stored.revision_number == 2
    finally:
        await engine.dispose()
