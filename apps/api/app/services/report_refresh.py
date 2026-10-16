"""Observed source boundary for publishing a refreshed report snapshot."""

from __future__ import annotations

import hashlib
import math
import os
import re
import stat
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import Connection, ProjectDataSource, SanitationRecipeRecord
from app.models.reports import ReportRefreshReceipt, ReportRefreshSourceLabel
from app.models.workspace import AnalysisPlaybookResponse
from app.services.analysis_playbook_runner import (
    AnalysisPlaybookRunnerError,
    bind_analysis_playbook_source,
)
from app.services.checkpoint_contract import stable_payload_hash


class ReportRefreshSourceError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class RefreshSourceState:
    source: dict[str, Any]
    catalog_hash: str
    files: tuple[tuple[str, str], ...] = ()


def refresh_source_label(state: RefreshSourceState) -> ReportRefreshSourceLabel:
    source = state.source
    version = (source.get("profile") or {}).get("version")
    return ReportRefreshSourceLabel(
        source_id=UUID(source["id"]),
        name=source["name"],
        kind=source["kind"],
        data_version=version if type(version) is int and version > 0 else None,
    )


def valid_refresh_receipt(
    source_ref: dict[str, Any],
    content: dict[str, Any],
) -> ReportRefreshReceipt | None:
    """A refresh receipt describes exact saved content, not later manual edits."""

    try:
        receipt = ReportRefreshReceipt.model_validate(source_ref.get("refresh_receipt"))
    except ValueError:
        return None
    return receipt if receipt.content_hash == refresh_content_hash(content) else None


def refresh_content_hash(content: dict[str, Any]) -> str:
    """Match JSON's safe integral numbers across the browser's 120.0 -> 120 round trip."""

    def normalize(value: Any) -> Any:
        if (
            isinstance(value, float)
            and math.isfinite(value)
            and value.is_integer()
            and abs(value) <= 2**53 - 1
        ):
            return int(value)
        if isinstance(value, list):
            return [normalize(item) for item in value]
        if isinstance(value, dict):
            return {key: normalize(item) for key, item in value.items()}
        return value

    return stable_payload_hash(normalize(content))


def preserve_refresh_receipt(
    source_ref: dict[str, Any],
    previous_ref: dict[str, Any],
    content: dict[str, Any],
) -> dict[str, Any]:
    result = {key: value for key, value in source_ref.items() if key != "refresh_receipt"}
    receipt = valid_refresh_receipt(previous_ref, content)
    if receipt is not None:
        result["refresh_receipt"] = receipt.model_dump(mode="json")
    return result


def _source_payload(source: ProjectDataSource) -> dict[str, Any]:
    return {
        "id": str(source.id),
        "name": source.name,
        "kind": source.kind,
        "format": source.format,
        "status": source.status,
        "fingerprint": source.fingerprint,
        "source_uri": source.source_uri,
        "working_uri": source.working_uri,
        "profile": deepcopy(source.profile_data or {}),
    }


