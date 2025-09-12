"""
OpenInterpreter Manager Module
使用OpenInterpreter 0.4.3版本管理AI会话
"""
import os
import json
import signal
from typing import Dict, Any, Optional, Set
import logging

# 尝试导入OpenInterpreter，如果失败则设置标志
try:
    from interpreter import OpenInterpreter
    INTERPRETER_AVAILABLE = True
except ImportError:
    logger = logging.getLogger(__name__)
    logger.warning("OpenInterpreter未安装，相关功能将被禁用。请运行: pip install open-interpreter==0.4.3")
    INTERPRETER_AVAILABLE = False
    # 创建一个占位类
    class OpenInterpreter:
        def __init__(self):
            raise NotImplementedError("OpenInterpreter未安装。请运行: pip install open-interpreter==0.4.3")
from backend.config_loader import ConfigLoader
# from backend.query_clarifier import SmartQueryProcessor  # 已禁用查询澄清器
import time
import psutil
import signal
from threading import Lock, Thread, Event

# 获取日志记录器
logger = logging.getLogger(__name__)

class InterpreterManager:
    """管理OpenInterpreter会话"""
    
    def __init__(self, config_path: str = None):
        """初始化管理器"""
        # 基本属性（即使未安装也初始化，以便测试桩可工作）
        self.enabled = INTERPRETER_AVAILABLE
        # 从.env文件加载配置
        api_config = ConfigLoader.get_api_config()
        self.config = {
            "models": api_config["models"],
            "current_model": api_config["default_model"]
        }
        self._clear_proxy_env()
        
        # 会话缓存：存储活跃的interpreter实例
        self._session_cache = {}
        # 会话最后活跃时间
        self._session_last_active = {}
        # 会话锁，避免并发问题
        self._session_lock = Lock()
        # 会话超时时间（秒）
        self.session_timeout = 1800  # 30分钟
        # 安全修复：限制会话缓存大小，防止内存泄漏
        self.max_session_cache_size = 100  # 最多缓存100个会话
        
        # 进程跟踪：conversation_id -> set of PIDs
        self._active_processes: Dict[str, Set[int]] = {}
        self._process_lock = Lock()
        
        # 进程监控线程管理
        self._monitor_threads: Dict[str, Thread] = {}
        self._stop_events: Dict[str, Event] = {}
        self._monitor_lock = Lock()
        
        # 会话历史存储（内存中，重启后清空）
        self._conversation_history = {}
        # 最大历史轮数（防止上下文过长）
        self.max_history_rounds = 3
        
        if not INTERPRETER_AVAILABLE:
            logger.warning("OpenInterpreter未安装，部分功能将被禁用（测试场景可通过桩替代）")
            return
        
    def _clear_proxy_env(self):
        """清除代理环境变量，避免LiteLLM冲突"""
        proxy_vars = ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY']
        for var in proxy_vars:
            os.environ.pop(var, None)
        logger.info("已清除代理环境变量")
        
    
    def create_interpreter(self, model_name: Optional[str] = None) -> OpenInterpreter:
        """
        创建新的Interpreter实例
        每次创建新实例以避免状态污染
        """
        if not self.enabled:
            # 在测试环境下提供一个轻量级的替身，避免并发下偶发未打桩导致500
            if os.getenv('TESTING', '').lower() == 'true':
                class _DummyInterpreter:
                    def __init__(self):
                        self.auto_run = True
                        self.safe_mode = 'off'
                        self.llm = type('LLM', (), {'api_key': None, 'api_base': None, 'model': None})()
                        self.system_message = ""
                    def chat(self, prompt):
                        return [{"role": "assistant", "content": "OK"}]
                return _DummyInterpreter()
            raise RuntimeError("OpenInterpreter未安装。请运行: pip install open-interpreter==0.4.3")
        
        from backend.config_loader import ConfigLoader
        model_name = model_name or self.config.get("current_model", "gpt-4o")
        model_name = ConfigLoader.normalize_model_id(model_name)
        models_dict = self.config.get("models", {})
        model_config = models_dict.get(model_name) or models_dict.get(ConfigLoader.normalize_model_id(model_name))
        
        if not model_config:
            raise ValueError(f"模型配置不存在: {model_name}")
        
        # 创建新的OpenInterpreter实例
        interpreter = OpenInterpreter()
        
        # 配置LLM设置（OpenInterpreter 0.4.3 API）
        interpreter.llm.api_key = model_config.get("api_key")
        interpreter.llm.api_base = model_config.get("base_url")
        interpreter.llm.model = model_config.get("model_name")
        
        # 配置安全设置
        interpreter.auto_run = True  # 自动执行代码
        interpreter.safe_mode = "off"  # 关闭安全模式以执行所有代码
        
        # 设置系统消息（默认中文，将在execute_query中根据语言更新）
        interpreter.system_message = """
        你是一个数据分析助手。请帮助用户查询数据库并生成可视化。
        使用pandas处理数据，使用plotly创建图表。
        将结果保存为HTML文件到output目录。
        """
        
        logger.info(f"创建了新的Interpreter实例，使用模型: {model_name}")
        return interpreter
    
    def execute_query(self, query: str, context: Dict[str, Any] = None, 
                     model_name: Optional[str] = None, conversation_id: Optional[str] = None,
                     stop_checker: Optional[callable] = None, language: str = 'zh') -> Dict[str, Any]:
        """
        执行查询并返回结果，支持会话上下文和中断
        """
        try:
            # 查询澄清检查已禁用 - 让 OpenInterpreter 自行处理所有查询
            # 直接使用原始查询，不进行预处理
            # 创建新的interpreter实例
            interpreter = self.create_interpreter(model_name)
            
            # 加载prompt配置来设置系统消息
            prompt_config = {}
            config_path = os.path.join(os.path.dirname(__file__), 'prompt_config.json')
            try:
                if os.path.exists(config_path):
                    with open(config_path, 'r', encoding='utf-8') as f:
                        prompt_config = json.load(f)
            except Exception as e:
                logger.warning(f"加载prompt配置失败: {e}")
            
            # 根据路由类型和语言设置系统消息
            lang_key = 'en' if language == 'en' else 'zh'
            route_type = context.get('route_type', 'AI_ANALYSIS') if context else 'AI_ANALYSIS'
            
            # 根据路由类型选择不同的系统消息
            if route_type == 'DIRECT_SQL':
                # DIRECT_SQL路由：从配置文件读取或使用默认值
                if prompt_config and 'systemMessage' in prompt_config and 'DIRECT_SQL' in prompt_config['systemMessage']:
                    direct_sql_config = prompt_config['systemMessage']['DIRECT_SQL']
                    if lang_key in direct_sql_config:
                        interpreter.system_message = direct_sql_config[lang_key]
                    else:
                        # 默认的DIRECT_SQL prompt
                        interpreter.system_message = """
                        你是一个SQL查询助手。你的任务是：
                        1. 连接数据库并执行SQL查询
                        2. 以清晰的格式返回查询结果
                        3. 不要创建任何可视化或图表
                        4. 不要保存任何文件
                        5. 只专注于检索和显示数据
                        """ if lang_key == 'zh' else """
                        You are a SQL query assistant. Your task is to:
                        1. Connect to the database and execute SQL queries
                        2. Return query results in a clear format
                        3. DO NOT create any visualizations or charts
                        4. DO NOT save any files
                        5. Focus only on retrieving and displaying data
                        """
                else:
                    # 默认的DIRECT_SQL prompt
                    if language == 'en':
                        interpreter.system_message = """
                        You are a SQL query assistant. Your task is to:
                        1. Connect to the database and execute SQL queries
                        2. Return query results in a clear format
                        3. DO NOT create any visualizations or charts
                        4. DO NOT save any files
                        5. Focus only on retrieving and displaying data
                        IMPORTANT: Please respond in English.
                        """
                    else:
                        interpreter.system_message = """
                        你是一个SQL查询助手。你的任务是：
                        1. 连接数据库并执行SQL查询
                        2. 以清晰的格式返回查询结果
                        3. 不要创建任何可视化或图表
                        4. 不要保存任何文件
                        5. 只专注于检索和显示数据
                        重要：请用中文回复。
                        """
                logger.info(f"使用DIRECT_SQL路由的限制性prompt")
            else:
                # AI_ANALYSIS路由：从配置文件读取或使用默认值
                if prompt_config and 'systemMessage' in prompt_config and 'AI_ANALYSIS' in prompt_config['systemMessage']:
                    ai_analysis_config = prompt_config['systemMessage']['AI_ANALYSIS']
                    if lang_key in ai_analysis_config:
                        interpreter.system_message = ai_analysis_config[lang_key]
                    else:
                        # 默认的AI_ANALYSIS prompt
                        interpreter.system_message = """
                        你是一个数据分析助手。请帮助用户查询数据库并生成可视化。
                        使用pandas处理数据，使用plotly创建图表。
                        将结果保存为HTML文件到output目录。
                        """ if lang_key == 'zh' else """
                        You are a data analysis assistant. Help users query databases and generate visualizations.
                        Use pandas for data processing and plotly for creating charts.
                        Save results as HTML files to the output directory.
                        """
                else:
                    # 默认的AI_ANALYSIS prompt
                    if language == 'en':
                        interpreter.system_message = """
                        You are a data analysis assistant. Help users query databases and generate visualizations.
                        Use pandas for data processing and plotly for creating charts.
                        Save results as HTML files to the output directory.
                        IMPORTANT: Please respond in English.
                        """
                    else:
                        interpreter.system_message = """
                        你是一个数据分析助手。请帮助用户查询数据库并生成可视化。
                        使用pandas处理数据，使用plotly创建图表。
                        将结果保存为HTML文件到output目录。
                        重要：请用中文回复。
                        """
                logger.info(f"使用AI_ANALYSIS路由的完整功能prompt")
            
            # 获取会话历史（如果有）
            conversation_history = None
            if conversation_id:
                conversation_history = self._get_conversation_history(conversation_id)
                logger.info(f"[会话上下文] 会话ID: {conversation_id}, 历史消息数: {len(conversation_history) if conversation_history else 0}")
                if conversation_history:
                    logger.debug(f"[会话上下文] 最近消息: {conversation_history[-2:] if len(conversation_history) >= 2 else conversation_history}")
            else:
                logger.warning("[会话上下文] 未提供会话ID，无法维持对话上下文")
            
            # 构建包含历史的提示词（使用增强后的查询）
            full_prompt = self._build_prompt_with_context(query, context, conversation_history, language)
            logger.debug(f"[会话上下文] 构建的完整提示词长度: {len(full_prompt)} 字符")
            
            # 存储当前的interpreter以便停止
            if conversation_id:
                with self._session_lock:
                    # 安全修复：检查缓存大小限制
                    if len(self._session_cache) >= self.max_session_cache_size:
                        # 使用LRU策略：删除最久未使用的会话
                        if self._session_last_active:
                            oldest_session = min(self._session_last_active.items(), key=lambda x: x[1])[0]
                            logger.info(f"缓存已满，删除最旧会话: {oldest_session}")
                            if oldest_session in self._session_cache:
                                del self._session_cache[oldest_session]
                            if oldest_session in self._session_last_active:
                                del self._session_last_active[oldest_session]
                    
                    self._session_cache[conversation_id] = interpreter
                    self._session_last_active[conversation_id] = time.time()
            
            # 执行查询
            logger.info(f"执行查询: {query[:100]}... (会话ID: {conversation_id})")
            
            # 检查是否需要停止
            if stop_checker and stop_checker():
                logger.info(f"查询被用户中断: {conversation_id}")
                return {
                    "success": False,
                    "error": "查询被用户中断",
                    "interrupted": True,
                    "model": model_name or self.config.get("current_model"),
                    "conversation_id": conversation_id
                }
            
            # 启动持续进程监控（测试环境禁用以提升速度与兼容性）
            if conversation_id and os.getenv('TESTING', '').lower() != 'true':
                self._start_process_monitoring(conversation_id)
            
            # 执行查询（带停止检查）
            try:
                # 创建一个包装函数来定期检查停止状态
                result = None
                error_occurred = False
                
                def execute_with_check():
                    nonlocal result, error_occurred
                    try:
                        result = interpreter.chat(full_prompt)
                    except KeyboardInterrupt:
                        logger.info(f"查询被键盘中断: {conversation_id}")
                        error_occurred = True
                    except Exception as e:
                        logger.error(f"执行出错: {e}")
                        error_occurred = True
                        result = str(e)
                
                # 在单独线程执行，以便能够中断
                exec_thread = Thread(target=execute_with_check)
                exec_thread.start()
                
                # 等待执行完成或停止信号
                while exec_thread.is_alive():
                    if stop_checker and stop_checker():
                        logger.info(f"检测到停止信号，尝试中断执行: {conversation_id}")
                        
                        # 尝试中断interpreter
                        if hasattr(interpreter, 'stop') and callable(interpreter.stop):
                            interpreter.stop()
                        
                        # 终止所有子进程
                        self._terminate_processes(conversation_id)
                        
                        # 等待线程结束
                        exec_thread.join(timeout=2)
                        
                        return {
                            "success": False,
                            "error": "查询被用户中断",
                            "interrupted": True,
                            "model": model_name or self.config.get("current_model"),
                            "conversation_id": conversation_id
                        }
                    
                    time.sleep(0.1)  # 每100ms检查一次
                
                exec_thread.join()
                
                if error_occurred:
                    raise Exception(f"执行出错: {result}")
                
            finally:
                # 停止进程监控
                if conversation_id:
                    self._stop_process_monitoring(conversation_id)
            
            # 保存到会话历史
            if conversation_id:
                self._save_to_history(conversation_id, query, result)
            
            # 处理结果
            return {
                "success": True,
                "result": result,
                "model": model_name or self.config.get("current_model"),
                "conversation_id": conversation_id
            }
            
        except KeyboardInterrupt:
            logger.info(f"查询被中断: {conversation_id}")
            return {
                "success": False,
                "error": "查询被中断",
                "interrupted": True,
                "model": model_name or self.config.get("current_model"),
                "conversation_id": conversation_id
            }
        except Exception as e:
            logger.error(f"执行查询失败: {e}")
            return {
                "success": False,
                "error": str(e),
                "model": model_name or self.config.get("current_model"),
                "conversation_id": conversation_id
            }
        finally:
            # 清理session cache
            if conversation_id and conversation_id in self._session_cache:
                with self._session_lock:
                    if conversation_id in self._session_cache:
                        del self._session_cache[conversation_id]
    
    def _build_prompt(self, query: str, context: Dict[str, Any] = None, language: str = 'zh') -> str:
        """构建简洁的提示词，让 OpenInterpreter 自主工作，支持多语言"""
        
        import os
        import json
        
        # 如果有数据库连接信息，提供最基础的信息
        if context and context.get('connection_info'):
            conn = context['connection_info']
            
            # 获取项目根目录的绝对路径
            project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            output_dir = os.path.join(project_root, 'backend', 'output')
            
            # 加载prompt配置
            prompt_config = {}
            config_path = os.path.join(os.path.dirname(__file__), 'prompt_config.json')
            try:
                if os.path.exists(config_path):
                    with open(config_path, 'r', encoding='utf-8') as f:
                        prompt_config = json.load(f)
            except Exception as e:
                logger.warning(f"加载prompt配置失败，使用默认配置: {e}")
            
            # 根据语言构建提示词
            lang_key = 'en' if language == 'en' else 'zh'
            
            if language == 'en':
                # 英文版prompt - 从配置文件构建
                prompt_parts = [
                    "【IMPORTANT】: All data is in MySQL database, DO NOT look for CSV or any files!",
                    "Use pymysql to connect to database and execute SQL queries directly.",
                    f"\nDatabase Connection (Apache Doris, MySQL Protocol):",
                    f"host = '{conn['host']}'",
                    f"port = {conn['port']}",
                    f"user = '{conn['user']}'",
                    f"password = '{conn['password']}'",
                    f"database = '{conn.get('database', '')}'  # If empty, explore available databases first",
                    "\n【Database Exploration Steps】:",
                    "1. If no database specified, run SHOW DATABASES to see all available databases",
                    "2. Select appropriate database based on business needs (e.g., containing sales/order/trade keywords)",
                    "3. USE the selected database, then SHOW TABLES to view table structure",
                    "4. Run DESCRIBE to understand field structure, SELECT * LIMIT 10 to view sample data",
                    "5. Based on data characteristics and user needs, write and execute appropriate SQL queries",
                    f"\nUser Request: {query}\n",
                    "Important Requirements:"
                ]
                
                # 添加配置中的各个部分
                if prompt_config:
                    sections = [
                        ('databaseConnection', '1. Database Connection'),
                        ('exploration', '2. Exploration Strategy'),
                        ('businessTerms', '3. Business Terms'),
                        ('tableSelection', '4. Table Selection'),
                        ('fieldMapping', '5. Field Mapping'),
                        ('dataProcessing', '6. Data Processing'),
                        ('visualization', '7. Visualization'),
                        ('outputRequirements', '8. Output Requirements'),
                        ('errorHandling', '9. Error Handling')
                    ]
                    
                    for key, title in sections:
                        if key in prompt_config and lang_key in prompt_config[key]:
                            prompt_parts.append(f"\n{title}:")
                            prompt_parts.append(prompt_config[key][lang_key])
                
                # 添加输出目录信息
                prompt_parts.append(f"\nOutput Directory: {output_dir}")
                prompt_parts.append(f"Create output directory: os.makedirs('{output_dir}', exist_ok=True)")
                
                prompt = "\n".join(prompt_parts)
            
            else:
                # 中文版prompt - 从配置文件构建
                prompt_parts = [
                    "【重要】：所有数据都在MySQL数据库中，不要查找CSV或任何文件！",
                    "直接使用pymysql连接数据库并执行SQL查询。",
                    f"\n数据库连接信息（Apache Doris，MySQL协议）：",
                    f"host = '{conn['host']}'",
                    f"port = {conn['port']}",
                    f"user = '{conn['user']}'",
                    f"password = '{conn['password']}'",
                    f"database = '{conn.get('database', '')}'  # 如果为空，需要先探索可用数据库",
                    "\n【数据库探索步骤】：",
                    "1. 如果没有指定数据库，先执行 SHOW DATABASES 查看所有可用数据库",
                    "2. 根据业务需求选择合适的数据库（如包含sales/order/trade等关键词的库）",
                    "3. USE 选中的数据库，然后 SHOW TABLES 查看表结构",
                    "4. 对相关表执行 DESCRIBE 了解字段结构，执行 SELECT * LIMIT 10 查看样本数据",
                    "5. 根据数据特征和用户需求，编写并执行相应的SQL查询",
                    f"\n用户需求：{query}\n",
                    "重要要求："
                ]
                
                # 添加配置中的各个部分
                if prompt_config:
                    sections = [
                        ('databaseConnection', '1. 数据库连接'),
                        ('exploration', '2. 探索策略'),
                        ('businessTerms', '3. 业务术语'),
                        ('tableSelection', '4. 表选择'),
                        ('fieldMapping', '5. 字段映射'),
                        ('dataProcessing', '6. 数据处理'),
                        ('visualization', '7. 可视化'),
                        ('outputRequirements', '8. 输出要求'),
                        ('errorHandling', '9. 错误处理')
                    ]
                    
                    for key, title in sections:
                        if key in prompt_config and lang_key in prompt_config[key]:
                            prompt_parts.append(f"\n{title}：")
                            prompt_parts.append(prompt_config[key][lang_key])
                
                # 添加输出目录信息
                prompt_parts.append(f"\n输出目录：{output_dir}")
                prompt_parts.append(f"确保创建输出目录：os.makedirs('{output_dir}', exist_ok=True)")
                
                prompt = "\n".join(prompt_parts)
            
            # 如果有可用数据库列表，添加参考信息
            if context.get('available_databases'):
                if language == 'en':
                    prompt += f"\nAvailable databases: {', '.join(context['available_databases'])}"
                else:
                    prompt += f"\n可用数据库参考：{', '.join(context['available_databases'])}"
            
            return prompt
        
        # 非数据库查询，直接返回原始查询
        return query
    
    def get_or_create_interpreter(self, conversation_id: Optional[str] = None, 
                                  model_name: Optional[str] = None) -> OpenInterpreter:
        """
        获取或创建interpreter实例
        如果提供conversation_id，尝试重用现有会话
        """
        if not self.enabled:
            # 测试环境下允许继续，以便通过桩替换 create_interpreter
            import os
            if os.environ.get('TESTING', '').lower() != 'true':
                raise RuntimeError("OpenInterpreter未安装。请运行: pip install open-interpreter==0.4.3")
        
        with self._session_lock:
            # 清理过期会话
            self._cleanup_expired_sessions()
            
            # 如果没有conversation_id，总是创建新实例
            if not conversation_id:
                return self.create_interpreter(model_name)
            
            # 检查是否有缓存的会话
            if conversation_id in self._session_cache:
                # 检查会话是否过期
                last_active = self._session_last_active.get(conversation_id, 0)
                if time.time() - last_active < self.session_timeout:
                    logger.info(f"重用现有会话: {conversation_id}")
                    return self._session_cache[conversation_id]
                else:
                    # 会话过期，移除并创建新的
                    logger.info(f"会话过期，创建新会话: {conversation_id}")
                    del self._session_cache[conversation_id]
                    del self._session_last_active[conversation_id]
            
            # 创建新会话并缓存
            logger.info(f"创建新会话: {conversation_id}")
            interpreter = self.create_interpreter(model_name)
            
            # 安全修复：检查缓存大小限制
            if len(self._session_cache) >= self.max_session_cache_size:
                # 使用LRU策略：删除最久未使用的会话
                oldest_session = min(self._session_last_active.items(), key=lambda x: x[1])[0]
                logger.info(f"缓存已满，删除最旧会话: {oldest_session}")
                if oldest_session in self._session_cache:
                    del self._session_cache[oldest_session]
                del self._session_last_active[oldest_session]
            
            self._session_cache[conversation_id] = interpreter
            self._session_last_active[conversation_id] = time.time()
            return interpreter
    
    def _cleanup_expired_sessions(self):
        """
        清理过期的会话
        必须在锁内调用
        """
        current_time = time.time()
        expired_sessions = []
        
        for session_id, last_active in self._session_last_active.items():
            if current_time - last_active > self.session_timeout:
                expired_sessions.append(session_id)
        
        for session_id in expired_sessions:
            logger.info(f"清理过期会话: {session_id}")
            if session_id in self._session_cache:
                del self._session_cache[session_id]
            del self._session_last_active[session_id]
    
    def _build_prompt_with_history(self, query: str, context: Dict[str, Any] = None,
                                  conversation_history: Optional[list] = None) -> str:
        """
        构建包含历史上下文的提示词
        """
        # 基础提示词
        base_prompt = self._build_prompt(query, context)
        
        # 如果没有历史记录，直接返回基础提示词
        if not conversation_history:
            return base_prompt
        
        # 构建历史上下文摘要
        history_context = self._summarize_history(conversation_history)
        
        if history_context:
            # 在提示词前添加历史上下文
            enhanced_prompt = f"""## 对话历史上下文
{history_context}

## 当前任务
{base_prompt}"""
            return enhanced_prompt
        
        return base_prompt
    
    def _summarize_history(self, conversation_history: list) -> str:
        """
        总结对话历史，提取关键信息
        只保留最近的3-5轮对话和重要的数据库结构信息
        """
        if not conversation_history:
            return ""
        
        summary_parts = []
        
        # 提取最近的对话（最多 N 轮，按 max_history_rounds 控制，默认3）
        rounds = max(1, int(getattr(self, 'max_history_rounds', 3) or 3))
        recent_messages = conversation_history[-2*rounds:]  # N轮 = 2N条消息（用户+助手）
        
        # 查找已探索的数据库和表
        explored_dbs = set()
        explored_tables = set()
        
        for msg in conversation_history:
            content = str(msg.get('content', ''))
            
            # 查找SHOW DATABASES的结果
            if 'SHOW DATABASES' in content:
                lines = content.split('\n')
                for line in lines:
                    line = line.strip()
                    # 跳过标题行和空行
                    if line and not line.startswith('Database') and not line.startswith('---'):
                        explored_dbs.add(line)
            
            # 查找SHOW TABLES的结果
            if 'Tables_in_' in content or 'SHOW TABLES' in content:
                lines = content.split('\n')
                for line in lines:
                    if 'Tables_in_' in line:
                        # 提取数据库名
                        db_name = line.split('Tables_in_')[1].split()[0] if 'Tables_in_' in line else None
                        if db_name:
                            explored_dbs.add(db_name)
                    else:
                        line = line.strip()
                        # 提取表名，跳过标题和分隔线
                        if line and not line.startswith('Tables') and not line.startswith('---') and '|' not in line:
                            explored_tables.add(line)
        
        # 构建摘要
        if explored_dbs:
            # 限制显示的数据库数量
            db_list = list(explored_dbs)[:5]
            summary_parts.append(f"已探索的数据库: {', '.join(db_list)}")
            if len(explored_dbs) > 5:
                summary_parts.append(f"  (共 {len(explored_dbs)} 个数据库)")
        
        if explored_tables:
            # 限制显示的表数量
            table_list = list(explored_tables)[:10]
            summary_parts.append(f"已探索的表: {', '.join(table_list)}")
            if len(explored_tables) > 10:
                summary_parts.append(f"  (共 {len(explored_tables)} 个表)")
        
        # 添加最近查询的摘要
        if len(recent_messages) > 0:
            summary_parts.append("\n最近的查询历史:")
            for i in range(0, len(recent_messages), 2):
                if i < len(recent_messages) - 1:
                    user_msg = recent_messages[i].get('content', '')[:100]
                    summary_parts.append(f"- 用户: {user_msg}...")
        
        return '\n'.join(summary_parts) if summary_parts else ""
    
    def clear_session(self, conversation_id: str):
        """
        清除特定会话
        """
        with self._session_lock:
            if conversation_id in self._session_cache:
                del self._session_cache[conversation_id]
                logger.info(f"清除会话: {conversation_id}")
            if conversation_id in self._session_last_active:
                del self._session_last_active[conversation_id]
    
    def get_available_models(self) -> list:
        """获取可用的模型列表"""
        return list(self.config.get("models", {}).keys())
    
    def _get_conversation_history(self, conversation_id: str) -> list:
        """获取会话历史 - 优先从内存，其次从数据库"""
        # 先检查内存缓存
        if conversation_id in self._conversation_history:
            logger.info(f"从内存获取会话历史: {conversation_id}, 消息数: {len(self._conversation_history[conversation_id])}")
            return self._conversation_history[conversation_id]
        
        # 如果内存中没有，尝试从数据库加载
        try:
            from backend.history_manager import HistoryManager
            history_manager = HistoryManager()
            
            # 从数据库获取历史
            history_data = history_manager.get_conversation_history(conversation_id)
            if history_data and 'messages' in history_data:
                # 转换格式并缓存到内存
                messages = []
                for msg in history_data['messages']:
                    messages.append({
                        "role": "user" if msg['type'] == "user" else "assistant",
                        "content": msg['content'],
                        "timestamp": msg.get('timestamp', '')
                    })
                
                # 保存到内存缓存
                self._conversation_history[conversation_id] = messages
                logger.info(f"从数据库加载会话历史: {conversation_id}, 消息数: {len(messages)}")
                return messages
        except Exception as e:
            logger.warning(f"从数据库加载会话历史失败: {e}")
        
        # 如果都没有，返回空列表并初始化
        logger.info(f"创建新会话历史: {conversation_id}")
        self._conversation_history[conversation_id] = []
        return []
    
    def _save_to_history(self, conversation_id: str, query: str, result: Any):
        """保存到会话历史 - 同时保存到内存和数据库"""
        logger.info(f"[保存历史] 开始保存会话历史: {conversation_id}")
        
        if conversation_id not in self._conversation_history:
            self._conversation_history[conversation_id] = []
            logger.info(f"[保存历史] 创建新的内存历史记录: {conversation_id}")
        
        history = self._conversation_history[conversation_id]
        
        # 保存用户查询和AI响应
        history.append({
            "role": "user",
            "content": query,
            "timestamp": time.time()
        })
        
        # 提取关键信息从结果中
        result_summary = self._extract_key_info(result)
        history.append({
            "role": "assistant", 
            "content": result_summary,
            "timestamp": time.time()
        })
        
        # 限制历史长度（保留最近的N轮对话）
        max_messages = self.max_history_rounds * 2  # 每轮包含用户和助手消息
        if len(history) > max_messages:
            # 保留最新的消息
            self._conversation_history[conversation_id] = history[-max_messages:]
            
        logger.info(f"保存会话历史: {conversation_id}, 当前历史长度: {len(self._conversation_history[conversation_id])}")
    
    def _extract_key_info(self, result: Any) -> str:
        """从结果中提取关键信息用于上下文"""
        if not result:
            return ""
        
        # 如果result是列表，提取文本内容
        if isinstance(result, list):
            key_info = []
            for item in result:
                if isinstance(item, dict):
                    content = item.get('content', '')
                    # 提取SQL语句
                    if 'SELECT' in content or 'SHOW' in content:
                        key_info.append(f"执行的SQL: {content[:200]}")
                    # 提取表信息
                    elif 'Tables_in_' in content or 'DESCRIBE' in content:
                        key_info.append(f"探索的表结构: {content[:200]}")
                    # 提取生成的文件
                    elif '.html' in content:
                        import re
                        files = re.findall(r'([^\s]+\.html)', content)
                        if files:
                            key_info.append(f"生成的文件: {', '.join(files)}")
            return '\n'.join(key_info) if key_info else str(result)[:500]
        
        return str(result)[:500]
    
    def _build_prompt_with_context(self, query: str, context: Dict[str, Any] = None, 
                                   conversation_history: list = None, language: str = 'zh') -> str:
        """构建包含历史上下文的提示词"""
        
        # 基础提示词
        base_prompt = self._build_prompt(query, context, language)
        
        # 如果没有历史，直接返回基础提示词
        if not conversation_history:
            return base_prompt
        
        # 构建历史上下文
        history_text = self._format_history(conversation_history)
        
        if history_text:
            # 在提示词前添加历史上下文
            enhanced_prompt = f"""## 之前的对话上下文
{history_text}

## 当前用户需求
{query}

请基于之前的对话上下文，继续处理当前的需求。如果之前有错误，请尝试修正。

{base_prompt}"""
            return enhanced_prompt
        
        return base_prompt
    
    def _format_history(self, conversation_history: list) -> str:
        """格式化会话历史为文本 - 保留更多上下文信息"""
        if not conversation_history:
            return ""
        
        formatted_parts = []
        # 计算要显示的历史轮数
        max_messages = min(len(conversation_history), self.max_history_rounds * 2)
        recent_history = conversation_history[-max_messages:] if max_messages > 0 else []
        
        logger.info(f"格式化历史: 总消息数={len(conversation_history)}, 显示最近={max_messages}")
        
        for i, msg in enumerate(recent_history):
            role = msg.get('role', '')
            content = msg.get('content', '')
            
            # 保留更多内容以维持上下文
            max_length = 500  # 增加显示长度
            if len(content) > max_length:
                content = content[:max_length] + "..."
            
            if role == 'user':
                formatted_parts.append(f"【用户查询 {i//2 + 1}】: {content}")
            elif role == 'assistant':
                # 对于助手回复，提取关键信息
                if '```sql' in content.lower():
                    # 提取SQL查询
                    import re
                    sql_match = re.search(r'```sql\n(.*?)\n```', content, re.DOTALL | re.IGNORECASE)
                    if sql_match:
                        formatted_parts.append(f"【系统执行】: SQL查询 - {sql_match.group(1)[:200]}")
                    else:
                        formatted_parts.append(f"【系统回复】: {content}")
                else:
                    formatted_parts.append(f"【系统回复】: {content}")
        
        if formatted_parts:
            return "=== 对话历史 ===\n" + '\n\n'.join(formatted_parts) + "\n=== 历史结束 ==="
        return ""
    
    def clear_conversation(self, conversation_id: str):
        """清除特定会话的历史"""
        if conversation_id in self._conversation_history:
            del self._conversation_history[conversation_id]
            logger.info(f"清除会话历史: {conversation_id}")
    
    def _continuous_process_monitor(self, conversation_id: str, parent_pid: int):
        """持续监控进程，捕获动态创建的子进程"""
        logger.info(f"启动进程监控线程: {conversation_id}")
        
        while not self._stop_events.get(conversation_id, Event()).is_set():
            try:
                # 获取当前进程及其所有子进程
                parent = psutil.Process(parent_pid)
                children = parent.children(recursive=True)
                
                with self._process_lock:
                    if conversation_id not in self._active_processes:
                        self._active_processes[conversation_id] = set()
                    
                    # 添加新发现的进程
                    for child in children:
                        if child.pid not in self._active_processes[conversation_id]:
                            self._active_processes[conversation_id].add(child.pid)
                            logger.debug(f"发现新进程: {child.pid} ({child.name()}) - 会话: {conversation_id}")
                
            except psutil.NoSuchProcess:
                # 父进程已结束
                logger.debug(f"父进程已结束: {parent_pid}")
                break
            except Exception as e:
                logger.error(f"监控进程时出错: {e}")
            
            # 每0.5秒扫描一次
            time.sleep(0.5)
        
        logger.info(f"进程监控线程结束: {conversation_id}")
    
    def _start_process_monitoring(self, conversation_id: str):
        """启动进程监控线程"""
        with self._monitor_lock:
            # 创建停止事件
            self._stop_events[conversation_id] = Event()
            
            # 启动监控线程
            monitor_thread = Thread(
                target=self._continuous_process_monitor,
                args=(conversation_id, os.getpid()),
                daemon=True
            )
            monitor_thread.start()
            self._monitor_threads[conversation_id] = monitor_thread
            
            logger.info(f"已启动进程监控: {conversation_id}")
    
    def _stop_process_monitoring(self, conversation_id: str):
        """停止进程监控线程"""
        with self._monitor_lock:
            if conversation_id in self._stop_events:
                # 设置停止标志
                self._stop_events[conversation_id].set()
                
                # 等待线程结束
                if conversation_id in self._monitor_threads:
                    thread = self._monitor_threads[conversation_id]
                    thread.join(timeout=2)
                    del self._monitor_threads[conversation_id]
                
                # 清理事件
                del self._stop_events[conversation_id]
                
                logger.info(f"已停止进程监控: {conversation_id}")
    
    def _track_processes(self, conversation_id: str):
        """跟踪当前Python进程的所有子进程（保留用于初始跟踪）"""
        try:
            current_process = psutil.Process()
            children = current_process.children(recursive=True)
            
            with self._process_lock:
                if conversation_id not in self._active_processes:
                    self._active_processes[conversation_id] = set()
                
                # 添加所有子进程PID
                for child in children:
                    self._active_processes[conversation_id].add(child.pid)
                    logger.debug(f"初始跟踪进程: {child.pid} (会话: {conversation_id})")
        except Exception as e:
            logger.error(f"跟踪进程失败: {e}")
    
    def _terminate_processes(self, conversation_id: str, timeout: int = 3):
        """终止与会话相关的所有进程（增强版）"""
        with self._process_lock:
            if conversation_id not in self._active_processes:
                logger.debug(f"没有找到会话 {conversation_id} 的进程记录")
                return
            
            pids = self._active_processes.get(conversation_id, set()).copy()  # 复制以避免修改时出错
            if not pids:
                logger.debug(f"会话 {conversation_id} 没有活跃进程")
                return
            
            logger.info(f"准备终止 {len(pids)} 个进程: {pids}")
            
            # 按进程树层级排序（子进程先终止）
            processes_to_kill = []
            for pid in pids:
                try:
                    process = psutil.Process(pid)
                    processes_to_kill.append((pid, process))
                except psutil.NoSuchProcess:
                    logger.debug(f"进程 {pid} 已经不存在")
            
            # 先尝试优雅终止所有进程
            for pid, process in processes_to_kill:
                try:
                    # 获取进程的子进程
                    children = process.children(recursive=True)
                    
                    # 先终止子进程
                    for child in children:
                        try:
                            logger.debug(f"终止子进程 {child.pid}")
                            child.terminate()
                        except:
                            pass
                    
                    # 再终止父进程
                    process.terminate()
                    logger.debug(f"发送SIGTERM到进程 {pid}")
                    
                except psutil.NoSuchProcess:
                    logger.debug(f"进程 {pid} 已经不存在")
                except Exception as e:
                    logger.error(f"终止进程 {pid} 时出错: {e}")
            
            # 等待进程终止
            time.sleep(0.5)
            
            # 强制杀死仍存活的进程
            for pid, process in processes_to_kill:
                try:
                    if process.is_running():
                        # 强制终止
                        process.kill()
                        logger.warning(f"强制终止进程 {pid}")
                        
                        # 如果是Unix系统，尝试使用进程组终止
                        if hasattr(os, 'killpg'):
                            try:
                                os.killpg(os.getpgid(pid), signal.SIGKILL)
                                logger.warning(f"强制终止进程组 {pid}")
                            except:
                                pass
                except psutil.NoSuchProcess:
                    pass
                except Exception as e:
                    logger.error(f"强制终止进程 {pid} 失败: {e}")
            
            # 清理进程记录
            del self._active_processes[conversation_id]
            logger.info(f"已清理会话 {conversation_id} 的所有进程")
    
    def stop_query(self, conversation_id: str):
        """尝试停止正在执行的查询，包括终止所有子进程（增强版）"""
        logger.info(f"开始停止查询: {conversation_id}")
        
        # 1. 首先停止进程监控（防止新进程被添加）
        self._stop_process_monitoring(conversation_id)
        
        # 2. 终止所有相关进程
        self._terminate_processes(conversation_id)
        
        # 3. 清理interpreter实例
        with self._session_lock:
            if conversation_id in self._session_cache:
                try:
                    interpreter = self._session_cache[conversation_id]
                    
                    # 尝试调用interpreter的停止方法（如果存在）
                    if hasattr(interpreter, 'terminate') and callable(interpreter.terminate):
                        try:
                            interpreter.terminate()
                            logger.info(f"调用了interpreter.terminate(): {conversation_id}")
                        except:
                            pass
                    
                    if hasattr(interpreter, 'stop') and callable(interpreter.stop):
                        try:
                            interpreter.stop()
                            logger.info(f"调用了interpreter.stop(): {conversation_id}")
                        except:
                            pass
                    
                    # 清空消息历史
                    if hasattr(interpreter, 'messages'):
                        interpreter.messages = []
                    
                    # 如果有computer属性（代码执行器），也尝试停止它
                    if hasattr(interpreter, 'computer'):
                        if hasattr(interpreter.computer, 'terminate') and callable(interpreter.computer.terminate):
                            try:
                                interpreter.computer.terminate()
                                logger.info(f"终止了interpreter.computer: {conversation_id}")
                            except:
                                pass
                    
                    # 删除缓存的实例
                    del self._session_cache[conversation_id]
                    logger.info(f"已清理interpreter实例: {conversation_id}")
                    
                except Exception as e:
                    logger.error(f"清理interpreter实例失败: {e}")
            
            # 清理会话活跃时间记录
            if conversation_id in self._session_last_active:
                del self._session_last_active[conversation_id]
        
        # 4. 清理会话历史（可选）
        if conversation_id in self._conversation_history:
            # 保留历史但标记为已中断
            history = self._conversation_history.get(conversation_id, [])
            if history:
                history.append({
                    "role": "system",
                    "content": "[会话被用户中断]",
                    "timestamp": time.time()
                })
        
        logger.info(f"查询停止完成: {conversation_id}")
