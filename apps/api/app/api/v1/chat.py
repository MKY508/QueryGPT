"""聊天 API"""

import asyncio
from collections.abc import AsyncGenerator
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.api.deps import get_current_user
from app.core import decode_token
from app.db import get_db
from app.db.tables import Conversation, Message, User
from app.models import APIResponse, ChatStopRequest, SSEEvent
from app.services.execution import ExecutionService

router = APIRouter()

# 活跃查询追踪
active_queries: dict[str, bool] = {}


async def get_user_from_token(
    token: str | None,
    db: AsyncSession,
) -> User:
    """从 token 获取用户 (支持 SSE 的 query param 认证)"""
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未提供认证信息",
        )

    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效的访问令牌",
        )

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效的令牌载荷",
        )

    result = await db.execute(select(User).where(User.id == UUID(user_id)))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户不存在或已被禁用",
        )

    return user


@router.get("/stream")
async def chat_stream(
    query: str = Query(..., min_length=1, max_length=10000, description="查询内容"),
    token: str = Query(..., description="访问令牌"),
    model: str | None = Query(default=None, description="模型 ID"),
    conversation_id: UUID | None = Query(default=None, description="对话 ID"),
    connection_id: UUID | None = Query(default=None, description="数据库连接 ID"),
    language: str = Query(default="zh", description="语言"),
    db: AsyncSession = Depends(get_db),
):
    """SSE 流式聊天"""

    async def event_generator() -> AsyncGenerator[str, None]:
        nonlocal conversation_id

        # 从 token 获取用户
        try:
            current_user = await get_user_from_token(token, db)
        except HTTPException as e:
            yield SSEEvent.error("AUTH_ERROR", e.detail).to_sse()
            return

        # 创建或获取对话
        if not conversation_id:
            conversation = Conversation(
                user_id=current_user.id,
                title=query[:50] + ("..." if len(query) > 50 else ""),
                connection_id=connection_id,
            )
            db.add(conversation)
            await db.commit()
            await db.refresh(conversation)
            conversation_id = conversation.id
        else:
            # 验证对话归属
            conversation = await db.get(Conversation, conversation_id)
            if not conversation or conversation.user_id != current_user.id:
                yield SSEEvent.error("NOT_FOUND", "对话不存在").to_sse()
                return

        # 保存用户消息
        user_message = Message(
            conversation_id=conversation_id,
            role="user",
            content=query,
        )
        db.add(user_message)
        await db.commit()

        # 标记查询开始
        query_key = str(conversation_id)
        active_queries[query_key] = True

        try:
            # 发送开始事件
            yield SSEEvent.progress("start", "开始处理请求...").to_sse()

            # 创建执行服务
            execution_service = ExecutionService(
                user=current_user,
                db=db,
                model_name=model,
                connection_id=connection_id,
                language=language,
            )

            # 执行查询（流式）
            assistant_content = ""
            metadata = {}

            async for event in execution_service.execute_stream(
                query=query,
                conversation_id=conversation_id,
                stop_checker=lambda: not active_queries.get(query_key, False),
            ):
                yield event.to_sse()

                # 收集结果
                if event.type.value == "result":
                    assistant_content = event.data.get("content", "")
                    metadata = {
                        "sql": event.data.get("sql"),
                        "execution_time": event.data.get("execution_time"),
                        "rows_count": event.data.get("rows_count"),
                        "data": event.data.get("data"),  # 保存查询结果数据
                    }
                elif event.type.value == "visualization":
                    metadata["visualization"] = event.data.get("chart")

            # 保存助手消息
            assistant_message = Message(
                conversation_id=conversation_id,
                role="assistant",
                content=assistant_content or "分析完成",
                extra_data=metadata,
            )
            db.add(assistant_message)
            await db.commit()
            await db.refresh(assistant_message)

            # 发送完成事件
            yield SSEEvent.done(conversation_id, assistant_message.id).to_sse()

        except asyncio.CancelledError:
            yield SSEEvent.error("CANCELLED", "查询已取消").to_sse()
        except Exception as e:
            yield SSEEvent.error("EXECUTION_ERROR", str(e)).to_sse()
        finally:
            active_queries.pop(query_key, None)

    return EventSourceResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/stop", response_model=APIResponse[dict])
async def stop_chat(
    request: ChatStopRequest,
    current_user: User = Depends(get_current_user),
):
    """停止正在执行的查询"""
    query_key = str(request.conversation_id)

    if query_key in active_queries:
        active_queries[query_key] = False
        return APIResponse.ok(
            data={"stopped": True},
            message="查询停止请求已发送",
        )

    return APIResponse.ok(
        data={"stopped": False},
        message="没有找到正在执行的查询",
    )
