"""Recover interrupted generations and their transcript in short owned transactions."""

import asyncio
from copy import deepcopy
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.tables import AnalysisRun, Conversation, Message
from app.services.analysis_checkpoint import checkpoint_manifest_is_readable
from app.services.analysis_completion import AnalysisCompletion
from app.services.analysis_continuation import plan_analysis_continuation
from app.services.analysis_run_journal import lock_analysis_run
from app.services.checkpoint_contract import CheckpointError
from app.services.conversation_state import ConversationTurnState


async def _recovery_offer(project_id: UUID, checkpoint: dict[str, Any]) -> tuple[bool, str]:
    try:
        continuation = plan_analysis_continuation(
            state="needs_attention", stage="paused", query="", checkpoint=checkpoint, started_at=""
        )
    except CheckpointError:
        pass
    else:
        if not continuation.restore_snapshot:
            return True, "上次调查已暂停，已有的确认和准备已保留，可以继续调查。"
        if await asyncio.to_thread(
            checkpoint_manifest_is_readable, settings.WORKSPACE_ROOT / str(project_id), checkpoint
        ):
            return True, "上次调查已暂停，已经完成的安全步骤已保存，可以继续调查。"
    return False, "上次调查已中断，没有完整的安全检查点，请重新调查。"


async def _stage_recovery_message(
    db: AsyncSession, run: AnalysisRun, *, reason: str, resumable: bool, content: str
) -> None:
    if run.conversation_id is None:
        return
    attempt_id = (run.checkpoint or {}).get("stream_attempt_id")
    existing = select(Message.id).where(
        Message.conversation_id == run.conversation_id,
        Message.role == "assistant",
        Message.extra_data["analysis_run_id"].as_string() == str(run.id),
        Message.extra_data["stream_attempt_id"].as_string() == attempt_id,
    )
    if (await db.execute(existing.limit(1))).scalar_one_or_none() is not None:
        return
    db.add(
        Message(
            conversation_id=run.conversation_id,
            role="assistant",
            content=content,
            extra_data={
                "analysis_state": "needs_attention",
                "analysis_run_id": str(run.id),
                "stream_attempt_id": attempt_id,
                "project_id": str(run.project_id),
                "original_query": run.query,
                "resumable": resumable,
                "checkpoint_reason": reason,
                "error_code": "PROCESS_INTERRUPTED",
                "error_category": "interrupted",
            },
        )
    )
    # The caller may ask twice before commit; make the first message visible to
    # this transaction's duplicate check even with autoflush disabled.
    await db.flush()

    def mark_recovery(conversation: Conversation) -> None:
        conversation.status = "error"
        conversation.extra_data = {
            **(conversation.extra_data or {}),
            "last_error": content,
            "last_analysis_run_id": str(run.id),
        }

    if isinstance(attempt_id, str) and attempt_id:
        await ConversationTurnState(run.conversation_id, attempt_id).apply(db, mark_recovery)


async def ensure_recovery_message(
    db: AsyncSession,
    run: AnalysisRun,
    *,
    reason: str,
    expected_attempt_id: str | None = None,
) -> None:
    """Stage one recovery message for the observed generation; the caller commits."""
    if run.conversation_id is None or run.state != "needs_attention":
        return
    run_id, project_id = run.id, run.project_id
    checkpoint = deepcopy(run.checkpoint or {})
    attempt_id = checkpoint.get("stream_attempt_id")
    if expected_attempt_id is not None and attempt_id != expected_attempt_id:
        return
    resumable, content = await _recovery_offer(project_id, checkpoint)
    current = await lock_analysis_run(
        db,
        run_id,
        AnalysisRun.state == "needs_attention",
        AnalysisRun.checkpoint["stream_attempt_id"].as_string() == attempt_id,
    )
    if current is None or (current.checkpoint or {}) != checkpoint:
        return
    await _stage_recovery_message(db, current, reason=reason, resumable=resumable, content=content)


async def recover_interrupted_analysis_runs(db: AsyncSession) -> int:
    """Discover startup leftovers, then commit each run and its message together."""
    async with AnalysisCompletion(db).transaction():
        result = await db.execute(
            select(
                AnalysisRun.id,
                AnalysisRun.project_id,
                AnalysisRun.state,
                AnalysisRun.stage,
                AnalysisRun.checkpoint,
                AnalysisRun.updated_at,
            ).where(AnalysisRun.state.in_({"understanding", "investigating"}))
        )
        rows = result.mappings().all()
    recovered = 0
    for row in rows:
        checkpoint = deepcopy(row["checkpoint"] or {})
        if row["stage"] == "prepared" and isinstance(checkpoint.get("standing_analysis"), dict):
            continue
        # File validation never runs under a recovery database transaction.
        resumable, content = await _recovery_offer(row["project_id"], checkpoint)
        async with AnalysisCompletion(db).transaction():
            run = await lock_analysis_run(
                db,
                row["id"],
                AnalysisRun.state.in_({"understanding", "investigating"}),
                AnalysisRun.checkpoint["stream_attempt_id"].as_string()
                == checkpoint.get("stream_attempt_id"),
            )
            if (
                run is None
                or run.state != row["state"]
                or run.stage != row["stage"]
                or run.updated_at != row["updated_at"]
                or (run.checkpoint or {}) != checkpoint
            ):
                continue
            run.state = "needs_attention"
            run.stage = "needs_attention"
            run.error = "应用退出时调查尚未完成"
            run.checkpoint = {**checkpoint, "resumable": resumable, "reason": "process_interrupted"}
            await _stage_recovery_message(
                db, run, reason="process_interrupted", resumable=resumable, content=content
            )
        recovered += 1
    return recovered
