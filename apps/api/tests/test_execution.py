"""Tests for execution.py"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.services.execution import ExecutionService
from app.models import SemanticContext, RelationshipContext


class TestExecutionService:
    """Test ExecutionService class"""

    @pytest.fixture
    def mock_user(self):
        """Create mock user"""
        user = MagicMock()
        user.id = uuid4()
        return user

    @pytest.fixture
    def mock_db(self):
        """Create mock database session"""
        return AsyncMock()

    def test_init(self, mock_user, mock_db):
        """Test service initialization"""
        service = ExecutionService(
            user=mock_user,
            db=mock_db,
            model_name="gpt-4",
            connection_id=uuid4(),
            language="zh",
        )
        assert service.user == mock_user
        assert service.db == mock_db
        assert service.model_name == "gpt-4"
        assert service.language == "zh"

    def test_init_defaults(self, mock_user, mock_db):
        """Test service initialization with defaults"""
        service = ExecutionService(user=mock_user, db=mock_db)
        assert service.model_name is None
        assert service.connection_id is None
        assert service.language == "zh"

    def test_build_system_prompt_zh(self, mock_user, mock_db):
        """Test Chinese system prompt generation"""
        service = ExecutionService(user=mock_user, db=mock_db, language="zh")
        prompt = service._build_system_prompt(None)

        assert "QueryGPT" in prompt
        assert "自然语言" in prompt or "数据分析" in prompt
        assert "[thinking:" in prompt
        assert "```sql" in prompt
        assert "```python" in prompt

    def test_build_system_prompt_en(self, mock_user, mock_db):
        """Test English system prompt generation"""
        service = ExecutionService(user=mock_user, db=mock_db, language="en")
        prompt = service._build_system_prompt(None)

        assert "QueryGPT" in prompt
        assert "[thinking:" in prompt
        assert "```sql" in prompt

    def test_build_system_prompt_with_db_config(self, mock_user, mock_db):
        """Test system prompt with database config"""
        service = ExecutionService(user=mock_user, db=mock_db, language="zh")

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

    def test_build_system_prompt_with_semantic_context(self, mock_user, mock_db):
        """Test system prompt with semantic terms"""
        service = ExecutionService(user=mock_user, db=mock_db, language="zh")

        # Create mock semantic context
        semantic_context = MagicMock(spec=SemanticContext)
        semantic_context.terms = [MagicMock()]
        semantic_context.to_prompt.return_value = "月活用户 = COUNT(DISTINCT user_id)"

        prompt = service._build_system_prompt(None, semantic_context=semantic_context)

        assert "月活用户" in prompt

    def test_build_system_prompt_with_relationship_context(self, mock_user, mock_db):
        """Test system prompt with table relationships"""
        service = ExecutionService(user=mock_user, db=mock_db, language="zh")

        # Create mock relationship context
        relationship_context = MagicMock(spec=RelationshipContext)
        relationship_context.relationships = [MagicMock()]
        relationship_context.to_prompt.return_value = "users.id -> orders.user_id"

        prompt = service._build_system_prompt(None, relationship_context=relationship_context)

        assert "users.id" in prompt

    def test_build_system_prompt_python_instructions(self, mock_user, mock_db):
        """Test that Python instructions are in prompt"""
        service = ExecutionService(user=mock_user, db=mock_db, language="zh")
        prompt = service._build_system_prompt(None)

        # Check Python-related instructions
        assert "python" in prompt.lower()
        assert "matplotlib" in prompt.lower() or "plt" in prompt.lower()
        assert "df" in prompt  # DataFrame reference


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
