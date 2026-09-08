"""Verify the saved-model, execution and SDK contracts without cloud access."""

import json
import unittest
from dataclasses import FrozenInstanceError
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
from pydantic_ai import Agent

from app.api.v1 import models as model_routes
from app.core import encryptor
from app.db.tables import Model
from app.services import model_engine
from app.services.execution_context import ExecutionContextResolver
from app.services.model_engine import model_session
from app.services.model_runtime import ResolvedModelConfig, resolve_model_runtime
from tests.test_model_session import reply


class ModelConfigurationTests(unittest.IsolatedAsyncioTestCase):
    async def test_saved_connection_drives_execution_and_healthcheck_without_remapping(self):
        for provider, protocol, root, path in (
            ("groq", "openai_compatible", None, "/openai/v1/chat/completions"),
            (
                "qwen",
                "openai_compatible",
                "https://regional.invalid/compatible-mode/v1",
                "/compatible-mode/v1/chat/completions",
            ),
            ("custom", "openai_responses", "https://gateway.invalid/v1/responses", "/v1/responses"),
            ("anthropic", "anthropic_native", None, "/v1/messages"),
        ):
            with self.subTest(provider=provider, protocol=protocol):
                saved = Model(
                    id=uuid4(),
                    name="Chosen service",
                    provider=provider,
                    model_id="test-model",
                    base_url=root,
                    api_key_encrypted=encryptor.encrypt("test-only"),
                    extra_options={
                        "api_format": protocol,
                        "headers": {"x-project": "synthetic"},
                        "query_params": {"workspace": "test"},
                    },
                )
                db = AsyncMock()
                resolver = ExecutionContextResolver(db, allow_default_connection_fallback=False)
                resolver._resolved_model_record = saved
                config = await resolver.get_model_config()
                self.assertIsInstance(config, ResolvedModelConfig)
                self.assertIs(await resolver.get_model_config(), config)
                self.assertEqual(config.source_provider, provider)
                self.assertEqual(config.api_format, protocol)
                snapshot = await resolver.get_runtime_snapshot()
                self.assertEqual(snapshot["provider_summary"], f"{provider} · {protocol}")

                requests = []
                clients = []

                def respond(request):
                    self.assertEqual(request.url.path, path)
                    self.assertEqual(request.url.params["workspace"], "test")
                    self.assertEqual(request.headers["x-project"], "synthetic")
                    body = json.loads(request.content)
                    self.assertEqual(body["model"], "test-model")
                    requests.append(request)
                    return reply(request)

                def client_factory():
                    client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
                    clients.append(client)
                    return client

                with (
                    patch.object(
                        model_engine, "create_async_http_client", side_effect=client_factory
                    ),
                    patch.object(model_routes, "_get_model_or_404", AsyncMock(return_value=saved)),
                ):
                    async with model_session(config) as model:
                        self.assertEqual((await Agent(model).run("Check execution")).output, "OK")
                    response = await model_routes.test_model(saved.id, db)
                self.assertTrue(response.data.success)
                self.assertEqual(response.data.source_provider, provider)
                self.assertEqual(response.data.api_format, protocol)
                self.assertEqual(len(requests), 2)
                self.assertEqual(len(clients), 2)
                self.assertTrue(all(client.is_closed for client in clients))

    def test_task_config_is_fixed_and_public_snapshots_contain_only_selected_metadata(self):
        saved = Model(
            id=uuid4(),
            name="Team gateway",
            provider="custom",
            model_id="test-model",
            base_url="https://gateway.invalid/v1",
            api_key_encrypted=encryptor.encrypt("secret-test-key"),
            extra_options={"headers": {"x-workspace": "first"}, "query_params": {"scope": "first"}},
        )
        config, options = resolve_model_runtime(
            saved,
            fallback_model="unused",
            fallback_api_key=None,
            fallback_base_url=None,
        )
        options.headers["x-workspace"] = "changed"
        options.query_params["scope"] = "changed"
        saved.model_id = "different-model"
        self.assertEqual(config.headers["x-workspace"], "first")
        self.assertEqual(config.query_params["scope"], "first")
        self.assertEqual(config.model, "test-model")
        with self.assertRaises(FrozenInstanceError):
            config.api_key = "changed"
        with self.assertRaises(TypeError):
            config.headers["x-workspace"] = "changed"
        self.assertEqual(
            config.public_snapshot(diagnostics=False),
            {
                "model_id": str(saved.id),
                "model_name": "Team gateway",
            },
        )
        self.assertEqual(
            config.public_snapshot(diagnostics=True),
            {
                "model_id": str(saved.id),
                "model_name": "Team gateway",
                "model_identifier": "test-model",
                "source_provider": "custom",
                "api_format": "openai_compatible",
                "provider_summary": "custom · openai_compatible",
            },
        )
        self.assertNotIn("secret-test-key", repr(config))


if __name__ == "__main__":
    unittest.main()
