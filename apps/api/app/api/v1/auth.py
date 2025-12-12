"""认证 API"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core import create_access_token, create_refresh_token, get_password_hash, verify_password
from app.core.config import settings
from app.core.demo_db import get_demo_db_path
from app.db import get_db
from app.db.tables import Connection, User
from app.models import APIResponse, Token, UserCreate, UserLogin, UserResponse

router = APIRouter()


@router.post("/register", response_model=APIResponse[dict])
async def register(
    user_in: UserCreate,
    db: AsyncSession = Depends(get_db),
):
    """用户注册"""
    # 检查邮箱是否已存在
    result = await db.execute(select(User).where(User.email == user_in.email))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该邮箱已被注册",
        )

    # 创建用户
    user = User(
        email=user_in.email,
        hashed_password=get_password_hash(user_in.password),
        display_name=user_in.display_name or user_in.email.split("@")[0],
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # 为新用户创建默认的示例数据库连接
    demo_connection = Connection(
        user_id=user.id,
        name="示例数据库",
        driver="sqlite",
        database_name=get_demo_db_path(),
        is_default=True,
    )
    db.add(demo_connection)
    await db.commit()

    # 生成 Token
    access_token = create_access_token(subject=str(user.id))
    refresh_token = create_refresh_token(subject=str(user.id))

    return APIResponse.ok(
        data={
            "user": UserResponse.model_validate(user).model_dump(),
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "expires_in": settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        },
        message="注册成功",
    )


@router.post("/login", response_model=APIResponse[Token])
async def login(
    user_in: UserLogin,
    db: AsyncSession = Depends(get_db),
):
    """用户登录"""
    # 查找用户
    result = await db.execute(select(User).where(User.email == user_in.email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(user_in.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="邮箱或密码错误",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账户已被禁用",
        )

    # 生成 Token
    access_token = create_access_token(subject=str(user.id))
    refresh_token = create_refresh_token(subject=str(user.id))

    return APIResponse.ok(
        data=Token(
            access_token=access_token,
            refresh_token=refresh_token,
            expires_in=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        )
    )


@router.post("/refresh", response_model=APIResponse[Token])
async def refresh_token(
    refresh_token: str,
    db: AsyncSession = Depends(get_db),
):
    """刷新访问令牌"""
    from app.core import decode_token

    payload = decode_token(refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效的刷新令牌",
        )

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == UUID(user_id)))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户不存在或已被禁用",
        )

    # 生成新 Token
    new_access_token = create_access_token(subject=str(user.id))
    new_refresh_token = create_refresh_token(subject=str(user.id))

    return APIResponse.ok(
        data=Token(
            access_token=new_access_token,
            refresh_token=new_refresh_token,
            expires_in=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        )
    )


@router.get("/me", response_model=APIResponse[UserResponse])
async def get_me(
    current_user: User = Depends(get_current_user),
):
    """获取当前用户信息"""
    return APIResponse.ok(data=UserResponse.model_validate(current_user))
