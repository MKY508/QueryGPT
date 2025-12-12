"""
QueryGPT API 主应用
"""
import logging
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import api_router
from app.core.config import settings
from app.core.demo_db import init_demo_database
from app.db import engine
from app.db.base import Base

# 配置日志
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.dev.ConsoleRenderer() if settings.LOG_FORMAT == "console" else structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 启动时
    logger.info("Starting QueryGPT API", version=settings.APP_VERSION)

    # 验证密钥配置
    settings.validate_secrets()
    if settings.is_using_default_secrets:
        logger.warning("使用默认密钥，请在生产环境中更改 JWT_SECRET_KEY 和 ENCRYPTION_KEY")

    # 创建数据库表（开发环境）
    if settings.is_development:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Database tables created")

    # 初始化示例数据库
    demo_db_path = init_demo_database()
    logger.info("Demo database initialized", path=demo_db_path)

    yield

    # 关闭时
    logger.info("Shutting down QueryGPT API")
    await engine.dispose()


# 创建 FastAPI 应用
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Natural language database query assistant",
    docs_url="/api/docs" if settings.is_development else None,
    redoc_url="/api/redoc" if settings.is_development else None,
    openapi_url="/api/openapi.json" if settings.is_development else None,
    lifespan=lifespan,
)

# CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 全局异常处理
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """全局异常处理"""
    logger.error("Unhandled exception", error=str(exc), path=request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "服务器内部错误" if not settings.DEBUG else str(exc),
            },
        },
    )


# 注册路由
app.include_router(api_router, prefix="/api/v1")


# 健康检查
@app.get("/health")
async def health_check():
    """健康检查"""
    return {
        "status": "healthy",
        "version": settings.APP_VERSION,
        "environment": settings.ENVIRONMENT,
    }


# 根路由
@app.get("/")
async def root():
    """根路由"""
    return {
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/api/docs" if settings.is_development else None,
    }


def run():
    """运行服务器"""
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.is_development,
        workers=settings.WORKERS if not settings.is_development else 1,
        log_level=settings.LOG_LEVEL.lower(),
    )


if __name__ == "__main__":
    run()
