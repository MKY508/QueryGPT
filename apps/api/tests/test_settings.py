"""Focused settings tests for the desktop runtime boundary."""

from __future__ import annotations

import base64
from pathlib import Path

from app.core.config import get_settings


def test_release_version_cannot_be_overridden_by_runtime_settings(tmp_path, monkeypatch):
    from app import __version__
    from app.core.config import Settings

    env_file = tmp_path / "stale.env"
    env_file.write_text("APP_VERSION=8.8.8\n", encoding="utf-8")
    monkeypatch.setenv("APP_VERSION", "9.9.9")
    assert Settings(_env_file=env_file, APP_VERSION="7.7.7").APP_VERSION == __version__
    assert "APP_VERSION" not in Settings.model_fields


def test_desktop_env_file_is_loaded_from_explicit_runtime_path(tmp_path: Path, monkeypatch):
    encryption_key = base64.urlsafe_b64encode(b"q" * 32).decode()
    env_file = tmp_path / "desktop.env"
    env_file.write_text(
        "\n".join(
            [
                "ENVIRONMENT=production",
                "DEFAULT_MODEL=receiptbi-desktop-probe",
                f"ENCRYPTION_KEY={encryption_key}",
            ]
        ),
        encoding="utf-8",
    )
    for name in ("ENVIRONMENT", "DEFAULT_MODEL", "ENCRYPTION_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("RECEIPTBI_ENV_FILE", str(env_file))
    get_settings.cache_clear()
    try:
        loaded = get_settings()
    finally:
        get_settings.cache_clear()

    assert loaded.ENVIRONMENT == "production"
    assert loaded.DEFAULT_MODEL == "receiptbi-desktop-probe"
    assert loaded.ENCRYPTION_KEY == encryption_key
    loaded.validate_secrets()


def test_retired_desktop_environment_names_are_ignored(monkeypatch) -> None:
    monkeypatch.setenv("RECEIPTBI_ENV_FILE", "/dev/null")
    monkeypatch.delenv("RECEIPTBI_INSTANCE_TOKEN", raising=False)
    monkeypatch.delenv("RECEIPTBI_DESKTOP_CONTROL_TOKEN", raising=False)
    monkeypatch.setenv("QUERYGPT_INSTANCE_TOKEN", "legacy-instance")
    monkeypatch.setenv("QUERYGPT_DESKTOP_CONTROL_TOKEN", "legacy-control")
    get_settings.cache_clear()
    try:
        loaded = get_settings()
    finally:
        get_settings.cache_clear()

    assert loaded.RECEIPTBI_INSTANCE_TOKEN is None
    assert loaded.RECEIPTBI_DESKTOP_CONTROL_TOKEN is None


def test_legacy_snapshot_paths_are_loaded_as_ephemeral_desktop_inputs(
    tmp_path: Path, monkeypatch
) -> None:
    source = tmp_path / "data" / "querygpt-ts.db"
    snapshot = tmp_path / "archive" / "model-config.sqlite3"
    monkeypatch.setenv("RECEIPTBI_ENV_FILE", "/dev/null")
    monkeypatch.setenv("RECEIPTBI_LEGACY_MODEL_SOURCE", str(source))
    monkeypatch.setenv("RECEIPTBI_LEGACY_MODEL_SNAPSHOT", str(snapshot))
    monkeypatch.setenv("RECEIPTBI_LEGACY_MODEL_ROOT", str(tmp_path))
    get_settings.cache_clear()
    try:
        loaded = get_settings()
    finally:
        get_settings.cache_clear()

    assert loaded.RECEIPTBI_LEGACY_MODEL_SOURCE == source
    assert loaded.RECEIPTBI_LEGACY_MODEL_SNAPSHOT == snapshot
    assert loaded.RECEIPTBI_LEGACY_MODEL_ROOT == tmp_path
