from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import AnalysisRun, ArtifactRecord, Project


async def seed(db):
    project, other = Project(name="Reports"), Project(name="Other")
    db.add_all([project, other])
    await db.flush()
    run = AnalysisRun(project_id=project.id, query="收入", state="completed")
    db.add(run)
    await db.flush()
    stamp = datetime(2026, 9, 1, 1, 2, 3, 123456, tzinfo=UTC)
    items = [
        ArtifactRecord(
            id=UUID(int=i + 1),
            project_id=project.id,
            analysis_run_id=run.id,
            kind=kind,
            title=f"结果 {i}",
            payload={"rows": [{"amount": "9007199254740993.25"}] * 3000},
            technical_details={"trace": "not for the report" * 1000},
            created_at=stamp,
            updated_at=stamp,
        )
        for i, kind in enumerate(["table", "metric", "report"])
    ]
    db.add_all(items)
    await db.commit()
    return project, other, run, items


@pytest.mark.asyncio
async def test_directory_projects_only_metadata_without_loading_payload_or_diagnostics(
    client: AsyncClient, db_session: AsyncSession
):
    project, _, run, items = await seed(db_session)
    statements = []

    def capture(_c, _cursor, sql, _params, _context, _many):
        statements.append(sql)

    engine = db_session.get_bind()
    sa.event.listen(engine, "before_cursor_execute", capture)
    try:
        response = await client.get(
            f"/api/v1/projects/{project.id}/analysis-runs/{run.id}/report-artifacts"
        )
    finally:
        sa.event.remove(engine, "before_cursor_execute", capture)
    assert response.status_code == 200
    data = response.json()["data"]
    assert [row["id"] for row in data] == [str(item.id) for item in items[:2]]
    assert set(data[0]) == {
        "id",
        "project_id",
        "analysis_run_id",
        "kind",
        "title",
        "created_at",
        "updated_at",
    }
    assert data[0]["updated_at"] == "2026-09-01T01:02:03.123456Z"
    assert len(response.content) < 1000
    assert len(statements) == 2
    assert not any(
        word in " ".join(statements).lower()
        for word in ("payload", "technical_details", "checkpoint")
    )


@pytest.mark.asyncio
async def test_explicit_content_is_scoped_exact_and_version_checked(
    client: AsyncClient, db_session: AsyncSession
):
    project, other, run, items = await seed(db_session)
    url = f"/api/v1/projects/{project.id}/analysis-runs/{run.id}/report-artifacts"
    summary = (await client.get(url)).json()["data"][0]
    params = {"expected_updated_at": summary["updated_at"]}
    response = await client.get(f"{url}/{items[0].id}", params=params)
    assert response.status_code == 200
    body = response.json()["data"]
    assert len(body["payload"]["rows"]) == 3000
    assert body["payload"]["rows"][-1]["amount"] == "9007199254740993.25"
    assert body["technical_details"] == {}
    assert body["updated_at"] == summary["updated_at"]
    assert (await client.get(f"{url}/{uuid4()}", params=params)).status_code == 404
    assert (await client.get(f"{url}/{items[2].id}", params=params)).status_code == 404
    assert (
        await client.get(f"/api/v1/projects/{other.id}/analysis-runs/{run.id}/report-artifacts")
    ).status_code == 404
    assert (await client.get(f"{url}/{items[0].id}")).status_code == 422
    assert (
        await client.get(
            f"{url}/{items[0].id}", params={"expected_updated_at": "2026-09-01T01:02:03"}
        )
    ).status_code == 422
    items[0].updated_at += timedelta(microseconds=1)
    await db_session.commit()
    assert (await client.get(f"{url}/{items[0].id}", params=params)).status_code == 409
    run.state = "investigating"
    await db_session.commit()
    assert (await client.get(url)).status_code == 409
