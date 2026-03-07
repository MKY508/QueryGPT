"""Tests for execution.py"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.models import (
    RelationshipContext,
    SemanticContext,
    SSEEvent,
    SSEEventType,
    SystemCapabilities,
)
from app.services.execution import ExecutionService


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

    def test_build_system_prompt_zh(self, mock_db):
        """Test Chinese system prompt generation"""
        service = ExecutionService(db=mock_db, language="zh")
        prompt = service._build_system_prompt(None)

        assert "QueryGPT" in prompt
        assert "自然语言" in prompt or "数据分析" in prompt
        assert "[thinking:" in prompt
        assert "```sql" in prompt
        assert "```python" in prompt

    def test_build_system_prompt_en(self, mock_db):
        """Test English system prompt generation"""
        service = ExecutionService(db=mock_db, language="en")
        prompt = service._build_system_prompt(None)

        assert "QueryGPT" in prompt
        assert "[thinking:" in prompt
        assert "```sql" in prompt

    def test_build_system_prompt_with_db_config(self, mock_db):
        """Test system prompt with database config"""
        service = ExecutionService(db=mock_db, language="zh")

        db_config = {
            "driver": "mysql",
            "host": "localhost",
            "port": 3306,
            "database": "testdb",
        }

        prompt = service._build_system_prompt(db_config)

        assert "mysql" in prompt
        assert "localhost" in prompt
        assert "3306" in prompt
        assert "testdb" in prompt

    def test_build_system_prompt_with_semantic_context(self, mock_db):
        """Test system prompt with semantic terms"""
        service = ExecutionService(db=mock_db, language="zh")

        # Create mock semantic context
        semantic_context = MagicMock(spec=SemanticContext)
        semantic_context.terms = [MagicMock()]
        semantic_context.to_prompt.return_value = "月活用户 = COUNT(DISTINCT user_id)"

        prompt = service._build_system_prompt(None, semantic_context=semantic_context)

        assert "月活用户" in prompt

    def test_build_system_prompt_with_relationship_context(self, mock_db):
        """Test system prompt with table relationships"""
        service = ExecutionService(db=mock_db, language="zh")

        # Create mock relationship context
        relationship_context = MagicMock(spec=RelationshipContext)
        relationship_context.relationships = [MagicMock()]
        relationship_context.to_prompt.return_value = "users.id -> orders.user_id"

        prompt = service._build_system_prompt(None, relationship_context=relationship_context)

        assert "users.id" in prompt

    def test_build_system_prompt_python_instructions(self, mock_db):
        """Test that Python instructions are in prompt"""
        service = ExecutionService(db=mock_db, language="zh")
        prompt = service._build_system_prompt(None)

        # Check Python-related instructions
        assert "python" in prompt.lower()
        assert "matplotlib" in prompt.lower() or "plt" in prompt.lower()
        assert "df" in prompt  # DataFrame reference

    @pytest.mark.asyncio
    async def test_get_runtime_snapshot_with_provider_mapping(self, mock_db):
        service = ExecutionService(
            db=mock_db,
            language="zh",
            context_rounds=0,
        )
        service._get_model_config = AsyncMock(
            return_value={
                "model_id": "model-uuid",
                "display_name": "DeepSeek Chat",
                "model": "deepseek-chat",
                "source_provider": "deepseek",
                "resolved_provider": "openai",
                "provider": "openai",
                "api_format": "openai_compatible",
            }
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
        assert snapshot["resolved_provider"] == "openai"
        assert snapshot["provider_summary"] == "deepseek -> openai · openai_compatible"
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
            return_value={
                "model_id": None,
                "display_name": "Anthropic Claude",
                "model": "claude-3-7-sonnet",
                "source_provider": "anthropic",
                "resolved_provider": "anthropic",
                "provider": "anthropic",
                "api_format": "anthropic_native",
            }
        )
        service._get_connection_record = AsyncMock(return_value=None)

        snapshot = await service.get_runtime_snapshot()

        assert snapshot["provider_summary"] == "anthropic · anthropic_native"
        assert snapshot["connection_id"] is None
        assert snapshot["connection_name"] is None
        assert snapshot["context_rounds"] == 3

    def test_build_system_prompt_without_python(self, mock_db):
        service = ExecutionService(
            db=mock_db,
            language="zh",
            settings_data={"python_enabled": False},
        )
        prompt = service._build_system_prompt(None)
        assert "Python 分析已关闭" in prompt
        assert "不要生成 ```python 代码块" in prompt

    @pytest.mark.asyncio
    async def test_execute_stream_loads_execution_inputs_with_keyword_args(self, mock_db):
        conversation_id = uuid4()
        service = ExecutionService(db=mock_db, language="zh")
        history_mock = AsyncMock(return_value=[])
        service._get_model_config = AsyncMock(return_value={"model": "gpt-4o"})
        service._get_connection_config = AsyncMock(return_value=None)
        service._get_semantic_context = AsyncMock(return_value=SemanticContext(terms=[]))
        service._get_relationship_context = AsyncMock(
            return_value=RelationshipContext(relationships=[])
        )
        service._get_default_prompt = AsyncMock(return_value=None)
        service._get_conversation_history = history_mock
        service._capabilities = MagicMock(
            return_value=SystemCapabilities(available_python_libraries=["pandas"])
        )
        service._build_system_prompt = MagicMock(return_value="system prompt")

        class FakeEngine:
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


class TestSemanticContext:
    """Test SemanticContext model"""

    def test_empty_context(self):
        """Test empty semantic context"""
        context = SemanticContext(terms=[])
        assert len(context.terms) == 0

    def test_to_prompt_zh(self):
        """Test Chinese prompt generation"""
        from datetime import datetime

        from app.models import SemanticTermResponse

        term = SemanticTermResponse(
            id=uuid4(),
            term="月活用户",
            expression="COUNT(DISTINCT user_id)",
            term_type="metric",
            description="月度活跃用户数",
            is_active=True,
            created_at=datetime.now(),
        )
        context = SemanticContext(terms=[term])
        prompt = context.to_prompt("zh")

        assert "月活用户" in prompt
        assert "COUNT(DISTINCT user_id)" in prompt

    def test_to_prompt_en(self):
        """Test English prompt generation"""
        from datetime import datetime

        from app.models import SemanticTermResponse

        term = SemanticTermResponse(
            id=uuid4(),
            term="MAU",
            expression="COUNT(DISTINCT user_id)",
            term_type="metric",
            description="Monthly Active Users",
            is_active=True,
            created_at=datetime.now(),
        )
        context = SemanticContext(terms=[term])
        prompt = context.to_prompt("en")

        assert "MAU" in prompt


class TestRelationshipContext:
    """Test RelationshipContext model"""

    def test_empty_context(self):
        """Test empty relationship context"""
        context = RelationshipContext(relationships=[])
        assert len(context.relationships) == 0

    def test_to_prompt_zh(self):
        """Test Chinese prompt generation"""
        from datetime import datetime

        from app.models import TableRelationshipResponse

        rel = TableRelationshipResponse(
            id=uuid4(),
            connection_id=uuid4(),
            source_table="users",
            source_column="id",
            target_table="orders",
            target_column="user_id",
            relationship_type="1:N",
            join_type="LEFT",
            is_active=True,
            created_at=datetime.now(),
        )
        context = RelationshipContext(relationships=[rel])
        prompt = context.to_prompt("zh")

        assert "users" in prompt
        assert "orders" in prompt

    def test_to_prompt_en(self):
        """Test English prompt generation"""
        from datetime import datetime

        from app.models import TableRelationshipResponse

        rel = TableRelationshipResponse(
            id=uuid4(),
            connection_id=uuid4(),
            source_table="products",
            source_column="id",
            target_table="order_items",
            target_column="product_id",
            relationship_type="1:N",
            join_type="INNER",
            is_active=True,
            created_at=datetime.now(),
        )
        context = RelationshipContext(relationships=[rel])
        prompt = context.to_prompt("en")

        assert "products" in prompt
        assert "order_items" in prompt
