"""LLM-powered planning for investigation report drafts.

The InvestigationPicker/ReportWorkspace calls into this service to decide
*what* a smart report draft should contain: a refined title and description,
which artifacts to feature in each section, and short highlight annotations.
The final block composition (charts, tables, evidence cards, grid layout) is
still done by the frontend using the same deterministic helpers it already
uses for the non-LLM draft.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field
from pydantic_ai import Agent
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.tables import AnalysisRun, ArtifactRecord, Project
from app.models.workspace import ReportDraftCurrentReportContext
from app.services.app_settings import get_or_create_app_settings, settings_to_dict
from app.services.execution_context import ExecutionContextResolver
from app.services.model_engine import model_session
from app.services.model_runtime import ResolvedModelConfig

logger = logging.getLogger(__name__)


class ReportDraftSection(BaseModel):
    """One reader-oriented section in a model-authored report plan."""

    role: Literal["overview", "detail", "evidence"]
    title: str = Field(..., min_length=1, max_length=160)
    purpose: str = Field(..., min_length=1, max_length=400)
    narrative: str | None = Field(default=None, max_length=800)
    artifact_ids: list[str] = Field(default_factory=list, max_length=12)


class ReportDraftPlan(BaseModel):
    """LLM-authored plan for assembling an investigation report draft."""

    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field(..., min_length=1, max_length=600)
    overview_text: str | None = Field(default=None, max_length=800)
    sections: list[ReportDraftSection] = Field(..., min_length=2, max_length=4)
    # Compatibility fields for clients that still materialize three fixed pages.
    # The service derives them from ``sections`` after validating artifact IDs.
    selected_overview: list[str] = Field(default_factory=list, max_length=4)
    selected_detail: list[str] = Field(default_factory=list, max_length=8)
    selected_evidence: list[str] = Field(default_factory=list, max_length=6)
    highlights: dict[str, str] = Field(default_factory=dict)


_LANG_NAMES = {"zh": "中文", "en": "English"}


def _artifact_digest(artifact: ArtifactRecord) -> dict[str, Any]:
    """Return a compact, safe-to-send-to-LLM description of one artifact."""

    payload = artifact.payload or {}
    candidates: list[tuple[str, Any]] = [
        ("text", payload.get("text")),
        ("summary", payload.get("summary")),
        ("description", payload.get("description")),
        ("context", payload.get("context")),
        ("value", payload.get("value")),
        ("metric_value", payload.get("metric_value")),
        ("amount", payload.get("amount")),
        ("result", payload.get("result")),
        ("total", payload.get("total")),
        ("title", payload.get("title")),
        ("message", payload.get("message")),
    ]
    snippet = ""
    for _, value in candidates:
        if isinstance(value, str) and value.strip():
            snippet = value.strip()
            break
        if isinstance(value, (int, float)) and value == value:  # NaN-safe
            snippet = str(value)
            break
    if not snippet:
        chart = payload.get("chart")
        if isinstance(chart, dict):
            chart_title = chart.get("title")
            chart_data = chart.get("data")
            if isinstance(chart_title, str) and chart_title.strip():
                snippet = chart_title.strip()
            elif isinstance(chart_data, list):
                snippet = f"{len(chart_data)} 条数据点"
        elif isinstance(payload.get("columns"), list):
            snippet = f"{len(payload['columns'])} 个字段"
        elif isinstance(payload.get("rows"), list):
            snippet = f"{len(payload['rows'])} 条记录"
    if len(snippet) > 240:
        snippet = f"{snippet[:237]}…"
    return {
        "id": str(artifact.id),
        "kind": artifact.kind,
        "title": (artifact.title or "").strip(),
        "snippet": snippet,
    }


def _build_prompt(
    run: AnalysisRun,
    artifacts: list[ArtifactRecord],
    language: str,
    current_report: ReportDraftCurrentReportContext | None = None,
) -> str:
    """Serialise run + artifacts into a compact JSON payload for the LLM."""

    report = run.report or {}
    summary_text = ""
    for key in ("summary", "answer", "title"):
        value = report.get(key)
        if isinstance(value, str) and value.strip():
            summary_text = value.strip()
            break
    context = {
        "investigation": {
            "query": (run.query or "").strip(),
            "stage": run.stage,
            "state": run.state,
            "summary": summary_text,
        },
        "language": _LANG_NAMES.get(language, "中文"),
        "artifacts": [_artifact_digest(artifact) for artifact in artifacts],
        "current_report": (
            current_report.model_dump(mode="json") if current_report is not None else None
        ),
    }
    return json.dumps(context, ensure_ascii=False, default=str)


def _build_instructions(language: str) -> str:
    if language == "en":
        return (
            "You plan an editable, reader-oriented business report from one completed "
            "investigation and its reusable artifacts. Reply in English with one JSON "
            "object conforming to ReportDraftPlan.\n"
            "- title: a concise business title grounded in the investigation.\n"
            "- description: 1–3 sentences explaining what the reader will learn; do "
            "not invent facts or numbers.\n"
            "- sections: create 2–4 sections. Organize them by business theme, decision, "
            "or reader question rather than by artifact type. Give each section a "
            "specific reader-facing title, a role (overview, detail, or evidence), a "
            "short purpose, optional narrative, and ordered artifact_ids. Titles should "
            "not mechanically repeat 'Overview', 'Detail', and 'Evidence'.\n"
            "- Arrange the reading flow from answer and key signals, through drivers or "
            "segments, to supporting detail and evidence. A section may have no artifact "
            "when its narrative is useful.\n"
            "- overview_text remains optional for older clients. Leave selected_overview, "
            "selected_detail, and selected_evidence empty; the server derives them from "
            "sections.\n"
            "- highlights: at most one short, evidence-grounded sentence per selected "
            "artifact id.\n\n"
            "RULES:\n"
            "1. Use only ids from artifacts, and use each id in at most one section.\n"
            "2. An evidence-role section may select only evidence or file artifacts.\n"
            "3. If current_report is present and non-empty, complement its existing pages "
            "and artifact ids instead of repeating them. Preserve user-authored structure "
            "when has_user_edits is true.\n"
            "4. Do not fabricate facts, numbers, fields, or artifact ids."
        )
    return (
        "你要根据一次已完成的调查及其可复用产物，规划一份面向读者、可继续编辑的"
        "业务报表。请用中文回复，输出必须是符合 ReportDraftPlan schema 的单个 JSON 对象。\n"
        "- title：基于调查问题与证据凝练的业务标题。\n"
        "- description：用 1–3 句话说明读者会看到什么，不得编造事实或数字。\n"
        "- sections：生成 2–4 节。按照业务主题、决策或读者问题组织，不要按产物类型"
        "机械分组。每节包含具体、面向读者的 title，role（overview、detail 或 evidence）、"
        "简短 purpose、可选 narrative，以及按阅读顺序排列的 artifact_ids。标题不要机械"
        "重复“概览、明细、依据”。\n"
        "- 阅读顺序应从结论和关键信号开始，再解释驱动因素或业务分组，最后给出明细与"
        "证据。若叙述本身有价值，某节可以不引用产物。\n"
        "- overview_text 仅用于兼容旧客户端，可为空。selected_overview、selected_detail、"
        "selected_evidence 请留空，由服务端根据 sections 派生。\n"
        "- highlights：只为已选择的产物给出基于证据的一句话标注。\n\n"
        "规则：\n"
        "1. 只能引用 artifacts 中存在的 id，同一 id 最多出现在一节。\n"
        "2. role 为 evidence 的节只能选择 evidence 或 file 产物。\n"
        "3. 若 current_report 非空，应补充已有页面和产物，不要重复；has_user_edits 为 true 时"
        "应保留用户已经组织的结构。\n"
        "4. 不得捏造事实、数字、字段或产物 id。"
    )


async def _load_artifacts(db: AsyncSession, project_id: UUID, run_id: UUID) -> list[ArtifactRecord]:
    result = await db.execute(
        select(ArtifactRecord)
        .where(
            ArtifactRecord.project_id == project_id,
            ArtifactRecord.analysis_run_id == run_id,
            ArtifactRecord.kind != "report",
        )
        .order_by(ArtifactRecord.created_at)
    )
    return list(result.scalars().all())


async def _resolve_model(db: AsyncSession, project_id: UUID) -> ResolvedModelConfig | None:
    settings_record = await get_or_create_app_settings(db)
    resolver = ExecutionContextResolver(
        db,
        settings_data=settings_to_dict(settings_record),
    )
    try:
        return await resolver.get_model_config()
    except Exception as exc:  # noqa: BLE001 - surface as a fallback signal
        logger.info("report_draft: model resolution failed: %s", exc)
        return None


async def _require_run(db: AsyncSession, project_id: UUID, run_id: UUID) -> AnalysisRun | None:
    project = await db.get(Project, project_id)
    if project is None:
        return None
    run = await db.get(AnalysisRun, run_id)
    if run is None or run.project_id != project_id:
        return None
    return run


async def generate_report_draft_plan(
    db: AsyncSession,
    *,
    project_id: UUID,
    run_id: UUID,
    language: str = "zh",
    current_report: ReportDraftCurrentReportContext | None = None,
    timeout_seconds: float = 20.0,
) -> ReportDraftPlan | None:
    """Call the configured model to produce a report-draft plan.

    Returns ``None`` when the model is missing, the run is unavailable, or the
    LLM call fails or times out. The API surfaces that state explicitly so the
    client can offer retry or a user-chosen deterministic template.
    """

    run = await _require_run(db, project_id, run_id)
    if run is None or run.state != "completed":
        return None

    # Keep this post-query guard as well as the SQL predicate so test doubles and
    # future alternate loaders cannot accidentally expose the run's report copy
    # as a reusable building block.
    artifacts = [
        artifact
        for artifact in await _load_artifacts(db, project_id, run_id)
        if artifact.kind != "report"
    ]
    model_config = await _resolve_model(db, project_id)
    if model_config is None or not model_config.credentials_available:
        return None

    prompt = _build_prompt(run, artifacts, language, current_report)
    try:
        async with asyncio.timeout(timeout_seconds), model_session(model_config) as runtime_model:
            agent = Agent(
                runtime_model,
                output_type=ReportDraftPlan,
                instructions=_build_instructions(language),
                retries={"output": 2},
            )
            result = await agent.run(prompt)
    except TimeoutError:
        logger.info("report_draft: LLM timed out after %ss", timeout_seconds)
        return None
    except Exception as exc:  # noqa: BLE001
        logger.info("report_draft: LLM call failed: %s", exc)
        return None

    plan = _sanitize_plan(result.output, artifacts, current_report, language=language)
    plan.title = plan.title.strip() or run.query.strip() or settings.APP_NAME
    summary = (run.report or {}).get("summary")
    fallback_description = summary.strip() if isinstance(summary, str) else ""
    plan.description = (
        plan.description.strip() or fallback_description or run.query.strip() or plan.title
    )
    return plan


def _sanitize_plan(
    plan: ReportDraftPlan,
    artifacts: list[ArtifactRecord],
    current_report: ReportDraftCurrentReportContext | None,
    *,
    language: str = "zh",
) -> ReportDraftPlan:
    """Validate model-selected IDs and derive the fixed-page compatibility fields."""

    available = {str(artifact.id): artifact for artifact in artifacts if artifact.kind != "report"}
    blocked = (
        {str(artifact_id) for artifact_id in current_report.existing_artifact_ids}
        if current_report is not None
        else set()
    )
    seen: set[str] = set()
    selected_by_role: dict[str, list[str]] = {
        "overview": [],
        "detail": [],
        "evidence": [],
    }

    for index, section in enumerate(plan.sections):
        cleaned_ids: list[str] = []
        for raw_id in section.artifact_ids:
            artifact_id = str(raw_id)
            artifact = available.get(artifact_id)
            if artifact is None or artifact_id in seen or artifact_id in blocked:
                continue
            if section.role == "evidence" and artifact.kind not in {"evidence", "file"}:
                continue
            seen.add(artifact_id)
            cleaned_ids.append(artifact_id)
            selected_by_role[section.role].append(artifact_id)
        section.artifact_ids = cleaned_ids
        section.title = section.title.strip() or (
            f"Section {index + 1}" if language == "en" else f"第 {index + 1} 节"
        )
        section.purpose = section.purpose.strip() or (
            "Organize the relevant findings" if language == "en" else "组织与本节相关的结论"
        )
        section.narrative = section.narrative.strip() if section.narrative else None

    # Old clients still understand three fixed buckets. Keep those fields
    # deterministic and within their established response limits.
    plan.selected_overview = selected_by_role["overview"][:4]
    plan.selected_detail = selected_by_role["detail"][:8]
    plan.selected_evidence = selected_by_role["evidence"][:6]

    if plan.overview_text:
        plan.overview_text = plan.overview_text.strip() or None
    if plan.overview_text is None:
        plan.overview_text = next(
            (
                section.narrative
                for section in plan.sections
                if section.role == "overview" and section.narrative
            ),
            None,
        )

    selected_ids = set().union(*selected_by_role.values())
    plan.highlights = {
        artifact_id: highlight.strip()[:280]
        for artifact_id, highlight in plan.highlights.items()
        if artifact_id in selected_ids and highlight.strip()
    }
    return plan
