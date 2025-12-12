"""Pydantic 数据模型 - API 契约定义"""

from app.models.auth import (
    Token,
    TokenPayload,
    UserCreate,
    UserLogin,
    UserResponse,
    UserUpdate,
)
from app.models.chat import (
    ChatRequest,
    ChatStopRequest,
    SSEEvent,
    SSEEventType,
)
from app.models.common import (
    APIResponse,
    ErrorDetail,
    PaginatedResponse,
)
from app.models.config import (
    ConnectionCreate,
    ConnectionResponse,
    ConnectionTest,
    ModelCreate,
    ModelResponse,
    ModelTest,
    UserConfig,
)
from app.models.history import (
    ConversationCreate,
    ConversationResponse,
    ConversationSummary,
    MessageCreate,
    MessageResponse,
)
from app.models.schema import (
    ColumnInfo,
    RelationshipContext,
    RelationshipSuggestion,
    SchemaInfo,
    SchemaLayoutCreate,
    SchemaLayoutListItem,
    SchemaLayoutResponse,
    SchemaLayoutUpdate,
    TableInfo,
    TableRelationshipBatchCreate,
    TableRelationshipCreate,
    TableRelationshipResponse,
    TableRelationshipUpdate,
)
from app.models.semantic import (
    SemanticContext,
    SemanticTermCreate,
    SemanticTermResponse,
    SemanticTermUpdate,
)

__all__ = [
    # Auth
    "UserCreate",
    "UserLogin",
    "UserResponse",
    "UserUpdate",
    "Token",
    "TokenPayload",
    # Chat
    "ChatRequest",
    "ChatStopRequest",
    "SSEEvent",
    "SSEEventType",
    # Common
    "APIResponse",
    "ErrorDetail",
    "PaginatedResponse",
    # Config
    "ModelCreate",
    "ModelResponse",
    "ModelTest",
    "ConnectionCreate",
    "ConnectionResponse",
    "ConnectionTest",
    "UserConfig",
    # History
    "ConversationCreate",
    "ConversationResponse",
    "ConversationSummary",
    "MessageCreate",
    "MessageResponse",
    # Semantic
    "SemanticTermCreate",
    "SemanticTermUpdate",
    "SemanticTermResponse",
    "SemanticContext",
    # Schema
    "ColumnInfo",
    "TableInfo",
    "SchemaInfo",
    "TableRelationshipCreate",
    "TableRelationshipUpdate",
    "TableRelationshipResponse",
    "TableRelationshipBatchCreate",
    "RelationshipSuggestion",
    "RelationshipContext",
    # Layout
    "SchemaLayoutCreate",
    "SchemaLayoutUpdate",
    "SchemaLayoutResponse",
    "SchemaLayoutListItem",
]
