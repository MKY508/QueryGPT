"""Deterministic execution contracts for the v3 system playbook lane."""

from __future__ import annotations

from contextlib import nullcontext
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pandas as pd
import pytest
from pydantic import ValidationError
from pydantic_ai import ModelRetry
from pydantic_ai.models.test import TestModel

from app.models.analysis import AnalysisReport
from app.models.workspace import AnalysisPlaybookResponse
from app.services import analysis_playbook_runner, analyst_runtime, structured_query
from app.services.analysis_checkpoint import stable_payload_hash
from app.services.analysis_playbook_runner import (
    AnalysisPlaybookExecutionReceipt,
    AnalysisPlaybookRunnerError,
    run_analysis_playbook,
)
from app.services.analyst.result_store import _ensure_result_write_allowed
from app.services.analyst_runtime import AnalystStoppedError, PydanticAnalystRuntime
from app.services.project_context import ProjectRuntimeContext
from app.services.standing_workspace import (
    StandingWorkspaceError,
    validate_playbook_execution_evidence,
)
from app.services.structured_query import profile_schema_signature
from tests.model_fixtures import synthetic_model_config


def _file_source(path: Path) -> dict:
    return {
        "id": "orders-source",
        "name": "Current orders",
        "kind": "file",
        "format": "parquet",
        "status": "ready",
        "view_name": "online_orders",
        "working_uri": str(path),
        "profile": {
            "logical_name": "orders",
            "is_current": True,
            "schema": {
                "columns": [
                    {"name": "category", "dtype": "object"},
                    {"name": "amount", "dtype": "float64"},
                    {"name": "status", "dtype": "object"},
                ]
            },
        },
    }


def _connection_source() -> dict:
    return {
        "id": "warehouse-source",
        "name": "Warehouse",
        "kind": "connection",
        "format": "postgresql",
        "status": "ready",
        "connection_name": "warehouse-source",
        "profile": {
            "logical_name": "orders",
            "is_current": True,
            "tables": [
                {
                    "name": "online_orders",
                    "columns": [
                        {"name": "category", "type": "TEXT"},
                        {"name": "amount", "type": "DOUBLE"},
                        {"name": "status", "type": "TEXT"},
                    ],
                }
            ],
        },
    }


def _playbook(
    source: dict,
    *,
    limit: int = 100,
    expected_columns: list[str] | None = None,
) -> AnalysisPlaybookResponse:
    now = datetime.now(UTC)
    profile = source["profile"]
    table_columns = (
        profile["schema"]["columns"]
        if source["kind"] == "file"
        else profile["tables"][0]["columns"]
    )
    role_columns = [
        {
            "table": None if source["kind"] == "file" else "online_orders",
            "name": item["name"],
            "data_type": item.get("type") or item.get("dtype") or "unknown",
            "canonical_type": "number" if item["name"] == "amount" else "text",
        }
        for item in table_columns
    ]
    payload = {
        "schema_version": 3,
        "execution_mode": "system_structured_query",
        "id": "pb_" + "a" * 20,
        "name": "Revenue by category",
        "query": "Compare paid revenue by category",
        "source_roles": [
            {
                "logical_name": "orders",
                "source_kind": source["kind"],
                "tables": ["online_orders"],
                "columns": role_columns,
                "schema_signature": profile_schema_signature(profile),
            }
        ],
        "confirmed_knowledge_keys": [],
        "relationship_keys": [],
        "steps": [
            {
                "order": 1,
                "kind": "structured_query",
                "summary": "Read current paid revenue by category",
                "input_results": [],
                "output_result": "result_1",
                "source_role": "orders",
                "plan": {
                    "table": "online_orders",
                    "dimensions": ["category"],
                    "metrics": [{"operation": "sum", "column": "amount", "alias": "revenue"}],
                    "filters": [{"column": "status", "operator": "eq", "value": "paid"}],
                    "sort": [{"field": "revenue", "direction": "desc"}],
                    "limit": limit,
                },
            },
            {
                "order": 2,
                "kind": "validate_result",
                "summary": "Validate current category revenue",
                "input_results": ["result_1"],
                "output_result": None,
                "key_columns": ["category"],
                "numeric_columns": ["revenue"],
                "must_not_be_truncated": True,
            },
        ],
        "validation": {
            "input_result": "result_1",
            "columns": expected_columns or ["category", "revenue"],
            "key_columns": ["category"],
            "numeric_columns": ["revenue"],
            "must_not_be_truncated": True,
        },
        "shape_hash": "0" * 64,
        "created_at": now,
        "updated_at": now,
    }
    playbook = AnalysisPlaybookResponse.model_validate(payload)
    return playbook.model_copy(
        update={"shape_hash": analysis_playbook_runner._shape_hash(playbook)}
    )


