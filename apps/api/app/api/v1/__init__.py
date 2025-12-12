"""API v1 路由"""
from fastapi import APIRouter

from app.api.v1 import auth, chat, config, history

api_router = APIRouter()

# 注册子路由
api_router.include_router(auth.router, prefix="/auth", tags=["认证"])
api_router.include_router(chat.router, prefix="/chat", tags=["聊天"])
api_router.include_router(history.router, prefix="/conversations", tags=["历史记录"])
api_router.include_router(config.router, prefix="/config", tags=["配置"])
