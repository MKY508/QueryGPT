"""Model configuration API tests"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_list_models_empty(client: AsyncClient):
    response = await client.get("/api/v1/config/models")
    assert response.status_code == 200
    assert response.json()["data"] == []


@pytest.mark.asyncio
async def test_create_model(client: AsyncClient):
    response = await client.post(
        "/api/v1/config/models",
        json={
            "name": "GPT-4",
            "provider": "openai",
            "model_id": "gpt-4",
            "api_key": "sk-test-key",
            "is_default": True,
        },
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["name"] == "GPT-4"
    assert data["provider"] == "openai"
    assert data["is_default"] is True


@pytest.mark.asyncio
async def test_update_model(client: AsyncClient):
    create_response = await client.post(
        "/api/v1/config/models",
        json={
            "name": "GPT-4",
            "provider": "openai",
            "model_id": "gpt-4",
        },
    )
    model_id = create_response.json()["data"]["id"]

    response = await client.put(
        f"/api/v1/config/models/{model_id}",
        json={
            "name": "GPT-4 Turbo",
            "provider": "openai",
            "model_id": "gpt-4-turbo",
            "is_default": True,
        },
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["name"] == "GPT-4 Turbo"
    assert data["model_id"] == "gpt-4-turbo"


@pytest.mark.asyncio
async def test_delete_model(client: AsyncClient):
    create_response = await client.post(
        "/api/v1/config/models",
        json={
            "name": "To Delete",
            "provider": "openai",
            "model_id": "gpt-4",
        },
    )
    model_id = create_response.json()["data"]["id"]

    response = await client.delete(f"/api/v1/config/models/{model_id}")
    assert response.status_code == 200

    list_response = await client.get("/api/v1/config/models")
    assert list_response.json()["data"] == []


@pytest.mark.asyncio
async def test_second_default_model_clears_previous_default(client: AsyncClient):
    first = await client.post(
        "/api/v1/config/models",
        json={
            "name": "Model 1",
            "provider": "openai",
            "model_id": "gpt-4o",
            "is_default": True,
        },
    )
    second = await client.post(
        "/api/v1/config/models",
        json={
            "name": "Model 2",
            "provider": "openai",
            "model_id": "gpt-4.1",
            "is_default": True,
        },
    )

    assert first.status_code == 200
    assert second.status_code == 200
    models = (await client.get("/api/v1/config/models")).json()["data"]
    defaults = [model for model in models if model["is_default"]]
    assert len(defaults) == 1
    assert defaults[0]["name"] == "Model 2"
