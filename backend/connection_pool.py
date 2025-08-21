"""
数据库连接池模块
提供高效的连接管理
"""
import pymysql
import threading
import queue
import time
import logging
from contextlib import contextmanager
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

class ConnectionPool:
    """线程安全的数据库连接池"""
    
    def __init__(self, config: Dict[str, Any], min_size: int = 2, max_size: int = 10):
        """
        初始化连接池
        
        Args:
            config: 数据库配置
            min_size: 最小连接数
            max_size: 最大连接数
        """
        self.config = config
        self.min_size = min_size
        self.max_size = max_size
        
        # 连接池
        self._pool = queue.Queue(maxsize=max_size)
        # 当前连接数
        self._size = 0
        # 线程锁
        self._lock = threading.Lock()
        
        # 连接健康检查间隔（秒）
        self.health_check_interval = 60
        self._last_health_check = time.time()
        
        # 初始化最小连接数
        self._initialize_pool()
    
    def _initialize_pool(self):
        """初始化连接池，创建最小数量的连接"""
        for _ in range(self.min_size):
            try:
                conn = self._create_connection()
                self._pool.put(conn)
                self._size += 1
            except Exception as e:
                logger.error(f"初始化连接失败: {e}")
        
        logger.info(f"连接池初始化完成，当前连接数: {self._size}")
    
    def _create_connection(self):
        """创建新的数据库连接"""
        return pymysql.connect(
            host=self.config.get("host"),
            port=self.config.get("port", 3306),
            user=self.config.get("user"),
            password=self.config.get("password"),
            database=self.config.get("database", ""),
            charset='utf8mb4',
            cursorclass=pymysql.cursors.DictCursor,
            connect_timeout=10,
            read_timeout=30,
            write_timeout=30,
            autocommit=True
        )
    
    def _is_connection_alive(self, conn) -> bool:
        """检查连接是否存活"""
        try:
            conn.ping(reconnect=False)
            return True
        except:
            return False
    
    def _health_check(self):
        """执行连接健康检查"""
        current_time = time.time()
        if current_time - self._last_health_check < self.health_check_interval:
            return
        
        self._last_health_check = current_time
        
        # 检查池中的连接
        temp_connections = []
        while not self._pool.empty():
            try:
                conn = self._pool.get_nowait()
                if self._is_connection_alive(conn):
                    temp_connections.append(conn)
                else:
                    # 连接已死，关闭并减少计数
                    try:
                        conn.close()
                    except:
                        pass
                    with self._lock:
                        self._size -= 1
                    logger.debug("移除死亡连接")
            except queue.Empty:
                break
        
        # 将存活的连接放回池中
        for conn in temp_connections:
            self._pool.put(conn)
        
        # 确保有最小数量的连接
        with self._lock:
            while self._size < self.min_size:
                try:
                    conn = self._create_connection()
                    self._pool.put(conn)
                    self._size += 1
                    logger.debug("创建新连接以维持最小连接数")
                except Exception as e:
                    logger.error(f"创建连接失败: {e}")
                    break
    
    def get_connection(self, timeout: Optional[float] = 5.0):
        """
        从池中获取连接
        
        Args:
            timeout: 获取连接的超时时间（秒）
            
        Returns:
            数据库连接对象
        """
        # 执行健康检查
        self._health_check()
        
        # 尝试从池中获取连接
        try:
            conn = self._pool.get(timeout=timeout)
            
            # 验证连接是否存活
            if not self._is_connection_alive(conn):
                # 连接已死，创建新连接
                try:
                    conn.close()
                except:
                    pass
                
                conn = self._create_connection()
                logger.debug("替换死亡连接")
            
            return conn
            
        except queue.Empty:
            # 池中没有可用连接，尝试创建新连接
            with self._lock:
                if self._size < self.max_size:
                    try:
                        conn = self._create_connection()
                        self._size += 1
                        logger.debug(f"创建新连接，当前连接数: {self._size}")
                        return conn
                    except Exception as e:
                        logger.error(f"创建新连接失败: {e}")
                        raise
                else:
                    raise Exception(f"连接池已满（最大连接数: {self.max_size}）")
    
    def return_connection(self, conn):
        """
        将连接返回池中
        
        Args:
            conn: 要返回的连接
        """
        if conn is None:
            return
        
        # 检查连接是否存活
        if self._is_connection_alive(conn):
            try:
                # 清理连接状态
                conn.rollback()  # 回滚未提交的事务
                self._pool.put(conn)
            except queue.Full:
                # 池已满，关闭连接
                try:
                    conn.close()
                except:
                    pass
                with self._lock:
                    self._size -= 1
                logger.debug("连接池已满，关闭多余连接")
        else:
            # 连接已死，关闭并减少计数
            try:
                conn.close()
            except:
                pass
            with self._lock:
                self._size -= 1
            logger.debug("关闭死亡连接")
    
    @contextmanager
    def get_connection_context(self, timeout: Optional[float] = 5.0):
        """
        上下文管理器方式获取连接
        
        Usage:
            with pool.get_connection_context() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT 1")
        """
        conn = None
        try:
            conn = self.get_connection(timeout)
            yield conn
        finally:
            if conn:
                self.return_connection(conn)
    
    def close_all(self):
        """关闭所有连接"""
        while not self._pool.empty():
            try:
                conn = self._pool.get_nowait()
                conn.close()
            except:
                pass
        
        with self._lock:
            self._size = 0
        
        logger.info("所有连接已关闭")
    
    def get_stats(self) -> Dict[str, Any]:
        """获取连接池统计信息"""
        return {
            'pool_size': self._size,
            'available_connections': self._pool.qsize(),
            'in_use_connections': self._size - self._pool.qsize(),
            'min_size': self.min_size,
            'max_size': self.max_size
        }