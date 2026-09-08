"""Tests for model_runtime.py"""

from types import SimpleNamespace

import pytest

from app.core import encryptor
from app.services.model_runtime import (
    ModelCredentialError,
    ModelRuntimeConfigurationError,
    categorize_model_error,
    default_api_format,
    default_base_url,
    normalize_provider,
    normalize_runtime_base_url,
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
    assert resolved.base_url == "https://api.deepseek.com/v1"
    assert extra.api_format == "openai_compatible"


def test_orcarouter_uses_own_endpoint_and_preserves_gateway_model_id():
    from app.models.config import ModelCreate

    model = ModelCreate(name="OrcaRouter", provider="orcarouter", model_id="orcarouter/auto", api_key="test-orca-key")
    resolved, extra = resolve_model_runtime(
        model, fallback_model="gpt-4o", fallback_api_key="unrelated-key",
        fallback_base_url="https://unrelated.invalid/v1",
    )
    assert resolved.source_provider == "orcarouter"
    assert resolved.base_url == "https://api.orcarouter.ai/v1"
    assert resolved.model == "orcarouter/auto"
    assert extra.api_format == "openai_compatible"
    assert resolved.api_key_required is True


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

    assert resolved.source_provider == "ollama"
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
            "headers": {"x-app-id": "receiptbi"},
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
    assert resolved.headers["x-app-id"] == "receiptbi"
    assert resolved.query_params["workspace"] == "team-a"


def test_categorize_model_error():
    assert categorize_model_error("Invalid API key provided") == "auth"
    assert categorize_model_error("Connection refused by host") == "connection"
    assert categorize_model_error("Request timed out after 10s") == "timeout"
    assert categorize_model_error("404 model_not_found") == "model_not_found"
    assert categorize_model_error("rate limit exceeded") == "rate_limited"
    assert categorize_model_error("provider returned invalid JSON format") == "provider_format"
    assert categorize_model_error("Invalid URL (POST /chat/completions)") == "model_endpoint"


def test_openai_compatible_root_gets_standard_v1_path():
    for provider in ("openai", "custom", "deepseek", "anthropic"):
        assert (
            normalize_runtime_base_url(
                "https://gateway.example.com",
                provider=provider,
                api_format="openai_compatible",
            )
            == "https://gateway.example.com/v1"
        )
    assert (
        normalize_runtime_base_url(
            "https://gateway.example.com/api/openai",
            provider="custom",
            api_format="openai_compatible",
        )
        == "https://gateway.example.com/api/openai"
    )


def test_full_chat_completion_endpoint_is_reduced_to_api_root():
    assert (
        normalize_runtime_base_url(
            "https://gateway.example.com/v1/chat/completions/",
            provider="custom",
            api_format="openai_compatible",
        )
        == "https://gateway.example.com/v1"
    )
    assert (
        normalize_runtime_base_url(
            "https://gateway.example.com/api/openai/chat/completions",
            provider="custom",
            api_format="openai_compatible",
        )
        == "https://gateway.example.com/api/openai"
    )
    assert (
        normalize_runtime_base_url(
            "https://gateway.example.com/chat/completions",
            provider="custom",
            api_format="openai_compatible",
        )
        == "https://gateway.example.com"
    )


@pytest.mark.parametrize(
    "url",
    [
        "gateway.example.com/v1",
        "ftp://gateway.example.com/v1",
        "https://user:secret@gateway.example.com/v1",
        "https://gateway.example.com/v1#debug",
    ],
)
def test_runtime_base_url_rejects_unsafe_or_incomplete_urls(url: str):
    with pytest.raises(ModelRuntimeConfigurationError):
        normalize_runtime_base_url(
            url,
            provider="custom",
            api_format="openai_compatible",
        )


def test_provider_helpers_cover_defaults():
    assert normalize_provider(" OPENAI ") == "openai"
    assert normalize_provider("made-up-provider") == "custom"
    assert default_api_format("anthropic") == "anthropic_native"
    assert default_api_format("ollama") == "ollama_local"
    assert default_api_format("openai") == "openai_compatible"
    assert default_base_url("deepseek") == "https://api.deepseek.com"
    assert default_base_url("ollama") == "http://localhost:11434"
    assert default_base_url("openai") == "https://api.openai.com/v1"


def test_resolve_model_runtime_without_saved_model_uses_openai_defaults():
    expected_base_url = "https://api.example.com/v1"

    resolved, extra = resolve_model_runtime(
        None,
        fallback_model="gpt-4o-mini",
        fallback_api_key="fallback-key",
        fallback_base_url="https://api.example.com/v1/",
    )

    assert resolved.source_provider == "openai"
    assert resolved.model == "gpt-4o-mini"
    assert resolved.base_url == expected_base_url
    assert resolved.api_key == "fallback-key"
    assert resolved.api_key_required is True
    assert extra.api_format == "openai_compatible"
    assert resolved.public_snapshot(diagnostics=True) == {
        "model_id": None,
        "model_name": "gpt-4o-mini",
        "model_identifier": "gpt-4o-mini",
        "source_provider": "openai",
        "api_format": "openai_compatible",
        "provider_summary": "openai · openai_compatible",
    }


def test_saved_custom_model_never_uses_environment_fallbacks():
    model = SimpleNamespace(
        provider="custom",
        model_id="custom-model",
        name="Custom Model",
        base_url="https://saved.example.com/custom",
        api_key_encrypted=encryptor.encrypt("saved-key"),
        extra_options={},
    )

    resolved, _ = resolve_model_runtime(
        model,
        fallback_model="ignored",
        fallback_api_key="global-openai-key",
        fallback_base_url="https://global-openai.example.com/v1/",
    )

    assert resolved.base_url == "https://saved.example.com/custom"
    assert resolved.api_key == "saved-key"


def test_saved_openai_model_without_key_or_url_does_not_borrow_environment_values():
    model = SimpleNamespace(
        provider="openai",
        model_id="gpt-4o-mini",
        name="Saved OpenAI",
        base_url=None,
        api_key_encrypted=None,
        extra_options={},
    )

    resolved, _ = resolve_model_runtime(
        model,
        fallback_model="ignored",
        fallback_api_key="global-openai-key",
        fallback_base_url="https://global-openai.example.com/v1/",
    )

    assert resolved.base_url == "https://api.openai.com/v1"
    assert resolved.api_key is None


def test_saved_custom_model_requires_its_own_base_url():
    model = SimpleNamespace(
        provider="custom",
        model_id="custom-model",
        name="Custom Model",
        base_url=None,
        api_key_encrypted=None,
        extra_options={},
    )

    with pytest.raises(ModelRuntimeConfigurationError, match="必须配置 Base URL"):
        resolve_model_runtime(
            model,
            fallback_model="ignored",
            fallback_api_key="global-openai-key",
            fallback_base_url="https://global-openai.example.com/v1/",
        )


def test_saved_model_with_unreadable_key_fails_closed():
    model = SimpleNamespace(
        provider="openai",
        model_id="gpt-4o-mini",
        name="Broken credential",
        base_url=None,
        api_key_encrypted="not-a-fernet-token",
        extra_options={},
    )

    with pytest.raises(ModelCredentialError, match="无法读取"):
        resolve_model_runtime(
            model,
            fallback_model="ignored",
            fallback_api_key="global-openai-key",
            fallback_base_url="https://global-openai.example.com/v1/",
        )
