"""Tests for model_runtime.py"""

from types import SimpleNamespace

from app.services.model_runtime import categorize_model_error, resolve_model_runtime


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
