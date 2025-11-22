"""
OpenInterpreter Manager Module
使用OpenInterpreter 0.4.3版本管理AI会话
"""
import os
import json
import signal
import warnings
from typing import Dict, Any, Optional, Set, List, Tuple
import logging
import re
import shutil

warnings.filterwarnings(
    "ignore",
    message="pkg_resources is deprecated as an API",
    category=UserWarning,
    module="interpreter.core.utils.system_debug_info"
)

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
from backend.core.config import ConfigLoader
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
        self._session_cache: Dict[str, OpenInterpreter] = {}
        # 会话最后活跃时间
        self._session_last_active: Dict[str, float] = {}
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
        
        from backend.core.config import ConfigLoader
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
            context = dict(context or {})
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
            route_type = context.get('route_type', 'ANALYSIS')

            system_messages = (prompt_config or {}).get('systemMessage', {})

            def _apply_prompt(category: str, default_zh: str, default_en: str, log_suffix: str):
                config_section = system_messages.get(category, {})
                if config_section and lang_key in config_section and config_section[lang_key].strip():
                    interpreter.system_message = config_section[lang_key]
                else:
                    interpreter.system_message = default_zh if lang_key == 'zh' else default_en
                logger.info(f"使用{category}路由的{log_suffix}")

            if route_type == 'QA':
                default_zh = """
                你是一个数据库助手。当用户提问与数据库或分析无关时，请礼貌拒绝：
                - 明确说明你专注于数据库取数与分析
                - 引导用户提供具体的表名、指标或时间范围
                - 不编造答案，只提供诚恳建议
                """
                default_en = """
                You are a database assistant. When the query is unrelated to databases or analytics:
                - Politely explain you focus on database retrieval and analysis only
                - Guide the user to provide table names, metrics, or time ranges
                - Do not fabricate answers; offer constructive suggestions
                """
                _apply_prompt('QA', default_zh, default_en, '礼貌拒绝prompt')
            else:
                default_zh = """你是一个完整的数据分析 Agent，直接在沙箱中运行 Python 代码以完成用户的数据分析需求。

**完成标准（缺一不可）：**
✓ 生成至少一个 Plotly 图表，保存为 HTML
✓ 输出【用户视图】：2-3 句业务结论
✓ 输出【开发者视图】：SQL、耗时、行数、文件路径

**执行原则：**
整个分析是一个完整任务，在一次回复中完成所有步骤，不要分段输出或等待下一轮对话。

**工作流程：**
1. 连接数据库（使用提供的连接参数）
2. 自主探索（根据连接信息判断数据库驱动）
   - MySQL/Doris：使用 `SHOW DATABASES;`、`SHOW TABLES;`、`DESCRIBE <表名>;`
   - SQLite：使用 `PRAGMA database_list;`、`SELECT name FROM sqlite_master WHERE type='table';`、`PRAGMA table_info('<表名>');`
3. 编写并执行只读 SQL 获取数据
4. 用 pandas 处理，用 plotly 生成图表（中文标题/图例），保存到 output/
5. 输出双视图总结

**数据库适配提示：**
- 如果上下文提供 `database_driver` 或“方言提示”，必须遵循对应语法。
- 如遇方言差异，先用轻量命令验证连接，再继续后续步骤。

**步骤播报：**
执行前可以输出 `[步骤 N] 简要说明` 让用户了解进度，但务必在同一次回复中完成所有步骤。

**自检清单（回复前必查）：**
- [ ] 是否已生成并保存 Plotly HTML？
- [ ] 是否已准备好【用户视图】总结？
- [ ] 是否已准备好【开发者视图】（含 SQL/路径）？
- 如有任一未完成，继续执行而不要结束回复。

如果遇到阻塞问题（连接失败、无数据），明确报告并给出建议，但不要返回半成品。"""
                default_en = """You are a complete data analysis agent that runs Python code directly in a sandbox to fulfil the user's analytical request.

**Completion criteria (all required):**
✓ Generate at least one Plotly chart, saved as HTML
✓ Provide "User View": 2-3 sentence business conclusion
✓ Provide "Developer View": SQL, runtime, row count, file path

**Execution principle:**
The entire analysis is one complete task—finish all steps in a single response, not segmented or awaiting the next turn.

**Workflow:**
1. Connect to database (using provided credentials)
2. Self-explore (choose commands based on the database driver)
   - MySQL/Doris: use `SHOW DATABASES;`, `SHOW TABLES;`, `DESCRIBE <table>;`
   - SQLite: use `PRAGMA database_list;`, `SELECT name FROM sqlite_master WHERE type='table';`, `PRAGMA table_info('<table>');`
3. Write and execute read-only SQL to fetch data
4. Process with pandas, generate Plotly charts (Chinese titles/legends), save to output/
5. Output dual-view summary

**Database adaptation:**
- When `database_driver` or dialect hints are provided, follow them strictly.
- If dialect differences are unclear, run lightweight discovery commands first before heavier queries.

**Step logging:**
You may output `[Step N] brief description` before execution to inform users of progress, but must complete all steps in the same response.

**Self-check before responding:**
- [ ] Have you generated and saved a Plotly HTML?
- [ ] Have you prepared the "User View" summary?
- [ ] Have you prepared the "Developer View" (with SQL/paths)?
- If any is missing, keep working instead of ending the response.

If blocked (connection failure, no data), report clearly and suggest next steps, but don't return a half-finished result."""
                _apply_prompt('ANALYSIS', default_zh, default_en, '数据分析prompt')
            
            # 获取会话历史（如果有）
            conversation_history = None
            if conversation_id:
                conversation_history = self._get_conversation_history(conversation_id)
                logger.info(f"[会话上下文] 会话ID: {conversation_id}, 历史消息数: {len(conversation_history) if conversation_history else 0}")
                if conversation_history:
                    logger.debug(f"[会话上下文] 最近消息: {conversation_history[-2:] if len(conversation_history) >= 2 else conversation_history}")

                    # 按上下文轮数限制加载到 interpreter 的消息数量
                    max_rounds_raw = getattr(self, 'max_history_rounds', 3)
                    try:
                        max_rounds = int(max_rounds_raw if max_rounds_raw is not None else 3)
                    except (TypeError, ValueError):
                        max_rounds = 3
                    if max_rounds < 0:
                        max_rounds = 0

                    if max_rounds == 0:
                        truncated_history = []
                    else:
                        max_messages = max_rounds * 2
                        truncated_history = conversation_history[-max_messages:]

                    if not hasattr(interpreter, 'messages') or interpreter.messages is None:
                        interpreter.messages = []
                    else:
                        interpreter.messages = []

                    for msg in truncated_history:
                        role = msg.get('role') or 'assistant'
                        content = msg.get('content')
                        if not content:
                            continue
                        interpreter.messages.append({
                            "role": role,
                            "content": content,
                            "type": "message"
                        })

                    logger.info(
                        "已将 %s 条历史消息注入 interpreter (max_rounds=%s)",
                        len(interpreter.messages),
                        max_rounds,
                    )
            else:
                logger.warning("[会话上下文] 未提供会话ID，无法维持对话上下文")
            
            # 构建简洁的提示词（只包含连接参数和用户问题）
            full_prompt = self._build_prompt_with_context(query, context, conversation_history, language)
            logger.debug(f"[提示词] 构建的完整提示词长度: {len(full_prompt)} 字符")
            logger.debug(f"[System Message] 长度: {len(interpreter.system_message)} 字符")
            
            # 存储当前的interpreter以便停止
            if conversation_id:
                with self._session_lock:
                    # 安全修复：检查缓存大小限制
                    self._cleanup_expired_sessions_locked()
                    self._evict_if_needed_locked()
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
            steps = []
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
                try:
                    steps = self._extract_steps_from_result_payload(result)
                except Exception as step_err:  # pylint: disable=broad-except
                    logger.debug("提取思考步骤失败: %s", step_err)
                    steps = []
                
            finally:
                # 停止进程监控
                if conversation_id:
                    self._stop_process_monitoring(conversation_id)
            
            # 收集生成的文件，并确保在结果中体现
            artifacts = self._collect_generated_artifacts(result)
            if artifacts and isinstance(result, list):
                existing_messages = {item.get('content') for item in result if isinstance(item, dict)}
                for artifact in artifacts:
                    message = (
                        f"生成图表文件: {artifact['filename']}\n"
                        f"访问链接: {artifact['url']}"
                    )
                    if message not in existing_messages:
                        result.append({
                            "type": "console",
                            "content": message
                        })
                        existing_messages.add(message)

            # 保存到会话历史
            if conversation_id:
                self._save_to_history(conversation_id, query, result)
            
            # 处理结果
            response_payload = {
                "success": True,
                "result": result,
                "model": model_name or self.config.get("current_model"),
                "conversation_id": conversation_id,
                "steps": steps
            }
            if artifacts:
                response_payload["visualization"] = artifacts
                response_payload.setdefault("artifacts", artifacts)
            return response_payload
            
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
                "conversation_id": conversation_id,
                "steps": []
            }
        finally:
            # 清理session cache
            if conversation_id:
                with self._session_lock:
                    self._session_cache.pop(conversation_id, None)
                    self._session_last_active.pop(conversation_id, None)

    def _cleanup_expired_sessions_locked(self) -> None:
        """在持有会话锁的情况下清理过期会话。"""
        current_time = time.time()
        expired_sessions = [
            session_id
            for session_id, last_active in self._session_last_active.items()
            if current_time - last_active > self.session_timeout
        ]
        for session_id in expired_sessions:
            logger.info(f"清理过期会话: {session_id}")
            self._session_cache.pop(session_id, None)
            self._session_last_active.pop(session_id, None)

    def _evict_if_needed_locked(self) -> None:
        """在持有会话锁的情况下执行LRU淘汰。"""
        if self.max_session_cache_size <= 0:
            return
        while len(self._session_cache) >= self.max_session_cache_size:
            if not self._session_last_active:
                logger.warning("检测到会话缓存不一致，强制清理全部会话缓存")
                self._session_cache.clear()
                self._session_last_active.clear()
                break
            oldest_session = min(self._session_last_active.items(), key=lambda item: item[1])[0]
            logger.info(f"缓存已满，删除最旧会话: {oldest_session}")
            self._session_cache.pop(oldest_session, None)
            self._session_last_active.pop(oldest_session, None)
    
    def _build_prompt(self, query: str, context: Dict[str, Any] = None, language: str = 'zh') -> str:
        """构建简洁的提示词，只包含用户问题和必要的上下文信息"""
        
        import os
        
        if context and context.get('connection_info'):
            conn = context.get('connection_info') or {}

            # 获取项目根目录的绝对路径
            project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            output_dir = os.path.join(project_root, 'backend', 'output')

            driver = (context.get('database_driver')
                      or conn.get('driver')
                      or conn.get('provider'))
            driver_display = (str(driver).lower() if driver else 'unknown')

            if language == 'en':
                lines = [f"Database driver: {driver_display}"]
            else:
                lines = [f"数据库驱动：{driver_display}"]

            if driver_display == 'sqlite':
                sqlite_path = (conn.get('database')
                               or conn.get('path')
                               or conn.get('database_url')
                               or '')
                if language == 'en':
                    lines.append(f"SQLite DSN: {sqlite_path}")
                else:
                    lines.append(f"SQLite 数据源：{sqlite_path}")
            else:
                host = conn.get('host') or ''
                port = conn.get('port')
                user = conn.get('user') or ''
                password = conn.get('password') or ''
                database_name = conn.get('database') or ''
                port_repr = port if port not in (None, '') else ''
                lines.append(
                    "host='{host}', port={port}, user='{user}', password='{password}', database='{database}'".format(
                        host=host,
                        port=port_repr,
                        user=user,
                        password=password,
                        database=database_name
                    )
                )

            connection_text = '\n'.join(lines)

            if language == 'en':
                prompt = (
                    f"{connection_text}\n\n"
                    f"Output directory: {output_dir}\n\n"
                    f"User request: {query}"
                )
            else:
                prompt = (
                    f"{connection_text}\n\n"
                    f"输出目录：{output_dir}\n\n"
                    f"用户需求：{query}"
                )

            # 如果有可用数据库列表，添加参考信息
            if context.get('available_databases'):
                databases = ', '.join(context['available_databases'])
                if language == 'en':
                    prompt += f"\n\nAvailable databases: {databases}"
                else:
                    prompt += f"\n\n可用数据库：{databases}"

            guidance = context.get('dialect_guidance')
            guidance_text = None
            if isinstance(guidance, dict):
                key = 'en' if language == 'en' else 'zh'
                guidance_text = guidance.get(key) or next(iter(guidance.values()), None)
            elif isinstance(guidance, str):
                guidance_text = guidance

            if guidance_text:
                if language == 'en':
                    prompt += f"\n\nDialect hints: {guidance_text}"
                else:
                    prompt += f"\n\n方言提示：{guidance_text}"

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
            self._cleanup_expired_sessions_locked()
            
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
            self._evict_if_needed_locked()
            
            self._session_cache[conversation_id] = interpreter
            self._session_last_active[conversation_id] = time.time()
            return interpreter
    
    def _cleanup_expired_sessions(self):
        """
        清理过期的会话
        必须在锁内调用
        """
        self._cleanup_expired_sessions_locked()
    
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
            from backend.services.history import HistoryManager
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

    def _collect_generated_artifacts(self, payload: Any) -> List[Dict[str, Any]]:
        """从OpenInterpreter返回的payload中提取生成的文件信息。"""
        artifacts: List[Dict[str, Any]] = []

        if not isinstance(payload, list):
            return artifacts

        output_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), 'output'))
        os.makedirs(output_dir, exist_ok=True)

        for item in payload:
            if not isinstance(item, dict):
                continue
            if item.get('type') != 'file':
                continue

            raw_path = item.get('path') or item.get('file_path') or item.get('content')
            if not raw_path:
                continue

            # 规范化路径，确保文件位于 output 目录，必要时复制过去
            normalized = self._normalize_artifact_path(raw_path, output_dir)
            if not normalized:
                continue

            filename, absolute_path = normalized
            artifact = {
                "filename": filename,
                "absolute_path": absolute_path,
                "url": f"/output/{filename}",
                "description": item.get('description') or item.get('caption') or '',
                "format": item.get('format') or item.get('mime_type') or '',
                "size": os.path.getsize(absolute_path) if os.path.exists(absolute_path) else None
            }
            artifacts.append(artifact)

        return artifacts

    def _normalize_artifact_path(self, raw_path: str, output_dir: str) -> Optional[Tuple[str, str]]:
        """归一化文件路径，确保资源可通过/output访问。"""
        if not raw_path:
            return None

        path = os.path.abspath(os.path.expanduser(raw_path))
        if not os.path.exists(path):
            # 如果OpenInterpreter给的是相对路径，尝试认为它位于 output_dir 下
            candidate = os.path.join(output_dir, os.path.basename(raw_path))
            if not os.path.exists(candidate):
                return None
            path = os.path.abspath(candidate)

        if os.path.isdir(path):
            return None

        filename = os.path.basename(path)
        destination = os.path.join(output_dir, filename)

        # 如果文件不在 output 目录中，复制一份以便静态服务
        if os.path.abspath(os.path.dirname(path)) != os.path.abspath(output_dir):
            try:
                shutil.copy2(path, destination)
                path = destination
            except Exception as copy_err:  # pragma: no cover - 防御性
                logger.warning("复制生成文件失败: %s", copy_err)
                return None
        else:
            path = destination

        return filename, path
 
    @staticmethod
    def _extract_steps_from_result_payload(payload: Any) -> list:
        """从执行结果中提取步骤播报"""
        if payload is None:
            return []

        pattern = re.compile(r"\[(?:步骤|Step)\s*(\d+)\]\s*(.+)")
        steps = []
        seen = set()

        def append_step(index_str: str, summary_text: str):
            if summary_text is None:
                return
            summary = str(summary_text).replace('\r', ' ').replace('\n', ' ').strip()
            if not summary:
                return
            if len(summary) > 120:
                summary = summary[:117] + '...'
            try:
                idx = int(index_str)
            except (ValueError, TypeError):
                idx = len(steps) + 1
            key = (idx, summary)
            if key in seen:
                return
            seen.add(key)
            steps.append({'index': idx, 'summary': summary})

        def inspect_text(text: str):
            if not text:
                return
            for match in pattern.finditer(text):
                append_step(match.group(1), match.group(2))

        def traverse(obj: Any):
            if obj is None:
                return
            if isinstance(obj, dict):
                obj_type = obj.get('type')
                if obj_type in {'console', 'message', 'assistant', 'system', 'text', 'output'} and obj.get('content'):
                    inspect_text(str(obj.get('content')))
                else:
                    for value in obj.values():
                        traverse(value)
            elif isinstance(obj, list):
                for item in obj:
                    traverse(item)
            elif isinstance(obj, str):
                inspect_text(obj)
            else:
                inspect_text(str(obj))

        traverse(payload)
        steps.sort(key=lambda item: item.get('index', 0))
        return steps
    
    def _build_prompt_with_context(self, query: str, context: Dict[str, Any] = None, 
                                   conversation_history: list = None, language: str = 'zh') -> str:
        """构建包含历史上下文的提示词 - 简化版本，只传递核心信息"""
        
        # 基础提示词（只包含连接参数和用户问题）
        base_prompt = self._build_prompt(query, context, language)
        
        # 历史上下文通过 OpenInterpreter 的内置机制管理，这里不再重复拼接
        # 直接返回简洁的提示词
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

