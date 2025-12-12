"""数据库连接管理 API"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core import encryptor
from app.db import get_db
from app.db.tables import Connection, User
from app.models import APIResponse, ConnectionCreate, ConnectionResponse, ConnectionTest
from app.services.database import DatabaseConfig, create_database_manager

router = APIRouter(prefix="/connections", tags=["connections"])


@router.get("", response_model=APIResponse[list[ConnectionResponse]])
async def list_connections(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取数据库连接列表"""
    result = await db.execute(
        select(Connection)
        .where(Connection.user_id == current_user.id)
        .order_by(Connection.created_at.desc())
    )
    connections = result.scalars().all()
    return APIResponse.ok(data=[ConnectionResponse.model_validate(c) for c in connections])


@router.post("", response_model=APIResponse[ConnectionResponse])
async def create_connection(
    conn_in: ConnectionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """添加数据库连接"""
    # 如果设为默认，取消其他默认
    if conn_in.is_default:
        result = await db.execute(
            select(Connection).where(Connection.user_id == current_user.id, Connection.is_default)
        )
        for c in result.scalars():
            c.is_default = False

    # 加密密码
    password_encrypted = None
    if conn_in.password:
        password_encrypted = encryptor.encrypt(conn_in.password)

    connection = Connection(
        user_id=current_user.id,
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
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """测试数据库连接"""
    result = await db.execute(
        select(Connection).where(
            Connection.id == connection_id, Connection.user_id == current_user.id
        )
    )
    connection = result.scalar_one_or_none()

    if not connection:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="连接不存在")

    # 解密密码
    password = None
    if connection.password_encrypted:
        password = encryptor.decrypt(connection.password_encrypted)

    # 使用 DatabaseManager 测试连接
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
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新数据库连接"""
    result = await db.execute(
        select(Connection).where(
            Connection.id == connection_id, Connection.user_id == current_user.id
        )
    )
    connection = result.scalar_one_or_none()

    if not connection:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="连接不存在")

    # 如果设为默认，取消其他默认
    if conn_in.is_default and not connection.is_default:
        other_result = await db.execute(
            select(Connection).where(Connection.user_id == current_user.id, Connection.is_default)
        )
        for c in other_result.scalars():
            c.is_default = False

    # 更新字段
    connection.name = conn_in.name
    connection.driver = conn_in.driver
    connection.host = conn_in.host
    connection.port = conn_in.port
    connection.username = conn_in.username
    connection.database_name = conn_in.database
    connection.is_default = conn_in.is_default
    connection.extra_options = conn_in.extra_options or {}

    # 只有提供了新密码才更新
    if conn_in.password:
        connection.password_encrypted = encryptor.encrypt(conn_in.password)

    await db.commit()
    await db.refresh(connection)

    return APIResponse.ok(data=ConnectionResponse.model_validate(connection), message="连接已更新")


@router.delete("/{connection_id}", response_model=APIResponse[dict])
async def delete_connection(
    connection_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """删除数据库连接"""
    result = await db.execute(
        select(Connection).where(
            Connection.id == connection_id, Connection.user_id == current_user.id
        )
    )
    connection = result.scalar_one_or_none()

    if not connection:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="连接不存在")

    await db.delete(connection)
    await db.commit()

    return APIResponse.ok(message="连接已删除")
