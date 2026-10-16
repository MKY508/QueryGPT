"""Period-file updates: isolated replay, explicit comparison, atomic activation."""

import asyncio
import logging
import shutil
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import projects as workspace
from app.db import get_db
from app.db.tables import PreflightReportRecord, ProjectDataSource, SanitationRecipeRecord
from app.models.common import APIResponse
from app.models.source_replacement import (
    SourceReplacementApplyRequest,
    SourceReplacementPreviewRequest,
    SourceReplacementPreviewResponse,
)
from app.models.workspace import DataSourceResponse
from app.services.checkpoint_contract import stable_payload_hash
from app.services.data_preflight import fingerprint_file
from app.services.sanitation_contract import (
    canonicalize_sanitation_operations,
    replace_sanitation_reader_operations,
)
from app.services.sanitation_revisions import ensure_sanitation_revision_head
from app.services.working_copy_comparison import snapshot_working_copy

router = APIRouter(prefix="/projects")
logger = logging.getLogger(__name__)


def _conflict() -> HTTPException:
    return HTTPException(status_code=409, detail="数据或整理方法已经变化，请重新预览后确认")


@dataclass
class ReplacementTrial:
    source: ProjectDataSource
    candidate: ProjectDataSource
    recipe: SanitationRecipeRecord
    recipe_head: UUID
    recipe_updated_at: datetime
    source_revision: str
    candidate_revision: str
    old_input: str
    old_working: str
    operations: list[dict[str, Any]]
    result: Any
    preview: SourceReplacementPreviewResponse


async def _trial(
    db: AsyncSession,
    project_id: UUID,
    source_id: UUID,
    payload: SourceReplacementPreviewRequest,
    directory: Path,
) -> ReplacementTrial:
    app_settings = await workspace.get_or_create_app_settings(db)
    if not app_settings.preprocessing_enabled:
        raise HTTPException(status_code=403, detail="当前无法整理数据")
    source = await workspace._source_or_404(db, project_id, source_id)
    candidate = await workspace._source_or_404(db, project_id, payload.candidate_source_id)
    if (
        source.id == candidate.id
        or source.kind != "file"
        or candidate.kind != "file"
        or source.status not in {"ready", "needs_confirmation"}
        or (source.profile_data or {}).get("is_current") is False
        or (source.profile_data or {}).get("replacement_of")
        or not source.source_uri
        or not source.working_uri
        or not candidate.source_uri
        or candidate.status not in {"attached", "error"}
        or candidate.working_uri
        or (candidate.profile_data or {}).get("replacement_of")
    ):
        raise HTTPException(status_code=409, detail="请选择当前数据和一份尚未整理的新文件")
    recipe, revision, operations = await workspace._active_cleaning_recipe_snapshot(
        db,
        project_id=project_id,
        source_id=source.id,
    )
    if (
        recipe is None
        or revision is None
        or recipe.status != "applied"
        or revision.state != "confirmed"
    ):
        raise HTTPException(status_code=409, detail="请先核对当前数据的整理方法")
    if await workspace._single_recipe_for_source(db, project_id=project_id, source_id=candidate.id):
        raise HTTPException(status_code=409, detail="这份新文件已有整理方法，请选择尚未整理的文件")
    # Capture immutable request evidence before any blocking parser work.
    source_revision = workspace._preparation_source_revision(source, recipe)
    candidate_revision = workspace._preparation_source_revision(candidate)
    recipe_head, recipe_updated_at = revision.id, recipe.updated_at
    old_input, old_working = await asyncio.gather(
        asyncio.to_thread(fingerprint_file, Path(source.source_uri)),
        asyncio.to_thread(fingerprint_file, Path(source.working_uri)),
    )
    if (
        source.fingerprint != old_input
        or recipe.input_fingerprint != old_input
        or recipe.output_fingerprint != old_working
    ):
        raise _conflict()
    await asyncio.to_thread(
        workspace._enforce_visual_cleaning_source_limits, Path(candidate.source_uri)
    )
    selected_reader = {}
    if payload.selection is not None:
        reader_steps, selected_reader = await workspace._previewed_reader_operations(
            candidate, None, payload.selection
        )
        operations = replace_sanitation_reader_operations(operations, reader_steps)
    result = await workspace._run_preflight_in_thread(
        Path(candidate.source_uri),
        directory,
        recipe_operations=operations,
    )
    if payload.selection is not None and (
        result.input_fingerprint != payload.selection.input_fingerprint
        or any(
            (result.source_snapshot.get("reader") or {}).get(key) != value
            for key, value in selected_reader.items()
        )
    ):
        raise _conflict()
    if result.working_path is None:
        raise HTTPException(status_code=409, detail="新文件尚未生成可用数据，请检查读取设置")
    workspace._scope_preflight_ambiguities(result.ambiguities, candidate.id)
    await workspace._reuse_confirmed_preflight_answers(db, project_id, result)
    added, removed, types, overlap = workspace._schema_drift_details(
        source.profile_data or {}, result.inferred_schema
    )
    workspace._record_schema_drift(
        result,
        matched_by="explicit_replacement",
        overlap_ratio=overlap,
        added_columns=added,
        removed_columns=removed,
        type_changes=types,
    )
    before, after = await asyncio.gather(
        asyncio.to_thread(snapshot_working_copy, Path(source.working_uri)),
        asyncio.to_thread(snapshot_working_copy, result.working_path),
    )
    can_apply = not workspace._template_replay_drift(result) and result.status != "error"
    proof = stable_payload_hash(
        {
            "version": 1,
            "project": str(project_id),
            "source": source_revision,
            "candidate": candidate_revision,
            "old_input": old_input,
            "old_working": old_working,
            "new_input": result.input_fingerprint,
            "new_output": result.output_fingerprint,
            "input_rows": int(result.source_snapshot.get("original_rows") or 0),
            "operations": canonicalize_sanitation_operations(operations),
            "issues": result.issues,
            "ambiguities": result.ambiguities,
            "added": sorted(added),
            "removed": sorted(removed),
            "types": types,
            "selection": payload.selection.model_dump(mode="json") if payload.selection else None,
        }
    )
    return ReplacementTrial(
        source,
        candidate,
        recipe,
        recipe_head,
        recipe_updated_at,
        source_revision,
        candidate_revision,
        old_input,
        old_working,
        operations,
        result,
        SourceReplacementPreviewResponse(
            source_id=source.id,
            candidate_source_id=candidate.id,
            proof=proof,
            before=before,
            after=after,
            input_rows=int(result.source_snapshot.get("original_rows") or 0),
            added_columns=sorted(added),
            removed_columns=sorted(removed),
            type_changes=types,
            issues=result.issues,
            unresolved_questions=len(result.ambiguities),
            can_apply=can_apply,
        ),
    )


