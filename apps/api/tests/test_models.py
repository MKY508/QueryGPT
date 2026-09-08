"""Model configuration API tests"""

from contextlib import nullcontext
from datetime import UTC, datetime
from uuid import UUID

import pytest
from httpx import AsyncClient
from pydantic_ai.messages import ModelResponse, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import AppSettings, Model
from app.services import model_probe
from tests.model_fixtures import synthetic_model_config


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
    assert data["credential_state"] == "readable"
    assert data["health_status"] == "unknown"
    assert "is_available" not in data
    assert "api_key_configured" not in data


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


@pytest.mark.asyncio
async def test_custom_model_requires_safe_http_base_url(client: AsyncClient):
    missing = await client.post(
        "/api/v1/config/models",
        json={
            "name": "Missing endpoint",
            "provider": "custom",
            "model_id": "custom-model",
        },
    )
    assert missing.status_code == 422

    for base_url in (
        "gateway.example.com/v1",
        "ftp://gateway.example.com/v1",
        "https://user:secret@gateway.example.com/v1",
        "https://gateway.example.com/v1#debug",
    ):
        response = await client.post(
            "/api/v1/config/models",
            json={
                "name": "Unsafe endpoint",
                "provider": "custom",
                "model_id": "custom-model",
                "base_url": base_url,
            },
        )
        assert response.status_code == 422


@pytest.mark.asyncio
async def test_openai_compatible_urls_are_normalized_without_duplicate_endpoint(
    client: AsyncClient,
):
    full_endpoint = await client.post(
        "/api/v1/config/models",
        json={
            "name": "Full endpoint",
            "provider": "custom",
            "model_id": "custom-model",
            "base_url": "https://gateway.example.com/v1/chat/completions/",
        },
    )
    deepseek_root = await client.post(
        "/api/v1/config/models",
        json={
            "name": "DeepSeek root",
            "provider": "deepseek",
            "model_id": "deepseek-chat",
            "base_url": "https://api.deepseek.com",
        },
    )

    assert full_endpoint.status_code == 200
    assert full_endpoint.json()["data"]["base_url"] == "https://gateway.example.com/v1"
    assert deepseek_root.status_code == 200
    assert deepseek_root.json()["data"]["base_url"] == "https://api.deepseek.com/v1"


@pytest.mark.asyncio
async def test_connection_check_proves_tool_round_trip_and_structured_output(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
):
    created = await client.post(
        "/api/v1/config/models",
        json={
            "name": "List-capable gateway",
            "provider": "custom",
            "model_id": "custom-model",
            "base_url": "https://gateway.example.com/v1",
            "api_key": "saved-key",
            "extra_options": {"api_format": "openai_compatible"},
        },
    )
    model_id = created.json()["data"]["id"]
    observed: dict[str, object] = {}

    def answer(messages, info):
        returns = [
            part
            for message in messages
            for part in message.parts
            if isinstance(part, ToolReturnPart)
        ]
        if not returns:
            return ModelResponse(parts=[ToolCallPart("read_check_value", {})])
        observed["receipt"] = returns[-1].content["receipt"]
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, returns[-1].content)])

    def fake_build(config):
        observed["config"] = config
        return nullcontext(FunctionModel(answer))

    monkeypatch.setattr(model_probe, "model_session", fake_build)

    response = await client.post(f"/api/v1/config/models/{model_id}/test")

    assert response.status_code == 200
    assert response.json()["data"]["success"] is True
    assert response.json()["data"]["message"] == "连接成功"
    assert observed["receipt"]
    assert observed["config"] == synthetic_model_config(
        model="custom-model",
        model_id=model_id,
        display_name="List-capable gateway",
        api_key="saved-key",
        base_url="https://gateway.example.com/v1",
        source_provider="custom",
    )

    listed = (await client.get("/api/v1/config/models")).json()["data"][0]
    assert listed["health_status"] == "healthy"
    assert listed["last_checked_at"] is not None
    assert listed["last_response_time_ms"] is not None
    assert listed["last_error_category"] is None


