"""
gptme 执行引擎封装
使用 LiteLLM 进行 AI 调用，支持 SQL 和 Python 代码执行
"""

import ast
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
from app.services.model_runtime import categorize_model_error

logger = structlog.get_logger()

# Python 沙箱安全 - 禁止的模块和函数
# 使用 AST 分析而不是简单的正则匹配，防止绕过
BLOCKED_MODULES = frozenset(
    {
        "os",
        "sys",
        "subprocess",
        "socket",
        "requests",
        "urllib",
        "http",
        "ftplib",
        "telnetlib",
        "smtplib",
        "poplib",
        "imaplib",
        "nntplib",
        "sqlite3",
        "bdb",
        "pdb",
        "pydoc",
        "webbrowser",
        "idlelib",
        "tkinter",
        "ctypes",
        "multiprocessing",
        "concurrent",
        "threading",
        "_thread",
        "multiprocessing",
        "signal",
        "posix",
        "nt",
        "pwd",
        "grp",
        "spwd",
        "crypt",
        "termios",
        "tty",
        "pty",
        "fcntl",
        "mmap",
        "resource",
        "nis",
        "syslog",
        "commands",
    }
)

BLOCKED_BUILTINS = frozenset(
    {
        "__import__",
        "open",
        "exec",
        "eval",
        "compile",
        "globals",
        "locals",
        "vars",
        "dir",
        "getattr",
        "setattr",
        "delattr",
        "hasattr",
        "input",
        "raw_input",
        "reload",
        "breakpoint",
        "exit",
        "quit",
        "copyright",
        "credits",
        "license",
        "help",
    }
)

MAX_AUTO_REPAIR_ATTEMPTS = 4


class StopRequestedError(RuntimeError):
    """用户主动停止当前执行"""


def _truncate_text(value: str | None, limit: int = 400) -> str | None:
    if not value:
        return None
    normalized = value.strip()
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 3] + "..."


class PythonSecurityAnalyzer(ast.NodeVisitor):
    """Python 代码安全分析器 - 使用 AST 检测危险操作"""

    def __init__(self):
        self.violations: list[str] = []
        self._in_attribute_chain = False

    def visit_Import(self, node: ast.Import) -> None:
        """检查 import 语句"""
        for alias in node.names:
            module_name = alias.name.split(".")[0]
            if module_name in BLOCKED_MODULES:
                self.violations.append(f"禁止导入模块: {alias.name}")
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        """检查 from ... import 语句"""
        if node.module:
            module_name = node.module.split(".")[0]
            if module_name in BLOCKED_MODULES:
                self.violations.append(f"禁止从模块导入: {node.module}")
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        """检查函数调用"""
        if isinstance(node.func, ast.Name):
            # 直接调用如: eval(...), exec(...)
            if node.func.id in BLOCKED_BUILTINS:
                self.violations.append(f"禁止使用危险函数: {node.func.id}")
        elif isinstance(node.func, ast.Attribute):
            # 方法调用如: os.system(...)
            if self._is_blocked_attribute_chain(node.func):
                self.violations.append("禁止调用危险方法")
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        """检查属性访问"""
        # 检测访问 __builtins__ 等危险属性
        if node.attr in ("__builtins__", "__globals__", "__locals__", "__code__"):
            self.violations.append(f"禁止访问危险属性: {node.attr}")
        self.generic_visit(node)

    def _is_blocked_attribute_chain(self, node: ast.Attribute) -> bool:
        """检查属性链是否指向禁止的模块或危险对象"""
        # 向上遍历属性链，如: os.path.join -> os
        parts = []
        current = node
        while isinstance(current, ast.Attribute):
            parts.append(current.attr)
            current = current.value
        if isinstance(current, ast.Name):
            parts.append(current.id)
            root = current.id
            # 检查是否是禁止的模块
            if root in BLOCKED_MODULES:
                return True
            # 检查是否是危险对象如 __builtins__
            if root in ("__builtins__", "__globals__", "__locals__"):
                return True
        return False

    @classmethod
    def analyze(cls, code: str) -> tuple[bool, list[str]]:
        """
        分析 Python 代码的安全性

        Returns:
            (is_safe, violations)
        """
        try:
            tree = ast.parse(code)
        except SyntaxError as e:
            return False, [f"语法错误: {e}"]

        analyzer = cls()
        analyzer.visit(tree)

        return len(analyzer.violations) == 0, analyzer.violations


