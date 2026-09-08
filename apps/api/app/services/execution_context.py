"""Context resolution helpers for the execution service."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import encryptor
from app.core.config import settings
from app.db.tables import Connection, Message, Model
from app.services.conversation_context import compact_assistant_message_context
from app.services.model_runtime import (
    ModelCredentialError,
    ModelRuntimeConfigurationError,
    ModelSelectionError,
    ResolvedModelConfig,
    resolve_model_runtime,
)


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
        allow_default_connection_fallback: bool = True,
    ):
        self.db = db
        self.model_name = model_name
        self.connection_id = connection_id
        self.language = language
        self.context_rounds = max(context_rounds, 1)
        self.settings_data = settings_data or {}
        self.allow_default_connection_fallback = allow_default_connection_fallback
        self._resolved_model_record: Model | None = None
        self._resolved_connection_record: Connection | None = None
        self._resolved_model_config: ResolvedModelConfig | None = None
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
                    select(Model)
                    .where(
                        Model.model_id == self.model_name,
                        Model.is_active.is_(True),
                    )
                    .order_by(Model.updated_at.desc(), Model.created_at.desc())
                )
            model = result.scalars().first()
            if model is None:
                raise ModelSelectionError("选择的分析服务不存在或已停用")
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
                    select(Model)
                    .where(
                        Model.is_default,
                        Model.is_active.is_(True),
                    )
                    .order_by(Model.updated_at.desc(), Model.created_at.desc())
                )
                # is_default is retained as a compatibility fallback for older
                # workspaces. AppSettings.default_model_id remains canonical.
                model = result.scalars().first()

        self._resolved_model_record = model
        return model

    async def record_model_health(
        self,
        *,
        healthy: bool,
        error_category: str | None = None,
        response_time_ms: int | None = None,
        commit: bool = True,
    ) -> None:
        """Persist evidence for the selected stored model, never an env fallback."""

        model = self._resolved_model_record
        if model is None:
            return
        model.health_status = "healthy" if healthy else "unhealthy"
        model.last_checked_at = datetime.now(UTC)
        model.last_error_category = None if healthy else (error_category or "unknown")
        model.last_response_time_ms = response_time_ms if healthy else None
        if commit:
            await self.db.commit()

    async def get_model_config(self) -> ResolvedModelConfig:
        if self._resolved_model_config is not None:
            return self._resolved_model_config

        model = await self.get_model_record()
        try:
            resolved, _ = resolve_model_runtime(
                model,
                fallback_model=settings.DEFAULT_MODEL,
                fallback_api_key=settings.OPENAI_API_KEY if model is None else None,
                fallback_base_url=settings.OPENAI_BASE_URL if model is None else None,
            )
        except ModelCredentialError:
            await self.record_model_health(healthy=False, error_category="auth")
            raise
        except ModelRuntimeConfigurationError:
            await self.record_model_health(healthy=False, error_category="model_endpoint")
            raise

        self._resolved_model_config = resolved
        return self._resolved_model_config

    async def get_connection_record(self) -> Connection | None:
        if self._resolved_connection_record is not None:
            return self._resolved_connection_record

        connection: Connection | None = None
        if self.connection_id:
            result = await self.db.execute(
                select(Connection).where(Connection.id == self.connection_id)
            )
            connection = result.scalar_one_or_none()
        elif self.allow_default_connection_fallback:
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
            "extra_options": connection.extra_options or {},
        }
        return self._resolved_connection_config

    async def get_conversation_history(
        self,
        conversation_id: UUID,
        limit: int = 10,
        exclude_message_id: UUID | None = None,
    ) -> list[dict[str, Any]]:
        query = select(Message).where(
            Message.conversation_id == conversation_id,
            Message.role.in_(("user", "assistant")),
            Message.content != "",
        )
        if exclude_message_id:
            query = query.where(Message.id != exclude_message_id)
        result = await self.db.execute(query.order_by(Message.created_at.desc()).limit(limit))
        messages = result.scalars().all()

        history: list[dict[str, Any]] = []
        for msg in reversed(messages):
            if msg.role in ("user", "assistant") and msg.content:
                item: dict[str, Any] = {"role": msg.role, "content": msg.content}
                if msg.role == "assistant":
                    extra_data = msg.extra_data or {}
                    item.update(compact_assistant_message_context(extra_data))
                    report = extra_data.get("report") or {}
                    confirmation = report.get("confirmation")
                    if confirmation:
                        item["confirmation"] = confirmation
                history.append(item)
        return history

    async def get_runtime_snapshot(self) -> dict[str, Any]:
        model_config = await self.get_model_config()
        connection = await self.get_connection_record()
        return {
            **model_config.public_snapshot(diagnostics=True),
            "connection_id": str(connection.id) if connection else None,
            "connection_name": connection.name if connection else None,
            "connection_driver": connection.driver if connection else None,
            "connection_host": connection.host if connection else None,
            "database_name": connection.database_name if connection else None,
            "context_rounds": self.context_rounds,
        }
