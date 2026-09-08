"""Own nested analysis streams until their child work and resources have settled."""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

import anyio
import httpx

from app.api.v1 import chat as chat_api
from app.core.config import settings
from app.db.tables import Message
from app.models import SSEEvent
from app.services import model_engine
from app.services.analyst_runtime import PydanticAnalystRuntime
from app.services.chat_runtime import ActiveQueryRegistry
from app.services.execution import ExecutionInputs, ExecutionService
from app.services.project_context import ProjectRuntimeContext
from app.services.run_control import owned_task
from tests.model_fixtures import synthetic_model_config


class AnalysisStreamLifetimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        directory = tempfile.TemporaryDirectory(prefix="receiptbi-stream-lifetime-")
        self.addCleanup(directory.cleanup)
        workspace = patch.object(settings, "WORKSPACE_ROOT", Path(directory.name) / "中文项目")
        workspace.start()
        self.addCleanup(workspace.stop)

    async def test_consumer_exit_settles_the_model_before_recording_interruption(self):
        for mode in ("close", "publish_error", "cancel", "scope_cancel"):
            with self.subTest(mode=mode):
                trace = []
                started = asyncio.Event()
                runtime = PydanticAnalystRuntime(
                    model_config=synthetic_model_config(),
                    project_context=ProjectRuntimeContext(name="门店分析"),
                )

                async def respond(_request):
                    started.set()
                    runtime.deps.queue_progress("query_source_data")
                    try:
                        await asyncio.Future()
                    finally:
                        trace.append("model_settled")

                client = httpx.AsyncClient(transport=httpx.MockTransport(respond))

                class Engine:
                    def execute(self, **kwargs):
                        # Keep a reference so garbage collection cannot hide missing ownership.
                        self.events = runtime.execute(**kwargs)
                        return self.events

                engine = Engine()
                service = ExecutionService(AsyncMock())
                service._load_execution_inputs = AsyncMock(
                    return_value=ExecutionInputs(
                        model_config=runtime.model_config,
                        db_config=None,
                        history=[],
                    )
                )
                service._prepare_analysis_run = AsyncMock(
                    return_value=(None, "查看销售", None, None)
                )
                service._persist_explicit_confirmation = AsyncMock(return_value=None)
                service._build_engine = Mock(return_value=engine)

                async def mark_interruption(_run, _error):
                    trace.append(("interrupted", client.is_closed))

                service._mark_run_needs_attention = AsyncMock(side_effect=mark_interruption)
                project_event = service._public_event

                def publish(event):
                    if mode == "publish_error" and started.is_set():
                        raise ValueError("Synthetic event projection failure")
                    return project_event(event)

                service._public_event = publish
                cleanup = runtime.deps.python_sandbox.cleanup

                def clean_workspace():
                    cleanup()
                    trace.append("workspace_closed")

                with (
                    patch.object(model_engine, "create_async_http_client", return_value=client),
                    patch.object(
                        runtime.deps.python_sandbox, "cleanup", side_effect=clean_workspace
                    ),
                ):
                    stream = service.execute_stream("查看销售", uuid4())
                    try:
                        while not started.is_set():
                            event = await asyncio.wait_for(anext(stream), timeout=3)
                        self.assertTrue(started.is_set())
                        if mode == "publish_error":
                            self.assertEqual(event.type, "error")
                        elif mode == "close":
                            await stream.aclose()
                        elif mode == "scope_cancel":
                            with anyio.CancelScope() as scope:
                                scope.cancel()
                                await anext(stream)
                        else:
                            pending = asyncio.create_task(anext(stream))
                            await asyncio.sleep(0)
                            pending.cancel()
                            with self.assertRaises(asyncio.CancelledError):
                                await pending
                        self.assertTrue(client.is_closed)
                        self.assertEqual(
                            trace, ["model_settled", "workspace_closed", ("interrupted", True)]
                        )
                    finally:
                        await stream.aclose()
                        await engine.events.aclose()
                        await client.aclose()

    async def test_preparation_failure_releases_workspace_without_starting_a_model(self):
        runtime = PydanticAnalystRuntime(
            model_config=synthetic_model_config(),
            project_context=ProjectRuntimeContext(name="Preparation failure"),
        )
        with (
            patch.object(
                runtime, "_prepare_query_context", side_effect=ValueError("Invalid context")
            ),
            patch.object(runtime.deps.python_sandbox, "cleanup") as cleanup,
            patch.object(model_engine, "create_async_http_client") as factory,
        ):
            with self.assertRaisesRegex(ValueError, "Invalid context"):
                _ = [event async for event in runtime.execute(query="查看销售")]
            factory.assert_not_called()
            cleanup.assert_called_once()

    async def test_asgi_disconnect_joins_execution_before_recovery_and_registry_release(self):
        for boundary in ("sending", "waiting"):
            with self.subTest(boundary=boundary):
                trace = []
                disconnect = asyncio.Event()
                registry = ActiveQueryRegistry()
                conversation = SimpleNamespace(id=uuid4(), extra_data={}, status="running")
                run = SimpleNamespace(id=uuid4(), project_id=uuid4(), checkpoint={})
                result = Mock()
                result.scalars.return_value.first.return_value = run
                db = AsyncMock()
                db.execute.return_value = result

                async def persist_recovery(*_args, **_kwargs):
                    # Cancellation must not interrupt awaited finalization work.
                    await anyio.sleep(0)
                    trace.append("recovery_saved")

                async def work():
                    try:
                        await asyncio.Future()
                    finally:
                        await asyncio.sleep(0)
                        trace.append("execution_settled")

                async def events(**_kwargs):
                    async with owned_task(work) as task:
                        await asyncio.sleep(0)
                        yield SSEEvent.progress(
                            "investigating",
                            "查看数据",
                            analysis_run_id=str(run.id),
                        )
                        disconnect.set()
                        await asyncio.wait({task})

                service = Mock()
                service.get_runtime_snapshot = AsyncMock(return_value={})
                # Preserve the producer reference, as the ASGI response does.
                stream = events()
                service.execute_stream.return_value = stream
                request = SimpleNamespace(
                    model_name=None,
                    connection_id=None,
                    project_id=run.project_id,
                    context_rounds=3,
                )

                async def send(message):
                    if message.get("body") and b"investigating" in message["body"]:
                        if boundary == "sending":
                            disconnect.set()
                            await asyncio.Future()

                async def receive():
                    await disconnect.wait()
                    return {"type": "http.disconnect"}

                with (
                    patch.object(chat_api, "active_query_registry", registry),
                    patch.object(chat_api, "get_or_create_app_settings", AsyncMock()),
                    patch.object(chat_api, "settings_to_dict", return_value={}),
                    patch.object(
                        chat_api, "get_or_create_conversation", AsyncMock(return_value=conversation)
                    ),
                    patch.object(
                        chat_api,
                        "create_user_message",
                        AsyncMock(return_value=SimpleNamespace(id=uuid4())),
                    ),
                    patch.object(chat_api, "resolve_chat_request", return_value=request),
                    patch.object(chat_api, "ExecutionService", return_value=service),
                    patch.object(chat_api, "ensure_recovery_message", side_effect=persist_recovery),
                ):
                    response = await chat_api._chat_stream_response(
                        query="查看销售",
                        model=None,
                        conversation_id=conversation.id,
                        connection_id=None,
                        project_id=run.project_id,
                        resume_run_id=None,
                        correction_id=None,
                        client_stream_id="stream-lifetime",
                        language="zh",
                        context_rounds=3,
                        db=db,
                    )
                    try:
                        await asyncio.wait_for(response({"type": "http"}, receive, send), timeout=3)
                        self.assertEqual(trace, ["execution_settled", "recovery_saved"])
                        self.assertFalse(registry.is_active(conversation.id))
                        self.assertIsNone(stream.ag_frame)
                    finally:
                        await stream.aclose()

    async def test_terminal_delivery_follows_message_commit_and_cannot_reopen_completion(self):
        for mode in ("close_after_result", "save_failure"):
            with self.subTest(mode=mode):
                registry = ActiveQueryRegistry()
                conversation = SimpleNamespace(id=uuid4(), extra_data={}, status="active")
                messages = []
                saved = []
                db = AsyncMock()
                db.add = Mock(side_effect=messages.append)
                db.get.return_value = conversation
                result = Mock()
                result.scalars.return_value = []
                db.execute.return_value = result

                async def commit():
                    if messages:
                        if mode == "save_failure" and not saved:
                            saved.append("failed")
                            messages.clear()
                            raise RuntimeError("Synthetic message save failure")
                        saved.append("committed")

                db.commit.side_effect = commit
                service = Mock()
                service.get_runtime_snapshot = AsyncMock(return_value={})

                async def events(**_kwargs):
                    yield SSEEvent.progress("completed", "报告完成")
                    yield SSEEvent.result("销售额为 42", analysis_state="completed")
                    yield SSEEvent.python_output("Synthetic calculation output")

                service.execute_stream.side_effect = events
                request = SimpleNamespace(
                    model_name=None,
                    connection_id=None,
                    project_id=None,
                    context_rounds=3,
                )
                with (
                    patch.object(chat_api, "active_query_registry", registry),
                    patch.object(chat_api, "get_or_create_app_settings", AsyncMock()),
                    patch.object(chat_api, "settings_to_dict", return_value={}),
                    patch.object(
                        chat_api, "get_or_create_conversation", AsyncMock(return_value=conversation)
                    ),
                    patch.object(
                        chat_api,
                        "create_user_message",
                        AsyncMock(return_value=SimpleNamespace(id=uuid4())),
                    ),
                    patch.object(chat_api, "resolve_chat_request", return_value=request),
                    patch.object(chat_api, "ExecutionService", return_value=service),
                    patch.object(chat_api, "ensure_recovery_message", AsyncMock()) as recovery,
                ):
                    response = await chat_api._chat_stream_response(
                        query="查看销售",
                        model=None,
                        conversation_id=conversation.id,
                        connection_id=None,
                        project_id=None,
                        resume_run_id=None,
                        correction_id=None,
                        client_stream_id="terminal-lifetime",
                        language="zh",
                        context_rounds=3,
                        db=db,
                    )
                    emitted = []
                    async for raw in response.body_iterator:
                        event = json.loads(raw["data"])
                        emitted.append(event)
                        if event["type"] in {"result", "error"}:
                            self.assertEqual(saved[-1], "committed")
                            break
                    await response.body_iterator.aclose()
                    self.assertFalse(registry.is_active(conversation.id))
                    recovery.assert_not_called()
                    self.assertIsInstance(messages[-1], Message)
                    if mode == "close_after_result":
                        self.assertEqual(conversation.status, "completed")
                        self.assertEqual(
                            messages[-1].extra_data["python_output"], "Synthetic calculation output"
                        )
                        self.assertEqual(messages[-1].content, "销售额为 42")
                    else:
                        self.assertEqual(conversation.status, "error")
                        self.assertFalse(any(event["type"] == "result" for event in emitted))
                        self.assertFalse(
                            any(event["data"].get("stage") == "completed" for event in emitted)
                        )
                        self.assertEqual(emitted[-1]["data"]["code"], "EXECUTION_ERROR")


if __name__ == "__main__":
    unittest.main()
