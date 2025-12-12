"""配置管理 API"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core import encryptor
from app.db import get_db
from app.db.tables import Connection, Model, User
from app.models import (
    APIResponse,
    ConnectionCreate,
    ConnectionResponse,
    ConnectionTest,
    ModelCreate,
    ModelResponse,
    ModelTest,
    UserConfig,
)

router = APIRouter()


# ===== 模型管理 =====


@router.get("/models", response_model=APIResponse[list[ModelResponse]])
async def list_models(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取模型列表"""
    result = await db.execute(
        select(Model).where(Model.user_id == current_user.id).order_by(Model.created_at.desc())
    )
    models = result.scalars().all()
    return APIResponse.ok(data=[ModelResponse.model_validate(m) for m in models])


@router.post("/models", response_model=APIResponse[ModelResponse])
async def create_model(
    model_in: ModelCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """添加模型配置"""
    # 如果设为默认，取消其他默认
    if model_in.is_default:
        await db.execute(
            select(Model)
            .where(Model.user_id == current_user.id, Model.is_default == True)
        )
        result = await db.execute(
            select(Model).where(Model.user_id == current_user.id, Model.is_default == True)
        )
        for m in result.scalars():
            m.is_default = False

    # 加密 API Key
    api_key_encrypted = None
    if model_in.api_key:
        api_key_encrypted = encryptor.encrypt(model_in.api_key)

    model = Model(
        user_id=current_user.id,
        name=model_in.name,
        provider=model_in.provider,
        model_id=model_in.model_id,
        base_url=model_in.base_url,
        api_key_encrypted=api_key_encrypted,
        extra_options=model_in.extra_options or {},
        is_default=model_in.is_default,
    )
    db.add(model)
    await db.commit()
    await db.refresh(model)

    return APIResponse.ok(data=ModelResponse.model_validate(model), message="模型已添加")


@router.put("/models/{model_id}", response_model=APIResponse[ModelResponse])
async def update_model(
    model_id: UUID,
    model_in: ModelCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新模型配置"""
    result = await db.execute(
        select(Model).where(Model.id == model_id, Model.user_id == current_user.id)
    )
    model = result.scalar_one_or_none()

    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="模型不存在")

    # 如果设为默认，取消其他默认
    if model_in.is_default and not model.is_default:
        other_result = await db.execute(
            select(Model).where(Model.user_id == current_user.id, Model.is_default == True)
        )
        for m in other_result.scalars():
            m.is_default = False

    # 更新字段
    model.name = model_in.name
    model.provider = model_in.provider
    model.model_id = model_in.model_id
    model.base_url = model_in.base_url
    model.is_default = model_in.is_default
    model.extra_options = model_in.extra_options or {}

    # 只有提供了新的 API Key 才更新
    if model_in.api_key:
        model.api_key_encrypted = encryptor.encrypt(model_in.api_key)

    await db.commit()
    await db.refresh(model)

    return APIResponse.ok(data=ModelResponse.model_validate(model), message="模型已更新")


@router.delete("/models/{model_id}", response_model=APIResponse[dict])
async def delete_model(
    model_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """删除模型配置"""
    result = await db.execute(
        select(Model).where(Model.id == model_id, Model.user_id == current_user.id)
    )
    model = result.scalar_one_or_none()

    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="模型不存在")

    await db.delete(model)
    await db.commit()

    return APIResponse.ok(message="模型已删除")


@router.post("/models/{model_id}/test", response_model=APIResponse[ModelTest])
async def test_model(
    model_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """测试模型 API Key"""
    import time

    result = await db.execute(
        select(Model).where(Model.id == model_id, Model.user_id == current_user.id)
    )
    model = result.scalar_one_or_none()

    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="模型不存在")

    # 解密 API Key
    api_key = None
    if model.api_key_encrypted:
        api_key = encryptor.decrypt(model.api_key_encrypted)

    if not api_key:
        return APIResponse.ok(
            data=ModelTest(
                success=False,
                message="未配置 API Key",
            )
        )

    try:
        import litellm

        start_time = time.time()

        # 构建模型名称
        model_name = model.model_id
        if model.provider == "openai":
            model_name = f"openai/{model.model_id}"
        elif model.provider == "anthropic":
            model_name = f"anthropic/{model.model_id}"
        elif model.provider == "deepseek":
            model_name = f"deepseek/{model.model_id}"

        # 发送简单测试请求
        response = await litellm.acompletion(
            model=model_name,
            messages=[{"role": "user", "content": "Hi"}],
            max_tokens=5,
            api_key=api_key,
            api_base=model.base_url,
            timeout=10,
        )

        elapsed_ms = int((time.time() - start_time) * 1000)

        return APIResponse.ok(
            data=ModelTest(
                success=True,
                model_name=response.model if hasattr(response, "model") else model.model_id,
                response_time_ms=elapsed_ms,
                message="连接成功",
            )
        )

    except Exception as e:
        error_msg = str(e)
        if "authentication" in error_msg.lower() or "api key" in error_msg.lower():
            error_msg = "API Key 无效"
        elif "timeout" in error_msg.lower():
            error_msg = "请求超时"
        elif "connection" in error_msg.lower():
            error_msg = "连接失败，请检查网络或 Base URL"

        return APIResponse.ok(
            data=ModelTest(
                success=False,
                message=f"测试失败: {error_msg}",
            )
        )


# ===== 数据库连接管理 =====


@router.get("/connections", response_model=APIResponse[list[ConnectionResponse]])
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


@router.post("/connections", response_model=APIResponse[ConnectionResponse])
async def create_connection(
    conn_in: ConnectionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """添加数据库连接"""
    # 如果设为默认，取消其他默认
    if conn_in.is_default:
        result = await db.execute(
            select(Connection).where(
                Connection.user_id == current_user.id, Connection.is_default == True
            )
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


@router.post("/connections/{connection_id}/test", response_model=APIResponse[ConnectionTest])
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

    # 测试连接
    try:
        if connection.driver == "mysql":
            import pymysql

            conn = pymysql.connect(
                host=connection.host,
                port=connection.port or 3306,
                user=connection.username,
                password=password,
                database=connection.database_name,
            )
            with conn.cursor() as cursor:
                cursor.execute("SELECT VERSION()")
                version = cursor.fetchone()[0]
                cursor.execute("SHOW TABLES")
                tables_count = len(cursor.fetchall())
            conn.close()

            return APIResponse.ok(
                data=ConnectionTest(
                    connected=True,
                    version=f"MySQL {version}",
                    tables_count=tables_count,
                    message="连接成功",
                )
            )

        elif connection.driver == "postgresql":
            import psycopg2

            conn = psycopg2.connect(
                host=connection.host,
                port=connection.port or 5432,
                user=connection.username,
                password=password,
                database=connection.database_name,
            )
            with conn.cursor() as cursor:
                cursor.execute("SELECT version()")
                version = cursor.fetchone()[0]
                cursor.execute(
                    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'"
                )
                tables_count = cursor.fetchone()[0]
            conn.close()

            return APIResponse.ok(
                data=ConnectionTest(
                    connected=True,
                    version=version.split(",")[0],
                    tables_count=tables_count,
                    message="连接成功",
                )
            )

        elif connection.driver == "sqlite":
            import sqlite3

            conn = sqlite3.connect(connection.database_name)
            cursor = conn.cursor()
            cursor.execute("SELECT sqlite_version()")
            version = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
            tables_count = cursor.fetchone()[0]
            conn.close()

            return APIResponse.ok(
                data=ConnectionTest(
                    connected=True,
                    version=f"SQLite {version}",
                    tables_count=tables_count,
                    message="连接成功",
                )
            )

        else:
            return APIResponse.ok(
                data=ConnectionTest(
                    connected=False,
                    message=f"不支持的数据库类型: {connection.driver}",
                )
            )

    except Exception as e:
        return APIResponse.ok(
            data=ConnectionTest(
                connected=False,
                message=f"连接失败: {str(e)}",
            )
        )


@router.put("/connections/{connection_id}", response_model=APIResponse[ConnectionResponse])
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
            select(Connection).where(
                Connection.user_id == current_user.id, Connection.is_default == True
            )
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


@router.delete("/connections/{connection_id}", response_model=APIResponse[dict])
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


# ===== 用户配置 =====


@router.get("/config", response_model=APIResponse[UserConfig])
async def get_config(
    current_user: User = Depends(get_current_user),
):
    """获取用户配置"""
    settings = current_user.settings or {}
    return APIResponse.ok(
        data=UserConfig(
            language=settings.get("language", "zh"),
            theme=settings.get("theme", "light"),
            default_model_id=settings.get("default_model_id"),
            default_connection_id=settings.get("default_connection_id"),
            view_mode=settings.get("view_mode", "user"),
            context_rounds=settings.get("context_rounds", 3),
        )
    )


@router.put("/config", response_model=APIResponse[UserConfig])
async def update_config(
    config_in: UserConfig,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新用户配置"""
    current_user.settings = config_in.model_dump(exclude_none=True)
    await db.commit()

    return APIResponse.ok(data=config_in, message="配置已更新")
