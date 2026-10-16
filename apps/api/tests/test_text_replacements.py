"""Exact, simultaneous, replayable text-value replacements."""

import csv
import json
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from httpx import AsyncClient
from openpyxl import Workbook
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.tables import Project, ProjectDataSource, SanitationRecipeRecord
from app.services.data_preflight import _infer_and_clean_types, fingerprint_file, run_preflight
from app.services.sanitation_contract import (
    SanitationContractError,
    canonicalize_sanitation_operations,
    canonicalize_visual_sanitation_operations,
)


def mapping(column="channel", pairs=None):
    return {
        "operation": "replace_text_values",
        "column": column,
        "replacements": pairs
        if pairs is not None
        else [
            {"from_value": "A", "to_value": "B"},
            {"from_value": "B", "to_value": "C"},
        ],
    }


def test_text_replacement_contract_is_bounded_and_unambiguous():
    rule = mapping(
        pairs=[
            {"from_value": "A", "to_value": "B"},
            {"from_value": "B", "to_value": "A"},
            {"from_value": "", "to_value": "blank"},
        ]
    )
    canonical = canonicalize_visual_sanitation_operations([rule])
    assert canonicalize_sanitation_operations(json.loads(json.dumps(canonical))) == canonical
    assert canonical[0]["replacements"] == rule["replacements"]
    invalid = [
        mapping(pairs=[]),
        mapping(pairs=[{"from_value": "A", "to_value": "A"}]),
        mapping(pairs=[{"from_value": "A", "to_value": "B"}] * 2),
        mapping(pairs=[{"from_value": None, "to_value": "B"}]),
        mapping(pairs=[{"from_value": 1, "to_value": "B"}]),
        mapping(pairs=[{"from_value": "A", "to_value": "B", "regex": True}]),
        mapping(pairs=[{"from_value": "x" * 1001, "to_value": "B"}]),
        mapping(pairs=[{"from_value": "A", "to_value": "\0"}]),
        {**rule, "case_sensitive": False},
        mapping(pairs=[{"from_value": str(i), "to_value": "z"} for i in range(101)]),
    ]
    for value in invalid:
        with pytest.raises(SanitationContractError):
            canonicalize_visual_sanitation_operations([value])
    with pytest.raises(SanitationContractError):
        canonicalize_sanitation_operations([rule, rule])
    many = [
        mapping(str(i), [{"from_value": str(n), "to_value": "z"} for n in range(100)])
        for i in range(11)
    ]
    with pytest.raises(SanitationContractError):
        canonicalize_sanitation_operations(many)


@pytest.mark.parametrize("extension", ["csv", "xlsx", "parquet", "json"])
def test_text_replacements_replay_across_prepared_readers(tmp_path: Path, extension: str):
    values = ["A", "B", "a", "A suburb", None, "O'Reilly", "line\none", "0001"]
    rows = [{"id": index + 1, "channel": value, "amount": 10} for index, value in enumerate(values)]
    source = tmp_path / f"orders.{extension}"
    if extension == "csv":
        with source.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["id", "channel", "amount"])
            writer.writeheader()
            writer.writerows(rows)
    elif extension == "xlsx":
        workbook = Workbook()
        sheet = workbook.active
        sheet.append(["id", "channel", "amount"])
        for row in rows:
            sheet.append(list(row.values()))
        workbook.save(source)
        workbook.close()
    elif extension == "parquet":
        pq.write_table(pa.Table.from_pylist(rows), source)
    else:
        source.write_text(json.dumps(rows), encoding="utf-8")
    original = fingerprint_file(source)
    rule = mapping(
        pairs=[
            *mapping()["replacements"],
            {"from_value": "O'Reilly", "to_value": "x'; DROP TABLE prepared; --"},
            {"from_value": "line\none", "to_value": "line\ntwo"},
            {"from_value": "0001", "to_value": "0010"},
        ]
    )
    result = run_preflight(source, tmp_path / "first", recipe_operations=[rule])
    assert not result.source_snapshot["recipe_replay"]["drift"]
    assert result.working_path
    actual = pq.read_table(result.working_path).to_pydict()
    assert actual["channel"] == [
        "B",
        "C",
        "a",
        "A suburb",
        None,
        "x'; DROP TABLE prepared; --",
        "line\ntwo",
        "0010",
    ]
    assert len(actual["id"]) == len(values)
    replay = run_preflight(source, tmp_path / "replay", recipe_operations=result.operations)
    assert not replay.source_snapshot["recipe_replay"]["drift"]
    assert pq.read_table(replay.working_path).equals(pq.read_table(result.working_path))
    assert fingerprint_file(source) == original


