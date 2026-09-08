"""Model protocol boundary shared by investigations and presentation tasks.

Reuse PydanticAI's model implementations; business tools never select an SDK.
Provider identity chooses defaults, while the explicit API format chooses the wire
protocol. See docs/architecture/ARCHITECTURE.md for the architectural references.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, nullcontext
from typing import Any

import httpx
from pydantic_ai.models import Model, create_async_http_client

from app.services.model_runtime import (
    ModelRuntimeConfigurationError,
    default_api_format,
    default_base_url,
    normalize_runtime_base_url,
)


@asynccontextmanager
async def model_session(
    config: dict[str, Any],
    *,
    model: Model | None = None,
    http_client: httpx.AsyncClient | None = None,
) -> AsyncIterator[Model]:
    """Lease one model for a task, closing only resources created here.

    A task's tool rounds reuse its HTTP pool. Injected models and HTTP clients
    are borrowed: their owner controls their lifetime, including cancellation.
    No SDK client is allocated until this context is entered.
    """
    if model is not None:
        if http_client is not None:
            raise ValueError("Inject a model or an HTTP client, not both")
        yield model
        return
    client_scope = (
        nullcontext(http_client) if http_client is not None else create_async_http_client()
    )
    async with client_scope as client:
        yield _build_model(config, http_client=client)


def _build_model(config: dict[str, Any], *, http_client: httpx.AsyncClient) -> Model:
    """Build an SDK adapter using the session's explicitly owned or borrowed pool."""

    provider = str(config.get("source_provider") or "openai")
    api_format = config.get("api_format") or default_api_format(provider)
    if api_format not in {
        "openai_compatible",
        "openai_responses",
        "anthropic_native",
        "ollama_local",
        "custom",
    }:
        raise ModelRuntimeConfigurationError("Unsupported model API format")
    base_url = config.get("base_url") or default_base_url(provider)
    if not base_url:
        raise ModelRuntimeConfigurationError("Model service requires an explicit base URL")
    base_url = normalize_runtime_base_url(base_url, provider=provider, api_format=api_format)
    model_name = str(config.get("model") or "gpt-4o")
    client_options = {
        "api_key": config.get("api_key") or "not-needed",
        "base_url": base_url,
        "default_headers": config.get("headers") or None,
        "default_query": config.get("query_params") or None,
        "http_client": http_client,
    }

    if api_format == "anthropic_native":
        from anthropic import AsyncAnthropic
        from pydantic_ai.models.anthropic import AnthropicModel
        from pydantic_ai.providers.anthropic import AnthropicProvider

        return AnthropicModel(
            model_name,
            provider=AnthropicProvider(anthropic_client=AsyncAnthropic(**client_options)),
        )

    from openai import AsyncOpenAI
    from pydantic_ai.models.openai import OpenAIChatModel, OpenAIResponsesModel
    from pydantic_ai.profiles.openai import OpenAIModelProfile
    from pydantic_ai.providers.openai import OpenAIProvider

    client = AsyncOpenAI(**client_options)
    adapter = OpenAIProvider(openai_client=client)
    if api_format == "openai_responses":
        return OpenAIResponsesModel(model_name, provider=adapter)

    if provider == "deepseek":
        from pydantic_ai.providers.deepseek import DeepSeekProvider

        profile = DeepSeekProvider.model_profile(model_name)
    elif provider in {"groq", "qwen", "ollama"}:
        # These services accept function schemas without OpenAI strict mode.
        profile = OpenAIModelProfile(openai_supports_strict_tool_definition=False)
    else:
        profile = None
    return OpenAIChatModel(model_name, provider=adapter, profile=profile)
