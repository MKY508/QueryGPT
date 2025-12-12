"""API v1 路由"""

from fastapi import APIRouter

from app.api.v1 import auth, chat, connections, export_import, history, models, schema, semantic, user_config

api_router = APIRouter()

# 注册子路由
api_router.include_router(auth.router, prefix="/auth", tags=["认证"])
api_router.include_router(chat.router, prefix="/chat", tags=["聊天"])
api_router.include_router(history.router, prefix="/conversations", tags=["历史记录"])
api_router.include_router(models.router, prefix="/config", tags=["模型配置"])
api_router.include_router(connections.router, prefix="/config", tags=["数据库连接"])
api_router.include_router(export_import.router, prefix="/config", tags=["配置导出导入"])
api_router.include_router(semantic.router, prefix="/config", tags=["语义层"])
api_router.include_router(schema.router, tags=["表关系"])
api_router.include_router(user_config.router, tags=["用户配置"])
