"""Context resolution helpers for the execution service."""

from collections.abc import Callable
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import encryptor
from app.core.config import settings
from app.db.tables import Connection, Message, Model, Prompt, SemanticTerm, TableRelationship
from app.models import (
    RelationshipContext,
    SemanticContext,
    SemanticTermResponse,
    TableRelationshipResponse,
)
from app.services.model_runtime import resolve_model_runtime


class ExecutionContextResolver:
    def __init__(
        self,
        db: AsyncSession,
        *,
        model_name: str | None = None,
        connection_id: UUID | None = None,
        language: str = "zh",
        context_rounds: int = 5,
        settings_data: dict[str, Any] | None = None,
    ):
        self.db = db
        self.model_name = model_name
        self.connection_id = connection_id
        self.language = language
        self.context_rounds = max(context_rounds, 1)
        self.settings_data = settings_data or {}
        self._resolved_model_record: Model | None = None
        self._resolved_connection_record: Connection | None = None
        self._resolved_model_config: dict[str, Any] | None = None
        self._resolved_connection_config: dict[str, Any] | None = None

    def workspace_settings(self) -> dict[str, Any]:
        return self.settings_data if isinstance(self.settings_data, dict) else {}

    async def get_model_record(self) -> Model | None:
        if self._resolved_model_record is not None:
            return self._resolved_model_record

        model: Model | None = None
        if self.model_name:
            try:
                model_uuid = UUID(self.model_name)
                result = await self.db.execute(
                    select(Model).where(
                        Model.id == model_uuid,
                        Model.is_active.is_(True),
                    )
                )
            except ValueError:
                result = await self.db.execute(
                    select(Model).where(
                        Model.model_id == self.model_name,
                        Model.is_active.is_(True),
                    )
                )
            model = result.scalar_one_or_none()
        else:
            settings_data = self.workspace_settings()
            default_model_id = settings_data.get("default_model_id")
            if default_model_id:
                try:
                    result = await self.db.execute(
                        select(Model).where(
                            Model.id == UUID(str(default_model_id)),
                            Model.is_active.is_(True),
                        )
                    )
                    model = result.scalar_one_or_none()
                except ValueError:
                    model = None

            if model is None:
                result = await self.db.execute(
                    select(Model).where(
                        Model.is_default,
                        Model.is_active.is_(True),
                    )
                )
                model = result.scalar_one_or_none()

        self._resolved_model_record = model
        return model

    async def get_model_config(self) -> dict[str, Any]:
        if self._resolved_model_config is not None:
            return self._resolved_model_config

        model = await self.get_model_record()
        api_key = None
        if model and model.api_key_encrypted:
            try:
                api_key = encryptor.decrypt(model.api_key_encrypted)
            except Exception:
                api_key = None

        resolved, extra_options = resolve_model_runtime(
            model,
            fallback_model=settings.DEFAULT_MODEL,
            fallback_api_key=api_key or settings.OPENAI_API_KEY,
            fallback_base_url=settings.OPENAI_BASE_URL,
        )

        self._resolved_model_config = {
            "provider": resolved.litellm_provider,
            "resolved_provider": resolved.litellm_provider,
            "source_provider": resolved.source_provider,
            "model": resolved.model,
            "display_name": resolved.display_name,
            "base_url": resolved.base_url,
            "api_key": resolved.api_key,
            "api_format": resolved.api_format,
            "api_key_required": resolved.api_key_required,
            "headers": resolved.headers,
            "query_params": resolved.query_params,
            "healthcheck_mode": resolved.healthcheck_mode,
            "extra_options": extra_options.model_dump(),
            "model_id": str(model.id) if model else None,
        }
        return self._resolved_model_config

    async def get_connection_record(self) -> Connection | None:
        if self._resolved_connection_record is not None:
            return self._resolved_connection_record

        connection: Connection | None = None
        if self.connection_id:
            result = await self.db.execute(select(Connection).where(Connection.id == self.connection_id))
            connection = result.scalar_one_or_none()
        else:
            settings_data = self.workspace_settings()
            default_connection_id = settings_data.get("default_connection_id")
            if default_connection_id:
                try:
                    result = await self.db.execute(
                        select(Connection).where(Connection.id == UUID(str(default_connection_id)))
                    )
                    connection = result.scalar_one_or_none()
                except ValueError:
                    connection = None

            if connection is None:
                result = await self.db.execute(select(Connection).where(Connection.is_default))
                connection = result.scalar_one_or_none()

        self._resolved_connection_record = connection
        return connection

    async def get_connection_config(self) -> dict[str, Any] | None:
        if self._resolved_connection_config is not None:
            return self._resolved_connection_config

        connection = await self.get_connection_record()
        if not connection:
            return None

        password = None
        if connection.password_encrypted:
            try:
                password = encryptor.decrypt(connection.password_encrypted)
            except Exception:
                password = None

        self._resolved_connection_config = {
            "driver": connection.driver,
            "host": connection.host,
            "port": connection.port,
            "user": connection.username,
            "password": password,
            "database": connection.database_name,
        }
        return self._resolved_connection_config

    async def get_semantic_context(self) -> SemanticContext:
        connection = await self.get_connection_record()
        resolved_connection_id = connection.id if connection else None
        query = select(SemanticTerm).where(SemanticTerm.is_active.is_(True))

        if resolved_connection_id:
            query = query.where(
                (SemanticTerm.connection_id.is_(None))
                | (SemanticTerm.connection_id == resolved_connection_id)
            )
        else:
            query = query.where(SemanticTerm.connection_id.is_(None))

        result = await self.db.execute(query.order_by(SemanticTerm.term))
        terms = result.scalars().all()
        return SemanticContext(terms=[SemanticTermResponse.model_validate(t) for t in terms])

    async def get_relationship_context(self, max_relationships: int = 15) -> RelationshipContext:
        connection = await self.get_connection_record()
        if not connection:
            return RelationshipContext(relationships=[])

        result = await self.db.execute(
            select(TableRelationship)
            .where(
                TableRelationship.connection_id == connection.id,
                TableRelationship.is_active.is_(True),
            )
            .limit(max_relationships)
        )
        relationships = result.scalars().all()
        return RelationshipContext(
            relationships=[TableRelationshipResponse.model_validate(r) for r in relationships]
        )

    async def get_default_prompt(self) -> str | None:
        result = await self.db.execute(
            select(Prompt).where(
                Prompt.is_default.is_(True),
                Prompt.is_active.is_(True),
            )
        )
        prompt = result.scalar_one_or_none()
        return prompt.content if prompt else None

    async def get_conversation_history(
        self,
        conversation_id: UUID,
        limit: int = 10,
        exclude_message_id: UUID | None = None,
    ) -> list[dict[str, str]]:
        query = select(Message).where(Message.conversation_id == conversation_id)
        if exclude_message_id:
            query = query.where(Message.id != exclude_message_id)
        result = await self.db.execute(query.order_by(Message.created_at.desc()).limit(limit))
        messages = result.scalars().all()

        history: list[dict[str, str]] = []
        for msg in reversed(messages):
            if msg.role in ("user", "assistant") and msg.content:
                history.append({"role": msg.role, "content": msg.content})
        return history

    async def get_runtime_snapshot(self) -> dict[str, Any]:
        model_config = await self.get_model_config()
        connection = await self.get_connection_record()
        source_provider = model_config.get("source_provider")
        resolved_provider = model_config.get("resolved_provider") or model_config.get("provider")
        api_format = model_config.get("api_format")
        if source_provider and resolved_provider and source_provider != resolved_provider:
            provider_summary = f"{source_provider} -> {resolved_provider} · {api_format}"
        else:
            provider_summary = f"{source_provider} · {api_format}" if source_provider else api_format

        return {
            "model_id": model_config.get("model_id"),
            "model_name": model_config.get("display_name"),
            "model_identifier": model_config.get("model"),
            "source_provider": source_provider,
            "resolved_provider": resolved_provider,
            "provider_summary": provider_summary,
            "connection_id": str(connection.id) if connection else None,
            "connection_name": connection.name if connection else None,
            "connection_driver": connection.driver if connection else None,
            "connection_host": connection.host if connection else None,
            "database_name": connection.database_name if connection else None,
            "context_rounds": self.context_rounds,
            "api_format": api_format,
        }
