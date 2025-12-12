"""配置相关模型"""
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class ModelCreate(BaseModel):
    """创建模型配置"""

    name: str = Field(..., min_length=1, max_length=100, description="显示名称")
    provider: str = Field(..., description="提供商: openai, anthropic, ollama, etc.")
    model_id: str = Field(..., description="模型 ID: gpt-4o, claude-3-5-sonnet, etc.")
    base_url: str | None = Field(default=None, description="API Base URL")
    api_key: str | None = Field(default=None, description="API Key")
    extra_options: dict[str, Any] | None = Field(default=None, description="额外选项")
    is_default: bool = Field(default=False, description="是否默认")


class ModelUpdate(BaseModel):
    """更新模型配置"""

    name: str | None = Field(default=None, max_length=100)
    base_url: str | None = None
    api_key: str | None = None
    extra_options: dict[str, Any] | None = None
    is_default: bool | None = None
    is_active: bool | None = None


class ModelResponse(BaseModel):
    """模型配置响应"""

    id: UUID
    name: str
    provider: str
    model_id: str
    base_url: str | None = None
    is_default: bool = False
    is_active: bool = True
    is_available: bool = True  # 运行时检测
    created_at: datetime

    model_config = {"from_attributes": True}


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
    def normalize_host(cls, v: str | None) -> str | None:
        if v == "localhost":
            return "127.0.0.1"
        return v


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
    theme: Literal["light", "dark", "system"] = "light"
    default_model_id: UUID | None = None
    default_connection_id: UUID | None = None
    view_mode: Literal["user", "developer"] = "user"
    context_rounds: int = Field(default=3, ge=0, le=10)


class UserConfigUpdate(BaseModel):
    """更新用户配置"""

    language: Literal["zh", "en"] | None = None
    theme: Literal["light", "dark", "system"] | None = None
    default_model_id: UUID | None = None
    default_connection_id: UUID | None = None
    view_mode: Literal["user", "developer"] | None = None
    context_rounds: int | None = Field(default=None, ge=0, le=10)
