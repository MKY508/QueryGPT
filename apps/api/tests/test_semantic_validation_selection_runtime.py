"""Revision-bound contracts for batch relationship validation runs."""

from uuid import uuid4

import pytest
from httpx import AsyncClient
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import chat as chat_api
from app.db.tables import AnalysisRun, Project, SemanticEntry
from app.models.chat import ChatStreamRequest, SSEEvent
from app.services import project_context as project_context_service
from app.services.checkpoint_contract import stable_payload_hash
from app.services.execution import (
    ExecutionService,
    SemanticValidationSelectionError,
)
from app.services.project_context import load_project_context
from app.services.semantic_revisions import append_semantic_revision


async def _relationship_candidates(
    db: AsyncSession,
    project: Project,
    count: int,
    *,
    key_prefix: str = "relationship",
) -> list[SemanticEntry]:
    entries = [
        SemanticEntry(
            project_id=project.id,
            key=f"{key_prefix}:orders_{index}:stores_{index}",
            value=f"候选关系 {index}",
            entry_type="relationship",
            state="candidate",
            confidence=0.7,
            definition={
                "version": 1,
                "left": {"table_or_view": f"orders_{index}", "column": "store_id"},
                "right": {"table_or_view": f"stores_{index}", "column": "store_id"},
                "normalization": "exact",
            },
            validity="unverified",
            execution_state="needs_validation",
            execution_details={"status": "needs_validation"},
            source="user",
            is_active=True,
        )
        for index in range(count)
    ]
    db.add_all(entries)
    await db.flush()
    for entry in entries:
        await append_semantic_revision(
            db,
            entry,
            mutation_kind="validation_queued",
            actor_source="user",
        )
    await db.commit()
    return entries


def _selection(entries: list[SemanticEntry]) -> list[dict[str, str]]:
    return [
        {
            "entry_id": str(entry.id),
            "expected_active_revision_id": str(entry.active_revision_id),
        }
        for entry in entries
    ]


def test_chat_stream_request_keeps_large_structured_selection_and_caps_at_100() -> None:
    selection = [
        {
            "entry_id": str(uuid4()),
            "expected_active_revision_id": str(uuid4()),
        }
        for _ in range(25)
    ]

    request = ChatStreamRequest.model_validate(
        {"query": "逐条验证所选关联", "semantic_validation_selection": selection}
    )

    assert len(request.semantic_validation_selection) == 25
    assert request.model_dump(mode="json")["semantic_validation_selection"] == selection
    with pytest.raises(ValidationError):
        ChatStreamRequest.model_validate(
            {
                "query": "选择过多",
                "semantic_validation_selection": [
                    {
                        "entry_id": str(uuid4()),
                        "expected_active_revision_id": str(uuid4()),
                    }
                    for _ in range(101)
                ],
            }
        )


