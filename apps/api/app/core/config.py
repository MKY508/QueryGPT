"""
应用配置管理
使用 Pydantic Settings 管理环境变量和配置
"""

import os
from functools import lru_cache
from pathlib import Path
from typing import ClassVar, Literal

from pydantic import Field, SecretStr, computed_field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app import __version__


class Settings(BaseSettings):
    """应用配置"""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ===== 应用配置 =====
    APP_NAME: str = "ReceiptBI"
    # Build identity is not a runtime setting; a stale .env must not advertise
    # a different release through /health or OpenAPI.
    APP_VERSION: ClassVar[str] = __version__
    DEBUG: bool = False
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"

    # ===== 服务器配置 =====
    HOST: str = "127.0.0.1"
    PORT: int = 8000
    WORKERS: int = 1
    RECEIPTBI_INSTANCE_TOKEN: str | None = None
    # Private capability passed only by the Electron main process. Unlike the
    # instance token used by /health for process identity, this value is never
    # exposed to the renderer or returned by an API response.
    RECEIPTBI_DESKTOP_CONTROL_TOKEN: str | None = None
    # Ephemeral, Electron-owned inputs for the one-time TypeScript model import.
    # They are accepted only for a desktop instance and are never returned by an API.
    RECEIPTBI_LEGACY_MODEL_SOURCE: Path | None = None
    RECEIPTBI_LEGACY_MODEL_SNAPSHOT: Path | None = None
    RECEIPTBI_LEGACY_MODEL_ROOT: Path | None = None
    RECEIPTBI_LEGACY_MODEL_ENCRYPTION_KEY: SecretStr | None = None

    # ===== 数据库配置 =====
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/receiptbi"
    WORKSPACE_ROOT: Path = Path("./data/projects")
    # Enforced during multipart parsing and again when publishing the source.
    FILE_UPLOAD_MAX_BYTES: int = Field(default=512 * 1024 * 1024, ge=1)
    FILE_UPLOAD_MAX_CONCURRENT: int = Field(default=2, ge=1, le=16)
    FILE_UPLOAD_RECEIVE_TIMEOUT_SECONDS: float = Field(default=120, ge=1, le=3600)
    # Admission caps remain useful for streamed readers too; not every format
    # or library allocation has a hard memory bound.
    VISUAL_CLEANING_MAX_SOURCE_BYTES: int = Field(
        default=256 * 1024 * 1024,
        ge=1,
    )
    VISUAL_CLEANING_MAX_XLSX_EXPANDED_BYTES: int = Field(
        default=512 * 1024 * 1024,
        ge=1,
    )
    FILE_PREPARATION_MAX_XLSX_EXPANDED_BYTES: int = Field(
        default=512 * 1024 * 1024,
        ge=1,
    )
    # Read-only openpyxl still loads shared strings/styles/workbook metadata.
    FILE_PREPARATION_MAX_XLSX_METADATA_BYTES: int = Field(
        default=32 * 1024 * 1024,
        ge=1,
    )

    @field_validator("DATABASE_URL")
    @classmethod
    def validate_database_url(cls, v: str) -> str:
        """验证数据库 URL 格式"""
        valid_prefixes = (
            "postgresql://",
            "postgresql+asyncpg://",
            "sqlite://",
            "sqlite+aiosqlite://",
            "mysql://",
            "mysql+aiomysql://",
        )
        if not any(v.startswith(p) for p in valid_prefixes):
            raise ValueError(f"DATABASE_URL 必须以以下前缀开头: {valid_prefixes}")
        return v

    # ===== Redis 配置 (可选) =====
    REDIS_URL: str | None = None

    # ===== 加密配置 =====
    ENCRYPTION_KEY: str = "your-encryption-key-32-bytes-long"  # Fernet key

    # ===== CORS 配置 =====
    CORS_ORIGINS_STR: str = "http://localhost:3000,http://127.0.0.1:3000"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def cors_origins(self) -> list[str]:
        """解析 CORS origins 为列表"""
        return [origin.strip() for origin in self.CORS_ORIGINS_STR.split(",") if origin.strip()]

    # ===== LLM 配置 =====
    DEFAULT_MODEL: str = "gpt-4o"
    OPENAI_API_KEY: str | None = None
    OPENAI_BASE_URL: str | None = None
    ANTHROPIC_API_KEY: str | None = None

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
        return self.ENCRYPTION_KEY == "your-encryption-key-32-bytes-long"

    @property
    def is_staging(self) -> bool:
        """Check if running in staging environment."""
        return self.ENVIRONMENT == "staging"

    def validate_secrets(self) -> None:
        """验证密钥配置，生产和预发布环境必须使用显式密钥

        Raises:
            ValueError: If encryption key is misconfigured or too short
        """
        # Check key length first (>= 32 bytes for Fernet)
        if len(self.ENCRYPTION_KEY) < 32:
            raise ValueError(
                "ENCRYPTION_KEY must be at least 32 bytes long for Fernet encryption. "
                'Generate one with: python -c "from cryptography.fernet import Fernet; '
                'print(Fernet.generate_key().decode())" and set as export ENCRYPTION_KEY=<key>'
            )

        # Production and staging environments must use explicit key (not default)
        if (self.is_production or self.is_staging) and self.is_using_default_secrets:
            raise ValueError(
                f"Cannot use default encryption key in {self.ENVIRONMENT} environment. "
                "Please set ENCRYPTION_KEY environment variable explicitly. "
                'Generate with: python -c "from cryptography.fernet import Fernet; '
                'print(Fernet.generate_key().decode())" and export ENCRYPTION_KEY=<generated_key>'
            )


@lru_cache
def get_settings() -> Settings:
    """获取配置单例"""

    env_file = os.environ.get("RECEIPTBI_ENV_FILE") or ".env"
    return Settings(_env_file=env_file)


# 导出配置实例
settings = get_settings()
