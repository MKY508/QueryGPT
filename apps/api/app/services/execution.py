"""
AI 执行服务
使用 gptme 作为执行引擎
"""

from collections.abc import AsyncGenerator, Callable
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import encryptor
from app.core.config import settings
from app.db.tables import Connection, Message, Model, SemanticTerm, User
from app.models import SemanticContext, SemanticTermResponse, SSEEvent

logger = structlog.get_logger()


class ExecutionService:
    """AI 执行服务"""

    def __init__(
        self,
        user: User,
        db: AsyncSession,
        model_name: str | None = None,
        connection_id: UUID | None = None,
        language: str = "zh",
    ):
        self.user = user
        self.db = db
        self.model_name = model_name
        self.connection_id = connection_id
        self.language = language

    async def _get_model_config(self) -> dict[str, Any]:
        """获取模型配置"""
        if self.model_name:
            # 尝试用 UUID id 查询
            try:
                model_uuid = UUID(self.model_name)
                result = await self.db.execute(
                    select(Model).where(
                        Model.user_id == self.user.id,
                        Model.id == model_uuid,
                    )
                )
            except ValueError:
                # 如果不是 UUID，用 model_id 查询
                result = await self.db.execute(
                    select(Model).where(
                        Model.user_id == self.user.id,
                        Model.model_id == self.model_name,
                    )
                )
            model = result.scalar_one_or_none()
        else:
            result = await self.db.execute(
                select(Model).where(
                    Model.user_id == self.user.id,
                    Model.is_default,
                )
            )
            model = result.scalar_one_or_none()

        if model:
            api_key = None
            if model.api_key_encrypted:
                try:
                    api_key = encryptor.decrypt(model.api_key_encrypted)
                except Exception:
                    # 解密失败，使用默认 API key
                    api_key = None

            return {
                "provider": model.provider,
                "model": model.model_id,
                "base_url": model.base_url,
                "api_key": api_key or settings.OPENAI_API_KEY,
            }

        return {
            "provider": "openai",
            "model": settings.DEFAULT_MODEL,
            "api_key": settings.OPENAI_API_KEY,
            "base_url": settings.OPENAI_BASE_URL,
        }

    async def _get_connection_config(self) -> dict[str, Any] | None:
        """获取数据库连接配置"""
        if self.connection_id:
            result = await self.db.execute(
                select(Connection).where(
                    Connection.id == self.connection_id,
                    Connection.user_id == self.user.id,
                )
            )
            connection = result.scalar_one_or_none()
        else:
            result = await self.db.execute(
                select(Connection).where(
                    Connection.user_id == self.user.id,
                    Connection.is_default,
                )
            )
            connection = result.scalar_one_or_none()

        if not connection:
            return None

        password = None
        if connection.password_encrypted:
            try:
                password = encryptor.decrypt(connection.password_encrypted)
            except Exception:
                # 解密失败，密码为空
                password = None

        return {
            "driver": connection.driver,
            "host": connection.host,
            "port": connection.port,
            "user": connection.username,
            "password": password,
            "database": connection.database_name,
        }

    async def _get_semantic_context(self) -> SemanticContext:
        """获取语义上下文"""
        # 查询用户的语义术语（全局 + 当前连接）
        query = select(SemanticTerm).where(
            SemanticTerm.user_id == self.user.id,
            SemanticTerm.is_active.is_(True),
        )

        # 如果有指定连接，获取全局术语和该连接的术语
        if self.connection_id:
            query = query.where(
                (SemanticTerm.connection_id.is_(None)) | (SemanticTerm.connection_id == self.connection_id)
            )
        else:
            # 只获取全局术语
            query = query.where(SemanticTerm.connection_id.is_(None))

        result = await self.db.execute(query.order_by(SemanticTerm.term))
        terms = result.scalars().all()

        return SemanticContext(
            terms=[SemanticTermResponse.model_validate(t) for t in terms]
        )

    async def _get_conversation_history(
        self, conversation_id: UUID, limit: int = 10
    ) -> list[dict[str, str]]:
        """获取对话历史消息

        Args:
            conversation_id: 对话 ID
            limit: 最大消息数量（最近的 N 条）

        Returns:
            消息列表 [{"role": "user/assistant", "content": "..."}]
        """
        result = await self.db.execute(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.desc())
            .limit(limit)
        )
        messages = result.scalars().all()

        # 反转顺序，使最早的消息在前
        history = []
        for msg in reversed(messages):
            if msg.role in ("user", "assistant") and msg.content:
                history.append({"role": msg.role, "content": msg.content})

        logger.info(f"Loaded {len(history)} history messages for conversation {conversation_id}")
        return history

    async def execute_stream(
        self,
        query: str,
        conversation_id: UUID,
        stop_checker: Callable[[], bool] | None = None,
    ) -> AsyncGenerator[SSEEvent, None]:
        """流式执行查询"""
        try:
            from app.services.gptme_engine import GptmeEngine

            logger.info("Getting model config...")
            model_config = await self._get_model_config()
            logger.info(
                "Model config loaded",
                model=model_config.get("model"),
                base_url=model_config.get("base_url"),
            )

            logger.info("Getting connection config...")
            db_config = await self._get_connection_config()
            logger.info(f"DB config: {db_config}")

            logger.info("Getting semantic context...")
            semantic_context = await self._get_semantic_context()
            logger.info(f"Semantic terms count: {len(semantic_context.terms)}")

            # 加载对话历史（不包括当前查询，因为当前查询还未保存）
            logger.info("Getting conversation history...")
            history = await self._get_conversation_history(conversation_id, limit=10)

            system_prompt = self._build_system_prompt(db_config, semantic_context)

            engine = GptmeEngine(
                model=model_config.get("model"),
                api_key=model_config.get("api_key"),
                base_url=model_config.get("base_url"),
            )

            logger.info("Starting engine.execute...")
            async for event in engine.execute(
                query=query,
                system_prompt=system_prompt,
                db_config=db_config,
                history=history,
                stop_checker=stop_checker,
            ):
                logger.info(f"Yielding event: {event.type}")
                yield event
        except Exception as e:
            logger.exception(f"Error in execute_stream: {e}")
            yield SSEEvent.error("EXECUTION_ERROR", str(e))

    def _build_system_prompt(
        self, db_config: dict[str, Any] | None, semantic_context: SemanticContext | None = None
    ) -> str:
        """构建系统提示"""
        if self.language == "zh":
            base_prompt = """你是 QueryGPT 数据分析助手，负责帮助用户查询和分析数据库数据。

请遵循以下规则：
1. 只生成只读 SQL（SELECT、SHOW、DESCRIBE）
2. 用中文回复用户
3. 如果查询结果适合可视化，在回复末尾添加图表配置（使用 ```chart 代码块）：

```chart
{
  "type": "bar",
  "title": "图表标题",
  "xKey": "x轴字段名",
  "yKeys": ["y轴字段名1", "y轴字段名2"]
}
```

图表类型选择指南：
- bar: 比较不同类别的数值（如各地区销售额）
- line: 展示趋势变化（如月度增长）
- pie: 展示占比分布（如市场份额）
- area: 展示累积趋势

注意：只有当数据适合可视化时才添加图表配置，简单的单值查询不需要图表。
"""
        else:
            base_prompt = """You are QueryGPT data analysis assistant, helping users query and analyze database data.

Follow these rules:
1. Only generate read-only SQL (SELECT, SHOW, DESCRIBE)
2. Reply in English
3. If query results are suitable for visualization, add chart config at the end (using ```chart code block):

```chart
{
  "type": "bar",
  "title": "Chart Title",
  "xKey": "x_axis_field",
  "yKeys": ["y_axis_field1", "y_axis_field2"]
}
```

Chart type guide:
- bar: Compare values across categories
- line: Show trends over time
- pie: Show proportions/percentages
- area: Show cumulative trends

Note: Only add chart config when data is suitable for visualization.
"""

        if db_config:
            db_info = f"""
数据库连接信息:
- 类型: {db_config["driver"]}
- 主机: {db_config["host"]}:{db_config["port"]}
- 数据库: {db_config["database"]}
"""
            base_prompt += db_info

        # 注入语义上下文
        if semantic_context and semantic_context.terms:
            semantic_prompt = semantic_context.to_prompt(self.language)
            base_prompt += f"\n{semantic_prompt}\n"

        return base_prompt
