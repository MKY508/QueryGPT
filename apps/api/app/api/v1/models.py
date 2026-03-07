"""模型配置管理 API"""

import time
from uuid import UUID

import litellm
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import encryptor
from app.core.config import settings
from app.db import get_db
from app.db.tables import Model
from app.models import APIResponse, ModelCreate, ModelResponse, ModelTest
from app.services.model_runtime import categorize_model_error, resolve_model_runtime

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


@router.get("", response_model=APIResponse[list[ModelResponse]])
async def list_models(db: AsyncSession = Depends(get_db)):
    """获取模型列表"""
    result = await db.execute(select(Model).order_by(Model.created_at.desc()))
    models = result.scalars().all()
    return APIResponse.ok(data=[ModelResponse.model_validate(m) for m in models])


@router.post("", response_model=APIResponse[ModelResponse])
async def create_model(
    model_in: ModelCreate,
    db: AsyncSession = Depends(get_db),
):
    """添加模型配置"""
    if model_in.is_default:
        await _clear_default_models(db)

    api_key_encrypted = encryptor.encrypt(model_in.api_key) if model_in.api_key else None
    model = Model(
        name=model_in.name,
        provider=model_in.provider,
        model_id=model_in.model_id,
        base_url=model_in.base_url,
        api_key_encrypted=api_key_encrypted,
        extra_options=model_in.extra_options.model_dump(),
        is_default=model_in.is_default,
    )
    db.add(model)
    await db.commit()
    await db.refresh(model)

    return APIResponse.ok(data=ModelResponse.model_validate(model), message="模型已添加")


@router.put("/{model_id}", response_model=APIResponse[ModelResponse])
async def update_model(
    model_id: UUID,
    model_in: ModelCreate,
    db: AsyncSession = Depends(get_db),
):
    """更新模型配置"""
    model = await _get_model_or_404(db, model_id)

    if model_in.is_default and not model.is_default:
        await _clear_default_models(db, exclude_id=model.id)

    model.name = model_in.name
    model.provider = model_in.provider
    model.model_id = model_in.model_id
    model.base_url = model_in.base_url
    model.is_default = model_in.is_default
    model.extra_options = model_in.extra_options.model_dump()
    if model_in.api_key:
        model.api_key_encrypted = encryptor.encrypt(model_in.api_key)

    await db.commit()
    await db.refresh(model)

    return APIResponse.ok(data=ModelResponse.model_validate(model), message="模型已更新")


@router.delete("/{model_id}", response_model=APIResponse[dict])
async def delete_model(
    model_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """删除模型配置"""
    model = await _get_model_or_404(db, model_id)
    await db.delete(model)
    await db.commit()
    return APIResponse.ok(message="模型已删除")


@router.post("/{model_id}/test", response_model=APIResponse[ModelTest])
async def test_model(
    model_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """测试模型配置"""
    model = await _get_model_or_404(db, model_id)
    api_key = encryptor.decrypt(model.api_key_encrypted) if model.api_key_encrypted else None

    resolved, _ = resolve_model_runtime(
        model,
        fallback_model=settings.DEFAULT_MODEL,
        fallback_api_key=api_key or settings.OPENAI_API_KEY,
        fallback_base_url=settings.OPENAI_BASE_URL,
    )

    if not api_key and resolved.api_key_required:
        return APIResponse.ok(
            data=ModelTest(
                success=False,
                message="未配置 API Key",
                resolved_provider=resolved.litellm_provider,
                resolved_base_url=resolved.base_url,
                api_format=resolved.api_format,
                api_key_required=resolved.api_key_required,
                error_category="auth",
            )
        )

    try:
        start_time = time.time()
        response = await litellm.acompletion(
            messages=[{"role": "user", "content": "Hi"}],
            max_tokens=5,
            timeout=10,
            **resolved.completion_kwargs(),
        )
        elapsed_ms = int((time.time() - start_time) * 1000)
        return APIResponse.ok(
            data=ModelTest(
                success=True,
                model_name=response.model if hasattr(response, "model") else model.model_id,
                response_time_ms=elapsed_ms,
                message="连接成功",
                resolved_provider=resolved.litellm_provider,
                resolved_base_url=resolved.base_url,
                api_format=resolved.api_format,
                api_key_required=resolved.api_key_required,
            )
        )
    except Exception as e:
        error_msg = str(e)
        error_category = categorize_model_error(error_msg)
        if error_category == "auth":
            error_msg = "API Key 无效"
        elif error_category == "timeout":
            error_msg = "请求超时"
        elif error_category == "connection":
            error_msg = "连接失败，请检查网络或 Base URL"
        elif error_category == "model_not_found":
            error_msg = "模型不存在或该网关不支持此模型"

        return APIResponse.ok(
            data=ModelTest(
                success=False,
                message=f"测试失败: {error_msg}",
                resolved_provider=resolved.litellm_provider,
                resolved_base_url=resolved.base_url,
                api_format=resolved.api_format,
                api_key_required=resolved.api_key_required,
                error_category=error_category,
            )
        )
