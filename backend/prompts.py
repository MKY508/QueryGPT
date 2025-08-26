"""
提示词模板管理模块
包含各种场景的提示词模板
"""
import json
from typing import Dict, Any, Optional

class PromptTemplates:
    """管理各种提示词模板"""
    
    @staticmethod
    def _get_default_connection() -> Dict[str, Any]:
        """获取默认数据库连接信息 - DRY原则"""
        from backend.config_loader import ConfigLoader
        db_config = ConfigLoader.get_database_config()
        return {
            'host': db_config['host'],
            'port': db_config['port'],
            'user': db_config['user'],
            'password': db_config['password'],
            'database': db_config.get('database', '')
        }
    
    @staticmethod
    def _format_connection(conn: Dict[str, Any]) -> str:
        """格式化连接信息 - 避免重复代码"""
        return f"""Host: {conn['host']}
Port: {conn['port']}
User: {conn['user']}
Password: {conn['password']}
Database: {conn.get('database', '')}"""
    
    @staticmethod
    def build_simple_database_prompt(user_query: str, connection_info: Dict[str, Any] = None) -> str:
        """
        生成简化版数据库查询提示词 - 让 OpenInterpreter 自主工作
        """
        if not connection_info:
            connection_info = PromptTemplates._get_default_connection()
        
        return f"""数据库连接（Apache Doris）：
{PromptTemplates._format_connection(connection_info)}

任务：{user_query}

执行原则（尽量少约束，释放 Agent 主动性）：
- 你是自主 Agent：基于以上连接信息，自行探索库表、编写 SQL 与 Python，完成查询与可视化。
- 避免冗长的代码模板输出；按需生成并执行即可。
- 本任务仅需读取数据，请避免写入/DDL 操作。

产出要求（简洁）：
- 如需可视化，将图表保存到 `output/`（文件名用 ASCII，例如 `sales_by_dept_2025_07.html`），**不要自动打开浏览器/HTML**。
- **重要**：图表的标题、轴标签、图例等必须使用中文。
- 文本末尾同时给出：
  【用户视图】2–4 句业务结论（非技术）
  【开发者视图】关键 SQL/耗时/行数/产物路径
- （可选）最后一行输出单行 JSON 便于前端解析，例如：
  `{ "ok": true, "view": "iframe_url"|"iframe_srcdoc"|"table-only", "chart_url": "/reports/xxx.html", "chart_html": "<div>...", "summary_user": "...", "summary_dev": "...", "artifacts": ["/abs/path/file1.html"] }`
"""

    @staticmethod
    def build_clarification_prompt(user_query: str, clarification_needed: str) -> str:
        """
        生成查询澄清提示词 - 请求更多信息
        """
        return f"""用户查询：{user_query}

检测到查询信息不够完整，需要请求澄清：

{clarification_needed}

请以专业的方式回复用户，不要执行查询，只需要：
1. 说明需要什么额外信息
2. 解释为什么需要这些信息
3. 给出1-2个具体的查询示例

保持简洁，不超过3句话。
"""
    
    @staticmethod
    def build_smart_database_prompt(user_query: str, connection_info: Dict[str, Any] = None) -> str:
        """
        智能数据库查询提示词 - 包含表选择策略和查询澄清
        """
        if not connection_info:
            connection_info = PromptTemplates._get_default_connection()
        
        # 查询澄清检查已禁用 - 让 OpenInterpreter 自行处理查询
        
        return f"""任务：{user_query}

数据库连接（Apache Doris）：
{PromptTemplates._format_connection(connection_info)}

智能表选择策略：
```python
# 使用表分类器选择正确的表
from backend.table_selector import SmartTableSelector
selector = SmartTableSelector()

# 1. 获取所有表
cursor.execute("SHOW TABLES")
all_tables = [row[0] for row in cursor.fetchall()]

# 2. 智能选择最合适的表
best_table = selector.select_best_table(all_tables, '{user_query}')
print(f"选择的表: {{best_table}}")

# 3. 验证表内容（检查前5行）
cursor.execute(f"SELECT * FROM {{best_table}} LIMIT 5")
sample = cursor.fetchall()

# 4. 获取推荐的字段
table_type = selector.classifier.classify(best_table)
fields = selector.get_query_fields('{user_query}', table_type)
print(f"推荐字段: {{fields}}")
```

关键提示：
- 销售查询：优先使用包含 invoice/sales/revenue 的表
- 采购查询：优先使用包含 purchase/procurement 的表
- 验证数据：检查样本数据确认是否选择了正确的表

输出要求：
- 保存图表到 output/ 目录（文件名使用英文，内容使用中文）
- 提供简洁的业务结论（2-3句）
- 不要自动打开浏览器或文件
"""
    
    @staticmethod
    def build_database_query_prompt(user_query: str, schema: Dict[str, Any] = None,
                                   connection_info: Dict[str, Any] = None) -> str:
        """
        生成数据库查询提示词 - 语义层增强版
        """
        # 从ConfigLoader获取连接信息
        if not connection_info:
            from backend.config_loader import ConfigLoader
            db_config = ConfigLoader.get_database_config()
            connection_info = {
                'host': db_config['host'],
                'port': db_config['port'],
                'user': db_config['user'],
                'password': db_config['password'],
                'database': db_config.get('database', '')
            }

        # 如果schema太大，只传递简化版
        schema_str = ""
        if schema:
            # 处理不同类型的schema数据
            if isinstance(schema, dict):
                # 如果是字典，按原逻辑处理
                simplified_schema = {}
                for i, (db_name, tables) in enumerate(schema.items()):
                    if i >= 3:
                        break
                    if isinstance(tables, dict):
                        simplified_schema[db_name] = {}
                        for j, (table_name, columns) in enumerate(tables.items()):
                            if j >= 5:
                                break
                            if isinstance(columns, list):
                                simplified_schema[db_name][table_name] = columns[:10]
                            else:
                                simplified_schema[db_name][table_name] = columns
                    else:
                        simplified_schema[db_name] = tables
                schema_str = json.dumps(simplified_schema, ensure_ascii=False, indent=2)
            else:
                # 如果是其他类型，直接转JSON
                schema_str = json.dumps(schema, ensure_ascii=False, indent=2)
        else:
            schema_str = "暂无schema信息，请使用SHOW DATABASES和SHOW TABLES获取"

        return f"""
你是一个数据分析 Agent，能够自主完成：理解需求 → 选择数据源 → 编写 SQL 与 Python → 生成图表/报告。

当前任务：
{user_query}

数据库连接参数（可直接使用）：
```python
import pymysql, pandas as pd, plotly.express as px, os
connection_params = {{
    'host': '{connection_info.get('host')}',
    'port': {connection_info.get('port')},
    'user': '{connection_info.get('user')}',
    'password': '{connection_info.get('password')}',
    'database': '{connection_info.get('database', '')}',
    'charset': 'utf8mb4'
}}
```

【重要】语义层搜索工具：
```python
# 使用语义层工具快速找到正确的表和字段
from backend.semantic_search_tool import SemanticSearchTool
searcher = SemanticSearchTool()

# 根据用户查询获取推荐的表和字段
table, field_mappings = searcher.get_table_for_query("{user_query}")
print(f"推荐使用表: {{table}}")
print(f"字段映射: {{field_mappings}}")

# 搜索特定关键词
result = searcher.search_by_keyword("七折")  # 例如搜索"七折"相关字段
```

（可选）已知结构片段：
{schema_str}

原则（精炼）：
- 智能定位：优先使用语义层工具找到正确的表和字段，避免盲目探索。
- 只读安全：本任务仅涉及读取；请避免写入与 DDL。
- 少即是多：避免输出冗长模板；直接产出可执行/可用的最小代码与结果。
- 不要自动打开：将图表/报表保存到 `output/`，**不要调用 webbrowser.open/os.startfile/subprocess 打开文件**。

输出要求：
- 生成必要的可视化（Plotly），文件名使用 ASCII（如 `sales_by_dept_2025_07.html`），保存到 `output/`。
- **重要**：图表的标题、轴标签、图例等必须使用中文，让业务人员能够理解。
- 在文本末尾同时给出：
  【用户视图】2–4 句业务结论
  【开发者视图】关键 SQL、样本/行数、耗时、产物路径、潜在问题与建议
- （可选）最后一行输出单行 JSON 供前端解析：`{{"ok": true, "view": "iframe_url"|"iframe_srcdoc"|"table-only", "chart_url": "/reports/xxx.html", "chart_html": "<div>...", "summary_user": "...", "summary_dev": "...", "artifacts": ["/abs/path/file1.html"]}}`
"""

    @staticmethod
    def visualization_prompt(data_description: str, chart_type: Optional[str] = None) -> str:
        """
        生成可视化提示词
        """
        chart_instruction = f"使用{chart_type}图表" if chart_type else "选择最合适的图表类型"
        
        return f"""
请为以下数据创建可视化：

## 数据描述
{data_description}

## 要求
1. {chart_instruction}
2. 使用plotly创建交互式图表
3. 设置合适的标题、轴标签和图例
4. 使用美观的配色方案
5. 保存为HTML文件到output目录
6. 如果数据量大，考虑采样或聚合

生成完整的Python代码。
"""

    @staticmethod
    def error_handling_prompt(error_message: str, context: str) -> str:
        """
        生成错误处理提示词
        """
        return f"""
执行过程中遇到错误，请帮助解决：

## 错误信息
{error_message}

## 上下文
{context}

## 请提供
1. 错误原因分析
2. 解决方案
3. 修正后的代码
4. 预防措施

请用简洁清晰的语言解释，并提供可执行的代码。
"""

    @staticmethod
    def data_analysis_prompt(user_query: str, data_summary: str) -> str:
        """
        生成数据分析提示词
        """
        return f"""
请对以下数据进行分析：

## 用户需求
{user_query}

## 数据概况
{data_summary}

## 分析要求
1. 数据清洗和预处理
2. 探索性数据分析（EDA）
3. 统计分析或机器学习（如适用）
4. 关键发现和洞察
5. 可视化展示结果

使用pandas进行数据处理，plotly进行可视化。
输出清晰的分析结果和图表。
"""

    @staticmethod
    def sql_generation_prompt(natural_language: str, schema: Dict[str, Any]) -> str:
        """
        生成SQL查询语句的提示词
        """
        return f"""
将自然语言转换为SQL查询：

## 用户请求
{natural_language}

## 数据库结构
{json.dumps(schema, ensure_ascii=False, indent=2)}

## 要求
1. 生成正确的SQL查询语句
2. 使用Doris/MySQL语法
3. 考虑性能优化（使用索引、避免全表扫描）
4. 添加必要的注释
5. 如果需要多个查询，请分步执行

只返回SQL语句，不需要Python代码。
"""

    @staticmethod
    def code_review_prompt(code: str) -> str:
        """
        代码审查提示词
        """
        return f"""
请审查以下代码：

```python
{code}
```

## 审查要点
1. 代码正确性
2. 安全性（SQL注入、数据泄露等）
3. 性能优化建议
4. 代码风格和可读性
5. 错误处理是否完善

提供改进建议和优化后的代码。
"""

    @staticmethod
    def summary_prompt(results: Any) -> str:
        """
        生成结果摘要的提示词
        """
        return f"""
请为以下查询结果生成简洁的中文摘要：

## 查询结果
{str(results)[:1000]}  # 限制长度

## 摘要要求
1. 用1-3句话概括主要发现
2. 突出关键数据和趋势
3. 使用通俗易懂的语言
4. 如有异常或值得注意的点，请指出


返回简洁的中文摘要。
"""