"""聊天 API"""

import asyncio
from collections.abc import AsyncGenerator
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.db import get_db
from app.db.tables import Conversation, Message
from app.models import APIResponse, ChatStopRequest, SSEEvent
from app.services.app_settings import get_or_create_app_settings, settings_to_dict
from app.services.execution import ExecutionService

router = APIRouter()

# 活跃查询追踪
# 注意：此字典仅在单进程/单实例环境中有效。
active_queries: dict[str, bool] = {}


def merge_metadata(base: dict[str, Any], updates: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in updates.items():
        if value is None:
            continue
        if key == "execution_context" and isinstance(value, dict):
            existing = merged.get("execution_context")
            merged["execution_context"] = {
                **(existing if isinstance(existing, dict) else {}),
                **value,
            }
        elif key == "diagnostics" and isinstance(value, list):
            existing = merged.get("diagnostics")
            diagnostics = [*(existing if isinstance(existing, list) else []), *value]
            deduped: list[dict[str, Any]] = []
            seen: set[tuple[Any, ...]] = set()
            for item in diagnostics:
                if not isinstance(item, dict):
                    continue
                marker = (
                    item.get("attempt"),
                    item.get("phase"),
                    item.get("status"),
                    item.get("message"),
                )
                if marker in seen:
                    continue
                seen.add(marker)
                deduped.append(item)
            merged["diagnostics"] = deduped
        else:
            merged[key] = value
    return merged


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
    """SSE 流式聊天 - 单工作区模式"""
    current_conversation_id: UUID | None = conversation_id

    async def event_generator() -> AsyncGenerator[dict[str, str], None]:
        nonlocal current_conversation_id

        settings_record = await get_or_create_app_settings(db)
        settings_data = settings_to_dict(settings_record)

        conversation: Conversation | None = None
        if not current_conversation_id:
            conversation = Conversation(
                title=query[:50] + ("..." if len(query) > 50 else ""),
                connection_id=connection_id,
                status="active",
            )
            db.add(conversation)
            await db.commit()
            await db.refresh(conversation)
            current_conversation_id = UUID(str(conversation.id))
        else:
            conversation = await db.get(Conversation, current_conversation_id)
            if not conversation:
                yield SSEEvent.error("NOT_FOUND", "对话不存在").to_sse()
                return

        assert current_conversation_id is not None

        user_message = Message(
            conversation_id=current_conversation_id,
            role="user",
            content=query,
        )
        db.add(user_message)
        await db.commit()
        await db.refresh(user_message)

        query_key = str(current_conversation_id)
        active_queries[query_key] = True

        try:
            yield SSEEvent.progress(
                "start",
                "开始处理请求...",
                conversation_id=str(current_conversation_id),
            ).to_sse()

            effective_context_rounds = context_rounds or int(
                settings_data.get("context_rounds", 5) or 5
            )
            effective_model = model or (
                str(conversation.model_id) if conversation and conversation.model_id else None
            )
            effective_connection_id = connection_id or (
                conversation.connection_id if conversation else None
            )

            execution_service = ExecutionService(
                db=db,
                model_name=effective_model,
                connection_id=effective_connection_id,
                language=language,
                context_rounds=effective_context_rounds,
                settings_data=settings_data,
            )

            runtime_snapshot = await execution_service.get_runtime_snapshot()
            yield SSEEvent.progress(
                "context_ready",
                "执行上下文已准备",
                conversation_id=str(current_conversation_id),
                execution_context=runtime_snapshot,
            ).to_sse()

            if conversation:
                conversation.status = "active"
                conversation.extra_data = {
                    **(conversation.extra_data or {}),
                    **runtime_snapshot,
                }
                if runtime_snapshot.get("model_id"):
                    conversation.model_id = UUID(str(runtime_snapshot["model_id"]))
                if runtime_snapshot.get("connection_id"):
                    conversation.connection_id = UUID(str(runtime_snapshot["connection_id"]))
                await db.commit()

            assistant_content = ""
            metadata: dict[str, Any] = {
                "execution_context": runtime_snapshot,
                "diagnostics": [],
                "original_query": query,
            }
            python_output_parts: list[str] = []
            python_images: list[str] = []
            error_payload: dict[str, Any] | None = None

            async for event in execution_service.execute_stream(
                query=query,
                conversation_id=current_conversation_id,
                exclude_message_id=user_message.id,
                stop_checker=lambda: not active_queries.get(query_key, False),
            ):
                yield event.to_sse()

                if event.type.value == "progress":
                    metadata = merge_metadata(
                        metadata,
                        {
                            "execution_context": event.data.get("execution_context"),
                            "diagnostics": [event.data["diagnostic_entry"]]
                            if event.data.get("diagnostic_entry")
                            else None,
                        },
                    )
                elif event.type.value == "result":
                    assistant_content = str(event.data.get("content", "") or assistant_content)
                    metadata = merge_metadata(
                        metadata,
                        {
                            "sql": event.data.get("sql"),
                            "execution_time": event.data.get("execution_time"),
                            "rows_count": event.data.get("rows_count"),
                            "data": event.data.get("data"),
                            "execution_context": event.data.get("execution_context"),
                            "diagnostics": event.data.get("diagnostics"),
                        },
                    )
                elif event.type.value == "visualization":
                    metadata = merge_metadata(metadata, {"visualization": event.data.get("chart")})
                elif event.type.value == "python_output":
                    python_output_parts.append(str(event.data.get("output", "")))
                elif event.type.value == "python_image":
                    python_images.append(str(event.data.get("image", "")))
                elif event.type.value == "error":
                    error_payload = dict(event.data)
                    metadata = merge_metadata(
                        metadata,
                        {
                            "error": event.data.get("message"),
                            "error_code": event.data.get("code"),
                            "error_category": event.data.get("error_category"),
                            "execution_context": event.data.get("execution_context"),
                            "diagnostics": event.data.get("diagnostics"),
                        },
                    )

            if python_output_parts:
                metadata["python_output"] = "".join(python_output_parts)
            if python_images:
                metadata["python_images"] = python_images

            assistant_message_content = assistant_content or "分析完成"
            if error_payload and not assistant_content:
                assistant_message_content = str(error_payload.get("message") or "执行失败")

            assistant_message = Message(
                conversation_id=current_conversation_id,
                role="assistant",
                content=assistant_message_content,
                extra_data=metadata,
            )
            db.add(assistant_message)

            if error_payload:
                if conversation:
                    conversation.status = "error"
                    conversation.extra_data = {
                        **(conversation.extra_data or {}),
                        **runtime_snapshot,
                        "last_query": query,
                        "last_error": error_payload.get("message"),
                        "error_category": error_payload.get("error_category"),
                    }
                await db.commit()
                await db.refresh(assistant_message)
                return

            if conversation:
                conversation.status = "completed"
                conversation.extra_data = {
                    **(conversation.extra_data or {}),
                    **runtime_snapshot,
                    "last_query": query,
                    "execution_time": metadata.get("execution_time"),
                    "rows_count": metadata.get("rows_count"),
                }
            await db.commit()
            await db.refresh(assistant_message)

            yield SSEEvent.done(str(current_conversation_id), str(assistant_message.id)).to_sse()

        except asyncio.CancelledError:
            if conversation:
                conversation.status = "error"
                conversation.extra_data = {
                    **(conversation.extra_data or {}),
                    "last_error": "查询已取消",
                }
                await db.commit()
            yield SSEEvent.error(
                "CANCELLED",
                "查询已取消",
                conversation_id=str(current_conversation_id) if current_conversation_id else None,
            ).to_sse()
        except Exception as exc:
            if conversation:
                conversation.status = "error"
                conversation.extra_data = {
                    **(conversation.extra_data or {}),
                    "last_error": str(exc),
                }
                await db.commit()
            yield SSEEvent.error(
                "EXECUTION_ERROR",
                str(exc),
                conversation_id=str(current_conversation_id) if current_conversation_id else None,
            ).to_sse()
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


@router.post("/stop", response_model=APIResponse[dict[str, Any]])
async def stop_chat(request: ChatStopRequest) -> APIResponse[dict[str, Any]]:
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
