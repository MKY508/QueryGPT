"""模型配置管理 API"""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import encryptor
from app.core.config import settings
from app.db import get_db
from app.db.tables import AppSettings, Model
from app.models import APIResponse, ModelCreate, ModelResponse, ModelTest
from app.services.app_settings import get_or_create_app_settings
from app.services.model_probe import probe_failure, probe_model
from app.services.model_runtime import (
    ModelCredentialError,
    ModelRuntimeConfigurationError,
    default_api_format,
    normalize_runtime_base_url,
    resolve_model_runtime,
)

router = APIRouter(prefix="/models", tags=["models"])


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
    """Check a fixed configuration and persist only evidence for that revision."""
    model = await _get_model_or_404(db, model_id)
    revision = model.updated_at
    try:
        resolved, _ = resolve_model_runtime(
            model,
            fallback_model=settings.DEFAULT_MODEL,
            fallback_api_key=None,
            fallback_base_url=None,
        )
    except ModelCredentialError:
        outcome = probe_failure(
            "auth",
            message="保存的 API Key 无法读取，请重新输入",
            base_url=model.base_url,
        )
    except ModelRuntimeConfigurationError:
        outcome = probe_failure(
            "model_endpoint",
            message="模型服务配置不完整，请重新填写 Base URL",
            base_url=model.base_url,
        )
    else:
        # The immutable config owns the request. Do not hold a database
        # transaction or consult an expiring ORM object during model IO.
        await db.rollback()
        outcome = await probe_model(resolved)

    recorded = await db.execute(
        update(Model)
        .where(Model.id == model_id, Model.updated_at == revision)
        .values(
            health_status=outcome.health_status,
            last_checked_at=outcome.checked_at,
            last_error_category=outcome.error_category,
            last_response_time_ms=outcome.response_time_ms,
        )
        .returning(Model.id)
        .execution_options(synchronize_session=False)
    )
    if recorded.scalar_one_or_none() is None:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="模型配置或检查结果已更新，请重新检查",
        )
    await db.commit()
    return APIResponse.ok(data=outcome)
