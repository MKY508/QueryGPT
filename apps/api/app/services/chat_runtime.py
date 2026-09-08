"""Helpers for chat SSE session state and persistence."""

import asyncio
from collections.abc import Callable, Sequence
from copy import deepcopy
from dataclasses import dataclass, field
from functools import partial
from threading import RLock
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import Conversation, Message
from app.models import SSEEvent
from app.services.conversation_state import ConversationTurnState

RESULT_DATA_PREVIEW_MAX_ROWS = 100
_CLIENT_STREAM_TOMBSTONE_LIMIT = 4096
_QUERY_ACTIVE = "active"
_QUERY_STOPPED = "stopped"
_QUERY_FINALIZING = "finalizing"
_STREAM_STOPPED_BEFORE_START = "stopped_before_start"
_STREAM_RELEASED = "released"


class ModelSelectionConflictError(ValueError):
    """A started investigation was asked to silently switch model services."""


class ActiveQueryRegistry:
    """Track active chat runs for the local single-instance deployment mode."""

    def __init__(self) -> None:
        self._queries: dict[str, str] = {}
        self._query_conversations: dict[str, str] = {}
        self._query_client_streams: dict[str, str] = {}
        self._client_stream_queries: dict[tuple[str, str], str] = {}
        self._client_stream_tombstones: dict[tuple[str, str], str] = {}
        self._current_query: dict[str, str] = {}
        self._shutdown_requested = False
        self._lock = RLock()

    def _remember_client_stream(
        self,
        client_key: tuple[str, str],
        state: str,
    ) -> None:
        self._client_stream_tombstones.pop(client_key, None)
        self._client_stream_tombstones[client_key] = state
        while len(self._client_stream_tombstones) > _CLIENT_STREAM_TOMBSTONE_LIMIT:
            oldest = next(iter(self._client_stream_tombstones))
            self._client_stream_tombstones.pop(oldest, None)

    def start(
        self,
        conversation_id: UUID | str,
        client_stream_id: str | None = None,
    ) -> str:
        with self._lock:
            conversation_key = str(conversation_id)
            query_key = f"{conversation_key}:{uuid4().hex}"
            initial_state = _QUERY_STOPPED if self._shutdown_requested else _QUERY_ACTIVE
            self._query_conversations[query_key] = conversation_key
            if client_stream_id:
                client_key = (conversation_key, client_stream_id)
                previous_client_query = self._client_stream_queries.get(client_key)
                tombstone = self._client_stream_tombstones.pop(client_key, None)
                if previous_client_query is not None or tombstone is not None:
                    # Stream ids are one-shot generations. A pre-start stop is
                    # consumed here; a released id is never reused as new work.
                    initial_state = _QUERY_STOPPED
                self._query_client_streams[query_key] = client_stream_id
                if previous_client_query is None:
                    self._client_stream_queries[client_key] = query_key
            # A request racing with shutdown or an exact pre-start stop is still
            # registered so its generator can emit cancellation and release.
            self._queries[query_key] = initial_state
            if initial_state == _QUERY_ACTIVE:
                previous = self._current_query.get(conversation_key)
                if previous is not None and self._queries.get(previous) == _QUERY_ACTIVE:
                    self._queries[previous] = _QUERY_STOPPED
                self._current_query[conversation_key] = query_key
            return query_key

    @property
    def shutdown_requested(self) -> bool:
        with self._lock:
            return self._shutdown_requested

    async def prepare_shutdown(self, timeout_seconds: float) -> dict[str, Any]:
        """Ask all in-flight queries to stop, then briefly await their cleanup.

        Stopping is cooperative: analysis code observes the same flag as
        ``/chat/stop``. This gives a tool that is just completing a chance to
        persist its normal safe-boundary checkpoint, without inventing a new
        checkpoint or claiming that pre-tool work can be resumed.
        """

        with self._lock:
            self._shutdown_requested = True
            active_query_keys = [
                key for key, state in self._queries.items() if state == _QUERY_ACTIVE
            ]
            for key in active_query_keys:
                self._queries[key] = _QUERY_STOPPED

        loop = asyncio.get_running_loop()
        deadline = loop.time() + max(0.0, timeout_seconds)
        while loop.time() < deadline:
            with self._lock:
                if not self._queries:
                    break
            await asyncio.sleep(min(0.025, max(0.0, deadline - loop.time())))

        with self._lock:
            remaining = len(self._queries)
        return {
            "stop_requested": len(active_query_keys),
            "released_before_timeout": remaining == 0,
            "remaining_active": remaining,
        }

    def stop(
        self,
        conversation_id: UUID | str,
        client_stream_id: str | None = None,
    ) -> bool:
        with self._lock:
            conversation_key = str(conversation_id)
            client_key = (conversation_key, client_stream_id) if client_stream_id else None
            query_key = (
                self._client_stream_queries.get(client_key)
                if client_key is not None
                else self._current_query.get(conversation_key)
            )
            if query_key is None and conversation_key in self._queries:
                query_key = conversation_key
            if query_key not in self._queries:
                if client_key is None:
                    return False
                tombstone = self._client_stream_tombstones.get(client_key)
                if tombstone == _STREAM_RELEASED:
                    return False
                self._remember_client_stream(
                    client_key,
                    _STREAM_STOPPED_BEFORE_START,
                )
                return True
            state = self._queries[query_key]
            if state == _QUERY_FINALIZING:
                return False
            self._queries[query_key] = _QUERY_STOPPED
            return True

    def begin_finalization(self, conversation_id: UUID | str) -> bool:
        """Atomically let completion or stop claim the terminal transition."""

        with self._lock:
            key = str(conversation_id)
            query_key = key if key in self._queries else self._current_query.get(key, "")
            state = self._queries.get(query_key)
            if state == _QUERY_FINALIZING:
                return True
            if state != _QUERY_ACTIVE:
                return False
            self._queries[query_key] = _QUERY_FINALIZING
            return True

    def finalization_guard(
        self,
        conversation_id: UUID | str,
    ) -> Callable[[], bool]:
        query_key = str(conversation_id)
        return lambda: self.begin_finalization(query_key)

    def is_active(self, conversation_id: UUID | str) -> bool:
        with self._lock:
            key = str(conversation_id)
            query_key = key if key in self._queries else self._current_query.get(key, "")
            return self._queries.get(query_key) in {_QUERY_ACTIVE, _QUERY_FINALIZING}

    def is_current(self, query_key: str) -> bool:
        with self._lock:
            conversation_key = self._query_conversations.get(query_key)
            return (
                conversation_key is not None
                and self._current_query.get(conversation_key) == query_key
            )

    def stop_checker(self, conversation_id: UUID | str) -> Callable[[], bool]:
        query_key = str(conversation_id)
        return lambda: not self.is_active(query_key)

    def release(self, conversation_id: UUID | str) -> None:
        with self._lock:
            query_key = str(conversation_id)
            conversation_key = self._query_conversations.pop(query_key, None)
            client_stream_id = self._query_client_streams.pop(query_key, None)
            self._queries.pop(query_key, None)
            if conversation_key is None:
                return
            if client_stream_id:
                client_key = (conversation_key, client_stream_id)
                if self._client_stream_queries.get(client_key) == query_key:
                    self._client_stream_queries.pop(client_key, None)
                    self._remember_client_stream(client_key, _STREAM_RELEASED)
            if self._current_query.get(conversation_key) == query_key:
                self._current_query.pop(conversation_key, None)


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


