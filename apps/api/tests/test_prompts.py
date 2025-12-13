"""Tests for prompts API"""

import pytest
from httpx import AsyncClient


@pytest.fixture
async def auth_token(client: AsyncClient):
    """Create a user and get auth token"""
    # Register
    await client.post(
        "/api/v1/auth/register",
        json={
            "email": "prompt_test@example.com",
            "password": "testpassword123",
            "display_name": "Prompt Tester",
        },
    )
    # Login
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": "prompt_test@example.com", "password": "testpassword123"},
    )
    return response.json()["data"]["access_token"]


@pytest.fixture
def auth_headers(auth_token):
    """Auth headers fixture"""
    return {"Authorization": f"Bearer {auth_token}"}


async def test_list_prompts_empty(client: AsyncClient, auth_headers):
    """Test listing prompts when empty"""
    response = await client.get("/api/v1/prompts", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["items"] == []
    assert data["data"]["total"] == 0


async def test_create_prompt(client: AsyncClient, auth_headers):
    """Test creating a prompt"""
    response = await client.post(
        "/api/v1/prompts",
        headers=auth_headers,
        json={
            "name": "Test Prompt",
            "content": "You are a helpful assistant.",
            "description": "A test prompt",
            "is_default": True,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["name"] == "Test Prompt"
    assert data["data"]["content"] == "You are a helpful assistant."
    assert data["data"]["is_default"] is True
    assert data["data"]["version"] == 1


async def test_get_prompt(client: AsyncClient, auth_headers):
    """Test getting a prompt by ID"""
    # Create first
    create_response = await client.post(
        "/api/v1/prompts",
        headers=auth_headers,
        json={"name": "Get Test", "content": "Test content"},
    )
    prompt_id = create_response.json()["data"]["id"]

    # Get
    response = await client.get(f"/api/v1/prompts/{prompt_id}", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["data"]["name"] == "Get Test"


async def test_update_prompt_creates_new_version(client: AsyncClient, auth_headers):
    """Test updating a prompt creates a new version"""
    # Create
    create_response = await client.post(
        "/api/v1/prompts",
        headers=auth_headers,
        json={"name": "Version Test", "content": "Version 1 content"},
    )
    prompt_id = create_response.json()["data"]["id"]

    # Update
    response = await client.put(
        f"/api/v1/prompts/{prompt_id}",
        headers=auth_headers,
        json={"content": "Version 2 content"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["data"]["version"] == 2
    assert data["data"]["content"] == "Version 2 content"
    # New ID (new record)
    assert data["data"]["id"] != prompt_id
    # Parent ID points to old version
    assert data["data"]["parent_id"] == prompt_id


async def test_delete_prompt(client: AsyncClient, auth_headers):
    """Test deleting a prompt"""
    # Create
    create_response = await client.post(
        "/api/v1/prompts",
        headers=auth_headers,
        json={"name": "Delete Test", "content": "To be deleted"},
    )
    prompt_id = create_response.json()["data"]["id"]

    # Delete
    response = await client.delete(f"/api/v1/prompts/{prompt_id}", headers=auth_headers)
    assert response.status_code == 200

    # Verify deleted
    get_response = await client.get(f"/api/v1/prompts/{prompt_id}", headers=auth_headers)
    assert get_response.status_code == 404


async def test_set_default_prompt(client: AsyncClient, auth_headers):
    """Test setting a prompt as default"""
    # Create two prompts
    response1 = await client.post(
        "/api/v1/prompts",
        headers=auth_headers,
        json={"name": "Prompt 1", "content": "Content 1", "is_default": True},
    )
    prompt1_id = response1.json()["data"]["id"]

    response2 = await client.post(
        "/api/v1/prompts",
        headers=auth_headers,
        json={"name": "Prompt 2", "content": "Content 2"},
    )
    prompt2_id = response2.json()["data"]["id"]

    # Set prompt 2 as default
    response = await client.post(f"/api/v1/prompts/{prompt2_id}/set-default", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["data"]["is_default"] is True

    # Verify prompt 1 is no longer default
    get_response = await client.get(f"/api/v1/prompts/{prompt1_id}", headers=auth_headers)
    assert get_response.json()["data"]["is_default"] is False


async def test_get_prompt_versions(client: AsyncClient, auth_headers):
    """Test getting prompt version history"""
    # Create and update
    create_response = await client.post(
        "/api/v1/prompts",
        headers=auth_headers,
        json={"name": "Versions Test", "content": "V1"},
    )
    prompt_id = create_response.json()["data"]["id"]

    update_response = await client.put(
        f"/api/v1/prompts/{prompt_id}",
        headers=auth_headers,
        json={"content": "V2"},
    )
    new_prompt_id = update_response.json()["data"]["id"]

    # Get versions
    response = await client.get(f"/api/v1/prompts/{new_prompt_id}/versions", headers=auth_headers)
    assert response.status_code == 200
    versions = response.json()["data"]
    assert len(versions) >= 2


async def test_rollback_prompt(client: AsyncClient, auth_headers):
    """Test rolling back to a previous version"""
    # Create
    create_response = await client.post(
        "/api/v1/prompts",
        headers=auth_headers,
        json={"name": "Rollback Test", "content": "Original content"},
    )
    prompt_id = create_response.json()["data"]["id"]

    # Update
    update_response = await client.put(
        f"/api/v1/prompts/{prompt_id}",
        headers=auth_headers,
        json={"content": "Updated content"},
    )
    new_prompt_id = update_response.json()["data"]["id"]

    # Rollback to version 1
    response = await client.post(
        f"/api/v1/prompts/{new_prompt_id}/rollback/1", headers=auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert data["data"]["content"] == "Original content"
    assert data["data"]["version"] == 3  # New version created


async def test_prompt_not_found(client: AsyncClient, auth_headers):
    """Test 404 for non-existent prompt"""
    response = await client.get(
        "/api/v1/prompts/00000000-0000-0000-0000-000000000000",
        headers=auth_headers,
    )
    assert response.status_code == 404


async def test_prompt_unauthorized(client: AsyncClient):
    """Test unauthorized access"""
    response = await client.get("/api/v1/prompts")
    assert response.status_code == 401
