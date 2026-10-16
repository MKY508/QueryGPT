"""Safety contract for source-scoped visual cleaning preview and apply."""

from __future__ import annotations

import asyncio
import threading
from pathlib import Path
from uuid import uuid4

import duckdb
import pandas as pd
import pytest
from httpx import AsyncClient
from openpyxl import Workbook
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import projects as projects_api
from app.core.config import settings
from app.db.tables import (
    PreflightReportRecord,
    Project,
    ProjectDataSource,
    SanitationRecipeRecord,
    SanitationRecipeRevisionRecord,
)
from app.services.data_preflight import compare_working_copies, fingerprint_file, run_preflight
from app.services.sanitation_contract import (
    SanitationContractError,
    canonicalize_visual_sanitation_operations,
)


async def _ready_file_source(
    db_session: AsyncSession,
    tmp_path: Path,
) -> tuple[Project, ProjectDataSource, Path, Path]:
    project = Project(name="可视化整理")
    db_session.add(project)
    await db_session.flush()
    source_path = tmp_path / "orders.csv"
    source_path.write_text(
        "store_id,amount,order_date\n A ,10,2026/7/1\nB,,2026/7/2\nB,,2026/7/2\n",
        encoding="utf-8",
    )
    baseline = run_preflight(source_path, tmp_path / "trusted-working")
    assert baseline.working_path is not None
    source = ProjectDataSource(
        project_id=project.id,
        kind="file",
        name="orders.csv",
        format="csv",
        source_uri=str(source_path),
        working_uri=str(baseline.working_path),
        status=baseline.status,
        fingerprint=baseline.input_fingerprint,
        profile_data={"is_current": True},
    )
    db_session.add(source)
    await db_session.commit()
    return project, source, source_path, baseline.working_path


def _apply_payload(preview: dict, operations: list[dict]) -> dict:
    return {
        "operations": operations,
        "expected_operations_hash": preview["operations_hash"],
        "expected_source_fingerprint": preview["source_fingerprint"],
        "expected_preview_output_fingerprint": preview["preview_output_fingerprint"],
        "expected_current_working_fingerprint": preview["current_working_fingerprint"],
        "expected_current_recipe_active_revision_id": preview["current_recipe_active_revision_id"],
    }


def test_visual_cleaning_preserves_exact_column_names_when_merging_manual_steps() -> None:
    names = ["amount", " amount ", "amount\u00a0", 'a\t"b"']
    steps = [{"operation": "trim_text", "column": name} for name in names]
    canonical = canonicalize_visual_sanitation_operations(steps)
    assert [step["column"] for step in canonical] == names
    assert len({projects_api._visual_operation_key(step) for step in canonical}) == 4
    merged = projects_api._merge_visual_cleaning_operations(
        steps,
        [steps[2]],
        [steps[1], steps[2]],
    )
    assert {step["column"] for step in merged} == {names[0], names[2], names[3]}
    # Quoting protects the selected identifier; it does not normalize its name.
    aliases = ", ".join(
        f'{index} AS "{name.replace(chr(34), chr(34) * 2)}"' for index, name in enumerate(names)
    )
    with duckdb.connect(":memory:") as connection:
        result = connection.execute(f"SELECT {aliases}")
        assert [column[0] for column in result.description] == names
        assert result.fetchone() == (0, 1, 2, 3)


def test_visual_cleaning_contract_accepts_only_bounded_safe_operations() -> None:
    canonical = canonicalize_visual_sanitation_operations(
        [
            {"operation": "drop_exact_duplicates"},
            {"operation": "fill_missing", "column": "amount", "value": 0},
        ]
    )

    assert canonical[0]["count"] == 0
    assert canonical[1]["value"] == 0
    assert all(item["contract_version"] == 1 for item in canonical)
    assert (
        canonicalize_visual_sanitation_operations(
            [{"operation": "fill_missing", "column": "amount", "value": 0.0}]
        )[0]["value"]
        == 0.0
    )

    with pytest.raises(SanitationContractError):
        canonicalize_visual_sanitation_operations([{"operation": "select_sheet", "sheet": "订单"}])
    with pytest.raises(SanitationContractError):
        canonicalize_visual_sanitation_operations(
            [{"operation": "fill_missing", "column": "amount", "value": [0]}]
        )
    for forbidden_value in (False, True, 1, -1, "0", "unknown"):
        with pytest.raises(SanitationContractError, match="只支持用数字 0"):
            canonicalize_visual_sanitation_operations(
                [
                    {
                        "operation": "fill_missing",
                        "column": "amount",
                        "value": forbidden_value,
                    }
                ]
            )


