"""Offline SDK-boundary checks; runnable with Python's unittest alone."""

import asyncio
import json
import time
import unittest
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
from pydantic_ai import Agent

from app.services.model_engine import _build_model
from app.services.run_control import AnalystStoppedError, run_with_controls
from tests.model_fixtures import synthetic_model_config


class ModelEngineBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_saving_a_different_provider_drops_the_previous_saved_key(self):
        from app.api.v1 import models as model_routes
        from app.db.tables import Model
        from app.models.config import ModelCreate

        saved = Model(
            id=uuid4(),
            name="Old service",
            provider="openai",
            model_id="gpt-4o",
            base_url=None,
            api_key_encrypted="old-provider-secret",
            extra_options={},
            is_default=False,
            is_active=True,
            created_at=datetime.now(UTC),
        )
        db = AsyncMock()
        db.get.return_value = None
        with patch.object(model_routes, "_get_model_or_404", AsyncMock(return_value=saved)):
            await model_routes.update_model(
                saved.id,
                ModelCreate(
                    name="Groq",
                    provider="groq",
                    model_id="llama-3.3-70b-versatile",
                ),
                db,
            )
        self.assertIsNone(saved.api_key_encrypted)
        db.commit.assert_awaited_once()

    async def test_compatible_gateways_execute_a_real_sdk_tool_round_trip(self):
        for provider, model_name, root in (
            ("groq", "llama-3.3-70b-versatile", "https://api.groq.com/openai/v1"),
            (
                "qwen",
                "qwen-plus",
                "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
            ),
        ):
            requests = []

            def respond(request):
                body = json.loads(request.content)
                requests.append(body)
                self.assertEqual(str(request.url), root + "/chat/completions?workspace=test")
                self.assertEqual(request.headers["x-project"], "receiptbi-test")
                self.assertEqual(body["model"], model_name)
                if len(requests) == 1:
                    message = {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "type": "function",
                                "function": {"name": "count_orders", "arguments": "{}"},
                            }
                        ],
                    }
                    finish = "tool_calls"
                else:
                    self.assertTrue(
                        any(
                            m.get("role") == "tool" and m["content"] == "2"
                            for m in body["messages"]
                        )
                    )
                    message = {"role": "assistant", "content": "2"}
                    finish = "stop"
                return httpx.Response(
                    200,
                    json={
                        "id": "test",
                        "object": "chat.completion",
                        "created": 1,
                        "model": model_name,
                        "choices": [{"index": 0, "message": message, "finish_reason": finish}],
                        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
                    },
                )

            with self.subTest(provider=provider):
                async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
                    model = _build_model(
                        synthetic_model_config(
                            source_provider=provider,
                            model=model_name,
                            base_url=root,
                            api_key="test-only",
                            headers={"x-project": "receiptbi-test"},
                            query_params={"workspace": "test"},
                        ),
                        http_client=client,
                    )
                    agent = Agent(model, output_type=str)

                    @agent.tool_plain
                    def count_orders() -> int:
                        """Count synthetic orders."""
                        return 2

                    self.assertEqual((await agent.run("Count orders")).output, "2")
                    self.assertEqual(len(requests), 2)

    async def test_explicit_protocol_overrides_provider_and_keeps_request_options(self):
        for protocol, expected_path in (
            ("openai_compatible", "/v1/chat/completions"),
            ("openai_responses", "/v1/responses"),
            ("anthropic_native", "/v1/messages"),
        ):

            def respond(request):
                self.assertEqual(request.url.path, expected_path)
                self.assertEqual(request.url.params["workspace"], "test")
                self.assertEqual(request.headers["x-project"], "receiptbi-test")
                if protocol == "anthropic_native":
                    payload = {
                        "id": "msg_test",
                        "type": "message",
                        "role": "assistant",
                        "model": "test-model",
                        "content": [{"type": "text", "text": "OK"}],
                        "stop_reason": "end_turn",
                        "usage": {"input_tokens": 1, "output_tokens": 1},
                    }
                elif protocol == "openai_responses":
                    payload = {
                        "id": "resp_test",
                        "object": "response",
                        "created_at": 1,
                        "status": "completed",
                        "model": "test-model",
                        "output": [
                            {
                                "type": "message",
                                "id": "msg_test",
                                "role": "assistant",
                                "status": "completed",
                                "content": [
                                    {"type": "output_text", "text": "OK", "annotations": []}
                                ],
                            }
                        ],
                        "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
                    }
                else:
                    payload = {
                        "id": "test",
                        "object": "chat.completion",
                        "created": 1,
                        "model": "test-model",
                        "choices": [
                            {
                                "index": 0,
                                "message": {"role": "assistant", "content": "OK"},
                                "finish_reason": "stop",
                            }
                        ],
                        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
                    }
                return httpx.Response(200, json=payload)

            with self.subTest(protocol=protocol):
                async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
                    model = _build_model(
                        synthetic_model_config(
                            source_provider="anthropic",
                            api_format=protocol,
                            model="test-model",
                            base_url="https://gateway.example"
                            if protocol == "anthropic_native"
                            else "https://gateway.example/v1",
                            api_key="test-only",
                            headers={"x-project": "receiptbi-test"},
                            query_params={"workspace": "test"},
                        ),
                        http_client=client,
                    )
                    self.assertEqual((await Agent(model).run("OK")).output, "OK")

    async def test_stop_and_caller_cancellation_settle_owned_work(self):
        started, finished = asyncio.Event(), asyncio.Event()

        async def work():
            started.set()
            try:
                await asyncio.Future()
            finally:
                finished.set()

        with self.assertRaises(AnalystStoppedError):
            await run_with_controls(work, timeout=1, stop_checker=lambda: True)
        self.assertFalse(started.is_set())
        outer = asyncio.create_task(run_with_controls(work, timeout=1))
        await started.wait()
        outer.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await outer
        self.assertTrue(finished.is_set())

    async def test_deadline_counts_time_spent_outside_the_poll_loop(self):
        async def busy_work():
            time.sleep(0.03)
            return "late result"

        with self.assertRaises(TimeoutError):
            await run_with_controls(busy_work, timeout=0.01)


if __name__ == "__main__":
    unittest.main()
