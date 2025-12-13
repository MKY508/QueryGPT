"""提示词相关模型"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class PromptCreate(BaseModel):
    """创建提示词请求"""

    name: str = Field(..., min_length=1, max_length=100, description="提示词名称")
    content: str = Field(..., min_length=1, description="提示词内容")
    description: str | None = Field(None, description="描述")
    is_default: bool = Field(False, description="是否设为默认")


class PromptUpdate(BaseModel):
    """更新提示词请求"""

    name: str | None = Field(None, min_length=1, max_length=100, description="提示词名称")
    content: str | None = Field(None, min_length=1, description="提示词内容")
    description: str | None = Field(None, description="描述")


class PromptResponse(BaseModel):
    """提示词响应"""

    id: UUID
    name: str
    content: str
    description: str | None
    version: int
    is_active: bool
    is_default: bool
    parent_id: UUID | None
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class PromptVersionResponse(BaseModel):
    """提示词版本响应"""

    id: UUID
    name: str
    version: int
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class PromptListResponse(BaseModel):
    """提示词列表响应"""

    items: list[PromptResponse]
    total: int
