"""Config export/import API tests"""

import pytest
from httpx import AsyncClient


async def create_connection(client: AsyncClient, name: str = "Export Test DB") -> str:
    response = await client.post(
        "/api/v1/config/connections",
        json={
            "name": name,
            "driver": "sqlite",
            "database": ":memory:",
        },
    )
    assert response.status_code == 200
    return response.json()["data"]["id"]


@pytest.mark.asyncio
async def test_export_config_empty(client: AsyncClient):
    conn_id = await create_connection(client)
    response = await client.get(f"/api/v1/config/connections/{conn_id}/export")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["version"] == "1.0"
    assert data["connection"]["name"] == "Export Test DB"
    assert data["relationships"] == []
    assert data["layouts"] == []


@pytest.mark.asyncio
async def test_export_download(client: AsyncClient):
    conn_id = await create_connection(client)
    response = await client.get(f"/api/v1/config/connections/{conn_id}/export/download")
    assert response.status_code == 200
    assert "attachment" in response.headers.get("content-disposition", "")
    assert "application/json" in response.headers.get("content-type", "")


@pytest.mark.asyncio
async def test_import_preview_and_merge(client: AsyncClient):
    conn_id = await create_connection(client)
    import_data = {
        "config": {
            "version": "1.0",
            "connection": {"name": "Test DB", "driver": "sqlite"},
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

    preview = await client.post(f"/api/v1/config/connections/{conn_id}/import/preview", json=import_data)
    assert preview.status_code == 200
    assert preview.json()["data"]["total"] == 2

    imported = await client.post(f"/api/v1/config/connections/{conn_id}/import", json=import_data)
    assert imported.status_code == 200
    assert imported.json()["data"]["created"] >= 2

    relationships = (await client.get(f"/api/v1/schema/{conn_id}/relationships")).json()["data"]
    assert any(item["source_table"] == "items" for item in relationships)


@pytest.mark.asyncio
async def test_import_replace_mode(client: AsyncClient):
    conn_id = await create_connection(client)
    await client.post(
        f"/api/v1/schema/{conn_id}/relationships",
        json={
            "source_table": "old_table",
            "source_column": "old_col",
            "target_table": "old_target",
            "target_column": "id",
            "relationship_type": "N:1",
            "join_type": "LEFT",
        },
    )

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

    response = await client.post(f"/api/v1/config/connections/{conn_id}/import", json=import_data)
    assert response.status_code == 200
    relationships = (await client.get(f"/api/v1/schema/{conn_id}/relationships")).json()["data"]
    assert not any(item["source_table"] == "old_table" for item in relationships)
    assert any(item["source_table"] == "new_table" for item in relationships)


@pytest.mark.asyncio
async def test_export_not_found(client: AsyncClient):
    fake_id = "00000000-0000-0000-0000-000000000000"
    response = await client.get(f"/api/v1/config/connections/{fake_id}/export")
    assert response.status_code == 404
