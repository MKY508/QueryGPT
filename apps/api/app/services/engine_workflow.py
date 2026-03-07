"""State objects used by the chat execution workflow."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from app.models import SSEEvent
from app.services.engine_content import (
    extract_chart_config,
    extract_python_block,
    extract_sql_block,
)
from app.services.engine_diagnostics import DiagnosticEntry

WorkflowStatus = Literal["continue", "retry", "halt"]


@dataclass(slots=True)
class WorkflowDecision:
    """Decision returned by an execution phase."""

    status: WorkflowStatus = "continue"
    events: list[SSEEvent] = field(default_factory=list)


@dataclass(slots=True)
class EngineRunState:
    """Mutable state carried across generation, repair and execution attempts."""

    query: str
    system_prompt: str
    db_config: dict[str, Any] | None
    db_context: str | None
    history: list[dict[str, str]] | None
    completion_messages: list[dict[str, str]]
    max_attempts: int
    attempt: int = 1
    diagnostics: list[DiagnosticEntry] = field(default_factory=list)
    full_content: str = ""
    final_sql: str | None = None
    final_python: str | None = None
    chart_config: dict[str, Any] | None = None
    final_data: list[dict[str, Any]] | None = None
    final_rows_count: int | None = None
    final_execution_time: float | None = None
    python_output: str | None = None
    python_images: list[str] = field(default_factory=list)

    def can_retry(self) -> bool:
        return self.attempt < self.max_attempts

    def load_completion(self, content: str) -> None:
        self.full_content = content
        self.final_sql = extract_sql_block(content)
        self.final_python = extract_python_block(content)
        self.chart_config = extract_chart_config(content)
        self.final_data = None
        self.final_rows_count = None
        self.final_execution_time = None
        self.python_output = None
        self.python_images = []

    def schedule_retry(self, completion_messages: list[dict[str, str]]) -> int:
        self.completion_messages = completion_messages
        self.attempt += 1
        self.full_content = ""
        self.final_sql = None
        self.final_python = None
        self.chart_config = None
        self.final_data = None
        self.final_rows_count = None
        self.final_execution_time = None
        self.python_output = None
        self.python_images = []
        return self.attempt
