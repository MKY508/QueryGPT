"""Focused tests for runtime capability and disclosure settings."""

from __future__ import annotations

import json
from contextlib import nullcontext
from dataclasses import FrozenInstanceError
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from pydantic_ai.models.test import TestModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.tables import AnalysisRun, ArtifactRecord, Project, SemanticEntry
from app.models import SSEEvent
from app.services import analyst_runtime
from app.services.analyst.python_tools import execute_python_code
from app.services.analyst_runtime import PydanticAnalystRuntime
from app.services.execution import ExecutionService
from app.services.execution_policy import ExecutionPolicy, ExecutionPolicyError
from app.services.project_context import ProjectRuntimeContext
from tests.model_fixtures import synthetic_model_config


def test_execution_policy_is_immutable_and_malformed_flags_fail_closed():
    policy = ExecutionPolicy.from_settings(
        {
            "python_enabled": "false",
            "auto_repair_enabled": 1,
            "diagnostics_enabled": False,
        }
    )

    assert policy == ExecutionPolicy(
        python_enabled=False,
        auto_repair_enabled=False,
        diagnostics_enabled=False,
    )
    with pytest.raises(FrozenInstanceError):
        policy.python_enabled = True  # type: ignore[misc]


def test_diagnostics_policy_removes_raw_result_and_progress_details():
    policy = ExecutionPolicy(diagnostics_enabled=False)

    result = policy.public_event_data(
        "result",
        {
            "content": "收入增长",
            "report": {"evidence": ["已核对完整订单结果"]},
            "sql": "SELECT secret FROM orders",
            "python": {"code": "print('secret')"},
            "tool_history": [{"kind": "sql", "sql": "SELECT secret FROM orders"}],
            "diagnostics": [{"message": "raw provider failure"}],
        },
    )
    progress = policy.public_event_data(
        "progress",
        {
            "stage": "investigating",
            "message": "正在核对",
            "diagnostic_entry": {"message": "raw retry detail"},
        },
    )

    assert result == {
        "content": "收入增长",
        "report": {"evidence": ["已核对完整订单结果"]},
    }
    assert progress == {"stage": "investigating", "message": "正在核对"}
    assert policy.public_event_data("python_output", {"output": "secret"}) is None


@pytest.mark.asyncio
async def test_python_policy_hides_tools_and_blocks_defensive_execution(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "WORKSPACE_ROOT", tmp_path)
    monkeypatch.setattr(
        analyst_runtime, "model_session", lambda _config, **_kwargs: nullcontext(TestModel())
    )
    runtime = PydanticAnalystRuntime(
        model_config=synthetic_model_config(),
        project_context=ProjectRuntimeContext(project_id=uuid4(), name="受限项目"),
        execution_policy=ExecutionPolicy(
            python_enabled=False,
            auto_repair_enabled=False,
            diagnostics_enabled=False,
        ),
    )

    registered_tools = {name for toolset in runtime.agent.toolsets for name in toolset.tools}

    assert {
        "render_chart",
        "analyze_with_python",
        "install_python_packages",
    }.isdisjoint(registered_tools)
    assert "query_source_data" in registered_tools
    assert runtime.agent._max_tool_retries == 0
    assert runtime.agent._max_output_retries == 0
    with pytest.raises(ExecutionPolicyError, match="Python 能力已关闭"):
        await execute_python_code(runtime.deps, "print(1)", sql_data={})


