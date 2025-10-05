"""
安全SQL执行器
提供直接SQL执行能力，包含安全检查和结果格式化
"""
import re
import logging
from typing import Dict, Any, List, Optional, Union
import pandas as pd
from datetime import datetime
import json

logger = logging.getLogger(__name__)

class SQLSecurityChecker:
    """SQL安全检查器"""
    
    # 危险关键词
    DANGEROUS_KEYWORDS = [
        'DROP', 'DELETE', 'TRUNCATE', 'ALTER', 'CREATE', 
        'INSERT', 'UPDATE', 'REPLACE', 'MERGE',
        'GRANT', 'REVOKE', 'EXECUTE', 'EXEC',
        'SHUTDOWN', 'KILL'
    ]
    
    # 允许的SQL语句类型
    ALLOWED_STATEMENTS = ['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'WITH']
    
    @classmethod
    def is_safe(cls, sql: str) -> tuple[bool, str]:
        """
        检查SQL是否安全
        
        Returns:
            (是否安全, 错误信息)
        """
        sql_upper = sql.upper().strip()
        
        # 1. 检查是否是允许的语句类型
        is_allowed = False
        for stmt in cls.ALLOWED_STATEMENTS:
            if sql_upper.startswith(stmt):
                is_allowed = True
                break
        
        if not is_allowed:
            return False, f"不允许的SQL语句类型，仅支持: {', '.join(cls.ALLOWED_STATEMENTS)}"
        
        # 2. 检查危险关键词
        for keyword in cls.DANGEROUS_KEYWORDS:
            # 使用单词边界检查，避免误判
            pattern = r'\b' + keyword + r'\b'
            if re.search(pattern, sql_upper):
                return False, f"检测到危险操作: {keyword}"
        
        # 3. 检查注释符号（防SQL注入）
        if '--' in sql or '/*' in sql or '*/' in sql:
            return False, "SQL中不允许包含注释"
        
        # 4. 检查分号（防止多语句执行）
        stripped_sql = sql.strip()
        if ';' in stripped_sql:
            # 允许末尾单个分号，但禁止出现多条语句
            statements = [stmt.strip() for stmt in stripped_sql.split(';') if stmt.strip()]
            if len(statements) > 1:
                return False, "不允许执行多条SQL语句"

            if not stripped_sql.endswith(';'):
                return False, "不允许执行多条SQL语句"

        return True, ""

class DirectSQLExecutor:
    """
    直接SQL执行器
    绕过AI直接执行简单SQL查询
    """
    
    def __init__(self, database_manager=None):
        self.database_manager = database_manager
        self.security_checker = SQLSecurityChecker()
        
        # 执行统计
        self.stats = {
            "total_executions": 0,
            "successful_executions": 0,
            "failed_executions": 0,
            "total_rows_returned": 0,
            "avg_execution_time": 0
        }
    
    def execute(self, sql: str, params: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        执行SQL查询
        
        Args:
            sql: SQL语句
            params: SQL参数（用于参数化查询）
            
        Returns:
            执行结果
        """
        import time
        start_time = time.time()
        
        try:
            self.stats["total_executions"] += 1
            
            # 1. 安全检查
            is_safe, error_msg = self.security_checker.is_safe(sql)
            if not is_safe:
                logger.warning(f"SQL安全检查失败: {error_msg}")
                self.stats["failed_executions"] += 1
                return {
                    "success": False,
                    "error": f"SQL安全检查失败: {error_msg}",
                    "sql": sql
                }
            
            # 2. 执行SQL
            if not self.database_manager:
                return {
                    "success": False,
                    "error": "数据库连接未初始化"
                }
            
            logger.info(f"执行SQL: {sql[:200]}...")
            result = self.database_manager.execute_query(sql, params)
            
            # 3. 处理结果
            formatted_result = self._format_result(result, sql)
            
            # 4. 更新统计
            execution_time = time.time() - start_time
            self.stats["successful_executions"] += 1
            if isinstance(result, list):
                self.stats["total_rows_returned"] += len(result)
            
            # 更新平均执行时间
            total = self.stats["successful_executions"]
            self.stats["avg_execution_time"] = (
                (self.stats["avg_execution_time"] * (total - 1) + execution_time) / total
            )
            
            return {
                "success": True,
                "data": formatted_result,
                "sql": sql,
                "execution_time": execution_time,
                "row_count": formatted_result.get("row_count", 0)
            }
            
        except Exception as e:
            logger.error(f"SQL执行失败: {e}")
            self.stats["failed_executions"] += 1
            return {
                "success": False,
                "error": str(e),
                "sql": sql,
                "execution_time": time.time() - start_time
            }
    
    def _format_result(self, result: Any, sql: str) -> Dict[str, Any]:
        """
        格式化查询结果
        """
        # 处理不同类型的结果
        if result is None:
            return {
                "type": "empty",
                "message": "查询未返回数据",
                "row_count": 0
            }
        
        if isinstance(result, (list, tuple)):
            if not result:
                return {
                    "type": "empty",
                    "message": "查询返回空结果集",
                    "row_count": 0
                }
            
            # 转换为DataFrame
            try:
                df = pd.DataFrame(result)
                
                # 处理特殊数据类型
                for col in df.columns:
                    # 处理Decimal类型
                    if df[col].dtype == object:
                        try:
                            df[col] = pd.to_numeric(df[col], errors='ignore')
                        except:
                            pass
                    
                    # 处理日期类型
                    if 'date' in str(col).lower() or 'time' in str(col).lower():
                        try:
                            df[col] = pd.to_datetime(df[col], errors='ignore')
                        except:
                            pass
                
                # 生成描述性统计（如果是数值数据）
                description = self._generate_description(df, sql)
                
                # 转换为可序列化的格式
                data_dict = df.to_dict('records')
                
                # 限制返回行数
                max_rows = 1000
                if len(data_dict) > max_rows:
                    data_dict = data_dict[:max_rows]
                    description += f"\n注意：结果已限制为前{max_rows}行"
                
                return {
                    "type": "table",
                    "columns": list(df.columns),
                    "data": data_dict,
                    "row_count": len(df),
                    "description": description,
                    "summary": self._generate_summary(df)
                }
                
            except Exception as e:
                logger.error(f"结果格式化失败: {e}")
                return {
                    "type": "raw",
                    "data": str(result)[:5000],  # 限制长度
                    "row_count": len(result) if isinstance(result, list) else 1
                }
        
        # 处理标量结果
        return {
            "type": "scalar",
            "value": result,
            "row_count": 1
        }
    
    def _generate_description(self, df: pd.DataFrame, sql: str) -> str:
        """
        生成结果描述
        """
        descriptions = []
        
        # 基本信息
        descriptions.append(f"查询返回 {len(df)} 行, {len(df.columns)} 列")
        
        # 如果是COUNT查询
        if 'COUNT' in sql.upper():
            if len(df) == 1 and len(df.columns) == 1:
                count_value = df.iloc[0, 0]
                descriptions.append(f"计数结果: {count_value}")
        
        # 如果是SUM查询
        elif 'SUM' in sql.upper():
            for col in df.columns:
                if 'sum' in col.lower():
                    total = df[col].iloc[0] if len(df) == 1 else df[col].sum()
                    descriptions.append(f"总计: {total:,.2f}" if isinstance(total, (int, float)) else f"总计: {total}")
        
        # 如果是GROUP BY查询
        elif 'GROUP BY' in sql.upper():
            descriptions.append(f"分组统计结果，包含 {len(df)} 个分组")
        
        return " | ".join(descriptions)
    
    def _generate_summary(self, df: pd.DataFrame) -> Dict[str, Any]:
        """
        生成数据摘要
        """
        summary = {
            "total_rows": len(df),
            "total_columns": len(df.columns),
            "columns": list(df.columns)
        }
        
        # 对数值列生成统计
        numeric_columns = df.select_dtypes(include=['int64', 'float64']).columns.tolist()
        if numeric_columns:
            summary["numeric_summary"] = {}
            for col in numeric_columns[:5]:  # 限制最多5列
                summary["numeric_summary"][col] = {
                    "min": float(df[col].min()),
                    "max": float(df[col].max()),
                    "mean": float(df[col].mean()),
                    "sum": float(df[col].sum())
                }
        
        return summary
    
    def get_stats(self) -> Dict[str, Any]:
        """
        获取执行统计
        """
        return self.stats.copy()


class NaturalLanguageToSQL:
    """
    自然语言转SQL转换器
    使用模板和规则将简单的自然语言查询转换为SQL
    """
    
    def __init__(self):
        # 查询模板
        self.templates = {
            "count": {
                "patterns": [
                    r"(.+?)有多少",
                    r"(.+?)的?数量",
                    r"统计(.+?)的?个数",
                    r"一共有多少(.+?)",
                ],
                "sql": "SELECT COUNT(*) as count FROM {table}"
            },
            "list_all": {
                "patterns": [
                    r"(显示|查看|列出)所有(.+?)的?(数据|记录|信息)?",
                    r"所有的(.+?)",
                    r"(.+?)列表",
                ],
                "sql": "SELECT * FROM {table} LIMIT 100"
            },
            "sum": {
                "patterns": [
                    r"(.+?)的?总(额|和|计)",
                    r"求(.+?)的?和",
                    r"(.+?)加起来",
                ],
                "sql": "SELECT SUM({column}) as total FROM {table}"
            },
            "latest": {
                "patterns": [
                    r"最新的?(\d+)?条?(.+?)",
                    r"最近的?(\d+)?条?(.+?)",
                ],
                "sql": "SELECT * FROM {table} ORDER BY {date_column} DESC LIMIT {limit}"
            }
        }
        
        # 表名映射（可以从配置文件加载）
        self.table_mappings = {
            "用户": "users",
            "订单": "orders", 
            "产品": "products",
            "销售": "sales",
            "客户": "customers",
            # 更多映射...
        }
    
    def convert(self, natural_query: str) -> Optional[str]:
        """
        将自然语言转换为SQL
        
        Args:
            natural_query: 自然语言查询
            
        Returns:
            SQL语句或None
        """
        query_lower = natural_query.lower()
        
        # 尝试匹配各个模板
        for template_name, template in self.templates.items():
            for pattern in template["patterns"]:
                match = re.search(pattern, natural_query, re.IGNORECASE)
                if match:
                    # 提取参数
                    params = self._extract_params(match, template_name, natural_query)
                    if params:
                        # 生成SQL
                        sql = template["sql"].format(**params)
                        logger.info(f"自然语言转SQL成功: {natural_query[:50]}... -> {sql}")
                        return sql
        
        logger.info(f"无法转换自然语言到SQL: {natural_query[:50]}...")
        return None
    
    def _extract_params(self, match: re.Match, template_name: str, query: str) -> Optional[Dict[str, str]]:
        """
        从匹配结果中提取SQL参数
        """
        params = {}
        
        if template_name == "count" or template_name == "list_all":
            # 提取表名
            table_hint = match.group(1) if match.lastindex >= 1 else ""
            table = self._resolve_table_name(table_hint)
            if not table:
                return None
            params["table"] = table
            
        elif template_name == "latest":
            # 提取数量和表名
            limit = match.group(1) if match.lastindex >= 1 and match.group(1) else "10"
            table_hint = match.group(2) if match.lastindex >= 2 else ""
            table = self._resolve_table_name(table_hint)
            if not table:
                return None
            params["table"] = table
            params["limit"] = limit
            params["date_column"] = "created_at"  # 默认日期字段
            
        # 更多模板参数提取...
        
        return params
    
    def _resolve_table_name(self, hint: str) -> Optional[str]:
        """
        解析表名
        """
        hint = hint.strip()
        
        # 直接匹配
        if hint in self.table_mappings:
            return self.table_mappings[hint]
        
        # 模糊匹配
        for chinese, english in self.table_mappings.items():
            if chinese in hint or english in hint:
                return english
        
        # 如果没有映射，尝试直接使用（可能是英文表名）
        if re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', hint):
            return hint
        
        return None