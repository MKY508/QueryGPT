"""Source-backed scalar cards, without model inference or multi-row aggregation."""

from decimal import Decimal

import pytest

from app.api.v1 import reports
from app.db.tables import ReportBlock
from app.services.report_refresh import ReportRefreshSourceError
from tests.test_reports import (
    _fake_refresh_result,
    _seed_page_refresh_boundary,
    _seed_refreshable_report,
    _stub_refresh_runtime,
)


@pytest.mark.asyncio
async def test_page_refresh_publishes_metric_table_and_chart_from_one_query(
    client, db_session, tmp_path, monkeypatch
):
    url, ids = await _seed_page_refresh_boundary(db_session, tmp_path, monkeypatch)
    report = await reports._load_report(db_session, ids[0], ids[1])
    page = report.pages[0]
    page.blocks.append(
        ReportBlock(
            block_type="metric",
            title="收入",
            source_kind="artifact",
            order_index=5,
            source_ref=dict(page.blocks[0].source_ref),
            config={"metric_column": "revenue"},
            content={"value": 1, "delta": "旧变化", "context": "人工备注"},
        )
    )
    await db_session.commit()
    calls = 0
    real_run = reports.run_analysis_playbook

    async def counted(*args, **kwargs):
        nonlocal calls
        calls += 1
        return await real_run(*args, **kwargs)

    monkeypatch.setattr(reports, "run_analysis_playbook", counted)
    plan = await client.post(url + "-sources", json={"expected_version": 1})
    assert plan.status_code == 200, plan.text
    assert len(plan.json()["data"]["blocks"]) == 3 and calls == 0
    applied = await client.post(
        url,
        json={
            "expected_version": 1,
            "source_plan": plan.json()["data"]["source_plan"],
        },
    )
    assert applied.status_code == 200, applied.text
    blocks = applied.json()["data"]["pages"][0]["blocks"]
    table, chart, _, manual, _, metric = blocks
    assert calls == 1
    assert metric["content"]["value"] == table["content"]["rows"][0]["revenue"] == 120
    assert chart["content"]["chart"]["data"] == table["content"]["rows"]
    assert metric["content"]["context"] == "人工备注" and "delta" not in metric["content"]
    assert metric["source_ref"]["refresh_binding"]["value_column"] == "revenue"
    assert metric["source_ref"]["refresh_receipt"]["source"]["source_id"] == str(ids[4])
    assert "value_column" not in table["source_ref"]["refresh_binding"]
    assert manual["content"] == {"value": "100.00"} and manual["version"] == 1


@pytest.mark.asyncio
async def test_saved_table_conversion_resolves_artifact_and_preserves_exact_metric(
    client, db_session, monkeypatch
):
    project, playbook, _, _, report = await _seed_refreshable_report(db_session)
    block = report.pages[0].blocks[0]
    url = f"/api/v1/projects/{project.id}/reports/{report.id}/pages/{report.pages[0].id}/blocks/{block.id}"
    exact = "9007199254740993.1200"
    _stub_refresh_runtime(
        monkeypatch, _fake_refresh_result(playbook, [{"region": "East", "revenue": exact}])
    )
    saved = await client.patch(
        url,
        json={
            "expected_version": 1,
            "block_type": "metric",
            "config": {"metric_column": "revenue"},
            "content": {**block.content, "value": 1},
        },
    )
    assert saved.status_code == 200, saved.text
    preview = await client.post(url + "/refresh-sources", json={"expected_version": 2})
    assert preview.status_code == 200, preview.text
    refreshed = await client.post(
        url + "/refresh",
        json={
            "expected_version": 2,
            "source_plan": preview.json()["data"]["source_plan"],
        },
    )
    assert refreshed.status_code == 200, refreshed.text
    current = refreshed.json()["data"]["pages"][0]["blocks"][0]
    assert current["content"]["value"] == exact
    assert current["artifact_id"] == saved.json()["data"]["pages"][0]["blocks"][0]["artifact_id"]
    # A selected text field is not silently accepted merely because a binding exists.
    saved = await client.patch(
        url, json={"expected_version": 3, "config": {"metric_column": "region"}}
    )
    assert saved.status_code == 200, saved.text
    rejected = await client.post(url + "/refresh-sources", json={"expected_version": 4})
    assert (
        rejected.status_code == 409
        and rejected.json()["detail"]["code"] == "report_refresh_metric_unavailable"
    )


@pytest.mark.asyncio
async def test_multiline_metric_result_keeps_entire_page_unchanged(client, db_session, monkeypatch):
    project, playbook, _, _, report = await _seed_refreshable_report(db_session)
    page = report.pages[0]
    table = page.blocks[0]
    page.blocks.append(
        ReportBlock(
            block_type="metric",
            title="收入",
            source_kind="artifact",
            order_index=1,
            artifact_id=table.artifact_id,
            analysis_run_id=table.analysis_run_id,
            source_ref=dict(table.source_ref),
            config={"metric_column": "revenue"},
            content={"value": 1},
        )
    )
    await db_session.commit()
    base = f"/api/v1/projects/{project.id}/reports/{report.id}"
    url = base + f"/pages/{page.id}/refresh"
    before = (await client.get(base)).json()["data"]
    _stub_refresh_runtime(
        monkeypatch,
        _fake_refresh_result(
            playbook,
            [
                {"region": "East", "revenue": 120},
                {"region": "West", "revenue": 240},
            ],
        ),
    )
    rejected = await client.post(url, json={"expected_version": 1})
    assert rejected.status_code == 409, rejected.text
    assert rejected.json()["detail"]["code"] == "report_refresh_metric_unavailable"
    assert (await client.get(base)).json()["data"] == before


def test_metric_values_require_one_finite_numeric_or_null_and_never_round():
    for value in (None, 0, -12.5, "9007199254740993.1200", Decimal("1.2300")):
        expected = str(value) if isinstance(value, Decimal) else value
        assert reports._metric_result_value([{"amount": value}], "amount") == expected
    for rows in ([], [{"other": 1}], [{"amount": 1}, {"amount": 2}]):
        with pytest.raises(ReportRefreshSourceError, match="metric_unavailable"):
            reports._metric_result_value(rows, "amount")
    for value in (True, "128万元", "", "NaN", float("inf"), [], {}):
        with pytest.raises(ReportRefreshSourceError, match="metric_unavailable"):
            reports._metric_result_value([{"amount": value}], "amount")