def test_text_replacement_type_drift_and_legacy_xls_path(tmp_path: Path):
    rules = canonicalize_visual_sanitation_operations([mapping()])
    operations, drift = [], []
    cleaned = _infer_and_clean_types(
        pd.DataFrame({"channel": ["A", "B", None]}),
        operations,
        [],
        recipe_operations=rules,
        replay_drift=drift,
    )
    assert cleaned["channel"].tolist()[:2] == ["B", "C"]
    assert pd.isna(cleaned["channel"].iloc[2])
    assert not drift and operations[-1]["operation"] == "replace_text_values"
    mixed = _infer_and_clean_types(
        pd.DataFrame({"channel": ["A", 1]}), [], [], recipe_operations=rules, replay_drift=drift
    )
    assert mixed["channel"].tolist() == ["A", 1]
    assert drift
    source = tmp_path / "typed.parquet"
    pq.write_table(pa.table({"id": [1, 2, 3], "channel": [1, 2, None]}), source)
    result = run_preflight(source, tmp_path / "typed", recipe_operations=rules)
    assert result.source_snapshot["recipe_replay"]["drift"]
    assert not any(step["operation"] == "replace_text_values" for step in result.operations)
    pq.write_table(pa.table({"id": [1, 2], "channel": ["", None]}), source)
    result = run_preflight(
        source,
        tmp_path / "empty",
        recipe_operations=[mapping(pairs=[{"from_value": "", "to_value": "blank"}])],
    )
    assert pq.read_table(result.working_path).to_pydict()["channel"] == ["blank", None]


@pytest.mark.asyncio
async def test_text_replacement_preview_apply_reuse_and_remove(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path, monkeypatch
):
    monkeypatch.setattr(settings, "WORKSPACE_ROOT", tmp_path / "workspace")
    path = tmp_path / "orders.csv"
    path.write_text("id,channel,amount\n1,A,10\n2,B,20\n3,a,30\n", encoding="utf-8")
    original = fingerprint_file(path)
    baseline = run_preflight(path, tmp_path / "baseline")
    project = Project(name="取值替换")
    db_session.add(project)
    await db_session.flush()
    source = ProjectDataSource(
        project_id=project.id,
        kind="file",
        name=path.name,
        format="csv",
        status="ready",
        source_uri=str(path),
        working_uri=str(baseline.working_path),
        fingerprint=original,
        profile_data={"is_current": True},
    )
    db_session.add(source)
    await db_session.commit()
    url = f"/api/v1/projects/{project.id}/sources/{source.id}/cleaning"
    rules = [mapping()]

    def proof(preview, operations):
        return {
            "operations": operations,
            "expected_operations_hash": preview["operations_hash"],
            **{
                f"expected_{key}": preview[key]
                for key in [
                    "source_fingerprint",
                    "preview_output_fingerprint",
                    "current_working_fingerprint",
                    "current_recipe_active_revision_id",
                ]
            },
        }

    response = await client.post(url + "/preview", json={"operations": rules})
    assert response.status_code == 200, response.text
    preview = response.json()["data"]
    assert [row["channel"] for row in preview["after"]["sample"]] == ["B", "C", "a"]
    assert (
        next(item for item in preview["changes"] if item["column"] == "channel")["changed_count"]
        == 2
    )
    assert await db_session.scalar(select(func.count(SanitationRecipeRecord.id))) == 0
    changed = [mapping(pairs=[{"from_value": "A", "to_value": "D"}])]
    assert (await client.post(url + "/apply", json=proof(preview, changed))).status_code == 409
    applied = await client.post(url + "/apply", json=proof(preview, rules))
    assert applied.status_code == 200, applied.text
    await db_session.refresh(source)
    assert (
        source.profile_data["visual_cleaning"]["operations"][0]["replacements"]
        == rules[0]["replacements"]
    )
    saved = applied.json()["data"]["revision"]["operations"]
    later = tmp_path / "later.csv"
    later.write_text("id,channel,amount\n4,B,40\n5,new,50\n", encoding="utf-8")
    replay = run_preflight(later, tmp_path / "later-working", recipe_operations=saved)
    assert not replay.source_snapshot["recipe_replay"]["drift"]
    assert pq.read_table(replay.working_path).to_pydict()["channel"] == ["C", "new"]
    removal = await client.post(url + "/preview", json={"operations": []})
    assert removal.status_code == 200, removal.text
    assert [row["channel"] for row in removal.json()["data"]["after"]["sample"]] == ["A", "B", "a"]
    undone = await client.post(url + "/apply", json=proof(removal.json()["data"], []))
    assert undone.status_code == 200, undone.text
    await db_session.refresh(source)
    assert source.profile_data["visual_cleaning"]["operations"] == []
    assert pq.read_table(Path(source.working_uri)).equals(pq.read_table(baseline.working_path))
    assert fingerprint_file(path) == original
