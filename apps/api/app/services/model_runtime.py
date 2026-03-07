"""模型适配解析与诊断"""

from dataclasses import dataclass, field
from typing import Any

from app.core.config import settings
from app.db.tables import Model
from app.models.config import ModelAPIFormat, ModelExtraOptions

DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434"


def normalize_provider(provider: str | None) -> str:
    normalized = (provider or "openai").strip().lower()
    if normalized in {"openai", "anthropic", "deepseek", "ollama", "custom"}:
        return normalized
    return "custom"


def default_api_format(provider: str) -> ModelAPIFormat:
    if provider == "anthropic":
        return "anthropic_native"
    if provider == "ollama":
        return "ollama_local"
    return "openai_compatible"


def normalize_extra_options(
    raw_options: ModelExtraOptions | dict[str, Any] | None,
    provider: str,
) -> ModelExtraOptions:
    if isinstance(raw_options, ModelExtraOptions):
        extra = raw_options
    else:
        extra = ModelExtraOptions.model_validate(raw_options or {})

    if extra.api_format is None:
        extra.api_format = default_api_format(provider)

    if provider == "ollama":
        extra.api_key_optional = True

    return extra


def default_base_url(provider: str) -> str | None:
    if provider == "deepseek":
        return DEFAULT_DEEPSEEK_BASE_URL
    if provider == "ollama":
        return DEFAULT_OLLAMA_BASE_URL
    if provider == "openai":
        return settings.OPENAI_BASE_URL
    return None


def resolve_litellm_provider(provider: str, api_format: ModelAPIFormat) -> str:
    if api_format == "anthropic_native":
        return "anthropic"
    if api_format == "ollama_local":
        return "ollama"
    if provider == "deepseek" and api_format == "custom":
        return "deepseek"
    return "openai"


def categorize_model_error(message: str) -> str:
    normalized = message.lower()
    if any(
        token in normalized
        for token in ("authentication", "api key", "unauthorized", "invalid_api_key")
    ):
        return "auth"
    if "timeout" in normalized or "timed out" in normalized:
        return "timeout"
    if any(token in normalized for token in ("connection", "dns", "refused", "unreachable")):
        return "connection"
    if any(
        token in normalized for token in ("404", "not found", "model_not_found", "unknown model")
    ):
        return "model_not_found"
    if "429" in normalized or "rate limit" in normalized:
        return "rate_limited"
    if any(token in normalized for token in ("format", "schema", "json", "provider")):
        return "provider_format"
    return "unknown"


@dataclass(slots=True)
class ResolvedModelConfig:
    """统一的模型运行时配置"""

    source_provider: str
    litellm_provider: str
    model: str
    display_name: str
    base_url: str | None
    api_key: str | None
    api_format: ModelAPIFormat
    api_key_required: bool
    healthcheck_mode: str
    headers: dict[str, str] = field(default_factory=dict)
    query_params: dict[str, str] = field(default_factory=dict)

    def completion_kwargs(self, **overrides: Any) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "model": self.model,
            "custom_llm_provider": self.litellm_provider,
            "base_url": self.base_url,
            "extra_headers": self.headers or None,
            **overrides,
        }
        if self.api_key:
            kwargs["api_key"] = self.api_key
        return {key: value for key, value in kwargs.items() if value is not None}

    def diagnostic_summary(self) -> dict[str, Any]:
        return {
            "provider": self.source_provider,
            "resolved_provider": self.litellm_provider,
            "api_format": self.api_format,
            "model": self.model,
            "base_url": self.base_url,
            "api_key_required": self.api_key_required,
        }


def resolve_model_runtime(
    model: Model | None,
    *,
    fallback_model: str,
    fallback_api_key: str | None,
    fallback_base_url: str | None,
) -> tuple[ResolvedModelConfig, ModelExtraOptions]:
    provider = normalize_provider(getattr(model, "provider", None))
    model_id = getattr(model, "model_id", None) or fallback_model
    display_name = getattr(model, "name", None) or model_id
    raw_options = getattr(model, "extra_options", None)
    extra = normalize_extra_options(raw_options, provider)

    if model is None:
        provider = "openai"
        extra = normalize_extra_options(None, provider)

    base_url = getattr(model, "base_url", None) or default_base_url(provider) or fallback_base_url
    api_key = fallback_api_key
    api_format: ModelAPIFormat = extra.api_format or default_api_format(provider)

    resolved = ResolvedModelConfig(
        source_provider=provider,
        litellm_provider=resolve_litellm_provider(provider, api_format),
        model=model_id,
        display_name=display_name,
        base_url=base_url.rstrip("/") if isinstance(base_url, str) else None,
        api_key=api_key,
        api_format=api_format,
        api_key_required=not extra.api_key_optional,
        healthcheck_mode=extra.healthcheck_mode,
        headers=extra.headers,
        query_params=extra.query_params,
    )

    return resolved, extra
