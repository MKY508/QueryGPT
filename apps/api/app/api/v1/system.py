"""系统能力 API"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import APIResponse, SystemCapabilities
from app.services.app_settings import detect_system_capabilities, get_or_create_app_settings

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/capabilities", response_model=APIResponse[SystemCapabilities])
async def get_capabilities(db: AsyncSession = Depends(get_db)):
    """获取当前运行时能力状态"""
    settings_record = await get_or_create_app_settings(db)
    return APIResponse.ok(data=detect_system_capabilities(settings_record))
