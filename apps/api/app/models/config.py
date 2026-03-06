"""配置相关模型"""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

ModelProvider = Literal["openai", "anthropic", "deepseek", "ollama", "custom"]
ModelAPIFormat = Literal["openai_compatible", "anthropic_native", "ollama_local", "custom"]
ModelHealthcheckMode = Literal["chat_completion", "models_list"]


class ModelExtraOptions(BaseModel):
    """模型高级配置"""

    api_format: ModelAPIFormat | None = Field(
        default=None,
        description="请求协议格式；为空时按 provider 自动推断",
    )
    headers: dict[str, str] = Field(default_factory=dict, description="额外请求头")
    query_params: dict[str, str] = Field(default_factory=dict, description="额外查询参数")
    api_key_optional: bool = Field(default=False, description="是否允许不配置 API Key")
    healthcheck_mode: ModelHealthcheckMode = Field(
        default="chat_completion",
        description="测试连接时的健康检查方式",
    )

    @field_validator("headers", "query_params", mode="before")
    @classmethod
    def normalize_mapping(cls, value: Any) -> dict[str, str]:
        if value in (None, "", {}):
            return {}
        if not isinstance(value, dict):
            raise ValueError("必须是键值对对象")
        normalized: dict[str, str] = {}
        for key, item in value.items():
            normalized_key = str(key).strip()
            if not normalized_key:
                continue
            normalized[normalized_key] = str(item).strip()
        return normalized


class ModelCreate(BaseModel):
    """创建模型配置"""

    name: str = Field(..., min_length=1, max_length=100, description="显示名称")
    provider: ModelProvider = Field(..., description="提供商类型")
    model_id: str = Field(..., min_length=1, description="模型 ID")
    base_url: str | None = Field(default=None, description="API Base URL")
    api_key: str | None = Field(default=None, description="API Key")
    extra_options: ModelExtraOptions = Field(
        default_factory=ModelExtraOptions,
        description="高级适配选项",
    )
    is_default: bool = Field(default=False, description="是否默认")

    @field_validator("provider")
    @classmethod
    def normalize_provider(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("model_id")
    @classmethod
    def normalize_model_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("模型 ID 不能为空")
        return normalized

    @field_validator("base_url")
    @classmethod
    def normalize_base_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().rstrip("/")
        return normalized or None


class ModelUpdate(BaseModel):
    """更新模型配置"""

    name: str | None = Field(default=None, max_length=100)
    provider: ModelProvider | None = None
    model_id: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    extra_options: ModelExtraOptions | None = None
    is_default: bool | None = None
    is_active: bool | None = None


class ModelResponse(BaseModel):
    """模型配置响应"""

    id: UUID
    name: str
    provider: ModelProvider
    model_id: str
    base_url: str | None = None
    extra_options: ModelExtraOptions = Field(default_factory=ModelExtraOptions)
    is_default: bool = False
    is_active: bool = True
    is_available: bool = True  # 运行时检测
    api_key_configured: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def map_extra_fields(cls, data: Any) -> Any:
        if hasattr(data, "extra_options"):
            return {
                "id": data.id,
                "name": data.name,
                "provider": data.provider,
                "model_id": data.model_id,
                "base_url": data.base_url,
                "extra_options": data.extra_options or {},
                "is_default": data.is_default,
                "is_active": getattr(data, "is_active", True),
                "is_available": True,
                "api_key_configured": bool(getattr(data, "api_key_encrypted", None)),
                "created_at": data.created_at,
            }
        return data


class ConnectionCreate(BaseModel):
    """创建数据库连接"""

    name: str = Field(..., min_length=1, max_length=100, description="连接名称")
    driver: Literal["mysql", "postgresql", "sqlite"] = Field(..., description="数据库类型")
    host: str | None = Field(default=None, description="主机地址")
    port: int | None = Field(default=None, description="端口")
    username: str | None = Field(default=None, description="用户名")
    password: str | None = Field(default=None, description="密码")
    database: str | None = Field(default=None, description="数据库名")
    extra_options: dict[str, Any] | None = Field(default=None, description="额外选项")
    is_default: bool = Field(default=False, description="是否默认")

    @field_validator("host")
    @classmethod
    def normalize_host(cls, value: str | None) -> str | None:
        if value == "localhost":
            return "127.0.0.1"
        return value


class ConnectionUpdate(BaseModel):
    """更新数据库连接"""

    name: str | None = Field(default=None, max_length=100)
    host: str | None = None
    port: int | None = None
    username: str | None = None
    password: str | None = None
    database: str | None = None
    extra_options: dict[str, Any] | None = None
    is_default: bool | None = None


class ConnectionResponse(BaseModel):
    """数据库连接响应"""

    id: UUID
    name: str
    driver: str
    host: str | None = None
    port: int | None = None
    username: str | None = None
    database_name: str | None = Field(default=None, serialization_alias="database")
    is_default: bool = False
    is_connected: bool = False  # 运行时检测
    created_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class ConnectionTest(BaseModel):
    """连接测试结果"""

    connected: bool
    version: str | None = None
    tables_count: int | None = None
    message: str


class ModelTest(BaseModel):
    """模型测试结果"""

    success: bool
    model_name: str | None = None
    response_time_ms: int | None = None
    message: str
    resolved_provider: str | None = None
    resolved_base_url: str | None = None
    api_format: ModelAPIFormat | None = None
    api_key_required: bool = True
    error_category: str | None = None


class DatabaseSchema(BaseModel):
    """数据库结构"""

    tables: list["TableSchema"]


class TableSchema(BaseModel):
    """表结构"""

    name: str
    columns: list["ColumnSchema"]
    row_count: int | None = None


class ColumnSchema(BaseModel):
    """列结构"""

    name: str
    type: str
    nullable: bool = True
    primary: bool = False
    default: str | None = None


class UserConfig(BaseModel):
    """用户配置"""

    language: Literal["zh", "en"] = "zh"
    theme: str = "dawn"  # 主题: dawn, midnight, monet, vangogh, sakura, forest, aurora
    default_model_id: UUID | None = None
    default_connection_id: UUID | None = None
    context_rounds: int = Field(default=5, ge=1, le=20)


class UserConfigUpdate(BaseModel):
    """更新用户配置"""

    language: Literal["zh", "en"] | None = None
    theme: str | None = None
    default_model_id: UUID | None = None
    default_connection_id: UUID | None = None
    context_rounds: int | None = Field(default=None, ge=1, le=20)
