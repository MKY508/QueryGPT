"""Optional AI presentation enhancement for governed semantic candidates.

The deterministic recommendation service owns candidate identity and every
executable binding.  This module only lets the configured model improve names,
descriptions, examples, and synonyms. The factory returns ``None`` when AI is
unavailable; invocation failures are handled by the deterministic consumer.
"""

from __future__ import annotations

import asyncio
import json
from typing import Literal
from uuid import UUID

import structlog
from pydantic import BaseModel, Field
from pydantic_ai import Agent
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.app_settings import get_or_create_app_settings, settings_to_dict
from app.services.execution_context import ExecutionContextResolver
from app.services.model_engine import model_session
from app.services.semantic_recommendations import (
    SemanticRecommendationEnhancement,
    SemanticRecommendationEnhancer,
)

logger = structlog.get_logger()


class _SemanticRecommendationEnhancementSet(BaseModel):
    items: list[SemanticRecommendationEnhancement] = Field(
        ...,
        min_length=1,
        max_length=50,
    )


_AI_INSTRUCTIONS = {
    "zh": (
        "你只负责润色候选业务语义的展示文本。输入中的 candidate_id 必须原样保留，"
        "每个 ID 恰好返回一次；不得增加、删除、合并或重新排序候选。只可填写 business_name、"
        "description、example_questions、synonyms，不得修改绑定、公式、指标算法、关系或可信度。"
        "中文名称必须结合数据源、表、同表字段和已有说明理解；未知缩写不得臆造含义，"
        "可保留大写缩写并翻译已知词，例如 unknown_label_a 可写作 UNKNOWN 标签 A。"
        "不能只把下划线替换为空格冒充翻译。表达应简洁、面向业务，并明确这些仍是待验证候选。"
    ),
    "en": (
        "You only polish presentation text for candidate business semantics. "
        "Return every input candidate_id exactly once and unchanged; do not add, remove, merge, "
        "or reorder candidates. Only business_name, description, example_questions, and synonyms "
        "may be supplied. Never infer bindings, formulas, metric operations, relationships, or "
        "confidence, and make clear that each item is still a candidate pending validation."
    ),
}


async def build_semantic_recommendation_enhancer(
    db: AsyncSession,
    *,
    locale: Literal["zh", "en"],
    model_id: UUID | None,
) -> SemanticRecommendationEnhancer | None:
    """Build a presentation-only enhancer when the user enabled AI suggestions.

    Returning ``None`` is deliberate: deterministic candidates remain available
    when settings, credentials, or the selected provider are unavailable.
    """

    try:
        settings_record = await get_or_create_app_settings(db)
        if not settings_record.self_analysis_enabled:
            return None
        resolver = ExecutionContextResolver(
            db,
            model_name=str(model_id) if model_id else None,
            language=locale,
            settings_data=settings_to_dict(settings_record),
        )
        model_config = await resolver.get_model_config()
        if not model_config.credentials_available:
            return None
    except Exception as exc:  # noqa: BLE001 - optional enhancement must fail open
        logger.info(
            "Semantic recommendation model unavailable; using deterministic presentation",
            error_type=type(exc).__name__,
        )
        return None

    async def enhance(
        items: list[dict[str, object]],
    ) -> list[SemanticRecommendationEnhancement]:
        prompt = {
            "locale": locale,
            "candidates": items,
            "allowed_changes": [
                "business_name",
                "description",
                "example_questions",
                "synonyms",
            ],
        }
        async with asyncio.timeout(15), model_session(model_config) as runtime_model:
            agent = Agent(
                runtime_model,
                output_type=_SemanticRecommendationEnhancementSet,
                instructions=_AI_INSTRUCTIONS[locale],
                retries={"output": 2},
            )
            result = await agent.run(json.dumps(prompt, ensure_ascii=False, default=str))
        return result.output.items

    return enhance


__all__ = ["build_semantic_recommendation_enhancer"]
