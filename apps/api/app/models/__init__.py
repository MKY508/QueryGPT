"""Pydantic 数据模型 - API 契约定义"""

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
    AppSettings,
    AppSettingsUpdate,
    ConnectionCreate,
    ConnectionResponse,
    ConnectionTest,
    ModelCreate,
    ModelExtraOptions,
    ModelResponse,
    ModelTest,
    SystemCapabilities,
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
    "ModelExtraOptions",
    "ModelResponse",
    "ModelTest",
    "ConnectionCreate",
    "ConnectionResponse",
    "ConnectionTest",
    "AppSettings",
    "AppSettingsUpdate",
    "SystemCapabilities",
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
