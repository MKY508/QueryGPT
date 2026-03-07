"""Demo database bootstrap tests"""

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.demo_db import DEMO_CONNECTION_NAME, ensure_demo_connection
from app.db.tables import Connection
from app.services.app_settings import get_or_create_app_settings


@pytest.mark.asyncio
async def test_seed_demo_connection_when_workspace_is_empty(db_session: AsyncSession):
    demo_path = "/tmp/querygpt-demo.db"

    await ensure_demo_connection(db_session, demo_path)
    await db_session.commit()

    connections = (await db_session.execute(select(Connection))).scalars().all()
    assert len(connections) == 1
    assert connections[0].name == DEMO_CONNECTION_NAME
    assert connections[0].driver == "sqlite"
    assert connections[0].database_name == demo_path
    assert connections[0].is_default is True

    settings_record = await get_or_create_app_settings(db_session)
    assert settings_record.default_connection_id == connections[0].id


@pytest.mark.asyncio
async def test_skip_demo_connection_when_workspace_already_has_connections(
    db_session: AsyncSession,
):
    existing = Connection(
        name="Custom DB",
        driver="sqlite",
        database_name="/tmp/custom.db",
        extra_options={},
        is_default=True,
    )
    db_session.add(existing)
    await db_session.commit()

    await ensure_demo_connection(db_session, "/tmp/querygpt-demo.db")
    await db_session.commit()

    connections = (
        (await db_session.execute(select(Connection).order_by(Connection.name))).scalars().all()
    )
    assert len(connections) == 1
    assert connections[0].name == "Custom DB"