async def _verify_current(db: AsyncSession, trial: ReplacementTrial) -> None:
    await db.refresh(trial.source)
    await db.refresh(trial.candidate)
    await db.refresh(trial.recipe)
    if (
        workspace._preparation_source_revision(trial.source, trial.recipe) != trial.source_revision
        or workspace._preparation_source_revision(trial.candidate) != trial.candidate_revision
        or await workspace._single_recipe_for_source(
            db, project_id=trial.candidate.project_id, source_id=trial.candidate.id
        )
    ):
        raise _conflict()
    actual = await asyncio.gather(
        *(
            asyncio.to_thread(fingerprint_file, Path(path))
            for path in (
                trial.source.source_uri,
                trial.source.working_uri,
                trial.candidate.source_uri,
            )
        )
    )
    if actual != [trial.old_input, trial.old_working, trial.result.input_fingerprint]:
        raise _conflict()


async def _claim_source(db: AsyncSession, source: ProjectDataSource) -> None:
    claimed = await db.execute(
        update(ProjectDataSource)
        .where(
            ProjectDataSource.id == source.id,
            ProjectDataSource.updated_at == source.updated_at,
            ProjectDataSource.status == source.status,
            ProjectDataSource.working_uri == source.working_uri,
            ProjectDataSource.fingerprint == source.fingerprint,
        )
        .values(updated_at=datetime.now(UTC))
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        raise _conflict()


@router.post(
    "/{project_id}/sources/{source_id}/replacement/preview",
    response_model=APIResponse[SourceReplacementPreviewResponse],
)
async def preview_source_replacement(
    project_id: UUID,
    source_id: UUID,
    payload: SourceReplacementPreviewRequest,
    db: AsyncSession = Depends(get_db),
):
    directory = workspace._cleaning_attempt_dir(
        project_id, payload.candidate_source_id, purpose="previews"
    )
    try:
        trial = await _trial(db, project_id, source_id, payload, directory)
        await _verify_current(db, trial)
        return APIResponse.ok(data=trial.preview)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "Replacement preview failed for project %s source %s", project_id, source_id
        )
        raise HTTPException(
            status_code=409, detail="暂时无法预览这份新文件，请检查读取设置"
        ) from exc
    finally:
        await db.rollback()  # Includes incidental first-use settings initialization.
        shutil.rmtree(directory, ignore_errors=True)


