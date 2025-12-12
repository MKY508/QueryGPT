"""Model configuration API tests"""
import pytest
from httpx import AsyncClient


async def get_auth_token(client: AsyncClient) -> str:
    """Helper to register and get auth token"""
    await client.post(
        "/api/v1/auth/register",
        json={"email": "model@example.com", "password": "testpassword123"},
    )
    response = await client.post(
        "/api/v1/auth/login",
        data={"username": "model@example.com", "password": "testpassword123"},
    )
    return response.json()["access_token"]


@pytest.mark.asyncio
async def test_list_models_empty(client: AsyncClient):
    """Test listing models when none exist"""
    token = await get_auth_token(client)
    response = await client.get(
        "/api/v1/config/models",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 0
    assert data["data"] == []


@pytest.mark.asyncio
async def test_create_model(client: AsyncClient):
    """Test creating a model configuration"""
    token = await get_auth_token(client)
    response = await client.post(
        "/api/v1/config/models",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "GPT-4",
            "provider": "openai",
            "model_id": "gpt-4",
            "api_key": "sk-test-key",
            "is_default": True,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 0
    assert data["data"]["name"] == "GPT-4"
    assert data["data"]["provider"] == "openai"
    assert data["data"]["is_default"] is True


@pytest.mark.asyncio
async def test_update_model(client: AsyncClient):
    """Test updating a model configuration"""
    token = await get_auth_token(client)
    # Create model
    create_response = await client.post(
        "/api/v1/config/models",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "GPT-4",
            "provider": "openai",
            "model_id": "gpt-4",
        },
    )
    model_id = create_response.json()["data"]["id"]

    # Update model
    response = await client.put(
        f"/api/v1/config/models/{model_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "GPT-4 Turbo",
            "provider": "openai",
            "model_id": "gpt-4-turbo",
            "is_default": True,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["data"]["name"] == "GPT-4 Turbo"
    assert data["data"]["model_id"] == "gpt-4-turbo"


@pytest.mark.asyncio
async def test_delete_model(client: AsyncClient):
    """Test deleting a model configuration"""
    token = await get_auth_token(client)
    # Create model
    create_response = await client.post(
        "/api/v1/config/models",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "To Delete",
            "provider": "openai",
            "model_id": "gpt-4",
        },
    )
    model_id = create_response.json()["data"]["id"]

    # Delete model
    response = await client.delete(
        f"/api/v1/config/models/{model_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200

    # Verify deleted
    list_response = await client.get(
        "/api/v1/config/models",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert len(list_response.json()["data"]) == 0
