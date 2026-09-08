"""模型配置管理 API"""

import asyncio
import time
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit, urlunsplit
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic_ai import Agent
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import encryptor
from app.core.config import settings
from app.db import get_db
from app.db.tables import AppSettings, Model
from app.models import APIResponse, ModelCreate, ModelResponse, ModelTest
from app.models.config import ModelAPIFormat, ModelHealthStatus
from app.services.app_settings import get_or_create_app_settings
from app.services.model_engine import model_session
from app.services.model_runtime import (
    ModelCredentialError,
    ModelRuntimeConfigurationError,
    categorize_model_exception,
    default_api_format,
    normalize_runtime_base_url,
    resolve_model_runtime,
)

router = APIRouter(prefix="/models", tags=["models"])


def _public_base_url(value: str | None) -> str | None:
    """Keep endpoint diagnostics useful without reflecting query-string secrets."""

    if not value:
        return None
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError:
        return None
    if not hostname:
        return None
    public_host = f"[{hostname}]" if ":" in hostname else hostname
    netloc = f"{public_host}:{port}" if port is not None else public_host
    return urlunsplit((parsed.scheme, netloc, parsed.path, "", ""))


def _safe_test_error_message(category: str) -> str:
    messages = {
        "auth": "API Key 无效",
        "timeout": "请求超时",
        "connection": "连接失败，请检查网络或 Base URL",
        "model_not_found": "模型不存在或该网关不支持此模型",
        "model_endpoint": "模型服务地址不可用，请检查 Base URL 与协议设置",
        "rate_limited": "模型服务请求过于频繁，请稍后重试",
        "provider_format": "模型服务返回格式不兼容，请检查协议设置",
    }
    return messages.get(category, "连接测试失败，请检查服务地址、协议和模型配置")


async def _get_model_or_404(db: AsyncSession, model_id: UUID) -> Model:
    result = await db.execute(select(Model).where(Model.id == model_id))
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="模型不存在")
    return model


async def _clear_default_models(db: AsyncSession, exclude_id: UUID | None = None) -> None:
    result = await db.execute(select(Model).where(Model.is_default.is_(True)))
    for model in result.scalars():
        if exclude_id and model.id == exclude_id:
            continue
        model.is_default = False


async def _set_workspace_default(db: AsyncSession, model_id: UUID | None) -> None:
    settings_record = await get_or_create_app_settings(db)
    settings_record.default_model_id = model_id


async def _canonical_default_model_id(
    db: AsyncSession,
    models: list[Model],
) -> UUID | None:
    settings_record = await db.get(AppSettings, 1)
    active_ids = {model.id for model in models if model.is_active}
    if settings_record and settings_record.default_model_id in active_ids:
        return UUID(str(settings_record.default_model_id))
    # Compatibility for databases created before AppSettings became the
    # canonical selector. The newest legacy flag wins deterministically.
    legacy = next((model for model in models if model.is_active and model.is_default), None)
    return UUID(str(legacy.id)) if legacy else None


def _reset_model_health(model: Model) -> None:
    model.health_status = "unknown"
    model.last_checked_at = None
    model.last_error_category = None
    model.last_response_time_ms = None


async def _finish_model_test(
    db: AsyncSession,
    model: Model,
    *,
    success: bool,
    message: str,
    response_time_ms: int | None = None,
    source_provider: str | None = None,
    resolved_base_url: str | None = None,
    api_format: ModelAPIFormat | None = None,
    api_key_required: bool = True,
    error_category: str | None = None,
) -> APIResponse[ModelTest]:
    checked_at = datetime.now(UTC)
    health_status: ModelHealthStatus = "healthy" if success else "unhealthy"
    model.health_status = health_status
    model.last_checked_at = checked_at
    model.last_error_category = None if success else (error_category or "unknown")
    model.last_response_time_ms = response_time_ms if success else None
    await db.commit()
    return APIResponse.ok(
        data=ModelTest(
            success=success,
            model_name=model.model_id if success else None,
            response_time_ms=response_time_ms,
            message=message,
            source_provider=source_provider,
            resolved_base_url=resolved_base_url,
            api_format=api_format,
            api_key_required=api_key_required,
            error_category=error_category,
            health_status=health_status,
            checked_at=checked_at,
        )
    )


def _stored_base_url(model_in: ModelCreate) -> str | None:
    api_format = model_in.extra_options.api_format or default_api_format(model_in.provider)
    return normalize_runtime_base_url(
        model_in.base_url,
        provider=model_in.provider,
        api_format=api_format,
    )


@router.get("", response_model=APIResponse[list[ModelResponse]])
async def list_models(db: AsyncSession = Depends(get_db)) -> APIResponse[list[ModelResponse]]:
    """获取模型列表"""
    result = await db.execute(select(Model).order_by(Model.created_at.desc()))
    models = list(result.scalars().all())
    canonical_default_id = await _canonical_default_model_id(db, models)
    responses = [
        ModelResponse.model_validate(model).model_copy(
            update={"is_default": model.id == canonical_default_id}
        )
        for model in models
    ]
    return APIResponse.ok(data=responses)


