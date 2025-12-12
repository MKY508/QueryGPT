"""通用响应模型"""
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class ErrorDetail(BaseModel):
    """错误详情"""

    code: str = Field(..., description="错误码")
    message: str = Field(..., description="错误信息")
    details: dict[str, Any] | None = Field(default=None, description="详细信息")


class APIResponse(BaseModel, Generic[T]):
    """统一 API 响应格式"""

    success: bool = Field(..., description="是否成功")
    data: T | None = Field(default=None, description="响应数据")
    error: ErrorDetail | None = Field(default=None, description="错误信息")
    message: str | None = Field(default=None, description="提示信息")

    @classmethod
    def ok(cls, data: T | None = None, message: str | None = None) -> "APIResponse[T]":
        """成功响应"""
        return cls(success=True, data=data, message=message)

    @classmethod
    def fail(
        cls,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> "APIResponse[None]":
        """失败响应"""
        return cls(
            success=False,
            error=ErrorDetail(code=code, message=message, details=details),
        )


class PaginatedResponse(BaseModel, Generic[T]):
    """分页响应"""

    items: list[T] = Field(..., description="数据列表")
    total: int = Field(..., description="总数")
    page: int = Field(default=1, description="当前页")
    page_size: int = Field(default=20, description="每页数量")
    has_more: bool = Field(..., description="是否有更多")

    @classmethod
    def create(
        cls,
        items: list[T],
        total: int,
        page: int = 1,
        page_size: int = 20,
    ) -> "PaginatedResponse[T]":
        """创建分页响应"""
        return cls(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            has_more=(page * page_size) < total,
        )
