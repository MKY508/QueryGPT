"""历史记录相关模型"""
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class MessageCreate(BaseModel):
    """创建消息"""

    role: Literal["user", "assistant", "system"] = Field(..., description="角色")
    content: str = Field(..., description="内容")
    metadata: dict[str, Any] | None = Field(default=None, description="元数据")


class MessageResponse(BaseModel):
    """消息响应"""

    id: UUID
    role: Literal["user", "assistant", "system"]
    content: str
    metadata: dict[str, Any] | None = None
    created_at: datetime

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def map_extra_data_to_metadata(cls, data: Any) -> Any:
        """将 ORM 的 extra_data 字段映射到 metadata"""
        if hasattr(data, "extra_data"):
            # ORM 对象
            return {
                "id": data.id,
                "role": data.role,
                "content": data.content,
                "metadata": data.extra_data,
                "created_at": data.created_at,
            }
        elif isinstance(data, dict) and "extra_data" in data:
            # 字典形式
            data["metadata"] = data.pop("extra_data")
        return data


class MessageMetadata(BaseModel):
    """消息元数据（assistant 消息）"""

    sql: str | None = None
    execution_time: float | None = None
    rows_count: int | None = None
    steps: list[dict[str, str]] | None = None
    visualization: dict[str, Any] | None = None
    error: str | None = None


class ConversationCreate(BaseModel):
    """创建对话"""

    title: str | None = Field(default=None, max_length=200, description="标题")
    model_id: UUID | None = Field(default=None, description="模型 ID")
    connection_id: UUID | None = Field(default=None, description="数据库连接 ID")


class ConversationSummary(BaseModel):
    """对话摘要（列表用）"""

    id: UUID
    title: str | None
    model: str | None = None
    is_favorite: bool = False
    message_count: int = 0
    status: Literal["active", "completed", "error"] = "active"
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ConversationResponse(BaseModel):
    """对话详情响应"""

    id: UUID
    title: str | None
    model: str | None = None
    connection_id: UUID | None = None
    is_favorite: bool = False
    status: Literal["active", "completed", "error"] = "active"
    messages: list[MessageResponse] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def convert_messages(cls, data: Any) -> Any:
        """手动转换嵌套的消息列表，确保 extra_data 映射到 metadata"""
        if hasattr(data, "messages"):
            # ORM 对象 - 手动转换每个消息
            messages = []
            for msg in data.messages:
                messages.append({
                    "id": msg.id,
                    "role": msg.role,
                    "content": msg.content,
                    "metadata": msg.extra_data,
                    "created_at": msg.created_at,
                })
            return {
                "id": data.id,
                "title": data.title,
                "model": getattr(data, "model", None),
                "connection_id": data.connection_id,
                "is_favorite": data.is_favorite,
                "status": data.status,
                "messages": messages,
                "created_at": data.created_at,
                "updated_at": data.updated_at,
            }
        return data


class ConversationUpdate(BaseModel):
    """更新对话"""

    title: str | None = Field(default=None, max_length=200)
    is_favorite: bool | None = None
    status: Literal["active", "completed", "error"] | None = None


class ConversationListParams(BaseModel):
    """对话列表查询参数"""

    limit: int = Field(default=50, ge=1, le=100, description="返回数量")
    offset: int = Field(default=0, ge=0, description="偏移量")
    favorites: bool = Field(default=False, description="仅收藏")
    q: str | None = Field(default=None, max_length=100, description="搜索关键词")
