"""历史记录 API"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_db
from app.db.tables import Conversation, Message
from app.models import APIResponse, ConversationResponse, ConversationSummary, PaginatedResponse

router = APIRouter()


@router.get("", response_model=APIResponse[PaginatedResponse[ConversationSummary]])
async def list_conversations(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    favorites: bool = Query(default=False),
    q: str | None = Query(default=None, max_length=100),
    db: AsyncSession = Depends(get_db),
):
    """获取对话列表（只返回有消息的对话）"""
    msg_count_subquery = (
        select(Message.conversation_id, func.count(Message.id).label("msg_count"))
        .group_by(Message.conversation_id)
        .subquery()
    )
    query = (
        select(Conversation, msg_count_subquery.c.msg_count)
        .join(msg_count_subquery, Conversation.id == msg_count_subquery.c.conversation_id)
        .where(msg_count_subquery.c.msg_count >= 2)
    )
    if favorites:
        query = query.where(Conversation.is_favorite)
    if q:
        query = query.where(Conversation.title.ilike(f"%{q}%"))

    total = await db.scalar(select(func.count()).select_from(query.subquery())) or 0
    result = await db.execute(
        query.order_by(Conversation.updated_at.desc()).offset(offset).limit(limit)
    )
    rows = result.all()
    summaries = [
        ConversationSummary(
            id=conversation.id,
            title=conversation.title,
            model=conversation.extra_data.get("model_name") if conversation.extra_data else None,
            model_id=conversation.model_id,
            connection_id=conversation.connection_id,
            connection_name=conversation.extra_data.get("connection_name")
            if conversation.extra_data
            else None,
            provider_summary=conversation.extra_data.get("provider_summary")
            if conversation.extra_data
            else None,
            context_rounds=conversation.extra_data.get("context_rounds")
            if conversation.extra_data
            else None,
            is_favorite=conversation.is_favorite,
            message_count=msg_count,
            status=conversation.status,
            created_at=conversation.created_at,
            updated_at=conversation.updated_at,
        )
        for conversation, msg_count in rows
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
    db: AsyncSession = Depends(get_db),
):
    """获取对话详情"""
    result = await db.execute(
        select(Conversation)
        .where(Conversation.id == conversation_id)
        .options(selectinload(Conversation.messages))
    )
    conversation = result.scalar_one_or_none()
    if not conversation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="对话不存在")
    return APIResponse.ok(data=ConversationResponse.model_validate(conversation))


@router.delete("/{conversation_id}", response_model=APIResponse[dict])
async def delete_conversation(
    conversation_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """删除对话"""
    conversation = await db.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="对话不存在")
    await db.delete(conversation)
    await db.commit()
    return APIResponse.ok(message="对话已删除")


@router.post("/{conversation_id}/favorite", response_model=APIResponse[dict])
async def toggle_favorite(
    conversation_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """切换收藏状态"""
    conversation = await db.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="对话不存在")
    conversation.is_favorite = not conversation.is_favorite
    await db.commit()
    return APIResponse.ok(
        data={"is_favorite": conversation.is_favorite},
        message="收藏状态已更新",
    )
