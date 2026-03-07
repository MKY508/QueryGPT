"""
AI 执行服务
使用 gptme 作为执行引擎
"""

from collections.abc import AsyncGenerator, Callable
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tables import Connection, Model
from app.models import RelationshipContext, SemanticContext, SSEEvent, SystemCapabilities
from app.services.app_settings import detect_system_capabilities
from app.services.execution_context import ExecutionContextResolver
from app.services.system_prompt_builder import build_system_prompt

logger = structlog.get_logger()


@dataclass(frozen=True)
class ExecutionInputs:
    model_config: dict[str, Any]
    db_config: dict[str, Any] | None
    semantic_context: SemanticContext
    relationship_context: RelationshipContext
    default_prompt: str | None
    history: list[dict[str, str]]
    capabilities: SystemCapabilities


class ExecutionService:
    """AI 执行服务"""

    def __init__(
        self,
        db: AsyncSession,
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
        self.resolver = ExecutionContextResolver(
            db,
            model_name=model_name,
            connection_id=connection_id,
            language=language,
            context_rounds=self.context_rounds,
            settings_data=self.settings_data,
        )

    def _workspace_settings(self) -> dict[str, Any]:
        return self.resolver.workspace_settings()

    def _capabilities(self) -> SystemCapabilities:
        return detect_system_capabilities(self._workspace_settings())

    async def _get_model_record(self) -> Model | None:
        return await self.resolver.get_model_record()

    async def _get_model_config(self) -> dict[str, Any]:
        """获取模型配置"""
        return await self.resolver.get_model_config()

    async def _get_connection_record(self) -> Connection | None:
        return await self.resolver.get_connection_record()

    async def _get_connection_config(self) -> dict[str, Any] | None:
        """获取数据库连接配置"""
        return await self.resolver.get_connection_config()

    async def _get_semantic_context(self) -> SemanticContext:
        """获取语义上下文"""
        return await self.resolver.get_semantic_context()

    async def _get_relationship_context(self, max_relationships: int = 15) -> RelationshipContext:
        """获取表关系上下文

        Args:
            max_relationships: 最大注入关系数量，防止超过 token 限制
        """
        return await self.resolver.get_relationship_context(max_relationships=max_relationships)

    async def _get_default_prompt(self) -> str | None:
        """获取默认提示词"""
        return await self.resolver.get_default_prompt()

    async def _get_conversation_history(
        self,
        conversation_id: UUID,
        limit: int = 10,
        exclude_message_id: UUID | None = None,
    ) -> list[dict[str, str]]:
        """获取对话历史消息

        Args:
            conversation_id: 对话 ID
            limit: 最大消息数量（最近的 N 条）

        Returns:
            消息列表 [{"role": "user/assistant", "content": "..."}]
        """
        history = await self.resolver.get_conversation_history(
            conversation_id,
            limit=limit,
            exclude_message_id=exclude_message_id,
        )
        logger.info(
            "Loaded conversation history", count=len(history), conversation_id=str(conversation_id)
        )
        return history

    async def _load_execution_inputs(
        self,
        *,
        conversation_id: UUID,
        exclude_message_id: UUID | None = None,
    ) -> ExecutionInputs:
        history_limit = max(self.context_rounds * 2, 1)
        model_config = await self._get_model_config()
        db_config = await self._get_connection_config()
        semantic_context = await self._get_semantic_context()
        relationship_context = await self._get_relationship_context()
        default_prompt = await self._get_default_prompt()
        history = await self._get_conversation_history(
            conversation_id,
            limit=history_limit,
            exclude_message_id=exclude_message_id,
        )
        capabilities = self._capabilities()
        logger.info(
            "Execution inputs resolved",
            conversation_id=str(conversation_id),
            model=model_config.get("model"),
            connection_driver=db_config.get("driver") if db_config else None,
            semantic_terms=len(semantic_context.terms),
            relationships=len(relationship_context.relationships),
            history_count=len(history),
            prompt_source="custom" if default_prompt else "builtin",
        )
        return ExecutionInputs(
            model_config=model_config,
            db_config=db_config,
            semantic_context=semantic_context,
            relationship_context=relationship_context,
            default_prompt=default_prompt,
            history=history,
            capabilities=capabilities,
        )

    @staticmethod
    def _build_engine(inputs: ExecutionInputs):
        from app.services.gptme_engine import GptmeEngine

        return GptmeEngine(
            model=inputs.model_config.get("model"),
            provider=inputs.model_config.get("provider"),
            api_key=inputs.model_config.get("api_key"),
            base_url=inputs.model_config.get("base_url"),
            headers=inputs.model_config.get("headers"),
            query_params=inputs.model_config.get("query_params"),
            python_enabled=inputs.capabilities.python_enabled,
            diagnostics_enabled=inputs.capabilities.diagnostics_enabled,
            auto_repair_enabled=inputs.capabilities.auto_repair_enabled,
            available_python_libraries=inputs.capabilities.available_python_libraries,
            analytics_installed=inputs.capabilities.analytics_installed,
        )

    async def get_runtime_snapshot(self) -> dict[str, Any]:
        model_config = await self._get_model_config()
        connection = await self._get_connection_record()
        source_provider = model_config.get("source_provider")
        resolved_provider = model_config.get("resolved_provider") or model_config.get("provider")
        api_format = model_config.get("api_format")
        if source_provider and resolved_provider and source_provider != resolved_provider:
            provider_summary = f"{source_provider} -> {resolved_provider} · {api_format}"
        else:
            provider_summary = (
                f"{source_provider} · {api_format}" if source_provider else api_format
            )

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

    async def execute_stream(
        self,
        query: str,
        conversation_id: UUID,
        exclude_message_id: UUID | None = None,
        stop_checker: Callable[[], bool] | None = None,
    ) -> AsyncGenerator[SSEEvent, None]:
        """流式执行查询"""
        try:
            inputs = await self._load_execution_inputs(
                conversation_id=conversation_id,
                exclude_message_id=exclude_message_id,
            )
            system_prompt = self._build_system_prompt(
                inputs.db_config,
                inputs.semantic_context,
                inputs.relationship_context,
                inputs.default_prompt,
                inputs.capabilities,
            )
            engine = self._build_engine(inputs)
            logger.info(
                "Starting engine execution",
                conversation_id=str(conversation_id),
                model=inputs.model_config.get("model"),
            )
            async for event in engine.execute(
                query=query,
                system_prompt=system_prompt,
                db_config=inputs.db_config,
                history=inputs.history,
                stop_checker=stop_checker,
            ):
                yield event
        except Exception as exc:
            logger.exception(
                "Execution stream failed",
                conversation_id=str(conversation_id),
                error=str(exc),
            )
            yield SSEEvent.error(
                "EXECUTION_ERROR",
                str(exc),
                error_category="execution",
                failed_stage="execution",
            )

    def _build_system_prompt(
        self,
        db_config: dict[str, Any] | None,
        semantic_context: SemanticContext | None = None,
        relationship_context: RelationshipContext | None = None,
        default_prompt: str | None = None,
        capabilities: SystemCapabilities | None = None,
    ) -> str:
        """构建系统提示"""
        return build_system_prompt(
            language=self.language,
            db_config=db_config,
            semantic_context=semantic_context,
            relationship_context=relationship_context,
            default_prompt=default_prompt,
            capabilities=capabilities or self._capabilities(),
        )
