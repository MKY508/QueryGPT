"""Schema and table relationship API tests"""

from uuid import uuid4

import pytest
from httpx import AsyncClient


async def create_connection(client: AsyncClient) -> str:
    response = await client.post(
        "/api/v1/config/connections",
        json={
            "name": "Schema Test DB",
            "driver": "sqlite",
            "database": ":memory:",
        },
    )
    assert response.status_code == 200
    return response.json()["data"]["id"]


async def create_relationship(client: AsyncClient, connection_id: str) -> dict:
    response = await client.post(
        f"/api/v1/schema/{connection_id}/relationships",
        json={
            "source_table": "orders",
            "source_column": "customer_id",
            "target_table": "customers",
            "target_column": "id",
            "relationship_type": "N:1",
            "join_type": "LEFT",
            "description": "订单关联客户",
        },
    )
    assert response.status_code == 200
    return response.json()["data"]


@pytest.mark.asyncio
async def test_create_and_list_relationships(client: AsyncClient):
    conn_id = await create_connection(client)
    created = await create_relationship(client, conn_id)
    assert created["source_table"] == "orders"

    response = await client.get(f"/api/v1/schema/{conn_id}/relationships")
    assert response.status_code == 200
    assert len(response.json()["data"]) == 1


@pytest.mark.asyncio
async def test_batch_create_relationships(client: AsyncClient):
    conn_id = await create_connection(client)
    response = await client.post(
        f"/api/v1/schema/{conn_id}/relationships/batch",
        json={
            "relationships": [
                {
                    "source_table": "order_items",
                    "source_column": "order_id",
                    "target_table": "orders",
                    "target_column": "id",
                    "relationship_type": "N:1",
                    "join_type": "LEFT",
                },
                {
                    "source_table": "order_items",
                    "source_column": "product_id",
                    "target_table": "products",
                    "target_column": "id",
                    "relationship_type": "N:1",
                    "join_type": "LEFT",
                },
            ]
        },
    )
    assert response.status_code == 200
    assert len(response.json()["data"]) == 2


@pytest.mark.asyncio
async def test_update_and_delete_relationship(client: AsyncClient):
    conn_id = await create_connection(client)
    relationship = await create_relationship(client, conn_id)

    updated = await client.put(
        f"/api/v1/schema/relationships/{relationship['id']}",
        json={
            "relationship_type": "1:1",
            "join_type": "INNER",
            "description": "更新后的描述",
        },
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["join_type"] == "INNER"

    deleted = await client.delete(f"/api/v1/schema/relationships/{relationship['id']}")
    assert deleted.status_code == 200
    relationships = (await client.get(f"/api/v1/schema/{conn_id}/relationships")).json()["data"]
    assert relationships == []


@pytest.mark.asyncio
async def test_layout_crud(client: AsyncClient):
    conn_id = await create_connection(client)

    created = await client.post(
        f"/api/v1/schema/{conn_id}/layouts",
        json={
            "name": "开发视图",
            "is_default": True,
            "layout_data": {"users": {"x": 100, "y": 100}},
            "visible_tables": ["users", "orders"],
        },
    )
    assert created.status_code == 200
    layout = created.json()["data"]

    fetched = await client.get(f"/api/v1/schema/{conn_id}/layouts/{layout['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["data"]["name"] == "开发视图"

    updated = await client.put(
        f"/api/v1/schema/{conn_id}/layouts/{layout['id']}",
        json={
            "name": "分析视图",
            "layout_data": {"users": {"x": 120, "y": 160}},
            "visible_tables": ["users"],
            "is_default": True,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["name"] == "分析视图"

    deleted = await client.delete(f"/api/v1/schema/{conn_id}/layouts/{layout['id']}")
    assert deleted.status_code == 200
    layouts = (await client.get(f"/api/v1/schema/{conn_id}/layouts")).json()["data"]
    assert layouts == []


@pytest.mark.asyncio
async def test_schema_resources_not_found(client: AsyncClient):
    fake_id = str(uuid4())
    missing_connection = await client.get(f"/api/v1/schema/{fake_id}/relationships")
    assert missing_connection.status_code == 404

    missing_relationship = await client.put(
        f"/api/v1/schema/relationships/{fake_id}",
        json={"join_type": "INNER"},
    )
    assert missing_relationship.status_code == 404
