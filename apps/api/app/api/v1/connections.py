"""数据库连接管理 API"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import encryptor
from app.db import get_db
from app.db.tables import Connection
from app.models import APIResponse, ConnectionCreate, ConnectionResponse, ConnectionTest
from app.services.database import DatabaseConfig, create_database_manager

router = APIRouter(prefix="/connections", tags=["connections"])


async def _get_connection_or_404(db: AsyncSession, connection_id: UUID) -> Connection:
    result = await db.execute(select(Connection).where(Connection.id == connection_id))
    connection = result.scalar_one_or_none()
    if not connection:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="连接不存在")
    return connection


async def _clear_default_connections(db: AsyncSession, exclude_id: UUID | None = None) -> None:
    result = await db.execute(select(Connection).where(Connection.is_default.is_(True)))
    for connection in result.scalars():
        if exclude_id and connection.id == exclude_id:
            continue
        connection.is_default = False


@router.get("", response_model=APIResponse[list[ConnectionResponse]])
async def list_connections(db: AsyncSession = Depends(get_db)):
    """获取数据库连接列表"""
    result = await db.execute(select(Connection).order_by(Connection.created_at.desc()))
    connections = result.scalars().all()
    return APIResponse.ok(data=[ConnectionResponse.model_validate(c) for c in connections])


@router.post("", response_model=APIResponse[ConnectionResponse])
async def create_connection(
    conn_in: ConnectionCreate,
    db: AsyncSession = Depends(get_db),
):
    """添加数据库连接"""
    if conn_in.is_default:
        await _clear_default_connections(db)

    password_encrypted = encryptor.encrypt(conn_in.password) if conn_in.password else None
    connection = Connection(
        name=conn_in.name,
        driver=conn_in.driver,
        host=conn_in.host,
        port=conn_in.port,
        username=conn_in.username,
        password_encrypted=password_encrypted,
        database_name=conn_in.database,
        extra_options=conn_in.extra_options or {},
        is_default=conn_in.is_default,
    )
    db.add(connection)
    await db.commit()
    await db.refresh(connection)

    return APIResponse.ok(data=ConnectionResponse.model_validate(connection), message="连接已添加")


@router.post("/{connection_id}/test", response_model=APIResponse[ConnectionTest])
async def test_connection(
    connection_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """测试数据库连接"""
    connection = await _get_connection_or_404(db, connection_id)

    password = (
        encryptor.decrypt(connection.password_encrypted) if connection.password_encrypted else None
    )
    db_config = DatabaseConfig(
        driver=connection.driver,
        host=connection.host or "localhost",
        port=connection.port,
        user=connection.username or "",
        password=password or "",
        database=connection.database_name or "",
    )
    db_manager = create_database_manager(db_config)
    test_result = db_manager.test_connection()

    return APIResponse.ok(
        data=ConnectionTest(
            connected=test_result.connected,
            version=test_result.version,
            tables_count=test_result.tables_count,
            message=test_result.message,
        )
    )


@router.put("/{connection_id}", response_model=APIResponse[ConnectionResponse])
async def update_connection(
    connection_id: UUID,
    conn_in: ConnectionCreate,
    db: AsyncSession = Depends(get_db),
):
    """更新数据库连接"""
    connection = await _get_connection_or_404(db, connection_id)

    if conn_in.is_default and not connection.is_default:
        await _clear_default_connections(db, exclude_id=connection.id)

    connection.name = conn_in.name
    connection.driver = conn_in.driver
    connection.host = conn_in.host
    connection.port = conn_in.port
    connection.username = conn_in.username
    connection.database_name = conn_in.database
    connection.is_default = conn_in.is_default
    connection.extra_options = conn_in.extra_options or {}
    if conn_in.password:
        connection.password_encrypted = encryptor.encrypt(conn_in.password)

    await db.commit()
    await db.refresh(connection)

    return APIResponse.ok(data=ConnectionResponse.model_validate(connection), message="连接已更新")


@router.delete("/{connection_id}", response_model=APIResponse[dict])
async def delete_connection(
    connection_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """删除数据库连接"""
    connection = await _get_connection_or_404(db, connection_id)
    await db.delete(connection)
    await db.commit()
    return APIResponse.ok(message="连接已删除")
