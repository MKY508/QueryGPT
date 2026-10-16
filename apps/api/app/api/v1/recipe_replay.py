"""Review current or historical methods without changing the live data first."""

import asyncio
import logging
import shutil
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import projects as workspace
from app.api.v1.source_replacement import _claim_source
from app.db import get_db
from app.db.tables import (
    PreflightReportRecord,
    ProjectDataSource,
    SanitationRecipeRecord,
    SanitationRecipeRevisionRecord,
)
from app.models.common import APIResponse
from app.models.recipe_replay import (
    RecipeReplayApplyRequest,
    RecipeReplayPreview,
    RecipeReplayRequest,
)
from app.models.workspace import DataSourceResponse
from app.services.checkpoint_contract import stable_payload_hash
from app.services.data_preflight import fingerprint_file
from app.services.project_write_guard import lock_project_for_publication
from app.services.report_refresh import (
    RefreshSourceState,
    assert_refresh_file_stamps,
    verify_refresh_files,
)
from app.services.sanitation_contract import canonicalize_sanitation_operations
from app.services.sanitation_revisions import (
    append_sanitation_revision,
    sanitation_revision_or_none,
)
from app.services.working_copy_comparison import snapshot_working_copy

router = APIRouter(prefix="/projects")
logger = logging.getLogger(__name__)


def _changed() -> HTTPException:
    return HTTPException(status_code=409, detail="数据或整理方法已经变化，请重新预览")


def _revision_evidence(revision: SanitationRecipeRevisionRecord) -> str:
    return stable_payload_hash(
        {
            "id": revision.id,
            "recipe": revision.recipe_id,
            "number": revision.revision_number,
            "state": revision.state,
            "operations": revision.operations,
            "input": revision.input_contract,
            "output": revision.output_contract,
        }
    )


@dataclass
class ReplayTrial:
    source: ProjectDataSource
    recipe: SanitationRecipeRecord
    target: SanitationRecipeRevisionRecord
    head: UUID
    source_evidence: str
    target_evidence: str
    previous: ProjectDataSource | None
    previous_evidence: str | None
    files: dict[str, str]
    result: Any
    operations: list[dict[str, Any]]
    manual: list[dict[str, Any]] | None
    preview: RecipeReplayPreview


async def _hash_file(path: str, project_id: UUID) -> str:
    resolved = Path(path).resolve()
    if not resolved.is_file() or not resolved.is_relative_to(
        (workspace.settings.WORKSPACE_ROOT / str(project_id)).resolve()
    ):
        raise _changed()
    return await asyncio.to_thread(fingerprint_file, resolved)


async def _attempt_directory(
    db: AsyncSession, project_id: UUID, recipe_id: UUID, purpose: Literal["previews", "attempts"]
) -> Path:
    recipe = await db.get(SanitationRecipeRecord, recipe_id, populate_existing=True)
    if recipe is None or recipe.project_id != project_id:
        raise HTTPException(status_code=404, detail="整理方法不存在")
    return workspace._cleaning_attempt_dir(project_id, recipe.data_source_id, purpose=purpose)


