"""历史记录 API"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.db import get_db
from app.db.tables import Conversation, Message, User
from app.models import APIResponse, ConversationResponse, ConversationSummary, PaginatedResponse

router = APIRouter()


@router.get("", response_model=APIResponse[PaginatedResponse[ConversationSummary]])
async def list_conversations(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    favorites: bool = Query(default=False),
    q: str | None = Query(default=None, max_length=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取对话列表（只返回有消息的对话）"""
    # 子查询：获取每个对话的消息数量
    msg_count_subquery = (
        select(Message.conversation_id, func.count(Message.id).label("msg_count"))
        .group_by(Message.conversation_id)
        .subquery()
    )

    # 构建查询 - 只获取有消息的对话
    query = (
        select(Conversation, msg_count_subquery.c.msg_count)
        .join(msg_count_subquery, Conversation.id == msg_count_subquery.c.conversation_id)
        .where(Conversation.user_id == current_user.id)
        .where(msg_count_subquery.c.msg_count >= 2)  # 至少有用户消息和助手回复
    )

    if favorites:
        query = query.where(Conversation.is_favorite == True)

    if q:
        query = query.where(Conversation.title.ilike(f"%{q}%"))

    # 获取总数
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.scalar(count_query) or 0

    # 获取数据
    query = query.order_by(Conversation.updated_at.desc()).offset(offset).limit(limit)
    result = await db.execute(query)
    rows = result.all()

    # 构建响应
    summaries = [
        ConversationSummary(
            id=conv.id,
            title=conv.title,
            is_favorite=conv.is_favorite,
            status=conv.status,
            message_count=msg_count,
            created_at=conv.created_at,
            updated_at=conv.updated_at,
        )
        for conv, msg_count in rows
    ]

    return APIResponse.ok(
        data=PaginatedResponse.create(
            items=summaries,
            total=total,
            page=(offset // limit) + 1,
            page_size=limit,
        )
    )


@router.get("/{conversation_id}", response_model=APIResponse[ConversationResponse])
async def get_conversation(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取对话详情"""
    query = (
        select(Conversation)
        .where(Conversation.id == conversation_id, Conversation.user_id == current_user.id)
        .options(selectinload(Conversation.messages))
    )
    result = await db.execute(query)
    conversation = result.scalar_one_or_none()

    if not conversation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="对话不存在",
        )

    return APIResponse.ok(data=ConversationResponse.model_validate(conversation))


@router.delete("/{conversation_id}", response_model=APIResponse[dict])
async def delete_conversation(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """删除对话"""
    query = select(Conversation).where(
        Conversation.id == conversation_id,
        Conversation.user_id == current_user.id,
    )
    result = await db.execute(query)
    conversation = result.scalar_one_or_none()

    if not conversation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="对话不存在",
        )

    await db.delete(conversation)
    await db.commit()

    return APIResponse.ok(message="对话已删除")


@router.post("/{conversation_id}/favorite", response_model=APIResponse[dict])
async def toggle_favorite(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """切换收藏状态"""
    query = select(Conversation).where(
        Conversation.id == conversation_id,
        Conversation.user_id == current_user.id,
    )
    result = await db.execute(query)
    conversation = result.scalar_one_or_none()

    if not conversation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="对话不存在",
        )

    conversation.is_favorite = not conversation.is_favorite
    await db.commit()

    return APIResponse.ok(
        data={"is_favorite": conversation.is_favorite},
        message="收藏状态已更新",
    )