@router.post(
    "/{project_id}/sources/{source_id}/replacement/apply",
    response_model=APIResponse[DataSourceResponse],
)
async def apply_source_replacement(
    project_id: UUID,
    source_id: UUID,
    payload: SourceReplacementApplyRequest,
    db: AsyncSession = Depends(get_db),
):
    directory = workspace._cleaning_attempt_dir(
        project_id, payload.candidate_source_id, purpose="attempts"
    )
    commit_started = False
    try:
        trial = await _trial(db, project_id, source_id, payload, directory)
        if not trial.preview.can_apply or trial.preview.proof != payload.proof:
            raise _conflict()
        await workspace._locked_project_or_404(db, project_id)
        await _verify_current(db, trial)
        for source in sorted([trial.source, trial.candidate], key=lambda item: str(item.id)):
            await _claim_source(db, source)
        claimed = await db.execute(
            update(SanitationRecipeRecord)
            .where(
                SanitationRecipeRecord.id == trial.recipe.id,
                SanitationRecipeRecord.active_revision_id == trial.recipe_head,
                SanitationRecipeRecord.updated_at == trial.recipe_updated_at,
            )
            .values(updated_at=datetime.now(UTC))
            .execution_options(synchronize_session=False)
        )
        if claimed.rowcount != 1:
            raise _conflict()
        old, new, result = trial.source, trial.candidate, trial.result
        logical_name = str(
            (old.profile_data or {}).get("logical_name") or workspace._view_name(old)
        )
        version = int((old.profile_data or {}).get("version") or 1) + 1
        accepted_at = datetime.now(UTC).isoformat()
        old.profile_data = {
            **(old.profile_data or {}),
            "logical_name": logical_name,
            "is_current": False,
            "superseded_by": str(new.id),
        }
        old.status = "superseded"
        new.status = "needs_confirmation" if result.ambiguities else "ready"
        new.working_uri = str(result.working_path.resolve())
        new.fingerprint = result.input_fingerprint
        new.profile_data = {
            "summary": result.summary,
            "schema": result.inferred_schema,
            "sample": result.source_snapshot.get("sample", []),
            "preanalysis": result.source_snapshot.get("preanalysis", {}),
            "issues": result.issues,
            "ambiguities": result.ambiguities,
            **workspace._reader_profile(result),
            "logical_name": logical_name,
            "version": version,
            "is_current": True,
            "recipe_replayed_from": str(old.id),
            "accepted_replacement": {
                "at": accepted_at,
                "previous_source_id": str(old.id),
                "proof": payload.proof,
            },
        }
        operations = canonicalize_sanitation_operations(
            [
                {
                    "operation": "replay_prior_recipe",
                    "source_id": str(old.id),
                    "recipe_id": str(trial.recipe.id),
                },
                *result.operations,
            ]
        )
        recipe = SanitationRecipeRecord(
            project_id=project_id,
            data_source_id=new.id,
            name=f"{new.name} 整理方法",
            status="applied",
            operations=operations,
            input_fingerprint=result.input_fingerprint,
            output_fingerprint=result.output_fingerprint,
        )
        db.add(recipe)
        revision = await ensure_sanitation_revision_head(db, recipe)
        revision.input_contract, revision.output_contract = workspace._sanitation_contracts(result)
        revision.actor_source, revision.reason = "user", "预览并确认用新一期文件更新数据"
        manual = workspace._stored_visual_cleaning_operations(old, trial.recipe_head)
        if manual is not None:
            new.profile_data = {
                **new.profile_data,
                "visual_cleaning": {"operations": manual, "active_revision_id": str(revision.id)},
            }
        db.add(
            PreflightReportRecord(
                project_id=project_id,
                data_source_id=new.id,
                status=new.status,
                summary=result.summary,
                issues=result.issues,
                ambiguities=result.ambiguities,
                inferred_schema=result.inferred_schema,
                fingerprint=result.input_fingerprint,
                source_snapshot={
                    **result.source_snapshot,
                    "replacement": {
                        "status": "accepted",
                        "replaced_source_id": str(old.id),
                        "active_source_id": str(new.id),
                        "accepted_at": accepted_at,
                    },
                },
            )
        )
        await workspace._persist_preflight_candidates(db, new)
        await db.flush()
        response = APIResponse.ok(data=DataSourceResponse.model_validate(new))
        commit_started = True
        await db.commit()
        return response
    except HTTPException:
        await db.rollback()
        raise
    except Exception as exc:
        await db.rollback()
        logger.exception(
            "Replacement update failed for project %s source %s", project_id, source_id
        )
        if commit_started:
            raise HTTPException(status_code=503, detail="更新结果尚未确认，请刷新数据列表") from exc
        raise HTTPException(status_code=409, detail="这次更新未完成，请重新预览") from exc
    finally:
        # A disconnected commit may have succeeded; never remove its possible output.
        if not commit_started:
            shutil.rmtree(directory, ignore_errors=True)