class GptmeEngine:
    """AI 执行引擎"""

    def __init__(
        self,
        model: str | None = None,
        provider: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
        headers: dict[str, str] | None = None,
        query_params: dict[str, str] | None = None,
        timeout: int = 300,
    ):
        self.model = model or settings.GPTME_MODEL or settings.DEFAULT_MODEL
        self.provider = provider  # 用于 litellm custom_llm_provider，避免模型名查表解析
        self.api_key = api_key or settings.OPENAI_API_KEY
        self.base_url = base_url or settings.OPENAI_BASE_URL
        self.headers = headers or {}
        self.query_params = query_params or {}
        self.timeout = timeout or settings.GPTME_TIMEOUT
        self._ipython = None  # IPython 实例（延迟初始化）
        self._sql_data: dict[str, Any] = {}  # SQL 结果缓存

    def _get_ipython(self):
        """获取或创建 IPython 实例"""
        if self._ipython is None:
            # 获取内置字体路径
            from IPython.core.interactiveshell import InteractiveShell

            font_path = os.path.join(
                os.path.dirname(os.path.dirname(__file__)),
                "assets",
                "fonts",
                "NotoSansSC-Regular.ttf",
            )

            self._ipython = InteractiveShell()
            # 预导入常用数据分析库，配置中文字体
            font_loaded = os.path.exists(font_path)
            if font_loaded:
                logger.info(f"Loading bundled font: {font_path}")
            else:
                logger.warning(f"Bundled font not found: {font_path}, falling back to system fonts")

            self._ipython.run_cell(
                f"""
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')  # 非交互式后端
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
import os

# 使用项目内置的思源黑体（Noto Sans SC）- 跨平台通用
font_path = r'{font_path}'
if os.path.exists(font_path):
    fm.fontManager.addfont(font_path)
    plt.rcParams['font.family'] = 'Noto Sans SC'
else:
    # 回退到系统字体
    import platform
    system = platform.system()
    if system == 'Darwin':
        plt.rcParams['font.sans-serif'] = ['Arial Unicode MS', 'PingFang SC', 'Heiti SC']
    elif system == 'Windows':
        plt.rcParams['font.sans-serif'] = ['Microsoft YaHei', 'SimHei']
    else:
        plt.rcParams['font.sans-serif'] = ['WenQuanYi Micro Hei', 'Noto Sans CJK SC', 'DejaVu Sans']

plt.rcParams['axes.unicode_minus'] = False
plt.rcParams['font.size'] = 12
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
        """验证 Python 代码安全性 - 使用 AST 分析"""
        is_safe, violations = PythonSecurityAnalyzer.analyze(code)
        if not is_safe:
            return False, f"检测到不安全的操作: {'; '.join(violations)}"
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

    def _clean_content_for_display(self, content: str) -> str:
        """清理输出内容，移除代码块，只保留纯文本总结"""
        # 移除 SQL 代码块
        content = re.sub(r"```sql\s*[\s\S]*?```", "", content, flags=re.IGNORECASE)
        # 移除 Python 代码块
        content = re.sub(
            r"```(?:python|ipython|py)\s*[\s\S]*?```", "", content, flags=re.IGNORECASE
        )
        # 移除 chart 代码块
        content = re.sub(r"```chart\s*[\s\S]*?```", "", content, flags=re.IGNORECASE)
        # 移除 thinking 标记
        content = re.sub(r"\[thinking:\s*[^\]]+\]", "", content)
        # 清理多余空行
        content = re.sub(r"\n{3,}", "\n\n", content)
        return content.strip()

    def _build_initial_messages(
        self,
        query: str,
        system_prompt: str,
        db_config: dict[str, Any] | None = None,
        history: list[dict[str, str]] | None = None,
    ) -> list[dict[str, str]]:
        messages = [{"role": "system", "content": system_prompt}]

        if db_config:
            messages.append({"role": "system", "content": self._build_db_context(db_config)})

        if history:
            for msg in history:
                if msg.get("role") in ("user", "assistant") and msg.get("content"):
                    messages.append({"role": msg["role"], "content": msg["content"]})

        messages.append({"role": "user", "content": query})
        return messages

    def _build_sql_repair_prompt(self, query: str, failed_sql: str | None, error_message: str) -> str:
        sql_block = failed_sql or "未生成 SQL"
        return f"""上一步生成的 SQL 无法执行，请修复后重新给出完整答复。

原始问题：
{query}

失败 SQL：
```sql
{sql_block}
```

数据库错误：
{error_message}

要求：
1. 必须基于已提供的真实表结构和字段名修复。
2. 返回完整答复，并且必须包含一个新的 ```sql 代码块。
3. 如果原先的分析、图表或 Python 思路仍有效，可以保留；否则一起修正。
4. 只给最终版本，不要给多个候选 SQL。
"""

    def _build_missing_sql_prompt(self, query: str) -> str:
        return f"""上一步回答没有提供可执行的 SQL，请重新给出完整答复。

原始问题：
{query}

要求：
1. 必须包含一个 ```sql 代码块。
2. SQL 只能使用已提供的真实表和字段。
3. 可以保留必要的分析说明，但不要省略 SQL。
"""

    def _build_python_repair_prompt(
        self,
        query: str,
        failed_sql: str | None,
        failed_python: str | None,
        error_message: str,
    ) -> str:
        sql_block = failed_sql or "未提供 SQL"
        python_block = failed_python or "未提供 Python"
        return f"""上一步 Python 执行失败，请修复后重新给出完整答复。

原始问题：
{query}

当前 SQL：
```sql
{sql_block}
```

失败 Python：
```python
{python_block}
```

Python 错误：
{error_message}

要求：
1. 若 SQL 无需修改，请保留原 SQL；若确实有问题，也一并修正。
2. 如果还需要 Python 分析，必须返回新的 ```python 代码块。
3. 代码只能使用 pandas、numpy、sklearn、matplotlib、seaborn、scipy，并直接使用已注入的 df。
4. 不要访问文件、网络或系统资源。
"""

    def _build_repair_messages(
        self,
        query: str,
        system_prompt: str,
        previous_content: str,
        repair_prompt: str,
        db_config: dict[str, Any] | None = None,
        history: list[dict[str, str]] | None = None,
    ) -> list[dict[str, str]]:
        messages = self._build_initial_messages(
            query=query,
            system_prompt=system_prompt,
            db_config=db_config,
            history=history,
        )
        messages.append({"role": "assistant", "content": previous_content})
        messages.append({"role": "user", "content": repair_prompt})
        return messages

    async def _stream_completion(
        self,
        messages: list[dict[str, str]],
        *,
        phase: str,
        attempt: int,
        content_holder: list[str],
        stop_checker: Callable[[], bool] | None = None,
    ) -> AsyncGenerator[SSEEvent, None]:
        import litellm

        response = await litellm.acompletion(
            model=self.model,
            custom_llm_provider=self.provider,
            messages=messages,
            stream=True,
            api_key=self.api_key,
            base_url=self.base_url,
            extra_headers=self.headers or None,
            extra_query=self.query_params or None,
        )

        full_content = ""
        sent_thinking: set[str] = set()

        async for chunk in response:
            if stop_checker and stop_checker():
                raise StopRequestedError("查询已取消")

            delta = chunk.choices[0].delta
            if not delta.content:
                continue

            full_content += delta.content
            for thinking in self._parse_thinking(full_content):
                if thinking not in sent_thinking:
                    yield SSEEvent.thinking(thinking, detail=f"{phase}:{attempt}")
                    sent_thinking.add(thinking)

        content_holder.append(full_content)

    def _build_diagnostic_entry(
        self,
        *,
        attempt: int,
        phase: str,
        status: str,
        message: str,
        error_code: str | None = None,
        error_category: str | None = None,
        recoverable: bool | None = None,
        sql: str | None = None,
        python: str | None = None,
    ) -> dict[str, Any]:
        return {
            "attempt": attempt,
            "phase": phase,
            "status": status,
            "message": message,
            "error_code": error_code,
            "error_category": error_category,
            "recoverable": recoverable,
            "sql": _truncate_text(sql),
            "python": _truncate_text(python),
        }

    def _categorize_generation_failure(self, message: str) -> tuple[str, str, bool]:
        category = categorize_model_error(message)
        code_map = {
            "auth": "MODEL_AUTH_ERROR",
            "timeout": "MODEL_TIMEOUT",
            "connection": "MODEL_CONNECTION_ERROR",
            "model_not_found": "MODEL_NOT_FOUND",
            "rate_limited": "MODEL_RATE_LIMITED",
            "provider_format": "PROVIDER_FORMAT_ERROR",
            "unknown": "MODEL_EXECUTION_ERROR",
        }
        recoverable = category in {"timeout", "rate_limited"}
        return code_map.get(category, "MODEL_EXECUTION_ERROR"), category, recoverable

    def _categorize_sql_error(self, message: str) -> tuple[str, str, bool]:
        normalized = message.lower()
        if any(
            token in normalized
            for token in (
                "password authentication failed",
                "access denied",
                "authentication failed",
                "login failed",
            )
        ):
            return "DB_AUTH_ERROR", "connection", False
        if any(
            token in normalized
            for token in (
                "connection refused",
                "could not connect",
                "can't connect",
                "server closed the connection",
                "timed out",
                "name or service not known",
                "network is unreachable",
            )
        ):
            return "DB_CONNECTION_ERROR", "connection", False
        if any(token in normalized for token in ("syntax", "parse error", "sql syntax", "near ")):
            return "SQL_SYNTAX_ERROR", "sql", True
        if any(
            token in normalized
            for token in ("no such table", "doesn't exist", "undefined table", "unknown table")
        ):
            return "SQL_TABLE_ERROR", "schema", True
        if any(
            token in normalized
            for token in ("no such column", "unknown column", "undefined column", "ambiguous column")
        ):
            return "SQL_COLUMN_ERROR", "schema", True
        if any(
            token in normalized
            for token in ("只允许执行只读查询", "危险关键字", "多语句", "sql 注释", "只读查询")
        ):
            return "SQL_SAFETY_ERROR", "safety", False
        return "SQL_EXECUTION_ERROR", "sql", True

    def _categorize_python_error(self, message: str) -> tuple[str, str, bool]:
        normalized = message.lower()
        if "检测到不安全的操作" in message:
            return "PYTHON_SECURITY_ERROR", "safety", False
        if "语法错误" in message or "syntaxerror" in normalized:
            return "PYTHON_SYNTAX_ERROR", "python", True
        if "timed out" in normalized or "timeout" in normalized:
            return "PYTHON_TIMEOUT", "python", True
        if any(
            token in normalized
            for token in (
                "nameerror",
                "attributeerror",
                "typeerror",
                "valueerror",
                "keyerror",
                "indexerror",
                "modulenotfounderror",
                "runtimeerror",
                "执行错误",
            )
        ):
            return "PYTHON_RUNTIME_ERROR", "python", True
        return "PYTHON_EXECUTION_ERROR", "python", True

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
            yield SSEEvent.progress(
                "initializing",
                "正在初始化 AI 引擎...",
                attempt=1,
                phase="initializing",
            )
            async for event in self._execute_with_litellm(
                query=query,
                system_prompt=system_prompt,
                db_config=db_config,
                history=history,
                stop_checker=stop_checker,
            ):
                yield event
        except StopRequestedError as e:
            yield SSEEvent.error(
                "CANCELLED",
                str(e),
                error_category="cancelled",
                failed_stage="cancelled",
                attempt=1,
            )
        except Exception as e:
            code, category, _ = self._categorize_generation_failure(str(e))
            yield SSEEvent.error(
                code,
                str(e),
                error_category=category,
                failed_stage="engine",
                attempt=1,
            )

    async def _execute_with_litellm(
        self,
        query: str,
        system_prompt: str,
        db_config: dict[str, Any] | None = None,
        history: list[dict[str, str]] | None = None,
        stop_checker: Callable[[], bool] | None = None,
    ) -> AsyncGenerator[SSEEvent, None]:
        """使用 LiteLLM 执行查询"""
        diagnostics: list[dict[str, Any]] = []
        completion_messages = self._build_initial_messages(
            query=query,
            system_prompt=system_prompt,
            db_config=db_config,
            history=history,
        )

        full_content = ""
        final_sql: str | None = None
        final_python: str | None = None
        final_data: list[dict] | None = None
        final_rows_count: int | None = None
        final_execution_time: float | None = None
        python_output: str | None = None
        python_images: list[str] = []
        attempt = 1

        while attempt <= MAX_AUTO_REPAIR_ATTEMPTS:
            yield SSEEvent.progress(
                "generating",
                "正在生成响应..." if attempt == 1 else f"正在进行第 {attempt} 次自动修复...",
                attempt=attempt,
                phase="generate",
            )

            content_holder: list[str] = []
            try:
                async for event in self._stream_completion(
                    completion_messages,
                    phase="generate",
                    attempt=attempt,
                    content_holder=content_holder,
                    stop_checker=stop_checker,
                ):
                    yield event
            except StopRequestedError:
                raise
            except Exception as e:
                code, category, recoverable = self._categorize_generation_failure(str(e))
                diagnostic = self._build_diagnostic_entry(
                    attempt=attempt,
                    phase="generate",
                    status="error",
                    message=f"模型生成失败: {e}",
                    error_code=code,
                    error_category=category,
                    recoverable=recoverable,
                )
                diagnostics.append(diagnostic)
                yield SSEEvent.progress(
                    "generating",
                    diagnostic["message"],
                    attempt=attempt,
                    phase="generate",
                    diagnostic_entry=diagnostic,
                )
                if recoverable and attempt < MAX_AUTO_REPAIR_ATTEMPTS:
                    repair_entry = self._build_diagnostic_entry(
                        attempt=attempt + 1,
                        phase="generate",
                        status="repaired",
                        message="模型调用失败，正在自动重试。",
                        error_code=code,
                        error_category=category,
                        recoverable=True,
                    )
                    diagnostics.append(repair_entry)
                    yield SSEEvent.progress(
                        "generating",
                        repair_entry["message"],
                        attempt=attempt + 1,
                        phase="generate",
                        diagnostic_entry=repair_entry,
                    )
                    attempt += 1
                    continue
                yield SSEEvent.error(
                    code,
                    str(e),
                    error_category=category,
                    failed_stage="generate",
                    attempt=attempt,
                    diagnostics=diagnostics,
                )
                return

            full_content = content_holder[0] if content_holder else ""
            final_sql = self._extract_sql(full_content)
            final_python = self._extract_python(full_content)
            chart_config = self._extract_chart_config(full_content)

            logger.debug(
                "AI content extracted",
                content_length=len(full_content),
                has_sql=bool(final_sql),
                has_python=bool(final_python),
            )

            if db_config and not final_sql:
                diagnostic = self._build_diagnostic_entry(
                    attempt=attempt,
                    phase="generate",
                    status="error",
                    message="模型回复缺少可执行 SQL，正在自动补全。",
                    error_code="MISSING_SQL",
                    error_category="sql",
                    recoverable=attempt < MAX_AUTO_REPAIR_ATTEMPTS,
                )
                diagnostics.append(diagnostic)
                yield SSEEvent.progress(
                    "generating",
                    diagnostic["message"],
                    attempt=attempt,
                    phase="generate",
                    diagnostic_entry=diagnostic,
                )
                if attempt >= MAX_AUTO_REPAIR_ATTEMPTS:
                    yield SSEEvent.error(
                        "MISSING_SQL",
                        "模型没有生成可执行 SQL。",
                        error_category="sql",
                        failed_stage="generate",
                        attempt=attempt,
                        diagnostics=diagnostics,
                    )
                    return

                completion_messages = self._build_repair_messages(
                    query=query,
                    system_prompt=system_prompt,
                    previous_content=full_content,
                    repair_prompt=self._build_missing_sql_prompt(query),
                    db_config=db_config,
                    history=history,
                )
                repair_entry = self._build_diagnostic_entry(
                    attempt=attempt + 1,
                    phase="generate",
                    status="repaired",
                    message="已触发 SQL 自动补全。",
                    error_code="MISSING_SQL",
                    error_category="sql",
                    recoverable=True,
                )
                diagnostics.append(repair_entry)
                yield SSEEvent.progress(
                    "generating",
                    repair_entry["message"],
                    attempt=attempt + 1,
                    phase="generate",
                    diagnostic_entry=repair_entry,
                )
                attempt += 1
                continue

            if final_sql and db_config:
                yield SSEEvent.progress(
                    "executing_sql",
                    "正在执行 SQL 查询...",
                    attempt=attempt,
                    phase="sql",
                )
                start_time = time.time()
                try:
                    final_data, final_rows_count = await self._execute_sql(final_sql, db_config)
                    final_execution_time = time.time() - start_time

                    if final_data:
                        self._inject_sql_data("df", final_data)
                        self._inject_sql_data("query_result", final_data)

                    diagnostic = self._build_diagnostic_entry(
                        attempt=attempt,
                        phase="sql",
                        status="success",
                        message=f"SQL 执行成功，返回 {final_rows_count or 0} 行。",
                        sql=final_sql,
                    )
                    diagnostics.append(diagnostic)
                    yield SSEEvent.progress(
                        "executing_sql",
                        diagnostic["message"],
                        attempt=attempt,
                        phase="sql",
                        diagnostic_entry=diagnostic,
                    )
                except Exception as e:
                    code, category, recoverable = self._categorize_sql_error(str(e))
                    diagnostic = self._build_diagnostic_entry(
                        attempt=attempt,
                        phase="sql",
                        status="error",
                        message=f"SQL 执行失败: {e}",
                        error_code=code,
                        error_category=category,
                        recoverable=recoverable,
                        sql=final_sql,
                    )
                    diagnostics.append(diagnostic)
                    yield SSEEvent.progress(
                        "executing_sql",
                        diagnostic["message"],
                        attempt=attempt,
                        phase="sql",
                        diagnostic_entry=diagnostic,
                    )
                    if recoverable and attempt < MAX_AUTO_REPAIR_ATTEMPTS:
                        completion_messages = self._build_repair_messages(
                            query=query,
                            system_prompt=system_prompt,
                            previous_content=full_content,
                            repair_prompt=self._build_sql_repair_prompt(
                                query=query,
                                failed_sql=final_sql,
                                error_message=str(e),
                            ),
                            db_config=db_config,
                            history=history,
                        )
                        repair_entry = self._build_diagnostic_entry(
                            attempt=attempt + 1,
                            phase="sql",
                            status="repaired",
                            message="SQL 失败可恢复，正在自动修复并重试。",
                            error_code=code,
                            error_category=category,
                            recoverable=True,
                            sql=final_sql,
                        )
                        diagnostics.append(repair_entry)
                        yield SSEEvent.progress(
                            "executing_sql",
                            repair_entry["message"],
                            attempt=attempt + 1,
                            phase="sql",
                            diagnostic_entry=repair_entry,
                        )
                        attempt += 1
                        continue
                    yield SSEEvent.error(
                        code,
                        f"SQL 执行失败: {e}",
                        error_category=category,
                        failed_stage="sql",
                        attempt=attempt,
                        diagnostics=diagnostics,
                    )
                    return

            if final_python:
                logger.debug("Executing Python code", attempt=attempt)
                yield SSEEvent.progress(
                    "executing_python",
                    "正在执行 Python 分析...",
                    attempt=attempt,
                    phase="python",
                )

                try:
                    python_output, python_images = await self._execute_python(final_python)
                    diagnostic = self._build_diagnostic_entry(
                        attempt=attempt,
                        phase="python",
                        status="success",
                        message="Python 分析执行完成。",
                        python=final_python,
                    )
                    diagnostics.append(diagnostic)
                    yield SSEEvent.progress(
                        "executing_python",
                        diagnostic["message"],
                        attempt=attempt,
                        phase="python",
                        diagnostic_entry=diagnostic,
                    )

                    if python_output:
                        yield SSEEvent.python_output(python_output, "stdout")

                    for img_base64 in python_images:
                        yield SSEEvent.python_image(img_base64, "png")

                except Exception as e:
                    code, category, recoverable = self._categorize_python_error(str(e))
                    diagnostic = self._build_diagnostic_entry(
                        attempt=attempt,
                        phase="python",
                        status="error",
                        message=f"Python 执行失败: {e}",
                        error_code=code,
                        error_category=category,
                        recoverable=recoverable,
                        sql=final_sql,
                        python=final_python,
                    )
                    diagnostics.append(diagnostic)
                    yield SSEEvent.progress(
                        "executing_python",
                        diagnostic["message"],
                        attempt=attempt,
                        phase="python",
                        diagnostic_entry=diagnostic,
                    )
                    if recoverable and attempt < MAX_AUTO_REPAIR_ATTEMPTS:
                        completion_messages = self._build_repair_messages(
                            query=query,
                            system_prompt=system_prompt,
                            previous_content=full_content,
                            repair_prompt=self._build_python_repair_prompt(
                                query=query,
                                failed_sql=final_sql,
                                failed_python=final_python,
                                error_message=str(e),
                            ),
                            db_config=db_config,
                            history=history,
                        )
                        repair_entry = self._build_diagnostic_entry(
                            attempt=attempt + 1,
                            phase="python",
                            status="repaired",
                            message="Python 失败可恢复，正在自动修复并重试。",
                            error_code=code,
                            error_category=category,
                            recoverable=True,
                            python=final_python,
                        )
                        diagnostics.append(repair_entry)
                        yield SSEEvent.progress(
                            "executing_python",
                            repair_entry["message"],
                            attempt=attempt + 1,
                            phase="python",
                            diagnostic_entry=repair_entry,
                        )
                        attempt += 1
                        continue
                    yield SSEEvent.error(
                        code,
                        f"Python 执行失败: {e}",
                        error_category=category,
                        failed_stage="python",
                        attempt=attempt,
                        diagnostics=diagnostics,
                    )
                    return

            clean_content = self._clean_content_for_display(full_content)
            yield SSEEvent.result(
                content=clean_content or "分析完成",
                sql=final_sql,
                data=final_data,
                rows_count=final_rows_count,
                execution_time=final_execution_time,
                diagnostics=diagnostics,
            )

            if python_images:
                return

            if chart_config and final_data and len(final_data) > 0:
                visualization = self._build_chart_from_config(chart_config, final_data)
                if visualization:
                    diagnostic = self._build_diagnostic_entry(
                        attempt=attempt,
                        phase="chart",
                        status="success",
                        message="已按模型提供的图表配置生成可视化。",
                    )
                    diagnostics.append(diagnostic)
                    yield SSEEvent.progress(
                        "visualizing",
                        diagnostic["message"],
                        attempt=attempt,
                        phase="chart",
                        diagnostic_entry=diagnostic,
                    )
                    yield SSEEvent.visualization(
                        chart_type=visualization.get("type", "bar"),
                        chart_data={
                            "data": visualization.get("data", []),
                            "xKey": visualization.get("xKey"),
                            "yKeys": visualization.get("yKeys"),
                            "title": visualization.get("title"),
                        },
                    )
                    return

                fallback_diag = self._build_diagnostic_entry(
                    attempt=attempt,
                    phase="chart",
                    status="repaired",
                    message="模型图表配置无效，已回退到自动图表生成。",
                    error_code="CHART_CONFIG_INVALID",
                    error_category="chart",
                    recoverable=True,
                )
                diagnostics.append(fallback_diag)
                yield SSEEvent.progress(
                    "visualizing",
                    fallback_diag["message"],
                    attempt=attempt,
                    phase="chart",
                    diagnostic_entry=fallback_diag,
                )

            if final_data and len(final_data) > 0:
                visualization = self._generate_visualization(final_data, query)
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
                return

            return

    async def _execute_sql(
        self,
        sql: str,
        db_config: dict[str, Any],
    ) -> tuple[list[dict] | None, int | None]:
        """执行 SQL 查询"""
        db_manager = create_database_manager(db_config)
        result = db_manager.execute_query(sql, read_only=True)
        return result.data, result.rows_count

    async def _execute_python(self, code: str, timeout: int = 30) -> tuple[str | None, list[str]]:
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

            # 如果有执行错误，抛出异常交给上层做自动修复
            if result.error_in_exec:
                error_msg = "".join(
                    traceback.format_exception(
                        type(result.error_in_exec),
                        result.error_in_exec,
                        result.error_in_exec.__traceback__,
                    )
                )
                combined_output = output.strip()
                if combined_output:
                    error_msg = f"{combined_output}\n\n执行错误:\n{error_msg}"
                raise RuntimeError(error_msg)
            elif result.error_before_exec:
                combined_output = output.strip()
                syntax_error = f"语法错误: {result.error_before_exec}"
                if combined_output:
                    syntax_error = f"{combined_output}\n\n{syntax_error}"
                raise SyntaxError(syntax_error)

            return output if output else None, images

        finally:
            plt.close("all")
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
