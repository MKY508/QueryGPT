"""Focused contract tests for smart report-draft planning."""

from __future__ import annotations

import json
from contextlib import nullcontext
from types import SimpleNamespace
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import reports as reports_api
from app.db.tables import Project
from app.models.workspace import ReportDraftCurrentReportContext
from app.services import report_draft
from app.services.report_draft import ReportDraftPlan
from tests.model_fixtures import synthetic_model_config


@pytest.mark.asyncio
async def test_planner_builds_dynamic_sections_and_filters_artifact_ids(monkeypatch):
    project_id = uuid4()
    run_id = uuid4()
    metric_id = uuid4()
    existing_metric_id = uuid4()
    chart_id = uuid4()
    evidence_id = uuid4()
    report_id = uuid4()
    unknown_id = uuid4()
    run = SimpleNamespace(
        id=run_id,
        project_id=project_id,
        query="解释本月收入变化",
        state="completed",
        stage="completed",
        report={"summary": "收入增长，区域表现分化"},
    )
    artifacts = [
        SimpleNamespace(
            id=metric_id,
            kind="metric",
            title="本月收入",
            payload={"value": "128 万元", "context": "较上月 +8%"},
        ),
        SimpleNamespace(
            id=existing_metric_id,
            kind="metric",
            title="已在报告中的回款率",
            payload={"value": "91%"},
        ),
        SimpleNamespace(
            id=chart_id,
            kind="chart",
            title="区域收入趋势",
            payload={"chart": {"title": "区域收入趋势", "data": [{"region": "华东"}]}},
        ),
        SimpleNamespace(
            id=evidence_id,
            kind="evidence",
            title="收入核对记录",
            payload={"text": "收入汇总已核对"},
        ),
        SimpleNamespace(
            id=report_id,
            kind="report",
            title="重复报告副本",
            payload={"summary": "不应发送给规划器"},
        ),
    ]
    model_plan = ReportDraftPlan(
        title="本月收入增长与区域分化",
        description="先看增长结论，再解释区域驱动和核对依据。",
        sections=[
            {
                "role": "overview",
                "title": "增长发生了什么",
                "purpose": "让经营者先看到核心变化",
                "narrative": "收入保持增长，但区域贡献并不均衡。",
                "artifact_ids": [
                    str(metric_id),
                    str(existing_metric_id),
                    str(unknown_id),
                ],
            },
            {
                "role": "detail",
                "title": "哪些区域在驱动增长",
                "purpose": "解释增长来源",
                "artifact_ids": [str(metric_id), str(chart_id)],
            },
            {
                "role": "evidence",
                "title": "结论如何核对",
                "purpose": "保留可复核依据",
                "artifact_ids": [str(chart_id), str(evidence_id), str(report_id)],
            },
        ],
        selected_overview=[str(unknown_id)],
        highlights={
            str(metric_id): "收入较上月增长 8%。",
            str(evidence_id): "汇总结果已经核对。",
            str(existing_metric_id): "不应重复。",
            str(unknown_id): "未知产物。",
        },
    )
    captured: dict[str, object] = {}

    async def fake_require_run(*_args, **_kwargs):
        return run

    async def fake_load_artifacts(*_args, **_kwargs):
        return artifacts

    async def fake_resolve_model(*_args, **_kwargs):
        return synthetic_model_config(api_key_required=False)

    class FakeAgent:
        def __init__(self, _model, *, output_type, instructions, retries):
            captured["output_type"] = output_type
            captured["instructions"] = instructions
            captured["retries"] = retries

        async def run(self, prompt):
            captured["prompt"] = prompt
            return SimpleNamespace(output=model_plan.model_copy(deep=True))

    monkeypatch.setattr(report_draft, "_require_run", fake_require_run)
    monkeypatch.setattr(report_draft, "_load_artifacts", fake_load_artifacts)
    monkeypatch.setattr(report_draft, "_resolve_model", fake_resolve_model)
    monkeypatch.setattr(report_draft, "model_session", lambda _config, **_kwargs: nullcontext(object()))
    monkeypatch.setattr(report_draft, "Agent", FakeAgent)

    current_report = ReportDraftCurrentReportContext(
        title="经营月报",
        description="管理层已经编辑过的月报",
        pages=["经营摘要", "回款情况"],
        existing_artifact_ids=[existing_metric_id],
        has_user_edits=True,
    )
    plan = await report_draft.generate_report_draft_plan(
        object(),
        project_id=project_id,
        run_id=run_id,
        language="zh",
        current_report=current_report,
    )

    assert plan is not None
    assert [section.title for section in plan.sections] == [
        "增长发生了什么",
        "哪些区域在驱动增长",
        "结论如何核对",
    ]
    assert plan.sections[0].artifact_ids == [str(metric_id)]
    assert plan.sections[1].artifact_ids == [str(chart_id)]
    assert plan.sections[2].artifact_ids == [str(evidence_id)]
    assert plan.selected_overview == [str(metric_id)]
    assert plan.selected_detail == [str(chart_id)]
    assert plan.selected_evidence == [str(evidence_id)]
    assert plan.highlights == {
        str(metric_id): "收入较上月增长 8%。",
        str(evidence_id): "汇总结果已经核对。",
    }

    prompt = json.loads(str(captured["prompt"]))
    assert prompt["current_report"] == {
        "title": "经营月报",
        "description": "管理层已经编辑过的月报",
        "pages": ["经营摘要", "回款情况"],
        "existing_artifact_ids": [str(existing_metric_id)],
        "has_user_edits": True,
    }
    assert str(report_id) not in {artifact["id"] for artifact in prompt["artifacts"]}
    assert "业务主题" in str(captured["instructions"])
    assert "不要重复" in str(captured["instructions"])


