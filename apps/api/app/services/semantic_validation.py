"""Durable, deterministic validation for semantic candidates.

This worker never creates an analysis run and never invokes a model.  Every
item is pinned to one semantic revision and definition hash before any source
query is attempted.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import threading
from collections import Counter
from collections.abc import Callable, Mapping
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

import structlog
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core import encryptor
from app.db import AsyncSessionLocal
from app.db.tables import (
    Connection,
    ProjectDataSource,
    SemanticEntry,
    SemanticEntryRevision,
    SemanticValidationJob,
    SemanticValidationJobItem,
)
from app.models.workspace import (
    SemanticValidationItemResponse,
    SemanticValidationJobResponse,
    SemanticValidationProgress,
)
from app.services.checkpoint_contract import stable_payload_hash
from app.services.database import create_database_manager
from app.services.metric_formula import metric_formula_columns
from app.services.result_filters import (
    stable_field_binding_candidates,
    stable_schema_signature,
)
from app.services.semantic_revisions import (
    SemanticRevisionConflictError,
    append_semantic_revision,
    semantic_entry_snapshot,
)

VALIDATION_TIMEOUT_SECONDS = 5.0
_LEASE_SECONDS = 30
_ACTIVE_JOB_STATUSES = ("queued", "running")
_PUBLIC_ITEM_DETAIL_KEYS = frozenset({"version", "code", "message"})
_PRIVATE_ITEM_FACT_KEYS = frozenset(
    {
        "error_type",
        "exception",
        "heartbeat_at",
        "lease_expires_at",
        "lease_owner",
        "stack_trace",
        "traceback",
    }
)
_SQLITE_BUSY_MARKERS = (
    "database is locked",
    "database table is locked",
    "sqlite_busy",
)

logger = structlog.get_logger()

# Keep route- and startup-scheduled work strongly referenced until its callback
# runs. asyncio otherwise retains only a weak reference to a created task.
_scheduled_tasks: set[asyncio.Task[None]] = set()


class SemanticValidationQueueError(ValueError):
    def __init__(self, code: str, message: str, *, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.details = details or {}


class _BlockedValidation(RuntimeError):  # noqa: N818 - internal control-flow signal
    def __init__(self, code: str, message: str, *, facts: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.facts = facts or {}


class _ValidationLeaseLostError(RuntimeError):
    """The durable job was recovered or claimed by another worker."""


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _details(code: str, message: str, **extra: Any) -> dict[str, Any]:
    return {"version": 1, "code": code, "message": message, **extra}


def _public_item_facts(facts: Mapping[str, Any] | None) -> dict[str, Any]:
    """Keep business evidence while removing worker-only failure metadata."""

    return {
        str(key): value
        for key, value in dict(facts or {}).items()
        if key not in _PRIVATE_ITEM_FACT_KEYS and not str(key).startswith("_")
    }


def _public_item_details(details: Mapping[str, Any] | None) -> dict[str, Any]:
    """Expose only stable product copy, never leases or worker diagnostics."""

    payload = dict(details or {})
    return {key: payload[key] for key in _PUBLIC_ITEM_DETAIL_KEYS if key in payload}


def _retry_validation_job_id(job_id: UUID) -> UUID:
    """Derive one durable idempotency key for a terminal job's retry child."""

    return uuid5(NAMESPACE_URL, f"receiptbi:semantic-validation-retry:{job_id}")


async def _existing_retry_child(
    db: AsyncSession,
    *,
    project_id: UUID,
    original_job_id: UUID,
    retry_job_id: UUID,
) -> SemanticValidationJob | None:
    retry_job = await db.get(
        SemanticValidationJob,
        retry_job_id,
        populate_existing=True,
    )
    if retry_job is None:
        return None
    retry_of_job_id = dict(retry_job.details or {}).get("retry_of_job_id")
    if retry_job.project_id != project_id or str(retry_of_job_id or "") != str(original_job_id):
        raise SemanticValidationQueueError(
            "semantic_validation_retry_conflict",
            "验证状态刚刚发生变化，请刷新后重试。",
        )
    return retry_job


async def _wait_for_retry_child(
    db: AsyncSession,
    *,
    project_id: UUID,
    original_job_id: UUID,
    retry_job_id: UUID,
) -> SemanticValidationJob | None:
    for delay in (0.0, 0.05, 0.15, 0.3, 0.5):
        if delay:
            await asyncio.sleep(delay)
        retry_job = await _existing_retry_child(
            db,
            project_id=project_id,
            original_job_id=original_job_id,
            retry_job_id=retry_job_id,
        )
        if retry_job is not None:
            return retry_job
    return None


def _is_sqlite_busy_error(db: AsyncSession, exc: OperationalError) -> bool:
    dialect = db.bind.dialect.name if db.bind is not None else None
    message = str(exc).lower()
    return dialect == "sqlite" and any(marker in message for marker in _SQLITE_BUSY_MARKERS)


def _lease_details(
    details: Mapping[str, Any] | None,
    *,
    code: str,
    worker_id: str | None,
    heartbeat_at: datetime | None,
) -> dict[str, Any]:
    payload = dict(details or {})
    payload["code"] = code
    payload["lease_owner"] = worker_id
    payload["heartbeat_at"] = heartbeat_at.isoformat() if heartbeat_at is not None else None
    payload["lease_expires_at"] = (
        (heartbeat_at + timedelta(seconds=_LEASE_SECONDS)).isoformat()
        if heartbeat_at is not None and worker_id is not None
        else None
    )
    return payload


def _lease_owner(job: SemanticValidationJob) -> str | None:
    value = dict(job.details or {}).get("lease_owner")
    return str(value) if value else None


def _lease_expired(job: SemanticValidationJob, *, now: datetime) -> bool:
    raw_deadline = dict(job.details or {}).get("lease_expires_at")
    if not isinstance(raw_deadline, str) or not raw_deadline:
        return True
    try:
        deadline = datetime.fromisoformat(raw_deadline.replace("Z", "+00:00"))
    except ValueError:
        return True
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=UTC)
    return deadline <= now