@pytest.mark.asyncio
async def test_file_playbook_recompiles_executes_validates_and_returns_strict_receipt(
    tmp_path: Path,
):
    path = tmp_path / "orders.parquet"
    pd.DataFrame(
        [
            {"category": "latte", "amount": 32.0, "status": "paid"},
            {"category": "latte", "amount": 30.0, "status": "paid"},
            {"category": "americano", "amount": 28.0, "status": "refunded"},
        ]
    ).to_parquet(path, index=False)
    source = _file_source(path)

    result = await run_analysis_playbook(
        _playbook(source),
        sources=[source],
        project_dir=tmp_path / "project",
    )

    assert result.rows == [{"category": "latte", "revenue": 62.0}]
    assert result.dataframes == {"result_1": result.rows}
    assert result.result_metadata == {"result_1": result.metadata}
    assert result.validated_results == {"result_1"}
    assert [item["kind"] for item in result.tool_history] == [
        "structured_query",
        "validation",
        "analysis_playbook_execution",
    ]
    assert [item["op"] for item in result.replay_journal] == [
        "query_source_data",
        "validate_result",
    ]
    assert result.receipt.source_id == "orders-source"
    assert result.receipt.source_schema_signature == profile_schema_signature(source["profile"])
    assert result.receipt.row_count == 1
    assert result.receipt.truncated is False
    assert result.receipt.execution_backend == "duckdb"
    receipt_payload = result.receipt.model_dump(mode="json")
    assert "compiled_sql" not in receipt_payload
    assert "sql" not in receipt_payload
    assert result.tool_history[0]["compiled_sql"].startswith("SELECT")

    with pytest.raises(ValidationError):
        AnalysisPlaybookExecutionReceipt.model_validate(
            {**receipt_payload, "compiled_sql": "SELECT 1"}
        )


