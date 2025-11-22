"""
安全SQL执行器
提供直接SQL执行能力，包含安全检查和结果格式化
已移除过时的 Regex 防火墙，依赖数据库只读用户进行权限控制
"""
import logging
from typing import Dict, Any, List, Optional, Union
import pandas as pd
from datetime import datetime
import json

logger = logging.getLogger(__name__)

class DirectSQLExecutor:
    """
    直接SQL执行器
    """
    
    def __init__(self, database_manager=None):
        self.database_manager = database_manager
        
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
        """
        import time
        start_time = time.time()
        
        try:
            self.stats["total_executions"] += 1
            
            # 1. 基础校验
            if not sql or not sql.strip():
                 return {"success": False, "error": "SQL为空"}

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
        
        # 如果是字典格式（由 DatabaseManager 归一化返回）
        if isinstance(result, dict) and 'data' in result:
             # 已经是标准化格式，直接返回摘要
             rows = result['data']
             cols = result['columns']
             return {
                "type": "table",
                "columns": cols,
                "data": [dict(zip(cols, r)) for r in rows[:1000]], # 限制返回行数
                "row_count": len(rows),
                "description": f"返回 {len(rows)} 行数据"
             }

        return {
            "type": "raw",
            "data": str(result)[:5000],
            "row_count": 1
        }
    
    def get_stats(self) -> Dict[str, Any]:
        return self.stats.copy()