async def _trial(
    db: AsyncSession,
    project_id: UUID,
    recipe_id: UUID,
    payload: RecipeReplayRequest,
    directory: Path,
) -> ReplayTrial:
    settings = await workspace.get_or_create_app_settings(db)
    if not settings.preprocessing_enabled:
        raise HTTPException(status_code=403, detail="当前无法整理数据")
    recipe = await db.get(SanitationRecipeRecord, recipe_id, populate_existing=True)
    if recipe is None or recipe.project_id != project_id:
        raise HTTPException(status_code=404, detail="整理方法不存在")
    source = await workspace._source_or_404(db, project_id, recipe.data_source_id)
    await db.refresh(source)
    if source.kind != "file" or not source.source_uri or source.status == "superseded":
        raise HTTPException(status_code=409, detail="请在当前文件版本上重新整理")
    current, head, _ = await workspace._active_cleaning_recipe_snapshot(
        db,
        project_id=project_id,
        source_id=source.id,
    )
    if current is None or head is None or current.id != recipe.id:
        raise _changed()
    target = await sanitation_revision_or_none(
        db,
        recipe_id=recipe.id,
        revision_id=payload.revision_id or head.id,
    )
    if target is None:
        raise HTTPException(status_code=404, detail="这个历史方法不存在")
    await db.refresh(target)
    operations = canonicalize_sanitation_operations(target.operations)
    source_evidence = workspace._preparation_source_revision(source, recipe)
    target_evidence = _revision_evidence(target)
    head_id = head.id
    manual = (
        workspace._stored_visual_cleaning_operations(source, head_id)
        if target.id == head_id
        else None
    )
    previous = None
    replacement_of = (source.profile_data or {}).get("replacement_of")
    if replacement_of:
        previous = await workspace._source_or_404(db, project_id, UUID(str(replacement_of)))
        await db.refresh(previous)
        if (
            previous.id == source.id
            or previous.status == "superseded"
            or not previous.working_uri
            or (previous.profile_data or {}).get("is_current") is False
        ):
            raise _changed()
    previous_evidence = workspace._preparation_source_revision(previous) if previous else None
    files = {}
    for path in [source.source_uri, source.working_uri, previous.working_uri if previous else None]:
        if path:
            files[path] = await _hash_file(path, project_id)
    await asyncio.to_thread(
        workspace._enforce_visual_cleaning_source_limits, Path(source.source_uri)
    )
    result = await workspace._run_preflight_in_thread(
        Path(source.source_uri),
        directory,
        recipe_operations=operations,
    )
    if result.working_path is None or result.input_fingerprint != files[source.source_uri]:
        raise _changed()
    workspace._scope_preflight_ambiguities(result.ambiguities, source.id)
    await workspace._reuse_confirmed_preflight_answers(db, project_id, result)
    # A pending replacement stays pending. Replaying its method never activates it.
    if previous:
        added, removed, types, overlap = workspace._schema_drift_details(
            previous.profile_data or {}, result.inferred_schema
        )
        workspace._record_schema_drift(
            result,
            matched_by="pending_replacement",
            overlap_ratio=overlap,
            added_columns=added,
            removed_columns=removed,
            type_changes=types,
        )
        result.status = "needs_confirmation"
    added, removed, types, _ = workspace._schema_drift_details(
        source.profile_data or {}, result.inferred_schema
    )
    before = (
        await asyncio.to_thread(snapshot_working_copy, Path(source.working_uri))
        if source.working_uri
        else None
    )
    after = await asyncio.to_thread(snapshot_working_copy, result.working_path)
    materialized = workspace._materialized_cleaning_operations(operations, result.operations)
    proof = stable_payload_hash(
        {
            "version": 1,
            "project": project_id,
            "recipe": recipe_id,
            "source": source_evidence,
            "target": target_evidence,
            "previous": previous_evidence,
            "files": files,
            "output": result.output_fingerprint,
            "operations": materialized,
            "issues": result.issues,
            "ambiguities": result.ambiguities,
            "schema": result.inferred_schema,
        }
    )
    return ReplayTrial(
        source,
        recipe,
        target,
        head_id,
        source_evidence,
        target_evidence,
        previous,
        previous_evidence,
        files,
        result,
        materialized,
        manual,
        RecipeReplayPreview(
            source_id=source.id,
            recipe_id=recipe.id,
            revision_id=target.id,
            revision_number=target.revision_number,
            proof=proof,
            before=before,
            after=after,
            input_changed=bool(
                source.fingerprint and source.fingerprint != result.input_fingerprint
            ),
            pending_replacement=previous is not None,
            added_columns=sorted(added),
            removed_columns=sorted(removed),
            type_changes=types,
            issues=result.issues,
            unresolved_questions=len(result.ambiguities),
            can_apply=result.status != "error" and not workspace._template_replay_drift(result),
        ),
    )


async def _verify_catalog(db: AsyncSession, trial: ReplayTrial) -> None:
    await db.refresh(trial.source)
    await db.refresh(trial.recipe)
    await db.refresh(trial.target)
    if (
        workspace._preparation_source_revision(trial.source, trial.recipe) != trial.source_evidence
        or _revision_evidence(trial.target) != trial.target_evidence
    ):
        raise _changed()
    if trial.previous:
        await db.refresh(trial.previous)
        if workspace._preparation_source_revision(trial.previous) != trial.previous_evidence:
            raise _changed()


async def _verify(db: AsyncSession, trial: ReplayTrial) -> dict[str, tuple[int, ...]]:
    await _verify_catalog(db, trial)
    files = {**trial.files, str(trial.result.working_path): trial.result.output_fingerprint}
    return await asyncio.to_thread(
        verify_refresh_files,
        RefreshSourceState({}, "", tuple(files.items())),
        workspace.settings.WORKSPACE_ROOT / str(trial.source.project_id),
    )


