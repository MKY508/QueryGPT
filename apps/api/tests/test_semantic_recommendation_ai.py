from __future__ import annotations

from contextlib import nullcontext
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import AppSettings
from app.services import semantic_recommendation_ai as recommendation_ai
from app.services.semantic_recommendation_ai import (
    build_semantic_recommendation_enhancer,
)
from tests.model_fixtures import synthetic_model_config


@pytest.mark.asyncio
async def test_ai_semantic_enhancer_respects_self_analysis_setting(
    db_session: AsyncSession,
) -> None:
    db_session.add(AppSettings(id=1, self_analysis_enabled=False))
    await db_session.commit()

    enhancer = await build_semantic_recommendation_enhancer(
        db_session,
        locale="zh",
        model_id=uuid4(),
    )

    assert enhancer is None


@pytest.mark.asyncio
async def test_ai_semantic_enhancer_uses_selected_model_and_only_returns_copy(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db_session.add(AppSettings(id=1, self_analysis_enabled=True))
    await db_session.commit()
    selected_model_id = uuid4()
    captured: dict[str, object] = {}

    class _Resolver:
        def __init__(self, _db, **kwargs):
            captured.update(kwargs)

        async def get_model_config(self):
            return synthetic_model_config(api_key_required=False)

    class _Agent:
        def __init__(self, runtime_model, **_kwargs):
            captured["runtime_model"] = runtime_model

        async def run(self, _prompt):
            return SimpleNamespace(
                output=SimpleNamespace(
                    items=[
                        recommendation_ai.SemanticRecommendationEnhancement(
                            candidate_id="candidate-1",
                            business_name="上架时间",
                            synonyms=["表格时间"],
                        )
                    ]
                )
            )

    monkeypatch.setattr(recommendation_ai, "ExecutionContextResolver", _Resolver)
    monkeypatch.setattr(
        recommendation_ai,
        "model_session",
        lambda _config, **_kwargs: nullcontext("runtime-model"),
    )
    monkeypatch.setattr(recommendation_ai, "Agent", _Agent)

    enhancer = await build_semantic_recommendation_enhancer(
        db_session,
        locale="zh",
        model_id=selected_model_id,
    )

    assert enhancer is not None
    result = await enhancer([{"candidate_id": "candidate-1"}])
    assert captured["model_name"] == str(selected_model_id)
    assert captured["language"] == "zh"
    assert captured["runtime_model"] == "runtime-model"
    assert result[0].business_name == "上架时间"
    assert result[0].synonyms == ["表格时间"]


@pytest.mark.asyncio
async def test_ai_semantic_enhancer_returns_fallback_when_model_is_unavailable(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db_session.add(AppSettings(id=1, self_analysis_enabled=True))
    await db_session.commit()

    class _UnavailableResolver:
        def __init__(self, *_args, **_kwargs):
            pass

        async def get_model_config(self):
            raise RuntimeError("provider unavailable")

    monkeypatch.setattr(
        recommendation_ai,
        "ExecutionContextResolver",
        _UnavailableResolver,
    )

    enhancer = await build_semantic_recommendation_enhancer(
        db_session,
        locale="zh",
        model_id=uuid4(),
    )

    assert enhancer is None
