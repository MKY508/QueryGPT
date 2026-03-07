"""单工作区设置与运行时能力"""

from importlib.util import find_spec
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import AppSettings
from app.models import SystemCapabilities

CORE_PYTHON_LIBRARIES = ("pandas", "numpy", "matplotlib")
OPTIONAL_ANALYTICS_LIBRARIES = (
    ("sklearn", "scikit-learn"),
    ("scipy", "scipy"),
    ("seaborn", "seaborn"),
)


async def get_or_create_app_settings(db: AsyncSession) -> AppSettings:
    """获取单工作区设置，不存在则创建默认记录"""
    result = await db.execute(select(AppSettings).where(AppSettings.id == 1))
    settings_record = result.scalar_one_or_none()
    if settings_record is None:
        settings_record = AppSettings(id=1)
        db.add(settings_record)
        await db.flush()
        await db.refresh(settings_record)
    return settings_record


def settings_to_dict(settings_record: AppSettings | None) -> dict[str, Any]:
    """将设置记录转换为执行链路可消费的字典"""
    if settings_record is None:
        return {}
    return {
        "default_model_id": str(settings_record.default_model_id)
        if settings_record.default_model_id
        else None,
        "default_connection_id": str(settings_record.default_connection_id)
        if settings_record.default_connection_id
        else None,
        "context_rounds": settings_record.context_rounds,
        "python_enabled": settings_record.python_enabled,
        "diagnostics_enabled": settings_record.diagnostics_enabled,
        "auto_repair_enabled": settings_record.auto_repair_enabled,
    }


def _setting_flag(
    settings_record: AppSettings | dict[str, Any] | None,
    key: str,
    default: bool,
) -> bool:
    if isinstance(settings_record, dict):
        return bool(settings_record.get(key, default))
    if settings_record is None:
        return default
    return bool(getattr(settings_record, key, default))


def detect_system_capabilities(
    settings_record: AppSettings | dict[str, Any] | None,
) -> SystemCapabilities:
    """检测当前安装模式与可用能力"""
    available_libraries = [name for name in CORE_PYTHON_LIBRARIES if find_spec(name) is not None]
    missing_optional = [
        package_name
        for import_name, package_name in OPTIONAL_ANALYTICS_LIBRARIES
        if find_spec(import_name) is None
    ]
    analytics_installed = not missing_optional
    return SystemCapabilities(
        install_profile="analytics" if analytics_installed else "core",
        python_enabled=_setting_flag(settings_record, "python_enabled", True),
        diagnostics_enabled=_setting_flag(settings_record, "diagnostics_enabled", True),
        auto_repair_enabled=_setting_flag(settings_record, "auto_repair_enabled", True),
        analytics_installed=analytics_installed,
        available_python_libraries=available_libraries
        + [
            package_name
            for import_name, package_name in OPTIONAL_ANALYTICS_LIBRARIES
            if find_spec(import_name)
        ],
        missing_optional_libraries=missing_optional,
    )
