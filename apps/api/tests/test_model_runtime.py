"""Tests for model_runtime.py"""

from types import SimpleNamespace

from app.core.config import settings
from app.services.model_runtime import (
    categorize_model_error,
    default_api_format,
    default_base_url,
    normalize_provider,
    resolve_litellm_provider,
    resolve_model_runtime,
)


def test_resolve_openai_compatible_provider_defaults():
    model = SimpleNamespace(
        provider="deepseek",
        model_id="deepseek-chat",
        name="DeepSeek Chat",
        base_url=None,
        extra_options={},
    )

    resolved, extra = resolve_model_runtime(
        model,
        fallback_model="gpt-4o",
        fallback_api_key="test-key",
        fallback_base_url=None,
    )

    assert resolved.source_provider == "deepseek"
    assert resolved.litellm_provider == "openai"
    assert resolved.base_url == "https://api.deepseek.com"
    assert extra.api_format == "openai_compatible"


def test_resolve_ollama_allows_missing_api_key():
    model = SimpleNamespace(
        provider="ollama",
        model_id="llama3.1",
        name="Ollama Local",
        base_url=None,
        extra_options={},
    )

    resolved, extra = resolve_model_runtime(
        model,
        fallback_model="gpt-4o",
        fallback_api_key=None,
        fallback_base_url=None,
    )

    assert resolved.litellm_provider == "ollama"
    assert resolved.api_key is None
    assert resolved.api_key_required is False
    assert extra.api_key_optional is True


def test_resolve_custom_headers_and_query_params():
    model = SimpleNamespace(
        provider="custom",
        model_id="my-model",
        name="Custom Gateway",
        base_url="https://gateway.example.com/v1/",
        extra_options={
            "api_format": "openai_compatible",
            "headers": {"x-app-id": "querygpt"},
            "query_params": {"workspace": "team-a"},
        },
    )

    resolved, _ = resolve_model_runtime(
        model,
        fallback_model="gpt-4o",
        fallback_api_key="test-key",
        fallback_base_url=None,
    )

    assert resolved.base_url == "https://gateway.example.com/v1"
    assert resolved.headers["x-app-id"] == "querygpt"
    assert resolved.query_params["workspace"] == "team-a"


def test_categorize_model_error():
    assert categorize_model_error("Invalid API key provided") == "auth"
    assert categorize_model_error("Connection refused by host") == "connection"
    assert categorize_model_error("Request timed out after 10s") == "timeout"
    assert categorize_model_error("404 model_not_found") == "model_not_found"
    assert categorize_model_error("rate limit exceeded") == "rate_limited"
    assert categorize_model_error("provider returned invalid JSON format") == "provider_format"


def test_provider_helpers_cover_defaults():
    assert normalize_provider(" OPENAI ") == "openai"
    assert normalize_provider("made-up-provider") == "custom"
    assert default_api_format("anthropic") == "anthropic_native"
    assert default_api_format("ollama") == "ollama_local"
    assert default_api_format("openai") == "openai_compatible"
    assert default_base_url("deepseek") == "https://api.deepseek.com"
    assert default_base_url("ollama") == "http://localhost:11434"
    assert default_base_url("openai") == settings.OPENAI_BASE_URL
    assert resolve_litellm_provider("anthropic", "anthropic_native") == "anthropic"
    assert resolve_litellm_provider("ollama", "ollama_local") == "ollama"
    assert resolve_litellm_provider("deepseek", "custom") == "deepseek"
    assert resolve_litellm_provider("custom", "openai_compatible") == "openai"


def test_resolve_model_runtime_without_saved_model_uses_openai_defaults():
    resolved, extra = resolve_model_runtime(
        None,
        fallback_model="gpt-4o-mini",
        fallback_api_key="fallback-key",
        fallback_base_url="https://api.example.com/v1/",
    )

    assert resolved.source_provider == "openai"
    assert resolved.litellm_provider == "openai"
    assert resolved.model == "gpt-4o-mini"
    assert resolved.base_url == settings.OPENAI_BASE_URL
    assert resolved.api_key == "fallback-key"
    assert resolved.api_key_required is True
    assert extra.api_format == "openai_compatible"
    assert resolved.diagnostic_summary() == {
        "provider": "openai",
        "resolved_provider": "openai",
        "api_format": "openai_compatible",
        "model": "gpt-4o-mini",
        "base_url": settings.OPENAI_BASE_URL,
        "api_key_required": True,
    }
    assert resolved.completion_kwargs(stream=True) == {
        "model": "gpt-4o-mini",
        "custom_llm_provider": "openai",
        "base_url": settings.OPENAI_BASE_URL,
        "api_key": "fallback-key",
        "stream": True,
    }


def test_resolve_model_runtime_custom_uses_fallback_base_url():
    model = SimpleNamespace(
        provider="custom",
        model_id="custom-model",
        name="Custom Model",
        base_url=None,
        extra_options={},
    )

    resolved, _ = resolve_model_runtime(
        model,
        fallback_model="ignored",
        fallback_api_key="fallback-key",
        fallback_base_url="https://api.example.com/v1/",
    )

    assert resolved.base_url == "https://api.example.com/v1"
