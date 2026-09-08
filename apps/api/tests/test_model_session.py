"""Real SDK requests against local transports; no credentials or cloud calls."""

import asyncio
import json
import unittest
from dataclasses import replace
from unittest.mock import patch

import httpx
from pydantic_ai import Agent
from pydantic_ai.models.test import TestModel

from app.services import model_engine
from app.services.model_engine import model_session
from app.services.model_runtime import ModelRuntimeConfigurationError
from app.services.run_control import AnalystStoppedError, run_with_controls
from tests.model_fixtures import synthetic_model_config


class TrackedTransport(httpx.MockTransport):
    closes = 0

    async def aclose(self):
        self.closes += 1
        await super().aclose()


CONFIG = synthetic_model_config()


def reply(request):
    if request.url.path.endswith("/messages"):
        payload = {
            "id": "msg_test",
            "type": "message",
            "role": "assistant",
            "model": "test-model",
            "content": [{"type": "text", "text": "OK"}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 1, "output_tokens": 1},
        }
    elif request.url.path.endswith("/responses"):
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
                    "content": [{"type": "output_text", "text": "OK", "annotations": []}],
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


class ModelSessionTests(unittest.IsolatedAsyncioTestCase):
    async def test_owned_pool_is_reused_then_closed_for_all_protocols(self):
        for protocol in ("openai_compatible", "openai_responses", "anthropic_native"):
            with self.subTest(protocol=protocol):
                requests = []

                def respond(request):
                    requests.append(json.loads(request.content))
                    return reply(request)

                transport = TrackedTransport(respond)
                client = httpx.AsyncClient(transport=transport)
                with patch.object(
                    model_engine, "create_async_http_client", return_value=client
                ) as factory:
                    scope = model_session(replace(CONFIG, api_format=protocol))
                    factory.assert_not_called()
                    async with scope as model:
                        agent = Agent(model)
                        self.assertEqual((await agent.run("First question")).output, "OK")
                        self.assertEqual((await agent.run("Second question")).output, "OK")
                        self.assertFalse(client.is_closed)
                    factory.assert_called_once()
                self.assertEqual(len(requests), 2)
                self.assertTrue(client.is_closed)
                self.assertEqual(transport.closes, 1)

    async def test_constructor_and_provider_failures_close_the_owned_pool(self):
        for invalid in (True, False):
            with self.subTest(invalid_config=invalid):
                transport = TrackedTransport(
                    lambda _: httpx.Response(
                        401,
                        json={
                            "error": {
                                "message": "Synthetic credential rejected",
                                "type": "authentication_error",
                            }
                        },
                    )
                )
                client = httpx.AsyncClient(transport=transport)
                config = replace(CONFIG, api_format="unsupported") if invalid else CONFIG
                with patch.object(model_engine, "create_async_http_client", return_value=client):
                    with self.assertRaises(Exception) as failed:
                        async with model_session(config) as model:
                            await Agent(model).run("Rejected request")
                if invalid:
                    self.assertIsInstance(failed.exception, ModelRuntimeConfigurationError)
                else:
                    self.assertEqual(failed.exception.status_code, 401)
                self.assertTrue(client.is_closed)
                self.assertEqual(transport.closes, 1)

    async def test_stop_timeout_and_caller_cancellation_release_inflight_connections(self):
        for mode in ("stop", "timeout", "cancel"):
            with self.subTest(mode=mode):
                started, settled, stop = asyncio.Event(), asyncio.Event(), asyncio.Event()

                async def respond(_request):
                    started.set()
                    try:
                        await asyncio.Future()
                    finally:
                        settled.set()

                transport = TrackedTransport(respond)
                client = httpx.AsyncClient(transport=transport)

                async def operation():
                    async with model_session(CONFIG) as model:
                        return await Agent(model).run("Wait for a synthetic response")

                with patch.object(model_engine, "create_async_http_client", return_value=client):
                    task = asyncio.create_task(
                        run_with_controls(
                            operation,
                            timeout=0.1 if mode == "timeout" else 2,
                            stop_checker=stop.is_set,
                        )
                    )
                    await asyncio.wait_for(started.wait(), timeout=1)
                    if mode == "stop":
                        stop.set()
                    elif mode == "cancel":
                        task.cancel()
                    expected = {
                        "stop": AnalystStoppedError,
                        "timeout": TimeoutError,
                        "cancel": asyncio.CancelledError,
                    }[mode]
                    with self.assertRaises(expected):
                        await task
                self.assertTrue(settled.is_set())
                self.assertTrue(client.is_closed)
                self.assertEqual(transport.closes, 1)

    async def test_injected_model_and_http_client_remain_owned_by_the_caller(self):
        transport = TrackedTransport(reply)
        async with httpx.AsyncClient(transport=transport) as client:
            async with model_session(CONFIG, http_client=client) as model:
                self.assertEqual((await Agent(model).run("Borrow the pool")).output, "OK")
            self.assertFalse(client.is_closed)
            self.assertEqual(transport.closes, 0)
            with self.assertRaises(asyncio.CancelledError):
                async with model_session(CONFIG, http_client=client):
                    raise asyncio.CancelledError
            self.assertFalse(client.is_closed)
        self.assertEqual(transport.closes, 1)

        injected = TestModel(custom_output_text="Injected model")
        with patch.object(
            model_engine,
            "create_async_http_client",
            side_effect=AssertionError("Unexpected HTTP allocation"),
        ):
            async with model_session(synthetic_model_config(), model=injected) as model:
                self.assertIs(model, injected)
                self.assertEqual(
                    (await Agent(model).run("No HTTP needed")).output, "Injected model"
                )
            self.assertEqual(
                (await Agent(injected).run("Still available")).output, "Injected model"
            )


if __name__ == "__main__":
    unittest.main()
