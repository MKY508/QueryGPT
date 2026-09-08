"""Verify model capability evidence and its persistence without cloud calls."""

import asyncio
import json
import runpy
import tempfile
import unittest
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi import HTTPException
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel
from sqlalchemy import update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import models as model_routes
from app.db.tables import Model
from app.services import model_engine, model_probe
from tests.model_fixtures import synthetic_model_config
from tests.model_probe_fixtures import probe_reply


class ModelProbeTests(unittest.IsolatedAsyncioTestCase):
    async def test_ci_gateway_completes_the_same_probe_contract(self):
        gateway = runpy.run_path(str(Path(__file__).parents[3] / "scripts/mock_llm_gateway.py"))
        respond = gateway["build_probe_response"]
        self.assertIsNone(respond({"messages": [{"role": "user", "content": "Analyze sales"}]}))
        client = httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, json=respond(json.loads(request.content)))
            )
        )
        with patch.object(model_engine, "create_async_http_client", return_value=client):
            result = await model_probe.probe_model(synthetic_model_config())
        self.assertTrue(result.success)
        self.assertTrue(client.is_closed)

    async def test_text_or_invented_structured_output_cannot_pass(self):
        for invented in (False, True):
            with self.subTest(invented=invented):
                requests = []

                def answer(messages, info):
                    requests.append(messages)
                    return ModelResponse(
                        parts=[
                            ToolCallPart(info.output_tools[0].name, {"receipt": "invented"})
                            if invented
                            else TextPart("OK")
                        ]
                    )

                with patch.object(
                    model_probe, "model_session", return_value=nullcontext(FunctionModel(answer))
                ):
                    result = await model_probe.probe_model(synthetic_model_config())
                self.assertFalse(result.success)
                self.assertEqual(result.error_category, "tool_calling")
                self.assertLessEqual(len(requests), 3)

    async def test_invalid_result_after_tool_execution_is_not_healthy(self):
        for output in ({"receipt": "wrong"}, {"unexpected": "schema mismatch"}):
            with self.subTest(output=output):

                def answer(messages, info):
                    returned = any(
                        isinstance(part, ToolReturnPart)
                        for message in messages
                        for part in message.parts
                    )
                    return ModelResponse(
                        parts=[
                            ToolCallPart(info.output_tools[0].name, output)
                            if returned
                            else ToolCallPart("read_check_value", {})
                        ]
                    )

                with patch.object(
                    model_probe, "model_session", return_value=nullcontext(FunctionModel(answer))
                ):
                    result = await model_probe.probe_model(synthetic_model_config())
                self.assertFalse(result.success)
                self.assertEqual(result.error_category, "structured_output")

    async def test_provider_failure_is_classified_and_owned_connection_is_closed(self):
        client = httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda _: httpx.Response(
                    401,
                    json={
                        "error": {
                            "message": "secret-provider-detail",
                            "type": "authentication_error",
                        }
                    },
                )
            )
        )
        with patch.object(model_engine, "create_async_http_client", return_value=client):
            result = await model_probe.probe_model(
                synthetic_model_config(base_url="https://model.invalid/v1?key=secret-query")
            )
        self.assertFalse(result.success)
        self.assertEqual(result.error_category, "auth")
        self.assertNotIn("secret", result.model_dump_json())
        self.assertTrue(client.is_closed)

    async def test_timeout_and_cancellation_release_the_connection(self):
        for cancel in (False, True):
            with self.subTest(cancel=cancel):
                started = asyncio.Event()

                async def never_answer(_request):
                    started.set()
                    await asyncio.Event().wait()

                client = httpx.AsyncClient(transport=httpx.MockTransport(never_answer))
                with patch.object(model_engine, "create_async_http_client", return_value=client):
                    task = asyncio.create_task(
                        model_probe.probe_model(
                            synthetic_model_config(), timeout_seconds=10 if cancel else 0.05
                        )
                    )
                    await asyncio.wait_for(started.wait(), 1)
                    if cancel:
                        task.cancel()
                        with self.assertRaises(asyncio.CancelledError):
                            await task
                    else:
                        result = await task
                        self.assertEqual(result.error_category, "timeout")
                self.assertTrue(client.is_closed)

    async def test_missing_credentials_do_not_allocate_http(self):
        with patch.object(
            model_engine, "create_async_http_client", side_effect=AssertionError("No network")
        ):
            result = await model_probe.probe_model(synthetic_model_config(api_key=None))
        self.assertFalse(result.success)
        self.assertEqual(result.error_category, "auth")

    async def test_health_is_recorded_only_for_the_checked_revision(self):
        for changed in (False, True):
            with (
                self.subTest(changed=changed),
                tempfile.TemporaryDirectory(prefix="receiptbi-probe-") as directory,
            ):
                engine = create_async_engine(
                    f"sqlite+aiosqlite:///{Path(directory) / '模型.sqlite'}"
                )
                try:
                    async with engine.begin() as connection:
                        await connection.run_sync(Model.__table__.create)
                    sessions = async_sessionmaker(engine, expire_on_commit=False)
                    async with sessions() as db:
                        saved = Model(
                            name="Synthetic service",
                            provider="ollama",
                            model_id="test-model",
                            extra_options={"api_key_optional": True},
                        )
                        db.add(saved)
                        await db.commit()
                        model_id = saved.id

                        async def respond(request):
                            self.assertFalse(db.in_transaction())
                            if changed:
                                async with sessions() as editor:
                                    await editor.execute(
                                        update(Model)
                                        .where(Model.id == model_id)
                                        .values(model_id="new-model")
                                    )
                                    await editor.commit()
                            return probe_reply(request)

                        client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
                        with patch.object(
                            model_engine, "create_async_http_client", return_value=client
                        ):
                            if changed:
                                with self.assertRaises(HTTPException) as caught:
                                    await model_routes.test_model(model_id, db)
                                self.assertEqual(caught.exception.status_code, 409)
                            else:
                                result = await model_routes.test_model(model_id, db)
                                self.assertTrue(result.data.success)
                        self.assertTrue(client.is_closed)
                    async with sessions() as reader:
                        persisted = await reader.get(Model, model_id)
                        self.assertEqual(
                            persisted.health_status, "unknown" if changed else "healthy"
                        )
                        self.assertEqual(
                            persisted.model_id, "new-model" if changed else "test-model"
                        )
                        self.assertEqual(persisted.last_checked_at is None, changed)
                finally:
                    await engine.dispose()


if __name__ == "__main__":
    unittest.main()