@pytest.mark.asyncio
async def test_model_healthcheck_never_reflects_raw_provider_error(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
):
    created = await client.post(
        "/api/v1/config/models",
        json={
            "name": "Failing gateway",
            "provider": "custom",
            "model_id": "custom-model",
            "base_url": "https://gateway.example.com/v1?token=secret-query",
            "api_key": "saved-key",
            "extra_options": {
                "api_format": "openai_compatible",
            },
        },
    )
    model_id = created.json()["data"]["id"]

    def fail(_messages, _info):
        raise RuntimeError("provider exploded with secret-token at ?token=secret-query")

    monkeypatch.setattr(
        model_probe, "model_session", lambda _config: nullcontext(FunctionModel(fail))
    )

    response = await client.post(f"/api/v1/config/models/{model_id}/test")
    data = response.json()["data"]

    assert data["success"] is False
    assert data["message"] == "测试失败: 模型服务返回格式不兼容，请检查协议设置"
    assert "secret" not in data["message"]
    assert data["resolved_base_url"] == "https://gateway.example.com/v1"
    assert data["health_status"] == "unhealthy"


@pytest.mark.asyncio
async def test_model_healthcheck_fails_closed_when_saved_key_cannot_be_decrypted(
    client: AsyncClient,
    db_session: AsyncSession,
):
    created = await client.post(
        "/api/v1/config/models",
        json={
            "name": "Broken credential",
            "provider": "openai",
            "model_id": "gpt-4o-mini",
            "api_key": "saved-key",
        },
    )
    model = await db_session.get(Model, UUID(created.json()["data"]["id"]))
    assert model is not None
    model.api_key_encrypted = "not-a-fernet-token"
    await db_session.commit()

    response = await client.post(f"/api/v1/config/models/{model.id}/test")
    data = response.json()["data"]

    assert data["success"] is False
    assert data["message"] == "保存的 API Key 无法读取，请重新输入"
    assert data["error_category"] == "auth"
    assert data["health_status"] == "unhealthy"

    listed = (await client.get("/api/v1/config/models")).json()["data"][0]
    assert listed["credential_state"] == "unreadable"
    assert listed["health_status"] == "unhealthy"
    assert listed["last_error_category"] == "auth"


@pytest.mark.asyncio
async def test_connection_changes_reset_health_but_renaming_does_not(
    client: AsyncClient,
    db_session: AsyncSession,
):
    created = await client.post(
        "/api/v1/config/models",
        json={
            "name": "Gateway",
            "provider": "custom",
            "model_id": "model-a",
            "base_url": "https://gateway.example.com/v1",
            "api_key": "saved-key",
        },
    )
    model_id = UUID(created.json()["data"]["id"])
    model = await db_session.get(Model, model_id)
    assert model is not None
    model.health_status = "healthy"
    model.last_checked_at = datetime.now(UTC)
    model.last_response_time_ms = 25
    await db_session.commit()

    renamed = await client.put(
        f"/api/v1/config/models/{model_id}",
        json={
            "name": "Renamed gateway",
            "provider": "custom",
            "model_id": "model-a",
            "base_url": "https://gateway.example.com/v1",
        },
    )
    assert renamed.json()["data"]["health_status"] == "healthy"

    changed = await client.put(
        f"/api/v1/config/models/{model_id}",
        json={
            "name": "Renamed gateway",
            "provider": "custom",
            "model_id": "model-b",
            "base_url": "https://gateway.example.com/v1",
        },
    )
    changed_data = changed.json()["data"]
    assert changed_data["health_status"] == "unknown"
    assert changed_data["last_checked_at"] is None
    assert changed_data["last_response_time_ms"] is None


@pytest.mark.asyncio
async def test_default_model_flag_updates_workspace_canonical_default(
    client: AsyncClient,
    db_session: AsyncSession,
):
    created = await client.post(
        "/api/v1/config/models",
        json={
            "name": "Default service",
            "provider": "openai",
            "model_id": "gpt-4.1",
            "api_key": "saved-key",
            "is_default": True,
        },
    )
    model_id = UUID(created.json()["data"]["id"])

    settings_record = await db_session.get(AppSettings, 1)
    assert settings_record is not None
    assert settings_record.default_model_id == model_id
