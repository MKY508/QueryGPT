"""Conversation History API tests"""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import Conversation, Message


async def get_auth_token(client: AsyncClient) -> str:
    """Helper to register and get auth token"""
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "history_test@example.com",
            "password": "testpassword123",
            "display_name": "History Test User",
        },
    )
    return response.json()["data"]["access_token"]


async def create_test_conversation(
    client: AsyncClient, token: str, title: str = "Test Conversation"
) -> str:
    """Helper to create a test conversation via direct DB access is not possible,
    so we'll test the list endpoint behavior"""
    # Note: In a real scenario, conversations are created through the chat endpoint
    # For testing purposes, we'll test the API behavior with empty/existing data
    pass


@pytest.mark.asyncio
async def test_list_conversations_empty(client: AsyncClient):
    """Test listing conversations when none exist"""
    token = await get_auth_token(client)
    response = await client.get(
        "/api/v1/conversations",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    # API returns PaginatedResponse with items, total, etc.
    assert "items" in data["data"]
    assert isinstance(data["data"]["items"], list)


@pytest.mark.asyncio
async def test_list_conversations_with_pagination(client: AsyncClient):
    """Test listing conversations with pagination parameters"""
    token = await get_auth_token(client)
    response = await client.get(
        "/api/v1/conversations",
        headers={"Authorization": f"Bearer {token}"},
        params={"limit": 10, "offset": 0},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "items" in data["data"]
    assert isinstance(data["data"]["items"], list)
    assert "total" in data["data"]


@pytest.mark.asyncio
async def test_list_conversations_with_search(client: AsyncClient):
    """Test listing conversations with search filter"""
    token = await get_auth_token(client)
    response = await client.get(
        "/api/v1/conversations",
        headers={"Authorization": f"Bearer {token}"},
        params={"q": "test query"},  # API uses 'q' not 'search'
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "items" in data["data"]
    assert isinstance(data["data"]["items"], list)


@pytest.mark.asyncio
async def test_list_conversations_favorites_only(client: AsyncClient):
    """Test listing only favorite conversations"""
    token = await get_auth_token(client)
    response = await client.get(
        "/api/v1/conversations",
        headers={"Authorization": f"Bearer {token}"},
        params={"favorites": True},  # API uses 'favorites' not 'favorites_only'
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "items" in data["data"]
    assert isinstance(data["data"]["items"], list)


@pytest.mark.asyncio
async def test_get_conversation_not_found(client: AsyncClient):
    """Test getting a non-existent conversation"""
    token = await get_auth_token(client)
    fake_id = "00000000-0000-0000-0000-000000000000"
    response = await client.get(
        f"/api/v1/conversations/{fake_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_delete_conversation_not_found(client: AsyncClient):
    """Test deleting a non-existent conversation"""
    token = await get_auth_token(client)
    fake_id = "00000000-0000-0000-0000-000000000000"
    response = await client.delete(
        f"/api/v1/conversations/{fake_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_toggle_favorite_not_found(client: AsyncClient):
    """Test toggling favorite on non-existent conversation"""
    token = await get_auth_token(client)
    fake_id = "00000000-0000-0000-0000-000000000000"
    response = await client.post(
        f"/api/v1/conversations/{fake_id}/favorite",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_conversations_unauthorized(client: AsyncClient):
    """Test accessing conversations without authentication"""
    response = await client.get("/api/v1/conversations")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_conversation_detail_unauthorized(client: AsyncClient):
    """Test accessing conversation detail without authentication"""
    fake_id = "00000000-0000-0000-0000-000000000000"
    response = await client.get(f"/api/v1/conversations/{fake_id}")
    assert response.status_code == 401
