"""
数据库连接和管理模块
支持Apache Doris (MySQL协议)
"""
import pymysql
import json
import logging
from typing import Dict, Any, List, Optional, Tuple
from contextlib import contextmanager
import os
from backend.config_loader import ConfigLoader

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class DatabaseManager:
    """管理Doris数据库连接"""
    
    def __init__(self, config_path: str = None):
        """初始化数据库管理器"""
        # 从.env文件加载配置
        self.config = ConfigLoader.get_database_config()
        
        self.connection_pool = []
        self.max_connections = 5
        logger.info(f"数据库配置: {self.config['host']}:{self.config['port']} - 用户: {self.config['user']}")
        
    
    @contextmanager
    def get_connection(self):
        """获取数据库连接（上下文管理器）"""
        connection = None
        try:
            connection = pymysql.connect(
                host=self.config.get("host", "localhost"),
                port=self.config.get("port", 19130),
                user=self.config.get("user", "root"),
                password=self.config.get("password", ""),
                database=self.config.get("database", ""),
                charset='utf8mb4',
                cursorclass=pymysql.cursors.DictCursor,
                connect_timeout=20,
                read_timeout=20,
                write_timeout=20,
                autocommit=True
            )
            logger.info("数据库连接成功")
            yield connection
        except Exception as e:
            logger.error(f"数据库连接失败: {e}")
            raise
        finally:
            if connection:
                connection.close()
                logger.info("数据库连接已关闭")
    
    def execute_query(self, query: str, params: Optional[Tuple] = None) -> List[Dict]:
        """
        执行只读查询 - 增强的SQL注入防护
        """
        import re
        
        # 移除多余空格和换行
        query = ' '.join(query.split())
        
        # 严格的SQL验证 - 使用正则表达式
        READONLY_PATTERN = re.compile(
            r'^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\s+',
            re.IGNORECASE
        )
        
        if not READONLY_PATTERN.match(query):
            raise ValueError("只允许执行只读查询（SELECT, SHOW, DESCRIBE, EXPLAIN）")
        
        # 检查危险的SQL模式
        DANGEROUS_PATTERNS = [
            r';\s*(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|TRUNCATE|EXEC)',
            r'--',  # SQL注释
            r'/\*.*\*/',  # 块注释
            r'UNION\s+SELECT',  # UNION注入
            r'INTO\s+OUTFILE',  # 文件写入
            r'LOAD_FILE',  # 文件读取
        ]
        
        for pattern in DANGEROUS_PATTERNS:
            if re.search(pattern, query, re.IGNORECASE):
                logger.warning(f"检测到危险的SQL模式: {pattern}")
                raise ValueError("查询包含不允许的SQL模式")
        
        try:
            with self.get_connection() as conn:
                with conn.cursor() as cursor:
                    # 使用参数化查询
                    cursor.execute(query, params)
                    result = cursor.fetchall()
                    logger.info(f"查询成功，返回 {len(result)} 条记录")
                    return result
        except Exception as e:
            logger.error(f"查询执行失败: {e}")
            raise
    
    def test_connection(self) -> Dict[str, Any]:
        """
        测试数据库连接并返回详细信息
        """
        test_result = {
            "connected": False,
            "host": self.config.get("host"),
            "port": self.config.get("port"),
            "user": self.config.get("user"),
            "error": None,
            "databases": [],
            "table_count": 0,  # 添加表数量字段
            "test_queries": []
        }
        
        try:
            # 测试1：基础连接
            logger.info(f"测试连接到 {test_result['host']}:{test_result['port']}")
            result = self.execute_query("SELECT 1 as test")
            if len(result) > 0:
                test_result["connected"] = True
                test_result["test_queries"].append({
                    "query": "SELECT 1",
                    "success": True,
                    "message": "基础连接成功"
                })
            
            # 测试2：获取数据库列表
            if test_result["connected"]:
                try:
                    databases = self.get_database_list()
                    test_result["databases"] = databases
                    test_result["test_queries"].append({
                        "query": "SHOW DATABASES",
                        "success": True,
                        "message": f"发现 {len(databases)} 个数据库"
                    })
                except Exception as e:
                    test_result["test_queries"].append({
                        "query": "SHOW DATABASES",
                        "success": False,
                        "message": f"获取数据库列表失败: {str(e)}"
                    })
            
            # 测试3：统计表数量
            if test_result["connected"] and test_result["databases"]:
                total_tables = 0
                # 只统计主要的业务数据库中的表
                important_dbs = ['center_dws', 'center_dwd', 'center_dim', 'center_ods', 'ads']
                
                for db in test_result["databases"]:
                    if db in important_dbs:
                        try:
                            tables = self.execute_query(f"SHOW TABLES FROM {db}")
                            table_count = len(tables)
                            total_tables += table_count
                            logger.info(f"数据库 {db} 包含 {table_count} 个表")
                        except Exception as e:
                            logger.warning(f"获取数据库 {db} 的表失败: {e}")
                
                test_result["table_count"] = total_tables
                test_result["test_queries"].append({
                    "query": "SHOW TABLES",
                    "success": True,
                    "message": f"共发现 {total_tables} 个表（统计主要业务库）"
                })
            
            # 测试4：检查版本信息
            if test_result["connected"]:
                try:
                    version_result = self.execute_query("SELECT VERSION() as version")
                    if version_result:
                        test_result["version"] = version_result[0].get("version", "Unknown")
                        test_result["test_queries"].append({
                            "query": "SELECT VERSION()",
                            "success": True,
                            "message": f"数据库版本: {test_result['version']}"
                        })
                except Exception as e:
                    test_result["test_queries"].append({
                        "query": "SELECT VERSION()",
                        "success": False,
                        "message": f"获取版本失败: {str(e)}"
                    })
                    
            logger.info(f"连接测试完成: {test_result}")
            return test_result
            
        except Exception as e:
            error_msg = str(e)
            logger.error(f"连接测试失败: {error_msg}")
            test_result["error"] = error_msg
            test_result["test_queries"].append({
                "query": "Connection Test",
                "success": False,
                "message": error_msg
            })
            return test_result
    
    def get_database_list(self) -> List[str]:
        """
        获取数据库列表，供OpenInterpreter参考
        """
        try:
            databases = self.execute_query("SHOW DATABASES")
            db_list = []
            for db in databases:
                db_name = db.get('Database', db.get('DATABASES', ''))
                if db_name and not db_name.startswith('_'):  # 跳过系统数据库
                    db_list.append(db_name)
            logger.info(f"发现 {len(db_list)} 个数据库")
            return db_list
        except Exception as e:
            logger.error(f"获取数据库列表失败: {e}")
            return []
    
    def get_connection_info(self) -> Dict[str, Any]:
        """获取连接信息（用于传递给OpenInterpreter）"""
        return self.config