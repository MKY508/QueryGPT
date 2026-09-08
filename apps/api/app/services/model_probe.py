"""Exercise the analysis model contract without accessing any project data."""

import asyncio
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

from pydantic import BaseModel
from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.exceptions import UnexpectedModelBehavior, UsageLimitExceeded
from pydantic_ai.usage import UsageLimits

from app.models.config import ModelTest
from app.services.model_engine import model_session
from app.services.model_runtime import ResolvedModelConfig, categorize_model_exception


@dataclass
class _ProbeState:
    receipt: str = field(default_factory=lambda: uuid4().hex)
    tool_called: bool = False


class _ProbeOutput(BaseModel):
    """Return the exact receipt obtained from read_check_value."""

    receipt: str


async def read_check_value(ctx: RunContext[_ProbeState]) -> dict[str, str]:
    """Read the temporary receipt required to finish this connection check."""
    ctx.deps.tool_called = True
    return {"receipt": ctx.deps.receipt}


def _public_base_url(value: str | None) -> str | None:
    if not value:
        return None
    try:
        parsed = urlsplit(value)
        hostname, port = parsed.hostname, parsed.port
    except ValueError:
        return None
    if not hostname:
        return None
    host = f"[{hostname}]" if ":" in hostname else hostname
    return urlunsplit((parsed.scheme, f"{host}:{port}" if port else host, parsed.path, "", ""))


def probe_failure(
    category: str,
    *,
    message: str | None = None,
    config: ResolvedModelConfig | None = None,
    base_url: str | None = None,
) -> ModelTest:
    messages = {
        "auth": "API Key 无效",
        "timeout": "请求超时",
        "connection": "连接失败，请检查网络或 Base URL",
        "model_not_found": "模型不存在或该网关不支持此模型",
        "model_endpoint": "模型服务地址不可用，请检查 Base URL 与协议设置",
        "rate_limited": "模型服务请求过于频繁，请稍后重试",
        "provider_format": "模型服务返回格式不兼容，请检查协议设置",
        "tool_calling": "模型未能完成工具调用，请检查模型与协议设置",
        "structured_output": "模型未能返回有效的分析结果，请检查模型与协议设置",
    }
    return ModelTest(
        success=False,
        message=message or f"测试失败: {messages.get(category, '连接测试失败，请检查模型配置')}",
        source_provider=config.source_provider if config else None,
        resolved_base_url=_public_base_url(config.base_url if config else base_url),
        api_format=config.api_format if config else None,
        api_key_required=config.api_key_required if config else True,
        error_category=category,
        health_status="unhealthy",
        checked_at=datetime.now(UTC),
    )


async def probe_model(config: ResolvedModelConfig, *, timeout_seconds: float = 30) -> ModelTest:
    """Prove one tool round-trip and validated tool output using the shared engine.

    The receipt is absent from the prompt and schema. Merely returning text or
    calling the final-output tool cannot pass. This is a bounded synthetic check,
    not a claim about the quality of arbitrary future analyses.
    """
    if not config.credentials_available:
        return probe_failure("auth", message="未配置 API Key", config=config)

    state = _ProbeState()
    started = time.monotonic()
    try:
        async with asyncio.timeout(timeout_seconds), model_session(config) as model:
            agent = Agent(
                model,
                deps_type=_ProbeState,
                output_type=_ProbeOutput,
                tools=[read_check_value],
                instructions=(
                    "Call read_check_value once. Then return its exact receipt as the final "
                    "structured result. Do not invent a receipt or answer in plain text."
                ),
                retries=1,
            )

            @agent.output_validator
            def validate_receipt(
                ctx: RunContext[_ProbeState], output: _ProbeOutput
            ) -> _ProbeOutput:
                if not ctx.deps.tool_called or output.receipt != ctx.deps.receipt:
                    raise ModelRetry("Call read_check_value and return its exact receipt.")
                return output

            await agent.run(
                "Check this connection.",
                deps=state,
                usage_limits=UsageLimits(request_limit=3, tool_calls_limit=1),
            )
    except (UnexpectedModelBehavior, UsageLimitExceeded):
        category = "structured_output" if state.tool_called else "tool_calling"
        return probe_failure(category, config=config)
    except Exception as error:
        return probe_failure(categorize_model_exception(error), config=config)

    return ModelTest(
        success=True,
        message="连接成功",
        model_name=config.model,
        response_time_ms=int((time.monotonic() - started) * 1000),
        source_provider=config.source_provider,
        resolved_base_url=_public_base_url(config.base_url),
        api_format=config.api_format,
        api_key_required=config.api_key_required,
        health_status="healthy",
        checked_at=datetime.now(UTC),
    )