async def capture_refresh_source(
    db: AsyncSession, project_id: UUID, playbook: AnalysisPlaybookResponse
) -> RefreshSourceState:
    # Include pending replacements: the runtime prompt deliberately omits them,
    # but publication must not mistake that omission for an unambiguous binding.
    rows = list(
        (
            await db.scalars(
                select(ProjectDataSource)
                .where(ProjectDataSource.project_id == project_id)
                .execution_options(populate_existing=True)
            )
        ).all()
    )
    try:
        bound, _ = bind_analysis_playbook_source(playbook, [_source_payload(row) for row in rows])
    except AnalysisPlaybookRunnerError as exc:
        raise ReportRefreshSourceError("report_refresh_source_unavailable") from exc
    row = next(row for row in rows if str(row.id) == bound["id"])
    contract: dict[str, Any] = {"source": bound, "updated_at": row.updated_at}
    files: tuple[tuple[str, str], ...] = ()
    if row.kind == "file":
        recipes = list(
            (
                await db.scalars(
                    select(SanitationRecipeRecord)
                    .where(
                        SanitationRecipeRecord.project_id == project_id,
                        SanitationRecipeRecord.data_source_id == row.id,
                    )
                    .execution_options(populate_existing=True)
                )
            ).all()
        )
        if len(recipes) != 1:
            raise ReportRefreshSourceError("report_refresh_preparation_required")
        recipe = recipes[0]
        input_fingerprint = row.fingerprint or ""
        output_fingerprint = recipe.output_fingerprint or ""
        if (
            recipe.status != "applied"
            or not row.source_uri
            or not row.working_uri
            or recipe.input_fingerprint != row.fingerprint
            or not re.fullmatch(r"[0-9a-f]{64}", input_fingerprint)
            or not re.fullmatch(r"[0-9a-f]{64}", output_fingerprint)
        ):
            raise ReportRefreshSourceError("report_refresh_preparation_required")
        contract["recipe"] = {
            "id": str(recipe.id),
            "head": str(recipe.active_revision_id),
            "status": recipe.status,
            "operations": recipe.operations,
            "input": recipe.input_fingerprint,
            "output": recipe.output_fingerprint,
        }
        files = ((row.source_uri, input_fingerprint), (row.working_uri, output_fingerprint))
    else:
        connection = (
            await db.get(Connection, row.connection_id, populate_existing=True)
            if row.connection_id
            else None
        )
        if connection is None:
            raise ReportRefreshSourceError("report_refresh_source_unavailable")
        # Keep only a digest in the capture. No credentials enter a receipt/UI.
        contract["connection"] = {
            key: getattr(connection, key)
            for key in (
                "id",
                "driver",
                "host",
                "port",
                "username",
                "password_encrypted",
                "database_name",
                "extra_options",
                "updated_at",
            )
        }
    return RefreshSourceState(bound, stable_payload_hash(contract), files)


def assert_execution_source(state: RefreshSourceState, sources: list[dict[str, Any]]) -> None:
    """The runtime snapshot must be the catalog binding just approved."""

    matches = [source for source in sources if str(source.get("id")) == state.source["id"]]
    if len(matches) != 1 or any(
        matches[0].get(key) != value for key, value in state.source.items()
    ):
        raise ReportRefreshSourceError("report_refresh_source_changed")


def _stamp(value: os.stat_result) -> tuple[int, ...]:
    return value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns


def verify_refresh_files(
    state: RefreshSourceState, project_dir: Path
) -> dict[str, tuple[int, ...]]:
    """Hash bounded files outside the database write transaction, off the event loop.

    This observes the app-owned imported copy, not a browser user's original
    path. Database row freshness is the executed query's snapshot, not a hash.
    """

    proofs = {}
    for raw_path, expected in state.files:
        try:
            path = Path(raw_path).resolve(strict=True)
            if not path.is_relative_to(project_dir.resolve()):
                raise ReportRefreshSourceError("report_refresh_file_unavailable")
            # Refuse special files before reading; O_NONBLOCK avoids a FIFO
            # substitution blocking open on POSIX. fstat also guards Windows.
            fd = os.open(
                path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
            )
            with os.fdopen(fd, "rb") as handle:
                before = os.fstat(handle.fileno())
                if not stat.S_ISREG(before.st_mode):
                    raise ReportRefreshSourceError("report_refresh_file_unavailable")
                if before.st_size > 2 * 1024**3:
                    raise ReportRefreshSourceError("report_refresh_file_unavailable")
                digest = hashlib.sha256()
                consumed = 0
                while chunk := handle.read(1024**2):
                    consumed += len(chunk)
                    if consumed > before.st_size:
                        raise ReportRefreshSourceError("report_refresh_source_changed")
                    digest.update(chunk)
                after = os.fstat(handle.fileno())
                if _stamp(before) != _stamp(after) or _stamp(path.stat()) != _stamp(after):
                    raise ReportRefreshSourceError("report_refresh_source_changed")
            if digest.hexdigest() != expected:
                raise ReportRefreshSourceError("report_refresh_preparation_required")
            proofs[raw_path] = _stamp(after)
        except (OSError, RuntimeError) as exc:
            raise ReportRefreshSourceError("report_refresh_file_unavailable") from exc
    return proofs


def assert_refresh_file_stamps(proofs: dict[str, tuple[int, ...]]) -> None:
    """Short final observation only; never hash while holding the write lock."""

    try:
        if any(_stamp(Path(path).stat()) != stamp for path, stamp in proofs.items()):
            raise ReportRefreshSourceError("report_refresh_source_changed")
    except OSError as exc:
        raise ReportRefreshSourceError("report_refresh_file_unavailable") from exc
