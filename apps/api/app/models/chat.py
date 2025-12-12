"""聊天相关模型"""

from enum import Enum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class SSEEventType(str, Enum):
    """SSE 事件类型"""

    PROGRESS = "progress"
    THINKING = "thinking"  # 思考阶段
    RESULT = "result"
    VISUALIZATION = "visualization"
    PYTHON_OUTPUT = "python_output"  # Python 输出
    PYTHON_IMAGE = "python_image"  # Python 图表
    ERROR = "error"
    DONE = "done"


class ProgressStage(str, Enum):
    """进度阶段"""

    START = "start"
    ANALYZING = "analyzing"
    ROUTING = "routing"
    GENERATING_SQL = "generating_sql"
    EXECUTING = "executing"
    PROCESSING = "processing"
    VISUALIZING = "visualizing"
    SUMMARIZING = "summarizing"


class SSEEvent(BaseModel):
    """SSE 事件"""

    type: SSEEventType = Field(..., description="事件类型")
    data: dict[str, Any] = Field(default_factory=dict, description="事件数据")

    def to_sse(self) -> dict:
        """转换为 SSE 格式 (返回字典，由 sse_starlette 自动序列化)"""
        import json

        # sse_starlette 期望 {"data": ...} 格式
        # data 的值会被自动序列化为 JSON
        payload = {"type": self.type.value, "data": self.data}
        return {"data": json.dumps(payload, ensure_ascii=False)}

    @classmethod
    def progress(cls, stage: str, message: str, **extra: Any) -> "SSEEvent":
        """创建进度事件"""
        return cls(
            type=SSEEventType.PROGRESS,
            data={"stage": stage, "message": message, **extra},
        )

    @classmethod
    def result(
        cls,
        content: str,
        sql: str | None = None,
        data: list[dict] | None = None,
        rows_count: int | None = None,
        execution_time: float | None = None,
    ) -> "SSEEvent":
        """创建结果事件"""
        return cls(
            type=SSEEventType.RESULT,
            data={
                "content": content,
                "sql": sql,
                "data": data,
                "rows_count": rows_count,
                "execution_time": execution_time,
            },
        )

    @classmethod
    def visualization(cls, chart_type: str, chart_data: dict[str, Any]) -> "SSEEvent":
        """创建可视化事件"""
        return cls(
            type=SSEEventType.VISUALIZATION,
            data={
                "chart": {
                    "type": chart_type,
                    "data": chart_data.get("data", []),
                    "xKey": chart_data.get("xKey"),
                    "yKeys": chart_data.get("yKeys"),
                    "title": chart_data.get("title"),
                }
            },
        )

    @classmethod
    def error(cls, code: str, message: str) -> "SSEEvent":
        """创建错误事件"""
        return cls(
            type=SSEEventType.ERROR,
            data={"code": code, "message": message},
        )

    @classmethod
    def done(
        cls,
        conversation_id: UUID | str,
        message_id: UUID | str | None = None,
    ) -> "SSEEvent":
        """创建完成事件"""
        return cls(
            type=SSEEventType.DONE,
            data={
                "conversation_id": str(conversation_id),
                "message_id": str(message_id) if message_id else None,
            },
        )

    @classmethod
    def thinking(cls, stage: str, detail: str | None = None) -> "SSEEvent":
        """创建思考阶段事件"""
        return cls(
            type=SSEEventType.THINKING,
            data={"stage": stage, "detail": detail},
        )

    @classmethod
    def python_output(
        cls, output: str, stream: str = "stdout"
    ) -> "SSEEvent":
        """创建 Python 输出事件"""
        return cls(
            type=SSEEventType.PYTHON_OUTPUT,
            data={"output": output, "stream": stream},
        )

    @classmethod
    def python_image(
        cls, image: str, format: str = "png"
    ) -> "SSEEvent":
        """创建 Python 图表事件 (base64 编码)"""
        return cls(
            type=SSEEventType.PYTHON_IMAGE,
            data={"image": image, "format": format},
        )


class ChatRequest(BaseModel):
    """聊天请求（用于非流式 API）"""

    query: str = Field(..., min_length=1, max_length=10000, description="查询内容")
    model: str | None = Field(default=None, description="模型 ID")
    conversation_id: UUID | None = Field(default=None, description="对话 ID")
    connection_id: UUID | None = Field(default=None, description="数据库连接 ID")
    language: Literal["zh", "en"] = Field(default="zh", description="语言")
    context_rounds: int = Field(default=3, ge=0, le=10, description="上下文轮数")


class ChatStopRequest(BaseModel):
    """停止聊天请求"""

    conversation_id: UUID = Field(..., description="对话 ID")


class ChatStreamParams(BaseModel):
    """聊天流式请求参数（Query Params）"""

    query: str = Field(..., min_length=1, max_length=10000, description="查询内容")
    model: str | None = Field(default=None, description="模型 ID")
    conversation_id: UUID | None = Field(default=None, description="对话 ID")
    connection_id: UUID | None = Field(default=None, description="数据库连接 ID")
    language: Literal["zh", "en"] = Field(default="zh", description="语言")
