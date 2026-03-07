"""Tests for prompts API"""

from uuid import uuid4

import pytest
from httpx import AsyncClient


async def create_prompt(client: AsyncClient, name: str = "Test Prompt", content: str = "You are helpful.") -> dict:
    response = await client.post(
        "/api/v1/prompts",
        json={
            "name": name,
            "content": content,
        },
    )
    assert response.status_code == 200
    return response.json()["data"]


async def test_list_prompts_empty(client: AsyncClient):
    response = await client.get("/api/v1/prompts")
    assert response.status_code == 200
    assert response.json()["data"]["items"] == []
    assert response.json()["data"]["total"] == 0


async def test_create_prompt(client: AsyncClient):
    response = await client.post(
        "/api/v1/prompts",
        json={
            "name": "Test Prompt",
            "content": "You are a helpful assistant.",
            "description": "A test prompt",
            "is_default": True,
        },
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["name"] == "Test Prompt"
    assert data["is_default"] is True
    assert data["version"] == 1


async def test_update_prompt_creates_new_version(client: AsyncClient):
    created = await create_prompt(client, "Version Test", "Version 1")
    response = await client.put(
        f"/api/v1/prompts/{created['id']}",
        json={"content": "Version 2"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["version"] == 2
    assert data["content"] == "Version 2"
    assert data["parent_id"] == created["id"]


async def test_set_default_prompt(client: AsyncClient):
    first = await client.post(
        "/api/v1/prompts",
        json={"name": "Prompt 1", "content": "Content 1", "is_default": True},
    )
    second = await client.post(
        "/api/v1/prompts",
        json={"name": "Prompt 2", "content": "Content 2"},
    )
    second_id = second.json()["data"]["id"]
    first_id = first.json()["data"]["id"]

    response = await client.post(f"/api/v1/prompts/{second_id}/set-default")
    assert response.status_code == 200
    assert response.json()["data"]["is_default"] is True

    first_detail = await client.get(f"/api/v1/prompts/{first_id}")
    assert first_detail.json()["data"]["is_default"] is False


async def test_get_versions_and_rollback(client: AsyncClient):
    created = await create_prompt(client, "Rollback Test", "Original content")
    updated = await client.put(
        f"/api/v1/prompts/{created['id']}",
        json={"content": "Updated content"},
    )
    updated_id = updated.json()["data"]["id"]

    versions = await client.get(f"/api/v1/prompts/{updated_id}/versions")
    assert versions.status_code == 200
    assert len(versions.json()["data"]) >= 2

    rollback = await client.post(f"/api/v1/prompts/{updated_id}/rollback/1")
    assert rollback.status_code == 200
    assert rollback.json()["data"]["content"] == "Original content"
    assert rollback.json()["data"]["version"] == 3


async def test_prompt_delete_and_not_found(client: AsyncClient):
    created = await create_prompt(client, "Delete Test", "To be deleted")
    deleted = await client.delete(f"/api/v1/prompts/{created['id']}")
    assert deleted.status_code == 200

    get_response = await client.get(f"/api/v1/prompts/{created['id']}")
    assert get_response.status_code == 404

    missing_response = await client.get(f"/api/v1/prompts/{uuid4()}")
    assert missing_response.status_code == 404
