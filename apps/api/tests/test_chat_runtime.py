"""Tests for chat runtime helpers."""

from types import SimpleNamespace
from uuid import uuid4

from app.models import SSEEvent
from app.services.chat_runtime import (
    ActiveQueryRegistry,
    ChatEventAccumulator,
    apply_runtime_snapshot,
    mark_conversation_completed,
    mark_conversation_error,
    merge_metadata,
    resolve_chat_request,
)


def test_active_query_registry_lifecycle():
    registry = ActiveQueryRegistry()
    conversation_id = uuid4()

    query_key = registry.start(conversation_id)

    assert query_key == str(conversation_id)
    assert registry.is_active(conversation_id) is True
    assert registry.stop(conversation_id) is True
    assert registry.is_active(conversation_id) is False
    assert registry.stop_checker(conversation_id)() is True

    registry.release(conversation_id)
    assert registry.is_active(conversation_id) is False
    assert registry.stop(conversation_id) is False


def test_merge_metadata_dedupes_diagnostics_and_merges_execution_context():
    base = {
        "execution_context": {"model_id": "model-a"},
        "diagnostics": [{"attempt": 1, "phase": "sql", "status": "error", "message": "broken"}],
    }
    updates = {
        "execution_context": {"connection_id": "conn-a"},
        "diagnostics": [
            {"attempt": 1, "phase": "sql", "status": "error", "message": "broken"},
            {"attempt": 2, "phase": "sql", "status": "repaired", "message": "fixed"},
        ],
    }

    merged = merge_metadata(base, updates)

    assert merged["execution_context"] == {
        "model_id": "model-a",
        "connection_id": "conn-a",
    }
    assert merged["diagnostics"] == [
        {"attempt": 1, "phase": "sql", "status": "error", "message": "broken"},
        {"attempt": 2, "phase": "sql", "status": "repaired", "message": "fixed"},
    ]


def test_chat_event_accumulator_collects_stream_output():
    snapshot = {"model_id": "model-a", "connection_id": "conn-a"}
    accumulator = ChatEventAccumulator(original_query="show sales", runtime_snapshot=snapshot)

    progress = SSEEvent.progress(
        "sql",
        "SQL ready",
        execution_context={"connection_name": "Analytics DB"},
        diagnostic_entry={"attempt": 1, "phase": "sql", "status": "success", "message": "ok"},
    )
    result = SSEEvent.result(
        content="分析完成",
        sql="SELECT 1",
        data=[{"value": 1}],
        rows_count=1,
        execution_time=0.25,
        diagnostics=[{"attempt": 1, "phase": "sql", "status": "success", "message": "ok"}],
    )
    python_output = SSEEvent.python_output("stdout")
    python_image = SSEEvent.python_image("image-data")

    accumulator.consume(progress)
    accumulator.consume(result)
    accumulator.consume(python_output)
    accumulator.consume(python_image)

    metadata = accumulator.build_metadata()

    assert accumulator.build_assistant_content() == "分析完成"
    assert metadata["execution_context"]["model_id"] == "model-a"
    assert metadata["execution_context"]["connection_name"] == "Analytics DB"
    assert metadata["sql"] == "SELECT 1"
    assert metadata["python_output"] == "stdout"
    assert metadata["python_images"] == ["image-data"]
    assert len(metadata["diagnostics"]) == 1


def test_chat_event_accumulator_prefers_error_message_when_no_summary():
    accumulator = ChatEventAccumulator(
        original_query="show sales",
        runtime_snapshot={"model_id": "model-a"},
    )

    accumulator.consume(
        SSEEvent.error(
            "SQL_EXECUTION_FAILED",
            "syntax error",
            error_category="sql",
        )
    )

    metadata = accumulator.build_metadata()

    assert accumulator.has_error is True
    assert accumulator.build_assistant_content() == "syntax error"
    assert metadata["error"] == "syntax error"
    assert metadata["error_code"] == "SQL_EXECUTION_FAILED"
    assert metadata["error_category"] == "sql"


def test_resolve_chat_request_prefers_explicit_values():
    conversation = SimpleNamespace(model_id=uuid4(), connection_id=uuid4())

    resolved = resolve_chat_request(
        requested_model="custom-model",
        requested_connection_id=uuid4(),
        requested_context_rounds=7,
        conversation=conversation,
        settings_data={"context_rounds": 3},
    )

    assert resolved.model_name == "custom-model"
    assert resolved.connection_id != conversation.connection_id
    assert resolved.context_rounds == 7


def test_apply_runtime_snapshot_and_terminal_markers():
    model_id = uuid4()
    connection_id = uuid4()
    conversation = SimpleNamespace(
        status="new",
        extra_data={"existing": True},
        model_id=None,
        connection_id=None,
    )

    apply_runtime_snapshot(
        conversation,
        {
            "model_id": str(model_id),
            "connection_id": str(connection_id),
            "provider_summary": "deepseek -> openai",
        },
    )
    assert conversation.status == "active"
    assert conversation.model_id == model_id
    assert conversation.connection_id == connection_id
    assert conversation.extra_data["provider_summary"] == "deepseek -> openai"

    mark_conversation_completed(
        conversation,
        runtime_snapshot={"api_format": "openai_compatible"},
        query="show sales",
        metadata={"execution_time": 0.5, "rows_count": 12},
    )
    assert conversation.status == "completed"
    assert conversation.extra_data["last_query"] == "show sales"
    assert conversation.extra_data["rows_count"] == 12

    mark_conversation_error(
        conversation,
        runtime_snapshot={"api_format": "openai_compatible"},
        query="show sales",
        error_payload={"message": "boom", "error_category": "sql"},
    )
    assert conversation.status == "error"
    assert conversation.extra_data["last_error"] == "boom"
    assert conversation.extra_data["error_category"] == "sql"
