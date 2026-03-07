"""Conversation history API tests"""

from uuid import uuid4

import pytest
from httpx import AsyncClient

from app.db.tables import Conversation, Message


async def seed_conversation(db_session, title: str = "Test Conversation") -> Conversation:
    conversation = Conversation(
        title=title,
        status="completed",
        extra_data={
            "model_name": "Test Model",
            "connection_name": "Demo DB",
            "provider_summary": "openai · openai_compatible",
            "context_rounds": 5,
        },
    )
    db_session.add(conversation)
    await db_session.flush()
    db_session.add_all(
        [
            Message(conversation_id=conversation.id, role="user", content="hello"),
            Message(conversation_id=conversation.id, role="assistant", content="world"),
        ]
    )
    await db_session.commit()
    await db_session.refresh(conversation)
    return conversation


@pytest.mark.asyncio
async def test_list_conversations_empty(client: AsyncClient):
    response = await client.get("/api/v1/conversations")
    assert response.status_code == 200
    assert response.json()["data"]["items"] == []


@pytest.mark.asyncio
async def test_list_conversations_with_pagination(client: AsyncClient, db_session):
    await seed_conversation(db_session, "Paged Conversation")
    response = await client.get("/api/v1/conversations", params={"limit": 10, "offset": 0})
    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data["items"]) == 1
    assert data["total"] == 1


@pytest.mark.asyncio
async def test_list_conversations_with_search(client: AsyncClient, db_session):
    await seed_conversation(db_session, "sales dashboard")
    response = await client.get("/api/v1/conversations", params={"q": "sales"})
    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data["items"]) == 1
    assert data["items"][0]["title"] == "sales dashboard"


@pytest.mark.asyncio
async def test_get_and_toggle_favorite_conversation(client: AsyncClient, db_session):
    conversation = await seed_conversation(db_session, "Favorite me")
    detail_response = await client.get(f"/api/v1/conversations/{conversation.id}")
    assert detail_response.status_code == 200
    assert len(detail_response.json()["data"]["messages"]) == 2

    favorite_response = await client.post(f"/api/v1/conversations/{conversation.id}/favorite")
    assert favorite_response.status_code == 200
    assert favorite_response.json()["data"]["is_favorite"] is True


@pytest.mark.asyncio
async def test_delete_conversation(client: AsyncClient, db_session):
    conversation = await seed_conversation(db_session, "Delete me")
    response = await client.delete(f"/api/v1/conversations/{conversation.id}")
    assert response.status_code == 200

    not_found = await client.get(f"/api/v1/conversations/{conversation.id}")
    assert not_found.status_code == 404


@pytest.mark.asyncio
async def test_conversation_not_found(client: AsyncClient):
    fake_id = uuid4()
    response = await client.get(f"/api/v1/conversations/{fake_id}")
    assert response.status_code == 404
