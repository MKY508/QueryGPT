"""Startup ordering and acknowledgement for the one-time model import."""

from __future__ import annotations

import base64
import os
from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import SecretStr

import app.main as main_module
from app.services.legacy_ts_model_import import (
    LegacyModelImportError,
    LegacyModelImportResult,
)


class _Session:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    async def __aenter__(self):
        return self

    async def __aexit__(self, _exc_type, _exc, _traceback) -> None:
        return None

    async def commit(self) -> None:
        self.events.append("commit")


class _Engine:
    async def dispose(self) -> None:
        return None


def _configure_desktop_inputs(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    source = tmp_path / "data" / "querygpt-ts.db"
    snapshot = tmp_path / "archive" / "model-config.sqlite3"
    legacy_key = base64.urlsafe_b64encode(b"l" * 32).decode()
    monkeypatch.setenv("RECEIPTBI_LEGACY_MODEL_SOURCE", str(source))
    monkeypatch.setenv("RECEIPTBI_LEGACY_MODEL_SNAPSHOT", str(snapshot))
    monkeypatch.setenv("RECEIPTBI_LEGACY_MODEL_ROOT", str(tmp_path))
    monkeypatch.setenv("RECEIPTBI_LEGACY_MODEL_ENCRYPTION_KEY", legacy_key)
    monkeypatch.setattr(
        main_module.settings,
        "DATABASE_URL",
        f"sqlite+aiosqlite:///{tmp_path / 'receiptbi.db'}",
    )
    monkeypatch.setattr(main_module.settings, "ENVIRONMENT", "development")
    monkeypatch.setattr(
        main_module.settings,
        "ENCRYPTION_KEY",
        base64.urlsafe_b64encode(b"c" * 32).decode(),
    )
    monkeypatch.setattr(main_module.settings, "RECEIPTBI_INSTANCE_TOKEN", "launch-token")
    monkeypatch.setattr(
        main_module.settings,
        "RECEIPTBI_LEGACY_MODEL_SOURCE",
        source,
    )
    monkeypatch.setattr(
        main_module.settings,
        "RECEIPTBI_LEGACY_MODEL_SNAPSHOT",
        snapshot,
    )
    monkeypatch.setattr(main_module.settings, "RECEIPTBI_LEGACY_MODEL_ROOT", tmp_path)
    monkeypatch.setattr(
        main_module.settings,
        "RECEIPTBI_LEGACY_MODEL_ENCRYPTION_KEY",
        SecretStr(legacy_key),
    )


@pytest.mark.asyncio
async def test_import_commits_before_health_ack_and_before_legacy_rotation(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    events: list[str] = []
    recovered_validation_job_id = uuid4()
    _configure_desktop_inputs(monkeypatch, tmp_path)

    async def migrate(_engine, _database_url: str) -> str:
        events.append("alembic")
        return "head"

    async def import_model(*_args, **_kwargs) -> LegacyModelImportResult:
        events.append("import")
        assert _kwargs["source_path"] == tmp_path / "archive" / "model-config.sqlite3"
        assert main_module.app.state.legacy_model_migration == "not_requested"
        return LegacyModelImportResult(status="imported")

    async def rotate(*_args, **_kwargs) -> tuple[int, int]:
        events.append("rotate")
        return (0, 0)

    async def recover(*_args, **_kwargs) -> int:
        events.append("recover")
        return 0

    async def recover_inventory(*_args, **_kwargs):
        events.append("inventory-recover")
        return []

    async def recover_validation(*_args, **_kwargs):
        events.append("validation-recover")
        return [recovered_validation_job_id]

    def schedule_validation(job_id):
        assert job_id == recovered_validation_job_id
        events.append("validation-schedule")

    monkeypatch.setattr(main_module, "engine", _Engine())
    monkeypatch.setattr(main_module, "AsyncSessionLocal", lambda: _Session(events))
    monkeypatch.setattr(main_module, "migrate_local_sqlite_to_head", migrate)

    def prepare(**kwargs):
        events.append("prepare")
        assert kwargs["source_path"] == tmp_path / "data" / "querygpt-ts.db"
        return kwargs["snapshot_path"]

    monkeypatch.setattr(main_module, "prepare_legacy_model_snapshot", prepare)
    monkeypatch.setattr(main_module, "import_legacy_ts_model", import_model)
    monkeypatch.setattr(main_module, "rotate_legacy_desktop_credentials", rotate)
    monkeypatch.setattr(main_module, "recover_interrupted_analysis_runs", recover)
    monkeypatch.setattr(main_module, "recover_semantic_inventory_jobs", recover_inventory)
    monkeypatch.setattr(main_module, "recover_semantic_validation_jobs", recover_validation)
    monkeypatch.setattr(main_module, "schedule_semantic_validation_job", schedule_validation)

    async with main_module.lifespan(main_module.app):
        assert events == [
            "alembic",
            "prepare",
            "import",
            "rotate",
            "commit",
            "recover",
            "inventory-recover",
            "validation-recover",
            "commit",
            "validation-schedule",
        ]
        assert main_module.app.state.legacy_model_migration == "imported"
        assert main_module.settings.RECEIPTBI_LEGACY_MODEL_SOURCE is None
        assert main_module.settings.RECEIPTBI_LEGACY_MODEL_SNAPSHOT is None
        assert main_module.settings.RECEIPTBI_LEGACY_MODEL_ROOT is None
        assert main_module.settings.RECEIPTBI_LEGACY_MODEL_ENCRYPTION_KEY is None
        assert not any(
            name in os.environ
            for name in (
                "RECEIPTBI_LEGACY_MODEL_SOURCE",
                "RECEIPTBI_LEGACY_MODEL_SNAPSHOT",
                "RECEIPTBI_LEGACY_MODEL_ROOT",
                "RECEIPTBI_LEGACY_MODEL_ENCRYPTION_KEY",
            )
        )
        health = await main_module.health_check()
        assert health["legacy_model_migration"] == {
            "status": "imported",
            "instance_token": "launch-token",
        }


@pytest.mark.asyncio
async def test_failed_import_never_rotates_or_publishes_an_ack(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    events: list[str] = []
    _configure_desktop_inputs(monkeypatch, tmp_path)

    async def migrate(_engine, _database_url: str) -> str:
        events.append("alembic")
        return "head"

    async def fail_import(*_args, **_kwargs):
        events.append("import")
        raise LegacyModelImportError("Legacy model record is invalid.")

    async def forbidden(*_args, **_kwargs):
        events.append("forbidden")
        return (0, 0)

    monkeypatch.setattr(main_module, "engine", _Engine())
    monkeypatch.setattr(main_module, "AsyncSessionLocal", lambda: _Session(events))
    monkeypatch.setattr(main_module, "migrate_local_sqlite_to_head", migrate)
    monkeypatch.setattr(
        main_module,
        "prepare_legacy_model_snapshot",
        lambda **kwargs: events.append("prepare") or kwargs["snapshot_path"],
    )
    monkeypatch.setattr(main_module, "import_legacy_ts_model", fail_import)
    monkeypatch.setattr(main_module, "rotate_legacy_desktop_credentials", forbidden)
    monkeypatch.setattr(main_module, "recover_interrupted_analysis_runs", forbidden)

    with pytest.raises(LegacyModelImportError, match="invalid"):
        async with main_module.lifespan(main_module.app):
            raise AssertionError("lifespan must not yield")

    assert events == ["alembic", "prepare", "import"]
    assert main_module.app.state.legacy_model_migration == "not_requested"


@pytest.mark.asyncio
async def test_failed_snapshot_preparation_never_imports_or_publishes_an_ack(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    events: list[str] = []
    _configure_desktop_inputs(monkeypatch, tmp_path)

    async def migrate(_engine, _database_url: str) -> str:
        events.append("alembic")
        return "head"

    def fail_prepare(**_kwargs):
        events.append("prepare")
        raise LegacyModelImportError("Legacy model snapshot is invalid.")

    async def forbidden(*_args, **_kwargs):
        events.append("forbidden")
        return (0, 0)

    monkeypatch.setattr(main_module, "engine", _Engine())
    monkeypatch.setattr(main_module, "AsyncSessionLocal", lambda: _Session(events))
    monkeypatch.setattr(main_module, "migrate_local_sqlite_to_head", migrate)
    monkeypatch.setattr(main_module, "prepare_legacy_model_snapshot", fail_prepare)
    monkeypatch.setattr(main_module, "import_legacy_ts_model", forbidden)
    monkeypatch.setattr(main_module, "rotate_legacy_desktop_credentials", forbidden)
    monkeypatch.setattr(main_module, "recover_interrupted_analysis_runs", forbidden)

    with pytest.raises(LegacyModelImportError, match="invalid"):
        async with main_module.lifespan(main_module.app):
            raise AssertionError("lifespan must not yield")

    assert events == ["alembic", "prepare"]
    assert main_module.app.state.legacy_model_migration == "not_requested"
    assert main_module.settings.RECEIPTBI_LEGACY_MODEL_SOURCE is None
    assert main_module.settings.RECEIPTBI_LEGACY_MODEL_SNAPSHOT is None
    assert main_module.settings.RECEIPTBI_LEGACY_MODEL_ROOT is None
    assert main_module.settings.RECEIPTBI_LEGACY_MODEL_ENCRYPTION_KEY is None


@pytest.mark.asyncio
async def test_existing_snapshot_allows_source_to_be_absent(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    events: list[str] = []
    _configure_desktop_inputs(monkeypatch, tmp_path)
    monkeypatch.setattr(main_module.settings, "RECEIPTBI_LEGACY_MODEL_SOURCE", None)

    async def migrate(_engine, _database_url: str) -> str:
        events.append("alembic")
        return "head"

    def prepare(**kwargs):
        events.append("prepare")
        assert kwargs["source_path"] is None
        return kwargs["snapshot_path"]

    async def import_model(*_args, **_kwargs) -> LegacyModelImportResult:
        events.append("import")
        return LegacyModelImportResult(status="already_present")

    async def rotate(*_args, **_kwargs) -> tuple[int, int]:
        events.append("rotate")
        return (0, 0)

    async def recover(*_args, **_kwargs) -> int:
        events.append("recover")
        return 0

    async def recover_inventory(*_args, **_kwargs):
        events.append("inventory-recover")
        return []

    async def recover_validation(*_args, **_kwargs):
        events.append("validation-recover")
        return []

    monkeypatch.setattr(main_module, "engine", _Engine())
    monkeypatch.setattr(main_module, "AsyncSessionLocal", lambda: _Session(events))
    monkeypatch.setattr(main_module, "migrate_local_sqlite_to_head", migrate)
    monkeypatch.setattr(main_module, "prepare_legacy_model_snapshot", prepare)
    monkeypatch.setattr(main_module, "import_legacy_ts_model", import_model)
    monkeypatch.setattr(main_module, "rotate_legacy_desktop_credentials", rotate)
    monkeypatch.setattr(main_module, "recover_interrupted_analysis_runs", recover)
    monkeypatch.setattr(main_module, "recover_semantic_inventory_jobs", recover_inventory)
    monkeypatch.setattr(main_module, "recover_semantic_validation_jobs", recover_validation)

    async with main_module.lifespan(main_module.app):
        assert events == [
            "alembic",
            "prepare",
            "import",
            "rotate",
            "commit",
            "recover",
            "inventory-recover",
            "validation-recover",
            "commit",
        ]
        assert main_module.app.state.legacy_model_migration == "already_present"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("source", "snapshot", "root", "key"),
    [
        (Path("source.sqlite3"), None, None, None),
        (None, Path("snapshot.sqlite3"), None, None),
        (None, None, Path("root"), None),
        (None, None, None, SecretStr("legacy-key")),
    ],
)
async def test_incomplete_legacy_snapshot_inputs_fail_closed(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    source: Path | None,
    snapshot: Path | None,
    root: Path | None,
    key: SecretStr | None,
) -> None:
    events: list[str] = []
    _configure_desktop_inputs(monkeypatch, tmp_path)
    monkeypatch.setattr(
        main_module.settings,
        "RECEIPTBI_LEGACY_MODEL_SOURCE",
        tmp_path / source if source is not None else None,
    )
    monkeypatch.setattr(
        main_module.settings,
        "RECEIPTBI_LEGACY_MODEL_SNAPSHOT",
        tmp_path / snapshot if snapshot is not None else None,
    )
    monkeypatch.setattr(
        main_module.settings,
        "RECEIPTBI_LEGACY_MODEL_ROOT",
        tmp_path / root if root is not None else None,
    )
    monkeypatch.setattr(main_module.settings, "RECEIPTBI_LEGACY_MODEL_ENCRYPTION_KEY", key)

    async def migrate(_engine, _database_url: str) -> str:
        events.append("alembic")
        return "head"

    monkeypatch.setattr(main_module, "engine", _Engine())
    monkeypatch.setattr(main_module, "migrate_local_sqlite_to_head", migrate)

    with pytest.raises(RuntimeError, match="incomplete"):
        async with main_module.lifespan(main_module.app):
            raise AssertionError("lifespan must not yield")

    assert events == ["alembic"]
    assert main_module.app.state.legacy_model_migration == "not_requested"
