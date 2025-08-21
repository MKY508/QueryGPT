"""
OpenInterpreter实例池
避免重复创建实例的开销
"""
import queue
import threading
import time
import logging
from typing import Optional, Dict, Any
from contextlib import contextmanager
from interpreter import OpenInterpreter

logger = logging.getLogger(__name__)

class InterpreterPool:
    """OpenInterpreter实例池管理器"""
    
    def __init__(self, min_size: int = 1, max_size: int = 3):
        """
        初始化Interpreter池
        
        Args:
            min_size: 最小实例数
            max_size: 最大实例数
        """
        self.min_size = min_size
        self.max_size = max_size
        
        # 实例池
        self._pool = queue.Queue(maxsize=max_size)
        # 当前实例数
        self._size = 0
        # 线程锁
        self._lock = threading.Lock()
        
        # 实例配置缓存
        self._config_cache = {}
        
        # 实例使用统计
        self._usage_stats = {
            'created': 0,
            'reused': 0,
            'reset': 0
        }
        
        # 初始化池
        self._initialize_pool()
    
    def _initialize_pool(self):
        """初始化实例池"""
        logger.info(f"初始化Interpreter池，最小实例数: {self.min_size}")
        # 暂不预创建实例，按需创建以节省资源
        pass
    
    def _create_interpreter(self, model_config: Dict[str, Any]) -> OpenInterpreter:
        """
        创建新的Interpreter实例
        
        Args:
            model_config: 模型配置
            
        Returns:
            配置好的Interpreter实例
        """
        logger.debug("创建新的Interpreter实例")
        
        interpreter = OpenInterpreter()
        
        # 配置LLM设置
        interpreter.llm.api_key = model_config.get("api_key")
        interpreter.llm.api_base = model_config.get("base_url")
        interpreter.llm.model = model_config.get("model_name")
        
        # 安全和行为设置
        interpreter.auto_run = True
        interpreter.safe_mode = "off"
        interpreter.max_output = 100000  # 增加输出限制
        
        # 设置系统消息
        interpreter.system_message = """你是一个专业的数据分析助手。
请帮助用户查询数据库并生成可视化。
使用pandas处理数据，使用plotly创建图表。
将结果保存为HTML文件到output目录。
始终使用中文标签和说明。"""
        
        self._usage_stats['created'] += 1
        
        return interpreter
    
    def _reset_interpreter(self, interpreter: OpenInterpreter) -> bool:
        """
        重置Interpreter实例状态
        
        Args:
            interpreter: 要重置的实例
            
        Returns:
            是否重置成功
        """
        try:
            # 清理对话历史
            if hasattr(interpreter, 'messages'):
                interpreter.messages = []
            
            # 重置代码执行环境
            if hasattr(interpreter, 'computer') and hasattr(interpreter.computer, 'reset'):
                interpreter.computer.reset()
            
            # 清理临时文件（如果有）
            # interpreter.cleanup_temp_files()
            
            self._usage_stats['reset'] += 1
            logger.debug("Interpreter实例重置成功")
            return True
            
        except Exception as e:
            logger.error(f"重置Interpreter失败: {e}")
            return False
    
    def get_interpreter(self, model_config: Dict[str, Any], timeout: float = 30.0) -> OpenInterpreter:
        """
        获取Interpreter实例
        
        Args:
            model_config: 模型配置
            timeout: 获取超时时间
            
        Returns:
            Interpreter实例
        """
        # 生成配置键
        config_key = f"{model_config.get('model_name')}_{model_config.get('base_url')}"
        
        # 尝试从池中获取
        try:
            if not self._pool.empty():
                interpreter = self._pool.get_nowait()
                
                # 检查配置是否匹配
                if self._config_cache.get(id(interpreter)) == config_key:
                    # 配置匹配，重置并返回
                    if self._reset_interpreter(interpreter):
                        self._usage_stats['reused'] += 1
                        logger.debug("重用现有Interpreter实例")
                        return interpreter
                    else:
                        # 重置失败，创建新实例
                        del self._config_cache[id(interpreter)]
                        with self._lock:
                            self._size -= 1
                else:
                    # 配置不匹配，返回池中并创建新的
                    self._pool.put(interpreter)
        except queue.Empty:
            pass
        
        # 创建新实例
        with self._lock:
            if self._size < self.max_size:
                interpreter = self._create_interpreter(model_config)
                self._config_cache[id(interpreter)] = config_key
                self._size += 1
                logger.info(f"创建新Interpreter实例，当前池大小: {self._size}")
                return interpreter
            else:
                # 池已满，等待可用实例
                logger.warning(f"Interpreter池已满（最大: {self.max_size}），等待可用实例")
                try:
                    interpreter = self._pool.get(timeout=timeout)
                    # 重新配置
                    interpreter.llm.api_key = model_config.get("api_key")
                    interpreter.llm.api_base = model_config.get("base_url")
                    interpreter.llm.model = model_config.get("model_name")
                    self._config_cache[id(interpreter)] = config_key
                    self._reset_interpreter(interpreter)
                    return interpreter
                except queue.Empty:
                    raise Exception("无法获取Interpreter实例：池已满且超时")
    
    def return_interpreter(self, interpreter: OpenInterpreter):
        """
        将Interpreter实例返回池中
        
        Args:
            interpreter: 要返回的实例
        """
        if interpreter is None:
            return
        
        try:
            # 尝试将实例放回池中
            self._pool.put_nowait(interpreter)
            logger.debug("Interpreter实例已返回池中")
        except queue.Full:
            # 池已满，销毁实例
            if id(interpreter) in self._config_cache:
                del self._config_cache[id(interpreter)]
            with self._lock:
                self._size -= 1
            logger.debug("池已满，销毁多余的Interpreter实例")
    
    @contextmanager
    def get_interpreter_context(self, model_config: Dict[str, Any]):
        """
        上下文管理器方式获取Interpreter
        
        Usage:
            with pool.get_interpreter_context(config) as interpreter:
                result = interpreter.chat("查询数据")
        """
        interpreter = None
        try:
            interpreter = self.get_interpreter(model_config)
            yield interpreter
        finally:
            if interpreter:
                self.return_interpreter(interpreter)
    
    def clear_pool(self):
        """清空实例池"""
        while not self._pool.empty():
            try:
                interpreter = self._pool.get_nowait()
                if id(interpreter) in self._config_cache:
                    del self._config_cache[id(interpreter)]
            except:
                pass
        
        with self._lock:
            self._size = 0
        
        logger.info("Interpreter池已清空")
    
    def get_stats(self) -> Dict[str, Any]:
        """获取池统计信息"""
        return {
            'pool_size': self._size,
            'available': self._pool.qsize(),
            'in_use': self._size - self._pool.qsize(),
            'max_size': self.max_size,
            'usage_stats': self._usage_stats
        }

# 创建全局实例池
interpreter_pool = InterpreterPool(min_size=1, max_size=3)