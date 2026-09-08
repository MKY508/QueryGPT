"""Tests for execution.py"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import encryptor
from app.db.tables import Model
from app.models import SSEEvent, SSEEventType
from app.services.execution import ExecutionService
from app.services.model_runtime import ModelCredentialError, ModelSelectionError
from tests.model_fixtures import synthetic_model_config


class TestExecutionService:
    """Test ExecutionService class"""

    @pytest.fixture
    def mock_db(self):
        """Create mock database session"""
        return AsyncMock()

    def test_init(self, mock_db):
        """Test service initialization"""
        service = ExecutionService(
            db=mock_db,
            model_name="gpt-4",
            connection_id=uuid4(),
            language="zh",
        )
        assert service.db == mock_db
        assert service.model_name == "gpt-4"
        assert service.language == "zh"

    def test_init_defaults(self, mock_db):
        """Test service initialization with defaults"""
        service = ExecutionService(db=mock_db)
        assert service.model_name is None
        assert service.connection_id is None
        assert service.language == "zh"

    @pytest.mark.asyncio
    async def test_project_without_explicit_connection_does_not_use_default(self, mock_db):
        result = MagicMock()
        result.scalars.return_value.all.return_value = []
        mock_db.execute.return_value = result
        service = ExecutionService(
            db=mock_db,
            project_id=uuid4(),
            settings_data={"default_connection_id": str(uuid4())},
        )

        connection = await service._get_connection_record()

        assert connection is None
        mock_db.execute.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_project_with_explicit_connection_uses_explicit_connection(self, mock_db):
        explicit_connection_id = uuid4()
        explicit_connection = SimpleNamespace(id=explicit_connection_id)
        result = MagicMock()
        result.scalar_one_or_none.return_value = explicit_connection
        mock_db.execute.return_value = result
        service = ExecutionService(
            db=mock_db,
            project_id=uuid4(),
            connection_id=explicit_connection_id,
            settings_data={"default_connection_id": str(uuid4())},
        )

        connection = await service._get_connection_record()

        assert connection is explicit_connection
        mock_db.execute.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_non_project_chat_uses_default_connection(self, mock_db):
        default_connection_id = uuid4()
        default_connection = SimpleNamespace(id=default_connection_id)
        result = MagicMock()
        result.scalar_one_or_none.return_value = default_connection
        mock_db.execute.return_value = result
        service = ExecutionService(
            db=mock_db,
            settings_data={"default_connection_id": str(default_connection_id)},
        )

        connection = await service._get_connection_record()

        assert connection is default_connection
        mock_db.execute.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_get_runtime_snapshot_keeps_provider_and_protocol_separate(self, mock_db):
        service = ExecutionService(
            db=mock_db,
            language="zh",
            context_rounds=0,
        )
        service._get_model_config = AsyncMock(
            return_value=synthetic_model_config(
                model_id="model-uuid",
                display_name="DeepSeek Chat",
                model="deepseek-chat",
                source_provider="deepseek",
                api_format="openai_compatible",
            )
        )
        service._get_connection_record = AsyncMock(
            return_value=SimpleNamespace(
                id=uuid4(),
                name="Analytics DB",
                driver="postgresql",
                host="db.internal",
                database_name="analytics",
            )
        )

        snapshot = await service.get_runtime_snapshot()

        assert snapshot["model_id"] == "model-uuid"
        assert snapshot["model_name"] == "DeepSeek Chat"
        assert snapshot["model_identifier"] == "deepseek-chat"
        assert snapshot["source_provider"] == "deepseek"
        assert snapshot["provider_summary"] == "deepseek · openai_compatible"
        assert snapshot["connection_name"] == "Analytics DB"
        assert snapshot["connection_driver"] == "postgresql"
        assert snapshot["connection_host"] == "db.internal"
        assert snapshot["database_name"] == "analytics"
        assert snapshot["context_rounds"] == 1
        assert snapshot["api_format"] == "openai_compatible"

    @pytest.mark.asyncio
    async def test_get_runtime_snapshot_without_connection(self, mock_db):
        service = ExecutionService(db=mock_db, language="en", context_rounds=3)
        service._get_model_config = AsyncMock(
            return_value=synthetic_model_config(
                model_id=None,
                display_name="Anthropic Claude",
                model="claude-3-7-sonnet",
                source_provider="anthropic",
                api_format="anthropic_native",
            )
        )
        service._get_connection_record = AsyncMock(return_value=None)

        snapshot = await service.get_runtime_snapshot()

        assert snapshot["provider_summary"] == "anthropic · anthropic_native"
        assert snapshot["connection_id"] is None
        assert snapshot["connection_name"] is None
        assert snapshot["context_rounds"] == 3

    @pytest.mark.asyncio
    async def test_runtime_snapshot_hides_diagnostics_when_disabled(self, mock_db):
        project_id = uuid4()
        connection_id = uuid4()
        service = ExecutionService(
            db=mock_db,
            project_id=project_id,
            context_rounds=2,
            settings_data={"diagnostics_enabled": False},
        )
        service._get_model_config = AsyncMock(
            return_value=synthetic_model_config(
                model_id="model-uuid",
                display_name="DeepSeek Chat",
                model="deepseek-chat",
                source_provider="deepseek",
                api_format="openai_compatible",
            )
        )
        service._get_connection_record = AsyncMock(
            return_value=SimpleNamespace(
                id=connection_id,
                name="Analytics DB",
                driver="postgresql",
                host="db.internal",
                database_name="analytics",
            )
        )

        snapshot = await service.get_runtime_snapshot()

        assert snapshot == {
            "model_id": "model-uuid",
            "model_name": "DeepSeek Chat",
            "connection_id": str(connection_id),
            "connection_name": "Analytics DB",
            "context_rounds": 2,
            "project_id": str(project_id),
        }

    @pytest.mark.asyncio
    async def test_execute_stream_loads_execution_inputs_with_keyword_args(self, mock_db):
        conversation_id = uuid4()
        service = ExecutionService(db=mock_db, language="zh")
        history_mock = AsyncMock(return_value=[])
        service._get_model_config = AsyncMock(return_value=synthetic_model_config(model="gpt-4o"))
        service._get_connection_config = AsyncMock(return_value=None)
        service._get_conversation_history = history_mock
        health_mock = AsyncMock()
        service.resolver.record_model_health = health_mock

        class FakeEngine:
            model_request_succeeded = True

            async def execute(self, **_: object):
                yield SSEEvent.result("分析完成")

        service._build_engine = MagicMock(return_value=FakeEngine())

        events = [
            event
            async for event in service.execute_stream(
                query="show revenue",
                conversation_id=conversation_id,
            )
        ]

        history_mock.assert_awaited_once_with(
            conversation_id,
            limit=10,
            exclude_message_id=None,
        )
        assert len(events) == 1
        assert events[0].type == SSEEventType.RESULT
        health_mock.assert_awaited_once_with(healthy=True, commit=False)

    @pytest.mark.asyncio
    async def test_execute_stream_stop_wins_before_terminal_result_is_published(self, mock_db):
        conversation_id = uuid4()
        service = ExecutionService(db=mock_db, language="zh")
        service._get_model_config = AsyncMock(return_value=synthetic_model_config(model="gpt-4o"))
        service._get_connection_config = AsyncMock(return_value=None)
        service._get_conversation_history = AsyncMock(return_value=[])

        class FakeEngine:
            model_request_succeeded = False

            async def execute(self, **_: object):
                yield SSEEvent.result("分析完成")

        service._build_engine = MagicMock(return_value=FakeEngine())
        finalization_guard = MagicMock(return_value=False)

        events = [
            event
            async for event in service.execute_stream(
                query="show revenue",
                conversation_id=conversation_id,
                finalization_guard=finalization_guard,
            )
        ]

        assert [event.type for event in events] == [SSEEventType.ERROR]
        assert events[0].data["code"] == "CANCELLED"
        finalization_guard.assert_called_once_with()

    @pytest.mark.asyncio
    async def test_execute_stream_stop_wins_before_project_result_persistence(self, mock_db):
        conversation_id = uuid4()
        run = SimpleNamespace(
            id=uuid4(),
            project_id=uuid4(),
            checkpoint={},
        )
        service = ExecutionService(db=mock_db, language="zh")
        service._load_execution_inputs = AsyncMock(
            return_value=SimpleNamespace(
                model_config=synthetic_model_config(model="gpt-4o"), history=[]
            )
        )
        service._prepare_analysis_run = AsyncMock(return_value=(run, "show revenue", None, None))
        service._mark_run_needs_attention = AsyncMock()
        service._stage_project_result = AsyncMock()

        class FakeEngine:
            model_request_succeeded = False

            async def execute(self, **_: object):
                yield SSEEvent.result("分析完成")

        service._build_engine = MagicMock(return_value=FakeEngine())

        events = [
            event
            async for event in service.execute_stream(
                query="show revenue",
                conversation_id=conversation_id,
                finalization_guard=lambda: False,
            )
        ]

        assert [event.type for event in events] == [SSEEventType.ERROR]
        assert events[0].data["code"] == "CANCELLED"
        service._stage_project_result.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_explicit_missing_model_fails_closed_without_environment_fallback(
        self,
        db_session: AsyncSession,
    ):
        service = ExecutionService(db_session, model_name=str(uuid4()))

        with pytest.raises(ModelSelectionError, match="不存在或已停用"):
            await service.get_runtime_snapshot()

    @pytest.mark.asyncio
    async def test_unreadable_explicit_model_persists_auth_health(
        self,
        db_session: AsyncSession,
    ):
        model = Model(
            name="Broken credential",
            provider="openai",
            model_id="gpt-4o-mini",
            api_key_encrypted="not-a-fernet-token",
        )
        db_session.add(model)
        await db_session.commit()
        service = ExecutionService(db_session, model_name=str(model.id))

        with pytest.raises(ModelCredentialError):
            await service.get_runtime_snapshot()

        await db_session.refresh(model)
        assert model.health_status == "unhealthy"
        assert model.last_error_category == "auth"
        assert model.last_checked_at is not None

    @pytest.mark.asyncio
    async def test_runtime_auth_failure_persists_fine_category(
        self,
        db_session: AsyncSession,
    ):
        model = Model(
            name="Expiring gateway",
            provider="openai",
            model_id="gpt-4o-mini",
            api_key_encrypted=encryptor.encrypt("saved-key"),
        )
        db_session.add(model)
        await db_session.commit()
        service = ExecutionService(db_session, model_name=str(model.id))
        service._get_conversation_history = AsyncMock(return_value=[])

        class AuthFailureEngine:
            async def execute(self, **_: object):
                if False:
                    yield SSEEvent.result("unreachable")
                raise RuntimeError("Error code: 401 - token status unavailable")

        service._build_engine = MagicMock(return_value=AuthFailureEngine())
        events = [
            event
            async for event in service.execute_stream(
                query="show revenue",
                conversation_id=uuid4(),
            )
        ]

        assert len(events) == 1
        assert events[0].data["code"] == "MODEL_AUTH_ERROR"
        assert events[0].data["error_category"] == "auth"
        await db_session.refresh(model)
        assert model.health_status == "unhealthy"
        assert model.last_error_category == "auth"

    @pytest.mark.asyncio
    async def test_runtime_failure_keeps_product_message_and_advanced_diagnostic(self, mock_db):
        service = ExecutionService(db=mock_db, language="zh")
        service._get_model_config = AsyncMock(return_value=synthetic_model_config(model="gpt-4o"))
        service._get_connection_config = AsyncMock(return_value=None)
        service._get_conversation_history = AsyncMock(return_value=[])

        class BrokenEngine:
            async def execute(self, **_: object):
                if False:
                    yield SSEEvent.result("unreachable")
                raise RuntimeError("dictionary changed size during iteration")

        service._build_engine = MagicMock(return_value=BrokenEngine())

        events = [
            event
            async for event in service.execute_stream(
                query="分析退款异常",
                conversation_id=uuid4(),
            )
        ]

        assert len(events) == 1
        assert events[0].type == SSEEventType.ERROR
        assert events[0].data["message"] == "分析执行时遇到内部错误，请重新调查。"
        assert events[0].data["failed_stage"] == "execution"
        assert events[0].data["diagnostics"][0]["message"] == (
            "RuntimeError: dictionary changed size during iteration"
        )