async def queue_semantic_validation_job(
    db: AsyncSession,
    *,
    project_id: UUID,
    entries: list[SemanticEntry],
    reason: str | None,
    job_id: UUID | None = None,
) -> SemanticValidationJob:
    """Pin candidate heads and create one durable queued job in the same transaction."""

    job_values: dict[str, Any] = {
        "project_id": project_id,
        "status": "queued",
        "requested_by": "user",
        "reason": reason,
        "details": {"version": 1, "code": "semantic_validation_queued"},
    }
    if job_id is not None:
        job_values["id"] = job_id
    job = SemanticValidationJob(
        **job_values,
    )
    db.add(job)
    await db.flush()
    queued_at = _utcnow().isoformat()
    for entry in entries:
        definition = entry.definition if isinstance(entry.definition, dict) else None
        if entry.state != "candidate" or not entry.is_active or definition is None:
            raise SemanticValidationQueueError(
                "semantic_candidate_not_queueable",
                f"{entry.key} 不是可验证的当前候选",
                details={"entry_id": str(entry.id)},
            )
        if entry.entry_type not in {"metric", "dimension", "relationship"}:
            raise SemanticValidationQueueError(
                "semantic_candidate_type_unsupported",
                f"{entry.key} 不是可验证的候选类型",
                details={"entry_id": str(entry.id), "entry_type": entry.entry_type},
            )
        previous_revision_id = entry.active_revision_id
        if previous_revision_id is None:
            raise SemanticValidationQueueError(
                "semantic_revision_missing",
                f"{entry.key} 缺少当前修订，无法排队验证",
                details={"entry_id": str(entry.id)},
            )
        definition_hash = stable_payload_hash(definition)
        entry.validity = "unverified"
        entry.execution_state = "needs_validation"
        entry.execution_details = _details(
            "semantic_validation_queued",
            "候选已进入独立验证作业。",
            status="needs_validation",
            validation_job_id=str(job.id),
            definition_hash=definition_hash,
            queued_from_revision_id=str(previous_revision_id),
            queued_at=queued_at,
        )
        entry.evidence = [
            *list(entry.evidence or []),
            {
                "kind": "semantic_validation_requested",
                "semantic_entry_id": str(entry.id),
                "validation_job_id": str(job.id),
                "based_on_revision_id": str(previous_revision_id),
                "definition_hash": definition_hash,
                "requested_at": queued_at,
                "reason": reason,
            },
        ]
        revision = await append_semantic_revision(
            db,
            entry,
            mutation_kind="validation_queued",
            actor_source="user",
            reason=reason or "用户请求独立验证语义候选",
            expected_active_revision_id=previous_revision_id,
        )
        db.add(
            SemanticValidationJobItem(
                job_id=job.id,
                semantic_entry_id=entry.id,
                semantic_revision_id=revision.id,
                definition_hash=definition_hash,
                status="queued",
                details=_details(
                    "semantic_validation_queued",
                    "等待独立验证服务执行。",
                ),
            )
        )
    job.details = {
        "version": 1,
        "code": "semantic_validation_queued",
        "total_items": len(entries),
    }
    await db.flush()
    return job


async def semantic_validation_job_response(
    db: AsyncSession,
    job: SemanticValidationJob,
) -> SemanticValidationJobResponse:
    result = await db.execute(
        select(SemanticValidationJobItem)
        .where(SemanticValidationJobItem.job_id == job.id)
        .order_by(SemanticValidationJobItem.created_at, SemanticValidationJobItem.id)
    )
    items = list(result.scalars())
    counts = Counter(item.status for item in items)
    return SemanticValidationJobResponse(
        id=job.id,
        project_id=job.project_id,
        status=job.status,
        progress=SemanticValidationProgress(
            total=len(items),
            queued=counts["queued"],
            running=counts["running"],
            verified=counts["verified"],
            blocked=counts["blocked"],
            failed=counts["failed"],
        ),
        items=[
            SemanticValidationItemResponse(
                id=item.id,
                entry_id=item.semantic_entry_id,
                semantic_revision_id=item.semantic_revision_id,
                definition_hash=item.definition_hash,
                status=item.status,
                code=item.code,
                facts=_public_item_facts(item.facts),
                details=_public_item_details(item.details),
                started_at=item.started_at,
                completed_at=item.completed_at,
            )
            for item in items
        ],
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
    )


def _session_factory(
    supplied: async_sessionmaker[AsyncSession] | None,
) -> async_sessionmaker[AsyncSession]:
    return supplied or AsyncSessionLocal


def schedule_semantic_validation_job(
    job_id: UUID,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
) -> asyncio.Task[None]:
    task = asyncio.create_task(run_semantic_validation_job(job_id, session_factory))
    _scheduled_tasks.add(task)
    task.add_done_callback(_scheduled_tasks.discard)
    return task


async def recover_semantic_validation_jobs(db: AsyncSession) -> list[UUID]:
    """Requeue jobs abandoned by a previous API process.

    Validation items are revision-pinned, so completed items stay terminal while
    only interrupted ``running`` items return to ``queued``.
    """

    result = await db.execute(
        select(SemanticValidationJob)
        .where(SemanticValidationJob.status.in_(_ACTIVE_JOB_STATUSES))
        .order_by(SemanticValidationJob.created_at)
        .with_for_update()
    )
    jobs = list(result.scalars())
    now = _utcnow()
    recoverable_jobs = [job for job in jobs if _lease_expired(job, now=now)]
    for job in recoverable_jobs:
        item_result = await db.execute(
            select(SemanticValidationJobItem).where(
                SemanticValidationJobItem.job_id == job.id,
                SemanticValidationJobItem.status == "running",
            )
        )
        for item in item_result.scalars():
            item.status = "queued"
            item.code = None
            item.facts = {}
            item.details = _details(
                "semantic_validation_recovered",
                "验证服务重启后已恢复等待执行。",
            )
            item.started_at = None
            item.completed_at = None
        job.status = "queued"
        job.completed_at = None
        job.details = {
            **_lease_details(
                job.details,
                code="semantic_validation_recovered",
                worker_id=None,
                heartbeat_at=None,
            ),
            "message": "验证服务重启后已恢复作业。",
            "recovered_at": now.isoformat(),
        }
    await db.flush()
    return [job.id for job in recoverable_jobs]


