"""
gptme 执行引擎封装
使用 LiteLLM 进行 AI 调用，支持 SQL 和 Python 代码执行
"""

from __future__ import annotations

import time
from collections.abc import AsyncGenerator, Callable
from pathlib import Path
from typing import Any

import structlog

from app.core.config import settings
from app.models import SSEEvent
from app.services.database import create_database_manager
from app.services.engine_content import (
    clean_content_for_display,
    extract_chart_config,
    extract_python_block,
    extract_sql_block,
    parse_thinking_markers,
)
from app.services.engine_diagnostics import (
    DiagnosticEntry,
    build_diagnostic_entry,
    categorize_generation_failure,
    categorize_python_error,
    categorize_sql_error,
)
from app.services.engine_prompts import (
    build_db_context,
    build_initial_messages,
    build_missing_sql_prompt,
    build_python_repair_prompt,
    build_repair_messages,
    build_sql_repair_prompt,
)
from app.services.engine_visualization import build_chart_from_config, generate_visualization
from app.services.engine_workflow import EngineRunState, WorkflowDecision
from app.services.python_runtime import (
    PythonExecutionRuntime,
    PythonSecurityAnalyzer,
    validate_python_code,
)

logger = structlog.get_logger()

MAX_AUTO_REPAIR_ATTEMPTS = 4

__all__ = ["GptmeEngine", "PythonSecurityAnalyzer", "StopRequestedError"]


class StopRequestedError(RuntimeError):
    """用户主动停止当前执行"""


