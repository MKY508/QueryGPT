"""模型适配解析与诊断"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from app.core import encryptor
from app.db.tables import Model
from app.models.config import ModelAPIFormat, ModelExtraOptions

DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"
DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com"
DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEFAULT_ORCAROUTER_BASE_URL = "https://api.orcarouter.ai/v1"
DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1"
DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434"


class ModelCredentialError(RuntimeError):
    """A saved model credential exists but cannot be decrypted safely."""


class ModelRuntimeConfigurationError(ValueError):
    """A saved model cannot be resolved without guessing a remote endpoint."""


class ModelSelectionError(ModelRuntimeConfigurationError):
    """An explicitly selected persisted model is missing or inactive."""


def normalize_provider(provider: str | None) -> str:
    normalized = (provider or "openai").strip().lower()
    if normalized in {
        "openai",
        "anthropic",
        "deepseek",
        "groq",
        "qwen",
        "orcarouter",
        "ollama",
        "custom",
    }:
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
    if provider == "openai":
        return DEFAULT_OPENAI_BASE_URL
    if provider == "anthropic":
        return DEFAULT_ANTHROPIC_BASE_URL
    if provider == "deepseek":
        return DEFAULT_DEEPSEEK_BASE_URL
    if provider == "orcarouter":
        return DEFAULT_ORCAROUTER_BASE_URL
    if provider == "groq":
        return DEFAULT_GROQ_BASE_URL
    if provider == "ollama":
        return DEFAULT_OLLAMA_BASE_URL
    return None


def normalize_runtime_base_url(
    value: str | None,
    *,
    provider: str,
    api_format: ModelAPIFormat,
) -> str | None:
    """Validate and normalize an API root without changing custom gateway paths."""

    if not isinstance(value, str) or not value.strip():
        return None
    normalized = value.strip()
    try:
        parsed = urlsplit(normalized)
        hostname = parsed.hostname
        # Accessing port also validates malformed/non-numeric values.
        _ = parsed.port
    except ValueError as exc:
        raise ModelRuntimeConfigurationError("模型服务地址格式无效") from exc
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc or not hostname:
        raise ModelRuntimeConfigurationError("模型服务地址必须是完整的 http(s) URL")
    if parsed.username is not None or parsed.password is not None:
        raise ModelRuntimeConfigurationError("模型服务地址不能包含用户名或密码")
    if parsed.fragment:
        raise ModelRuntimeConfigurationError("模型服务地址不能包含 fragment")

    path = parsed.path.rstrip("/")
    endpoint_suffix = "/responses" if api_format == "openai_responses" else "/chat/completions"
    supplied_full_endpoint = path.lower().endswith(endpoint_suffix)
    if supplied_full_endpoint:
        path = path[: -len(endpoint_suffix)].rstrip("/")

    root_path = path in {"", "/"}
    needs_openai_v1 = api_format in {"openai_compatible", "openai_responses"}
    needs_ollama_v1 = api_format == "ollama_local"
    if root_path and not supplied_full_endpoint and (needs_openai_v1 or needs_ollama_v1):
        path = "/v1"

    return urlunsplit((parsed.scheme.lower(), parsed.netloc, path, parsed.query, ""))


def categorize_model_error(message: str) -> str:
    normalized = message.lower()
    if any(
        token in normalized
        for token in (
            "authentication",
            "api key",
            "unauthorized",
            "forbidden",
            "credential",
            "invalid token",
            "permissiondeniederror",
            "invalid_api_key",
            "status_code: 401",
            "status_code: 403",
            "status code: 401",
            "status code: 403",
            "error code: 401",
            "error code: 403",
            "http 401",
            "http 403",
            "凭证",
            "令牌",
        )
    ):
        return "auth"
    if "timeout" in normalized or "timed out" in normalized:
        return "timeout"
    if any(token in normalized for token in ("connection", "dns", "refused", "unreachable")):
        return "connection"
    if "invalid url" in normalized or ("404" in normalized and "/chat/completions" in normalized):
        return "model_endpoint"
    if any(
        token in normalized for token in ("404", "not found", "model_not_found", "unknown model")
    ):
        return "model_not_found"
    if "429" in normalized or "rate limit" in normalized:
        return "rate_limited"
    if any(token in normalized for token in ("format", "schema", "json", "provider")):
        return "provider_format"
    return "unknown"


def categorize_model_exception(error: BaseException) -> str:
    """Classify a provider failure across its bounded exception cause chain."""

    current: BaseException | None = error
    seen: set[int] = set()
    for _ in range(12):
        if current is None or id(current) in seen:
            break
        seen.add(id(current))
        if isinstance(current, ModelCredentialError):
            return "auth"
        if isinstance(current, ModelSelectionError):
            return "model_not_found"
        if isinstance(current, ModelRuntimeConfigurationError):
            return "model_endpoint"
        if isinstance(current, TimeoutError):
            return "timeout"
        category = categorize_model_error(f"{type(current).__name__}: {current}")
        if category != "unknown":
            return category
        current = current.__cause__ or current.__context__
    return "unknown"


@dataclass(frozen=True, slots=True)
class ResolvedModelConfig:
    """One resolved connection, independent of SDKs and stable for its task."""

    source_provider: str
    model: str
    display_name: str
    base_url: str
    api_key: str | None = field(repr=False)
    api_format: ModelAPIFormat
    api_key_required: bool
    model_id: str | None = None
    headers: Mapping[str, str] = field(default_factory=dict, repr=False)
    query_params: Mapping[str, str] = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "headers", MappingProxyType(dict(self.headers)))
        object.__setattr__(self, "query_params", MappingProxyType(dict(self.query_params)))

    @property
    def credentials_available(self) -> bool:
        return not self.api_key_required or bool(self.api_key)

    def public_snapshot(self, *, diagnostics: bool) -> dict[str, Any]:
        snapshot = {"model_id": self.model_id, "model_name": self.display_name}
        if diagnostics:
            snapshot.update(
                {
                    "model_identifier": self.model,
                    "source_provider": self.source_provider,
                    "api_format": self.api_format,
                    "provider_summary": f"{self.source_provider} · {self.api_format}",
                }
            )
        return snapshot


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
        base_url = fallback_base_url or default_base_url(provider)
        api_key = fallback_api_key
    else:
        # A persisted provider is an explicit trust boundary. Never borrow a
        # process-wide OpenAI key or URL for it: that could send a credential
        # or prompt to a different service than the user configured.
        base_url = getattr(model, "base_url", None) or default_base_url(provider)
        encrypted_api_key = getattr(model, "api_key_encrypted", None)
        api_key = None
        if encrypted_api_key:
            try:
                api_key = encryptor.decrypt(encrypted_api_key)
            except Exception as exc:
                raise ModelCredentialError("保存的 API Key 无法读取，请重新输入") from exc
        if not base_url:
            raise ModelRuntimeConfigurationError("此模型服务必须配置 Base URL")

    api_format: ModelAPIFormat = extra.api_format or default_api_format(provider)
    base_url = normalize_runtime_base_url(
        base_url,
        provider=provider,
        api_format=api_format,
    )
    if not base_url:
        raise ModelRuntimeConfigurationError("此模型服务必须配置 Base URL")

    resolved = ResolvedModelConfig(
        source_provider=provider,
        model=model_id,
        display_name=display_name,
        base_url=base_url,
        api_key=api_key,
        api_format=api_format,
        api_key_required=not extra.api_key_optional,
        model_id=str(model.id) if model is not None and getattr(model, "id", None) else None,
        headers=extra.headers,
        query_params=extra.query_params,
    )

    return resolved, extra