@router.post("", response_model=APIResponse[ModelResponse])
async def create_model(
    model_in: ModelCreate,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[ModelResponse]:
    """添加模型配置"""
    api_key_encrypted = encryptor.encrypt(model_in.api_key) if model_in.api_key else None
    model = Model(
        name=model_in.name,
        provider=model_in.provider,
        model_id=model_in.model_id,
        base_url=_stored_base_url(model_in),
        api_key_encrypted=api_key_encrypted,
        extra_options=model_in.extra_options.model_dump(),
        is_default=model_in.is_default,
    )
    db.add(model)
    await db.flush()
    if model_in.is_default:
        await _clear_default_models(db, exclude_id=UUID(str(model.id)))
        await _set_workspace_default(db, UUID(str(model.id)))
    await db.commit()
    await db.refresh(model)

    return APIResponse.ok(data=ModelResponse.model_validate(model), message="模型已添加")


@router.put("/{model_id}", response_model=APIResponse[ModelResponse])
async def update_model(
    model_id: UUID,
    model_in: ModelCreate,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[ModelResponse]:
    """更新模型配置"""
    model = await _get_model_or_404(db, model_id)

    stored_base_url = _stored_base_url(model_in)
    next_extra_options = model_in.extra_options.model_dump()
    provider_changed = model.provider != model_in.provider
    connection_changed = any(
        (
            model.provider != model_in.provider,
            model.model_id != model_in.model_id,
            model.base_url != stored_base_url,
            (model.extra_options or {}) != next_extra_options,
            bool(model_in.api_key),
        )
    )
    model.name = model_in.name
    model.provider = model_in.provider
    model.model_id = model_in.model_id
    model.base_url = stored_base_url
    model.is_default = model_in.is_default
    model.extra_options = next_extra_options
    if model_in.api_key:
        model.api_key_encrypted = encryptor.encrypt(model_in.api_key)
    elif provider_changed:
        model.api_key_encrypted = None
    if connection_changed:
        _reset_model_health(model)
    if model_in.is_default:
        await _clear_default_models(db, exclude_id=UUID(str(model.id)))
        await _set_workspace_default(db, UUID(str(model.id)))
    else:
        settings_record = await db.get(AppSettings, 1)
        if settings_record and settings_record.default_model_id == model.id:
            settings_record.default_model_id = None

    await db.commit()
    await db.refresh(model)

    return APIResponse.ok(data=ModelResponse.model_validate(model), message="模型已更新")


@router.delete("/{model_id}", response_model=APIResponse[dict[str, Any]])
async def delete_model(
    model_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict[str, Any]]:
    """删除模型配置"""
    model = await _get_model_or_404(db, model_id)
    settings_record = await db.get(AppSettings, 1)
    if settings_record and settings_record.default_model_id == model.id:
        settings_record.default_model_id = None
    await db.delete(model)
    await db.commit()
    return APIResponse.ok(message="模型已删除")


@router.post("/{model_id}/test", response_model=APIResponse[ModelTest])
async def test_model(
    model_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[ModelTest]:
    """测试模型配置"""
    model = await _get_model_or_404(db, model_id)
    try:
        resolved, _ = resolve_model_runtime(
            model,
            fallback_model=settings.DEFAULT_MODEL,
            # Persisted models are explicit provider boundaries. Environment
            # OpenAI settings are reserved for the model=None legacy path.
            fallback_api_key=None,
            fallback_base_url=None,
        )
    except ModelCredentialError:
        return await _finish_model_test(
            db,
            model,
            success=False,
            message="保存的 API Key 无法读取，请重新输入",
            resolved_base_url=_public_base_url(model.base_url),
            error_category="auth",
        )
    except ModelRuntimeConfigurationError:
        return await _finish_model_test(
            db,
            model,
            success=False,
            message="模型服务配置不完整，请重新填写 Base URL",
            resolved_base_url=_public_base_url(model.base_url),
            error_category="model_endpoint",
        )

    if not resolved.credentials_available:
        return await _finish_model_test(
            db,
            model,
            success=False,
            message="未配置 API Key",
            source_provider=resolved.source_provider,
            resolved_base_url=_public_base_url(resolved.base_url),
            api_format=resolved.api_format,
            api_key_required=resolved.api_key_required,
            error_category="auth",
        )

    try:
        start_time = time.monotonic()
        # A models-list request is not proof that the configured model can
        # answer. Always exercise the same configured protocol as a real
        # investigation, even for legacy records that requested models_list.
        async with asyncio.timeout(10), model_session(resolved) as runtime_model:
            healthcheck_agent = Agent(
                runtime_model,
                output_type=str,
                instructions="Reply with exactly OK.",
            )
            await healthcheck_agent.run("OK")
        elapsed_ms = int((time.monotonic() - start_time) * 1000)
        return await _finish_model_test(
            db,
            model,
            success=True,
            response_time_ms=elapsed_ms,
            message="连接成功",
            source_provider=resolved.source_provider,
            resolved_base_url=_public_base_url(resolved.base_url),
            api_format=resolved.api_format,
            api_key_required=resolved.api_key_required,
        )
    except TimeoutError:
        return await _finish_model_test(
            db,
            model,
            success=False,
            message="测试失败: 请求超时",
            source_provider=resolved.source_provider,
            resolved_base_url=_public_base_url(resolved.base_url),
            api_format=resolved.api_format,
            api_key_required=resolved.api_key_required,
            error_category="timeout",
        )
    except Exception as e:
        error_category = categorize_model_exception(e)
        error_msg = _safe_test_error_message(error_category)

        return await _finish_model_test(
            db,
            model,
            success=False,
            message=f"测试失败: {error_msg}",
            source_provider=resolved.source_provider,
            resolved_base_url=_public_base_url(resolved.base_url),
            api_format=resolved.api_format,
            api_key_required=resolved.api_key_required,
            error_category=error_category,
        )
