"""API v1 路由"""

from fastapi import APIRouter

from app.api.v1 import (
    analysis_history,
    chat,
    connections,
    history,
    models,
    projects,
    recipe_replay,
    report_artifacts,
    report_copy,
    report_history,
    report_trash,
    reports,
    settings,
    source_replacement,
    standing,
    system,
)

api_router = APIRouter()

# 注册子路由
api_router.include_router(chat.router, prefix="/chat", tags=["聊天"])
api_router.include_router(history.router, prefix="/conversations", tags=["历史记录"])
api_router.include_router(models.router, prefix="/config", tags=["模型配置"])
api_router.include_router(connections.router, prefix="/config", tags=["数据库连接"])
api_router.include_router(settings.router, tags=["工作区设置"])
api_router.include_router(system.router, tags=["系统"])
api_router.include_router(projects.router, tags=["项目工作区"])
api_router.include_router(analysis_history.router, tags=["项目工作区"])
api_router.include_router(source_replacement.router, tags=["项目工作区"])
api_router.include_router(recipe_replay.router, tags=["项目工作区"])
api_router.include_router(reports.router, tags=["可编辑报表"])
api_router.include_router(report_copy.router, tags=["可编辑报表"])
api_router.include_router(report_artifacts.router, tags=["可编辑报表"])
api_router.include_router(report_history.router, tags=["可编辑报表"])
api_router.include_router(report_trash.router, tags=["可编辑报表"])
api_router.include_router(standing.router, tags=["持续分析"])