@router.post(
    "/{project_id}/recipes/{recipe_id}/replay/preview",
    response_model=APIResponse[RecipeReplayPreview],
)
async def preview_recipe_replay(
    project_id: UUID,
    recipe_id: UUID,
    payload: RecipeReplayRequest,
    db: AsyncSession = Depends(get_db),
):
    directory = await _attempt_directory(db, project_id, recipe_id, "previews")
    try:
        trial = await _trial(db, project_id, recipe_id, payload, directory)
        await _verify(db, trial)
        return APIResponse.ok(data=trial.preview)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Recipe replay preview failed for %s", recipe_id)
        raise HTTPException(
            status_code=409, detail="暂时无法预览这个整理方法，请核对文件与步骤"
        ) from exc
    finally:
        await db.rollback()
        shutil.rmtree(directory, ignore_errors=True)


@router.post(
    "/{project_id}/recipes/{recipe_id}/replay/apply", response_model=APIResponse[DataSourceResponse]
)
async def apply_recipe_replay(
    project_id: UUID,
    recipe_id: UUID,
    payload: RecipeReplayApplyRequest,
    db: AsyncSession = Depends(get_db),
):
    directory = await _attempt_directory(db, project_id, recipe_id, "attempts")
    commit_started = False
    try:
        trial = await _trial(db, project_id, recipe_id, payload, directory)
        if not trial.preview.can_apply or trial.preview.proof != payload.proof:
            raise _changed()
        checked_files = await _verify(db, trial)
        await db.rollback()
        if await lock_project_for_publication(db, project_id) is None:
            raise HTTPException(status_code=404, detail="项目不存在")
        await _verify_catalog(db, trial)
        await _claim_source(db, trial.source)
        source, recipe, result = trial.source, trial.recipe, trial.result
        input_contract, output_contract = workspace._sanitation_contracts(result)
        input_contract["replayed_from_revision_id"] = str(trial.target.id)
        candidate = bool(
            trial.previous
            and (result.source_snapshot.get("schema_drift") or {}).get("requires_confirmation")
        )
        revision = await append_sanitation_revision(
            db,
            recipe,
            expected_active_revision_id=trial.head,
            state="candidate" if candidate else "confirmed",
            operations=trial.operations,
            input_contract=input_contract,
            output_contract=output_contract,
            actor_source="user",
            reason=f"预览并确认应用第 {trial.target.revision_number} 版整理方法",
        )
        recipe.status = "needs_attention" if candidate else "applied"
        profile = deepcopy(source.profile_data or {})
        profile.pop("visual_cleaning", None)
        if not trial.previous:
            profile.pop("activation_state", None)
        source.status = result.status
        source.working_uri = str(result.working_path.resolve())
        source.fingerprint = result.input_fingerprint
        source.profile_data = {
            **profile,
            "summary": result.summary,
            "schema": result.inferred_schema,
            "preanalysis": result.source_snapshot.get("preanalysis", {}),
            "sample": result.source_snapshot.get("sample", []),
            "issues": result.issues,
            "ambiguities": result.ambiguities,
            **workspace._reader_profile(result),
            "logical_name": str(profile.get("logical_name") or workspace._view_name(source)),
            "version": int(profile.get("version") or 1),
            "is_current": trial.previous is None,
            **({"activation_state": "pending_confirmation"} if trial.previous else {}),
        }
        if trial.manual is not None:
            source.profile_data["visual_cleaning"] = {
                "operations": trial.manual,
                "active_revision_id": str(revision.id),
            }
        await workspace._clear_inferred_candidates_for_source(db, source)
        if not trial.previous:
            await workspace._persist_preflight_candidates(db, source)
        db.add(
            PreflightReportRecord(
                project_id=project_id,
                data_source_id=source.id,
                status=source.status,
                summary=result.summary,
                issues=result.issues,
                ambiguities=result.ambiguities,
                inferred_schema=result.inferred_schema,
                fingerprint=result.input_fingerprint,
                source_snapshot={
                    **result.source_snapshot,
                    "reviewed_replay": {
                        "revision_id": str(trial.target.id),
                        "proof": payload.proof,
                    },
                },
            )
        )
        await db.flush()
        assert_refresh_file_stamps(checked_files)
        response = APIResponse.ok(data=DataSourceResponse.model_validate(source))
        commit_started = True
        await db.commit()
        return response
    except HTTPException:
        await db.rollback()
        raise
    except asyncio.CancelledError:
        await db.rollback()
        raise
    except Exception as exc:
        await db.rollback()
        logger.exception("Recipe replay publication failed for %s", recipe_id)
        if commit_started:
            raise HTTPException(status_code=503, detail="整理结果尚未确认，请刷新数据列表") from exc
        raise HTTPException(status_code=409, detail="这次整理未完成，请重新预览") from exc
    finally:
        # A lost commit acknowledgement must not delete a possibly published file.
        if not commit_started:
            shutil.rmtree(directory, ignore_errors=True)
