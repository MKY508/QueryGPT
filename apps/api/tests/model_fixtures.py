"""Explicit, non-network model configurations for boundary and business tests."""

from typing import Any

from app.services.model_runtime import ResolvedModelConfig


def synthetic_model_config(**overrides: Any) -> ResolvedModelConfig:
    return ResolvedModelConfig(
        **{
            "source_provider": "openai",
            "model": "test-model",
            "display_name": "Synthetic model",
            "base_url": "https://model.invalid/v1",
            "api_key": "test-only",
            "api_format": "openai_compatible",
            "api_key_required": True,
            **overrides,
        }
    )
