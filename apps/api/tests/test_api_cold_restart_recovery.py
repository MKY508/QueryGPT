"""Cold-restart acceptance gate for durable analysis runs.

The parent test launches two independent Python processes against one temporary
SQLite database and workspace.  The first process leaves a run investigating
with a real on-disk checkpoint; the second starts the real FastAPI lifespan,
observes startup recovery through the public API, and resumes the same run with
PydanticAI's deterministic TestModel.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import secrets
import subprocess
import sys
from contextlib import nullcontext
from pathlib import Path
from typing import Any

import pytest

_RESULT_PREFIX = "RECEIPTBI_COLD_RESTART_RESULT="


def _checkpoint_snapshot() -> dict[str, Any]:
    from app.services.checkpoint_contract import stable_payload_hash

    rows = [{"门店": "线上一店", "订单数": 12}]
    metadata = {
        "columns": ["门店", "订单数"],
        "materialized_rows": 1,
        "truncated": False,
    }
    planned_sql = 'SELECT "门店", "订单数" FROM saved_orders'
    return {
        "safe_boundary": "after_tool",
        "stage": "investigating",
        "resumable": True,
        "source_fingerprints": {},
        "dataframes": {"saved_orders": rows},
        "result_metadata": {"saved_orders": metadata},
        "tool_history": [
            {
                "kind": "file_sql",
                "sql": planned_sql,
                "result_name": "saved_orders",
                "rows": 1,
            }
        ],
        "replay_journal": [
            {
                "op": "query_project_files",
                "purpose": "保留退出前已读取的订单汇总",
                "planned_sql": planned_sql,
                "result_name": "saved_orders",
                "result_hash": stable_payload_hash(rows),
                "metadata_hash": stable_payload_hash(metadata),
            }
        ],
        "validated_results": [],
        "knowledge_proposals": [],
        "python_output": [],
        "python_images": [],
    }


async def _seed_interrupted_run() -> dict[str, Any]:
    from sqlalchemy import select

    from app.core.config import settings
    from app.db import AsyncSessionLocal, engine
    from app.db.base import Base
    from app.db.tables import AnalysisRun, Conversation, Message, Project
    from app.services.analysis_checkpoint import (
        load_runtime_checkpoint,
        save_runtime_checkpoint,
    )

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as session:
        project = Project(name="冷重启恢复项目")
        conversation = Conversation(title="退出前的调查", status="active")
        session.add_all([project, conversation])
        await session.flush()
        session.add(
            Message(
                conversation_id=conversation.id,
                role="user",
                content="恢复上次调查并整理说明",
            )
        )
        run = AnalysisRun(
            project_id=project.id,
            conversation_id=conversation.id,
            query="恢复上次调查并整理说明",
            state="investigating",
            stage="investigating",
        )
        session.add(run)
        await session.flush()

        checkpoint = await save_runtime_checkpoint(
            settings.WORKSPACE_ROOT / str(project.id),
            run.id,
            1,
            _checkpoint_snapshot(),
        )
        restored = await load_runtime_checkpoint(
            settings.WORKSPACE_ROOT / str(project.id), checkpoint
        )
        assert restored.dataframes == {"saved_orders": [{"门店": "线上一店", "订单数": 12}]}
        run.checkpoint = checkpoint
        await session.commit()

        persisted = (
            await session.execute(select(AnalysisRun).where(AnalysisRun.id == run.id))
        ).scalar_one()
        result = {
            "pid": os.getpid(),
            "project_id": str(project.id),
            "conversation_id": str(conversation.id),
            "run_id": str(run.id),
            "run_state": persisted.state,
            "checkpoint_revision": checkpoint["revision"],
            "checkpoint_manifest": checkpoint["manifest_path"],
            "checkpoint_readable": True,
        }

    await engine.dispose()
    return result


def _parse_sse(response_text: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for line in response_text.splitlines():
        if not line.startswith("data: "):
            continue
        payload = json.loads(line.removeprefix("data: "))
        if isinstance(payload, dict):
            events.append(payload)
    return events


def _resume_after_cold_start(seed: dict[str, Any]) -> dict[str, Any]:
    from fastapi.testclient import TestClient
    from pydantic_ai.models.test import TestModel

    from app.main import app
    from app.services import analyst_runtime

    test_model = TestModel(
        call_tools=["inspect_project_data"],
        custom_output_args={
            "status": "completed",
            "title": "已恢复并完成调查",
            "summary": "已从退出前的安全检查点恢复，并完成剩余整理。",
        },
    )
    analyst_runtime.model_session = lambda _config, **_kwargs: nullcontext(test_model)

    project_id = seed["project_id"]
    conversation_id = seed["conversation_id"]
    run_id = seed["run_id"]
    with TestClient(app) as client:
        before = client.get(f"/api/v1/projects/{project_id}/analysis-runs")
        assert before.status_code == 200, before.text
        before_runs = before.json()["data"]
        assert len(before_runs) == 1
        assert before_runs[0]["id"] == run_id
        assert before_runs[0]["state"] == "needs_attention"
        assert before_runs[0]["checkpoint"]["resumable"] is True
        assert before_runs[0]["checkpoint"]["reason"] == "process_interrupted"

        messages = client.get(f"/api/v1/chat/{conversation_id}/messages")
        assert messages.status_code == 200, messages.text
        recovery_messages = [
            item
            for item in messages.json()["data"]["items"]
            if (item.get("metadata") or {}).get("analysis_run_id") == run_id
            and (item.get("metadata") or {}).get("checkpoint_reason") == "process_interrupted"
        ]
        assert len(recovery_messages) == 1
        assert recovery_messages[0]["metadata"]["resumable"] is True
        assert "安全步骤已保存" in recovery_messages[0]["content"]

        stream = client.post(
            "/api/v1/chat/stream",
            json={
                "conversation_id": conversation_id,
                "project_id": project_id,
                "resume_run_id": run_id,
                "language": "zh",
            },
        )
        assert stream.status_code == 200, stream.text
        events = _parse_sse(stream.text)
        assert not [event for event in events if event.get("type") == "error"], events
        result_event = next(event for event in events if event.get("type") == "result")
        assert result_event["data"]["analysis_run_id"] == run_id
        assert result_event["data"]["project_id"] == project_id
        assert result_event["data"]["analysis_state"] == "completed"
        assert result_event["data"]["report"]["status"] == "completed"

        after = client.get(f"/api/v1/projects/{project_id}/analysis-runs")
        assert after.status_code == 200, after.text
        after_runs = after.json()["data"]
        assert len(after_runs) == 1
        assert after_runs[0]["id"] == run_id
        assert after_runs[0]["conversation_id"] == conversation_id
        assert after_runs[0]["state"] == "completed"
        assert after_runs[0]["checkpoint"]["resumable"] is False
        assert after_runs[0]["checkpoint"]["reason"] == "completed"

        conversation = client.get(f"/api/v1/conversations/{conversation_id}")
        assert conversation.status_code == 200, conversation.text
        assert conversation.json()["data"]["id"] == conversation_id
        assert conversation.json()["data"]["status"] == "completed"

    return {
        "pid": os.getpid(),
        "project_id": project_id,
        "conversation_id": conversation_id,
        "run_id": run_id,
        "startup_state": before_runs[0]["state"],
        "recovery_message_visible": True,
        "result_state": result_event["data"]["analysis_state"],
        "analysis_run_count": len(after_runs),
    }


def _child_main(mode: str) -> None:
    if mode == "seed":
        result = asyncio.run(_seed_interrupted_run())
    elif mode == "resume":
        seed = json.loads(os.environ["RECEIPTBI_COLD_RESTART_SEED"])
        result = _resume_after_cold_start(seed)
    else:  # pragma: no cover - subprocess contract guard
        raise SystemExit(f"unknown child mode: {mode}")
    print(_RESULT_PREFIX + json.dumps(result, ensure_ascii=False, sort_keys=True))


def _child_environment(tmp_path: Path) -> dict[str, str]:
    empty_env = tmp_path / "empty.env"
    empty_env.write_text("", encoding="utf-8")
    blocked = {
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "OPENAI_BASE_URL",
        "DEFAULT_MODEL",
    }
    environment = {key: value for key, value in os.environ.items() if key not in blocked}
    environment.update(
        {
            "DATABASE_URL": f"sqlite+aiosqlite:///{tmp_path / 'receiptbi.db'}",
            "WORKSPACE_ROOT": str(tmp_path / "workspace"),
            "DATA_DIR": str(tmp_path / "data"),
            "RECEIPTBI_ENV_FILE": str(empty_env),
            "RECEIPTBI_INSTANCE_TOKEN": secrets.token_urlsafe(24),
            "ENCRYPTION_KEY": base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(),
            "ENVIRONMENT": "production",
            "PYTHONDONTWRITEBYTECODE": "1",
        }
    )
    return environment


def _run_child(mode: str, environment: dict[str, str]) -> dict[str, Any]:
    completed = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), "--cold-restart-child", mode],
        cwd=Path(__file__).resolve().parents[1],
        env=environment,
        capture_output=True,
        text=True,
        timeout=45,
        check=False,
    )
    if completed.returncode != 0:
        pytest.fail(
            f"cold-restart child {mode!r} failed ({completed.returncode})\n"
            f"stdout:\n{completed.stdout}\nstderr:\n{completed.stderr}"
        )
    marker = next(
        (
            line
            for line in reversed(completed.stdout.splitlines())
            if line.startswith(_RESULT_PREFIX)
        ),
        None,
    )
    if marker is None:
        pytest.fail(
            f"cold-restart child {mode!r} returned no result\n"
            f"stdout:\n{completed.stdout}\nstderr:\n{completed.stderr}"
        )
    return json.loads(marker.removeprefix(_RESULT_PREFIX))


def test_api_cold_restart_recovers_and_resumes_one_durable_run(tmp_path: Path) -> None:
    environment = _child_environment(tmp_path)
    seed = _run_child("seed", environment)
    environment["RECEIPTBI_COLD_RESTART_SEED"] = json.dumps(seed)
    resumed = _run_child("resume", environment)

    assert seed["pid"] != resumed["pid"]
    assert seed["run_state"] == "investigating"
    assert seed["checkpoint_readable"] is True
    assert seed["checkpoint_revision"] == 1
    assert resumed == {
        "pid": resumed["pid"],
        "project_id": seed["project_id"],
        "conversation_id": seed["conversation_id"],
        "run_id": seed["run_id"],
        "startup_state": "needs_attention",
        "recovery_message_visible": True,
        "result_state": "completed",
        "analysis_run_count": 1,
    }


if __name__ == "__main__":  # pragma: no cover - exercised by the parent test
    if len(sys.argv) != 3 or sys.argv[1] != "--cold-restart-child":
        raise SystemExit("expected --cold-restart-child <seed|resume>")
    _child_main(sys.argv[2])
