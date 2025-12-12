"""
gptme 执行引擎封装
使用 LiteLLM 进行 AI 调用，支持 SQL 和 Python 代码执行
"""

import asyncio
import base64
import io
import os
import re
import sys
import time
from collections.abc import AsyncGenerator, Callable
from typing import Any

import structlog

from app.core.config import settings
from app.models import SSEEvent
from app.services.database import create_database_manager

logger = structlog.get_logger()

# Python 执行安全检查 - 阻止危险操作
BLOCKED_PATTERNS = [
    r"import\s+os\b",
    r"import\s+subprocess",
    r"import\s+sys\b",
    r"from\s+os\s+import",
    r"from\s+subprocess\s+import",
    r"open\s*\(",
    r"exec\s*\(",
    r"eval\s*\(",
    r"__import__",
    r"compile\s*\(",
    r"globals\s*\(",
    r"locals\s*\(",
]


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
        self._ipython = None  # IPython 实例（延迟初始化）
        self._sql_data: dict[str, Any] = {}  # SQL 结果缓存

    def _get_ipython(self):
        """获取或创建 IPython 实例"""
        if self._ipython is None:
            from IPython.core.interactiveshell import InteractiveShell

            self._ipython = InteractiveShell()
            # 预导入常用数据分析库
            self._ipython.run_cell(
                """
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')  # 非交互式后端
import matplotlib.pyplot as plt
plt.rcParams['font.sans-serif'] = ['SimHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False
""",
                silent=True,
            )
        return self._ipython

    def _inject_sql_data(self, name: str, data: list[dict]) -> None:
        """将 SQL 结果注入 Python 环境"""
        import pandas as pd

        df = pd.DataFrame(data)
        self._get_ipython().push({name: df})
        self._sql_data[name] = df
        logger.info(f"Injected SQL data as '{name}' DataFrame with {len(data)} rows")

    def _validate_python_code(self, code: str) -> tuple[bool, str | None]:
        """验证 Python 代码安全性"""
        for pattern in BLOCKED_PATTERNS:
            if re.search(pattern, code, re.IGNORECASE):
                return False, f"检测到不安全的操作: {pattern}"
        return True, None

    def _parse_thinking(self, content: str) -> list[str]:
        """解析思考标记"""
        pattern = r"\[thinking:\s*([^\]]+)\]"
        return [match.group(1).strip() for match in re.finditer(pattern, content)]

    def _extract_python(self, content: str) -> str | None:
        """从内容中提取 Python 代码"""
        python_match = re.search(
            r"```(?:python|ipython|py)\s*([\s\S]*?)```", content, re.IGNORECASE
        )
        if python_match:
            return python_match.group(1).strip()
        return None

    async def execute(
        self,
        query: str,
        system_prompt: str,
        db_config: dict[str, Any] | None = None,
        history: list[dict[str, str]] | None = None,
        stop_checker: Callable[[], bool] | None = None,
    ) -> AsyncGenerator[SSEEvent, None]:
        """
        执行查询并流式返回结果

        Args:
            query: 用户查询
            system_prompt: 系统提示
            db_config: 数据库配置
            history: 对话历史消息列表 [{"role": "user/assistant", "content": "..."}]
            stop_checker: 停止检查函数
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
                history=history,
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
        history: list[dict[str, str]] | None = None,
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

            # 添加对话历史（不包括当前查询，因为当前查询会单独添加）
            if history:
                # 过滤掉最后一条用户消息（如果和当前查询相同）
                for msg in history:
                    if msg.get("role") in ("user", "assistant") and msg.get("content"):
                        messages.append({"role": msg["role"], "content": msg["content"]})
                logger.info(f"Added {len(history)} history messages to context")

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
            sent_thinking = set()  # 已发送的思考标记

            async for chunk in response:
                if stop_checker and stop_checker():
                    break

                delta = chunk.choices[0].delta
                if delta.content:
                    full_content += delta.content

                    # 实时解析并发送思考标记
                    for thinking in self._parse_thinking(full_content):
                        if thinking not in sent_thinking:
                            yield SSEEvent.thinking(thinking)
                            sent_thinking.add(thinking)

            # 解析结果
            sql_code = self._extract_sql(full_content)
            python_code = self._extract_python(full_content)

            # 如果有 SQL 和数据库配置，尝试执行
            data = None
            rows_count = None
            execution_time = None

            if sql_code and db_config:
                yield SSEEvent.progress("executing_sql", "正在执行 SQL 查询...")
                start_time = time.time()

                try:
                    data, rows_count = await self._execute_sql(sql_code, db_config)
                    execution_time = time.time() - start_time

                    # 将 SQL 结果注入 Python 环境供后续分析使用
                    if data:
                        self._inject_sql_data("df", data)
                        self._inject_sql_data("query_result", data)
                except Exception as e:
                    full_content += f"\n\n⚠️ SQL 执行错误: {str(e)}"

            # 如果有 Python 代码，执行它
            python_output = None
            python_images = []

            if python_code:
                yield SSEEvent.progress("executing_python", "正在执行 Python 分析...")

                try:
                    python_output, python_images = await self._execute_python(python_code)

                    # 发送 Python 输出
                    if python_output:
                        yield SSEEvent.python_output(python_output, "stdout")

                    # 发送 Python 生成的图表
                    for img_base64 in python_images:
                        yield SSEEvent.python_image(img_base64, "png")

                except Exception as e:
                    yield SSEEvent.python_output(f"⚠️ Python 执行错误: {str(e)}", "stderr")

            # 从 AI 输出中提取图表配置
            chart_config = self._extract_chart_config(full_content)

            # 移除图表配置和思考标记，使输出更干净
            clean_content = re.sub(r"```chart\s*\n?[\s\S]*?\n?```", "", full_content).strip()
            clean_content = re.sub(r"\[thinking:\s*[^\]]+\]", "", clean_content).strip()

            yield SSEEvent.result(
                content=clean_content,
                sql=sql_code,
                data=data,
                rows_count=rows_count,
                execution_time=execution_time,
            )

            # 如果 Python 已生成图表，跳过自动图表生成
            if python_images:
                pass  # Python 图表已通过 python_image 事件发送
            # 如果 AI 提供了图表配置且有数据，生成可视化
            elif chart_config and data and len(data) > 0:
                # 构建图表数据
                visualization = self._build_chart_from_config(chart_config, data)
                if visualization:
                    yield SSEEvent.visualization(
                        chart_type=visualization.get("type", "bar"),
                        chart_data={
                            "data": visualization.get("data", []),
                            "xKey": visualization.get("xKey"),
                            "yKeys": visualization.get("yKeys"),
                            "title": visualization.get("title"),
                        },
                    )
            elif data and len(data) > 0:
                # 如果 AI 没有提供图表配置，使用后备的自动生成逻辑
                visualization = self._generate_visualization(data, query)
                if visualization:
                    yield SSEEvent.visualization(
                        chart_type=visualization.get("type", "bar"),
                        chart_data={
                            "data": visualization.get("data", []),
                            "xKey": visualization.get("xKey"),
                            "yKeys": visualization.get("yKeys"),
                        },
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

    async def _execute_python(
        self, code: str, timeout: int = 30
    ) -> tuple[str | None, list[str]]:
        """
        执行 Python 代码并返回输出和图表

        Args:
            code: Python 代码
            timeout: 超时时间（秒）

        Returns:
            (stdout 输出, base64 编码的图表列表)
        """
        # 安全检查
        is_valid, error = self._validate_python_code(code)
        if not is_valid:
            raise ValueError(error)

        # 在线程中执行（避免阻塞事件循环）
        return await asyncio.wait_for(
            asyncio.to_thread(self._execute_python_sync, code),
            timeout=timeout,
        )

    def _execute_python_sync(self, code: str) -> tuple[str | None, list[str]]:
        """同步执行 Python 代码"""
        import traceback

        import matplotlib.pyplot as plt

        ipython = self._get_ipython()

        # 捕获 stdout 和 stderr
        stdout_capture = io.StringIO()
        stderr_capture = io.StringIO()
        old_stdout = sys.stdout
        old_stderr = sys.stderr
        sys.stdout = stdout_capture
        sys.stderr = stderr_capture

        images = []

        try:
            # 执行代码
            result = ipython.run_cell(code, silent=False, store_history=False)

            # 获取输出
            stdout_output = stdout_capture.getvalue()
            stderr_output = stderr_capture.getvalue()

            # 合并输出
            output = stdout_output
            if stderr_output:
                output += f"\n[stderr]: {stderr_output}"

            # 检查是否有 matplotlib 图表
            if plt.get_fignums():
                for fig_num in plt.get_fignums():
                    fig = plt.figure(fig_num)
                    buf = io.BytesIO()
                    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight")
                    buf.seek(0)
                    img_base64 = base64.b64encode(buf.read()).decode("utf-8")
                    images.append(img_base64)
                plt.close("all")

            # 如果有执行错误，添加详细信息
            if result.error_in_exec:
                error_msg = "".join(
                    traceback.format_exception(
                        type(result.error_in_exec),
                        result.error_in_exec,
                        result.error_in_exec.__traceback__,
                    )
                )
                output += f"\n执行错误:\n{error_msg}"
            elif result.error_before_exec:
                output += f"\n语法错误: {result.error_before_exec}"

            return output if output else None, images

        except Exception:
            error_msg = traceback.format_exc()
            return f"Python 执行异常:\n{error_msg}", []

        finally:
            sys.stdout = old_stdout
            sys.stderr = old_stderr

    def _build_chart_from_config(self, config: dict, data: list[dict]) -> dict | None:
        """根据 AI 提供的配置构建图表数据

        Args:
            config: AI 生成的图表配置 {"type", "title", "xKey", "yKeys"}
            data: SQL 查询结果数据

        Returns:
            完整的图表配置，包含数据
        """
        if not data or len(data) == 0:
            return None

        chart_type = config.get("type", "bar")
        title = config.get("title", "")
        x_key = config.get("xKey")
        y_keys = config.get("yKeys", [])

        columns = list(data[0].keys())

        # 如果 AI 没有指定 xKey，使用第一列
        if not x_key or x_key not in columns:
            x_key = columns[0]

        # 如果 AI 没有指定 yKeys，自动检测数值列
        if not y_keys:
            for col in columns:
                if col != x_key:
                    try:
                        float(data[0][col])
                        y_keys.append(col)
                    except (ValueError, TypeError):
                        pass

        if not y_keys:
            return None

        # 构建图表数据
        chart_data = []
        for row in data[:50]:  # 限制最多 50 条数据
            item = {"name": str(row.get(x_key, ""))}
            for y_key in y_keys:
                try:
                    item[y_key] = float(row.get(y_key, 0))
                except (ValueError, TypeError):
                    item[y_key] = 0
            chart_data.append(item)

        return {
            "type": chart_type,
            "title": title,
            "data": chart_data,
            "xKey": "name",
            "yKeys": y_keys,
        }

    def _generate_visualization(self, data: list[dict], query: str) -> dict | None:
        """根据数据和查询自动生成可视化配置（后备方案）"""
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
- 数据库: {db_config.get("database", "")}

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
        sql_match = re.search(r"```sql\s*([\s\S]*?)```", content, re.IGNORECASE)
        if sql_match:
            return sql_match.group(1).strip()

        select_match = re.search(r"(SELECT\s+[\s\S]*?(?:;|$))", content, re.IGNORECASE)
        if select_match:
            return select_match.group(1).strip().rstrip(";") + ";"

        return None

    def _extract_chart_config(self, content: str) -> dict | None:
        """从 AI 输出中提取图表配置

        Args:
            content: AI 输出的完整内容

        Returns:
            图表配置字典，如果没有找到则返回 None
        """
        import json

        # 匹配 ```chart ... ``` 代码块
        pattern = r"```chart\s*\n?([\s\S]*?)\n?```"
        match = re.search(pattern, content, re.IGNORECASE)

        if match:
            try:
                config_str = match.group(1).strip()
                config = json.loads(config_str)

                # 验证必要字段
                if "type" in config:
                    logger.info(f"Extracted chart config: type={config.get('type')}")
                    return config
            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse chart config: {e}")
                return None

        return None


# 全局引擎实例
_engine: GptmeEngine | None = None


def get_engine() -> GptmeEngine:
    """获取全局引擎实例"""
    global _engine
    if _engine is None:
        _engine = GptmeEngine()
    return _engine
