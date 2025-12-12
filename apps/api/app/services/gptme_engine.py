"""
gptme 执行引擎封装
使用 LiteLLM 进行 AI 调用，支持 SQL 执行和结果捕获
"""
import json
import os
import re
import time
from typing import Any, AsyncGenerator, Callable

import structlog

from app.core.config import settings
from app.models import SSEEvent
from app.services.database import create_database_manager

logger = structlog.get_logger()


class GptmeEngine:
    """AI 执行引擎"""

    def __init__(
        self,
        model: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: int = 300,
    ):
        self.model = model or settings.GPTME_MODEL or settings.DEFAULT_MODEL
        self.api_key = api_key or settings.OPENAI_API_KEY
        self.base_url = base_url or settings.OPENAI_BASE_URL
        self.timeout = timeout or settings.GPTME_TIMEOUT

    async def execute(
        self,
        query: str,
        system_prompt: str,
        db_config: dict[str, Any] | None = None,
        stop_checker: Callable[[], bool] | None = None,
    ) -> AsyncGenerator[SSEEvent, None]:
        """
        执行查询并流式返回结果
        """
        logger.info("GptmeEngine.execute called", model=self.model, query_preview=query[:50])

        try:
            # 设置环境变量
            if self.api_key:
                os.environ["OPENAI_API_KEY"] = self.api_key
                logger.info("API key set")
            if self.base_url:
                os.environ["OPENAI_BASE_URL"] = self.base_url
                logger.info("Base URL set", base_url=self.base_url)

            logger.info("Yielding initializing event...")
            yield SSEEvent.progress("initializing", "正在初始化 AI 引擎...")

            # 使用 LiteLLM 执行
            async for event in self._execute_with_litellm(
                query=query,
                system_prompt=system_prompt,
                db_config=db_config,
                stop_checker=stop_checker,
            ):
                yield event

        except Exception as e:
            yield SSEEvent.error("EXECUTION_ERROR", str(e))

    async def _execute_with_litellm(
        self,
        query: str,
        system_prompt: str,
        db_config: dict[str, Any] | None = None,
        stop_checker: Callable[[], bool] | None = None,
    ) -> AsyncGenerator[SSEEvent, None]:
        """使用 LiteLLM 执行查询"""
        try:
            import litellm

            messages = [
                {"role": "system", "content": system_prompt},
            ]

            if db_config:
                db_context = self._build_db_context(db_config)
                messages.append({"role": "system", "content": db_context})

            messages.append({"role": "user", "content": query})

            yield SSEEvent.progress("generating", "正在生成响应...")

            # 流式调用
            response = await litellm.acompletion(
                model=self.model,
                messages=messages,
                stream=True,
                api_key=self.api_key,
                base_url=self.base_url,
            )

            full_content = ""
            async for chunk in response:
                if stop_checker and stop_checker():
                    break

                delta = chunk.choices[0].delta
                if delta.content:
                    full_content += delta.content

            # 解析结果
            sql_code = self._extract_sql(full_content)

            # 如果有 SQL 和数据库配置，尝试执行
            data = None
            rows_count = None
            execution_time = None
            visualization = None

            if sql_code and db_config:
                yield SSEEvent.progress("executing", "正在执行 SQL 查询...")
                start_time = time.time()

                try:
                    data, rows_count = await self._execute_sql(sql_code, db_config)
                    execution_time = time.time() - start_time

                    # 尝试生成可视化
                    if data and len(data) > 0:
                        visualization = self._generate_visualization(data, query)
                except Exception as e:
                    full_content += f"\n\n⚠️ SQL 执行错误: {str(e)}"

            yield SSEEvent.result(
                content=full_content,
                sql=sql_code,
                data=data,
                rows_count=rows_count,
                execution_time=execution_time,
            )

            if visualization:
                yield SSEEvent.visualization(
                    chart_type=visualization.get("type", "bar"),
                    chart_data=visualization.get("data", {}),
                )

        except Exception as e:
            yield SSEEvent.error("LITELLM_ERROR", str(e))

    async def _execute_sql(
        self,
        sql: str,
        db_config: dict[str, Any],
    ) -> tuple[list[dict] | None, int | None]:
        """执行 SQL 查询"""
        db_manager = create_database_manager(db_config)
        result = db_manager.execute_query(sql, read_only=True)
        return result.data, result.rows_count

    def _generate_visualization(self, data: list[dict], query: str) -> dict | None:
        """根据数据和查询生成可视化配置"""
        if not data or len(data) == 0:
            return None

        columns = list(data[0].keys())
        if len(columns) < 2:
            return None

        x_col = columns[0]
        y_cols = []

        for col in columns[1:]:
            try:
                float(data[0][col])
                y_cols.append(col)
            except (ValueError, TypeError):
                pass

        if not y_cols:
            return None

        query_lower = query.lower()
        if any(word in query_lower for word in ["趋势", "trend", "变化", "时间", "time"]):
            chart_type = "line"
        elif any(word in query_lower for word in ["占比", "比例", "percentage", "pie"]):
            chart_type = "pie"
        else:
            chart_type = "bar"

        chart_data = []
        for row in data[:50]:
            item = {"name": str(row[x_col])}
            for y_col in y_cols:
                try:
                    item[y_col] = float(row[y_col])
                except (ValueError, TypeError):
                    item[y_col] = 0
            chart_data.append(item)

        return {
            "type": chart_type,
            "data": chart_data,
            "xKey": "name",
            "yKeys": y_cols,
        }

    def _build_db_context(self, db_config: dict[str, Any]) -> str:
        """构建数据库上下文信息，包含表结构"""
        driver = db_config.get("driver", "mysql")
        schema_info = self._get_schema_info(db_config)

        return f"""
数据库连接信息:
- 类型: {driver}
- 数据库: {db_config.get('database', '')}

数据库表结构:
{schema_info}

请根据用户的问题生成合适的 SQL 查询语句。
重要规则:
1. 只生成只读 SQL (SELECT, SHOW, DESCRIBE)
2. 使用 ```sql 代码块包裹 SQL 语句
3. 必须使用上面提供的真实表名和字段名，不要猜测
4. 简洁明了地解释查询结果
"""

    def _get_schema_info(self, db_config: dict[str, Any]) -> str:
        """获取数据库表结构信息"""
        db_manager = create_database_manager(db_config)
        return db_manager.get_schema_info()

    def _extract_sql(self, content: str) -> str | None:
        """从内容中提取 SQL 代码"""
        sql_match = re.search(r'```sql\s*([\s\S]*?)```', content, re.IGNORECASE)
        if sql_match:
            return sql_match.group(1).strip()

        select_match = re.search(
            r'(SELECT\s+[\s\S]*?(?:;|$))',
            content,
            re.IGNORECASE
        )
        if select_match:
            return select_match.group(1).strip().rstrip(';') + ';'

        return None


# 全局引擎实例
_engine: GptmeEngine | None = None


def get_engine() -> GptmeEngine:
    """获取全局引擎实例"""
    global _engine
    if _engine is None:
        _engine = GptmeEngine()
    return _engine
