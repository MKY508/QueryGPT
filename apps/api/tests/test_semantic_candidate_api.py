"""Paginated and revision-safe project-understanding candidate APIs."""

from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import projects as projects_api
from app.db.tables import (
    Connection,
    Project,
    ProjectDataSource,
    SemanticEntry,
    SemanticEntryRevision,
)
from app.services.checkpoint_contract import stable_payload_hash
from app.services.semantic_revisions import append_semantic_revision


def _relationship_definition(
    left_table: str,
    right_table: str,
    *,
    logical_name: str = "经营数据",
) -> dict:
    return {
        "version": 1,
        "left": {
            "source_logical_name": logical_name,
            "source_kind": "connection",
            "table_or_view": left_table,
            "column": "store_id",
            "data_type": "TEXT",
            "schema_signature": "a" * 64,
        },
        "right": {
            "source_logical_name": logical_name,
            "source_kind": "connection",
            "table_or_view": right_table,
            "column": "store_id",
            "data_type": "TEXT",
            "schema_signature": "b" * 64,
        },
        "normalization": "exact",
        "cardinality": "many_to_one",
        "default_join": "left",
        "minimum_left_match_rate": 0.8,
        "maximum_expansion_ratio": 1.2,
    }


async def _post_relationship_candidate(
    client: AsyncClient,
    project_id: UUID,
    *,
    key: str,
    value: str,
    source_id: str,
    left_table: str,
    right_table: str,
) -> dict:
    response = await client.post(
        f"/api/v1/projects/{project_id}/knowledge",
        json={
            "key": key,
            "value": value,
            "entry_type": "relationship",
            "state": "candidate",
            "confidence": 0.65,
            "definition": _relationship_definition(left_table, right_table),
            "validity": "unverified",
            "evidence": [{"kind": "matching_column_names", "source_ids": [source_id]}],
            "source": "inferred",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def _add_relationship_source(
    db_session: AsyncSession,
    project_id: UUID,
    *tables: str,
) -> ProjectDataSource:
    source = ProjectDataSource(
        project_id=project_id,
        kind="connection",
        name="经营数据",
        format="sqlite",
        status="ready",
        profile_data={
            "logical_name": "经营数据",
            "is_current": True,
            "tables": [
                {
                    "name": table,
                    "columns": [{"name": "store_id", "type": "TEXT"}],
                }
                for table in tables
            ],
            "preanalysis": {},
        },
    )
    db_session.add(source)
    await db_session.flush()
    return source


@pytest.mark.asyncio
async def test_paginated_knowledge_filters_without_changing_legacy_get(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project = Project(name="分页项目理解")
    db_session.add(project)
    await db_session.commit()
    first = await _post_relationship_candidate(
        client,
        project.id,
        key="relationship:orders:stores",
        value="订单关联门店",
        source_id="source-orders",
        left_table="orders",
        right_table="stores",
    )
    await _post_relationship_candidate(
        client,
        project.id,
        key="relationship:lines:products",
        value="明细关联商品",
        source_id="source-products",
        left_table="order_lines",
        right_table="products",
    )
    await _post_relationship_candidate(
        client,
        project.id,
        key="relationship:orders:warehouses",
        value="订单关联门店仓库映射",
        source_id="source-orders-extra",
        left_table="orders",
        right_table="stores",
    )
    confirmed = await client.post(
        f"/api/v1/projects/{project.id}/knowledge",
        json={
            "key": "refund_policy",
            "value": "收入扣除退款",
            "entry_type": "business_rule",
            "state": "confirmed",
            "confidence": 1,
            "validity": "active",
            "source": "user",
        },
    )
    assert confirmed.status_code == 200, confirmed.text

    legacy = await client.get(f"/api/v1/projects/{project.id}/knowledge")
    assert legacy.status_code == 200
    assert isinstance(legacy.json()["data"], list)
    assert len(legacy.json()["data"]) == 4

    filtered = await client.get(
        f"/api/v1/projects/{project.id}/knowledge/page",
        params={
            "entry_type": "relationship",
            "state": "candidate",
            "source_id": "source-orders",
            "left_table": "orders",
            "right_table": "stores",
            "search": "门店",
        },
    )
    assert filtered.status_code == 200, filtered.text
    page = filtered.json()["data"]
    assert [item["id"] for item in page["items"]] == [first["id"]]
    assert page == {
        "items": page["items"],
        "total": 1,
        "offset": 0,
        "limit": 50,
        "has_more": False,
        "next_offset": None,
    }

    first_page = await client.get(
        f"/api/v1/projects/{project.id}/knowledge/page",
        params={"state": "candidate", "limit": 1},
    )
    first_page_data = first_page.json()["data"]
    assert first_page_data["total"] == 3
    assert first_page_data["has_more"] is True
    assert first_page_data["next_offset"] == 1


@pytest.mark.asyncio
async def test_table_scope_is_applied_in_sql_before_pagination(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    project = Project(name="关系表筛选下推")
    db_session.add(project)
    await db_session.commit()
    expected = await _post_relationship_candidate(
        client,
        project.id,
        key="relationship:orders:stores",
        value="订单关联门店",
        source_id="source-orders",
        left_table="Orders",
        right_table="Stores",
    )
    await _post_relationship_candidate(
        client,
        project.id,
        key="relationship:lines:products",
        value="明细关联商品",
        source_id="source-products",
        left_table="order_lines",
        right_table="products",
    )

    def reject_python_table_filter(*args, **kwargs):
        if kwargs.get("left_table") or kwargs.get("right_table"):
            raise AssertionError("table filters must be applied by SQL")
        return True

    monkeypatch.setattr(
        projects_api,
        "_semantic_entry_matches_page_scope",
        reject_python_table_filter,
    )
    response = await client.get(
        f"/api/v1/projects/{project.id}/knowledge/page",
        params={"left_table": "orders", "right_table": "stores", "limit": 1},
    )

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["total"] == 1
    assert [item["id"] for item in data["items"]] == [expected["id"]]
    assert data["has_more"] is False


@pytest.mark.asyncio
async def test_knowledge_source_scopes_are_resolved_before_pagination(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project = Project(name="按来源管理项目理解")
    local_connection = Connection(name="本地库", driver="sqlite")
    remote_connection = Connection(
        name="线上数仓",
        driver="postgresql",
        host="db.example.test",
        database_name="warehouse",
    )
    db_session.add_all([project, local_connection, remote_connection])
    await db_session.flush()

    superseded_local = ProjectDataSource(
        project_id=project.id,
        connection_id=local_connection.id,
        kind="connection",
        name="旧版本地库",
        status="superseded",
        profile_data={"logical_name": "本地经营库"},
    )
    local = ProjectDataSource(
        project_id=project.id,
        connection_id=local_connection.id,
        kind="connection",
        name="当前本地库",
        status="ready",
        profile_data={"logical_name": "本地经营库"},
    )
    remote = ProjectDataSource(
        project_id=project.id,
        connection_id=remote_connection.id,
        kind="connection",
        name="线上数仓",
        status="ready",
        profile_data={"logical_name": "线上数仓"},
    )
    csv = ProjectDataSource(
        project_id=project.id,
        kind="file",
        name="订单.csv",
        format="csv",
        status="ready",
        profile_data={"logical_name": "订单文件"},
    )
    excel = ProjectDataSource(
        project_id=project.id,
        kind="file",
        name="预算.xlsx",
        format="xlsx",
        status="ready",
        profile_data={"logical_name": "预算文件"},
    )
    parquet = ProjectDataSource(
        project_id=project.id,
        kind="file",
        name="明细.parquet",
        format="parquet",
        status="ready",
        profile_data={"logical_name": "明细文件"},
    )
    json_source = ProjectDataSource(
        project_id=project.id,
        kind="file",
        name="事件.jsonl",
        format="jsonl",
        status="ready",
        profile_data={"logical_name": "事件文件"},
    )
    other_file = ProjectDataSource(
        project_id=project.id,
        kind="file",
        name="补充.tsv",
        format="tsv",
        status="ready",
        profile_data={"logical_name": "补充文件"},
    )
    db_session.add_all(
        [superseded_local, local, remote, csv, excel, parquet, json_source, other_file]
    )
    await db_session.flush()

    def binding(logical_name: str, source_kind: str, table: str = "records") -> dict:
        return {
            "source_logical_name": logical_name,
            "source_kind": source_kind,
            "table_or_view": table,
            "action_column": "amount",
            "canonical_type": "number",
            "schema_signature": "c" * 64,
        }

    def aggregate(logical_name: str, source_kind: str = "connection") -> dict:
        return {
            "version": 1,
            "kind": "aggregate_metric",
            "operation": "sum",
            "source": binding(logical_name, source_kind),
            "null_policy": "ignore",
        }

    def relationship(left_name: str, right_name: str) -> dict:
        definition = _relationship_definition("orders", "stores", logical_name=left_name)
        definition["right"]["source_logical_name"] = right_name
        return definition

    entries = [
        SemanticEntry(
            project_id=project.id,
            key="project_general",
            value="所有来源通用的业务口径",
            entry_type="business_rule",
            state="confirmed",
            evidence=[
                {"kind": "preflight", "source_id": str(csv.id)},
                {"kind": "user_declaration"},
            ],
            source="user",
        ),
        SemanticEntry(
            project_id=project.id,
            key="local_metric",
            value="本地收入",
            entry_type="metric",
            state="confirmed",
            definition=aggregate("本地经营库"),
            source="user",
        ),
        SemanticEntry(
            project_id=project.id,
            key="local_relationship",
            value="同一个本地库内的两张表",
            entry_type="relationship",
            state="confirmed",
            definition=relationship("本地经营库", "本地经营库"),
            source="user",
        ),
        SemanticEntry(
            project_id=project.id,
            key="remote_rule",
            value="线上订单状态口径",
            entry_type="business_rule",
            state="confirmed",
            definition={
                "version": 1,
                "kind": "business_rule_strategy",
                "rule_key": "remote_order_state",
                "selected_option": "仅已完成订单",
                "action": {
                    "kind": "identity",
                    "column": "amount",
                    "observed_values": [],
                },
                "applies_to": binding("线上数仓", "connection"),
            },
            source="user",
        ),
        SemanticEntry(
            project_id=project.id,
            key="csv_rule",
            value="订单文件口径",
            entry_type="business_rule",
            state="confirmed",
            evidence=[{"kind": "user_declaration", "source_ids": [str(csv.id)]}],
            source="user",
        ),
        SemanticEntry(
            project_id=project.id,
            key="excel_rule",
            value="预算文件口径",
            entry_type="business_rule",
            state="confirmed",
            evidence=[
                {
                    "kind": "imported",
                    "profile": {"source_refs": [{"physical_source_id": str(excel.id)}]},
                }
            ],
            source="imported",
        ),
        SemanticEntry(
            project_id=project.id,
            key="parquet_rule",
            value="明细文件口径",
            entry_type="business_rule",
            state="confirmed",
            evidence=[{"source_id": str(parquet.id)}],
            source="imported",
        ),
        SemanticEntry(
            project_id=project.id,
            key="json_rule",
            value="事件文件口径",
            entry_type="business_rule",
            state="confirmed",
            evidence=[{"source_id": str(json_source.id)}],
            source="imported",
        ),
        SemanticEntry(
            project_id=project.id,
            key="other_file_rule",
            value="补充文件口径",
            entry_type="business_rule",
            state="confirmed",
            evidence=[{"source_id": str(other_file.id)}],
            source="imported",
        ),
        SemanticEntry(
            project_id=project.id,
            key="cross_source_relationship",
            value="本地订单关联线上门店",
            entry_type="relationship",
            state="confirmed",
            definition=relationship("本地经营库", "线上数仓"),
            source="user",
        ),
        SemanticEntry(
            project_id=project.id,
            key="unresolved_metric",
            value="找不到绑定来源",
            entry_type="metric",
            state="confirmed",
            definition=aggregate("已经移除的来源"),
            evidence=[{"source_id": "legacy-source-id"}],
            source="imported",
        ),
        SemanticEntry(
            project_id=project.id,
            key="custom_definition",
            value="自定义说明中的左右字段不是关系绑定",
            entry_type="business_rule",
            state="confirmed",
            definition={"kind": "custom_note", "left": "低", "right": "高"},
            evidence=[{"source_id": str(csv.id)}],
            source="user",
        ),
    ]
    db_session.add_all(entries)
    await db_session.commit()

    response = await client.get(
        f"/api/v1/projects/{project.id}/knowledge/page",
        params={"limit": 100},
    )
    assert response.status_code == 200, response.text
    by_key = {item["key"]: item for item in response.json()["data"]["items"]}
    assert by_key["project_general"]["source_scope"] == "project"
    assert by_key["local_metric"]["source_scope"] == "local_database"
    assert by_key["local_relationship"]["source_scope"] == "local_database"
    assert by_key["remote_rule"]["source_scope"] == "remote_database"
    assert by_key["csv_rule"]["source_scope"] == "csv"
    assert by_key["excel_rule"]["source_scope"] == "excel"
    assert by_key["parquet_rule"]["source_scope"] == "parquet"
    assert by_key["json_rule"]["source_scope"] == "json"
    assert by_key["other_file_rule"]["source_scope"] == "other_file"
    assert by_key["cross_source_relationship"]["source_scope"] == "cross_source"
    assert by_key["unresolved_metric"]["source_scope"] == "unresolved"
    assert by_key["custom_definition"]["source_scope"] == "csv"
    assert by_key["local_metric"]["source_refs"] == [
        {
            "source_id": str(local.id),
            "logical_name": "本地经营库",
            "name": "当前本地库",
            "kind": "connection",
            "format": "sqlite",
        }
    ]
    assert by_key["local_metric"]["source_refs"][0]["source_id"] != str(superseded_local.id)
    assert len(by_key["local_relationship"]["source_refs"]) == 1
    assert {item["source_id"] for item in by_key["cross_source_relationship"]["source_refs"]} == {
        str(local.id),
        str(remote.id),
    }

    local_page = await client.get(
        f"/api/v1/projects/{project.id}/knowledge/page",
        params={"source_scope": "local_database", "offset": 1, "limit": 1},
    )
    assert local_page.status_code == 200, local_page.text
    assert local_page.json()["data"]["total"] == 2
    assert len(local_page.json()["data"]["items"]) == 1
    assert local_page.json()["data"]["next_offset"] is None

    file_page = await client.get(
        f"/api/v1/projects/{project.id}/knowledge/page",
        params={"source_scope": "file", "limit": 100},
    )
    assert file_page.status_code == 200, file_page.text
    assert file_page.json()["data"]["total"] == 6

    expected_scope_totals = {
        "project": 1,
        "remote_database": 1,
        "csv": 2,
        "excel": 1,
        "parquet": 1,
        "json": 1,
        "other_file": 1,
        "cross_source": 1,
        "unresolved": 1,
    }
    for scope, expected_total in expected_scope_totals.items():
        scoped = await client.get(
            f"/api/v1/projects/{project.id}/knowledge/page",
            params={"source_scope": scope, "limit": 100},
        )
        assert scoped.status_code == 200, scoped.text
        assert scoped.json()["data"]["total"] == expected_total

    current_source_page = await client.get(
        f"/api/v1/projects/{project.id}/knowledge/page",
        params={"source_id": str(local.id), "limit": 100},
    )
    assert current_source_page.status_code == 200, current_source_page.text
    assert {item["key"] for item in current_source_page.json()["data"]["items"]} == {
        "local_metric",
        "local_relationship",
        "cross_source_relationship",
    }

    legacy_source_page = await client.get(
        f"/api/v1/projects/{project.id}/knowledge/page",
        params={"source_id": "legacy-source-id"},
    )
    assert legacy_source_page.status_code == 200, legacy_source_page.text
    assert [item["key"] for item in legacy_source_page.json()["data"]["items"]] == [
        "unresolved_metric"
    ]


@pytest.mark.asyncio
async def test_ambiguous_logical_source_scope_is_left_unresolved(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project = Project(name="同名来源不猜测")
    first = ProjectDataSource(
        project=project,
        kind="file",
        name="销售一.csv",
        format="csv",
        status="ready",
        profile_data={"logical_name": "销售文件"},
    )
    second = ProjectDataSource(
        project=project,
        kind="file",
        name="销售二.csv",
        format="csv",
        status="ready",
        profile_data={"logical_name": "销售文件"},
    )
    entry = SemanticEntry(
        project=project,
        key="metric:ambiguous_sales",
        value="销售额",
        entry_type="metric",
        state="confirmed",
        definition={
            "version": 1,
            "kind": "aggregate_metric",
            "operation": "sum",
            "source": {
                "source_logical_name": "销售文件",
                "source_kind": "file",
                "table_or_view": "销售文件",
                "action_column": "amount",
                "canonical_type": "number",
                "schema_signature": "d" * 64,
            },
            "null_policy": "ignore",
        },
        source="user",
    )
    db_session.add_all([project, first, second, entry])
    await db_session.commit()

    response = await client.get(
        f"/api/v1/projects/{project.id}/knowledge/page",
        params={"source_scope": "unresolved"},
    )

    assert response.status_code == 200, response.text
    items = response.json()["data"]["items"]
    assert [item["key"] for item in items] == [entry.key]
    assert items[0]["source_scope"] == "unresolved"
    assert items[0]["source_refs"] == []


@pytest.mark.asyncio
async def test_knowledge_summary_uses_one_active_governance_count_contract(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project = Project(name="项目理解摘要")
    db_session.add(project)
    await db_session.flush()
    await _add_relationship_source(
        db_session,
        project.id,
        "orders",
        "stores",
        "sales",
        "products",
    )
    await db_session.commit()
    await _post_relationship_candidate(
        client,
        project.id,
        key="relationship:pending",
        value="待验证关系",
        source_id="source-pending",
        left_table="orders",
        right_table="stores",
    )
    stale = await client.post(
        f"/api/v1/projects/{project.id}/knowledge",
        json={
            "key": "stale_candidate",
            "value": "字段已经变化",
            "entry_type": "business_rule",
            "state": "candidate",
            "validity": "stale",
            "source": "user",
        },
    )
    assert stale.status_code == 200, stale.text
    confirmed = await client.post(
        f"/api/v1/projects/{project.id}/knowledge",
        json={
            "key": "relationship:confirmed",
            "value": "已确认关系",
            "entry_type": "relationship",
            "state": "confirmed",
            "definition": _relationship_definition("sales", "products"),
            "validity": "active",
            "source": "user",
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    locked = await client.post(
        f"/api/v1/projects/{project.id}/knowledge",
        json={
            "key": "locked_metric",
            "value": "固定指标口径",
            "entry_type": "metric",
            "state": "locked",
            "validity": "active",
            "source": "user",
        },
    )
    assert locked.status_code == 200, locked.text
    hidden_or_visible_candidates = [
        ("verified_query:runtime", "verified_query", "SELECT amount FROM orders"),
        ("cleaning_rule:object", "cleaning_rule", '  {"operation":"drop_empty"}'),
        ("cleaning_rule:array", "cleaning_rule", '\n\t[ {"operation":"trim"} ]'),
        ("cleaning_rule:business", "cleaning_rule", "空白门店名称需要人工核对"),
    ]
    for key, entry_type, value in hidden_or_visible_candidates:
        response = await client.post(
            f"/api/v1/projects/{project.id}/knowledge",
            json={
                "key": key,
                "value": value,
                "entry_type": entry_type,
                "state": "candidate",
                "validity": "active",
                "source": "inferred",
            },
        )
        assert response.status_code == 200, response.text
    ignored_candidate = await client.post(
        f"/api/v1/projects/{project.id}/knowledge",
        json={
            "key": "ignored_candidate",
            "value": "不计入活动摘要",
            "entry_type": "business_rule",
            "state": "candidate",
            "validity": "active",
            "source": "inferred",
        },
    )
    assert ignored_candidate.status_code == 200, ignored_candidate.text
    ignored_data = ignored_candidate.json()["data"]
    ignored = await client.post(
        f"/api/v1/projects/{project.id}/knowledge/batch",
        json={
            "action": "ignore",
            "items": [
                {
                    "entry_id": ignored_data["id"],
                    "expected_active_revision_id": ignored_data["active_revision_id"],
                }
            ],
        },
    )
    assert ignored.status_code == 200, ignored.text

    summary = await client.get(f"/api/v1/projects/{project.id}/knowledge/summary")
    assert summary.status_code == 200, summary.text
    assert summary.json()["data"] == {
        "active_total": 5,
        "pending_total": 2,
        "relationship_total": 2,
        "confirmed_total": 1,
        "locked_total": 1,
    }

    business_page = await client.get(
        f"/api/v1/projects/{project.id}/knowledge/page",
        params={"business_facing_only": True, "limit": 100},
    )
    assert business_page.status_code == 200, business_page.text
    business_data = business_page.json()["data"]
    assert business_data["total"] == 5
    assert {item["entry_type"] for item in business_data["items"]} == {
        "relationship",
        "business_rule",
        "metric",
        "cleaning_rule",
    }
    assert all(not item["value"].lstrip().startswith(("{", "[")) for item in business_data["items"])


@pytest.mark.asyncio
async def test_batch_queue_and_ignore_are_revision_bound_and_reversible(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project = Project(name="关联候选批处理")
    db_session.add(project)
    await db_session.commit()
    candidate = await _post_relationship_candidate(
        client,
        project.id,
        key="relationship:orders:stores",
        value="订单关联门店",
        source_id="source-orders",
        left_table="orders",
        right_table="stores",
    )

    queued = await client.post(
        f"/api/v1/projects/{project.id}/knowledge/batch",
        json={
            "action": "queue_validation",
            "items": [
                {
                    "entry_id": candidate["id"],
                    "expected_active_revision_id": candidate["active_revision_id"],
                }
            ],
        },
    )
    assert queued.status_code == 200, queued.text
    queued_data = queued.json()["data"]
    queued_entry = queued_data["items"][0]
    assert queued_entry["active_revision_id"] != candidate["active_revision_id"]
    assert queued_entry["execution_state"] == "needs_validation"
    assert queued_entry["validity"] == "unverified"
    assert queued_entry["allowed_actions"] == []
    assert queued_data["queued_entry_ids"] == [candidate["id"]]
    assert queued_data["validation_job_id"]
    assert queued_data["validation_status"] == "queued"
    assert "validation_selection" not in queued_data
    assert "validation_prompt" not in queued_data

    stale_write = await client.post(
        f"/api/v1/projects/{project.id}/knowledge/batch",
        json={
            "action": "ignore",
            "items": [
                {
                    "entry_id": candidate["id"],
                    "expected_active_revision_id": candidate["active_revision_id"],
                }
            ],
        },
    )
    assert stale_write.status_code == 409

    completed_job = await client.get(
        f"/api/v1/projects/{project.id}/knowledge/validation-jobs/"
        f"{queued_data['validation_job_id']}"
    )
    assert completed_job.status_code == 200
    assert completed_job.json()["data"]["status"] == "completed"
    assert completed_job.json()["data"]["items"][0]["status"] == "blocked"
    current = await client.get(f"/api/v1/projects/{project.id}/knowledge/{candidate['id']}")
    current_entry = current.json()["data"]

    ignored = await client.post(
        f"/api/v1/projects/{project.id}/knowledge/batch",
        json={
            "action": "ignore",
            "items": [
                {
                    "entry_id": candidate["id"],
                    "expected_active_revision_id": current_entry["active_revision_id"],
                }
            ],
            "reason": "与当前分析无关",
        },
    )
    assert ignored.status_code == 200, ignored.text
    ignored_entry = ignored.json()["data"]["items"][0]
    assert ignored_entry["is_active"] is False
    assert ignored_entry["allowed_actions"] == ["restore"]
    legacy = await client.get(f"/api/v1/projects/{project.id}/knowledge")
    assert legacy.json()["data"] == []

    stale_page = await client.get(
        f"/api/v1/projects/{project.id}/knowledge/page",
        params={"validity": "stale"},
    )
    assert stale_page.status_code == 200, stale_page.text
    stale_items = stale_page.json()["data"]["items"]
    assert [item["id"] for item in stale_items] == [candidate["id"]]
    assert stale_items[0]["is_active"] is False
    assert stale_items[0]["allowed_actions"] == ["restore"]

    restored = await client.post(
        f"/api/v1/projects/{project.id}/knowledge/batch",
        json={
            "action": "restore",
            "items": [
                {
                    "entry_id": candidate["id"],
                    "expected_active_revision_id": ignored_entry["active_revision_id"],
                }
            ],
        },
    )
    assert restored.status_code == 200, restored.text
    restored_entry = restored.json()["data"]["items"][0]
    assert restored_entry["is_active"] is True
    assert restored_entry["validity"] == "unverified"
    assert restored_entry["active_revision_id"] != ignored_entry["active_revision_id"]
    assert restored_entry["allowed_actions"] == ["ignore", "queue_validation", "attest"]
    legacy_after_restore = await client.get(f"/api/v1/projects/{project.id}/knowledge")
    assert [item["id"] for item in legacy_after_restore.json()["data"]] == [candidate["id"]]


@pytest.mark.asyncio
async def test_large_validation_queue_returns_every_post_queue_revision_identity(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project = Project(name="完整关联验证选择")
    db_session.add(project)
    await db_session.commit()
    candidates = [
        await _post_relationship_candidate(
            client,
            project.id,
            key=f"relationship:orders_{index}:stores_{index}",
            value=f"订单 {index} 关联门店 {index}",
            source_id=f"source-{index}",
            left_table=f"orders_{index}",
            right_table=f"stores_{index}",
        )
        for index in range(25)
    ]

    queued = await client.post(
        f"/api/v1/projects/{project.id}/knowledge/batch",
        json={
            "action": "queue_validation",
            "items": [
                {
                    "entry_id": item["id"],
                    "expected_active_revision_id": item["active_revision_id"],
                }
                for item in candidates
            ],
        },
    )
    assert queued.status_code == 200, queued.text
    data = queued.json()["data"]
    assert len(data["items"]) == 25
    assert data["validation_job_id"]
    assert data["validation_status"] == "queued"
    assert "validation_selection" not in data
    assert "validation_prompt" not in data
    expected_selection = {item["id"]: item["active_revision_id"] for item in data["items"]}
    assert set(data["queued_entry_ids"]) == set(expected_selection)
    assert all(
        expected_selection[item["id"]] != original["active_revision_id"]
        for item, original in zip(data["items"], candidates, strict=True)
    )


@pytest.mark.asyncio
async def test_batch_remember_rejects_unverified_set_atomically_then_accepts_verified_head(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project = Project(name="安全记住候选")
    db_session.add(project)
    await db_session.commit()
    unverified_response = await client.post(
        f"/api/v1/projects/{project.id}/knowledge",
        json={
            "key": "metric_candidate:revenue",
            "value": "收入候选",
            "entry_type": "metric",
            "state": "candidate",
            "confidence": 0.6,
            "validity": "active",
            "source": "inferred",
        },
    )
    assert unverified_response.status_code == 200
    unverified = unverified_response.json()["data"]
    assert unverified["allowed_actions"] == ["ignore"]

    definition = {
        "version": 1,
        "kind": "aggregate_metric",
        "operation": "sum",
        "source": {
            "source_logical_name": "订单",
            "source_kind": "file",
            "table_or_view": "orders",
            "action_column": "amount",
            "canonical_type": "number",
            "schema_signature": "c" * 64,
        },
        "null_policy": "ignore",
    }
    definition_hash = stable_payload_hash(definition)
    run_id = str(uuid4())
    verified = SemanticEntry(
        project_id=project.id,
        key="metric:verified-revenue",
        value="订单数据中金额列的合计候选",
        entry_type="metric",
        state="candidate",
        confidence=0.75,
        definition=definition,
        validity="active",
        execution_state="verified",
        execution_details={
            "version": 1,
            "status": "verified",
            "definition_hash": definition_hash,
            "last_verified_run_id": run_id,
            "result_hash": "d" * 64,
            "verified_at": "2026-07-19T00:00:00+00:00",
        },
        evidence=[
            {
                "kind": "deterministic_aggregate_metric_observation",
                "analysis_run_id": run_id,
                "definition_hash": definition_hash,
                "result_hash": "d" * 64,
            }
        ],
        source="verified_analysis",
        is_active=True,
    )
    db_session.add(verified)
    await db_session.flush()
    await append_semantic_revision(
        db_session,
        verified,
        mutation_kind="deterministic_metric_candidate",
        actor_source="verified_analysis",
    )
    verified_without_definition = SemanticEntry(
        project_id=project.id,
        key="metric:verified-without-definition",
        value="只有结果证据，没有可执行定义",
        entry_type="metric",
        state="candidate",
        confidence=0.7,
        definition=None,
        validity="active",
        execution_state="verified",
        execution_details={
            "version": 1,
            "status": "verified",
            "last_verified_run_id": str(uuid4()),
        },
        evidence=[],
        source="verified_analysis",
        is_active=True,
    )
    db_session.add(verified_without_definition)
    await db_session.flush()
    await append_semantic_revision(
        db_session,
        verified_without_definition,
        mutation_kind="observation_without_definition",
        actor_source="verified_analysis",
    )
    legacy_definition = {
        "version": 1,
        "kind": "column_metric",
        "source_id": str(uuid4()),
        "column": "account_rep_code",
    }
    legacy_definition_hash = stable_payload_hash(legacy_definition)
    legacy_run_id = str(uuid4())
    legacy_verified = SemanticEntry(
        project_id=project.id,
        key="metric_candidate:legacy:account_rep_code",
        value="account_rep_code 可能是金额指标",
        entry_type="metric",
        state="candidate",
        confidence=0.65,
        definition=legacy_definition,
        validity="active",
        execution_state="verified",
        execution_details={
            "version": 1,
            "status": "verified",
            "definition_hash": legacy_definition_hash,
            "last_verified_run_id": legacy_run_id,
        },
        evidence=[
            {
                "kind": "semantic_execution_verification",
                "status": "verified",
                "analysis_run_id": legacy_run_id,
                "definition_hash": legacy_definition_hash,
            }
        ],
        source="inferred",
        is_active=True,
    )
    db_session.add(legacy_verified)
    await db_session.flush()
    await append_semantic_revision(
        db_session,
        legacy_verified,
        mutation_kind="execution_verified",
        actor_source="system",
    )
    await db_session.commit()
    original_verified_revision_id = verified.active_revision_id

    action_page = await client.get(
        f"/api/v1/projects/{project.id}/knowledge/page",
        params={"state": "candidate"},
    )
    actions_by_key = {
        item["key"]: item["allowed_actions"] for item in action_page.json()["data"]["items"]
    }
    assert actions_by_key[unverified["key"]] == ["ignore"]
    assert actions_by_key[verified.key] == ["ignore", "remember"]
    assert actions_by_key[verified_without_definition.key] == ["ignore"]
    assert actions_by_key[legacy_verified.key] == ["ignore"]

    unsafe_batch = await client.post(
        f"/api/v1/projects/{project.id}/knowledge/batch",
        json={
            "action": "remember",
            "items": [
                {
                    "entry_id": str(verified.id),
                    "expected_active_revision_id": str(verified.active_revision_id),
                },
                {
                    "entry_id": unverified["id"],
                    "expected_active_revision_id": unverified["active_revision_id"],
                },
            ],
        },
    )
    assert unsafe_batch.status_code == 409
    await db_session.refresh(verified)
    assert verified.state == "candidate"
    assert verified.active_revision_id == original_verified_revision_id

    remembered = await client.post(
        f"/api/v1/projects/{project.id}/knowledge/batch",
        json={
            "action": "remember",
            "items": [
                {
                    "entry_id": str(verified.id),
                    "expected_active_revision_id": str(verified.active_revision_id),
                }
            ],
        },
    )
    assert remembered.status_code == 200, remembered.text
    remembered_entry = remembered.json()["data"]["items"][0]
    assert remembered_entry["state"] == "confirmed"
    assert remembered_entry["execution_state"] == "verified"
    assert remembered_entry["active_revision_id"] != str(original_verified_revision_id)
    assert remembered_entry["evidence"][-1]["validated_revision_id"] == str(
        original_verified_revision_id
    )


@pytest.mark.asyncio
async def test_user_can_edit_candidate_governance_without_bypassing_execution_validation(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project = Project(name="候选治理门禁")
    db_session.add(project)
    await db_session.flush()
    await _add_relationship_source(
        db_session,
        project.id,
        "orders",
        "stores",
        "shops",
    )
    await db_session.commit()
    candidate = await _post_relationship_candidate(
        client,
        project.id,
        key="relationship:orders:stores",
        value="订单关联门店",
        source_id="source-orders",
        left_table="orders",
        right_table="stores",
    )

    rejected = await client.put(
        f"/api/v1/projects/{project.id}/knowledge/{candidate['id']}",
        json={
            "state": "confirmed",
            "source": "inferred",
            "expected_active_revision_id": candidate["active_revision_id"],
        },
    )
    assert rejected.status_code == 409, rejected.text
    assert "项目理解操作" in rejected.json()["detail"]

    manually_confirmed = await client.put(
        f"/api/v1/projects/{project.id}/knowledge/{candidate['id']}",
        json={
            "state": "confirmed",
            "validity": "active",
            "source": "user",
            "expected_active_revision_id": candidate["active_revision_id"],
        },
    )
    assert manually_confirmed.status_code == 200, manually_confirmed.text
    manually_confirmed_entry = manually_confirmed.json()["data"]
    assert manually_confirmed_entry["state"] == "confirmed"
    assert manually_confirmed_entry["validity"] == "active"
    assert manually_confirmed_entry["execution_state"] == "needs_validation"
    assert manually_confirmed_entry["allowed_actions"] == ["attest"]
    assert manually_confirmed_entry["active_revision_id"] != candidate["active_revision_id"]

    corrected_definition = _relationship_definition("orders", "shops")
    corrected = await client.put(
        f"/api/v1/projects/{project.id}/knowledge/{candidate['id']}",
        json={
            "value": "订单通过门店编号关联门店表",
            "definition": corrected_definition,
            "source": "user",
            "expected_active_revision_id": manually_confirmed_entry["active_revision_id"],
        },
    )
    assert corrected.status_code == 200, corrected.text
    entry = corrected.json()["data"]
    assert entry["state"] == "confirmed"
    assert entry["validity"] == "active"
    assert all(entry["definition"][key] == value for key, value in corrected_definition.items())
    assert entry["definition"]["business_name"] is None
    assert entry["definition"]["description"] is None
    assert entry["definition"]["example_questions"] == []
    assert entry["execution_state"] == "needs_validation"
    assert entry["active_revision_id"] != manually_confirmed_entry["active_revision_id"]
    assert entry["allowed_actions"] == ["attest"]

    attested = await client.post(
        f"/api/v1/projects/{project.id}/knowledge/batch",
        json={
            "action": "attest",
            "items": [
                {
                    "entry_id": candidate["id"],
                    "expected_active_revision_id": entry["active_revision_id"],
                }
            ],
        },
    )
    assert attested.status_code == 200, attested.text
    attested_entry = attested.json()["data"]["items"][0]
    assert attested_entry["state"] == "confirmed"
    assert attested_entry["execution_state"] == "verified"
    assert attested_entry["allowed_actions"] == []
    assert "采用状态保持不变" in attested.json()["message"]

    fetched = await client.get(f"/api/v1/projects/{project.id}/knowledge/{candidate['id']}")
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["data"]["active_revision_id"] == attested_entry["active_revision_id"]

    upsert_bypass = await client.post(
        f"/api/v1/projects/{project.id}/knowledge",
        json={
            "key": candidate["key"],
            "value": "试图直接采用候选",
            "entry_type": "relationship",
            "state": "confirmed",
            "confidence": 1,
            "definition": corrected_definition,
            "validity": "active",
            "evidence": [],
            "source": "user",
        },
    )
    assert upsert_bypass.status_code == 409, upsert_bypass.text
    assert "业务标识" in upsert_bypass.json()["detail"]


@pytest.mark.asyncio
async def test_preflight_only_suggests_catalog_verified_relationships(
    db_session: AsyncSession,
):
    project = Project(name="只保留有依据的数据关联")
    db_session.add(project)
    await db_session.flush()
    tables = [
        {"name": f"table_{index:02d}", "columns": [{"name": "store_id", "type": "TEXT"}]}
        for index in range(30)
    ]
    source = ProjectDataSource(
        project_id=project.id,
        kind="connection",
        name="经营库",
        format="sqlite",
        status="ready",
        profile_data={
            "logical_name": "经营库",
            "is_current": True,
            "tables": tables,
            "preanalysis": {
                "relationship_evidence": [
                    {
                        "kind": "declared_foreign_key",
                        "catalog_verified": True,
                        "binding_complete": True,
                        "constraint_name": "fk_28_29",
                        "source": {"table": "table_28", "columns": ["store_id"]},
                        "target": {"table": "table_29", "columns": ["store_id"]},
                    }
                ]
            },
        },
    )
    db_session.add(source)
    await db_session.commit()

    await projects_api._persist_preflight_candidates(db_session, source)
    await db_session.commit()
    result = await db_session.execute(
        select(SemanticEntry).where(
            SemanticEntry.project_id == project.id,
            SemanticEntry.entry_type == "relationship",
        )
    )
    relationships = list(result.scalars())

    assert len(relationships) == 1
    declared = relationships[0]
    assert "table_28.store_id" in declared.value
    assert "table_29.store_id" in declared.value
    assert [item["kind"] for item in declared.evidence] == ["declared_foreign_key"]
    assert not any(
        item.get("kind") == "matching_column_names"
        for relationship in relationships
        for item in relationship.evidence
    )


@pytest.mark.asyncio
async def test_preflight_retires_only_untouched_legacy_column_candidates(
    db_session: AsyncSession,
):
    project = Project(name="旧列候选淘汰")
    db_session.add(project)
    await db_session.flush()
    source = ProjectDataSource(
        project_id=project.id,
        kind="connection",
        name="经营库",
        format="sqlite",
        status="ready",
        profile_data={
            "logical_name": "经营库",
            "is_current": True,
            "tables": [
                {
                    "name": "account_reps",
                    "columns": [
                        {"name": "account_rep_name", "type": "TEXT"},
                        {"name": "account_rep_code", "type": "TEXT"},
                    ],
                }
            ],
            "preanalysis": {},
        },
    )
    db_session.add(source)
    await db_session.flush()

    async def legacy_candidate(
        key: str,
        *,
        definition: dict | None = None,
        execution_state: str = "definition_only",
        evidence: list[dict] | None = None,
        actor_source: str = "inferred",
        state: str = "candidate",
        source_kind: str = "inferred",
    ) -> SemanticEntry:
        entry = SemanticEntry(
            project_id=project.id,
            key=key,
            value="旧版字段名候选",
            entry_type="metric" if key.startswith("metric_candidate:") else "dimension",
            state=state,
            confidence=0.65,
            definition=definition,
            validity="active",
            execution_state=execution_state,
            evidence=evidence or [{"kind": "preflight", "source_id": str(source.id)}],
            source=source_kind,
            is_active=True,
        )
        db_session.add(entry)
        await db_session.flush()
        await append_semantic_revision(
            db_session,
            entry,
            mutation_kind="candidate_created",
            actor_source=actor_source,
        )
        return entry

    verified = await legacy_candidate(
        f"metric_candidate:{source.id}:account_rep_code",
        definition={
            "version": 1,
            "kind": "column_metric",
            "source_id": str(source.id),
            "table": "account_reps",
            "column": "account_rep_code",
        },
        execution_state="verified",
        evidence=[
            {"kind": "preflight", "source_id": str(source.id)},
            {"kind": "semantic_execution_verification", "status": "verified"},
            {"kind": "semantic_scope_reconciled"},
        ],
    )
    grain = await legacy_candidate(f"grain:{source.id}")
    user_touched = await legacy_candidate(
        f"metric_candidate:{source.id}:account_rep_name",
        actor_source="user",
    )
    confirmed = await legacy_candidate(
        f"metric_candidate:{source.id}:confirmed_amount",
        state="confirmed",
        source_kind="user",
    )
    await db_session.commit()

    await projects_api._persist_preflight_candidates(db_session, source)
    await db_session.commit()

    for entry in (verified, grain):
        await db_session.refresh(entry)
        assert entry.is_active is False
        assert entry.validity == "stale"
        assert entry.execution_state == "blocked"
        revision = await db_session.get(SemanticEntryRevision, entry.active_revision_id)
        assert revision is not None
        assert revision.mutation_kind == "legacy_candidate_retired"

    await db_session.refresh(user_touched)
    await db_session.refresh(confirmed)
    assert user_touched.is_active is True
    assert user_touched.state == "candidate"
    assert confirmed.is_active is True
    assert confirmed.state == "confirmed"


@pytest.mark.asyncio
async def test_preflight_retires_legacy_name_matches_except_explicit_user_work(
    db_session: AsyncSession,
):
    project = Project(name="淘汰同名字段关系")
    db_session.add(project)
    await db_session.flush()
    source = ProjectDataSource(
        project_id=project.id,
        kind="connection",
        name="经营库",
        format="sqlite",
        status="ready",
        profile_data={
            "logical_name": "经营库",
            "is_current": True,
            "tables": [],
            "preanalysis": {},
        },
    )
    db_session.add(source)
    await db_session.flush()

    async def legacy_relationship(
        key: str,
        *,
        state: str = "candidate",
        source_kind: str = "inferred",
        is_active: bool = True,
        validity: str = "unverified",
        actor_source: str = "inferred",
        mutation_kind: str = "candidate_created",
        extra_evidence: list[dict] | None = None,
    ) -> SemanticEntry:
        entry = SemanticEntry(
            project_id=project.id,
            key=key,
            value="同名字段可能可以关联",
            entry_type="relationship",
            state=state,
            confidence=0.55,
            definition=_relationship_definition("left_table", "right_table"),
            validity=validity,
            execution_state="needs_validation",
            evidence=[
                {"kind": "matching_column_names"},
                {"kind": "semantic_scope_reconciled"},
                *(extra_evidence or []),
            ],
            source=source_kind,
            is_active=is_active,
        )
        db_session.add(entry)
        await db_session.flush()
        await append_semantic_revision(
            db_session,
            entry,
            mutation_kind=mutation_kind,
            actor_source=actor_source,
        )
        return entry

    untouched = await legacy_relationship("relationship_candidate:legacy:untouched")
    queued = await legacy_relationship(
        "relationship_candidate:legacy:queued",
        source_kind="user",
        actor_source="user",
        mutation_kind="validation_queued",
        extra_evidence=[{"kind": "relationship_validation_requested"}],
    )
    user_edited = await legacy_relationship(
        "relationship_candidate:legacy:user-edited",
        source_kind="user",
        actor_source="user",
        mutation_kind="user_updated",
    )
    api_created = await legacy_relationship(
        "relationship_candidate:legacy:api-created",
        source_kind="user",
        actor_source="user",
        mutation_kind="created",
    )
    confirmed = await legacy_relationship(
        "relationship_candidate:legacy:confirmed",
        state="confirmed",
        source_kind="user",
        actor_source="user",
        mutation_kind="verified_candidate_remembered",
    )
    ignored = await legacy_relationship(
        "relationship_candidate:legacy:ignored",
        source_kind="user",
        is_active=False,
        validity="stale",
        actor_source="user",
        mutation_kind="candidate_ignored",
    )
    original_revisions = {
        entry.id: entry.revision_number
        for entry in (untouched, queued, user_edited, api_created, confirmed, ignored)
    }
    await db_session.commit()

    await projects_api._persist_preflight_candidates(db_session, source)
    await db_session.commit()

    for entry in (untouched, queued):
        await db_session.refresh(entry)
        assert entry.is_active is False
        assert entry.validity == "stale"
        assert entry.execution_state == "blocked"
        assert entry.revision_number == original_revisions[entry.id] + 1
        assert entry.evidence[-1]["kind"] == "legacy_name_match_relationship_retired"
        revision = await db_session.get(SemanticEntryRevision, entry.active_revision_id)
        assert revision is not None
        assert revision.mutation_kind == "legacy_relationship_retired"
        assert revision.snapshot["is_active"] is False

    for entry in (user_edited, api_created, confirmed, ignored):
        await db_session.refresh(entry)
        assert entry.revision_number == original_revisions[entry.id]
    assert user_edited.is_active is True
    assert api_created.is_active is True
    assert confirmed.state == "confirmed"
    assert ignored.is_active is False
