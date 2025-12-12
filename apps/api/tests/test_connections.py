"""Database Connection API tests"""

import pytest
from httpx import AsyncClient


async def get_auth_token(client: AsyncClient) -> str:
    """Helper to register and get auth token"""
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "conn_test@example.com",
            "password": "testpassword123",
            "display_name": "Connection Test User",
        },
    )
    return response.json()["data"]["access_token"]


@pytest.mark.asyncio
async def test_list_connections_empty(client: AsyncClient):
    """Test listing connections when none exist"""
    token = await get_auth_token(client)
    response = await client.get(
        "/api/v1/config/connections",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    # Note: May have demo connection created on registration
    assert isinstance(data["data"], list)


@pytest.mark.asyncio
async def test_create_connection_sqlite(client: AsyncClient):
    """Test creating a SQLite connection"""
    token = await get_auth_token(client)
    response = await client.post(
        "/api/v1/config/connections",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Test SQLite DB",
            "driver": "sqlite",
            "database_name": ":memory:",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["name"] == "Test SQLite DB"
    assert data["data"]["driver"] == "sqlite"
    assert "id" in data["data"]


@pytest.mark.asyncio
async def test_create_connection_mysql(client: AsyncClient):
    """Test creating a MySQL connection (without actual connection)"""
    token = await get_auth_token(client)
    response = await client.post(
        "/api/v1/config/connections",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Test MySQL DB",
            "driver": "mysql",
            "host": "localhost",
            "port": 3306,
            "username": "root",
            "password": "testpass",
            "database_name": "testdb",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["name"] == "Test MySQL DB"
    assert data["data"]["driver"] == "mysql"


@pytest.mark.asyncio
async def test_create_connection_postgresql(client: AsyncClient):
    """Test creating a PostgreSQL connection (without actual connection)"""
    token = await get_auth_token(client)
    response = await client.post(
        "/api/v1/config/connections",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Test PostgreSQL DB",
            "driver": "postgresql",
            "host": "localhost",
            "port": 5432,
            "username": "postgres",
            "password": "testpass",
            "database_name": "testdb",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["name"] == "Test PostgreSQL DB"
    assert data["data"]["driver"] == "postgresql"


@pytest.mark.asyncio
async def test_update_connection(client: AsyncClient):
    """Test updating a connection"""
    token = await get_auth_token(client)

    # Create connection first
    create_response = await client.post(
        "/api/v1/config/connections",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Original Name",
            "driver": "sqlite",
            "database_name": ":memory:",
        },
    )
    conn_id = create_response.json()["data"]["id"]

    # Update connection (must provide all required fields)
    response = await client.put(
        f"/api/v1/config/connections/{conn_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Updated Name",
            "driver": "sqlite",
            "database_name": ":memory:",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["name"] == "Updated Name"


@pytest.mark.asyncio
async def test_delete_connection(client: AsyncClient):
    """Test deleting a connection"""
    token = await get_auth_token(client)

    # Create connection first
    create_response = await client.post(
        "/api/v1/config/connections",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "To Delete",
            "driver": "sqlite",
            "database_name": ":memory:",
        },
    )
    conn_id = create_response.json()["data"]["id"]

    # Delete connection
    response = await client.delete(
        f"/api/v1/config/connections/{conn_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200

    # Verify deletion - should not find it in list
    list_response = await client.get(
        "/api/v1/config/connections",
        headers={"Authorization": f"Bearer {token}"},
    )
    connections = list_response.json()["data"]
    assert not any(c["id"] == conn_id for c in connections)


@pytest.mark.asyncio
async def test_set_default_connection(client: AsyncClient):
    """Test setting a connection as default"""
    token = await get_auth_token(client)

    # Create two connections
    resp1 = await client.post(
        "/api/v1/config/connections",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Connection 1",
            "driver": "sqlite",
            "database_name": ":memory:",
            "is_default": True,
        },
    )
    conn1_id = resp1.json()["data"]["id"]

    resp2 = await client.post(
        "/api/v1/config/connections",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Connection 2",
            "driver": "sqlite",
            "database_name": ":memory:",
            "is_default": True,
        },
    )
    conn2_id = resp2.json()["data"]["id"]

    # Verify only the second one is default
    list_response = await client.get(
        "/api/v1/config/connections",
        headers={"Authorization": f"Bearer {token}"},
    )
    connections = list_response.json()["data"]

    for conn in connections:
        if conn["id"] == conn2_id:
            assert conn["is_default"] is True
        elif conn["id"] == conn1_id:
            # First connection should no longer be default
            assert conn["is_default"] is False


@pytest.mark.asyncio
async def test_connection_not_found(client: AsyncClient):
    """Test accessing non-existent connection"""
    token = await get_auth_token(client)

    fake_id = "00000000-0000-0000-0000-000000000000"
    response = await client.put(
        f"/api/v1/config/connections/{fake_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "New Name",
            "driver": "sqlite",
            "database_name": ":memory:",
        },
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_connection_unauthorized(client: AsyncClient):
    """Test accessing connections without authentication"""
    response = await client.get("/api/v1/config/connections")
    assert response.status_code == 401
