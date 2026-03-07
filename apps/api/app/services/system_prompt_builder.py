"""System prompt construction helpers."""

from typing import Any

from app.models import RelationshipContext, SemanticContext, SystemCapabilities


def build_system_prompt(
    *,
    language: str,
    db_config: dict[str, Any] | None,
    semantic_context: SemanticContext | None = None,
    relationship_context: RelationshipContext | None = None,
    default_prompt: str | None = None,
    capabilities: SystemCapabilities,
) -> str:
    available_python_libraries = capabilities.available_python_libraries or [
        "pandas",
        "numpy",
        "matplotlib",
    ]
    python_libraries = ", ".join(available_python_libraries)

    if default_prompt:
        base_prompt = default_prompt.strip()
    elif language == "zh":
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
"""

    runtime_rules = (
        """

## 固定运行时约束
1. 只允许生成只读 SQL（SELECT、SHOW、DESCRIBE）
2. 只能基于真实 schema、语义层和表关系回答
3. 不要编造不存在的表、字段、函数或结果
4. 不要访问文件、网络或系统资源
"""
        if language == "zh"
        else """

## Fixed Runtime Constraints
1. Only generate read-only SQL (SELECT, SHOW, DESCRIBE)
2. Only rely on the real schema, semantic layer, and table relationships
3. Do not invent tables, columns, functions, or results
4. Do not access files, network, or system resources
"""
    )
    base_prompt += runtime_rules

    if capabilities.python_enabled:
        if language == "zh":
            python_section = f"""

## Python 分析
当用户明确要求 Python、matplotlib 或自定义分析时，可以生成 ```python 代码块。
工作流程：
1. 先生成只读 SQL。
2. SQL 查询结果会自动注入为 `df` DataFrame。
3. 仅使用这些已启用库：{python_libraries}
4. 不要访问文件、网络或系统资源。

简单示例：
```python
import matplotlib.pyplot as plt

plt.figure(figsize=(10, 6))
plt.bar(df['date'].astype(str), df['amount'])
plt.xlabel('日期')
plt.ylabel('金额')
plt.title('销售数据')
plt.xticks(rotation=45)
plt.tight_layout()
plt.show()
```
"""
            if not capabilities.analytics_installed:
                python_section += """
当前未安装高级分析扩展，不要使用 `sklearn`、`scipy`、`seaborn`。
"""
            python_section += """

## 简单图表配置
如果不需要 Python，可以使用 ```chart 代码块：
```chart
{
  "type": "bar",
  "title": "图表标题",
  "xKey": "x轴字段名",
  "yKeys": ["y轴字段名1"]
}
```

图表类型：bar、line、pie、area
"""
        else:
            python_section = f"""

## Python Analysis
When the user explicitly asks for Python, matplotlib, or custom analysis, you may emit a ```python block.
Workflow:
1. Generate read-only SQL first.
2. SQL results are injected as the `df` DataFrame.
3. Only use these enabled libraries: {python_libraries}
4. Do not access files, network, or system resources.

Simple example:
```python
import matplotlib.pyplot as plt

plt.figure(figsize=(10, 6))
plt.bar(df['date'].astype(str), df['amount'])
plt.xlabel('Date')
plt.ylabel('Amount')
plt.title('Sales')
plt.xticks(rotation=45)
plt.tight_layout()
plt.show()
```
"""
            if not capabilities.analytics_installed:
                python_section += """
Advanced analytics extras are not installed, so do not use `sklearn`, `scipy`, or `seaborn`.
"""
            python_section += """

## Simple Charts
If Python is unnecessary, use a ```chart block:
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
    else:
        python_section = (
            "\n\n## Python 分析已关闭\n不要生成 ```python 代码块，只使用 SQL 和可选的 ```chart 代码块。\n"
            if language == "zh"
            else "\n\n## Python Analysis Disabled\nDo not emit ```python blocks. Use SQL and optional ```chart blocks only.\n"
        )

    base_prompt += python_section

    if db_config:
        base_prompt += f"""
数据库连接信息:
- 类型: {db_config["driver"]}
- 主机: {db_config["host"]}:{db_config["port"]}
- 数据库: {db_config["database"]}
"""

    if semantic_context and semantic_context.terms:
        base_prompt += f"\n{semantic_context.to_prompt(language)}\n"

    if relationship_context and relationship_context.relationships:
        base_prompt += f"\n{relationship_context.to_prompt(language)}\n"

    return base_prompt