@pytest.mark.asyncio
async def test_runtime_executes_required_v3_result_before_model(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    path = tmp_path / "orders.parquet"
    pd.DataFrame(
        [
            {"category": "latte", "amount": 32.0, "status": "paid"},
            {"category": "latte", "amount": 30.0, "status": "paid"},
        ]
    ).to_parquet(path, index=False)
    source = _file_source(path)
    playbook = _playbook(source)
    context = ProjectRuntimeContext(
        name="Revenue",
        sources=[source],
        required_analysis=playbook.model_dump(mode="json"),
    )
    monkeypatch.setattr(
        analyst_runtime,
        "model_session",
        lambda _config, **_kwargs: nullcontext(TestModel()),
    )
    runtime = PydanticAnalystRuntime(model_config=synthetic_model_config(), project_context=context)
    observed: dict[str, object] = {}

    async def fake_run_agent(prompt: str, _stop_checker):
        observed["prompt"] = prompt
        observed["rows"] = runtime.deps.dataframes.get("result_1")
        observed["validated"] = set(runtime.deps.validated_results)
        return AnalysisReport(
            status="completed",
            title="Category revenue",
            summary="Latte revenue is 62",
            primary_result="result_1",
        )

    runtime._run_agent = fake_run_agent  # type: ignore[method-assign]
    try:
        events = [
            event async for event in runtime.execute(query="Compare paid revenue by category")
        ]
    finally:
        runtime.deps.python_sandbox.cleanup()

    assert observed["rows"] == [{"category": "latte", "revenue": 62.0}]
    assert observed["validated"] == {"result_1"}
    assert "<system_verified_result>" in str(observed["prompt"])
    assert '"result_name": "result_1"' in str(observed["prompt"])
    assert [item["kind"] for item in runtime.deps.tool_history[:3]] == [
        "structured_query",
        "validation",
        "analysis_playbook_execution",
    ]
    assert events


@pytest.mark.asyncio
async def test_runtime_can_cancel_system_playbook_before_model(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    path = tmp_path / "orders.parquet"
    pd.DataFrame([{"category": "latte", "amount": 62.0, "status": "paid"}]).to_parquet(
        path, index=False
    )
    source = _file_source(path)
    context = ProjectRuntimeContext(
        sources=[source],
        required_analysis=_playbook(source).model_dump(mode="json"),
    )
    monkeypatch.setattr(
        analyst_runtime,
        "model_session",
        lambda _config, **_kwargs: nullcontext(TestModel()),
    )
    runtime = PydanticAnalystRuntime(model_config=synthetic_model_config(), project_context=context)
    try:
        with pytest.raises(AnalystStoppedError, match="已停止"):
            async for _event in runtime.execute(
                query="Compare paid revenue by category",
                stop_checker=lambda: True,
            ):
                pass
    finally:
        runtime.deps.python_sandbox.cleanup()

    assert runtime.deps.tool_history == []


@pytest.mark.asyncio
async def test_runtime_rejects_poisoned_resumed_system_result(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    path = tmp_path / "orders.parquet"
    pd.DataFrame([{"category": "latte", "amount": 62.0, "status": "paid"}]).to_parquet(
        path, index=False
    )
    source = _file_source(path)
    context = ProjectRuntimeContext(
        sources=[source],
        required_analysis=_playbook(source).model_dump(mode="json"),
    )
    monkeypatch.setattr(
        analyst_runtime,
        "model_session",
        lambda _config, **_kwargs: nullcontext(TestModel()),
    )
    original = PydanticAnalystRuntime(model_config=synthetic_model_config(), project_context=context)
    poisoned = PydanticAnalystRuntime(model_config=synthetic_model_config(), project_context=context)
    try:
        await original._prepare_required_system_analysis()
        fake_rows = [{"category": "poison", "revenue": 999.0}]
        poisoned.deps.dataframes = {"result_1": fake_rows}
        poisoned.deps.result_metadata = deepcopy(original.deps.result_metadata)
        poisoned.deps.validated_results = {"result_1"}
        poisoned.deps.tool_history = deepcopy(original.deps.tool_history)
        fake_profile = deepcopy(poisoned.deps.tool_history[1]["profile"])
        poisoned.deps.tool_history.append(
            {
                "kind": "validation",
                "purpose": "replace the system validation",
                "result_name": "result_1",
                "result_hash": stable_payload_hash(fake_rows),
                "profile": fake_profile,
            }
        )

        with pytest.raises(AnalysisPlaybookRunnerError, match="does not match"):
            await poisoned._prepare_required_system_analysis()
    finally:
        original.deps.python_sandbox.cleanup()
        poisoned.deps.python_sandbox.cleanup()


def test_protected_system_result_blocks_model_owned_result_producers():
    deps = SimpleNamespace(protected_results={"result_1": {"result_hash": "a" * 64}})
    with pytest.raises(ModelRetry, match="不要重新查询"):
        _ensure_result_write_allowed(deps)  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_standing_accepts_only_exact_system_execution_receipt(tmp_path: Path):
    path = tmp_path / "orders.parquet"
    pd.DataFrame([{"category": "latte", "amount": 62.0, "status": "paid"}]).to_parquet(
        path, index=False
    )
    source = _file_source(path)
    playbook = _playbook(source)
    result = await run_analysis_playbook(
        playbook,
        sources=[source],
        project_dir=tmp_path / "project",
    )

    validate_playbook_execution_evidence(
        playbook,
        result.tool_history,
        result.validation,
    )

    with pytest.raises(StandingWorkspaceError, match="执行回执"):
        validate_playbook_execution_evidence(
            playbook,
            result.tool_history[:-1],
            result.validation,
        )

    tampered_history = [dict(item) for item in result.tool_history]
    tampered_history[-1]["result_hash"] = "f" * 64
    with pytest.raises(StandingWorkspaceError, match="数据指纹"):
        validate_playbook_execution_evidence(
            playbook,
            tampered_history,
            result.validation,
        )


@pytest.mark.asyncio
async def test_database_playbook_uses_database_manager_read_only(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    source = _connection_source()
    calls: list[dict] = []

    class FakeManager:
        def execute_query(self, sql: str, **kwargs):
            calls.append({"sql": sql, **kwargs})
            return SimpleNamespace(
                data=[{"category": "latte", "revenue": 62.0}],
                truncated=False,
                execution_backend="postgresql",
                execution_metadata={"server_side": True},
            )

    monkeypatch.setattr(structured_query, "create_database_manager", lambda _config: FakeManager())

    result = await run_analysis_playbook(
        _playbook(source),
        sources=[source],
        project_dir=tmp_path,
        connection_configs={"warehouse-source": {"driver": "postgresql"}},
    )

    assert calls and calls[0]["read_only"] is True
    assert calls[0]["max_rows"] == 100
    assert calls[0]["timeout_seconds"] == 85
    assert result.receipt.execution_backend == "postgresql"
    assert result.metadata["execution_metadata"] == {"server_side": True}


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["schema_drift", "ambiguous", "pending"])
async def test_source_binding_fails_closed(
    tmp_path: Path,
    failure: str,
):
    path = tmp_path / "orders.parquet"
    pd.DataFrame([{"category": "latte", "amount": 32.0, "status": "paid"}]).to_parquet(
        path,
        index=False,
    )
    source = _file_source(path)
    playbook = _playbook(source)
    sources = [source]
    if failure == "schema_drift":
        source["profile"]["schema"]["columns"].append({"name": "new_column", "dtype": "object"})
        match = "drifted"
    elif failure == "ambiguous":
        sources.append({**source, "id": "orders-source-2"})
        match = "ambiguous"
    else:
        sources.append(
            {
                **source,
                "id": "orders-source-next",
                "profile": {
                    **source["profile"],
                    "is_current": False,
                    "replacement_of": source["id"],
                },
            }
        )
        match = "pending replacement"

    with pytest.raises(AnalysisPlaybookRunnerError, match=match):
        await run_analysis_playbook(
            playbook,
            sources=sources,
            project_dir=tmp_path / "project",
        )


@pytest.mark.asyncio
async def test_runner_rejects_truncation_shape_drift_and_agent_mode(tmp_path: Path):
    path = tmp_path / "orders.parquet"
    pd.DataFrame(
        [
            {"category": "latte", "amount": 32.0, "status": "paid"},
            {"category": "mocha", "amount": 30.0, "status": "paid"},
        ]
    ).to_parquet(path, index=False)
    source = _file_source(path)

    with pytest.raises(AnalysisPlaybookRunnerError, match="truncated"):
        await run_analysis_playbook(
            _playbook(source, limit=1),
            sources=[source],
            project_dir=tmp_path / "truncated",
        )

    with pytest.raises(AnalysisPlaybookRunnerError, match="validation shape"):
        await run_analysis_playbook(
            _playbook(source, expected_columns=["category", "revenue", "unexpected"]),
            sources=[source],
            project_dir=tmp_path / "shape-drift",
        )

    agent_playbook = _playbook(source).model_copy(
        update={"execution_mode": "agent_replan_required"}
    )
    with pytest.raises(AnalysisPlaybookRunnerError, match="agent replanning"):
        await run_analysis_playbook(
            agent_playbook,
            sources=[source],
            project_dir=tmp_path / "agent",
        )


@pytest.mark.asyncio
async def test_runner_rejects_tampered_playbook_shape_hash(tmp_path: Path):
    source = _file_source(tmp_path / "orders.parquet")
    playbook = _playbook(source).model_copy(update={"shape_hash": "f" * 64})

    with pytest.raises(AnalysisPlaybookRunnerError, match="shape hash"):
        await run_analysis_playbook(
            playbook,
            sources=[source],
            project_dir=tmp_path,
        )
