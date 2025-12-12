"""
应用配置管理
使用 Pydantic Settings 管理环境变量和配置
"""
from functools import lru_cache
from typing import Literal

from pydantic import computed_field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """应用配置"""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ===== 应用配置 =====
    APP_NAME: str = "QueryGPT"
    APP_VERSION: str = "2.0.0"
    DEBUG: bool = False
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"

    # ===== 服务器配置 =====
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    WORKERS: int = 1

    # ===== 数据库配置 =====
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/querygpt"

    @field_validator("DATABASE_URL")
    @classmethod
    def validate_database_url(cls, v: str) -> str:
        """验证数据库 URL 格式"""
        valid_prefixes = (
            "postgresql://", "postgresql+asyncpg://",
            "sqlite://", "sqlite+aiosqlite://",
            "mysql://", "mysql+aiomysql://",
        )
        if not any(v.startswith(p) for p in valid_prefixes):
            raise ValueError(f"DATABASE_URL 必须以以下前缀开头: {valid_prefixes}")
        return v

    # ===== Redis 配置 (可选) =====
    REDIS_URL: str | None = None

    # ===== JWT 配置 =====
    JWT_SECRET_KEY: str = "your-secret-key-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # ===== 加密配置 =====
    ENCRYPTION_KEY: str = "your-encryption-key-32-bytes-long"  # Fernet key

    # ===== CORS 配置 =====
    CORS_ORIGINS_STR: str = "http://localhost:3000,http://127.0.0.1:3000"

    @computed_field
    @property
    def CORS_ORIGINS(self) -> list[str]:
        """解析 CORS origins 为列表"""
        return [origin.strip() for origin in self.CORS_ORIGINS_STR.split(",") if origin.strip()]

    # ===== LLM 配置 =====
    DEFAULT_MODEL: str = "gpt-4o"
    OPENAI_API_KEY: str | None = None
    OPENAI_BASE_URL: str | None = None
    ANTHROPIC_API_KEY: str | None = None

    # ===== gptme 配置 =====
    GPTME_MODEL: str = "gpt-4o"
    GPTME_TIMEOUT: int = 300  # 5 分钟超时

    # ===== 速率限制 =====
    RATE_LIMIT_REQUESTS: int = 60
    RATE_LIMIT_WINDOW: int = 60  # 秒

    # ===== 日志配置 =====
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: Literal["json", "console"] = "console"

    @property
    def is_development(self) -> bool:
        return self.ENVIRONMENT == "development"

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def is_using_default_secrets(self) -> bool:
        """检查是否使用了默认的不安全密钥"""
        return (
            self.JWT_SECRET_KEY == "your-secret-key-change-in-production"
            or self.ENCRYPTION_KEY == "your-encryption-key-32-bytes-long"
        )

    def validate_secrets(self) -> None:
        """验证密钥配置，生产环境必须更改默认密钥"""
        if self.is_production and self.is_using_default_secrets:
            raise ValueError(
                "生产环境不能使用默认密钥！请设置 JWT_SECRET_KEY 和 ENCRYPTION_KEY 环境变量"
            )


@lru_cache
def get_settings() -> Settings:
    """获取配置单例"""
    return Settings()


# 导出配置实例
settings = get_settings()
