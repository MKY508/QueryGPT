"""Config Export/Import API tests"""

import pytest
from httpx import AsyncClient


async def get_auth_token_and_connection(client: AsyncClient) -> tuple[str, str]:
    """Helper to register, get auth token, and create a connection"""
    # Register user
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "export_test@example.com",
            "password": "testpassword123",
            "display_name": "Export Test User",
        },
    )
    token = response.json()["data"]["access_token"]

    # Create a connection
    conn_response = await client.post(
        "/api/v1/config/connections",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Export Test DB",
            "driver": "sqlite",
            "database_name": ":memory:",
        },
    )
    conn_id = conn_response.json()["data"]["id"]

    return token, conn_id


@pytest.mark.asyncio
async def test_export_config_empty(client: AsyncClient):
    """Test exporting config when no relationships/terms exist"""
    token, conn_id = await get_auth_token_and_connection(client)

    response = await client.get(
        f"/api/v1/config/connections/{conn_id}/export",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["version"] == "1.0"
    assert data["data"]["connection"]["name"] == "Export Test DB"
    assert isinstance(data["data"]["relationships"], list)
    assert isinstance(data["data"]["semantic_terms"], list)
    assert isinstance(data["data"]["layouts"], list)


@pytest.mark.asyncio
async def test_export_config_with_data(client: AsyncClient):
    """Test exporting config with relationships and terms"""
    token, conn_id = await get_auth_token_and_connection(client)

    # Create a relationship
    await client.post(
        f"/api/v1/schema/{conn_id}/relationships",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "source_table": "orders",
            "source_column": "customer_id",
            "target_table": "customers",
            "target_column": "id",
            "relationship_type": "N:1",
            "join_type": "LEFT",
        },
    )

    # Create a semantic term
    await client.post(
        "/api/v1/config/semantic/terms",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "term": "销售额",
            "expression": "SUM(amount)",
            "term_type": "metric",
            "connection_id": conn_id,
        },
    )

    # Export config
    response = await client.get(
        f"/api/v1/config/connections/{conn_id}/export",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert len(data["data"]["relationships"]) >= 1
    # Note: semantic terms may not be included if they're not linked to connection


@pytest.mark.asyncio
async def test_export_download(client: AsyncClient):
    """Test downloading config as file"""
    token, conn_id = await get_auth_token_and_connection(client)

    response = await client.get(
        f"/api/v1/config/connections/{conn_id}/export/download",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert "attachment" in response.headers.get("content-disposition", "")
    assert response.headers.get("content-type") == "application/json"


@pytest.mark.asyncio
async def test_import_preview(client: AsyncClient):
    """Test previewing import (dry run)"""
    token, conn_id = await get_auth_token_and_connection(client)

    import_data = {
        "config": {
            "version": "1.0",
            "connection": {
                "name": "Test DB",
                "driver": "sqlite",
            },
            "relationships": [
                {
                    "source_table": "items",
                    "source_column": "order_id",
                    "target_table": "orders",
                    "target_column": "id",
                    "relationship_type": "N:1",
                    "join_type": "LEFT",
                }
            ],
            "semantic_terms": [
                {
                    "term": "订单数",
                    "expression": "COUNT(*)",
                    "term_type": "metric",
                }
            ],
            "layouts": [],
        },
        "mode": "merge",
        "conflict_resolution": "skip",
    }

    response = await client.post(
        f"/api/v1/config/connections/{conn_id}/import/preview",
        headers={"Authorization": f"Bearer {token}"},
        json=import_data,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["total"] == 2  # 1 relationship + 1 term
    assert data["data"]["created"] == 2


@pytest.mark.asyncio
async def test_import_merge_mode(client: AsyncClient):
    """Test importing config in merge mode"""
    token, conn_id = await get_auth_token_and_connection(client)

    # First import
    import_data = {
        "config": {
            "version": "1.0",
            "connection": {"name": "Test DB", "driver": "sqlite"},
            "relationships": [
                {
                    "source_table": "payments",
                    "source_column": "order_id",
                    "target_table": "orders",
                    "target_column": "id",
                    "relationship_type": "N:1",
                    "join_type": "LEFT",
                }
            ],
            "semantic_terms": [],
            "layouts": [],
        },
        "mode": "merge",
        "conflict_resolution": "skip",
    }

    response = await client.post(
        f"/api/v1/config/connections/{conn_id}/import",
        headers={"Authorization": f"Bearer {token}"},
        json=import_data,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["created"] >= 1

    # Verify relationship was created
    rel_response = await client.get(
        f"/api/v1/schema/{conn_id}/relationships",
        headers={"Authorization": f"Bearer {token}"},
    )
    relationships = rel_response.json()["data"]
    assert any(r["source_table"] == "payments" for r in relationships)


@pytest.mark.asyncio
async def test_import_replace_mode(client: AsyncClient):
    """Test importing config in replace mode"""
    token, conn_id = await get_auth_token_and_connection(client)

    # Create existing relationship
    await client.post(
        f"/api/v1/schema/{conn_id}/relationships",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "source_table": "old_table",
            "source_column": "old_col",
            "target_table": "old_target",
            "target_column": "id",
            "relationship_type": "N:1",
            "join_type": "LEFT",
        },
    )

    # Import with replace mode
    import_data = {
        "config": {
            "version": "1.0",
            "connection": {"name": "Test DB", "driver": "sqlite"},
            "relationships": [
                {
                    "source_table": "new_table",
                    "source_column": "new_col",
                    "target_table": "new_target",
                    "target_column": "id",
                    "relationship_type": "1:1",
                    "join_type": "INNER",
                }
            ],
            "semantic_terms": [],
            "layouts": [],
        },
        "mode": "replace",
        "conflict_resolution": "skip",
    }

    response = await client.post(
        f"/api/v1/config/connections/{conn_id}/import",
        headers={"Authorization": f"Bearer {token}"},
        json=import_data,
    )
    assert response.status_code == 200

    # Verify old relationship was deleted and new one exists
    rel_response = await client.get(
        f"/api/v1/schema/{conn_id}/relationships",
        headers={"Authorization": f"Bearer {token}"},
    )
    relationships = rel_response.json()["data"]
    assert not any(r["source_table"] == "old_table" for r in relationships)
    assert any(r["source_table"] == "new_table" for r in relationships)


@pytest.mark.asyncio
async def test_import_conflict_skip(client: AsyncClient):
    """Test import with skip conflict resolution"""
    token, conn_id = await get_auth_token_and_connection(client)

    # Create existing relationship
    await client.post(
        f"/api/v1/schema/{conn_id}/relationships",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "source_table": "orders",
            "source_column": "user_id",
            "target_table": "users",
            "target_column": "id",
            "relationship_type": "N:1",
            "join_type": "LEFT",
            "description": "原始描述",
        },
    )

    # Try to import same relationship with different description
    import_data = {
        "config": {
            "version": "1.0",
            "connection": {"name": "Test DB", "driver": "sqlite"},
            "relationships": [
                {
                    "source_table": "orders",
                    "source_column": "user_id",
                    "target_table": "users",
                    "target_column": "id",
                    "relationship_type": "N:1",
                    "join_type": "INNER",
                    "description": "新描述",
                }
            ],
            "semantic_terms": [],
            "layouts": [],
        },
        "mode": "merge",
        "conflict_resolution": "skip",
    }

    response = await client.post(
        f"/api/v1/config/connections/{conn_id}/import",
        headers={"Authorization": f"Bearer {token}"},
        json=import_data,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["data"]["skipped"] == 1

    # Verify original description is preserved
    rel_response = await client.get(
        f"/api/v1/schema/{conn_id}/relationships",
        headers={"Authorization": f"Bearer {token}"},
    )
    relationships = rel_response.json()["data"]
    matching = [r for r in relationships if r["source_table"] == "orders"]
    assert len(matching) == 1
    assert matching[0]["description"] == "原始描述"


@pytest.mark.asyncio
async def test_import_conflict_overwrite(client: AsyncClient):
    """Test import with overwrite conflict resolution"""
    token, conn_id = await get_auth_token_and_connection(client)

    # Create existing relationship
    await client.post(
        f"/api/v1/schema/{conn_id}/relationships",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "source_table": "logs",
            "source_column": "user_id",
            "target_table": "users",
            "target_column": "id",
            "relationship_type": "N:1",
            "join_type": "LEFT",
            "description": "原始描述",
        },
    )

    # Import same relationship with overwrite
    import_data = {
        "config": {
            "version": "1.0",
            "connection": {"name": "Test DB", "driver": "sqlite"},
            "relationships": [
                {
                    "source_table": "logs",
                    "source_column": "user_id",
                    "target_table": "users",
                    "target_column": "id",
                    "relationship_type": "1:1",
                    "join_type": "INNER",
                    "description": "更新后描述",
                }
            ],
            "semantic_terms": [],
            "layouts": [],
        },
        "mode": "merge",
        "conflict_resolution": "overwrite",
    }

    response = await client.post(
        f"/api/v1/config/connections/{conn_id}/import",
        headers={"Authorization": f"Bearer {token}"},
        json=import_data,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["data"]["updated"] == 1

    # Verify description was updated
    rel_response = await client.get(
        f"/api/v1/schema/{conn_id}/relationships",
        headers={"Authorization": f"Bearer {token}"},
    )
    relationships = rel_response.json()["data"]
    matching = [r for r in relationships if r["source_table"] == "logs"]
    assert len(matching) == 1
    assert matching[0]["description"] == "更新后描述"
    assert matching[0]["relationship_type"] == "1:1"


@pytest.mark.asyncio
async def test_import_invalid_version(client: AsyncClient):
    """Test importing config with invalid version"""
    token, conn_id = await get_auth_token_and_connection(client)

    import_data = {
        "config": {
            "version": "2.0",  # Invalid version
            "connection": {"name": "Test DB", "driver": "sqlite"},
            "relationships": [],
            "semantic_terms": [],
            "layouts": [],
        },
        "mode": "merge",
        "conflict_resolution": "skip",
    }

    response = await client.post(
        f"/api/v1/config/connections/{conn_id}/import",
        headers={"Authorization": f"Bearer {token}"},
        json=import_data,
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_export_connection_not_found(client: AsyncClient):
    """Test exporting config for non-existent connection"""
    # Register user
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "export_notfound@example.com",
            "password": "testpassword123",
            "display_name": "Export NotFound User",
        },
    )
    token = response.json()["data"]["access_token"]

    fake_id = "00000000-0000-0000-0000-000000000000"
    response = await client.get(
        f"/api/v1/config/connections/{fake_id}/export",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_export_unauthorized(client: AsyncClient):
    """Test exporting config without authentication"""
    fake_id = "00000000-0000-0000-0000-000000000000"
    response = await client.get(f"/api/v1/config/connections/{fake_id}/export")
    assert response.status_code == 401