def _bounded_result_preview(event_data: dict[str, Any]) -> dict[str, Any]:
    """Keep database message metadata bounded even if another runtime sends full rows."""

    raw_data = event_data.get("data")
    data = raw_data if isinstance(raw_data, list) else None
    preview = data[:RESULT_DATA_PREVIEW_MAX_ROWS] if data is not None else None

    raw_rows_count = event_data.get("rows_count")
    rows_count = (
        int(raw_rows_count)
        if isinstance(raw_rows_count, int) and not isinstance(raw_rows_count, bool)
        else len(data)
        if data is not None
        else None
    )
    if data is not None and rows_count is not None:
        rows_count = max(rows_count, len(data))

    preview_truncated = bool(event_data.get("preview_truncated")) or bool(
        preview is not None and rows_count is not None and rows_count > len(preview)
    )
    data_note = event_data.get("data_note")
    if preview_truncated and not data_note:
        data_note = f"消息仅保留前 {len(preview or [])} 行预览；本轮结果共 {rows_count or 0:,} 行。"
    return {
        "data": preview,
        "rows_count": rows_count,
        "truncated": bool(event_data.get("truncated")),
        "preview_truncated": preview_truncated,
        "data_note": data_note,
    }


@dataclass
class ChatEventAccumulator:
    original_query: str
    runtime_snapshot: dict[str, Any]
    assistant_content: str = ""
    result_received: bool = False
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
                    "analysis_run_id": event.data.get("analysis_run_id"),
                    "project_id": event.data.get("project_id"),
                    "analysis_state": event.data.get("analysis_state"),
                    "resumable": event.data.get("resumable"),
                    "diagnostics": [event.data["diagnostic_entry"]]
                    if event.data.get("diagnostic_entry")
                    else None,
                },
            )
            return

        if event_type == "result":
            self.result_received = True
            self.assistant_content = str(event.data.get("content", "") or self.assistant_content)
            result_preview = _bounded_result_preview(event.data)
            self.metadata = merge_metadata(
                self.metadata,
                {
                    "sql": event.data.get("sql"),
                    "python": event.data.get("python"),
                    "execution_time": event.data.get("execution_time"),
                    **result_preview,
                    "execution_context": event.data.get("execution_context"),
                    "diagnostics": event.data.get("diagnostics"),
                    "report": event.data.get("report"),
                    "analysis_state": event.data.get("analysis_state"),
                    "analysis_run_id": event.data.get("analysis_run_id"),
                    "project_id": event.data.get("project_id"),
                    "tool_history": event.data.get("tool_history"),
                    "knowledge_proposals": event.data.get("knowledge_proposals"),
                    "semantic_engine": event.data.get("semantic_engine"),
                    "correction_application": event.data.get("correction_application"),
                    "resumable": event.data.get("resumable"),
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
                    "failed_stage": event.data.get("failed_stage"),
                    "analysis_run_id": event.data.get("analysis_run_id"),
                    "project_id": event.data.get("project_id"),
                    "analysis_state": event.data.get("analysis_state"),
                    "resumable": event.data.get("resumable"),
                    "execution_context": event.data.get("execution_context"),
                    "diagnostics": event.data.get("diagnostics"),
                    "correction_application": event.data.get("correction_application"),
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
        return "这次调查没有形成可用结论，请继续或重新调查。"

    @property
    def has_result(self) -> bool:
        return self.result_received

    @property
    def has_error(self) -> bool:
        return self.error_payload is not None


@dataclass
class ChatTurn:
    """Project one terminal batch without exposing uncommitted output as history."""

    state: ConversationTurnState
    accumulator: ChatEventAccumulator
    message_id: UUID | None = None

    async def stage(self, db: AsyncSession, events: Sequence[SSEEvent]) -> None:
        snapshot = deepcopy(self.accumulator)
        for event in events:
            snapshot.consume(event)
        if not snapshot.has_result and not snapshot.has_error:
            raise ValueError("A chat completion requires a result or an error")
        metadata = snapshot.build_metadata()
        message = Message(
            id=uuid4(),
            conversation_id=self.state.conversation_id,
            role="assistant",
            content=snapshot.build_assistant_content(),
            extra_data=metadata,
        )
        db.add(message)
        if snapshot.has_error:
            mutation = partial(
                mark_conversation_error,
                runtime_snapshot=snapshot.runtime_snapshot,
                query=snapshot.original_query,
                error_payload=snapshot.error_payload,
            )
        else:
            mutation = partial(
                mark_conversation_completed,
                runtime_snapshot=snapshot.runtime_snapshot,
                query=snapshot.original_query,
                metadata=metadata,
            )
        await self.state.apply(db, mutation)
        self.message_id = message.id


@dataclass(frozen=True)
class ResolvedChatRequest:
    model_name: str | None
    connection_id: UUID | None
    project_id: UUID | None
    context_rounds: int


def resolve_chat_request(
    *,
    requested_model: str | None,
    requested_connection_id: UUID | None,
    requested_project_id: UUID | None,
    requested_context_rounds: int | None,
    conversation: Conversation,
    settings_data: dict[str, Any],
) -> ResolvedChatRequest:
    effective_context_rounds = requested_context_rounds or int(
        settings_data.get("context_rounds", 5) or 5
    )
    locked_model_id = str(conversation.model_id) if conversation.model_id else None
    effective_model: str | None
    if locked_model_id:
        locked_identifier = str((conversation.extra_data or {}).get("model_identifier") or "")
        if requested_model and requested_model not in {locked_model_id, locked_identifier}:
            raise ModelSelectionConflictError(
                "当前调查已固定使用原分析服务；如需更换，请开始新调查"
            )
        # A retry/follow-up always resolves by the immutable persisted UUID,
        # even when a legacy client repeats the human model identifier.
        effective_model = locked_model_id
    else:
        effective_model = requested_model
    existing_project_id = _parse_uuid((conversation.extra_data or {}).get("project_id"))
    effective_project_id = requested_project_id or existing_project_id
    effective_connection_id = requested_connection_id
    # A stored conversation connection is legacy chat state, not a project source selector.
    if effective_connection_id is None and effective_project_id is None:
        effective_connection_id = conversation.connection_id
    return ResolvedChatRequest(
        model_name=effective_model,
        connection_id=effective_connection_id,
        project_id=effective_project_id,
        context_rounds=effective_context_rounds,
    )


def apply_runtime_snapshot(conversation: Conversation, runtime_snapshot: dict[str, Any]) -> None:
    conversation.status = "active"
    conversation.extra_data = {
        **(conversation.extra_data or {}),
        **runtime_snapshot,
    }
    model_id = _parse_uuid(runtime_snapshot.get("model_id"))
    if model_id:
        conversation.model_id = model_id
    # Snapshot presence is authoritative: project-scoped runs intentionally persist None.
    if "connection_id" in runtime_snapshot:
        conversation.connection_id = _parse_uuid(runtime_snapshot.get("connection_id"))


def mark_conversation_completed(
    conversation: Conversation,
    *,
    runtime_snapshot: dict[str, Any],
    query: str,
    metadata: dict[str, Any],
) -> None:
    analysis_state = metadata.get("analysis_state")
    conversation.status = (
        "active" if analysis_state in {"waiting_confirmation", "needs_attention"} else "completed"
    )
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
