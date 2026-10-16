"""Killable, project-isolated Python execution for analysis tools."""

from __future__ import annotations

import ast
import asyncio
import contextlib
import importlib
import importlib.machinery
import importlib.util
import multiprocessing
import os
import sys
import time
from typing import Any
from uuid import uuid4

import structlog

logger = structlog.get_logger()

_SENSITIVE_ENV_SUFFIXES = ("_API_KEY", "_SECRET", "_TOKEN", "_PASSWORD")


def _scrub_sandbox_environment() -> None:
    for key in list(os.environ):
        upper_key = key.upper()
        if upper_key == "ENCRYPTION_KEY" or upper_key.endswith(_SENSITIVE_ENV_SUFFIXES):
            os.environ.pop(key, None)


def _sandbox_worker(connection: Any, extra_paths: list[str]) -> None:
    """Own the stateful IPython runtime inside a disposable child process."""

    _scrub_sandbox_environment()
    from app.services.python_runtime import PythonExecutionRuntime

    runtime = PythonExecutionRuntime(extra_paths=extra_paths)
    try:
        while True:
            try:
                request = connection.recv()
            except EOFError:
                break
            if request.get("operation") == "stop":
                break

            request_id = request.get("id")
            try:
                for name, rows in (request.get("sql_data") or {}).items():
                    runtime.inject_sql_data(name, rows)
                output, images = runtime.execute_sync(str(request.get("code") or ""))
                response = {
                    "id": request_id,
                    "status": "ok",
                    "output": output,
                    "images": images,
                }
            except (ValueError, RuntimeError, SyntaxError) as exc:
                response = {
                    "id": request_id,
                    "status": "error",
                    "error_type": type(exc).__name__,
                    "message": str(exc),
                }
            except Exception as exc:  # pragma: no cover - final worker boundary
                response = {
                    "id": request_id,
                    "status": "error",
                    "error_type": type(exc).__name__,
                    "message": f"Unexpected error during Python execution: {exc}",
                }
            try:
                connection.send(response)
            except (BrokenPipeError, EOFError, OSError):
                break
    finally:
        connection.close()


class PythonSandbox:
    """Run a stateful analysis session outside the API process.

    The worker persists across tool calls in one analysis run so intermediate
    Python variables remain available. A timeout, cancellation or broken pipe
    terminates the whole worker, which means runaway code cannot keep consuming
    CPU after the API has reported a failure.
    """

    def __init__(self, language: str = "zh", extra_paths: list[str] | None = None):
        self.language = language
        self.extra_paths = extra_paths or []
        self._process: Any | None = None
        self._connection: Any | None = None
        self._lock = asyncio.Lock()

    def missing_modules(self, code: str) -> list[str]:
        """Return import roots unavailable from the app or this project's environment."""

        from app.services.python_runtime import BLOCKED_MODULES

        try:
            tree = ast.parse(code)
        except SyntaxError:
            return []
        requested: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                requested.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                requested.add(node.module.split(".")[0])
        requested.difference_update(BLOCKED_MODULES)

        importlib.invalidate_caches()
        search_paths = [*self.extra_paths, *sys.path]
        missing: list[str] = []
        for module in sorted(requested):
            try:
                available = importlib.util.find_spec(module) is not None
                if not available:
                    available = (
                        importlib.machinery.PathFinder.find_spec(module, search_paths) is not None
                    )
            except (ImportError, ModuleNotFoundError, ValueError):
                available = False
            if not available:
                missing.append(module)
        return missing

    def _ensure_worker(self) -> None:
        if self._process is not None and self._process.is_alive() and self._connection is not None:
            return
        self._terminate_worker()
        context = multiprocessing.get_context("spawn")
        parent_connection, child_connection = context.Pipe(duplex=True)
        process = context.Process(
            target=_sandbox_worker,
            args=(child_connection, list(self.extra_paths)),
            name="receiptbi-python-sandbox",
            daemon=True,
        )
        process.start()
        child_connection.close()
        self._process = process
        self._connection = parent_connection

    def _terminate_worker(self) -> None:
        connection = self._connection
        process = self._process
        self._connection = None
        self._process = None

        if connection is not None:
            with contextlib.suppress(BrokenPipeError, EOFError, OSError):
                connection.send({"operation": "stop"})
        if process is not None:
            process.join(timeout=0.5)
            if process.is_alive():
                process.terminate()
                process.join(timeout=1.0)
            if process.is_alive() and hasattr(process, "kill"):
                process.kill()
                process.join(timeout=0.5)
        if connection is not None:
            with contextlib.suppress(OSError):
                connection.close()

    def _send_request(self, request: dict[str, Any]) -> None:
        self._ensure_worker()
        try:
            self._connection.send(request)
        except (BrokenPipeError, EOFError, OSError):
            logger.warning("Restarting unavailable Python sandbox worker")
            self._terminate_worker()
            self._ensure_worker()
            self._connection.send(request)

    def _receive_response(self, request_id: str, timeout: float) -> dict[str, Any]:
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError
            if self._connection is None:
                raise RuntimeError("Python worker connection is unavailable")
            try:
                available = self._connection.poll(min(remaining, 0.2))
            except (EOFError, OSError) as exc:
                raise RuntimeError("Python worker connection was lost") from exc
            if not available:
                if self._process is not None and not self._process.is_alive():
                    raise RuntimeError("Python worker exited unexpectedly")
                continue
            try:
                response = self._connection.recv()
            except (EOFError, OSError) as exc:
                raise RuntimeError("Python worker exited unexpectedly") from exc
            if response.get("id") == request_id:
                return response

    async def execute(
        self,
        code: str,
        sql_data: dict[str, Any] | None = None,
        timeout: int = 60,
    ) -> tuple[str | None, list[str]]:
        """Validate code and execute it in the project worker."""

        from app.services.python_runtime import PythonSecurityAnalyzer

        is_safe, violations = PythonSecurityAnalyzer.analyze(code)
        if not is_safe:
            reason = "; ".join(violations[:3])
            logger.warning(
                "Code rejected by security analysis",
                reason=reason,
                code_preview=code[:100],
                violation_count=len(violations),
            )
            raise ValueError(f"Security check failed: {reason}")

        request_id = uuid4().hex
        request = {
            "operation": "execute",
            "id": request_id,
            "code": code,
            "sql_data": sql_data or {},
        }
        async with self._lock:
            logger.info("Executing Python code", code_preview=code[:80])
            try:
                await asyncio.to_thread(self._send_request, request)
                response = await asyncio.to_thread(
                    self._receive_response, request_id, float(timeout)
                )
            except asyncio.CancelledError:
                self._terminate_worker()
                raise
            except TimeoutError as exc:
                self._terminate_worker()
                logger.error("Python execution timeout", timeout=timeout)
                raise RuntimeError(f"Code execution timeout ({timeout}s)") from exc
            except RuntimeError:
                self._terminate_worker()
                raise

        if response.get("status") != "ok":
            message = str(response.get("message") or "Python execution failed")
            error_type = response.get("error_type")
            logger.error("Python execution error", error_type=error_type, exception_detail=message)
            if error_type == "SyntaxError":
                raise SyntaxError(message)
            if error_type == "ValueError":
                raise ValueError(message)
            raise RuntimeError(message)

        output = response.get("output")
        images = list(response.get("images") or [])
        logger.info(
            "Python execution completed",
            output_length=len(output or ""),
            image_count=len(images),
        )
        return output, images

    def cleanup(self) -> None:
        """Terminate the project worker and release all IPC handles."""

        self._terminate_worker()
