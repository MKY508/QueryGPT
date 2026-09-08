"""Mutable investigation state and scoped capabilities; independent of the model loop."""

from __future__ import annotations

import asyncio
import copy
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from app.i18n import get_progress_message
from app.models.analysis_state import AnalysisState
from app.services.dependency_manager import ProjectDependencyManager
from app.services.execution_policy import ExecutionPolicy
from app.services.project_context import (
    ProjectRuntimeContext,
)
from app.services.python_sandbox import PythonSandbox
from app.services.semantic_adapter import SemanticEngineAdapter


@dataclass(slots=True)
class AnalystSession:
    project: ProjectRuntimeContext
    python_sandbox: PythonSandbox
    dependency_manager: ProjectDependencyManager
    dataframes: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    result_metadata: dict[str, dict[str, Any]] = field(default_factory=dict)
    tool_history: list[dict[str, Any]] = field(default_factory=list)
    replay_journal: list[dict[str, Any]] = field(default_factory=list)
    python_output: list[str] = field(default_factory=list)
    python_images: list[str] = field(default_factory=list)
    knowledge_proposals: list[dict[str, Any]] = field(default_factory=list)
    validated_results: set[str] = field(default_factory=set)
    protected_results: dict[str, dict[str, str]] = field(default_factory=dict)
    semantic_scope_receipts: dict[str, dict[str, Any]] = field(default_factory=dict)
    user_confirmation: bool = False
    pending_confirmation: dict[str, Any] | None = None
    current_query: str = ""
    progress_queue: asyncio.Queue[dict[str, str]] = field(
        default_factory=asyncio.Queue,
        repr=False,
    )
    policy: ExecutionPolicy = field(default_factory=ExecutionPolicy)
    language: str = "zh"
    checkpoint_callback: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]] | None = field(
        default=None, repr=False
    )
    semantic_adapter: SemanticEngineAdapter = field(init=False, repr=False)
    _resume_blocker_reason: str | None = field(default=None, init=False, repr=False)
    _last_progress_message: str | None = field(default=None, init=False, repr=False)

    def __post_init__(self) -> None:
        self.semantic_adapter = SemanticEngineAdapter(self.project)

    def queue_progress(self, step: str) -> None:
        """Expose a business milestone without leaking tool internals or model reasoning."""

        normalized = step.strip()
        if not normalized or normalized == self._last_progress_message:
            return
        self._last_progress_message = normalized
        self.progress_queue.put_nowait(
            {
                "stage": AnalysisState.INVESTIGATING,
                "step": normalized,
                "message": get_progress_message(normalized, self.language),
            }
        )

    async def checkpoint(
        self,
        *,
        resumable: bool = True,
        reason: str | None = None,
    ) -> None:
        if not resumable and self._resume_blocker_reason is None:
            self._resume_blocker_reason = reason or "non_replayable_tool_state"
        effective_resumable = self._resume_blocker_reason is None
        effective_reason = None if effective_resumable else self._resume_blocker_reason
        if self.checkpoint_callback is None or not self.policy.diagnostics_enabled:
            return
        # Checkpoint serialization runs in a worker thread. Never hand that thread
        # references to state that another tool call can still mutate.
        snapshot = copy.deepcopy(
            {
                "safe_boundary": "after_tool",
                "stage": AnalysisState.INVESTIGATING,
                "analysis_state": AnalysisState.INVESTIGATING,
                # Resumability is monotonic within a run. Once Python or package
                # installation introduces state we cannot replay, a later SQL or
                # knowledge tool must not accidentally advertise a safe resume.
                "resumable": effective_resumable,
                "reason": effective_reason,
                "dataframes": self.dataframes,
                "result_metadata": self.result_metadata,
                "tool_history": self.tool_history,
                "replay_journal": self.replay_journal,
                "validated_results": sorted(self.validated_results),
                "knowledge_proposals": self.knowledge_proposals,
                "python_output": self.python_output,
                "python_images": self.python_images,
            }
        )
        await self.checkpoint_callback(snapshot)

    def diagnostic_error(self, error: BaseException) -> str:
        if self.policy.diagnostics_enabled:
            return str(error)
        return type(error).__name__