async def retry_semantic_validation_job(
    db: AsyncSession,
    *,
    project_id: UUID,
    job_id: UUID,
) -> SemanticValidationJob:
    """Restart stale active work or create a new revision-pinned retry job.

    A terminal job remains immutable audit history. Failed and unfinished
    entries are pinned again in a new job, while a stale active job can safely
    keep its existing item identities and partial progress.
    """

    result = await db.execute(
        select(SemanticValidationJob)
        .where(
            SemanticValidationJob.id == job_id,
            SemanticValidationJob.project_id == project_id,
        )
        .with_for_update()
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise SemanticValidationQueueError(
            "semantic_validation_job_not_found",
            "没有找到这次验证作业。",
            details={"job_id": str(job_id)},
        )

    details = dict(job.details or {})
    prior_retry_id = details.get("retry_job_id")
    if prior_retry_id:
        try:
            parsed_retry_id = UUID(str(prior_retry_id))
        except ValueError:
            parsed_retry_id = None
        if parsed_retry_id is not None:
            prior_retry = await db.get(SemanticValidationJob, parsed_retry_id)
            if prior_retry is not None and prior_retry.project_id == project_id:
                return prior_retry

    now = _utcnow()
    if job.status in _ACTIVE_JOB_STATUSES:
        if not _lease_expired(job, now=now):
            raise SemanticValidationQueueError(
                "semantic_validation_job_active",
                "验证仍在执行，请稍后再试。",
            )
        item_result = await db.execute(
            select(SemanticValidationJobItem).where(
                SemanticValidationJobItem.job_id == job.id,
                SemanticValidationJobItem.status == "running",
            )
        )
        for item in item_result.scalars():
            item.status = "queued"
            item.code = None
            item.facts = {}
            item.details = _details(
                "semantic_validation_retry_queued",
                "验证已重新排队。",
            )
            item.started_at = None
            item.completed_at = None
        job.status = "queued"
        job.cancel_requested = False
        job.completed_at = None
        job.details = {
            **_lease_details(
                details,
                code="semantic_validation_retry_queued",
                worker_id=None,
                heartbeat_at=None,
            ),
            "message": "未完成的验证已重新排队。",
            "retried_at": now.isoformat(),
        }
        await db.flush()
        return job

    if job.status not in {"completed", "failed"}:
        raise SemanticValidationQueueError(
            "semantic_validation_retry_unavailable",
            "当前没有可重试的验证项。",
            details={"job_id": str(job.id), "status": job.status},
        )

    retryable_statuses = (
        ("failed",) if job.status == "completed" else ("queued", "running", "failed")
    )
    item_result = await db.execute(
        select(SemanticValidationJobItem)
        .where(
            SemanticValidationJobItem.job_id == job.id,
            SemanticValidationJobItem.status.in_(retryable_statuses),
        )
        .order_by(
            SemanticValidationJobItem.created_at,
            SemanticValidationJobItem.id,
        )
    )
    retry_items = list(item_result.scalars())
    if not retry_items:
        if job.status == "failed":
            # The worker may have failed only while finalizing an otherwise
            # terminal set. Re-run finalization without replacing audit items.
            job.status = "queued"
            job.cancel_requested = False
            job.completed_at = None
            job.details = {
                **_lease_details(
                    details,
                    code="semantic_validation_retry_queued",
                    worker_id=None,
                    heartbeat_at=None,
                ),
                "message": "验证结果已重新进入收尾。",
                "retried_at": now.isoformat(),
            }
            await db.flush()
            return job
        raise SemanticValidationQueueError(
            "semantic_validation_retry_unavailable",
            "当前没有可重试的失败项。",
            details={"job_id": str(job.id), "status": job.status},
        )

    entry_ids = [item.semantic_entry_id for item in retry_items]
    entry_result = await db.execute(
        select(SemanticEntry)
        .where(
            SemanticEntry.project_id == project_id,
            SemanticEntry.id.in_(entry_ids),
        )
        .with_for_update()
    )
    entries_by_id = {entry.id: entry for entry in entry_result.scalars()}
    entries: list[SemanticEntry] = []
    for item in retry_items:
        entry = entries_by_id.get(item.semantic_entry_id)
        if entry is None or stable_payload_hash(entry.definition) != item.definition_hash:
            raise SemanticValidationQueueError(
                "semantic_validation_target_changed",
                "待验证定义已经变化，请从当前版本重新发起验证。",
                details={"entry_id": str(item.semantic_entry_id)},
            )
        entries.append(entry)

    retry_job_id = _retry_validation_job_id(job.id)
    existing_retry = await _existing_retry_child(
        db,
        project_id=project_id,
        original_job_id=job.id,
        retry_job_id=retry_job_id,
    )
    if existing_retry is not None:
        return existing_retry
    try:
        retry_job = await queue_semantic_validation_job(
            db,
            project_id=project_id,
            entries=entries,
            reason=job.reason or "重试未完成的独立验证",
            job_id=retry_job_id,
        )
    except IntegrityError:
        await db.rollback()
        existing_retry = await _wait_for_retry_child(
            db,
            project_id=project_id,
            original_job_id=job_id,
            retry_job_id=retry_job_id,
        )
        if existing_retry is not None:
            return existing_retry
        raise SemanticValidationQueueError(
            "semantic_validation_retry_conflict",
            "验证状态刚刚发生变化，请稍后重试。",
        ) from None
    except OperationalError as exc:
        if not _is_sqlite_busy_error(db, exc):
            raise
        await db.rollback()
        existing_retry = await _wait_for_retry_child(
            db,
            project_id=project_id,
            original_job_id=job_id,
            retry_job_id=retry_job_id,
        )
        if existing_retry is not None:
            return existing_retry
        raise SemanticValidationQueueError(
            "semantic_validation_retry_conflict",
            "验证状态刚刚发生变化，请稍后重试。",
        ) from None
    retry_job.requested_by = "retry"
    retry_job.details = {
        **dict(retry_job.details or {}),
        "retry_of_job_id": str(job.id),
    }
    job.details = {
        **_lease_details(
            details,
            code=str(details.get("code") or f"semantic_validation_{job.status}"),
            worker_id=None,
            heartbeat_at=None,
        ),
        "retry_job_id": str(retry_job.id),
        "retryable": False,
    }
    await db.flush()
    return retry_job


async def run_semantic_validation_job(
    job_id: UUID,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
) -> None:
    """Atomically claim and run queued items with a short renewable lease."""

    factory = _session_factory(session_factory)
    worker_id = f"semantic-validation:{uuid4()}"
    claimed = False
    try:
        item_ids = await _claim_validation_job_with_retry(
            factory,
            job_id=job_id,
            worker_id=worker_id,
        )
        if item_ids is None:
            return
        claimed = True
        for item_id in item_ids:
            await _heartbeat_validation_job(
                factory,
                job_id=job_id,
                worker_id=worker_id,
            )
            await _run_validation_item(
                factory,
                job_id=job_id,
                item_id=item_id,
                worker_id=worker_id,
            )
        await _finish_validation_job(
            factory,
            job_id=job_id,
            worker_id=worker_id,
        )
    except _ValidationLeaseLostError:
        return
    except Exception as exc:  # job-level containment; item errors are handled below
        logger.exception(
            "Semantic validation job failed",
            job_id=str(job_id),
            error_type=type(exc).__name__,
        )
        async with factory() as db:
            job = await db.get(SemanticValidationJob, job_id)
            if (
                job is not None
                and job.status in _ACTIVE_JOB_STATUSES
                and (
                    _lease_owner(job) == worker_id
                    or (not claimed and job.status == "queued" and _lease_owner(job) is None)
                )
            ):
                job.status = "failed"
                job.completed_at = _utcnow()
                job.details = {
                    **_lease_details(
                        job.details,
                        code="semantic_validation_job_failed",
                        worker_id=None,
                        heartbeat_at=job.completed_at,
                    ),
                    "message": "验证作业未能完成；尚未验证的项目保持原状。",
                    "error_type": type(exc).__name__,
                    "retryable": True,
                }
                await db.commit()
        return


async def _claim_validation_job_with_retry(
    factory: async_sessionmaker[AsyncSession],
    *,
    job_id: UUID,
    worker_id: str,
) -> list[UUID] | None:
    """Absorb short metadata-database contention at the claim boundary."""

    delays = (0.0, 0.1, 0.3, 1.0)
    for attempt, delay in enumerate(delays):
        if delay:
            await asyncio.sleep(delay)
        try:
            return await _claim_validation_job(
                factory,
                job_id=job_id,
                worker_id=worker_id,
            )
        except Exception:  # noqa: BLE001 - retry only the short claim transaction
            if attempt == len(delays) - 1:
                raise
            logger.info(
                "Semantic validation claim will retry",
                job_id=str(job_id),
                attempt=attempt + 1,
            )
    return None


async def _claim_validation_job(
    factory: async_sessionmaker[AsyncSession],
    *,
    job_id: UUID,
    worker_id: str,
) -> list[UUID] | None:
    """Use one compare-and-set UPDATE so duplicate schedulers cannot both claim."""

    async with factory() as db:
        claim = await db.execute(
            update(SemanticValidationJob)
            .where(
                SemanticValidationJob.id == job_id,
                SemanticValidationJob.status == "queued",
            )
            .values(status="running")
        )
        if getattr(claim, "rowcount", 0) != 1:
            await db.rollback()
            return None
        job = await db.get(SemanticValidationJob, job_id)
        if job is None:  # pragma: no cover - claimed row cannot disappear in transaction
            await db.rollback()
            return None
        now = _utcnow()
        job.started_at = job.started_at or now
        job.completed_at = None
        job.details = {
            **_lease_details(
                job.details,
                code="semantic_validation_running",
                worker_id=worker_id,
                heartbeat_at=now,
            ),
            "message": "独立验证作业正在执行。",
        }
        item_result = await db.execute(
            select(SemanticValidationJobItem.id)
            .where(
                SemanticValidationJobItem.job_id == job.id,
                SemanticValidationJobItem.status == "queued",
            )
            .order_by(
                SemanticValidationJobItem.created_at,
                SemanticValidationJobItem.id,
            )
        )
        item_ids = list(item_result.scalars())
        await db.commit()
        return item_ids


async def _heartbeat_validation_job(
    factory: async_sessionmaker[AsyncSession],
    *,
    job_id: UUID,
    worker_id: str,
) -> None:
    async with factory() as db:
        result = await db.execute(
            select(SemanticValidationJob)
            .where(SemanticValidationJob.id == job_id)
            .with_for_update()
        )
        job = result.scalar_one_or_none()
        if job is None or job.status != "running" or _lease_owner(job) != worker_id:
            raise _ValidationLeaseLostError()
        now = _utcnow()
        job.details = _lease_details(
            job.details,
            code="semantic_validation_running",
            worker_id=worker_id,
            heartbeat_at=now,
        )
        await db.commit()


async def _refresh_owned_validation_job(
    db: AsyncSession,
    job: SemanticValidationJob,
    *,
    worker_id: str,
    lock: bool = False,
) -> None:
    if lock:
        result = await db.execute(
            select(SemanticValidationJob)
            .where(SemanticValidationJob.id == job.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if result.scalar_one_or_none() is None:
            raise _ValidationLeaseLostError()
    else:
        await db.refresh(
            job,
            attribute_names=["status", "cancel_requested", "details"],
        )
    if job.status != "running" or _lease_owner(job) != worker_id:
        raise _ValidationLeaseLostError()


async def _finish_validation_job(
    factory: async_sessionmaker[AsyncSession],
    *,
    job_id: UUID,
    worker_id: str,
) -> None:
    async with factory() as db:
        result = await db.execute(
            select(SemanticValidationJob)
            .where(SemanticValidationJob.id == job_id)
            .with_for_update()
        )
        job = result.scalar_one_or_none()
        if job is None or job.status != "running" or _lease_owner(job) != worker_id:
            raise _ValidationLeaseLostError()
        item_result = await db.execute(
            select(SemanticValidationJobItem.status).where(
                SemanticValidationJobItem.job_id == job.id
            )
        )
        counts = Counter(item_result.scalars())
        if counts["queued"] or counts["running"]:
            raise RuntimeError("semantic validation job still has active items")
        job.status = "completed"
        job.completed_at = _utcnow()
        job.details = {
            **_lease_details(
                job.details,
                code="semantic_validation_completed",
                worker_id=None,
                heartbeat_at=job.completed_at,
            ),
            "message": "独立验证作业已逐项完成。",
            "verified": counts["verified"],
            "blocked": counts["blocked"],
            "failed": counts["failed"],
            "retryable": counts["failed"] > 0,
        }
        await db.commit()


async def _run_validation_item(
    factory: async_sessionmaker[AsyncSession],
    *,
    job_id: UUID,
    item_id: UUID,
    worker_id: str,
) -> None:
    async with factory() as db:
        result = await db.execute(
            select(SemanticValidationJob)
            .where(SemanticValidationJob.id == job_id)
            .with_for_update()
        )
        job = result.scalar_one_or_none()
        item = await db.get(SemanticValidationJobItem, item_id)
        if job is None or _lease_owner(job) != worker_id or job.status != "running":
            raise _ValidationLeaseLostError()
        if item is None or item.status != "queued":
            return
        if job.cancel_requested:
            await _finish_without_entry_mutation(
                db,
                item,
                status="blocked",
                code="semantic_validation_cancelled",
                message="验证作业已取消，未执行该候选。",
            )
            await db.commit()
            return
        item.status = "running"
        item.started_at = _utcnow()
        item.details = _details("semantic_validation_running", "正在执行只读验证。")
        job.details = _lease_details(
            job.details,
            code="semantic_validation_running",
            worker_id=worker_id,
            heartbeat_at=item.started_at,
        )
        await db.commit()

    async with factory() as db:
        item = await db.get(SemanticValidationJobItem, item_id)
        job = await db.get(SemanticValidationJob, job_id)
        if item is None or job is None:
            return
        if item.status != "running":
            return
        await _refresh_owned_validation_job(db, job, worker_id=worker_id)
        entry = await db.get(SemanticEntry, item.semantic_entry_id)
        revision = await db.get(SemanticEntryRevision, item.semantic_revision_id)
        drift_code = _revision_drift_code(entry, revision, item)
        if drift_code is not None:
            await _refresh_owned_validation_job(
                db,
                job,
                worker_id=worker_id,
                lock=True,
            )
            await _finish_without_entry_mutation(
                db,
                item,
                status="blocked",
                code=drift_code,
                message="候选当前版本已经变化，本作业没有覆盖新版本。",
            )
            await db.commit()
            return
        assert entry is not None
        try:
            facts = await asyncio.wait_for(
                _validate_entry(db, entry),
                timeout=VALIDATION_TIMEOUT_SECONDS + 1.0,
            )
            await _refresh_owned_validation_job(
                db,
                job,
                worker_id=worker_id,
                lock=True,
            )
            if job.cancel_requested:
                raise _BlockedValidation(
                    "semantic_validation_cancelled",
                    "验证作业已取消，结果未写入当前候选。",
                )
            await _finish_entry_result(
                db,
                entry=entry,
                item=item,
                status="verified",
                code="semantic_validation_verified",
                message="当前定义已通过独立只读验证。",
                facts=facts,
            )
        except _BlockedValidation as exc:
            await _refresh_owned_validation_job(
                db,
                job,
                worker_id=worker_id,
                lock=True,
            )
            await _finish_entry_result(
                db,
                entry=entry,
                item=item,
                status="blocked",
                code=exc.code,
                message=str(exc),
                facts=exc.facts,
            )
        except TimeoutError:
            await _refresh_owned_validation_job(
                db,
                job,
                worker_id=worker_id,
                lock=True,
            )
            await _finish_entry_result(
                db,
                entry=entry,
                item=item,
                status="blocked",
                code="semantic_validation_timeout",
                message="只读验证在单项时限内未完成，未将候选标为已验证。",
                facts={"timeout_seconds": VALIDATION_TIMEOUT_SECONDS},
            )
        except SemanticRevisionConflictError:
            await db.rollback()
            job = await db.get(SemanticValidationJob, job_id)
            item = await db.get(SemanticValidationJobItem, item_id)
            if job is None:
                return
            await _refresh_owned_validation_job(
                db,
                job,
                worker_id=worker_id,
                lock=True,
            )
            if item is not None and item.status == "running":
                await _finish_without_entry_mutation(
                    db,
                    item,
                    status="blocked",
                    code="semantic_revision_drift",
                    message="验证写回前候选版本发生变化，未覆盖新版本。",
                )
        except _ValidationLeaseLostError:
            await db.rollback()
            return
        except Exception as exc:
            await _refresh_owned_validation_job(
                db,
                job,
                worker_id=worker_id,
                lock=True,
            )
            await _finish_entry_result(
                db,
                entry=entry,
                item=item,
                status="failed",
                code="semantic_validation_query_failed",
                message="只读验证查询失败，候选没有被标为已验证。",
                facts={"error_type": type(exc).__name__},
            )
        await db.commit()


def _revision_drift_code(
    entry: SemanticEntry | None,
    revision: SemanticEntryRevision | None,
    item: SemanticValidationJobItem,
) -> str | None:
    if entry is None or revision is None:
        return "semantic_validation_target_missing"
    if (
        revision.semantic_entry_id != entry.id
        or revision.project_id != entry.project_id
        or entry.active_revision_id != revision.id
        or revision.snapshot != semantic_entry_snapshot(entry)
    ):
        return "semantic_revision_drift"
    if stable_payload_hash(entry.definition) != item.definition_hash:
        return "semantic_definition_drift"
    return None


async def _finish_without_entry_mutation(
    db: AsyncSession,
    item: SemanticValidationJobItem,
    *,
    status: str,
    code: str,
    message: str,
    facts: dict[str, Any] | None = None,
) -> None:
    item.status = status
    item.code = code
    item.facts = facts or {}
    item.details = _details(code, message)
    item.completed_at = _utcnow()
    await db.flush()


async def _finish_entry_result(
    db: AsyncSession,
    *,
    entry: SemanticEntry,
    item: SemanticValidationJobItem,
    status: str,
    code: str,
    message: str,
    facts: dict[str, Any],
) -> None:
    completed_at = _utcnow()
    item.status = status
    item.code = code
    item.facts = facts
    item.details = _details(code, message)
    item.completed_at = completed_at
    entry.execution_state = "verified" if status == "verified" else "blocked"
    entry.validity = "active" if status == "verified" else "unverified"
    entry.execution_details = _details(
        code,
        message,
        status=status,
        validation_job_id=str(item.job_id),
        validation_item_id=str(item.id),
        last_validation_job_id=(str(item.job_id) if status == "verified" else None),
        last_validation_item_id=(str(item.id) if status == "verified" else None),
        definition_hash=item.definition_hash,
        facts=facts,
        verified_at=completed_at.isoformat() if status == "verified" else None,
    )
    entry.evidence = [
        *list(entry.evidence or []),
        {
            "kind": "semantic_validation_result",
            "status": status,
            "code": code,
            "semantic_entry_id": str(entry.id),
            "validation_job_id": str(item.job_id),
            "validation_item_id": str(item.id),
            "validated_revision_id": str(item.semantic_revision_id),
            "definition_hash": item.definition_hash,
            "facts": facts,
            "recorded_at": completed_at.isoformat(),
        },
    ]
    await append_semantic_revision(
        db,
        entry,
        mutation_kind=("execution_verified" if status == "verified" else "validation_blocked"),
        actor_source="system",
        reason=message,
        expected_active_revision_id=item.semantic_revision_id,
    )


async def _validate_entry(db: AsyncSession, entry: SemanticEntry) -> dict[str, Any]:
    definition = entry.definition if isinstance(entry.definition, dict) else {}
    kind = str(definition.get("kind") or "")
    if entry.entry_type == "metric" and kind == "aggregate_metric":
        return await _validate_aggregate_metric(db, entry.project_id, definition)
    if entry.entry_type == "metric" and kind == "derived_metric":
        return await _validate_derived_metric(db, entry.project_id, definition)
    if entry.entry_type == "dimension" and kind == "dimension":
        return await _validate_dimension(db, entry.project_id, definition)
    if entry.entry_type == "relationship" and (
        kind == "relationship" or ("left" in definition and "right" in definition)
    ):
        return await _validate_relationship(db, entry.project_id, definition)
    raise _BlockedValidation(
        "semantic_definition_unsupported",
        "当前 typed definition 不能由独立验证服务安全执行。",
        facts={"entry_type": entry.entry_type, "definition_kind": kind or "raw"},
    )


async def _project_sources(
    db: AsyncSession,
    project_id: UUID,
) -> list[tuple[ProjectDataSource, Connection | None]]:
    result = await db.execute(
        select(ProjectDataSource, Connection)
        .outerjoin(Connection, Connection.id == ProjectDataSource.connection_id)
        .where(
            ProjectDataSource.project_id == project_id,
            ProjectDataSource.status != "superseded",
        )
    )
    return [
        (source, connection)
        for source, connection in result.all()
        if (source.profile_data or {}).get("is_current") is not False
    ]


async def _resolve_binding(
    db: AsyncSession,
    project_id: UUID,
    binding: Mapping[str, Any],
) -> tuple[ProjectDataSource, Connection | None]:
    required = {
        "source_logical_name",
        "source_kind",
        "table_or_view",
        "action_column",
        "canonical_type",
        "schema_signature",
    }
    if not required.issubset(binding):
        raise _BlockedValidation(
            "semantic_binding_incomplete",
            "定义缺少稳定数据绑定，无法安全验证。",
        )
    expected = {key: str(binding[key]) for key in required}
    matches: list[tuple[ProjectDataSource, Connection | None]] = []
    for source, connection in await _project_sources(db, project_id):
        payload = {
            "id": str(source.id),
            "kind": source.kind,
            "profile": dict(source.profile_data or {}),
        }
        candidates = stable_field_binding_candidates(
            payload,
            str(binding["action_column"]),
        )
        if any(
            all(str(candidate.get(key)) == value for key, value in expected.items())
            for candidate in candidates
        ):
            matches.append((source, connection))
    if len(matches) != 1:
        raise _BlockedValidation(
            "semantic_binding_unresolved" if not matches else "semantic_binding_ambiguous",
            "稳定数据绑定当前无法唯一解析，未执行验证。",
            facts={"matching_sources": len(matches)},
        )
    return matches[0]


def _identifier(value: str, quote: Callable[[str], str]) -> str:
    if not value or "\x00" in value:
        raise _BlockedValidation("semantic_identifier_invalid", "定义包含无效字段标识。")
    return quote(value)


def _file_quote(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _duckdb_relation(path: str) -> str:
    escaped = path.replace("'", "''")
    return f"read_parquet('{escaped}')"


def _run_duckdb_query(sql: str, timeout_seconds: float) -> dict[str, Any]:
    import duckdb

    connection = duckdb.connect(database=":memory:")
    timer = threading.Timer(timeout_seconds, connection.interrupt)
    timer.daemon = True
    timer.start()
    try:
        cursor = connection.execute(sql)
        row = cursor.fetchone()
        if row is None:
            return {}
        return {column[0]: _json_value(value) for column, value in zip(cursor.description, row)}
    finally:
        timer.cancel()
        connection.close()


def _json_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, bool)):
        return value
    if isinstance(value, float):
        return round(value, 8)
    if hasattr(value, "isoformat"):
        return value.isoformat()
    try:
        return float(value)
    except (TypeError, ValueError):
        return str(value)


async def _execute_source_query(
    source: ProjectDataSource,
    connection: Connection | None,
    *,
    sql_builder: Callable[[Callable[[str], str], str], str],
) -> dict[str, Any]:
    if source.kind == "file":
        if not source.working_uri or not Path(source.working_uri).is_file():
            raise _BlockedValidation(
                "semantic_working_copy_unavailable",
                "可信数据副本当前不可用，未执行验证。",
            )
        sql = sql_builder(_file_quote, _duckdb_relation(source.working_uri))
        return await asyncio.to_thread(_run_duckdb_query, sql, VALIDATION_TIMEOUT_SECONDS)
    if connection is None:
        raise _BlockedValidation(
            "semantic_connection_unavailable",
            "数据库连接当前不可用，未执行验证。",
        )
    password = (
        encryptor.decrypt(connection.password_encrypted) if connection.password_encrypted else ""
    )
    manager = create_database_manager(
        {
            "driver": connection.driver,
            "host": connection.host,
            "port": connection.port,
            "user": connection.username,
            "password": password,
            "database": connection.database_name,
            "extra_options": connection.extra_options or {},
        }
    )
    quote = manager._adapter.quote_identifier
    table = _identifier(str(sql_builder.__dict__["table"]), quote)
    sql = sql_builder(quote, table)
    cancellation_event = threading.Event()
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(
                manager.execute_query,
                sql,
                True,
                1,
                cancellation_event=cancellation_event,
                timeout_seconds=VALIDATION_TIMEOUT_SECONDS,
            ),
            timeout=VALIDATION_TIMEOUT_SECONDS,
        )
    except TimeoutError as exc:
        cancellation_event.set()
        raise _BlockedValidation(
            "semantic_validation_timeout",
            "在线数据库只读验证超时，未将候选标为已验证。",
            facts={"timeout_seconds": VALIDATION_TIMEOUT_SECONDS},
        ) from exc
    return {
        key: _json_value(value) for key, value in (result.data[0] if result.data else {}).items()
    }


def _table_query_builder(table: str, factory: Callable[[Callable[[str], str], str], str]):
    factory.__dict__["table"] = table
    return factory


async def _validate_aggregate_metric(
    db: AsyncSession,
    project_id: UUID,
    definition: dict[str, Any],
) -> dict[str, Any]:
    binding = definition.get("source")
    if not isinstance(binding, dict) or binding.get("canonical_type") != "number":
        raise _BlockedValidation(
            "metric_binding_not_numeric",
            "指标没有绑定到可验证的数值字段。",
        )
    source, connection = await _resolve_binding(db, project_id, binding)
    operation = str(definition.get("operation") or "")
    if operation not in {"sum", "avg"}:
        raise _BlockedValidation("metric_operation_unsupported", "指标汇总方式不受支持。")

    def build(quote: Callable[[str], str], relation: str) -> str:
        column = _identifier(str(binding["action_column"]), quote)
        aggregate = "SUM" if operation == "sum" else "AVG"
        return (
            f"SELECT COUNT(*) AS total_rows, COUNT({column}) AS non_null_rows, "
            f"{aggregate}({column}) AS aggregate_value FROM {relation}"
        )

    stats = await _execute_source_query(
        source,
        connection,
        sql_builder=_table_query_builder(str(binding["table_or_view"]), build),
    )
    total_rows = int(stats.get("total_rows") or 0)
    non_null_rows = int(stats.get("non_null_rows") or 0)
    if total_rows <= 0 or non_null_rows <= 0 or stats.get("aggregate_value") is None:
        raise _BlockedValidation(
            "metric_probe_has_no_values",
            "指标字段在完整探测中没有可汇总数值。",
            facts=stats,
        )
    return {"check": "aggregate_metric_probe", "operation": operation, **stats}


def _formula_sql(
    node: Mapping[str, Any],
    *,
    quote: Callable[[str], str],
    null_policy: str,
    divide_by_zero: str,
) -> str:
    operation = node.get("op")
    if operation == "decimal":
        return str(node["value"])
    if operation == "column":
        column = _identifier(str(node["name"]), quote)
        return f"COALESCE({column}, 0)" if null_policy == "zero" else column
    if operation == "negate":
        return f"(-({_formula_sql(node['operand'], quote=quote, null_policy=null_policy, divide_by_zero=divide_by_zero)}))"
    left = _formula_sql(
        node["left"], quote=quote, null_policy=null_policy, divide_by_zero=divide_by_zero
    )
    right = _formula_sql(
        node["right"], quote=quote, null_policy=null_policy, divide_by_zero=divide_by_zero
    )
    operators = {"add": "+", "subtract": "-", "multiply": "*", "divide": "/"}
    if operation not in operators:
        raise _BlockedValidation("derived_metric_formula_invalid", "派生指标公式包含不支持的操作。")
    if operation == "divide" and divide_by_zero == "null":
        right = f"NULLIF(({right}), 0)"
    return f"(({left}) {operators[operation]} ({right}))"


async def _validate_derived_metric(
    db: AsyncSession,
    project_id: UUID,
    definition: dict[str, Any],
) -> dict[str, Any]:
    formula = definition.get("formula")
    bindings = definition.get("sources")
    if not isinstance(formula, dict) or not isinstance(bindings, list) or not bindings:
        raise _BlockedValidation("derived_metric_definition_incomplete", "派生指标定义不完整。")
    columns = set(metric_formula_columns(formula))
    if columns != {str(item.get("action_column")) for item in bindings if isinstance(item, dict)}:
        raise _BlockedValidation("derived_metric_binding_mismatch", "公式字段与稳定绑定不一致。")
    if any(
        not isinstance(item, dict) or item.get("canonical_type") != "number" for item in bindings
    ):
        raise _BlockedValidation("derived_metric_binding_not_numeric", "派生指标只能引用数值字段。")
    resolved = [await _resolve_binding(db, project_id, item) for item in bindings]
    if len({source.id for source, _connection in resolved}) != 1:
        raise _BlockedValidation(
            "derived_metric_cross_source", "派生指标字段没有解析到同一数据源。"
        )
    tables = {str(item.get("table_or_view")) for item in bindings}
    signatures = {str(item.get("schema_signature")) for item in bindings}
    if len(tables) != 1 or len(signatures) != 1:
        raise _BlockedValidation("derived_metric_cross_table", "派生指标字段必须属于同一张表。")
    aggregate = str(definition.get("aggregate") or "")
    if aggregate not in {"sum", "avg"}:
        raise _BlockedValidation(
            "derived_metric_aggregate_unsupported", "派生指标汇总方式不受支持。"
        )
    source, connection = resolved[0]

    def build(quote: Callable[[str], str], relation: str) -> str:
        expression = _formula_sql(
            formula["expression"],
            quote=quote,
            null_policy=str(formula.get("null_policy") or "propagate"),
            divide_by_zero=str(formula.get("divide_by_zero") or "error"),
        )
        aggregate_sql = "SUM" if aggregate == "sum" else "AVG"
        null_checks = " + ".join(
            f"CASE WHEN {_identifier(column, quote)} IS NULL THEN 1 ELSE 0 END"
            for column in sorted(columns)
        )
        return (
            f"SELECT COUNT(*) AS total_rows, COUNT({expression}) AS computed_rows, "
            f"{aggregate_sql}({expression}) AS aggregate_value, "
            f"SUM({null_checks}) AS source_nulls FROM {relation}"
        )

    stats = await _execute_source_query(
        source,
        connection,
        sql_builder=_table_query_builder(next(iter(tables)), build),
    )
    if str(formula.get("null_policy")) == "error" and int(stats.get("source_nulls") or 0):
        raise _BlockedValidation(
            "derived_metric_null_policy_failed",
            "完整数据包含空值，不满足派生指标的 error 空值策略。",
            facts=stats,
        )
    if int(stats.get("total_rows") or 0) <= 0 or int(stats.get("computed_rows") or 0) <= 0:
        raise _BlockedValidation(
            "derived_metric_has_no_values", "派生指标没有可执行的完整数据行。", facts=stats
        )
    return {"check": "derived_metric_probe", "aggregate": aggregate, **stats}


async def _validate_dimension(
    db: AsyncSession,
    project_id: UUID,
    definition: dict[str, Any],
) -> dict[str, Any]:
    binding = definition.get("source")
    role = str(definition.get("role") or "")
    if not isinstance(binding, dict) or role not in {"time", "category", "identifier"}:
        raise _BlockedValidation("dimension_definition_incomplete", "维度定义不完整。")
    source, connection = await _resolve_binding(db, project_id, binding)

    def build(quote: Callable[[str], str], relation: str) -> str:
        column = _identifier(str(binding["action_column"]), quote)
        return (
            f"SELECT COUNT(*) AS total_rows, COUNT({column}) AS non_null_rows, "
            f"COUNT(DISTINCT {column}) AS distinct_values, "
            f"MIN({column}) AS min_value, MAX({column}) AS max_value FROM {relation}"
        )

    stats = await _execute_source_query(
        source,
        connection,
        sql_builder=_table_query_builder(str(binding["table_or_view"]), build),
    )
    total_rows = int(stats.get("total_rows") or 0)
    non_null_rows = int(stats.get("non_null_rows") or 0)
    if total_rows <= 0 or non_null_rows <= 0:
        raise _BlockedValidation(
            "dimension_probe_has_no_values", "维度字段没有可验证值。", facts=stats
        )
    stats["uniqueness"] = round(int(stats.get("distinct_values") or 0) / non_null_rows, 8)
    return {"check": "dimension_probe", "role": role, **stats}


async def _resolve_relationship_endpoint(
    db: AsyncSession,
    project_id: UUID,
    endpoint: Mapping[str, Any],
) -> tuple[ProjectDataSource, Connection | None]:
    required = {
        "source_logical_name",
        "source_kind",
        "table_or_view",
        "column",
        "schema_signature",
    }
    if not required.issubset(endpoint):
        raise _BlockedValidation("relationship_binding_incomplete", "关联端点绑定不完整。")
    matches: list[tuple[ProjectDataSource, Connection | None]] = []
    for source, connection in await _project_sources(db, project_id):
        profile = dict(source.profile_data or {})
        if source.kind != str(endpoint["source_kind"]) or str(
            profile.get("logical_name") or ""
        ) != str(endpoint["source_logical_name"]):
            continue
        if source.kind == "file":
            table_name = str(profile.get("logical_name") or "")
            schema = profile.get("schema")
            columns = list(schema.get("columns") or []) if isinstance(schema, dict) else []
        else:
            table_name = str(endpoint["table_or_view"])
            table = next(
                (
                    item
                    for item in profile.get("tables") or []
                    if isinstance(item, dict) and str(item.get("name") or "") == table_name
                ),
                None,
            )
            columns = list(table.get("columns") or []) if isinstance(table, dict) else []
        if table_name != str(endpoint["table_or_view"]):
            continue
        if not any(str(item.get("name") or "") == str(endpoint["column"]) for item in columns):
            continue
        signature_payload = json.dumps(
            sorted(
                [
                    {
                        "name": str(column.get("name") or ""),
                        "type": str(column.get("type") or column.get("dtype") or "unknown"),
                    }
                    for column in columns
                ],
                key=lambda item: (item["name"], item["type"]),
            ),
            ensure_ascii=False,
            separators=(",", ":"),
        )
        legacy_signature = hashlib.sha256(signature_payload.encode("utf-8")).hexdigest()
        current_signature = stable_schema_signature(columns)
        if str(endpoint["schema_signature"]) in {current_signature, legacy_signature}:
            matches.append((source, connection))
    if len(matches) != 1:
        raise _BlockedValidation(
            "relationship_binding_unresolved" if not matches else "relationship_binding_ambiguous",
            "关联端点当前无法唯一解析，未执行验证。",
            facts={"matching_sources": len(matches)},
        )
    return matches[0]


def _relationship_stats_sql(
    *,
    quote: Callable[[str], str],
    left_relation: str,
    right_relation: str,
    left_column: str,
    right_column: str,
) -> str:
    left = _identifier(left_column, quote)
    right = _identifier(right_column, quote)
    return f"""
        WITH left_keys AS (
            SELECT {left} AS join_key, COUNT(*) AS key_count
            FROM {left_relation} WHERE {left} IS NOT NULL GROUP BY {left}
        ), right_keys AS (
            SELECT {right} AS join_key, COUNT(*) AS key_count
            FROM {right_relation} WHERE {right} IS NOT NULL GROUP BY {right}
        )
        SELECT
            (SELECT COUNT(*) FROM {left_relation}) AS left_rows,
            (SELECT COUNT({left}) FROM {left_relation}) AS left_non_null,
            (SELECT COUNT(*) FROM {right_relation}) AS right_rows,
            (SELECT COUNT({right}) FROM {right_relation}) AS right_non_null,
            COALESCE((SELECT SUM(l.key_count) FROM left_keys l JOIN right_keys r ON l.join_key = r.join_key), 0) AS matched_left_rows,
            COALESCE((SELECT SUM(l.key_count * r.key_count) FROM left_keys l JOIN right_keys r ON l.join_key = r.join_key), 0) AS joined_rows,
            COALESCE((SELECT MAX(key_count) FROM left_keys), 0) AS max_left_key_count,
            COALESCE((SELECT MAX(key_count) FROM right_keys), 0) AS max_right_key_count
    """


async def _validate_relationship(
    db: AsyncSession,
    project_id: UUID,
    definition: dict[str, Any],
) -> dict[str, Any]:
    left_endpoint = definition.get("left")
    right_endpoint = definition.get("right")
    if not isinstance(left_endpoint, dict) or not isinstance(right_endpoint, dict):
        raise _BlockedValidation("relationship_definition_incomplete", "关联定义缺少左右绑定。")
    normalization = str(definition.get("normalization") or "auto")
    if normalization not in {"exact", "auto"}:
        raise _BlockedValidation(
            "relationship_normalization_unsupported",
            "当前无法在所有目标数据库上完整复现该规范化方式。",
            facts={"normalization": normalization},
        )
    left_source, left_connection = await _resolve_relationship_endpoint(
        db, project_id, left_endpoint
    )
    right_source, right_connection = await _resolve_relationship_endpoint(
        db, project_id, right_endpoint
    )

    if left_source.kind == right_source.kind == "file":
        if not left_source.working_uri or not right_source.working_uri:
            raise _BlockedValidation(
                "semantic_working_copy_unavailable", "关联所需可信副本不可用。"
            )
        sql = _relationship_stats_sql(
            quote=_file_quote,
            left_relation=_duckdb_relation(left_source.working_uri),
            right_relation=_duckdb_relation(right_source.working_uri),
            left_column=str(left_endpoint["column"]),
            right_column=str(right_endpoint["column"]),
        )
        stats = await asyncio.to_thread(_run_duckdb_query, sql, VALIDATION_TIMEOUT_SECONDS)
    elif (
        left_source.kind == right_source.kind == "connection"
        and left_source.connection_id is not None
        and left_source.connection_id == right_source.connection_id
        and left_connection is not None
        and right_connection is not None
    ):
        password = (
            encryptor.decrypt(left_connection.password_encrypted)
            if left_connection.password_encrypted
            else ""
        )
        manager = create_database_manager(
            {
                "driver": left_connection.driver,
                "host": left_connection.host,
                "port": left_connection.port,
                "user": left_connection.username,
                "password": password,
                "database": left_connection.database_name,
                "extra_options": left_connection.extra_options or {},
            }
        )
        quote = manager._adapter.quote_identifier
        sql = _relationship_stats_sql(
            quote=quote,
            left_relation=_identifier(str(left_endpoint["table_or_view"]), quote),
            right_relation=_identifier(str(right_endpoint["table_or_view"]), quote),
            left_column=str(left_endpoint["column"]),
            right_column=str(right_endpoint["column"]),
        )
        cancellation_event = threading.Event()
        try:
            result = await asyncio.wait_for(
                asyncio.to_thread(
                    manager.execute_query,
                    sql,
                    True,
                    1,
                    cancellation_event=cancellation_event,
                    timeout_seconds=VALIDATION_TIMEOUT_SECONDS,
                ),
                timeout=VALIDATION_TIMEOUT_SECONDS,
            )
        except TimeoutError as exc:
            cancellation_event.set()
            raise _BlockedValidation(
                "semantic_validation_timeout",
                "在线数据库关联验证超时，未将候选标为已验证。",
                facts={"timeout_seconds": VALIDATION_TIMEOUT_SECONDS},
            ) from exc
        stats = dict(result.data[0] if result.data else {})
    else:
        raise _BlockedValidation(
            "relationship_scope_unsupported",
            "当前只能完整验证文件之间或同一数据库内的关联。",
        )

    left_rows = int(stats.get("left_rows") or 0)
    left_non_null = int(stats.get("left_non_null") or 0)
    matched_left = int(stats.get("matched_left_rows") or 0)
    inner_joined = int(stats.get("joined_rows") or 0)
    left_match_rate = matched_left / left_non_null if left_non_null else 0.0
    left_joined_rows = inner_joined + max(left_rows - matched_left, 0)
    expansion_ratio = left_joined_rows / left_rows if left_rows else 0.0
    facts = {
        "check": "relationship_full_probe",
        **{key: int(value or 0) for key, value in stats.items()},
        "left_match_rate": round(left_match_rate, 8),
        "expansion_ratio": round(expansion_ratio, 8),
        "normalization": "exact",
    }
    minimum_match = float(definition.get("minimum_left_match_rate", 0.8))
    maximum_expansion = float(definition.get("maximum_expansion_ratio", 1.2))
    cardinality = definition.get("cardinality")
    cardinality_ok = True
    if cardinality in {"many_to_one", "one_to_one"}:
        cardinality_ok = cardinality_ok and facts["max_right_key_count"] <= 1
    if cardinality in {"one_to_many", "one_to_one"}:
        cardinality_ok = cardinality_ok and facts["max_left_key_count"] <= 1
    if (
        left_rows <= 0
        or left_non_null <= 0
        or left_match_rate < minimum_match
        or expansion_ratio > maximum_expansion
        or not cardinality_ok
    ):
        raise _BlockedValidation(
            "relationship_threshold_not_met",
            "完整数据的匹配率、唯一性或行数扩张未达到候选阈值。",
            facts={
                **facts,
                "minimum_left_match_rate": minimum_match,
                "maximum_expansion_ratio": maximum_expansion,
                "cardinality": cardinality,
                "cardinality_ok": cardinality_ok,
            },
        )
    return {
        **facts,
        "minimum_left_match_rate": minimum_match,
        "maximum_expansion_ratio": maximum_expansion,
        "cardinality": cardinality,
        "cardinality_ok": cardinality_ok,
    }
