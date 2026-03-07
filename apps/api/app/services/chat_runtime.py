"""Helpers for chat SSE session state and persistence."""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import Conversation, Message
from app.models import SSEEvent


class ActiveQueryRegistry:
    """Track active chat runs for the local single-instance deployment mode."""

    def __init__(self) -> None:
        self._queries: dict[str, bool] = {}

    def start(self, conversation_id: UUID | str) -> str:
        query_key = str(conversation_id)
        self._queries[query_key] = True
        return query_key

    def stop(self, conversation_id: UUID | str) -> bool:
        query_key = str(conversation_id)
        if query_key not in self._queries:
            return False
        self._queries[query_key] = False
        return True

    def is_active(self, conversation_id: UUID | str) -> bool:
        return self._queries.get(str(conversation_id), False)

    def stop_checker(self, conversation_id: UUID | str) -> Callable[[], bool]:
        query_key = str(conversation_id)
        return lambda: not self.is_active(query_key)

    def release(self, conversation_id: UUID | str) -> None:
        self._queries.pop(str(conversation_id), None)


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


@dataclass
class ChatEventAccumulator:
    original_query: str
    runtime_snapshot: dict[str, Any]
    assistant_content: str = ""
    python_output_parts: list[str] = field(default_factory=list)
    python_images: list[str] = field(default_factory=list)
    error_payload: dict[str, Any] | None = None
    metadata: dict[str, Any] = field(init=False)

    def __post_init__(self) -> None:
        self.metadata = {
            "execution_context": self.runtime_snapshot,
            "diagnostics": [],
            "original_query": self.original_query,
        }

    def consume(self, event: SSEEvent) -> None:
        event_type = event.type.value
        if event_type == "progress":
            self.metadata = merge_metadata(
                self.metadata,
                {
                    "execution_context": event.data.get("execution_context"),
                    "diagnostics": [event.data["diagnostic_entry"]]
                    if event.data.get("diagnostic_entry")
                    else None,
                },
            )
            return

        if event_type == "result":
            self.assistant_content = str(event.data.get("content", "") or self.assistant_content)
            self.metadata = merge_metadata(
                self.metadata,
                {
                    "sql": event.data.get("sql"),
                    "execution_time": event.data.get("execution_time"),
                    "rows_count": event.data.get("rows_count"),
                    "data": event.data.get("data"),
                    "execution_context": event.data.get("execution_context"),
                    "diagnostics": event.data.get("diagnostics"),
                },
            )
            return

        if event_type == "visualization":
            self.metadata = merge_metadata(
                self.metadata,
                {"visualization": event.data.get("chart")},
            )
            return

        if event_type == "python_output":
            self.python_output_parts.append(str(event.data.get("output", "")))
            return

        if event_type == "python_image":
            self.python_images.append(str(event.data.get("image", "")))
            return

        if event_type == "error":
            self.error_payload = dict(event.data)
            self.metadata = merge_metadata(
                self.metadata,
                {
                    "error": event.data.get("message"),
                    "error_code": event.data.get("code"),
                    "error_category": event.data.get("error_category"),
                    "execution_context": event.data.get("execution_context"),
                    "diagnostics": event.data.get("diagnostics"),
                },
            )

    def build_metadata(self) -> dict[str, Any]:
        metadata = dict(self.metadata)
        if self.python_output_parts:
            metadata["python_output"] = "".join(self.python_output_parts)
        if self.python_images:
            metadata["python_images"] = list(self.python_images)
        return metadata

    def build_assistant_content(self) -> str:
        if self.assistant_content:
            return self.assistant_content
        if self.error_payload:
            return str(self.error_payload.get("message") or "执行失败")
        return "分析完成"

    @property
    def has_error(self) -> bool:
        return self.error_payload is not None


@dataclass(frozen=True)
class ResolvedChatRequest:
    model_name: str | None
    connection_id: UUID | None
    context_rounds: int


def resolve_chat_request(
    *,
    requested_model: str | None,
    requested_connection_id: UUID | None,
    requested_context_rounds: int | None,
    conversation: Conversation,
    settings_data: dict[str, Any],
) -> ResolvedChatRequest:
    effective_context_rounds = requested_context_rounds or int(
        settings_data.get("context_rounds", 5) or 5
    )
    effective_model = requested_model or (
        str(conversation.model_id) if conversation.model_id else None
    )
    effective_connection_id = requested_connection_id or conversation.connection_id
    return ResolvedChatRequest(
        model_name=effective_model,
        connection_id=effective_connection_id,
        context_rounds=effective_context_rounds,
    )


def apply_runtime_snapshot(conversation: Conversation, runtime_snapshot: dict[str, Any]) -> None:
    conversation.status = "active"
    conversation.extra_data = {
        **(conversation.extra_data or {}),
        **runtime_snapshot,
    }
    model_id = _parse_uuid(runtime_snapshot.get("model_id"))
    connection_id = _parse_uuid(runtime_snapshot.get("connection_id"))
    if model_id:
        conversation.model_id = model_id
    if connection_id:
        conversation.connection_id = connection_id


def mark_conversation_completed(
    conversation: Conversation,
    *,
    runtime_snapshot: dict[str, Any],
    query: str,
    metadata: dict[str, Any],
) -> None:
    conversation.status = "completed"
    conversation.extra_data = {
        **(conversation.extra_data or {}),
        **runtime_snapshot,
        "last_query": query,
        "execution_time": metadata.get("execution_time"),
        "rows_count": metadata.get("rows_count"),
    }


def mark_conversation_error(
    conversation: Conversation,
    *,
    runtime_snapshot: dict[str, Any],
    query: str,
    error_payload: dict[str, Any] | None,
) -> None:
    conversation.status = "error"
    conversation.extra_data = {
        **(conversation.extra_data or {}),
        **runtime_snapshot,
        "last_query": query,
        "last_error": error_payload.get("message") if error_payload else None,
        "error_category": error_payload.get("error_category") if error_payload else None,
    }


def mark_conversation_exception(conversation: Conversation, message: str) -> None:
    conversation.status = "error"
    conversation.extra_data = {
        **(conversation.extra_data or {}),
        "last_error": message,
    }


async def get_or_create_conversation(
    db: AsyncSession,
    *,
    conversation_id: UUID | None,
    query: str,
    connection_id: UUID | None,
) -> Conversation | None:
    if conversation_id is not None:
        return await db.get(Conversation, conversation_id)

    conversation = Conversation(
        title=query[:50] + ("..." if len(query) > 50 else ""),
        connection_id=connection_id,
        status="active",
    )
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)
    return conversation


async def create_user_message(
    db: AsyncSession,
    *,
    conversation_id: UUID,
    query: str,
) -> Message:
    user_message = Message(
        conversation_id=conversation_id,
        role="user",
        content=query,
    )
    db.add(user_message)
    await db.commit()
    await db.refresh(user_message)
    return user_message


def _parse_uuid(value: Any) -> UUID | None:
    if value is None:
        return None
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None
