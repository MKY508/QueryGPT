"""Exercise lazy model ownership at real business entry points, without cloud calls."""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

from app.core.config import settings
from app.db.tables import AppSettings
from app.services import model_engine, semantic_recommendation_ai
from app.services.analyst_runtime import PydanticAnalystRuntime
from app.services.project_context import ProjectRuntimeContext
from tests.model_fixtures import synthetic_model_config


class ModelSessionConsumerTests(unittest.IsolatedAsyncioTestCase):
    async def test_pending_business_confirmation_never_allocates_a_model_connection(self):
        ambiguity = {
            "key": "revenue_refund_policy",
            "question": "计算收入时，退款订单需要扣除吗？",
            "reason": "不同退款口径会改变收入结论。",
            "options": ["扣除退款", "保留退款订单"],
        }
        with (
            tempfile.TemporaryDirectory(prefix="receiptbi-model-gate-") as directory,
            patch.object(settings, "WORKSPACE_ROOT", Path(directory) / "中文项目"),
            patch.object(
                model_engine,
                "create_async_http_client",
                side_effect=AssertionError("A pending confirmation must not allocate HTTP"),
            ) as factory,
        ):
            runtime = PydanticAnalystRuntime(
                model_config=synthetic_model_config(api_format="unavailable-until-configured"),
                project_context=ProjectRuntimeContext(
                    name="门店经营",
                    sources=[
                        {
                            "id": "synthetic-sales",
                            "name": "销售明细",
                            "kind": "file",
                            "status": "needs_confirmation",
                            "profile": {"is_current": True, "ambiguities": [ambiguity]},
                        }
                    ],
                ),
            )
            events = [event async for event in runtime.execute(query="比较门店净收入")]
            reports = [event.data["report"] for event in events if event.type == "result"]
            self.assertEqual(len(reports), 1)
            self.assertEqual(reports[0]["status"], "waiting_confirmation")
            self.assertEqual(reports[0]["confirmation"]["key"], ambiguity["key"])
            factory.assert_not_called()

    async def test_enhancer_is_lazy_and_concurrent_invocations_own_separate_pools(self):
        clients = []
        arrivals = []
        both_started = asyncio.Event()

        async def respond(request):
            body = json.loads(request.content)
            prompt = json.loads(
                next(
                    message["content"] for message in body["messages"] if message["role"] == "user"
                )
            )
            candidate_id = prompt["candidates"][0]["candidate_id"]
            arrivals.append(candidate_id)
            if len(arrivals) == 2:
                both_started.set()
            await both_started.wait()
            return httpx.Response(
                200,
                json={
                    "id": "synthetic-enhancement",
                    "object": "chat.completion",
                    "created": 1,
                    "model": "test-model",
                    "choices": [
                        {
                            "index": 0,
                            "finish_reason": "tool_calls",
                            "message": {
                                "role": "assistant",
                                "content": None,
                                "tool_calls": [
                                    {
                                        "id": "output",
                                        "type": "function",
                                        "function": {
                                            "name": body["tools"][0]["function"]["name"],
                                            "arguments": json.dumps(
                                                {
                                                    "items": [
                                                        {
                                                            "candidate_id": candidate_id,
                                                            "business_name": "销售额候选",
                                                        }
                                                    ]
                                                },
                                                ensure_ascii=False,
                                            ),
                                        },
                                    }
                                ],
                            },
                        }
                    ],
                    "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
                },
            )

        def create_client():
            client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
            clients.append(client)
            return client

        config = synthetic_model_config()
        with (
            patch.object(
                semantic_recommendation_ai,
                "get_or_create_app_settings",
                AsyncMock(
                    return_value=AppSettings(self_analysis_enabled=True),
                ),
            ),
            patch.object(
                semantic_recommendation_ai.ExecutionContextResolver,
                "get_model_config",
                AsyncMock(return_value=config),
            ),
            patch.object(
                model_engine, "create_async_http_client", side_effect=create_client
            ) as factory,
        ):
            enhance = await semantic_recommendation_ai.build_semantic_recommendation_enhancer(
                object(),
                locale="zh",
                model_id=None,
            )
            self.assertIsNotNone(enhance)
            factory.assert_not_called()
            async with asyncio.timeout(3):
                results = await asyncio.gather(
                    enhance([{"candidate_id": "candidate-a"}]),
                    enhance([{"candidate_id": "candidate-b"}]),
                )
            self.assertEqual(
                [items[0].candidate_id for items in results], ["candidate-a", "candidate-b"]
            )
            self.assertEqual(factory.call_count, 2)
            self.assertIsNot(clients[0], clients[1])
            self.assertTrue(all(client.is_closed for client in clients))


if __name__ == "__main__":
    unittest.main()
