"""Schema and Table Relationship API tests"""

import pytest
from httpx import AsyncClient


async def get_auth_token_and_connection(client: AsyncClient) -> tuple[str, str]:
    """Helper to register, get auth token, and create a connection"""
    # Register user
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "schema_test@example.com",
            "password": "testpassword123",
            "display_name": "Schema Test User",
        },
    )
    token = response.json()["data"]["access_token"]

    # Create a connection
    conn_response = await client.post(
        "/api/v1/config/connections",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Test DB",
            "driver": "sqlite",
            "database_name": ":memory:",
        },
    )
    conn_id = conn_response.json()["data"]["id"]

    return token, conn_id


@pytest.mark.asyncio
async def test_create_relationship(client: AsyncClient):
    """Test creating a table relationship"""
    token, conn_id = await get_auth_token_and_connection(client)

    response = await client.post(
        f"/api/v1/schema/{conn_id}/relationships",
        headers={"Authorization": f"Bearer {token}"},
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
    data = response.json()
    assert data["success"] is True
    assert data["data"]["source_table"] == "orders"
    assert data["data"]["target_table"] == "customers"
    assert data["data"]["relationship_type"] == "N:1"
    assert "id" in data["data"]


@pytest.mark.asyncio
async def test_list_relationships(client: AsyncClient):
    """Test listing table relationships"""
    token, conn_id = await get_auth_token_and_connection(client)

    # Create a relationship first
    await client.post(
        f"/api/v1/schema/{conn_id}/relationships",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "source_table": "items",
            "source_column": "order_id",
            "target_table": "orders",
            "target_column": "id",
            "relationship_type": "N:1",
            "join_type": "INNER",
        },
    )

    # List relationships
    response = await client.get(
        f"/api/v1/schema/{conn_id}/relationships",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert isinstance(data["data"], list)
    assert len(data["data"]) >= 1


@pytest.mark.asyncio
async def test_batch_create_relationships(client: AsyncClient):
    """Test batch creating table relationships"""
    token, conn_id = await get_auth_token_and_connection(client)

    response = await client.post(
        f"/api/v1/schema/{conn_id}/relationships/batch",
        headers={"Authorization": f"Bearer {token}"},
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
    data = response.json()
    assert data["success"] is True
    assert isinstance(data["data"], list)
    assert len(data["data"]) == 2


@pytest.mark.asyncio
async def test_update_relationship(client: AsyncClient):
    """Test updating a table relationship"""
    token, conn_id = await get_auth_token_and_connection(client)

    # Create relationship first
    create_response = await client.post(
        f"/api/v1/schema/{conn_id}/relationships",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "source_table": "payments",
            "source_column": "order_id",
            "target_table": "orders",
            "target_column": "id",
            "relationship_type": "1:1",
            "join_type": "LEFT",
        },
    )
    rel_id = create_response.json()["data"]["id"]

    # Update relationship
    response = await client.put(
        f"/api/v1/schema/relationships/{rel_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "relationship_type": "N:1",
            "join_type": "INNER",
            "description": "更新后的描述",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["relationship_type"] == "N:1"
    assert data["data"]["join_type"] == "INNER"


@pytest.mark.asyncio
async def test_delete_relationship(client: AsyncClient):
    """Test deleting a table relationship"""
    token, conn_id = await get_auth_token_and_connection(client)

    # Create relationship first
    create_response = await client.post(
        f"/api/v1/schema/{conn_id}/relationships",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "source_table": "logs",
            "source_column": "user_id",
            "target_table": "users",
            "target_column": "id",
            "relationship_type": "N:1",
            "join_type": "LEFT",
        },
    )
    rel_id = create_response.json()["data"]["id"]

    # Delete relationship
    response = await client.delete(
        f"/api/v1/schema/relationships/{rel_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200

    # Verify deletion
    list_response = await client.get(
        f"/api/v1/schema/{conn_id}/relationships",
        headers={"Authorization": f"Bearer {token}"},
    )
    relationships = list_response.json()["data"]
    assert not any(r["id"] == rel_id for r in relationships)


@pytest.mark.asyncio
async def test_list_layouts(client: AsyncClient):
    """Test listing schema layouts"""
    token, conn_id = await get_auth_token_and_connection(client)

    response = await client.get(
        f"/api/v1/schema/{conn_id}/layouts",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert isinstance(data["data"], list)


@pytest.mark.asyncio
async def test_create_layout(client: AsyncClient):
    """Test creating a schema layout"""
    token, conn_id = await get_auth_token_and_connection(client)

    response = await client.post(
        f"/api/v1/schema/{conn_id}/layouts",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "开发视图",
            "is_default": True,
            "layout_data": {
                "users": {"x": 100, "y": 100},
                "orders": {"x": 300, "y": 100},
            },
            "visible_tables": ["users", "orders", "products"],
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["name"] == "开发视图"
    assert data["data"]["is_default"] is True
    assert "id" in data["data"]


@pytest.mark.asyncio
async def test_get_layout(client: AsyncClient):
    """Test getting a single layout"""
    token, conn_id = await get_auth_token_and_connection(client)

    # Create layout first
    create_response = await client.post(
        f"/api/v1/schema/{conn_id}/layouts",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "测试布局",
            "is_default": False,
        },
    )
    layout_id = create_response.json()["data"]["id"]

    # Get layout
    response = await client.get(
        f"/api/v1/schema/{conn_id}/layouts/{layout_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["name"] == "测试布局"


@pytest.mark.asyncio
async def test_update_layout(client: AsyncClient):
    """Test updating a schema layout"""
    token, conn_id = await get_auth_token_and_connection(client)

    # Create layout first
    create_response = await client.post(
        f"/api/v1/schema/{conn_id}/layouts",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "原始布局",
            "is_default": False,
        },
    )
    layout_id = create_response.json()["data"]["id"]

    # Update layout
    response = await client.put(
        f"/api/v1/schema/{conn_id}/layouts/{layout_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "更新后布局",
            "layout_data": {"table1": {"x": 200, "y": 200}},
            "zoom": 1.5,
            "viewport_x": 100,
            "viewport_y": 50,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["name"] == "更新后布局"


@pytest.mark.asyncio
async def test_delete_layout(client: AsyncClient):
    """Test deleting a schema layout"""
    token, conn_id = await get_auth_token_and_connection(client)

    # Create layout first
    create_response = await client.post(
        f"/api/v1/schema/{conn_id}/layouts",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "待删除布局",
            "is_default": False,
        },
    )
    layout_id = create_response.json()["data"]["id"]

    # Delete layout
    response = await client.delete(
        f"/api/v1/schema/{conn_id}/layouts/{layout_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200

    # Verify deletion
    list_response = await client.get(
        f"/api/v1/schema/{conn_id}/layouts",
        headers={"Authorization": f"Bearer {token}"},
    )
    layouts = list_response.json()["data"]
    assert not any(l["id"] == layout_id for l in layouts)


@pytest.mark.asyncio
async def test_duplicate_layout(client: AsyncClient):
    """Test duplicating a schema layout"""
    token, conn_id = await get_auth_token_and_connection(client)

    # Create layout first
    create_response = await client.post(
        f"/api/v1/schema/{conn_id}/layouts",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "原始布局",
            "is_default": True,
            "layout_data": {"table1": {"x": 100, "y": 100}},
        },
    )
    layout_id = create_response.json()["data"]["id"]

    # Duplicate layout
    response = await client.post(
        f"/api/v1/schema/{conn_id}/layouts/{layout_id}/duplicate",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    # Duplicated layout should have different id
    assert data["data"]["id"] != layout_id
    # Duplicated layout should not be default
    assert data["data"]["is_default"] is False


@pytest.mark.asyncio
async def test_relationship_unauthorized(client: AsyncClient):
    """Test accessing relationships without authentication"""
    fake_conn_id = "00000000-0000-0000-0000-000000000000"
    response = await client.get(f"/api/v1/schema/{fake_conn_id}/relationships")
    assert response.status_code == 401
