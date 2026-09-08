"""Standing Brief completion and rolling-baseline acceptance tests."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import AnalysisRun, ArtifactRecord, Project, ProjectDataSource
from app.models import SSEEvent, SSEEventType
from app.models.workspace import (
    AnalysisPlaybookReadStep,
    AnalysisPlaybookResponse,
    AnalysisPlaybookSourceRole,
    AnalysisPlaybookValidationStep,
    AnalysisPlaybookValidationSummary,
)
from app.services.execution import ExecutionService
from app.services.standing_workspace import canonical_hash
from tests.model_fixtures import synthetic_model_config


def _materiality() -> dict:
    return {
        "rules": [
            {
                "id": "rule_revenue_cell",
                "metric": "revenue",
                "scope": "by_key",
                "direction": "any",
                "change_kind": "absolute",
                "threshold": 10,
            }
        ]
    }


def _tool_history() -> list[dict]:
    return [
        {"kind": "file_sql", "result_name": "regional_revenue"},
        {
            "kind": "validation",
            "result_name": "regional_revenue",
            "profile": {
                "columns": ["region", "revenue"],
                "keys": {"region": {"unique": 2}},
                "numeric": {"revenue": {"count": 2}},
                "materialized_rows": 2,
                "truncated": False,
                "source_refs": [
                    {
                        "source_logical_name": "orders",
                        "source_kind": "file",
                    }
                ],
            },
        },
    ]


async def _seed(
    db: AsyncSession,
) -> tuple[Project, ProjectDataSource, AnalysisRun]:
    query = "持续观察区域收入"
    project = Project(name="滚动变化项目")
    db.add(project)
    await db.flush()
    columns = [
        {"name": "region", "type": "VARCHAR"},
        {"name": "revenue", "type": "DOUBLE"},
    ]
    schema_signature = canonical_hash(
        sorted(columns, key=lambda item: (item["name"], item["type"]))
    )
    source = ProjectDataSource(
        project_id=project.id,
        kind="file",
        name="orders.csv",
        format="csv",
        source_uri="/tmp/orders.csv",
        working_uri="/tmp/orders.parquet",
        fingerprint="1" * 64,
        status="ready",
        profile_data={
            "logical_name": "orders",
            "version": 1,
            "is_current": True,
            "schema": {"columns": columns},
        },
    )
    db.add(source)
    await db.flush()
    now = datetime.now(UTC)
    playbook = AnalysisPlaybookResponse(
        id="pb_0123456789abcdefabcd",
        name="区域收入变化",
        query=query,
        source_roles=[
            AnalysisPlaybookSourceRole(
                logical_name="orders",
                source_kind="file",
                columns=[
                    {"name": "region", "data_type": "VARCHAR", "canonical_type": "text"},
                    {"name": "revenue", "data_type": "DOUBLE", "canonical_type": "number"},
                ],
                schema_signature=schema_signature,
            )
        ],
        steps=[
            AnalysisPlaybookReadStep(
                order=1,
                kind="read_data",
                summary="读取订单",
                output_result="result_1",
                source_roles=["orders"],
                required_columns=["region", "revenue"],
            ),
            AnalysisPlaybookValidationStep(
                order=2,
                kind="validate_result",
                summary="校验区域收入",
                input_results=["result_1"],
                key_columns=["region"],
                numeric_columns=["revenue"],
            ),
        ],
        validation=AnalysisPlaybookValidationSummary(
            input_result="result_1",
            columns=["region", "revenue"],
            key_columns=["region"],
            numeric_columns=["revenue"],
        ),
        shape_hash="a" * 64,
        created_at=now,
        updated_at=now,
    )
    project.extra_data = {"analysis_playbooks": [playbook.model_dump(mode="json")]}
    run = AnalysisRun(
        project_id=project.id,
        query=query,
        state="completed",
        stage="completed",
        report={"status": "completed", "title": "七月区域收入"},
        checkpoint={"tool_history": _tool_history()},
    )
    db.add(run)
    await db.flush()
    db.add(
        ArtifactRecord(
            project_id=project.id,
            analysis_run_id=run.id,
            kind="table",
            title="七月区域收入",
            payload={
                "rows": [
                    {"region": "华东", "revenue": 100},
                    {"region": "华南", "revenue": 80},
                ],
                "rows_count": 2,
                "sampled": False,
            },
            technical_details={"result_name": "regional_revenue"},
        )
    )
    await db.commit()
    return project, source, run


async def _create_standing(
    client: AsyncClient,
    project: Project,
    baseline_run: AnalysisRun,
) -> dict:
    response = await client.post(
        f"/api/v1/projects/{project.id}/standing-analyses",
        json={"analysis_run_id": str(baseline_run.id), "materiality": _materiality()},
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def _prepare(
    client: AsyncClient,
    project_id: UUID,
    standing_id: str,
) -> dict:
    response = await client.post(
        f"/api/v1/projects/{project_id}/standing-analyses/{standing_id}/prepare-run",
        json={"trigger": "source_version"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["outcome"] == "prepared"
    return response.json()["data"]


def _result(rows: list[dict], *, valid: bool = True) -> dict:
    history = _tool_history()
    if not valid:
        history = history[:1]
    return {
        "content": "区域收入变化已核对",
        "report": {
            "status": "completed",
            "title": "区域收入变化",
            "summary": "已比较本期与上期。",
        },
        "analysis_state": "completed",
        "result_name": "regional_revenue",
        "data": rows,
        "rows_count": len(rows),
        "tool_history": history,
        "knowledge_proposals": [],
    }


def _waiting_result() -> dict:
    return {
        "content": "需要先确认收入是否扣除退款",
        "report": {
            "status": "waiting_confirmation",
            "title": "需要确认一个业务口径",
            "summary": "这个口径会影响变化结论。",
        },
        "analysis_state": "waiting_confirmation",
        "tool_history": [],
        "knowledge_proposals": [],
    }


@pytest.mark.asyncio
async def test_completed_runs_create_briefs_and_advance_the_rolling_baseline(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project, source, july_run = await _seed(db_session)
    standing = await _create_standing(client, project, july_run)
    july_snapshot_id = standing["baseline"]["snapshot_id"]

    source.fingerprint = "2" * 64
    source.profile_data = {**source.profile_data, "version": 2}
    await db_session.commit()
    august_claim = await _prepare(client, project.id, standing["id"])
    august_run = await db_session.get(AnalysisRun, UUID(august_claim["run_id"]))
    assert august_run is not None
    await ExecutionService(db_session, project_id=project.id)._persist_project_result(
        august_run,
        _result(
            [
                {"region": "华东", "revenue": 120},
                {"region": "华南", "revenue": 60},
            ]
        ),
    )

    after_august = (await client.get(f"/api/v1/projects/{project.id}/standing-analyses")).json()[
        "data"
    ][0]
    assert after_august["state"] == "active"
    assert after_august["in_flight"] is None
    assert after_august["baseline"]["analysis_run_id"] == str(august_run.id)
    assert after_august["baseline"]["snapshot_id"] != july_snapshot_id
    august_brief = await db_session.get(
        ArtifactRecord,
        UUID(after_august["last_brief_artifact_id"]),
    )
    assert august_brief is not None
    assert august_brief.payload["status"] == "material_change"
    assert august_brief.technical_details["notify_user"] is True
    assert [item["change"]["delta"] for item in august_brief.payload["top_drivers"]] == [
        20.0,
        -20.0,
    ]

    source.fingerprint = "3" * 64
    source.profile_data = {**source.profile_data, "version": 3}
    await db_session.commit()
    september_claim = await _prepare(client, project.id, standing["id"])
    september_run = await db_session.get(AnalysisRun, UUID(september_claim["run_id"]))
    assert september_run is not None
    await ExecutionService(db_session, project_id=project.id)._persist_project_result(
        september_run,
        _result(
            [
                {"region": "华东", "revenue": 121},
                {"region": "华南", "revenue": 59},
            ]
        ),
    )
    after_september = (await client.get(f"/api/v1/projects/{project.id}/standing-analyses")).json()[
        "data"
    ][0]
    assert after_september["baseline"]["analysis_run_id"] == str(september_run.id)
    september_brief = await db_session.get(
        ArtifactRecord,
        UUID(after_september["last_brief_artifact_id"]),
    )
    assert september_brief is not None
    assert september_brief.payload["status"] == "no_material_change"
    assert september_brief.technical_details["notify_user"] is False

    quiet = await client.post(
        f"/api/v1/projects/{project.id}/standing-analyses/{standing['id']}/prepare-run",
        json={"trigger": "app_start_overdue"},
    )
    assert quiet.json()["data"]["outcome"] == "no_change"
    assert await db_session.scalar(select(func.count()).select_from(AnalysisRun)) == 3


@pytest.mark.asyncio
async def test_invalid_completion_keeps_the_prior_baseline_and_marks_attention(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project, source, july_run = await _seed(db_session)
    standing = await _create_standing(client, project, july_run)
    baseline = standing["baseline"]
    source.fingerprint = "2" * 64
    source.profile_data = {**source.profile_data, "version": 2}
    await db_session.commit()
    claim = await _prepare(client, project.id, standing["id"])
    run = await db_session.get(AnalysisRun, UUID(claim["run_id"]))
    assert run is not None

    await ExecutionService(db_session, project_id=project.id)._persist_project_result(
        run,
        _result(
            [
                {"region": "华东", "revenue": 120},
                {"region": "华南", "revenue": 60},
            ],
            valid=False,
        ),
    )

    failed = (await client.get(f"/api/v1/projects/{project.id}/standing-analyses")).json()["data"][
        0
    ]
    assert failed["state"] == "needs_attention"
    assert failed["baseline"] == baseline
    assert failed["in_flight"] is None
    assert "没有通过校验" in failed["attention_reason"]
    assert failed["attention_reason_code"] == "standing_result_rejected"
    assert failed["attention_reason_params"] == {}
    standing_artifacts = list(
        (
            await db_session.execute(
                select(ArtifactRecord).where(
                    ArtifactRecord.analysis_run_id == run.id,
                    ArtifactRecord.kind.in_({"result_snapshot", "change_brief"}),
                )
            )
        ).scalars()
    )
    assert standing_artifacts == []


@pytest.mark.asyncio
async def test_rejected_standing_result_never_emits_a_completed_terminal_event(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    project, source, july_run = await _seed(db_session)
    standing = await _create_standing(client, project, july_run)
    source.fingerprint = "2" * 64
    source.profile_data = {**source.profile_data, "version": 2}
    await db_session.commit()
    claim = await _prepare(client, project.id, standing["id"])
    run = await db_session.get(AnalysisRun, UUID(claim["run_id"]))
    assert run is not None and run.conversation_id is not None
    service = ExecutionService(db_session, project_id=project.id)

    class Inputs:
        model_config = synthetic_model_config(model="test")
        history: list[dict] = []

    class FakeEngine:
        async def execute(self, *, query, history, stop_checker):
            yield SSEEvent.progress("completed", "调查完成，正在保存")
            payload = _result(
                [
                    {"region": "华东", "revenue": 120},
                    {"region": "华南", "revenue": 60},
                ],
                valid=False,
            )
            yield SSEEvent.result(payload.pop("content"), **payload)

    async def fake_load_inputs(**kwargs):
        return Inputs()

    async def fake_build_engine(inputs, *, run: AnalysisRun, resume_checkpoint):
        return FakeEngine()

    monkeypatch.setattr(service, "_load_execution_inputs", fake_load_inputs)
    monkeypatch.setattr(service, "_build_engine", fake_build_engine)
    events = [
        event
        async for event in service.execute_stream(
            query=run.query,
            conversation_id=run.conversation_id,
            resume_run_id=run.id,
        )
    ]

    assert [event.type for event in events] == [SSEEventType.ERROR]
    assert events[0].data["code"] == "STANDING_RESULT_REJECTED"
    await db_session.refresh(run)
    assert run.state == "needs_attention"


@pytest.mark.asyncio
async def test_completion_rejects_a_same_shape_result_from_the_wrong_source_role(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project, source, july_run = await _seed(db_session)
    standing = await _create_standing(client, project, july_run)
    source.fingerprint = "2" * 64
    source.profile_data = {**source.profile_data, "version": 2}
    await db_session.commit()
    claim = await _prepare(client, project.id, standing["id"])
    run = await db_session.get(AnalysisRun, UUID(claim["run_id"]))
    assert run is not None
    result = _result(
        [
            {"region": "华东", "revenue": 120},
            {"region": "华南", "revenue": 60},
        ]
    )
    result["tool_history"][-1]["profile"]["source_refs"][0]["source_logical_name"] = (
        "unrelated_orders"
    )

    outcome = await ExecutionService(db_session, project_id=project.id)._persist_project_result(
        run, result
    )

    assert outcome.accepted is False
    assert outcome.error_code == "STANDING_RESULT_REJECTED"
    current = (await client.get(f"/api/v1/projects/{project.id}/standing-analyses")).json()["data"][
        0
    ]
    assert current["baseline"] == standing["baseline"]


@pytest.mark.asyncio
async def test_completed_force_request_is_idempotent_after_the_claim_is_cleared(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project, source, july_run = await _seed(db_session)
    standing = await _create_standing(client, project, july_run)
    source.fingerprint = "2" * 64
    source.profile_data = {**source.profile_data, "version": 2}
    await db_session.commit()
    url = f"/api/v1/projects/{project.id}/standing-analyses/{standing['id']}/prepare-run"
    request_id = uuid4()
    prepared = await client.post(
        url,
        json={"trigger": "manual", "force": True, "request_id": str(request_id)},
    )
    run = await db_session.get(AnalysisRun, UUID(prepared.json()["data"]["run_id"]))
    assert run is not None
    await ExecutionService(db_session, project_id=project.id)._persist_project_result(
        run,
        _result(
            [
                {"region": "华东", "revenue": 120},
                {"region": "华南", "revenue": 60},
            ]
        ),
    )

    replayed = await client.post(
        url,
        json={"trigger": "manual", "force": True, "request_id": str(request_id)},
    )

    assert replayed.status_code == 200, replayed.text
    assert replayed.json()["data"]["outcome"] == "already_completed"
    assert replayed.json()["data"]["run_id"] == str(run.id)
    assert replayed.json()["data"]["brief_artifact_id"] is not None
    assert await db_session.scalar(select(func.count()).select_from(AnalysisRun)) == 2


@pytest.mark.asyncio
async def test_waiting_run_keeps_its_claim_even_after_the_lease_time_passes(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project, source, july_run = await _seed(db_session)
    standing = await _create_standing(client, project, july_run)
    baseline = standing["baseline"]
    source.fingerprint = "2" * 64
    source.profile_data = {**source.profile_data, "version": 2}
    await db_session.commit()
    claim = await _prepare(client, project.id, standing["id"])
    run = await db_session.get(AnalysisRun, UUID(claim["run_id"]))
    assert run is not None

    await ExecutionService(db_session, project_id=project.id)._persist_project_result(
        run,
        _waiting_result(),
    )
    await db_session.refresh(run)
    assert run.state == "waiting_confirmation"

    await db_session.refresh(project)
    extra_data = dict(project.extra_data or {})
    definitions = list(extra_data["standing_analyses"])
    definition = dict(definitions[0])
    in_flight = dict(definition["in_flight"])
    in_flight["claimed_at"] = (datetime.now(UTC) - timedelta(hours=2)).isoformat()
    in_flight["expires_at"] = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    definition["in_flight"] = in_flight
    definitions[0] = definition
    project.extra_data = {**extra_data, "standing_analyses": definitions}
    source.fingerprint = "3" * 64
    source.profile_data = {**source.profile_data, "version": 3}
    await db_session.commit()

    retried = await client.post(
        f"/api/v1/projects/{project.id}/standing-analyses/{standing['id']}/prepare-run",
        json={"trigger": "source_version"},
    )
    assert retried.status_code == 200, retried.text
    data = retried.json()["data"]
    assert data["outcome"] == "already_running"
    assert data["run_id"] == str(run.id)
    assert data["standing_analysis"]["baseline"] == baseline
    assert data["standing_analysis"]["in_flight"]["analysis_run_id"] == str(run.id)
    assert await db_session.scalar(select(func.count()).select_from(AnalysisRun)) == 2


@pytest.mark.asyncio
async def test_superseded_run_cannot_advance_baseline_or_clear_the_new_claim(
    client: AsyncClient,
    db_session: AsyncSession,
):
    project, source, july_run = await _seed(db_session)
    standing = await _create_standing(client, project, july_run)
    july_baseline = standing["baseline"]

    source.fingerprint = "2" * 64
    source.profile_data = {**source.profile_data, "version": 2}
    await db_session.commit()
    first_claim = await _prepare(client, project.id, standing["id"])
    first_run = await db_session.get(AnalysisRun, UUID(first_claim["run_id"]))
    assert first_run is not None

    await db_session.refresh(project)
    extra_data = dict(project.extra_data or {})
    definitions = list(extra_data["standing_analyses"])
    definition = dict(definitions[0])
    in_flight = dict(definition["in_flight"])
    in_flight["claimed_at"] = (datetime.now(UTC) - timedelta(hours=2)).isoformat()
    in_flight["expires_at"] = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    definition["in_flight"] = in_flight
    definitions[0] = definition
    project.extra_data = {**extra_data, "standing_analyses": definitions}
    source.fingerprint = "3" * 64
    source.profile_data = {**source.profile_data, "version": 3}
    await db_session.commit()

    second_claim = await _prepare(client, project.id, standing["id"])
    second_run = await db_session.get(AnalysisRun, UUID(second_claim["run_id"]))
    assert second_run is not None and second_run.id != first_run.id

    await ExecutionService(db_session, project_id=project.id)._persist_project_result(
        first_run,
        _result(
            [
                {"region": "华东", "revenue": 130},
                {"region": "华南", "revenue": 50},
            ]
        ),
    )
    after_stale = (await client.get(f"/api/v1/projects/{project.id}/standing-analyses")).json()[
        "data"
    ][0]
    assert after_stale["baseline"] == july_baseline
    assert after_stale["in_flight"]["analysis_run_id"] == str(second_run.id)

    await ExecutionService(db_session, project_id=project.id)._persist_project_result(
        second_run,
        _result(
            [
                {"region": "华东", "revenue": 125},
                {"region": "华南", "revenue": 55},
            ]
        ),
    )
    completed = (await client.get(f"/api/v1/projects/{project.id}/standing-analyses")).json()[
        "data"
    ][0]
    assert completed["baseline"]["analysis_run_id"] == str(second_run.id)
    assert completed["in_flight"] is None
