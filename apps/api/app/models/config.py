"""配置相关模型"""

from datetime import datetime
from typing import Any, Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import BaseModel, Field, field_serializer, field_validator, model_validator

ModelProvider = Literal[
    "openai", "anthropic", "deepseek", "groq", "qwen", "orcarouter", "ollama", "custom"
]
ModelAPIFormat = Literal[
    "openai_compatible", "openai_responses", "anthropic_native", "ollama_local", "custom"
]
ModelCredentialState = Literal["missing", "readable", "unreadable", "not_required"]
ModelHealthStatus = Literal["unknown", "healthy", "unhealthy"]
ConnectionSSLMode = Literal["disable", "prefer", "require", "verify-ca", "verify-full"]


class ConnectionExtraOptions(BaseModel):
    """Safe, editable options for remote database connections.

    Only file paths are accepted for certificate material. Certificate or key
    contents must never be stored in the JSON options column.
    """

    sslmode: ConnectionSSLMode = "prefer"
    sslrootcert: str | None = Field(default=None, max_length=4096)
    sslcert: str | None = Field(default=None, max_length=4096)
    sslkey: str | None = Field(default=None, max_length=4096)
    schema: str | None = Field(
        default=None,
        min_length=1,
        max_length=63,
        pattern=r"^[A-Za-z_][A-Za-z0-9_]*$",
    )

    model_config = {"extra": "forbid"}

    @field_validator("sslrootcert", "sslcert", "sslkey", "schema", mode="before")
    @classmethod
    def normalize_optional_text(cls, value: Any) -> Any:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("连接选项必须是文本")
        normalized = value.strip()
        if not normalized:
            return None
        if "\x00" in normalized:
            raise ValueError("连接选项包含无效字符")
        return normalized

    @field_validator("sslrootcert", "sslcert", "sslkey")
    @classmethod
    def require_certificate_file_path(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if "\n" in value or "\r" in value or "-----BEGIN " in value.upper():
            raise ValueError("证书配置只接受文件路径，不能粘贴证书或私钥正文")
        return value

    @model_validator(mode="after")
    def validate_certificate_bundle(self) -> "ConnectionExtraOptions":
        if bool(self.sslcert) != bool(self.sslkey):
            raise ValueError("客户端证书与私钥路径必须同时填写")
        if self.sslmode in {"verify-ca", "verify-full"} and not self.sslrootcert:
            raise ValueError("验证服务器证书时必须填写 CA 证书路径")
        if self.sslmode == "disable" and any((self.sslrootcert, self.sslcert, self.sslkey)):
            raise ValueError("关闭加密时不能配置证书")
        return self


class ModelExtraOptions(BaseModel):
    """模型高级配置"""

    api_format: ModelAPIFormat | None = Field(
        default=None,
        description="请求协议格式；为空时按 provider 自动推断",
    )
    headers: dict[str, str] = Field(default_factory=dict, description="额外请求头")
    query_params: dict[str, str] = Field(default_factory=dict, description="额外查询参数")
    api_key_optional: bool = Field(default=False, description="是否允许不配置 API Key")

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

    @model_validator(mode="after")
    def validate_remote_endpoint(self) -> "ModelCreate":
        if self.provider in {"custom", "qwen"} and not self.base_url:
            raise ValueError("此模型服务必须配置 Base URL")
        if not self.base_url:
            return self

        try:
            parsed = urlsplit(self.base_url)
            hostname = parsed.hostname
            # Accessing port validates malformed and non-numeric port values.
            _ = parsed.port
        except ValueError as exc:
            raise ValueError("模型服务地址格式无效") from exc
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc or not hostname:
            raise ValueError("模型服务地址必须是完整的 http(s) URL")
        if parsed.username is not None or parsed.password is not None:
            raise ValueError("模型服务地址不能包含用户名或密码")
        if parsed.fragment:
            raise ValueError("模型服务地址不能包含 fragment")
        return self


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
    credential_state: ModelCredentialState
    health_status: ModelHealthStatus = "unknown"
    last_checked_at: datetime | None = None
    last_error_category: str | None = None
    last_response_time_ms: int | None = None
    created_at: datetime

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def map_extra_fields(cls, data: Any) -> Any:
        if hasattr(data, "extra_options"):
            extra_options = data.extra_options or {}
            encrypted_key = getattr(data, "api_key_encrypted", None)
            api_key_optional = bool(extra_options.get("api_key_optional"))
            if encrypted_key:
                try:
                    # This check never exposes plaintext.  It prevents a stored
                    # but no-longer-decryptable envelope from masquerading as a
                    # configured credential after a desktop key change.
                    from app.core import encryptor

                    credential_state: ModelCredentialState = (
                        "readable" if encryptor.decrypt(encrypted_key) else "unreadable"
                    )
                except Exception:
                    credential_state = "unreadable"
            elif api_key_optional:
                credential_state = "not_required"
            else:
                credential_state = "missing"

            persisted_health = getattr(data, "health_status", "unknown") or "unknown"
            health_status: ModelHealthStatus = (
                "unhealthy" if credential_state == "unreadable" else persisted_health
            )
            return {
                "id": data.id,
                "name": data.name,
                "provider": data.provider,
                "model_id": data.model_id,
                "base_url": data.base_url,
                "extra_options": extra_options,
                "is_default": data.is_default,
                "is_active": getattr(data, "is_active", True),
                "credential_state": credential_state,
                "health_status": health_status,
                "last_checked_at": getattr(data, "last_checked_at", None),
                "last_error_category": (
                    "auth"
                    if credential_state == "unreadable"
                    else getattr(data, "last_error_category", None)
                ),
                "last_response_time_ms": getattr(data, "last_response_time_ms", None),
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
    extra_options: ConnectionExtraOptions = Field(
        default_factory=ConnectionExtraOptions,
        description="连接安全与数据库范围",
    )
    is_default: bool = Field(default=False, description="是否默认")

    @field_validator("host")
    @classmethod
    def normalize_host(cls, value: str | None) -> str | None:
        if value == "localhost":
            return "127.0.0.1"
        return value

    @model_validator(mode="after")
    def validate_driver_options(self) -> "ConnectionCreate":
        configured = self.extra_options.model_dump(exclude_defaults=True, exclude_none=True)
        if self.driver == "sqlite" and configured:
            raise ValueError("SQLite 不支持远程连接选项")
        if self.driver != "postgresql" and self.extra_options.schema:
            raise ValueError("仅 PostgreSQL 支持 schema 范围")
        return self


class ConnectionUpdate(BaseModel):
    """更新数据库连接"""

    name: str | None = Field(default=None, max_length=100)
    host: str | None = None
    port: int | None = None
    username: str | None = None
    password: str | None = None
    database: str | None = None
    extra_options: ConnectionExtraOptions | None = None
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
    extra_options: ConnectionExtraOptions = Field(default_factory=ConnectionExtraOptions)
    is_default: bool = False
    is_connected: bool = False  # 运行时检测
    created_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}

    @field_validator("extra_options", mode="before")
    @classmethod
    def expose_safe_extra_options(cls, value: Any) -> dict[str, Any]:
        if not isinstance(value, dict):
            return {}
        allowed = {"sslmode", "sslrootcert", "sslcert", "sslkey", "schema"}
        filtered = {key: item for key, item in value.items() if key in allowed}
        try:
            return ConnectionExtraOptions.model_validate(filtered).model_dump(exclude_none=True)
        except ValueError:
            # Legacy/hand-edited values must not make the entire settings page
            # unavailable. Invalid options remain hidden until the connection is
            # saved again through the validated API.
            return {}

    @field_serializer("extra_options")
    def serialize_extra_options(
        self,
        value: ConnectionExtraOptions,
    ) -> dict[str, Any]:
        return value.model_dump(exclude_none=True)


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
    source_provider: str | None = None
    resolved_base_url: str | None = None
    api_format: ModelAPIFormat | None = None
    api_key_required: bool = True
    error_category: str | None = None
    health_status: ModelHealthStatus
    checked_at: datetime


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


class AppSettings(BaseModel):
    """单工作区设置"""

    default_model_id: UUID | None = None
    default_connection_id: UUID | None = None
    context_rounds: int = Field(default=5, ge=1, le=20)
    python_enabled: bool = True
    diagnostics_enabled: bool = True
    auto_repair_enabled: bool = True
    preprocessing_enabled: bool = True
    self_analysis_enabled: bool = True


class AppSettingsUpdate(BaseModel):
    """更新单工作区设置"""

    default_model_id: UUID | None = None
    default_connection_id: UUID | None = None
    context_rounds: int | None = Field(default=None, ge=1, le=20)
    python_enabled: bool | None = None
    diagnostics_enabled: bool | None = None
    auto_repair_enabled: bool | None = None
    preprocessing_enabled: bool | None = None
    self_analysis_enabled: bool | None = None


class SystemCapabilities(BaseModel):
    """运行时能力状态"""

    install_profile: Literal["core", "analytics"] = "core"
    python_enabled: bool = True
    diagnostics_enabled: bool = True
    auto_repair_enabled: bool = True
    analytics_installed: bool = False
    available_python_libraries: list[str] = Field(default_factory=list)
    missing_optional_libraries: list[str] = Field(default_factory=list)
