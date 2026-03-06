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
from app.db.tables import Connection, Message, Model, Prompt, SemanticTerm, TableRelationship, User
from app.models import (
    RelationshipContext,
    SemanticContext,
    SemanticTermResponse,
    SSEEvent,
    TableRelationshipResponse,
)
from app.services.model_runtime import resolve_model_runtime

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
        context_rounds: int = 5,
    ):
        self.user = user
        self.db = db
        self.model_name = model_name
        self.connection_id = connection_id
        self.language = language
        self.context_rounds = max(context_rounds, 1)
        self._resolved_model_record: Model | None = None
        self._resolved_connection_record: Connection | None = None
        self._resolved_model_config: dict[str, Any] | None = None
        self._resolved_connection_config: dict[str, Any] | None = None

    def _user_settings(self) -> dict[str, Any]:
        settings_data = getattr(self.user, "settings", None)
        return settings_data if isinstance(settings_data, dict) else {}

    async def _get_model_record(self) -> Model | None:
        if self._resolved_model_record is not None:
            return self._resolved_model_record

        model: Model | None = None
        if self.model_name:
            try:
                model_uuid = UUID(self.model_name)
                result = await self.db.execute(
                    select(Model).where(
                        Model.user_id == self.user.id,
                        Model.id == model_uuid,
                        Model.is_active.is_(True),
                    )
                )
            except ValueError:
                result = await self.db.execute(
                    select(Model).where(
                        Model.user_id == self.user.id,
                        Model.model_id == self.model_name,
                        Model.is_active.is_(True),
                    )
                )
            model = result.scalar_one_or_none()
        else:
            settings_data = self._user_settings()
            default_model_id = settings_data.get("default_model_id")
            if default_model_id:
                try:
                    result = await self.db.execute(
                        select(Model).where(
                            Model.user_id == self.user.id,
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
                        Model.user_id == self.user.id,
                        Model.is_default,
                        Model.is_active.is_(True),
                    )
                )
                model = result.scalar_one_or_none()

        self._resolved_model_record = model
        return model

    async def _get_model_config(self) -> dict[str, Any]:
        """获取模型配置"""
        if self._resolved_model_config is not None:
            return self._resolved_model_config

        model = await self._get_model_record()
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

    async def _get_connection_record(self) -> Connection | None:
        if self._resolved_connection_record is not None:
            return self._resolved_connection_record

        connection: Connection | None = None
        if self.connection_id:
            result = await self.db.execute(
                select(Connection).where(
                    Connection.id == self.connection_id,
                    Connection.user_id == self.user.id,
                )
            )
            connection = result.scalar_one_or_none()
        else:
            settings_data = self._user_settings()
            default_connection_id = settings_data.get("default_connection_id")
            if default_connection_id:
                try:
                    result = await self.db.execute(
                        select(Connection).where(
                            Connection.id == UUID(str(default_connection_id)),
                            Connection.user_id == self.user.id,
                        )
                    )
                    connection = result.scalar_one_or_none()
                except ValueError:
                    connection = None

            if connection is None:
                result = await self.db.execute(
                    select(Connection).where(
                        Connection.user_id == self.user.id,
                        Connection.is_default,
                    )
                )
                connection = result.scalar_one_or_none()

        self._resolved_connection_record = connection
        return connection

    async def _get_connection_config(self) -> dict[str, Any] | None:
        """获取数据库连接配置"""
        if self._resolved_connection_config is not None:
            return self._resolved_connection_config

        connection = await self._get_connection_record()

        if not connection:
            return None

        password = None
        if connection.password_encrypted:
            try:
                password = encryptor.decrypt(connection.password_encrypted)
            except Exception:
                # 解密失败，密码为空
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

    async def _get_semantic_context(self) -> SemanticContext:
        """获取语义上下文"""
        connection = await self._get_connection_record()
        resolved_connection_id = connection.id if connection else None

        # 查询用户的语义术语（全局 + 当前连接）
        query = select(SemanticTerm).where(
            SemanticTerm.user_id == self.user.id,
            SemanticTerm.is_active.is_(True),
        )

        # 如果有指定连接，获取全局术语和该连接的术语
        if resolved_connection_id:
            query = query.where(
                (SemanticTerm.connection_id.is_(None))
                | (SemanticTerm.connection_id == resolved_connection_id)
            )
        else:
            # 只获取全局术语
            query = query.where(SemanticTerm.connection_id.is_(None))

        result = await self.db.execute(query.order_by(SemanticTerm.term))
        terms = result.scalars().all()

        return SemanticContext(terms=[SemanticTermResponse.model_validate(t) for t in terms])

    async def _get_relationship_context(self, max_relationships: int = 15) -> RelationshipContext:
        """获取表关系上下文

        Args:
            max_relationships: 最大注入关系数量，防止超过 token 限制
        """
        connection = await self._get_connection_record()
        if not connection:
            return RelationshipContext(relationships=[])

        result = await self.db.execute(
            select(TableRelationship)
            .where(
                TableRelationship.user_id == self.user.id,
                TableRelationship.connection_id == connection.id,
                TableRelationship.is_active.is_(True),
            )
            .limit(max_relationships)  # 限制数量
        )
        relationships = result.scalars().all()

        return RelationshipContext(
            relationships=[TableRelationshipResponse.model_validate(r) for r in relationships]
        )

    async def _get_user_prompt(self) -> str | None:
        """获取用户自定义提示词"""
        result = await self.db.execute(
            select(Prompt).where(
                Prompt.user_id == self.user.id,
                Prompt.is_default.is_(True),
                Prompt.is_active.is_(True),
            )
        )
        prompt = result.scalar_one_or_none()
        return prompt.content if prompt else None

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
        query = select(Message).where(Message.conversation_id == conversation_id)
        if exclude_message_id:
            query = query.where(Message.id != exclude_message_id)
        result = await self.db.execute(query.order_by(Message.created_at.desc()).limit(limit))
        messages = result.scalars().all()

        # 反转顺序，使最早的消息在前
        history = []
        for msg in reversed(messages):
            if msg.role in ("user", "assistant") and msg.content:
                history.append({"role": msg.role, "content": msg.content})

        logger.info(f"Loaded {len(history)} history messages for conversation {conversation_id}")
        return history

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

            logger.info("Getting relationship context...")
            relationship_context = await self._get_relationship_context()
            logger.info(f"Relationships count: {len(relationship_context.relationships)}")

            # 获取用户自定义提示词
            logger.info("Getting user prompt...")
            user_prompt = await self._get_user_prompt()
            logger.info(f"User prompt: {'custom' if user_prompt else 'default'}")

            # 加载对话历史（排除当前用户消息，避免重复注入）
            logger.info("Getting conversation history...")
            history_limit = max(self.context_rounds * 2, 1)
            history = await self._get_conversation_history(
                conversation_id,
                limit=history_limit,
                exclude_message_id=exclude_message_id,
            )

            system_prompt = self._build_system_prompt(
                db_config, semantic_context, relationship_context, user_prompt
            )

            engine = GptmeEngine(
                model=model_config.get("model"),
                provider=model_config.get("provider"),
                api_key=model_config.get("api_key"),
                base_url=model_config.get("base_url"),
                headers=model_config.get("headers"),
                query_params=model_config.get("query_params"),
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
            yield SSEEvent.error(
                "EXECUTION_ERROR",
                str(e),
                error_category="execution",
                failed_stage="execution",
            )

    def _build_system_prompt(
        self,
        db_config: dict[str, Any] | None,
        semantic_context: SemanticContext | None = None,
        relationship_context: RelationshipContext | None = None,
        user_prompt: str | None = None,
    ) -> str:
        """构建系统提示"""
        # 如果用户有自定义提示词，使用自定义提示词作为基础
        if user_prompt:
            base_prompt = user_prompt
        elif self.language == "zh":
            base_prompt = """你是 QueryGPT 数据分析助手，负责帮助用户查询和分析数据库数据。

## 思考过程
在回答过程中，请用 [thinking: ...] 标记你的思考阶段，让用户了解你的分析过程：
- [thinking: 分析问题，确定需要查询的数据...]
- [thinking: 生成 SQL 查询...]
- [thinking: 分析查询结果...]
- [thinking: 执行数据分析...]
- [thinking: 生成可视化图表...]

## 基本规则
1. 只生成只读 SQL（SELECT、SHOW、DESCRIBE）
2. 用中文回复用户
3. SQL 代码使用 ```sql 代码块

## Python 可视化（重要！）
**当用户要求使用 Python 画图、matplotlib、或任何 Python 可视化时，你必须生成 ```python 代码块！**

工作流程：
1. 先用 SQL 查询数据
2. 然后用 Python 代码绑定数据并绑定图表
3. SQL 查询结果会自动注入为 `df` DataFrame，你可以直接使用

可用库：pandas, numpy, sklearn, matplotlib, seaborn, scipy

**简单画图示例**（用户说"用python画图"时使用这种格式）：
```python
import matplotlib.pyplot as plt

# df 已包含 SQL 查询结果
plt.figure(figsize=(10, 6))
plt.bar(df['date'].astype(str), df['amount'])
plt.xlabel('日期')
plt.ylabel('金额')
plt.title('销售数据')
plt.xticks(rotation=45)
plt.tight_layout()
plt.show()
```

**复杂分析示例**（RFM 分析 + 聚类）：
```python
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans
import matplotlib.pyplot as plt

# df 已包含 SQL 查询结果
X = StandardScaler().fit_transform(df[['recency', 'frequency', 'monetary']])
df['cluster'] = KMeans(n_clusters=4).fit_predict(X)

plt.scatter(df['recency'], df['monetary'], c=df['cluster'], cmap='viridis')
plt.xlabel('最近购买天数')
plt.ylabel('消费金额')
plt.title('用户 RFM 聚类')
plt.show()
```

## 简单图表配置（不使用 Python 时）
如果用户没有明确要求 Python，可以使用 ```chart 代码块生成简单图表：
```chart
{
  "type": "bar",
  "title": "图表标题",
  "xKey": "x轴字段名",
  "yKeys": ["y轴字段名1"]
}
```

图表类型：bar（柱状图）、line（折线图）、pie（饼图）、area（面积图）
"""
        else:
            base_prompt = """You are QueryGPT data analysis assistant, helping users query and analyze database data.

## Thinking Process
Use [thinking: ...] markers to show your analysis process:
- [thinking: Analyzing the question...]
- [thinking: Generating SQL query...]
- [thinking: Analyzing results...]
- [thinking: Performing data analysis...]
- [thinking: Creating visualization...]

## Basic Rules
1. Only generate read-only SQL (SELECT, SHOW, DESCRIBE)
2. Reply in English
3. Use ```sql code blocks for SQL

## Advanced Analysis
For complex analysis (statistics, ML, custom visualizations), use Python:
- SQL results are auto-injected as `df` DataFrame
- Available: pandas, numpy, sklearn, matplotlib, seaborn, scipy
- Use ```python code blocks
- matplotlib charts are auto-captured

## Simple Charts
Use ```chart code blocks for simple visualizations:
```chart
{
  "type": "bar",
  "title": "Chart Title",
  "xKey": "x_field",
  "yKeys": ["y_field"]
}
```

Chart types: bar, line, pie, area
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

        # 注入表关系上下文
        if relationship_context and relationship_context.relationships:
            relationship_prompt = relationship_context.to_prompt(self.language)
            base_prompt += f"\n{relationship_prompt}\n"

        return base_prompt
