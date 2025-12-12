"""数据库表定义"""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDMixin


class User(Base, UUIDMixin, TimestampMixin):
    """用户表"""

    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(100))
    avatar_url: Mapped[str | None] = mapped_column(String(500))
    role: Mapped[str] = mapped_column(String(20), default="user")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    settings: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    # 关系
    connections: Mapped[list["Connection"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    models: Mapped[list["Model"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    conversations: Mapped[list["Conversation"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    semantic_terms: Mapped[list["SemanticTerm"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Connection(Base, UUIDMixin, TimestampMixin):
    """数据库连接表"""

    __tablename__ = "connections"

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    driver: Mapped[str] = mapped_column(String(20), nullable=False)  # mysql, postgresql, sqlite
    host: Mapped[str | None] = mapped_column(String(255))
    port: Mapped[int | None] = mapped_column(Integer)
    username: Mapped[str | None] = mapped_column(String(100))
    password_encrypted: Mapped[str | None] = mapped_column(Text)
    database_name: Mapped[str | None] = mapped_column(String(100))
    extra_options: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)

    # 关系
    user: Mapped["User"] = relationship(back_populates="connections")


class Model(Base, UUIDMixin, TimestampMixin):
    """模型配置表"""

    __tablename__ = "models"

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)  # openai, anthropic, ollama
    model_id: Mapped[str] = mapped_column(String(100), nullable=False)  # gpt-4o, claude-3-5-sonnet
    base_url: Mapped[str | None] = mapped_column(String(500))
    api_key_encrypted: Mapped[str | None] = mapped_column(Text)
    extra_options: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # 关系
    user: Mapped["User"] = relationship(back_populates="models")


class Conversation(Base, UUIDMixin, TimestampMixin):
    """对话表"""

    __tablename__ = "conversations"

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    connection_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("connections.id", ondelete="SET NULL")
    )
    model_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("models.id", ondelete="SET NULL")
    )
    title: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(
        String(20), default="active", index=True
    )  # active, completed, error
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    extra_data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    # 关系
    user: Mapped["User"] = relationship(back_populates="conversations")
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
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # user, assistant, system
    content: Mapped[str] = mapped_column(Text, nullable=False)
    extra_data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    # 关系
    conversation: Mapped["Conversation"] = relationship(back_populates="messages")


class RefreshToken(Base, UUIDMixin):
    """刷新令牌表"""

    __tablename__ = "refresh_tokens"

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column()


class SemanticTerm(Base, UUIDMixin, TimestampMixin):
    """语义术语表 - 业务术语字典"""

    __tablename__ = "semantic_terms"

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    connection_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("connections.id", ondelete="CASCADE")
    )
    term: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    expression: Mapped[str] = mapped_column(Text, nullable=False)
    term_type: Mapped[str] = mapped_column(
        String(20), default="metric"
    )  # metric, dimension, filter, alias
    description: Mapped[str | None] = mapped_column(Text)
    examples: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # 关系
    user: Mapped["User"] = relationship(back_populates="semantic_terms")
    connection: Mapped["Connection | None"] = relationship()


class TableRelationship(Base, UUIDMixin, TimestampMixin):
    """表关系定义 - 用于多表 JOIN"""

    __tablename__ = "table_relationships"

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    connection_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("connections.id", ondelete="CASCADE"), nullable=False
    )
    source_table: Mapped[str] = mapped_column(String(100), nullable=False)
    source_column: Mapped[str] = mapped_column(String(100), nullable=False)
    target_table: Mapped[str] = mapped_column(String(100), nullable=False)
    target_column: Mapped[str] = mapped_column(String(100), nullable=False)
    relationship_type: Mapped[str] = mapped_column(String(10), default="1:N")  # 1:1, 1:N, N:1, N:M
    join_type: Mapped[str] = mapped_column(String(20), default="LEFT")  # LEFT, INNER, RIGHT, FULL
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # 关系
    user: Mapped["User"] = relationship()
    connection: Mapped["Connection"] = relationship()


# SchemaLayout 已移至独立的 SQLite 元数据库 (app/db/metadata.py)
# 不再使用主数据库存储布局配置