@pytest.mark.asyncio
async def test_chat_post_routes_structured_selection_without_rewriting_query(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    selection = [
        {
            "entry_id": str(uuid4()),
            "expected_active_revision_id": str(uuid4()),
        }
        for _ in range(25)
    ]
    captured: dict = {}

    class CapturingExecutionService:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        async def get_runtime_snapshot(self):
            return {"provider_summary": "test"}

        async def execute_stream(self, **kwargs):
            captured["query"] = kwargs["query"]
            yield SSEEvent.error("TEST_COMPLETE", "captured")

    monkeypatch.setattr(chat_api, "ExecutionService", CapturingExecutionService)

    response = await client.post(
        "/api/v1/chat/stream",
        json={
            "query": "逐条验证所选关联",
            "semantic_validation_selection": selection,
        },
    )

    assert response.status_code == 200
    assert captured["query"] == "逐条验证所选关联"
    assert captured["semantic_validation_selection"] == selection


@pytest.mark.asyncio
async def test_execution_contract_preserves_more_than_twenty_selected_heads(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project = Project(name="批量关系验证")
    db_session.add(project)
    await db_session.commit()
    selected = await _relationship_candidates(db_session, project, 25)
    outsider = (
        await _relationship_candidates(
            db_session,
            project,
            1,
            key_prefix="outsider_relationship",
        )
    )[0]
    service = ExecutionService(
        db=db_session,
        project_id=project.id,
        semantic_validation_selection=_selection(selected),
    )

    contract = await service._resolve_semantic_validation_contract(
        service.semantic_validation_selection,
        project_id=project.id,
    )

    def resolve_for_test(entry: SemanticEntry, _sources: list[dict]):
        definition_hash = stable_payload_hash(entry.definition)
        return (
            {
                "id": str(entry.id),
                "active_revision_id": str(entry.active_revision_id),
                "key": entry.key,
                "value": entry.value,
                "state": entry.state,
                "validity": entry.validity,
                "execution_state": entry.execution_state,
                "definition": entry.definition,
                "definition_hash": definition_hash,
                "evidence": entry.evidence,
                "resolved_sources": {},
            },
            None,
        )

    monkeypatch.setattr(project_context_service, "_resolve_relationship", resolve_for_test)
    context = await load_project_context(
        db_session,
        project.id,
        semantic_validation_selection=contract,
    )
    relationships = {item["id"]: item for item in context.candidate_relationships}
    assert list(item["semantic_entry_id"] for item in contract) == [
        str(item.id) for item in selected
    ]
    assert len(relationships) == 25
    assert str(outsider.id) not in relationships

    context.required_relationship_validations = [
        {
            **item,
            "value": relationships[item["semantic_entry_id"]]["value"],
            "definition": relationships[item["semantic_entry_id"]]["definition"],
        }
        for item in contract
    ]
    public_contract = context.public_summary()["required_relationship_validations"]
    assert len(public_contract) == 25
    assert public_contract[-1]["semantic_entry_id"] == str(selected[-1].id)


@pytest.mark.asyncio
async def test_execution_contract_rejects_revision_drift(
    db_session: AsyncSession,
) -> None:
    project = Project(name="漂移关系验证")
    db_session.add(project)
    await db_session.commit()
    entry = (await _relationship_candidates(db_session, project, 1))[0]
    stale_selection = _selection([entry])
    previous_revision_id = entry.active_revision_id
    entry.evidence = [{"kind": "external_edit"}]
    await append_semantic_revision(
        db_session,
        entry,
        mutation_kind="candidate_updated",
        actor_source="user",
        expected_active_revision_id=previous_revision_id,
    )
    await db_session.commit()
    service = ExecutionService(
        db=db_session,
        project_id=project.id,
        semantic_validation_selection=stale_selection,
    )

    with pytest.raises(SemanticValidationSelectionError, match="版本已变化"):
        await service._resolve_semantic_validation_contract(
            service.semantic_validation_selection,
            project_id=project.id,
        )


@pytest.mark.asyncio
async def test_incomplete_batch_does_not_mark_selected_entry_verified(
    db_session: AsyncSession,
) -> None:
    project = Project(name="不完整关系验证")
    db_session.add(project)
    await db_session.commit()
    entry = (await _relationship_candidates(db_session, project, 1))[0]
    contract = {
        "semantic_entry_id": str(entry.id),
        "expected_active_revision_id": str(entry.active_revision_id),
        "relationship_key": entry.key,
        "definition_hash": stable_payload_hash(entry.definition),
    }
    run = AnalysisRun(
        project_id=project.id,
        query="验证所选关联",
        state="investigating",
        stage="investigating",
        checkpoint={"semantic_validation_selection": [contract]},
    )
    db_session.add(run)
    await db_session.commit()
    service = ExecutionService(db=db_session, project_id=project.id)

    outcome = await service._stage_project_result(
        run,
        {
            "analysis_state": "completed",
            "report": {"status": "completed", "title": "验证结果", "summary": "已完成"},
            "tool_history": [],
            "knowledge_proposals": [],
        },
    )

    await db_session.refresh(entry)
    await db_session.refresh(run)
    assert outcome.accepted is False
    assert outcome.error_code == "SEMANTIC_VALIDATION_INCOMPLETE"
    assert entry.execution_state == "needs_validation"
    assert run.state == "needs_attention"
    assert "0/1" in run.report["summary"]


@pytest.mark.asyncio
async def test_exact_full_relation_evidence_marks_only_that_revision_verified(
    db_session: AsyncSession,
) -> None:
    project = Project(name="完整关系验证")
    db_session.add(project)
    await db_session.commit()
    entry = (await _relationship_candidates(db_session, project, 1))[0]
    selected_revision_id = entry.active_revision_id
    definition_hash = stable_payload_hash(entry.definition)
    contract = {
        "semantic_entry_id": str(entry.id),
        "expected_active_revision_id": str(selected_revision_id),
        "relationship_key": entry.key,
        "definition_hash": definition_hash,
    }
    run = AnalysisRun(
        project_id=project.id,
        query="验证所选关联",
        state="investigating",
        stage="investigating",
        checkpoint={"semantic_validation_selection": [contract]},
    )
    db_session.add(run)
    await db_session.commit()
    evidence = {
        "kind": "relationship_validation",
        "semantic_entry_id": str(entry.id),
        "active_revision_id": str(selected_revision_id),
        "candidate_relationship_key": entry.key,
        "definition_hash": definition_hash,
        "source_refs": [
            {
                "source_id": "orders-source",
                "table_or_view": "orders",
                "query_scope": "full",
            },
            {
                "source_id": "stores-source",
                "table_or_view": "stores",
                "query_scope": "full",
            },
        ],
        "profile": {"truncated": False, "left_match_rate": 1, "expansion_ratio": 1},
        "evidence_origin": "system",
        "evidence_scope": "full_relation",
        "completeness": "complete",
        "reusable_proof_eligible": True,
    }
    service = ExecutionService(db=db_session, project_id=project.id)

    outcome = await service._stage_project_result(
        run,
        {
            "analysis_state": "completed",
            "report": {"status": "completed", "title": "验证结果", "summary": "已完成"},
            "tool_history": [evidence],
            "knowledge_proposals": [],
            "data": [],
        },
    )

    await db_session.refresh(entry)
    assert outcome.accepted is True
    assert entry.state == "candidate"
    assert entry.execution_state == "verified"
    assert entry.active_revision_id != selected_revision_id
    assert entry.execution_details["last_verified_run_id"] == str(run.id)
