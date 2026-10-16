"""The desktop metadata database enforces its declared cascade contracts."""

from pathlib import Path

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import configure_sqlite_foreign_keys
from app.db.tables import (
    Project,
    ProjectDataSource,
    SanitationRecipeRecord,
    SanitationRecipeRevisionRecord,
)
from app.services.sanitation_revisions import (
    append_sanitation_revision,
    ensure_sanitation_revision_head,
    sanitation_fingerprint_contract,
)


@pytest.mark.asyncio
async def test_sqlite_enables_foreign_keys_and_cascades_sanitation_history(
    tmp_path: Path,
) -> None:
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'foreign-keys.db'}"
    engine = create_async_engine(database_url)
    configure_sqlite_foreign_keys(engine, database_url)
    try:
        async with engine.begin() as connection:
            assert (await connection.execute(text("PRAGMA foreign_keys"))).scalar_one() == 1
            assert (
                str((await connection.execute(text("PRAGMA journal_mode"))).scalar_one()).lower()
                == "wal"
            )
            assert (await connection.execute(text("PRAGMA busy_timeout"))).scalar_one() == 5000
            await connection.run_sync(Base.metadata.create_all)

        # Force a fresh pooled DB-API connection and verify the per-connection hook.
        await engine.dispose()
        async with engine.connect() as connection:
            assert (await connection.execute(text("PRAGMA foreign_keys"))).scalar_one() == 1
            assert (await connection.execute(text("PRAGMA busy_timeout"))).scalar_one() == 5000

        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        async with session_factory() as session:
            project = Project(name="外键级联测试")
            session.add(project)
            await session.flush()
            source = ProjectDataSource(
                project_id=project.id,
                kind="file",
                name="orders.csv",
                format="csv",
                status="ready",
            )
            session.add(source)
            await session.flush()

            recipe = SanitationRecipeRecord(
                project_id=project.id,
                data_source_id=source.id,
                name="订单整理",
                status="applied",
                operations=[],
            )
            session.add(recipe)
            first_revision = await ensure_sanitation_revision_head(session, recipe)
            second_revision = await append_sanitation_revision(
                session,
                recipe,
                expected_active_revision_id=first_revision.id,
                state="confirmed",
                operations=[
                    {
                        "operation": "drop_exact_duplicates",
                        "contract_version": 1,
                        "count": 1,
                    }
                ],
                input_contract=sanitation_fingerprint_contract(None),
                output_contract=sanitation_fingerprint_contract(None),
                actor_source="system",
                reason="验证多版本配方级联删除",
            )
            await session.commit()

            project_id = project.id
            recipe_id = recipe.id
            source_id = source.id
            first_revision_id = first_revision.id
            second_revision_id = second_revision.id
            await session.delete(first_revision)
            with pytest.raises(IntegrityError):
                await session.commit()
            await session.rollback()
            history = list(
                (
                    await session.execute(
                        select(SanitationRecipeRevisionRecord).order_by(
                            SanitationRecipeRevisionRecord.revision_number
                        )
                    )
                ).scalars()
            )
            assert [item.id for item in history] == [first_revision_id, second_revision_id]
            assert history[1].parent_revision_id == history[0].id

            recipe = await session.get(SanitationRecipeRecord, recipe_id)
            assert recipe is not None
            await session.delete(recipe)
            await session.commit()
            assert (
                await session.scalar(select(func.count(SanitationRecipeRevisionRecord.id)))
            ) == 0

            source = await session.get(ProjectDataSource, source_id)
            assert source is not None
            replacement_recipe = SanitationRecipeRecord(
                project_id=project_id,
                data_source_id=source.id,
                name="订单整理二版",
                status="applied",
                operations=[],
            )
            session.add(replacement_recipe)
            await ensure_sanitation_revision_head(session, replacement_recipe)
            await session.commit()

            await session.delete(source)
            await session.commit()
            assert (await session.scalar(select(func.count(SanitationRecipeRecord.id)))) == 0
            assert (
                await session.scalar(select(func.count(SanitationRecipeRevisionRecord.id)))
            ) == 0
    finally:
        await engine.dispose()
