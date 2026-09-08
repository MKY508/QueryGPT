"""Bounded retained-result and chat-preview contracts for analyst runs."""

from __future__ import annotations

import copy
from types import SimpleNamespace

import pandas as pd
import pytest
from pydantic_ai import ModelRetry

from app.models import SSEEvent, SSEEventType
from app.models.analysis import AnalysisReport
from app.services.analyst import result_store
from app.services.analyst.recovery import restore_session_checkpoint
from app.services.analyst.result_store import _ensure_result_budget
from app.services.analyst_runtime import PydanticAnalystRuntime
from app.services.chat_runtime import ChatEventAccumulator
from app.services.checkpoint_contract import (
    CheckpointDriftError,
    RestoredCheckpoint,
    stable_payload_hash,
)
from app.services.project_context import ProjectRuntimeContext
from tests.model_fixtures import synthetic_model_config


def _deps(dataframes: dict[str, object] | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        dataframes=dataframes or {},
        result_metadata={},
        tool_history=[],
    )


def test_result_budget_rejects_thirteenth_result_without_polluting_run_state():
    deps = _deps({f"result_{index}": [{"value": index}] for index in range(12)})
    deps.result_metadata["result_0"] = {"truncated": False}
    deps.tool_history.append({"kind": "sql", "result_name": "result_0"})
    before = copy.deepcopy(vars(deps))

    with pytest.raises(ModelRetry, match="筛选、分组或汇总"):
        _ensure_result_budget(deps, {"result_12": [{"value": 12}]})

    assert vars(deps) == before
    assert "result_12" not in deps.dataframes


def test_result_budget_counts_rows_across_all_retained_results(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(result_store, "RUN_RESULT_MAX_ROWS", 3)
    deps = _deps({"first": [{"value": 1}, {"value": 2}]})

    with pytest.raises(ModelRetry, match="4 行"):
        _ensure_result_budget(
            deps,
            {"second": [{"value": 3}, {"value": 4}]},
        )

    assert deps.dataframes == {"first": [{"value": 1}, {"value": 2}]}


def test_result_budget_estimates_dataframe_bytes(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(result_store, "RUN_RESULT_MAX_BYTES", 256)
    deps = _deps()
    frame = pd.DataFrame({"payload": ["x" * 512]})

    with pytest.raises(ModelRetry, match="MiB"):
        _ensure_result_budget(deps, {"large_frame": frame})

    assert deps.dataframes == {}


@pytest.mark.asyncio
async def test_over_budget_checkpoint_is_rejected_before_restoring_dependencies():
    rows_by_name = {f"restored_{index}": [{"value": index}] for index in range(13)}
    journal = [
        {
            "op": "query_database",
            "planned_sql": f"SELECT {index}",
            "result_name": name,
            "result_hash": stable_payload_hash(rows),
        }
        for index, (name, rows) in enumerate(rows_by_name.items())
    ]
    runtime = PydanticAnalystRuntime(
        model_config=synthetic_model_config(),
        project_context=ProjectRuntimeContext(name="旧检查点预算项目"),
        resume_state=RestoredCheckpoint(manifest={'replay_journal': journal}, dataframes=rows_by_name),
    )
    assert runtime.deps.dataframes == {}

    with pytest.raises(CheckpointDriftError, match="超过当前运行预算"):
        restore_session_checkpoint(runtime.deps, runtime.resume_state)

    assert runtime.deps.dataframes == {}


@pytest.mark.asyncio
async def test_analyst_result_sse_contains_only_a_bounded_preview():
    runtime = PydanticAnalystRuntime(
        model_config=synthetic_model_config(),
        project_context=ProjectRuntimeContext(name="预览预算项目"),
    )
    rows = [{"index": index} for index in range(150)]

    class PreviewAgent:
        async def run(self, prompt, deps, model):
            del prompt
            deps.dataframes["fallback_result"] = rows
            deps.result_metadata["fallback_result"] = {"truncated": False}
            return SimpleNamespace(
                output=AnalysisReport(
                    status="completed",
                    title="预览结果",
                    summary="完整结果用于调查，消息只携带预览。",
                )
            )

    runtime.agent = PreviewAgent()

    events = [event async for event in runtime.execute(query="查看完整结果")]
    result = next(event for event in events if event.type == SSEEventType.RESULT)

    assert len(result.data["data"]) == 100
    assert result.data["data"] == rows[:100]
    assert result.data["rows_count"] == 150
    assert result.data["result_name"] == "fallback_result"
    assert result.data["truncated"] is False
    assert result.data["preview_truncated"] is True
    assert "前 100 行预览" in result.data["data_note"]


def test_chat_metadata_defensively_bounds_full_result_events():
    rows = [{"index": index} for index in range(250)]
    accumulator = ChatEventAccumulator(
        original_query="查看数据",
        runtime_snapshot={"model_id": "model-a"},
    )

    accumulator.consume(
        SSEEvent.result(
            "完成",
            data=rows,
            rows_count=250,
            truncated=False,
        )
    )
    metadata = accumulator.build_metadata()

    assert metadata["data"] == rows[:100]
    assert metadata["rows_count"] == 250
    assert metadata["truncated"] is False
    assert metadata["preview_truncated"] is True
    assert "前 100 行预览" in metadata["data_note"]