@pytest.mark.asyncio
async def test_auto_repair_off_does_not_install_missing_python_modules(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "WORKSPACE_ROOT", tmp_path)
    monkeypatch.setattr(
        analyst_runtime, "model_session", lambda _config, **_kwargs: nullcontext(TestModel())
    )
    runtime = PydanticAnalystRuntime(
        model_config=synthetic_model_config(),
        project_context=ProjectRuntimeContext(project_id=uuid4(), name="无自动修复项目"),
        execution_policy=ExecutionPolicy(
            python_enabled=True,
            auto_repair_enabled=False,
            diagnostics_enabled=True,
        ),
    )
    assert "install_python_packages" not in {
        name for toolset in runtime.agent.toolsets for name in toolset.tools
    }
    with pytest.raises(ExecutionPolicyError, match="自动修复已关闭"):
        runtime.execution_policy.require_auto_repair("Python 依赖安装")

    install = AsyncMock()
    execute = AsyncMock()
    monkeypatch.setattr(
        runtime.deps.python_sandbox,
        "missing_modules",
        lambda _code: ["missing_receiptbi_probe"],
    )
    monkeypatch.setattr(runtime.deps.dependency_manager, "install", install)
    monkeypatch.setattr(runtime.deps.python_sandbox, "execute", execute)

    with pytest.raises(RuntimeError, match="已关闭自动修复"):
        await execute_python_code(
            runtime.deps,
            "import missing_receiptbi_probe",
            sql_data={},
        )

    install.assert_not_awaited()
    execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_diagnostics_off_never_persists_raw_execution_material(
    db_session: AsyncSession,
):
    project = Project(name="最小证据项目")
    db_session.add(project)
    await db_session.flush()
    run = AnalysisRun(project_id=project.id, query="查看收入")
    db_session.add(run)
    await db_session.commit()
    raw_sql = "SELECT top_secret_amount FROM private_orders"
    raw_python = "print('private-python-output')"
    service = ExecutionService(
        db_session,
        project_id=project.id,
        settings_data={
            "python_enabled": True,
            "auto_repair_enabled": True,
            "diagnostics_enabled": False,
        },
    )

    await service._stage_project_result(
        run,
        {
            "analysis_state": "completed",
            "report": {
                "status": "completed",
                "title": "收入结果",
                "summary": "本期收入为 10。",
                "metrics": [],
                "evidence": ["已核对完整结果"],
            },
            "result_name": "income_total",
            "data": [{"income": 10}],
            "rows_count": 1,
            "sql": raw_sql,
            "python": {"code": raw_python, "output": "private-python-output"},
            "tool_history": [
                {
                    "kind": "structured_query",
                    "sql": raw_sql,
                    "result_name": "income_total",
                    "rows": 1,
                },
                {
                    "kind": "validation",
                    "status": "passed",
                    "result_name": "income_total",
                    "result_hash": "verified-result-hash",
                    "profile": {
                        "materialized_rows": 1,
                        "columns": ["income"],
                        "truncated": False,
                    },
                },
            ],
            "python_images": [],
            "knowledge_proposals": [],
            "confirmed_corrections": [],
        },
    )

    await db_session.refresh(run)
    artifact_result = await db_session.execute(
        select(ArtifactRecord).where(ArtifactRecord.analysis_run_id == run.id)
    )
    artifacts = list(artifact_result.scalars())
    serialized = json.dumps(
        {
            "checkpoint": run.checkpoint,
            "artifacts": [
                {
                    "payload": artifact.payload,
                    "technical_details": artifact.technical_details,
                }
                for artifact in artifacts
            ],
        },
        ensure_ascii=False,
        default=str,
    )
    semantic_result = await db_session.execute(
        select(SemanticEntry).where(
            SemanticEntry.project_id == project.id,
            SemanticEntry.entry_type == "verified_query",
        )
    )

    assert raw_sql not in serialized
    assert raw_python not in serialized
    assert "private-python-output" not in serialized
    assert '"tool_history"' not in serialized
    assert run.checkpoint["resumable"] is False
    assert run.checkpoint["business_evidence"][0]["kind"] == "validation"
    assert semantic_result.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_python_disabled_rejects_python_result_at_persistence_boundary(
    db_session: AsyncSession,
):
    project = Project(name="禁用 Python 项目")
    db_session.add(project)
    await db_session.flush()
    run = AnalysisRun(project_id=project.id, query="运行 Python")
    db_session.add(run)
    await db_session.commit()
    service = ExecutionService(
        db_session,
        project_id=project.id,
        settings_data={"python_enabled": False},
    )

    with pytest.raises(ExecutionPolicyError, match="拒绝写入"):
        await service._stage_project_result(
            run,
            {
                "analysis_state": "completed",
                "report": {"status": "completed", "title": "不应保存"},
                "tool_history": [{"kind": "python", "code": "print(1)"}],
            },
        )

    artifact_result = await db_session.execute(
        select(ArtifactRecord).where(ArtifactRecord.analysis_run_id == run.id)
    )
    assert list(artifact_result.scalars()) == []


def test_execution_service_sanitizes_stream_events_before_chat_persistence():
    service = ExecutionService(
        AsyncMock(),
        settings_data={"diagnostics_enabled": False},
    )
    event = SSEEvent.result(
        "分析完成",
        sql="SELECT private_value FROM orders",
        python={"code": "print('private')"},
        tool_history=[{"kind": "sql", "sql": "SELECT private_value FROM orders"}],
        diagnostics=[{"message": "raw diagnostic"}],
        report={"evidence": ["已核对结果"]},
    )

    public_event = service._public_event(event)

    assert public_event is not None
    assert public_event.data == {
        "content": "分析完成",
        "data": None,
        "rows_count": None,
        "execution_time": None,
        "report": {"evidence": ["已核对结果"]},
    }
