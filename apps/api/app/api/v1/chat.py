"""聊天 API."""

import asyncio
from collections.abc import AsyncGenerator
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.db import get_db
from app.db.tables import Message
from app.models import APIResponse, ChatStopRequest, SSEEvent
from app.services.app_settings import get_or_create_app_settings, settings_to_dict
from app.services.chat_runtime import (
    ActiveQueryRegistry,
    ChatEventAccumulator,
    apply_runtime_snapshot,
    create_user_message,
    get_or_create_conversation,
    mark_conversation_completed,
    mark_conversation_error,
    mark_conversation_exception,
    resolve_chat_request,
)
from app.services.execution import ExecutionService

router = APIRouter()
active_query_registry = ActiveQueryRegistry()


@router.get("/stream")
async def chat_stream(
    query: str = Query(..., min_length=1, max_length=10000, description="查询内容"),
    model: str | None = Query(default=None, description="模型 ID"),
    conversation_id: UUID | None = Query(default=None, description="对话 ID"),
    connection_id: UUID | None = Query(default=None, description="数据库连接 ID"),
    language: str = Query(default="zh", description="语言"),
    context_rounds: int | None = Query(default=None, ge=1, le=20, description="上下文轮数"),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """SSE 流式聊天 - 单工作区模式."""
    current_conversation_id: UUID | None = conversation_id

    async def event_generator() -> AsyncGenerator[dict[str, str], None]:
        nonlocal current_conversation_id

        settings_record = await get_or_create_app_settings(db)
        settings_data = settings_to_dict(settings_record)

        conversation = await get_or_create_conversation(
            db,
            conversation_id=current_conversation_id,
            query=query,
            connection_id=connection_id,
        )
        if not conversation:
            yield SSEEvent.error("NOT_FOUND", "对话不存在").to_sse()
            return

        current_conversation_id = UUID(str(conversation.id))
        user_message = await create_user_message(
            db,
            conversation_id=current_conversation_id,
            query=query,
        )
        query_key = active_query_registry.start(current_conversation_id)

        try:
            yield SSEEvent.progress(
                "start",
                "开始处理请求...",
                conversation_id=str(current_conversation_id),
            ).to_sse()

            request_config = resolve_chat_request(
                requested_model=model,
                requested_connection_id=connection_id,
                requested_context_rounds=context_rounds,
                conversation=conversation,
                settings_data=settings_data,
            )
            execution_service = ExecutionService(
                db=db,
                model_name=request_config.model_name,
                connection_id=request_config.connection_id,
                language=language,
                context_rounds=request_config.context_rounds,
                settings_data=settings_data,
            )

            runtime_snapshot = await execution_service.get_runtime_snapshot()
            yield SSEEvent.progress(
                "context_ready",
                "执行上下文已准备",
                conversation_id=str(current_conversation_id),
                execution_context=runtime_snapshot,
            ).to_sse()

            apply_runtime_snapshot(conversation, runtime_snapshot)
            await db.commit()

            accumulator = ChatEventAccumulator(
                original_query=query,
                runtime_snapshot=runtime_snapshot,
            )
            async for event in execution_service.execute_stream(
                query=query,
                conversation_id=current_conversation_id,
                exclude_message_id=UUID(str(user_message.id)),
                stop_checker=active_query_registry.stop_checker(query_key),
            ):
                yield event.to_sse()
                accumulator.consume(event)

            metadata = accumulator.build_metadata()
            assistant_message = Message(
                conversation_id=current_conversation_id,
                role="assistant",
                content=accumulator.build_assistant_content(),
                extra_data=metadata,
            )
            db.add(assistant_message)

            if accumulator.has_error:
                mark_conversation_error(
                    conversation,
                    runtime_snapshot=runtime_snapshot,
                    query=query,
                    error_payload=accumulator.error_payload,
                )
                await db.commit()
                await db.refresh(assistant_message)
                return

            mark_conversation_completed(
                conversation,
                runtime_snapshot=runtime_snapshot,
                query=query,
                metadata=metadata,
            )
            await db.commit()
            await db.refresh(assistant_message)

            yield SSEEvent.done(str(current_conversation_id), str(assistant_message.id)).to_sse()
        except asyncio.CancelledError:
            mark_conversation_exception(conversation, "查询已取消")
            await db.commit()
            yield SSEEvent.error(
                "CANCELLED",
                "查询已取消",
                conversation_id=str(current_conversation_id) if current_conversation_id else None,
            ).to_sse()
        except Exception as exc:
            mark_conversation_exception(conversation, str(exc))
            await db.commit()
            yield SSEEvent.error(
                "EXECUTION_ERROR",
                str(exc),
                conversation_id=str(current_conversation_id) if current_conversation_id else None,
            ).to_sse()
        finally:
            active_query_registry.release(query_key)

    return EventSourceResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/stop", response_model=APIResponse[dict[str, Any]])
async def stop_chat(request: ChatStopRequest) -> APIResponse[dict[str, Any]]:
    """停止正在执行的查询."""
    if active_query_registry.stop(request.conversation_id):
        return APIResponse.ok(
            data={"stopped": True},
            message="查询停止请求已发送",
        )

    return APIResponse.ok(
        data={"stopped": False},
        message="没有找到正在执行的查询",
    )
