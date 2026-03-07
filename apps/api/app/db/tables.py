"""数据库表定义"""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDMixin


class Connection(Base, UUIDMixin, TimestampMixin):
    """数据库连接表"""

    __tablename__ = "connections"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    driver: Mapped[str] = mapped_column(String(20), nullable=False)  # mysql, postgresql, sqlite
    host: Mapped[str | None] = mapped_column(String(255))
    port: Mapped[int | None] = mapped_column(Integer)
    username: Mapped[str | None] = mapped_column(String(100))
    password_encrypted: Mapped[str | None] = mapped_column(Text)
    database_name: Mapped[str | None] = mapped_column(String(100))
    extra_options: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)


class Model(Base, UUIDMixin, TimestampMixin):
    """模型配置表"""

    __tablename__ = "models"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    model_id: Mapped[str] = mapped_column(String(100), nullable=False)
    base_url: Mapped[str | None] = mapped_column(String(500))
    api_key_encrypted: Mapped[str | None] = mapped_column(Text)
    extra_options: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Conversation(Base, UUIDMixin, TimestampMixin):
    """对话表"""

    __tablename__ = "conversations"

    connection_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("connections.id", ondelete="SET NULL")
    )
    model_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("models.id", ondelete="SET NULL")
    )
    title: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    extra_data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan", order_by="Message.created_at"
    )


class Message(Base, UUIDMixin):
    """消息表"""

    __tablename__ = "messages"

    conversation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    extra_data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    conversation: Mapped["Conversation"] = relationship(back_populates="messages")


class AppSettings(Base, TimestampMixin):
    """单工作区设置表"""

    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    default_model_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("models.id", ondelete="SET NULL")
    )
    default_connection_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("connections.id", ondelete="SET NULL")
    )
    context_rounds: Mapped[int] = mapped_column(Integer, default=5)
    python_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    diagnostics_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    auto_repair_enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class SemanticTerm(Base, UUIDMixin, TimestampMixin):
    """业务术语字典"""

    __tablename__ = "semantic_terms"

    connection_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("connections.id", ondelete="CASCADE")
    )
    term: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    expression: Mapped[str] = mapped_column(Text, nullable=False)
    term_type: Mapped[str] = mapped_column(String(20), default="metric")
    description: Mapped[str | None] = mapped_column(Text)
    examples: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    connection: Mapped["Connection | None"] = relationship()


class TableRelationship(Base, UUIDMixin, TimestampMixin):
    """表关系定义"""

    __tablename__ = "table_relationships"

    connection_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("connections.id", ondelete="CASCADE"), nullable=False
    )
    source_table: Mapped[str] = mapped_column(String(100), nullable=False)
    source_column: Mapped[str] = mapped_column(String(100), nullable=False)
    target_table: Mapped[str] = mapped_column(String(100), nullable=False)
    target_column: Mapped[str] = mapped_column(String(100), nullable=False)
    relationship_type: Mapped[str] = mapped_column(String(10), default="1:N")
    join_type: Mapped[str] = mapped_column(String(20), default="LEFT")
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    connection: Mapped["Connection"] = relationship()


class Prompt(Base, UUIDMixin, TimestampMixin):
    """提示词模板表"""

    __tablename__ = "prompts"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    parent_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("prompts.id", ondelete="SET NULL")
    )

    parent: Mapped["Prompt | None"] = relationship(remote_side="Prompt.id")


# SchemaLayout 已移至独立的 SQLite 元数据库 (app/db/metadata.py)
