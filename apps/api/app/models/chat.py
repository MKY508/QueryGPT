"""聊天相关模型"""

from enum import StrEnum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.analysis_state import (
    TERMINAL_ANALYSIS_STATES,
    AnalysisState,
    parse_analysis_state,
)


class SSEEventType(StrEnum):
    """SSE 事件类型"""

    PROGRESS = "progress"
    THINKING = "thinking"  # 思考阶段
    RESULT = "result"
    VISUALIZATION = "visualization"
    PYTHON_OUTPUT = "python_output"  # Python 输出
    PYTHON_IMAGE = "python_image"  # Python 图表
    ERROR = "error"
    DONE = "done"


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
    def progress(
        cls,
        stage: str,
        message: str,
        *,
        analysis_state: AnalysisState | None = None,
        **extra: Any,
    ) -> "SSEEvent":
        """Keep the product state distinct from the current work step and prose."""
        state = analysis_state if analysis_state is not None else parse_analysis_state(stage)
        if state is not None:
            extra["analysis_state"] = AnalysisState(state).value
        return cls(
            type=SSEEventType.PROGRESS,
            data={"stage": stage, "message": message, **extra},
        )

    @property
    def is_terminal_progress(self) -> bool:
        return (
            self.type == SSEEventType.PROGRESS
            and parse_analysis_state(self.data.get("analysis_state")) in TERMINAL_ANALYSIS_STATES
        )

    @classmethod
    def result(
        cls,
        content: str,
        sql: str | None = None,
        python: str | None = None,
        data: list[dict] | None = None,
        rows_count: int | None = None,
        execution_time: float | None = None,
        **extra: Any,
    ) -> "SSEEvent":
        """创建结果事件"""
        return cls(
            type=SSEEventType.RESULT,
            data={
                "content": content,
                "sql": sql,
                "python": python,
                "data": data,
                "rows_count": rows_count,
                "execution_time": execution_time,
                **extra,
            },
        )

    @classmethod
    def visualization(cls, chart_type: str, chart_data: dict[str, Any]) -> "SSEEvent":
        """创建可视化事件"""
        if chart_data.get("version") == 1:
            if chart_data.get("type") != chart_type:
                raise ValueError("ChartSpec type does not match visualization event type")
            return cls(
                type=SSEEventType.VISUALIZATION,
                data={"chart": dict(chart_data)},
            )
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
    def error(cls, code: str, message: str, **extra: Any) -> "SSEEvent":
        """创建错误事件"""
        return cls(
            type=SSEEventType.ERROR,
            data={"code": code, "message": message, **extra},
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
    def python_output(cls, output: str, stream: str = "stdout") -> "SSEEvent":
        """创建 Python 输出事件"""
        return cls(
            type=SSEEventType.PYTHON_OUTPUT,
            data={"output": output, "stream": stream},
        )

    @classmethod
    def python_image(cls, image: str, format: str = "png") -> "SSEEvent":
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
    project_id: UUID | None = Field(default=None, description="项目 ID")
    language: Literal["zh", "en"] = Field(default="zh", description="语言")
    context_rounds: int = Field(default=5, ge=1, le=20, description="上下文轮数")


class ChatStopRequest(BaseModel):
    """停止聊天请求"""

    conversation_id: UUID = Field(..., description="对话 ID")
    client_stream_id: str = Field(
        ...,
        min_length=1,
        max_length=200,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
        description="本次流 ID",
    )


class BusinessConfirmationCommand(BaseModel):
    """Apply one typed business decision to a paused analysis run."""

    analysis_run_id: UUID = Field(..., description="等待确认的调查 ID")
    key: str = Field(..., min_length=1, max_length=160, description="业务口径键")
    selected_option: str = Field(..., min_length=1, max_length=1000, description="用户选中的选项")


class BusinessConfirmationResponse(BaseModel):
    """A persisted decision that can continue the same analysis run."""

    analysis_run_id: UUID
    resume_run_id: UUID
    project_id: UUID
    conversation_id: UUID
    key: str
    selected_option: str
    state: Literal["waiting_confirmation"] = "waiting_confirmation"
    stage: Literal["confirmation_received"] = "confirmation_received"
    ready_to_continue: bool = True


class ChatStreamParams(BaseModel):
    """聊天流式请求参数（Query Params）"""

    query: str = Field(..., min_length=1, max_length=10000, description="查询内容")
    model: str | None = Field(default=None, description="模型 ID")
    conversation_id: UUID | None = Field(default=None, description="对话 ID")
    connection_id: UUID | None = Field(default=None, description="数据库连接 ID")
    project_id: UUID | None = Field(default=None, description="项目 ID")
    client_stream_id: str | None = Field(
        default=None,
        min_length=1,
        max_length=200,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
        description="本次流 ID",
    )
    language: Literal["zh", "en"] = Field(default="zh", description="语言")
    context_rounds: int = Field(default=5, ge=1, le=20, description="上下文轮数")


class SemanticValidationSelectionItem(BaseModel):
    """One exact semantic head selected for a real-data validation run."""

    entry_id: UUID
    expected_active_revision_id: UUID


class ChatStreamRequest(BaseModel):
    """Streaming chat payload kept out of the URL and access logs."""

    query: str | None = Field(default=None, min_length=1, max_length=10000)
    model: str | None = None
    conversation_id: UUID | None = None
    connection_id: UUID | None = None
    project_id: UUID | None = None
    resume_run_id: UUID | None = None
    correction_id: UUID | None = None
    client_stream_id: str | None = Field(
        default=None,
        min_length=1,
        max_length=200,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    )
    semantic_validation_selection: list[SemanticValidationSelectionItem] = Field(
        default_factory=list,
        max_length=100,
    )
    language: Literal["zh", "en"] = "zh"
    context_rounds: int | None = Field(default=None, ge=1, le=20)
