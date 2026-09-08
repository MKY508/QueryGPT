"""Serialize persistence for one run generation, independently of its engine."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from copy import deepcopy
from pathlib import Path
from typing import Any

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import AnalysisRun
from app.models.analysis_state import (
    TERMINAL_ANALYSIS_STATES,
    AnalysisState,
    parse_analysis_state,
)
from app.services.analysis_checkpoint import save_runtime_checkpoint
from app.services.analysis_completion import AnalysisCompletion
from app.services.run_control import AnalystStoppedError, finish_before_cancellation

_RUN_CONTEXT_KEYS = (
    "stream_attempt_id",
    "semantic_validation_selection",
    "standing_analysis",
    "correction_context",
    "confirmation_receipt",
    "confirmation_receipt_status",
    "confirmation_consumed_at",
)
_ACTIVE_STATES = (AnalysisState.UNDERSTANDING, AnalysisState.INVESTIGATING)


class AnalysisRunOwnershipError(AnalystStoppedError):
    """The run no longer accepts writes from this execution generation."""


class AnalysisRunJournal:
    def __init__(self, db: AsyncSession, run: AnalysisRun, attempt_id: str):
        self.db = db
        self.run = run
        self.run_id = run.id
        self.project_id = run.project_id
        self.attempt_id = attempt_id
        self._lock = asyncio.Lock()
        self._resumable = bool((run.checkpoint or {}).get("resumable"))
        self._revision = int((run.checkpoint or {}).get("revision") or 0)
        self._owned = True

    @property
    def event_context(self) -> dict[str, Any]:
        # Rollback expires ORM attributes. Error publication must not trigger IO.
        checkpoint = self.run.__dict__.get("checkpoint")
        resumable = bool(checkpoint.get("resumable")) if checkpoint is not None else self._resumable
        return {
            "analysis_run_id": str(self.run_id),
            "project_id": str(self.project_id),
            "analysis_state": "needs_attention",
            "resumable": self._owned and resumable,
        }

    async def _claim(self, *, include_attention: bool) -> None:
        states = (
            (*_ACTIVE_STATES, AnalysisState.NEEDS_ATTENTION)
            if include_attention
            else _ACTIVE_STATES
        )
        with self.db.no_autoflush:
            owned = await self.db.execute(
                update(AnalysisRun)
                .where(
                    AnalysisRun.id == self.run_id,
                    AnalysisRun.checkpoint["stream_attempt_id"].as_string() == self.attempt_id,
                    AnalysisRun.state.in_(states),
                )
                .values(updated_at=AnalysisRun.updated_at)
                .returning(AnalysisRun.id)
                .execution_options(synchronize_session=False)
            )
            if owned.scalar_one_or_none() is None:
                self._owned = False
                raise AnalysisRunOwnershipError("这次调查已结束或已由新的执行接续")
            # Read the current row while holding its write lock, not an old ORM copy.
            await self.db.refresh(self.run)

    @asynccontextmanager
    async def _transaction(
        self, completion: AnalysisCompletion, *, include_attention: bool = False
    ) -> AsyncIterator[AnalysisRun]:
        try:
            async with completion.transaction():
                await self._claim(include_attention=include_attention)
                yield self.run
        finally:
            if completion.committed:
                self._resumable = bool((self.run.checkpoint or {}).get("resumable"))

    @asynccontextmanager
    async def transaction(
        self,
        completion: AnalysisCompletion | None = None,
        *,
        include_attention: bool = False,
    ) -> AsyncIterator[AnalysisRun]:
        """Serialize short DB mutations; never hold this block over model work."""
        async with self._lock:
            async with self._transaction(
                completion or AnalysisCompletion(self.db), include_attention=include_attention
            ) as run:
                yield run

    async def progress(self, data: dict[str, Any]) -> None:
        state = parse_analysis_state(data.get("analysis_state"))
        if state in TERMINAL_ANALYSIS_STATES:
            raise ValueError("Terminal progress must be published with the completed result")
        async with self.transaction() as run:
            run.stage = str(data.get("stage") or run.stage)
            if state is not None:
                run.state = state

    async def checkpoint(
        self,
        snapshot: dict[str, Any],
        *,
        project_dir: Path,
        source_fingerprints: dict[str, Any],
    ) -> dict[str, Any]:
        """Finish disk publication and its DB receipt before releasing the writer."""
        async with self._lock:
            return await finish_before_cancellation(
                self._save_checkpoint(snapshot, project_dir, source_fingerprints)
            )

    async def _save_checkpoint(
        self, snapshot: dict[str, Any], project_dir: Path, source_fingerprints: dict[str, Any]
    ) -> dict[str, Any]:
        # Disk revisions are immutable and reserved atomically by the store. No
        # database write lock is held during file IO; ownership is checked on attach.
        manifest = await save_runtime_checkpoint(
            project_dir,
            str(self.run_id),
            self._revision + 1,
            {**snapshot, "source_fingerprints": source_fingerprints},
        )
        self._revision = int(manifest["revision"])
        async with self._transaction(AnalysisCompletion(self.db)) as run:
            context = {
                key: deepcopy(run.checkpoint[key])
                for key in _RUN_CONTEXT_KEYS
                if key in (run.checkpoint or {})
            }
            receipt = {**manifest, **context}
            if isinstance(receipt.get("confirmation_receipt"), dict):
                receipt["confirmation_receipt_status"] = "consumed"
            run.checkpoint = receipt
            state = parse_analysis_state(snapshot.get("analysis_state"))
            if state not in TERMINAL_ANALYSIS_STATES:
                run.stage = str(snapshot.get("stage") or run.stage)
                if state is not None:
                    run.state = state
        return deepcopy(receipt)