@pytest.mark.asyncio
async def test_planner_supports_summary_only_runs_and_repairs_blank_section_copy(
    monkeypatch,
):
    project_id = uuid4()
    run_id = uuid4()
    run = SimpleNamespace(
        id=run_id,
        project_id=project_id,
        query="整理本周经营判断",
        state="completed",
        stage="completed",
        report={"summary": "本周经营稳定，但仍需观察回款。"},
    )
    model_plan = ReportDraftPlan(
        title="本周经营判断",
        description="汇总本周判断和后续观察。",
        sections=[
            {
                "role": "overview",
                "title": "   ",
                "purpose": "   ",
                "narrative": "本周经营稳定。",
                "artifact_ids": [],
            },
            {
                "role": "detail",
                "title": "后续观察",
                "purpose": "记录下一步关注方向",
                "narrative": "继续观察回款变化。",
                "artifact_ids": [],
            },
        ],
    )

    async def fake_require_run(*_args, **_kwargs):
        return run

    async def fake_load_artifacts(*_args, **_kwargs):
        return []

    async def fake_resolve_model(*_args, **_kwargs):
        return synthetic_model_config(api_key_required=False)

    class FakeAgent:
        def __init__(self, *_args, **_kwargs):
            pass

        async def run(self, _prompt):
            return SimpleNamespace(output=model_plan.model_copy(deep=True))

    monkeypatch.setattr(report_draft, "_require_run", fake_require_run)
    monkeypatch.setattr(report_draft, "_load_artifacts", fake_load_artifacts)
    monkeypatch.setattr(report_draft, "_resolve_model", fake_resolve_model)
    monkeypatch.setattr(report_draft, "model_session", lambda _config, **_kwargs: nullcontext(object()))
    monkeypatch.setattr(report_draft, "Agent", FakeAgent)

    plan = await report_draft.generate_report_draft_plan(
        object(),
        project_id=project_id,
        run_id=run_id,
        language="zh",
    )

    assert plan is not None
    assert plan.sections[0].title == "第 1 节"
    assert plan.sections[0].purpose == "组织与本节相关的结论"
    assert plan.sections[0].artifact_ids == []
    assert plan.overview_text == "本周经营稳定。"


def test_draft_route_is_registered_once():
    matching_routes = [
        route
        for route in reports_api.router.routes
        if route.path == "/projects/{project_id}/reports/draft-from-analysis"
        and "POST" in route.methods
    ]

    assert len(matching_routes) == 1


@pytest.mark.asyncio
async def test_draft_route_forwards_current_report_and_returns_sections(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch,
):
    project = Project(name="经营分析")
    db_session.add(project)
    await db_session.flush()
    run_id = uuid4()
    artifact_id = uuid4()
    captured: dict[str, object] = {}

    async def fake_generate(_db, **kwargs):
        captured.update(kwargs)
        return ReportDraftPlan(
            title="渠道增长报告",
            description="解释渠道增长与核对依据。",
            sections=[
                {
                    "role": "overview",
                    "title": "渠道增长结论",
                    "purpose": "先给出结论",
                    "artifact_ids": [str(artifact_id)],
                },
                {
                    "role": "evidence",
                    "title": "口径与核对",
                    "purpose": "说明结论依据",
                    "artifact_ids": [],
                },
            ],
            selected_overview=[str(artifact_id)],
        )

    monkeypatch.setattr(reports_api, "generate_report_draft_plan", fake_generate)
    response = await client.post(
        f"/api/v1/projects/{project.id}/reports/draft-from-analysis",
        json={
            "analysis_run_id": str(run_id),
            "language": "zh",
            "current_report": {
                "title": "渠道月报",
                "description": "已经有人工作为调整",
                "pages": ["管理摘要"],
                "existing_artifact_ids": [],
                "has_user_edits": True,
            },
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()["data"]
    assert [section["title"] for section in payload["sections"]] == [
        "渠道增长结论",
        "口径与核对",
    ]
    assert payload["selected_overview"] == [str(artifact_id)]
    assert captured["run_id"] == run_id
    assert captured["language"] == "zh"
    assert captured["current_report"].pages == ["管理摘要"]
    assert captured["current_report"].has_user_edits is True


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("language", "expected_detail"),
    [
        ("zh", "智能整理暂不可用，请稍后再试或手动选择内容"),
        (
            "en",
            "Smart report planning is temporarily unavailable. Please try again later "
            "or select content manually.",
        ),
    ],
)
async def test_draft_route_localizes_unavailable_detail(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch,
    language: str,
    expected_detail: str,
):
    project = Project(name=f"Unavailable {language}")
    db_session.add(project)
    await db_session.flush()

    async def unavailable(*_args, **_kwargs):
        return None

    monkeypatch.setattr(reports_api, "generate_report_draft_plan", unavailable)
    response = await client.post(
        f"/api/v1/projects/{project.id}/reports/draft-from-analysis",
        json={"analysis_run_id": str(uuid4()), "language": language},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == expected_detail
