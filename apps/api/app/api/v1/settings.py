"""单工作区设置 API"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import APIResponse, AppSettings, AppSettingsUpdate
from app.services.app_settings import get_or_create_app_settings

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=APIResponse[AppSettings])
async def get_settings(db: AsyncSession = Depends(get_db)):
    """获取单工作区设置"""
    settings_record = await get_or_create_app_settings(db)
    return APIResponse.ok(
        data=AppSettings(
            default_model_id=settings_record.default_model_id,
            default_connection_id=settings_record.default_connection_id,
            context_rounds=settings_record.context_rounds,
            python_enabled=settings_record.python_enabled,
            diagnostics_enabled=settings_record.diagnostics_enabled,
            auto_repair_enabled=settings_record.auto_repair_enabled,
        )
    )


@router.put("", response_model=APIResponse[AppSettings])
async def update_settings(
    settings_in: AppSettingsUpdate,
    db: AsyncSession = Depends(get_db),
):
    """更新单工作区设置"""
    settings_record = await get_or_create_app_settings(db)
    update_data = settings_in.model_dump(exclude_none=True)
    for key, value in update_data.items():
        setattr(settings_record, key, value)
    await db.commit()
    await db.refresh(settings_record)
    return APIResponse.ok(
        data=AppSettings(
            default_model_id=settings_record.default_model_id,
            default_connection_id=settings_record.default_connection_id,
            context_rounds=settings_record.context_rounds,
            python_enabled=settings_record.python_enabled,
            diagnostics_enabled=settings_record.diagnostics_enabled,
            auto_repair_enabled=settings_record.auto_repair_enabled,
        ),
        message="设置已更新",
    )
