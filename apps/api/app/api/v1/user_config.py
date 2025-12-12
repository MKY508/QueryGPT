"""用户配置 API"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db import get_db
from app.db.tables import User
from app.models import APIResponse, UserConfig

router = APIRouter(prefix="/config", tags=["config"])


@router.get("", response_model=APIResponse[UserConfig])
async def get_config(
    current_user: User = Depends(get_current_user),
):
    """获取用户配置"""
    settings = current_user.settings or {}
    return APIResponse.ok(
        data=UserConfig(
            language=settings.get("language", "zh"),
            theme=settings.get("theme", "dawn"),
            default_model_id=settings.get("default_model_id"),
            default_connection_id=settings.get("default_connection_id"),
            context_rounds=settings.get("context_rounds", 5),
        )
    )


@router.put("", response_model=APIResponse[UserConfig])
async def update_config(
    config_in: UserConfig,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新用户配置"""
    current_user.settings = config_in.model_dump(exclude_none=True)
    await db.commit()

    return APIResponse.ok(data=config_in, message="配置已更新")