def test_visual_cleaning_metadata_is_read_only_for_its_exact_recipe_head() -> None:
    matching_revision_id = uuid4()
    source = ProjectDataSource(
        project_id=uuid4(),
        kind="file",
        name="orders.csv",
        format="csv",
        profile_data={
            "visual_cleaning": {
                "active_revision_id": str(matching_revision_id),
                "operations": [{"operation": "fill_missing", "column": "amount", "value": 0}],
            }
        },
    )

    matching = projects_api._stored_visual_cleaning_operations(
        source,
        matching_revision_id,
    )

    assert matching is not None and matching[0]["operation"] == "fill_missing"
    assert projects_api._stored_visual_cleaning_operations(source, uuid4()) is None
    assert projects_api._stored_visual_cleaning_operations(source, None) is None


@pytest.mark.asyncio
async def test_preflight_worker_finishes_before_cancellation_reaches_directory_cleanup(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    started = threading.Event()
    release = threading.Event()

    def controlled_preflight(*_args, **_kwargs):
        started.set()
        assert release.wait(timeout=2)
        return object()

    monkeypatch.setattr(projects_api, "run_preflight", controlled_preflight)
    task = asyncio.create_task(
        projects_api._run_preflight_in_thread(
            tmp_path / "source.csv",
            tmp_path / "attempt",
        )
    )
    for _ in range(100):
        if started.is_set():
            break
        await asyncio.sleep(0.001)
    assert started.is_set()

    task.cancel()
    await asyncio.sleep(0)
    try:
        assert task.done() is False
    finally:
        release.set()
    with pytest.raises(asyncio.CancelledError):
        await task


def test_large_working_copy_comparison_uses_bounded_batches(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    before_path = tmp_path / "before.parquet"
    after_path = tmp_path / "after.parquet"
    shorter_path = tmp_path / "shorter.parquet"
    connection = duckdb.connect(database=":memory:")
    try:
        connection.sql(
            "SELECT value AS id, value * 2 AS amount FROM range(200000) values(value)"
        ).write_parquet(str(before_path))
        connection.sql(
            "SELECT value AS id, CASE WHEN value = 150000 THEN -1 ELSE value * 2 END AS amount "
            "FROM range(200000) values(value)"
        ).write_parquet(str(after_path))
        connection.sql(
            "SELECT value AS id, value * 2 AS amount FROM range(199999) values(value)"
        ).write_parquet(str(shorter_path))
    finally:
        connection.close()

    def fail_full_frame_read(*_args, **_kwargs):
        raise AssertionError("comparison must not materialize full Parquet files through pandas")

    monkeypatch.setattr(pd, "read_parquet", fail_full_frame_read)
    comparison = compare_working_copies(before_path, after_path)

    assert comparison["before"]["rows"] == comparison["after"]["rows"] == 200_000
    assert len(comparison["before"]["sample"]) == 8
    assert comparison["changes"] == [
        {"column": "id", "changed_count": 0},
        {"column": "amount", "changed_count": 1},
    ]
    shape_change = compare_working_copies(before_path, shorter_path)
    assert shape_change["after"]["rows"] == 199_999
    assert shape_change["changes"] == []


@pytest.mark.asyncio
async def test_preview_rejects_source_changes_during_impact_comparison(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "WORKSPACE_ROOT", tmp_path / "workspace")
    project, source, source_path, working_path = await _ready_file_source(db_session, tmp_path)
    original_compare = projects_api.compare_working_copies
    original_working = fingerprint_file(working_path)

    def compare_then_change(*args, **kwargs):
        result = original_compare(*args, **kwargs)
        source_path.write_text("store_id,amount,order_date\nC,999,2026/7/3\n", encoding="utf-8")
        return result

    monkeypatch.setattr(projects_api, "compare_working_copies", compare_then_change)
    response = await client.post(
        f"/api/v1/projects/{project.id}/sources/{source.id}/cleaning/preview",
        json={"operations": [{"operation": "fill_missing", "column": "amount", "value": 0}]},
    )
    assert response.status_code == 409
    assert "重新预览" in response.text
    await db_session.refresh(source)
    assert source.working_uri == str(working_path)
    assert fingerprint_file(working_path) == original_working
    assert await db_session.scalar(select(func.count(SanitationRecipeRecord.id))) == 0
    assert not list((tmp_path / "workspace").rglob("*.parquet"))


@pytest.mark.asyncio
async def test_visual_cleaning_preview_is_non_persistent_then_apply_switches_copy(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "WORKSPACE_ROOT", tmp_path / "workspace")
    project, source, source_path, trusted_working_path = await _ready_file_source(
        db_session,
        tmp_path,
    )
    original_bytes = source_path.read_bytes()
    trusted_fingerprint = fingerprint_file(trusted_working_path)
    operations = [{"operation": "fill_missing", "column": "amount", "value": 0}]
    endpoint_thread_id = threading.get_ident()
    preflight_thread_ids: list[int] = []
    comparison_thread_ids: list[int] = []
    original_run_preflight = projects_api.run_preflight
    original_compare = projects_api.compare_working_copies

    def observed_compare(*args, **kwargs):
        comparison_thread_ids.append(threading.get_ident())
        return original_compare(*args, **kwargs)

    def observed_run_preflight(*args, **kwargs):
        preflight_thread_ids.append(threading.get_ident())
        return original_run_preflight(*args, **kwargs)

    monkeypatch.setattr(projects_api, "run_preflight", observed_run_preflight)
    monkeypatch.setattr(projects_api, "compare_working_copies", observed_compare)

    preview_response = await client.post(
        f"/api/v1/projects/{project.id}/sources/{source.id}/cleaning/preview",
        json={"operations": operations},
    )

    assert preview_response.status_code == 200, preview_response.text
    preview = preview_response.json()["data"]
    assert preview["can_apply"] is True
    assert preview["current_recipe_active_revision_id"] is None
    assert preview["current_working_fingerprint"] == trusted_fingerprint
    assert preview["before"]["rows"] == preview["after"]["rows"] == 2
    assert len(preview["before"]["sample"]) <= 8
    assert len(preview["after"]["sample"]) <= 8
    amount_change = next(item for item in preview["changes"] if item["column"] == "amount")
    assert amount_change["changed_count"] == 1
    assert preview["before"]["sample"][1]["amount"] is None
    assert preview["after"]["sample"][1]["amount"] == 0
    assert preview["comparison_basis"] == "position"
    assert comparison_thread_ids and endpoint_thread_id not in comparison_thread_ids
    assert [item["column"] for item in preview["profiles"]] == ["amount"]
    impact = preview["profiles"][0]
    assert impact["before"]["null_count"] == 1
    assert impact["after"]["null_count"] == 0
    assert impact["before"]["zero_count"] == 0
    assert impact["after"]["zero_count"] == 1

    await db_session.refresh(source)
    assert source.working_uri == str(trusted_working_path)
    assert fingerprint_file(trusted_working_path) == trusted_fingerprint
    assert source_path.read_bytes() == original_bytes
    assert await db_session.scalar(select(func.count(SanitationRecipeRecord.id))) == 0
    assert await db_session.scalar(select(func.count(SanitationRecipeRevisionRecord.id))) == 0
    assert await db_session.scalar(select(func.count(PreflightReportRecord.id))) == 0
    preview_root = (
        settings.WORKSPACE_ROOT
        / str(project.id)
        / "sources"
        / str(source.id)
        / "working"
        / "previews"
    )
    assert not preview_root.exists() or not any(preview_root.rglob("*"))

    applied_response = await client.post(
        f"/api/v1/projects/{project.id}/sources/{source.id}/cleaning/apply",
        json=_apply_payload(preview, operations),
    )

    assert applied_response.status_code == 200, applied_response.text
    applied = applied_response.json()["data"]
    assert applied["revision"]["actor_source"] == "user"
    assert applied["revision"]["state"] == "confirmed"
    assert any(
        item["operation"] == "fill_missing" and item["column"] == "amount" and item["value"] == 0
        for item in applied["revision"]["operations"]
    )
    await db_session.refresh(source)
    assert source.working_uri != str(trusted_working_path)
    assert source.working_uri is not None and Path(source.working_uri).is_file()
    applied_frame = pd.read_parquet(source.working_uri)
    assert applied_frame["amount"].tolist() == [10.0, 0.0]
    assert (source.profile_data or {})["visual_cleaning"]["operations"][0][
        "operation"
    ] == "fill_missing"
    assert (source.profile_data or {})["visual_cleaning"]["active_revision_id"] == applied[
        "revision"
    ]["id"]
    assert source_path.read_bytes() == original_bytes
    assert fingerprint_file(trusted_working_path) == trusted_fingerprint
    assert await db_session.scalar(select(func.count(SanitationRecipeRecord.id))) == 1
    assert await db_session.scalar(select(func.count(SanitationRecipeRevisionRecord.id))) == 1
    assert await db_session.scalar(select(func.count(PreflightReportRecord.id))) == 1

    removal_preview_response = await client.post(
        f"/api/v1/projects/{project.id}/sources/{source.id}/cleaning/preview",
        json={"operations": []},
    )
    assert removal_preview_response.status_code == 200, removal_preview_response.text
    removal_preview = removal_preview_response.json()["data"]
    assert removal_preview["before"]["sample"][1]["amount"] == 0
    assert removal_preview["after"]["sample"][1]["amount"] is None

    removal_apply_response = await client.post(
        f"/api/v1/projects/{project.id}/sources/{source.id}/cleaning/apply",
        json=_apply_payload(removal_preview, []),
    )
    assert removal_apply_response.status_code == 200, removal_apply_response.text
    await db_session.refresh(source)
    restored_frame = pd.read_parquet(source.working_uri)
    assert restored_frame["amount"].iloc[0] == 10
    assert pd.isna(restored_frame["amount"].iloc[1])
    assert (source.profile_data or {})["visual_cleaning"]["operations"] == []
    assert (source.profile_data or {})["visual_cleaning"]["active_revision_id"] == (
        removal_apply_response.json()["data"]["revision"]["id"]
    )
    assert source_path.read_bytes() == original_bytes
    assert await db_session.scalar(select(func.count(SanitationRecipeRevisionRecord.id))) == 2
    assert await db_session.scalar(select(func.count(PreflightReportRecord.id))) == 2
    assert preflight_thread_ids
    assert all(thread_id != endpoint_thread_id for thread_id in preflight_thread_ids)


@pytest.mark.asyncio
async def test_visual_cleaning_source_size_cap_rejects_preview_and_apply(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "WORKSPACE_ROOT", tmp_path / "workspace")
    project, source, _, trusted_working_path = await _ready_file_source(db_session, tmp_path)
    monkeypatch.setattr(settings, "VISUAL_CLEANING_MAX_SOURCE_BYTES", 1)
    payload = {
        "operations": [{"operation": "fill_missing", "column": "amount", "value": 0}],
        "expected_operations_hash": "a" * 64,
        "expected_source_fingerprint": "b" * 64,
        "expected_preview_output_fingerprint": "c" * 64,
        "expected_current_working_fingerprint": fingerprint_file(trusted_working_path),
        "expected_current_recipe_active_revision_id": None,
    }

    preview = await client.post(
        f"/api/v1/projects/{project.id}/sources/{source.id}/cleaning/preview",
        json={"operations": payload["operations"]},
    )
    apply = await client.post(
        f"/api/v1/projects/{project.id}/sources/{source.id}/cleaning/apply",
        json=payload,
    )

    assert preview.status_code == apply.status_code == 413
    assert "请先拆分文件" in preview.json()["detail"]
    assert "请先拆分文件" in apply.json()["detail"]


@pytest.mark.asyncio
async def test_visual_cleaning_rejects_xlsx_with_oversized_expanded_content(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "WORKSPACE_ROOT", tmp_path / "workspace")
    workbook_path = tmp_path / "orders.xlsx"
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["order_id", "amount"])
    sheet.append(["O-1", 10])
    workbook.save(workbook_path)

    project = Project(name="Excel 展开上限")
    db_session.add(project)
    await db_session.flush()
    source = ProjectDataSource(
        project_id=project.id,
        kind="file",
        name=workbook_path.name,
        format="xlsx",
        source_uri=str(workbook_path),
        status="attached",
        profile_data={"is_current": True},
    )
    db_session.add(source)
    await db_session.commit()
    monkeypatch.setattr(
        settings,
        "VISUAL_CLEANING_MAX_SOURCE_BYTES",
        workbook_path.stat().st_size + 1,
    )
    monkeypatch.setattr(settings, "VISUAL_CLEANING_MAX_XLSX_EXPANDED_BYTES", 1)

    response = await client.post(
        f"/api/v1/projects/{project.id}/sources/{source.id}/cleaning/preview",
        json={"operations": [{"operation": "trim_text", "column": "order_id"}]},
    )

    assert response.status_code == 413
    assert "Excel 展开后过大" in response.json()["detail"]


@pytest.mark.asyncio
async def test_visual_cleaning_apply_rejects_source_drift_without_switching_copy(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "WORKSPACE_ROOT", tmp_path / "workspace")
    project, source, source_path, trusted_working_path = await _ready_file_source(
        db_session,
        tmp_path,
    )
    operations = [{"operation": "fill_missing", "column": "amount", "value": 0}]
    preview_response = await client.post(
        f"/api/v1/projects/{project.id}/sources/{source.id}/cleaning/preview",
        json={"operations": operations},
    )
    preview = preview_response.json()["data"]
    source_path.write_text(
        source_path.read_text(encoding="utf-8") + "C,,2026/7/3\n",
        encoding="utf-8",
    )

    rejected = await client.post(
        f"/api/v1/projects/{project.id}/sources/{source.id}/cleaning/apply",
        json=_apply_payload(preview, operations),
    )

    assert rejected.status_code == 409
    await db_session.refresh(source)
    assert source.working_uri == str(trusted_working_path)
    assert await db_session.scalar(select(func.count(SanitationRecipeRecord.id))) == 0
    assert await db_session.scalar(select(func.count(SanitationRecipeRevisionRecord.id))) == 0


@pytest.mark.asyncio
async def test_visual_cleaning_rejects_unknown_operation_and_column(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "WORKSPACE_ROOT", tmp_path / "workspace")
    project, source, _, trusted_working_path = await _ready_file_source(db_session, tmp_path)

    unknown_operation = await client.post(
        f"/api/v1/projects/{project.id}/sources/{source.id}/cleaning/preview",
        json={"operations": [{"operation": "run_python", "code": "pass"}]},
    )
    unknown_column = await client.post(
        f"/api/v1/projects/{project.id}/sources/{source.id}/cleaning/preview",
        json={
            "operations": [{"operation": "fill_missing", "column": "missing_column", "value": 0}]
        },
    )
    empty_without_prior_manual_set = await client.post(
        f"/api/v1/projects/{project.id}/sources/{source.id}/cleaning/preview",
        json={"operations": []},
    )

    assert unknown_operation.status_code == 409
    assert unknown_column.status_code == 409
    assert empty_without_prior_manual_set.status_code == 409
    await db_session.refresh(source)
    assert source.working_uri == str(trusted_working_path)
    assert await db_session.scalar(select(func.count(SanitationRecipeRecord.id))) == 0
