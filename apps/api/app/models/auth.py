"""认证相关模型"""
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator


class UserCreate(BaseModel):
    """用户注册请求"""

    email: EmailStr = Field(..., description="邮箱")
    password: str = Field(..., min_length=8, max_length=100, description="密码")
    display_name: str | None = Field(default=None, max_length=100, description="显示名称")

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("密码长度至少 8 位")
        if not any(c.isdigit() for c in v):
            raise ValueError("密码必须包含数字")
        if not any(c.isalpha() for c in v):
            raise ValueError("密码必须包含字母")
        return v


class UserLogin(BaseModel):
    """用户登录请求"""

    email: EmailStr = Field(..., description="邮箱")
    password: str = Field(..., description="密码")


class UserUpdate(BaseModel):
    """用户信息更新"""

    display_name: str | None = Field(default=None, max_length=100)
    avatar_url: str | None = Field(default=None, max_length=500)
    password: str | None = Field(default=None, min_length=8, max_length=100)


class UserResponse(BaseModel):
    """用户信息响应"""

    id: UUID
    email: EmailStr
    display_name: str | None
    avatar_url: str | None
    role: Literal["user", "admin"]
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class Token(BaseModel):
    """Token 响应"""

    access_token: str = Field(..., description="访问令牌")
    refresh_token: str = Field(..., description="刷新令牌")
    token_type: str = Field(default="bearer", description="令牌类型")
    expires_in: int = Field(..., description="过期时间（秒）")


class TokenPayload(BaseModel):
    """Token 载荷"""

    sub: str = Field(..., description="用户 ID")
    exp: int = Field(..., description="过期时间戳")
    type: Literal["access", "refresh"] = Field(..., description="令牌类型")


class TokenRefresh(BaseModel):
    """刷新令牌请求"""

    refresh_token: str = Field(..., description="刷新令牌")
