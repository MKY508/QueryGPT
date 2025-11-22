"""
数据库连接和管理模块
支持 Apache Doris/MySQL 与 SQLite（用于测试/本地）
使用 DBUtils 实现连接池，cachetools 实现查询缓存
"""
import pymysql
import sqlite3
import json
import logging
from typing import Dict, Any, List, Optional, Tuple
from contextlib import contextmanager
import os
import time
from threading import Lock
from backend.core.config import ConfigLoader

# 健壮性导入：尝试导入高级依赖，失败则使用降级方案
try:
    from dbutils.pooled_db import PooledDB
    DBUTILS_AVAILABLE = True
except ImportError:
    PooledDB = None
    DBUTILS_AVAILABLE = False

try:
    from cachetools import TTLCache
    CACHETOOLS_AVAILABLE = True
except ImportError:
    TTLCache = None
    CACHETOOLS_AVAILABLE = False

# 获取日志记录器
logger = logging.getLogger(__name__)

class DatabaseManager:
    """数据库管理器，支持 MySQL(Doris) 与 SQLite（通过 DATABASE_URL）。"""

    def __init__(self, config_path: str = None):
        """初始化数据库管理器"""
        # 连接池
        self._pool = None
        self._sqlite_main_conn: Optional[sqlite3.Connection] = None
        
        # 缓存 (LRU + TTL)
        self.cache_enabled: bool = True
        if CACHETOOLS_AVAILABLE:
            # maxsize=1000: 最多缓存1000条查询
            # ttl=300: 缓存有效期5分钟
            self._cache = TTLCache(maxsize=1000, ttl=300)
        else:
            logger.warning("cachetools 未安装，将使用简单的字典缓存（无自动过期清理，存在内存泄漏风险）")
            self._cache = {}
        
        self.driver = 'mysql'
        self.is_configured = True
        self.last_error: Optional[Exception] = None
        self.config: Dict[str, Any] = {}
        self._global_disabled = False

        # 启动时允许从环境变量禁用数据库
        if os.getenv('DISABLE_DATABASE', '').lower() == 'true':
            self.is_configured = False
            self._global_disabled = True
            logger.warning("环境变量 DISABLE_DATABASE=true，跳过数据库初始化")
            return

        # Driver 选择逻辑
        raw_db_url = os.getenv('DATABASE_URL') or ''
        db_url_lower = raw_db_url.lower()
        testing = (os.getenv('TESTING', '').lower() == 'true')
        has_mysql_env = bool(os.getenv('DB_HOST') or os.getenv('DB_USER'))

        # 1. SQLite 模式
        if db_url_lower.startswith('sqlite://') or (testing and not has_mysql_env):
            self._init_sqlite(raw_db_url, db_url_lower, testing)
        # 2. MySQL 模式
        else:
            self._init_mysql(testing)
    
    def _init_sqlite(self, raw_db_url, db_url_lower, testing):
        self.driver = 'sqlite'
        if testing and not raw_db_url:
            db_path = ':memory:'
            self.config = {"driver": "sqlite", "database": 'sqlite:///:memory:'}
            logger.info("测试模式下默认启用内存SQLite数据库")
        elif db_url_lower == 'sqlite:///:memory:':
            db_path = ':memory:'
            self.config = {"driver": "sqlite", "database": raw_db_url}
        else:
            db_path = raw_db_url.split('sqlite:///')[-1]
            self.config = {"driver": "sqlite", "database": raw_db_url}
            
        self._sqlite_main_conn = sqlite3.connect(db_path, check_same_thread=False)
        self._sqlite_main_conn.row_factory = sqlite3.Row
        logger.info(f"已启用SQLite数据库模式: {db_path}")

    def _init_mysql(self, testing):
        self.driver = 'mysql'
        self.config = ConfigLoader.get_database_config()
        self.is_configured = self.config.get('configured', True)
        
        if not self.is_configured:
            logger.warning("数据库配置缺失，DatabaseManager 暂停运行")
            return

        if not DBUTILS_AVAILABLE:
            logger.error("DBUtils 未安装，无法初始化连接池。请运行 `pip install DBUtils`")
            self.is_configured = False
            return

        # 初始化 DBUtils 连接池
        try:
            pool_size = int(os.getenv('DB_POOL_SIZE', '5'))
            self._pool = PooledDB(
                creator=pymysql,
                mincached=1,
                maxcached=pool_size,
                maxshared=pool_size,
                maxconnections=pool_size * 2,
                blocking=True,
                host=self.config.get("host", "127.0.0.1"),
                port=int(self.config.get("port", 3306)),
                user=self.config.get("user", "root"),
                password=self.config.get("password", ""),
                database=self.config.get("database", ""),
                charset='utf8mb4',
                cursorclass=pymysql.cursors.DictCursor,
                autocommit=True
            )
            logger.info(f"数据库连接池已初始化 (MySQL): {self.config['host']}")
        except Exception as e:
            logger.error(f"数据库连接池初始化失败: {e}")
            self.is_configured = False
            self.last_error = e

    class _ConnectionWrapper:
        """简单的连接包装器，用于统一上下文管理"""
        def __init__(self, conn, is_pooled=False):
            self._conn = conn
            self._is_pooled = is_pooled
        
        def __enter__(self):
            return self._conn
        
        def __exit__(self, exc_type, exc, tb):
            self.close()
            
        def __getattr__(self, item):
            return getattr(self._conn, item)
            
        def close(self):
            if self._is_pooled:
                try:
                    self._conn.close()  # PooledDB 的 close 是归还连接
                except Exception:
                    pass

    def get_connection(self):
        """获取数据库连接"""
        if not getattr(self, 'is_configured', True):
            raise RuntimeError("数据库未配置")
            
        if self.driver == 'sqlite':
            return DatabaseManager._ConnectionWrapper(self._sqlite_main_conn, is_pooled=False)
        else:
            if not self._pool:
                # 尝试重新初始化
                self._init_mysql(os.getenv('TESTING', '').lower() == 'true')
                if not self._pool:
                    raise RuntimeError("数据库连接池未就绪")
            
            try:
                conn = self._pool.connection()
                return DatabaseManager._ConnectionWrapper(conn, is_pooled=True)
            except Exception as e:
                logger.error(f"获取数据库连接失败: {e}")
                raise

    def execute_query(self, query: str, params: Optional[Tuple] = None) -> Dict[str, Any]:
        """
        执行只读查询（返回 {columns, data, row_count}）
        """
        # 移除多余空格
        query = ' '.join(query.split())
        
        # 缓存检查
        cache_key = None
        if self.cache_enabled and not params:
            db_marker = self.config.get('database') or 'default'
            query_normalized = query.strip().lower()[:200]
            cache_key = f"{db_marker}:{query_normalized}"
            if cache_key in self._cache:
                return self._cache[cache_key]

        # 执行底层查询
        result = self._execute_raw_query(query, params)

        # 归一化返回
        rows = result if isinstance(result, list) else []
        if self.driver == 'sqlite' and rows and isinstance(rows[0], sqlite3.Row):
            columns = [d for d in rows[0].keys()]
            data = [tuple(r) for r in rows]
        elif rows and isinstance(rows[0], dict):
            columns = list(rows[0].keys())
            data = [tuple(r.values()) for r in rows]
        else:
            columns = []
            data = []
            
        payload = {"columns": columns, "data": data, "row_count": len(data)}

        if cache_key:
            self._cache[cache_key] = payload
            
            # 如果没有使用 cachetools，手动防止无限增长
            if not CACHETOOLS_AVAILABLE and len(self._cache) > 1000:
                self._cache.clear()
                logger.info("清理了简单的字典缓存 (大小超过1000)")
            
        return payload

    def _execute_raw_query(self, query: str, params: Optional[Tuple] = None):
        """执行底层查询"""
        try:
            # 自动管理连接归还
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(query, params or ())
                return cursor.fetchall()
        except Exception as e:
            logger.error(f"查询执行失败: {e} | SQL: {query}")
            raise
    
    def test_connection(self) -> Dict[str, Any]:
        """测试数据库连接"""
        test_result = {
            "connected": False,
            "error": None,
            "host": self.config.get("host"),
            "port": self.config.get("port"),
            "test_queries": []
        }
        
        try:
            self.execute_query("SELECT 1")
            test_result["connected"] = True
            test_result["test_queries"].append({"query": "SELECT 1", "success": True})
            
            # 获取表数量
            if self.driver == 'mysql':
                tables = self.get_tables()
                test_result["table_count"] = len(tables)
                
        except Exception as e:
            test_result["error"] = str(e)
            
        return test_result

    def get_database_list(self) -> List[str]:
        """获取数据库列表"""
        if self.driver == 'sqlite': return []
        try:
            rows = self._execute_raw_query("SHOW DATABASES")
            return [list(r.values())[0] for r in rows]
        except Exception:
            return []

    def get_tables(self, database: Optional[str] = None) -> List[str]:
        """获取表列表"""
        try:
            if self.driver == 'sqlite':
                rows = self._execute_raw_query("SELECT name FROM sqlite_master WHERE type='table'")
            else:
                sql = "SHOW TABLES"
                if database:
                    # 注意：这里简单拼接可能有风险，但假设 database 来自受控列表
                    # 生产环境应先 USE database 或使用 parameter
                    pass 
                rows = self._execute_raw_query(sql)
            
            return [list(r.values())[0] for r in rows]
        except Exception as e:
            logger.error(f"获取表列表失败: {e}")
            return []

    def get_database_schema(self):
        """获取简化的数据库结构（用于前端展示）"""
        schema = {}
        tables = self.get_tables()
        for table in tables[:50]: # 限制数量防止过大
            try:
                if self.driver == 'sqlite':
                    rows = self._execute_raw_query(f"PRAGMA table_info({table})")
                    cols = [r['name'] for r in rows]
                else:
                    rows = self._execute_raw_query(f"DESCRIBE `{table}`")
                    cols = [r['Field'] for r in rows]
                schema[table] = cols
            except:
                continue
        return schema

    def clear_cache(self):
        self._cache.clear()

    def close_all_connections(self):
        if self._pool:
            self._pool.close()