class GptmeEngine:
    """AI 执行引擎"""

    def __init__(
        self,
        model: str | None = None,
        provider: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
        headers: dict[str, str] | None = None,
        query_params: dict[str, str] | None = None,
        timeout: int = 300,
        python_enabled: bool = True,
        diagnostics_enabled: bool = True,
        auto_repair_enabled: bool = True,
        available_python_libraries: list[str] | None = None,
        analytics_installed: bool = False,
    ):
        self.model = model or settings.GPTME_MODEL or settings.DEFAULT_MODEL
        self.provider = provider
        self.api_key = api_key or settings.OPENAI_API_KEY
        self.base_url = base_url or settings.OPENAI_BASE_URL
        self.headers = headers or {}
        self.query_params = query_params or {}
        self.timeout = timeout or settings.GPTME_TIMEOUT
        self.python_enabled = python_enabled
        self.diagnostics_enabled = diagnostics_enabled
        self.auto_repair_enabled = auto_repair_enabled
        self.available_python_libraries = available_python_libraries or [
            "pandas",
            "numpy",
            "matplotlib",
        ]
        self.analytics_installed = analytics_installed
        self._python_runtime = PythonExecutionRuntime(
            available_python_libraries=self.available_python_libraries,
            analytics_installed=self.analytics_installed,
            font_path=str(
                Path(__file__).resolve().parent.parent
                / "assets"
                / "fonts"
                / "NotoSansSC-Regular.ttf"
            ),
        )
        self._ipython = None
        self._sql_data: dict[str, Any] = {}

    def _diagnostics_payload(
        self,
        diagnostics: list[dict[str, Any]],
    ) -> list[dict[str, Any]] | None:
        return diagnostics if self.diagnostics_enabled else None

    def _diagnostic_entry_payload(self, entry: dict[str, Any]) -> dict[str, Any] | None:
        return entry if self.diagnostics_enabled else None

    def _get_ipython(self):
        """获取或创建 IPython 实例"""
        if self._ipython is None:
            self._ipython = self._python_runtime.get_ipython()
        return self._ipython

    def _inject_sql_data(self, name: str, data: list[dict[str, Any]]) -> None:
        """将 SQL 结果注入 Python 环境"""
        self._python_runtime.inject_sql_data(name, data)
        self._ipython = self._python_runtime.ipython
        self._sql_data = self._python_runtime.sql_data

    def _validate_python_code(self, code: str) -> tuple[bool, str | None]:
        """验证 Python 代码安全性"""
        return validate_python_code(code)

    def _validate_python_dependencies(self, code: str) -> tuple[bool, str | None]:
        """检查 Python 代码引用的库是否已安装"""
        return self._python_runtime.validate_dependencies(code)

    def _parse_thinking(self, content: str) -> list[str]:
        return parse_thinking_markers(content)

    def _extract_python(self, content: str) -> str | None:
        return extract_python_block(content)

    def _clean_content_for_display(self, content: str) -> str:
        return clean_content_for_display(content)

    def _build_initial_messages(
        self,
        query: str,
        system_prompt: str,
        db_config: dict[str, Any] | None = None,
        history: list[dict[str, str]] | None = None,
    ) -> list[dict[str, str]]:
        db_context = self._build_db_context(db_config) if db_config else None
        return build_initial_messages(
            query=query,
            system_prompt=system_prompt,
            db_context=db_context,
            history=history,
        )

    def _build_sql_repair_prompt(
        self,
        query: str,
        failed_sql: str | None,
        error_message: str,
    ) -> str:
        return build_sql_repair_prompt(query, failed_sql, error_message)

    def _build_missing_sql_prompt(self, query: str) -> str:
        return build_missing_sql_prompt(query)

    def _build_python_repair_prompt(
        self,
        query: str,
        failed_sql: str | None,
        failed_python: str | None,
        error_message: str,
    ) -> str:
        return build_python_repair_prompt(
            query=query,
            failed_sql=failed_sql,
            failed_python=failed_python,
            error_message=error_message,
            available_python_libraries=self.available_python_libraries,
        )

    def _build_repair_messages(
        self,
        query: str,
        system_prompt: str,
        previous_content: str,
        repair_prompt: str,
        db_config: dict[str, Any] | None = None,
        history: list[dict[str, str]] | None = None,
    ) -> list[dict[str, str]]:
        db_context = self._build_db_context(db_config) if db_config else None
        return build_repair_messages(
            query=query,
            system_prompt=system_prompt,
            previous_content=previous_content,
            repair_prompt=repair_prompt,
            db_context=db_context,
            history=history,
        )

    async def _stream_completion(
        self,
        messages: list[dict[str, str]],
        *,
        phase: str,
        attempt: int,
        content_holder: list[str],
        stop_checker: Callable[[], bool] | None = None,
    ) -> AsyncGenerator[SSEEvent, None]:
        import litellm

        response = await litellm.acompletion(
            model=self.model,
            custom_llm_provider=self.provider,
            messages=messages,
            stream=True,
            api_key=self.api_key,
            base_url=self.base_url,
            extra_headers=self.headers or None,
            extra_query=self.query_params or None,
        )

        full_content = ""
        sent_thinking: set[str] = set()

        async for chunk in response:
            if stop_checker and stop_checker():
                raise StopRequestedError("查询已取消")

            delta = chunk.choices[0].delta
            if not delta.content:
                continue

            full_content += delta.content
            for thinking in parse_thinking_markers(full_content):
                if thinking not in sent_thinking:
                    yield SSEEvent.thinking(thinking, detail=f"{phase}:{attempt}")
                    sent_thinking.add(thinking)

        content_holder.append(full_content)

    def _build_diagnostic_entry(
        self,
        *,
        attempt: int,
        phase: str,
        status: str,
        message: str,
        error_code: str | None = None,
        error_category: str | None = None,
        recoverable: bool | None = None,
        sql: str | None = None,
        python: str | None = None,
    ) -> DiagnosticEntry:
        return build_diagnostic_entry(
            attempt=attempt,
            phase=phase,
            status=status,
            message=message,
            error_code=error_code,
            error_category=error_category,
            recoverable=recoverable,
            sql=sql,
            python=python,
        )

    def _categorize_generation_failure(self, message: str) -> tuple[str, str, bool]:
        return categorize_generation_failure(message)

    def _categorize_sql_error(self, message: str) -> tuple[str, str, bool]:
        return categorize_sql_error(message)

    def _categorize_python_error(self, message: str) -> tuple[str, str, bool]:
        return categorize_python_error(message)

    def _new_run_state(
        self,
        *,
        query: str,
        system_prompt: str,
        db_config: dict[str, Any] | None,
        history: list[dict[str, str]] | None,
    ) -> EngineRunState:
        db_context = self._build_db_context(db_config) if db_config else None
        max_attempts = MAX_AUTO_REPAIR_ATTEMPTS if self.auto_repair_enabled else 1
        return EngineRunState(
            query=query,
            system_prompt=system_prompt,
            db_config=db_config,
            db_context=db_context,
            history=history,
            completion_messages=build_initial_messages(
                query=query,
                system_prompt=system_prompt,
                db_context=db_context,
                history=history,
            ),
            max_attempts=max_attempts,
        )

    def _record_diagnostic(
        self,
        state: EngineRunState,
        *,
        phase: str,
        status: str,
        message: str,
        error_code: str | None = None,
        error_category: str | None = None,
        recoverable: bool | None = None,
        sql: str | None = None,
        python: str | None = None,
        attempt: int | None = None,
    ) -> DiagnosticEntry:
        diagnostic = self._build_diagnostic_entry(
            attempt=attempt or state.attempt,
            phase=phase,
            status=status,
            message=message,
            error_code=error_code,
            error_category=error_category,
            recoverable=recoverable,
            sql=sql,
            python=python,
        )
        state.diagnostics.append(diagnostic)
        return diagnostic

    def _diagnostic_progress(
        self,
        *,
        stage: str,
        phase: str,
        attempt: int,
        diagnostic: DiagnosticEntry,
    ) -> SSEEvent:
        return SSEEvent.progress(
            stage,
            diagnostic["message"],
            attempt=attempt,
            phase=phase,
            diagnostic_entry=self._diagnostic_entry_payload(diagnostic),
        )

    def _schedule_retry(
        self,
        state: EngineRunState,
        *,
        phase: str,
        stage: str,
        message: str,
        error_code: str,
        error_category: str,
        completion_messages: list[dict[str, str]],
        sql: str | None = None,
        python: str | None = None,
    ) -> WorkflowDecision:
        next_attempt = state.schedule_retry(completion_messages)
        repair_entry = self._record_diagnostic(
            state,
            attempt=next_attempt,
            phase=phase,
            status="repaired",
            message=message,
            error_code=error_code,
            error_category=error_category,
            recoverable=True,
            sql=sql,
            python=python,
        )
        return WorkflowDecision(
            status="retry",
            events=[
                self._diagnostic_progress(
                    stage=stage,
                    phase=phase,
                    attempt=next_attempt,
                    diagnostic=repair_entry,
                )
            ],
        )

    def _queue_repair(
        self,
        state: EngineRunState,
        *,
        phase: str,
        stage: str,
        repair_message: str,
        error_code: str,
        error_category: str,
        repair_prompt: str,
        sql: str | None = None,
        python: str | None = None,
    ) -> WorkflowDecision:
        completion_messages = build_repair_messages(
            query=state.query,
            system_prompt=state.system_prompt,
            previous_content=state.full_content,
            repair_prompt=repair_prompt,
            db_context=state.db_context,
            history=state.history,
        )
        return self._schedule_retry(
            state,
            phase=phase,
            stage=stage,
            message=repair_message,
            error_code=error_code,
            error_category=error_category,
            completion_messages=completion_messages,
            sql=sql,
            python=python,
        )

    def _handle_generation_failure(
        self,
        state: EngineRunState,
        error: Exception,
    ) -> WorkflowDecision:
        code, category, recoverable = self._categorize_generation_failure(str(error))
        diagnostic = self._record_diagnostic(
            state,
            phase="generate",
            status="error",
            message=f"模型生成失败: {error}",
            error_code=code,
            error_category=category,
            recoverable=recoverable,
        )
        events = [
            self._diagnostic_progress(
                stage="generating",
                phase="generate",
                attempt=state.attempt,
                diagnostic=diagnostic,
            )
        ]

        if recoverable and state.can_retry():
            retry = self._schedule_retry(
                state,
                phase="generate",
                stage="generating",
                message="模型调用失败，正在自动重试。",
                error_code=code,
                error_category=category,
                completion_messages=state.completion_messages,
            )
            events.extend(retry.events)
            return WorkflowDecision(status="retry", events=events)

        events.append(
            SSEEvent.error(
                code,
                str(error),
                error_category=category,
                failed_stage="generate",
                attempt=state.attempt,
                diagnostics=self._diagnostics_payload(state.diagnostics),
            )
        )
        return WorkflowDecision(status="halt", events=events)

    def _handle_missing_sql(self, state: EngineRunState) -> WorkflowDecision:
        if not state.db_config or state.final_sql:
            return WorkflowDecision()

        diagnostic = self._record_diagnostic(
            state,
            phase="generate",
            status="error",
            message="模型回复缺少可执行 SQL，正在自动补全。",
            error_code="MISSING_SQL",
            error_category="sql",
            recoverable=state.can_retry(),
        )
        events = [
            self._diagnostic_progress(
                stage="generating",
                phase="generate",
                attempt=state.attempt,
                diagnostic=diagnostic,
            )
        ]

        if not state.can_retry():
            events.append(
                SSEEvent.error(
                    "MISSING_SQL",
                    "模型没有生成可执行 SQL。",
                    error_category="sql",
                    failed_stage="generate",
                    attempt=state.attempt,
                    diagnostics=self._diagnostics_payload(state.diagnostics),
                )
            )
            return WorkflowDecision(status="halt", events=events)

        retry = self._queue_repair(
            state,
            phase="generate",
            stage="generating",
            repair_message="已触发 SQL 自动补全。",
            error_code="MISSING_SQL",
            error_category="sql",
            repair_prompt=self._build_missing_sql_prompt(state.query),
        )
        events.extend(retry.events)
        return WorkflowDecision(status="retry", events=events)

    async def _run_sql_phase(self, state: EngineRunState) -> WorkflowDecision:
        if not state.final_sql or not state.db_config:
            return WorkflowDecision()

        events = [
            SSEEvent.progress(
                "executing_sql",
                "正在执行 SQL 查询...",
                attempt=state.attempt,
                phase="sql",
            )
        ]
        start_time = time.time()

        try:
            state.final_data, state.final_rows_count = await self._execute_sql(
                state.final_sql,
                state.db_config,
            )
            state.final_execution_time = time.time() - start_time

            if state.final_data:
                self._inject_sql_data("df", state.final_data)
                self._inject_sql_data("query_result", state.final_data)

            diagnostic = self._record_diagnostic(
                state,
                phase="sql",
                status="success",
                message=f"SQL 执行成功，返回 {state.final_rows_count or 0} 行。",
                sql=state.final_sql,
            )
            events.append(
                self._diagnostic_progress(
                    stage="executing_sql",
                    phase="sql",
                    attempt=state.attempt,
                    diagnostic=diagnostic,
                )
            )
            return WorkflowDecision(events=events)
        except Exception as exc:
            code, category, recoverable = self._categorize_sql_error(str(exc))
            diagnostic = self._record_diagnostic(
                state,
                phase="sql",
                status="error",
                message=f"SQL 执行失败: {exc}",
                error_code=code,
                error_category=category,
                recoverable=recoverable,
                sql=state.final_sql,
            )
            events.append(
                self._diagnostic_progress(
                    stage="executing_sql",
                    phase="sql",
                    attempt=state.attempt,
                    diagnostic=diagnostic,
                )
            )

            if recoverable and state.can_retry():
                retry = self._queue_repair(
                    state,
                    phase="sql",
                    stage="executing_sql",
                    repair_message="SQL 失败可恢复，正在自动修复并重试。",
                    error_code=code,
                    error_category=category,
                    repair_prompt=self._build_sql_repair_prompt(
                        query=state.query,
                        failed_sql=state.final_sql,
                        error_message=str(exc),
                    ),
                    sql=state.final_sql,
                )
                events.extend(retry.events)
                return WorkflowDecision(status="retry", events=events)

            events.append(
                SSEEvent.error(
                    code,
                    f"SQL 执行失败: {exc}",
                    error_category=category,
                    failed_stage="sql",
                    attempt=state.attempt,
                    diagnostics=self._diagnostics_payload(state.diagnostics),
                )
            )
            return WorkflowDecision(status="halt", events=events)

    async def _run_python_phase(self, state: EngineRunState) -> WorkflowDecision:
        if not state.final_python:
            return WorkflowDecision()

        if not self.python_enabled:
            diagnostic = self._record_diagnostic(
                state,
                phase="python",
                status="error",
                message="Python 分析已在设置中关闭，已跳过 Python 执行。",
                error_code="PYTHON_DISABLED",
                error_category="python",
                recoverable=False,
                python=state.final_python,
            )
            state.final_python = None
            return WorkflowDecision(
                events=[
                    self._diagnostic_progress(
                        stage="executing_python",
                        phase="python",
                        attempt=state.attempt,
                        diagnostic=diagnostic,
                    )
                ]
            )

        events = [
            SSEEvent.progress(
                "executing_python",
                "正在执行 Python 分析...",
                attempt=state.attempt,
                phase="python",
            )
        ]
        logger.debug("Executing Python code", attempt=state.attempt)

        try:
            state.python_output, state.python_images = await self._execute_python(
                state.final_python
            )
            diagnostic = self._record_diagnostic(
                state,
                phase="python",
                status="success",
                message="Python 分析执行完成。",
                python=state.final_python,
            )
            events.append(
                self._diagnostic_progress(
                    stage="executing_python",
                    phase="python",
                    attempt=state.attempt,
                    diagnostic=diagnostic,
                )
            )
            if state.python_output:
                events.append(SSEEvent.python_output(state.python_output, "stdout"))
            for image in state.python_images:
                events.append(SSEEvent.python_image(image, "png"))
            return WorkflowDecision(events=events)
        except Exception as exc:
            code, category, recoverable = self._categorize_python_error(str(exc))
            diagnostic = self._record_diagnostic(
                state,
                phase="python",
                status="error",
                message=f"Python 执行失败: {exc}",
                error_code=code,
                error_category=category,
                recoverable=recoverable,
                sql=state.final_sql,
                python=state.final_python,
            )
            events.append(
                self._diagnostic_progress(
                    stage="executing_python",
                    phase="python",
                    attempt=state.attempt,
                    diagnostic=diagnostic,
                )
            )

            if recoverable and state.can_retry():
                retry = self._queue_repair(
                    state,
                    phase="python",
                    stage="executing_python",
                    repair_message="Python 失败可恢复，正在自动修复并重试。",
                    error_code=code,
                    error_category=category,
                    repair_prompt=self._build_python_repair_prompt(
                        query=state.query,
                        failed_sql=state.final_sql,
                        failed_python=state.final_python,
                        error_message=str(exc),
                    ),
                    sql=state.final_sql,
                    python=state.final_python,
                )
                events.extend(retry.events)
                return WorkflowDecision(status="retry", events=events)

            events.append(
                SSEEvent.error(
                    code,
                    f"Python 执行失败: {exc}",
                    error_category=category,
                    failed_stage="python",
                    attempt=state.attempt,
                    diagnostics=self._diagnostics_payload(state.diagnostics),
                )
            )
            return WorkflowDecision(status="halt", events=events)

    @staticmethod
    def _visualization_event(payload: dict[str, Any]) -> SSEEvent:
        return SSEEvent.visualization(
            chart_type=payload.get("type", "bar"),
            chart_data={
                "data": payload.get("data", []),
                "xKey": payload.get("xKey"),
                "yKeys": payload.get("yKeys"),
                "title": payload.get("title"),
            },
        )

    def _emit_visualization_events(
        self,
        state: EngineRunState,
        query: str,
    ) -> list[SSEEvent]:
        if not state.final_data:
            return []

        events: list[SSEEvent] = []
        if state.chart_config:
            visualization = build_chart_from_config(state.chart_config, state.final_data)
            if visualization:
                diagnostic = self._record_diagnostic(
                    state,
                    phase="chart",
                    status="success",
                    message="已按模型提供的图表配置生成可视化。",
                )
                events.append(
                    self._diagnostic_progress(
                        stage="visualizing",
                        phase="chart",
                        attempt=state.attempt,
                        diagnostic=diagnostic,
                    )
                )
                events.append(self._visualization_event(visualization))
                return events

            fallback = self._record_diagnostic(
                state,
                phase="chart",
                status="repaired",
                message="模型图表配置无效，已回退到自动图表生成。",
                error_code="CHART_CONFIG_INVALID",
                error_category="chart",
                recoverable=True,
            )
            events.append(
                self._diagnostic_progress(
                    stage="visualizing",
                    phase="chart",
                    attempt=state.attempt,
                    diagnostic=fallback,
                )
            )

        visualization = generate_visualization(state.final_data, query)
        if visualization:
            events.append(self._visualization_event(visualization))
        return events

    async def execute(
        self,
        query: str,
        system_prompt: str,
        db_config: dict[str, Any] | None = None,
        history: list[dict[str, str]] | None = None,
        stop_checker: Callable[[], bool] | None = None,
    ) -> AsyncGenerator[SSEEvent, None]:
        """执行查询并流式返回结果。"""
        logger.info("GptmeEngine.execute called", model=self.model, query_preview=query[:50])

        try:
            yield SSEEvent.progress(
                "initializing",
                "正在初始化 AI 引擎...",
                attempt=1,
                phase="initializing",
            )
            async for event in self._execute_with_litellm(
                query=query,
                system_prompt=system_prompt,
                db_config=db_config,
                history=history,
                stop_checker=stop_checker,
            ):
                yield event
        except StopRequestedError as exc:
            yield SSEEvent.error(
                "CANCELLED",
                str(exc),
                error_category="cancelled",
                failed_stage="cancelled",
                attempt=1,
            )
        except Exception as exc:
            code, category, _ = self._categorize_generation_failure(str(exc))
            yield SSEEvent.error(
                code,
                str(exc),
                error_category=category,
                failed_stage="engine",
                attempt=1,
            )

    async def _execute_with_litellm(
        self,
        query: str,
        system_prompt: str,
        db_config: dict[str, Any] | None = None,
        history: list[dict[str, str]] | None = None,
        stop_checker: Callable[[], bool] | None = None,
    ) -> AsyncGenerator[SSEEvent, None]:
        """使用 LiteLLM 执行查询。"""
        state = self._new_run_state(
            query=query,
            system_prompt=system_prompt,
            db_config=db_config,
            history=history,
        )

        while state.attempt <= state.max_attempts:
            yield SSEEvent.progress(
                "generating",
                "正在生成响应..."
                if state.attempt == 1
                else f"正在进行第 {state.attempt} 次自动修复...",
                attempt=state.attempt,
                phase="generate",
            )

            content_holder: list[str] = []
            try:
                async for event in self._stream_completion(
                    state.completion_messages,
                    phase="generate",
                    attempt=state.attempt,
                    content_holder=content_holder,
                    stop_checker=stop_checker,
                ):
                    yield event
            except StopRequestedError:
                raise
            except Exception as exc:
                decision = self._handle_generation_failure(state, exc)
                for event in decision.events:
                    yield event
                if decision.status == "retry":
                    continue
                return

            state.load_completion(content_holder[0] if content_holder else "")
            logger.debug(
                "AI content extracted",
                content_length=len(state.full_content),
                has_sql=bool(state.final_sql),
                has_python=bool(state.final_python),
            )

            decision = self._handle_missing_sql(state)
            for event in decision.events:
                yield event
            if decision.status == "retry":
                continue
            if decision.status == "halt":
                return

            decision = await self._run_sql_phase(state)
            for event in decision.events:
                yield event
            if decision.status == "retry":
                continue
            if decision.status == "halt":
                return

            decision = await self._run_python_phase(state)
            for event in decision.events:
                yield event
            if decision.status == "retry":
                continue
            if decision.status == "halt":
                return

            yield SSEEvent.result(
                content=clean_content_for_display(state.full_content) or "分析完成",
                sql=state.final_sql,
                data=state.final_data,
                rows_count=state.final_rows_count,
                execution_time=state.final_execution_time,
                diagnostics=self._diagnostics_payload(state.diagnostics),
            )

            if state.python_images:
                return

            for event in self._emit_visualization_events(state, query):
                yield event
            return

    async def _execute_sql(
        self,
        sql: str,
        db_config: dict[str, Any],
    ) -> tuple[list[dict[str, Any]] | None, int | None]:
        """执行 SQL 查询"""
        db_manager = create_database_manager(db_config)
        result = db_manager.execute_query(sql, read_only=True)
        return result.data, result.rows_count

    async def _execute_python(self, code: str, timeout: int = 30) -> tuple[str | None, list[str]]:
        output = await self._python_runtime.execute(code, timeout=timeout)
        self._ipython = self._python_runtime.ipython
        self._sql_data = self._python_runtime.sql_data
        return output

    def _execute_python_sync(self, code: str) -> tuple[str | None, list[str]]:
        output = self._python_runtime.execute_sync(code)
        self._ipython = self._python_runtime.ipython
        self._sql_data = self._python_runtime.sql_data
        return output

    def _build_chart_from_config(
        self,
        config: dict[str, Any],
        data: list[dict[str, Any]],
    ) -> dict[str, Any] | None:
        return build_chart_from_config(config, data)

    def _generate_visualization(
        self,
        data: list[dict[str, Any]],
        query: str,
    ) -> dict[str, Any] | None:
        return generate_visualization(data, query)

    def _build_db_context(self, db_config: dict[str, Any]) -> str:
        return build_db_context(db_config, self._get_schema_info(db_config))

    def _get_schema_info(self, db_config: dict[str, Any]) -> str:
        db_manager = create_database_manager(db_config)
        return db_manager.get_schema_info()

    def _extract_sql(self, content: str) -> str | None:
        return extract_sql_block(content)

    def _extract_chart_config(self, content: str) -> dict[str, Any] | None:
        return extract_chart_config(content)


_engine: GptmeEngine | None = None


def get_engine() -> GptmeEngine:
    """获取全局引擎实例"""
    global _engine
    if _engine is None:
        _engine = GptmeEngine()
    return _engine
