"""Prompt builders used by the chat execution engine."""

from __future__ import annotations

from typing import Any


def build_initial_messages(
    *,
    query: str,
    system_prompt: str,
    db_context: str | None = None,
    history: list[dict[str, str]] | None = None,
) -> list[dict[str, str]]:
    messages = [{"role": "system", "content": system_prompt}]

    if db_context:
        messages.append({"role": "system", "content": db_context})

    if history:
        for message in history:
            if message.get("role") in {"user", "assistant"} and message.get("content"):
                messages.append({"role": message["role"], "content": message["content"]})

    messages.append({"role": "user", "content": query})
    return messages


def build_sql_repair_prompt(query: str, failed_sql: str | None, error_message: str) -> str:
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


def build_missing_sql_prompt(query: str) -> str:
    return f"""上一步回答没有提供可执行的 SQL，请重新给出完整答复。

原始问题：
{query}

要求：
1. 必须包含一个 ```sql 代码块。
2. SQL 只能使用已提供的真实表和字段。
3. 可以保留必要的分析说明，但不要省略 SQL。
"""


def build_python_repair_prompt(
    *,
    query: str,
    failed_sql: str | None,
    failed_python: str | None,
    error_message: str,
    available_python_libraries: list[str],
) -> str:
    sql_block = failed_sql or "未提供 SQL"
    python_block = failed_python or "未提供 Python"
    libraries = ", ".join(available_python_libraries)
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
3. 代码只能使用这些当前可用库：{libraries}，并直接使用已注入的 df。
4. 不要访问文件、网络或系统资源。
"""


def build_repair_messages(
    *,
    query: str,
    system_prompt: str,
    previous_content: str,
    repair_prompt: str,
    db_context: str | None = None,
    history: list[dict[str, str]] | None = None,
) -> list[dict[str, str]]:
    messages = build_initial_messages(
        query=query,
        system_prompt=system_prompt,
        db_context=db_context,
        history=history,
    )
    messages.append({"role": "assistant", "content": previous_content})
    messages.append({"role": "user", "content": repair_prompt})
    return messages


def build_db_context(db_config: dict[str, Any], schema_info: str) -> str:
    """Build database context injected into the model prompt."""
    driver = db_config.get("driver", "mysql")
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
