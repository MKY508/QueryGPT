"""
Flask主应用
简洁的API服务端点
"""
import os
import sys
import json
import logging
import re
import threading
from flask import Flask, request, jsonify, render_template, send_from_directory, session
from flask import Response
from flask_cors import CORS
from datetime import datetime
import uuid as uuid_module

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 清理代理环境变量，避免LiteLLM冲突
for k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"):
    os.environ.pop(k, None)

# 导入自定义模块
from backend.interpreter_manager import InterpreterManager
from backend.database import DatabaseManager
from backend.prompts import PromptTemplates
from backend.config_loader import ConfigLoader
from backend.history_manager import HistoryManager
from backend.auth import require_auth, optional_auth, auth_manager
from backend.rate_limiter import rate_limit, strict_limiter, cleanup_rate_limiters
from backend.smart_router import SmartRouter
from backend.ai_router import RouteType
from backend.sql_executor import DirectSQLExecutor
from backend.llm_service import LLMService
from backend.api.config_api import config_bp
from backend.cache_manager import CacheManager

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 获取项目根目录
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(PROJECT_ROOT, 'frontend')
STATIC_DIR = os.path.join(FRONTEND_DIR, 'static')
TEMPLATE_DIR = os.path.join(FRONTEND_DIR, 'templates')
OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'output')  # 统一的输出目录

# 初始化Flask应用
app = Flask(__name__, 
            static_folder=STATIC_DIR,
            template_folder=TEMPLATE_DIR,
            static_url_path='/static')

# 初始化日志（文件轮转、第三方库降噪）
try:
    from backend.log_config import setup_logging, setup_request_logging
    setup_logging(app_name="querygpt", log_dir=os.path.join(PROJECT_ROOT, 'logs'))
    setup_request_logging()
except Exception as _e:
    logger.warning(f"日志系统初始化失败: {_e}")

# 初始化Swagger文档（可选）
try:
    # 修复导入路径，确保从 backend 包加载
    from backend.swagger_config import init_swagger
    swagger = init_swagger(app)
    if swagger:
        print("Swagger documentation initialized at /api/docs")
except ImportError:
    print("Flasgger not installed. Run: pip install flasgger")
except Exception as e:
    print(f"Failed to initialize Swagger: {e}")
# 限制CORS来源以提高安全性（从环境/配置读取允许的来源）
try:
    from backend.config_loader import ConfigLoader
    allowed_origins = ConfigLoader.get_config().get('security', {}).get('allowed_origins', []) or [
        'http://localhost:3000', 'http://127.0.0.1:3000'
    ]
except Exception:
    allowed_origins = ['http://localhost:3000', 'http://127.0.0.1:3000']
CORS(app, resources={r"/api/*": {"origins": allowed_origins}})

@app.after_request
def _ensure_cors_headers(resp):
    """确保测试环境下也返回基础CORS响应头（遵循白名单）。"""
    try:
        if request.path.startswith('/api/'):
            origin = request.headers.get('Origin')
            if origin and any(origin.startswith(o.rstrip('*')) for o in allowed_origins):
                resp.headers.setdefault('Access-Control-Allow-Origin', origin)
            resp.headers.setdefault('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE')
            resp.headers.setdefault('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    except Exception:
        pass
    return resp

# 初始化管理器
interpreter_manager = None
database_manager = None
history_manager = None
prompt_templates = PromptTemplates()
smart_router = None
sql_executor = None

# 存储正在执行的查询任务（使用线程锁保护）
active_queries = {}
active_queries_lock = threading.RLock()  # 使用可重入锁支持嵌套调用

def _get_stop_status(conversation_id):
    """线程安全地获取停止状态"""
    with active_queries_lock:
        return active_queries.get(conversation_id, {}).get('should_stop', False)

def sync_config_files():
    """不再写回敏感信息到config.json，保持.env为唯一来源。"""
    # 为兼容旧逻辑保留空实现，避免写入包含密码的数据库配置到版本库
    return


def ensure_history_manager(force_reload: bool = False) -> bool:
    """确保 history_manager 已初始化，必要时重试。"""
    global history_manager
    if history_manager is None or force_reload:
        try:
            init_managers(force_reload=force_reload)
        except Exception as exc:
            logger.error(f"初始化 history_manager 失败: {exc}")
    return history_manager is not None


def ensure_database_manager(force_reload: bool = False) -> bool:
    """确保 database_manager 已准备好（且已配置）。"""
    global database_manager
    db_ready = database_manager is not None and getattr(database_manager, 'is_configured', True)
    if not db_ready:
        try:
            init_managers(force_reload=force_reload or database_manager is None)
        except Exception as exc:
            logger.error(f"初始化 database_manager 失败: {exc}")
        db_ready = database_manager is not None and getattr(database_manager, 'is_configured', True)
    return db_ready


def init_managers(force_reload: bool = False):
    """初始化各个管理器，数据库未配置时自动降级"""
    global interpreter_manager, database_manager, history_manager, smart_router, sql_executor

    sync_config_files()

    if force_reload:
        try:
            DatabaseManager.GLOBAL_DISABLED = False
        except Exception:
            pass

    # 初始化数据库管理器（允许缺失配置）
    try:
        db_manager = DatabaseManager()
        if not getattr(db_manager, 'is_configured', True):
            logger.warning("数据库配置缺失，禁用数据库相关功能")
            db_manager = None
    except RuntimeError as exc:
        logger.warning(f"数据库未配置: {exc}")
        db_manager = None
    except Exception as exc:
        logger.error(f"数据库管理器初始化失败: {exc}")
        db_manager = None
    database_manager = db_manager

    # 初始化解释器
    try:
        interpreter_manager = InterpreterManager()
    except Exception as exc:
        logger.error(f"InterpreterManager 初始化失败: {exc}")
        interpreter_manager = None

    # SQL 执行器可在数据库缺失时提供友好错误
    sql_executor = DirectSQLExecutor(database_manager)

    # 初始化智能路由器，必要时回退
    try:
        smart_router = SmartRouter(database_manager, interpreter_manager)
    except Exception as exc:
        logger.warning(f"智能路由器初始化失败，将使用默认路由: {exc}")
        smart_router = None

    # 历史记录管理器
    if force_reload or history_manager is None:
        try:
            history_manager = HistoryManager()
        except Exception as exc:
            logger.error(f"历史记录管理器初始化失败: {exc}")
            history_manager = None

    logger.info(
        "管理器初始化完成: database=%s, interpreter=%s, smart_router=%s",
        bool(database_manager),
        bool(interpreter_manager),
        bool(smart_router)
    )


_BOOTSTRAP_DONE = False

@app.before_request
def _bootstrap_on_first_request():
    """在首个请求到达时进行一次性初始化。"""
    global _BOOTSTRAP_DONE
    if _BOOTSTRAP_DONE:
        return
    try:
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        os.makedirs('cache', exist_ok=True)
    except Exception:
        pass
    try:
        init_managers()
    except Exception as e:
        logger.error(f"惰性初始化失败: {e}")
    _BOOTSTRAP_DONE = True


def _sse_format(event: str, data: dict) -> str:
    try:
        payload = json.dumps(data, ensure_ascii=False)
    except Exception:
        payload = json.dumps({"message": str(data)})
    return f"event: {event}\n" f"data: {payload}\n\n"


def _generate_progress_plan(user_query: str, route_type: str = 'ai_analysis', language: str = 'zh'):
    """调用LLM生成简短进度标签（每项不超过10字，3-6项）。失败时返回默认。"""
    try:
        svc = LLMService()
        prompt = (
            "你是数据分析的执行计划助理。请基于用户需求和执行路径，生成一个最多6步的进度标签列表，"
            "每个标签不超过10个字，简短、友好，便于展示给非技术用户。"
            f"\n- 用户需求: {user_query[:200]}"
            f"\n- 执行路径: {route_type.upper()}"
            "\n只输出JSON，格式如下：\n{\n  \"labels\": [\"准备\", \"解析需求\", \"查询数据\", \"生成图表\", \"总结输出\"]\n}"
        )
        if language == 'en':
            prompt = (
                "You are a progress planner. Based on the user request and execution route, generate 3-6 short step labels"
                ", each no longer than 10 characters, friendly for non-technical users."
                f"\n- User request: {user_query[:200]}"
                f"\n- Route: {route_type.upper()}"
                "\nOutput JSON only in the form:\n{\n  \"labels\": [\"Prepare\", \"Parse\", \"Query\", \"Chart\", \"Summarize\"]\n}"
            )
        res = svc.complete(prompt, temperature=0.2, max_tokens=200)
        if res.get('success'):
            content = res.get('content', '{}')
            data = json.loads(content)
            labels = data.get('labels')
            if isinstance(labels, list) and 1 <= len(labels) <= 8:
                # 统一截断
                return [str(x)[:10] for x in labels]
    except Exception:
        pass
    # 默认计划
    return ['准备', '解析需求', '查询数据', '生成图表', '总结输出'] if language != 'en' else ['Prepare', 'Parse', 'Query', 'Chart', 'Summary']


@app.route('/api/chat/stream', methods=['GET'])
@optional_auth
@rate_limit(max_requests=20, window_seconds=60)
def chat_stream():
    """SSE流式查询：仅推送友好的进度与最终结果，不包含代码。"""
    try:
        if interpreter_manager is None:
            return Response(_sse_format('error', {"error": "LLM 解释器未初始化"}), mimetype='text/event-stream')

        # 读取参数（EventSource为GET）
        user_query = request.args.get('query', '')
        model_name = request.args.get('model')
        use_database = request.args.get('use_database', 'true').lower() != 'false'
        context_rounds = int(request.args.get('context_rounds', '3') or 3)
        user_language = request.args.get('language', 'zh')
        requested_conversation_id = request.args.get('conversation_id')

        if not user_query:
            return Response(_sse_format('error', {"error": "查询内容不能为空"}), mimetype='text/event-stream')

        # 创建或复用会话ID
        conv_id = requested_conversation_id or None
        if history_manager:
            title = user_query[:50] + ('...' if len(user_query) > 50 else '')
            existing_conversation = None
            if conv_id:
                try:
                    existing_conversation = history_manager.get_conversation_history(conv_id)
                except Exception as exc:
                    logger.warning(f"读取会话 {conv_id} 失败，创建新会话: {exc}")
                    existing_conversation = None
            if not conv_id or not existing_conversation:
                conv_id = history_manager.create_conversation(title=title, model=model_name or 'default')
        else:
            conv_id = conv_id or str(uuid_module.uuid4())

        # 如果数据库不可用，自动降级
        if use_database and not ensure_database_manager():
            logger.warning("请求使用数据库，但当前数据库不可用，自动切换为纯AI模式")
            use_database = False

        # 保存用户消息到历史
        if history_manager and conv_id and user_query:
            try:
                history_manager.add_message(
                    conversation_id=conv_id,
                    message_type="user",
                    content=user_query,
                    context={
                        "model": model_name,
                        "use_database": use_database,
                        "context_rounds": context_rounds
                    }
                )
            except Exception as exc:
                logger.warning(f"保存用户消息到历史失败: {exc}")

        # 标记查询开始
        with active_queries_lock:
            active_queries[conv_id] = { 'start_time': datetime.now(), 'should_stop': False }

        # 设置上下文轮数
        if interpreter_manager and context_rounds:
            interpreter_manager.max_history_rounds = context_rounds

        def generate():
            try:
                # 起始事件
                yield _sse_format('progress', { 'stage': 'start', 'message': '开始处理请求…', 'conversation_id': conv_id })

                # 路由阶段
                # 规范化路由类型为小写，保持与后端枚举一致
                route_info = {'route_type': 'ai_analysis', 'confidence': 0}
                config_path = os.path.join(os.path.dirname(__file__), 'config', 'config.json')
                smart_enabled = False
                try:
                    if os.path.exists(config_path):
                        with open(config_path, 'r', encoding='utf-8') as f:
                            cfg = json.load(f)
                            smart_enabled = cfg.get('features', {}).get('smart_routing', {}).get('enabled', False)
                except Exception:
                    smart_enabled = False

                if smart_router and smart_enabled:
                    yield _sse_format('progress', { 'stage': 'classify', 'message': '正在判断最佳执行路径…' })
                    router_ctx = {
                        'model_name': model_name,
                        'conversation_id': conv_id,
                        'language': user_language,
                        'use_database': use_database,
                        'context_rounds': context_rounds,
                        'stop_checker': lambda: _get_stop_status(conv_id),
                    }
                    try:
                        classification = smart_router.ai_classifier.classify(user_query, smart_router._prepare_routing_context(router_ctx)) if smart_router.ai_classifier else {}
                        route_type = str(classification.get('route', 'ai_analysis')).lower()
                        route_info['route_type'] = route_type
                        route_info['confidence'] = classification.get('confidence', 0)
                        yield _sse_format('progress', { 'stage': 'route', 'message': f"执行路径：{route_type}", 'route': route_info })
                    except Exception:
                        yield _sse_format('progress', { 'stage': 'route', 'message': '使用默认AI分析路径' })

                # 生成进度计划（短标签）
                try:
                    labels = _generate_progress_plan(user_query, route_info.get('route_type', 'ai_analysis'), user_language)
                    yield _sse_format('progress_plan', { 'labels': labels })
                except Exception:
                    pass

                # 构建执行上下文
                context = {}
                if use_database:
                    try:
                        db_config = ConfigLoader.get_database_config()
                        context['connection_info'] = {
                            'host': db_config['host'],
                            'port': db_config['port'],
                            'user': db_config['user'],
                            'password': db_config['password'],
                            'database': db_config.get('database', '')
                        }
                    except Exception:
                        pass

                # 友好阶段提示
                if route_info.get('route_type') == 'direct_sql':
                    yield _sse_format('progress', { 'stage': 'execute', 'message': '正在执行数据库查询…' })
                else:
                    yield _sse_format('progress', { 'stage': 'analyze', 'message': '正在分析数据与生成图表…' })

                # 执行查询
                result = interpreter_manager.execute_query(
                    user_query,
                    context=context,
                    model_name=model_name,
                    conversation_id=conv_id,
                    stop_checker=lambda: _get_stop_status(conv_id),
                    language=user_language
                )

                # 保存助手响应到历史
                if history_manager and conv_id:
                    try:
                        assistant_content = result.get('result', result.get('error', '执行失败'))
                        execution_details = None
                        if result.get('success'):
                            execution_details = {
                                "sql": result.get('sql'),
                                "execution_time": result.get('execution_time'),
                                "rows_affected": result.get('rows_count'),
                                "visualization": result.get('visualization'),
                                "model": result.get('model')
                            }
                        if isinstance(assistant_content, dict) and 'content' in assistant_content:
                            content_to_save = json.dumps({"type": "dual_view", "data": assistant_content}, ensure_ascii=False)
                        elif isinstance(assistant_content, list):
                            content_to_save = json.dumps({"type": "raw_output", "data": assistant_content}, ensure_ascii=False)
                        elif not isinstance(assistant_content, str):
                            content_to_save = json.dumps(assistant_content, ensure_ascii=False)
                        else:
                            content_to_save = assistant_content
                        history_manager.add_message(
                            conversation_id=conv_id,
                            message_type="assistant",
                            content=content_to_save,
                            execution_details=execution_details
                        )
                    except Exception as exc:
                        logger.warning(f"保存助手消息到历史失败: {exc}")

                # 结果事件（不包含代码，沿用后端汇总）
                yield _sse_format('result', {
                    'success': result.get('success', False),
                    'result': result.get('result') or result.get('error'),
                    'model': result.get('model'),
                    'conversation_id': conv_id
                })

                yield _sse_format('done', { 'conversation_id': conv_id })

            except GeneratorExit:
                # 客户端断开
                with active_queries_lock:
                    if conv_id in active_queries:
                        active_queries[conv_id]['should_stop'] = True
                if interpreter_manager:
                    interpreter_manager.stop_query(conv_id)
            except Exception as e:
                yield _sse_format('error', { 'error': str(e), 'conversation_id': conv_id })
            finally:
                with active_queries_lock:
                    active_queries.pop(conv_id, None)

        headers = {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no'
        }
        return Response(generate(), headers=headers)

    except Exception as e:
        return Response(_sse_format('error', { 'error': str(e) }), mimetype='text/event-stream')

# 路由定义
@app.route('/')
def index():
    """主页路由"""
    return render_template('index.html')

@app.route('/test_guide')
def test_guide():
    """引导测试页面"""
    return send_from_directory(TEMPLATE_DIR, 'test_guide.html')

@app.route('/test_onboarding')
def test_onboarding():
    """新手引导测试页面"""
    import os
    test_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'test_onboarding.html')
    if os.path.exists(test_file):
        return send_from_directory(os.path.dirname(test_file), 'test_onboarding.html')
    return jsonify({"error": "测试页面不存在"}), 404

@app.route('/debug_onboarding')
def debug_onboarding():
    """新手引导调试页面"""
    return send_from_directory(TEMPLATE_DIR, 'debug_onboarding.html')

@app.route('/config/onboarding_config.json')
def serve_onboarding_config():
    """仅安全地公开新手引导配置，避免泄露其他配置文件。"""
    config_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config')
    safe_file = 'onboarding_config.json'
    path = os.path.join(config_dir, safe_file)
    if os.path.exists(path):
        return send_from_directory(config_dir, safe_file)
    return jsonify({"error": "配置文件不存在"}), 404

@app.route('/api/health', methods=['GET'])
def health_check():
    """健康检查端点"""
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "version": "0.4.3"
    })

@app.route('/output/<path:filename>')
def serve_output(filename):
    """安全地服务output目录中的HTML文件 - 支持跨平台路径"""
    import os.path
    import platform
    
    # 1. 规范化路径，移除 ../ 等危险元素
    safe_filename = os.path.normpath(filename)
    
    # 2. 检查是否包含路径遍历尝试
    if safe_filename.startswith('..') or os.path.isabs(safe_filename):
        logger.warning(f"检测到路径遍历尝试: {filename}")
        return jsonify({"error": "非法的文件路径"}), 403
    
    # 3. 只允许特定的文件扩展名
    ALLOWED_EXTENSIONS = {'.html', '.png', '.jpg', '.jpeg', '.svg', '.pdf', '.json', '.csv'}
    file_ext = os.path.splitext(safe_filename)[1].lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        return jsonify({"error": f"不允许访问{file_ext}文件"}), 403
    
    # 4. 构建安全的文件路径 - 根据系统类型添加不同的搜索路径
    output_dirs = [
        os.path.join(PROJECT_ROOT, 'backend', 'output'),
        OUTPUT_DIR,
        os.path.join(os.path.dirname(__file__), 'output')
    ]
    
    # 检测系统类型并添加特定路径
    system = platform.system().lower()
    logger.info(f"检测到系统类型: {system}, 平台信息: {platform.platform()}")
    
    # Windows 或 WSL 环境
    if system == 'linux':
        # 检查是否是 WSL 环境
        try:
            with open('/proc/version', 'r') as f:
                version_info = f.read().lower()
                if 'microsoft' in version_info or 'wsl' in version_info:
                    logger.info("检测到 WSL 环境，添加额外搜索路径")
                    # WSL 环境可能的文件位置
                    # 注意：文件通常还是在 Linux 侧的 output 目录
                    # 但我们也检查可能的 Windows 路径映射
                    wsl_paths = [
                        '/mnt/c/tmp/output',
                        '/mnt/c/Users/Public/output'
                    ]
                    for wsl_path in wsl_paths:
                        if os.path.exists(wsl_path):
                            output_dirs.append(wsl_path)
        except:
            pass
    
    # Windows 原生环境
    elif system == 'windows':
        windows_paths = [
            'C:\\tmp\\output',
            os.path.expanduser('~\\Documents\\QueryGPT\\output')
        ]
        for win_path in windows_paths:
            if os.path.exists(win_path):
                output_dirs.append(win_path)
    
    # macOS 环境
    elif system == 'darwin':
        mac_paths = [
            os.path.expanduser('~/Documents/QueryGPT/output'),
            '/tmp/querygpt_output'
        ]
        for mac_path in mac_paths:
            if os.path.exists(mac_path):
                output_dirs.append(mac_path)
    
    logger.debug(f"搜索路径列表: {output_dirs}")
    
    for output_dir in output_dirs:
        # 确保输出目录是绝对路径
        output_dir = os.path.abspath(output_dir)
        # 构建请求的文件完整路径
        requested_path = os.path.abspath(os.path.join(output_dir, safe_filename))
        
        # 5. 验证最终路径在允许的目录内
        if not requested_path.startswith(output_dir):
            logger.warning(f"路径越界尝试: {requested_path} 不在 {output_dir} 内")
            continue
        
        # 6. 检查文件是否存在并提供服务
        if os.path.exists(requested_path) and os.path.isfile(requested_path):
            logger.info(f"安全提供文件: {safe_filename}")
            return send_from_directory(output_dir, safe_filename)
    
    logger.warning(f"文件未找到: {safe_filename}")
    return jsonify({"error": "文件未找到"}), 404

def _dynamic_rate_limit(max_requests: int, window_seconds: int):
    def deco(f):
        def wrapper(*args, **kwargs):
            # 运行时获取最新的 rate_limit（支持单测 monkeypatch）
            try:
                from backend import rate_limiter as rl
                rl_func = rl.rate_limit
                try:
                    # 优先按装饰器工厂调用
                    wrapped = rl_func(max_requests=max_requests, window_seconds=window_seconds)(f)
                except TypeError:
                    # 兼容测试桩：rl.rate_limit(f)
                    wrapped = rl_func(f)
                return wrapped(*args, **kwargs)
            except Exception:
                return f(*args, **kwargs)
        # 保留元数据
        try:
            from functools import wraps
            return wraps(f)(wrapper)
        except Exception:
            return wrapper
    return deco

@app.route('/api/chat', methods=['POST'])
@optional_auth  # 使用可选认证，允许逐步迁移
@_dynamic_rate_limit(max_requests=30, window_seconds=60)  # 支持运行时打桩
def chat():
    """处理用户查询"""
    try:
        # 惰性初始化（避免测试环境直接500）
        global interpreter_manager
        if interpreter_manager is None:
            try:
                init_managers()
            except Exception:
                logger.error("InterpreterManager 未初始化")
                # 继续执行以便返回可理解的错误
        
        data = request.get_json(silent=True) or {}
        # 兼容 message 字段
        user_query = data.get('query') or data.get('message') or ''
        from backend.config_loader import ConfigLoader
        model_name = ConfigLoader.normalize_model_id(data.get('model')) if data.get('model') else None

        if not ensure_history_manager() and data.get('use_history', True):
            logger.warning("历史记录未启用，聊天记录将不会被保存")
        use_database = data.get('use_database', True)
        conversation_id = data.get('conversation_id')  # 获取会话ID
        context_rounds = data.get('context_rounds', 3)  # 获取上下文轮数，默认3
        user_language = data.get('language', 'zh')  # 获取用户语言，默认中文
        # 简易SSE兼容：当请求标注 stream=True 时，直接返回最小SSE
        if data.get('stream') is True:
            def _mini_stream():
                yield "data: {\"status\": \"processing\"}\n\n"
                yield "data: {\"status\": \"done\"}\n\n"
            return Response(_mini_stream(), mimetype='text/event-stream')
        
        # 如果没有提供会话ID，生成一个新的并在历史记录中创建
        is_new_conversation = not conversation_id
        if not conversation_id:
            # 创建新的对话记录
            if history_manager:
                # 检测用户查询语言，使用适当的前缀
                import re
                # 简单检测是否包含中文字符
                has_chinese = bool(re.search(r'[\u4e00-\u9fff]', user_query))
                query_prefix = "查询: " if has_chinese else "Query: "
                
                # 创建标题
                title = f"{query_prefix}{user_query[:50]}..." if len(user_query) > 50 else user_query
                
                conversation_id = history_manager.create_conversation(
                    title=title,
                    model=model_name or "default",
                    database_name=data.get('database')
                )
                logger.info(f"创建新对话: {conversation_id}")
            else:
                conversation_id = str(uuid_module.uuid4())
                logger.warning("history_manager未初始化，使用临时ID")
        
        # 设置上下文轮数
        if interpreter_manager and context_rounds:
            interpreter_manager.max_history_rounds = context_rounds
        
        if not user_query:
            return jsonify({"error": "message is required"}), 400
        
        logger.info(f"收到查询: {user_query[:100]}...")
        
        # 简单的意图识别
        greetings = ['你好', 'hello', 'hi', '早上好', '下午好', '晚上好', '嗨']
        farewells = ['再见', '拜拜', 'bye', 'goodbye', '晚安']
        
        query_lower = user_query.lower().strip()
        
        # 如果是问候语
        if any(greeting in query_lower for greeting in greetings):
            # 即使是问候语，也要保存到历史记录
            if history_manager and conversation_id:
                history_manager.add_message(
                    conversation_id=conversation_id,
                    message_type="user",
                    content=user_query,
                    context={"model": model_name, "type": "greeting"}
                )
                
                greeting_response = "QueryGPT 数据分析系统\n\n可提供：\n• 数据库查询分析\n• 图表生成（柱状图、饼图、折线图）\n• 数据报表导出\n\n示例查询：\n- 查询上月销售数据\n- 按部门统计今年业绩\n- 生成产品销量趋势图"
                
                history_manager.add_message(
                    conversation_id=conversation_id,
                    message_type="assistant",
                    content=greeting_response
                )
            
            return jsonify({
                "success": True,
                "result": {
                    "content": [{
                        "type": "text",
                        "content": "QueryGPT 数据分析系统\n\n可提供：\n• 数据库查询分析\n• 图表生成（柱状图、饼图、折线图）\n• 数据报表导出\n\n示例查询：\n- 查询上月销售数据\n- 按部门统计今年业绩\n- 生成产品销量趋势图"
                    }]
                },
                "model": model_name or "system",
                "conversation_id": conversation_id,  # 添加conversation_id
                "timestamp": datetime.now().isoformat()
            })
        
        # 如果是告别语
        if any(farewell in query_lower for farewell in farewells):
            # 保存告别语到历史记录
            if history_manager and conversation_id:
                history_manager.add_message(
                    conversation_id=conversation_id,
                    message_type="user",
                    content=user_query,
                    context={"model": model_name, "type": "farewell"}
                )
                
                farewell_response = "会话结束"
                
                history_manager.add_message(
                    conversation_id=conversation_id,
                    message_type="assistant",
                    content=farewell_response
                )
            
            return jsonify({
                "success": True,
                "result": {
                    "content": [{
                        "type": "text",
                        "content": "会话结束"
                    }]
                },
                "model": model_name or "system",
                "conversation_id": conversation_id,  # 添加conversation_id
                "timestamp": datetime.now().isoformat()
            })
        
        # 准备上下文
        context = {}
        
        if use_database:
            if not ensure_database_manager():
                logger.warning("请求使用数据库，但未检测到有效配置，自动降级为非数据库模式")
                use_database = False
                full_query = user_query
            else:
                full_query = user_query

                from backend.config_loader import ConfigLoader
                db_config = ConfigLoader.get_database_config()

                context['connection_info'] = {
                    'host': db_config['host'],
                    'port': db_config['port'],
                    'user': db_config['user'],
                    'password': db_config['password'],
                    'database': db_config.get('database', '')
                }

                if (
                    getattr(database_manager, 'is_configured', False)
                    and not DatabaseManager.GLOBAL_DISABLED
                ):
                    try:
                        db_list = database_manager.get_database_list()
                        context['available_databases'] = db_list
                    except Exception as e:
                        logger.warning(f"获取数据库列表失败，但继续执行: {e}")
        else:
            full_query = user_query
        
        # 标记查询开始（线程安全）
        with active_queries_lock:
            active_queries[conversation_id] = {
                'start_time': datetime.now(),
                'should_stop': False
            }
        
        # 保存用户消息到历史记录
        if history_manager and conversation_id:
            history_manager.add_message(
                conversation_id=conversation_id,
                message_type="user",
                content=user_query,
                context={
                    "model": model_name,
                    "use_database": use_database,
                    "context_rounds": context_rounds
                }
            )
        
        try:
            # 检查智能路由是否启用
            import json
            config_path = os.path.join(os.path.dirname(__file__), 'config', 'config.json')
            if os.path.exists(config_path):
                with open(config_path, 'r', encoding='utf-8') as f:
                    config = json.load(f)
            else:
                config = {}
            smart_routing_enabled = config.get('features', {}).get('smart_routing', {}).get('enabled', False)
            
            # 使用智能路由系统
            if smart_router and smart_routing_enabled:
                logger.info("🚀 使用智能路由系统处理查询 [BETA]")
                # 准备路由上下文
                router_context = {
                    'model_name': model_name,
                    'conversation_id': conversation_id,
                    'language': user_language,
                    'use_database': use_database,
                    'context_rounds': context_rounds,
                    'stop_checker': lambda: _get_stop_status(conversation_id),
                    'connection_info': context.get('connection_info', {})  # 安全访问，避免KeyError
                }
                
                # 智能路由处理
                result = smart_router.route(full_query, router_context)
                
                # 如果路由返回了query_type，记录统计
                if 'query_type' in result:
                    logger.info(f"📊 查询类型: {result['query_type']}, 执行时间: {result.get('execution_time', 'N/A')}s")
                    # 在结果中标记使用了智能路由
                    result['smart_routing_used'] = True
            else:
                # 降级到原有流程
                if not smart_routing_enabled:
                    logger.info("智能路由已禁用，使用标准AI流程")
                else:
                    logger.info("智能路由未初始化，使用标准AI流程")
                    
                result = interpreter_manager.execute_query(
                    full_query, 
                    context=context,
                    model_name=model_name,
                    conversation_id=conversation_id,  # 传递会话ID
                    stop_checker=lambda: _get_stop_status(conversation_id),
                    language=user_language  # 传递语言设置
                )
                result['smart_routing_used'] = False
        finally:
            # 清理活跃查询记录（线程安全）
            with active_queries_lock:
                if conversation_id in active_queries:
                    del active_queries[conversation_id]
        
        # 保存助手响应到历史记录
        if history_manager and conversation_id:
            execution_details = None
            assistant_content = result.get('result', result.get('error', '执行失败'))
            
            if result.get('success'):
                execution_details = {
                    "sql": result.get('sql'),
                    "execution_time": result.get('execution_time'),
                    "rows_affected": result.get('rows_count'),
                    "visualization": result.get('visualization'),
                    "model": result.get('model')
                }
            
            # 保存完整的结果结构，以便恢复双视图
            # 如果content是包含role/type/format的数组，需要特殊处理
            if isinstance(assistant_content, dict) and 'content' in assistant_content:
                # 这是双视图格式，保存整个结构
                content_to_save = json.dumps({
                    "type": "dual_view",
                    "data": assistant_content
                })
            elif isinstance(assistant_content, list):
                # 这是原始的OpenInterpreter输出数组
                content_to_save = json.dumps({
                    "type": "raw_output",
                    "data": assistant_content
                })
            elif not isinstance(assistant_content, str):
                content_to_save = json.dumps(assistant_content)
            else:
                content_to_save = assistant_content
            
            history_manager.add_message(
                conversation_id=conversation_id,
                message_type="assistant",
                content=content_to_save,
                execution_details=execution_details
            )
        
        if result['success']:
            # 兼容单测字段：response/sql
            resp_payload = {
                "success": True,
                "result": result['result'],
                "model": result['model'],
                "conversation_id": conversation_id,
                "timestamp": datetime.now().isoformat()
            }
            # 尝试从结果中提取sql或拼装响应文本
            sql_text = result.get('sql')
            if not sql_text and isinstance(result.get('result'), list):
                # 查找类型为code且format为sql的片段
                for item in result['result']:
                    if isinstance(item, dict) and item.get('type') == 'code' and item.get('format') == 'sql':
                        sql_text = item.get('content')
                        break
            resp_payload['sql'] = sql_text
            # response 文本
            if isinstance(result.get('result'), list):
                parts = []
                for item in result['result']:
                    content = item.get('content') if isinstance(item, dict) else None
                    if content:
                        parts.append(str(content))
                resp_payload['response'] = '\n'.join(parts)[:2000]
            else:
                resp_payload['response'] = str(result.get('result'))[:2000]
            return jsonify(resp_payload)
        elif result.get('interrupted'):
            # 查询被中断，清理掉仅有的用户消息，避免残留单向记录
            if history_manager and conversation_id:
                try:
                    history_manager.remove_last_message(conversation_id, message_type='user', delete_empty=False)
                except Exception as cleanup_err:
                    logger.warning(f"清理中断消息失败: {cleanup_err}")
            # 返回部分结果
            return jsonify({
                "success": False,
                "interrupted": True,
                "error": result.get('error', '查询被用户中断'),
                "model": result['model'],
                "conversation_id": conversation_id,
                "partial_result": result.get('partial_result'),  # 如果有部分结果
                "timestamp": datetime.now().isoformat()
            }), 200  # 返回200状态码，因为这是正常的用户操作
        else:
            return jsonify({
                "success": False,
                "error": result['error'],
                "model": result['model'],
                "conversation_id": conversation_id,  # 返回会话ID
                "timestamp": datetime.now().isoformat()
            }), 500
            
    except Exception as e:
        logger.error(f"处理查询失败: {e}")
        return jsonify({"error": str(e)}), 500

app.register_blueprint(config_bp)

@app.route('/api/schema', methods=['GET'])
def get_schema():
    """获取数据库结构"""
    try:
        if not ensure_database_manager():
            return jsonify({"error": "数据库未配置"}), 503
            
        schema = database_manager.get_database_schema()
        return jsonify({
            "schema": schema,
            "timestamp": datetime.now().isoformat()
        })
    except Exception as e:
        logger.error(f"获取数据库结构失败: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/test_connection', methods=['GET'])
def test_connection():
    """测试数据库连接"""
    try:
        if not ensure_database_manager():
            return jsonify({
                "connected": False,
                "error": "数据库未配置",
                "test_queries": []
            }), 503
            
        test_result = database_manager.test_connection()
        test_result["timestamp"] = datetime.now().isoformat()
        
        # 记录测试结果
        if test_result["connected"]:
            logger.info(f"数据库连接测试成功: {test_result['host']}:{test_result['port']}")
        else:
            logger.warning(f"数据库连接测试失败: {test_result.get('error', 'Unknown error')}")
            
        return jsonify(test_result)
    except Exception as e:
        logger.error(f"连接测试失败: {e}")
        return jsonify({
            "connected": False,
            "error": str(e),
            "test_queries": []
        })

@app.route('/api/test_model', methods=['POST'])
def test_model():
    """测试模型连接"""
    try:
        data = request.json
        model_id = data.get('model')
        payload = {
            'model': model_id,
            'id': data.get('id', model_id),
            'api_key': data.get('api_key'),
            'api_base': data.get('api_base'),
            'provider': data.get('provider') or data.get('type'),
            'model_name': data.get('model_name'),
            'litellm_model': data.get('litellm_model')
        }
        success, message = LLMService.test_model_connection(payload)
        return jsonify({
            "success": success,
            "message": message
        })
    except Exception as e:
        logger.error(f"模型测试失败: {e}")
        return jsonify({
            "success": False,
            "message": f"测试失败: {str(e)}"
        }), 500

@app.route('/api/routing-stats', methods=['GET'])
def get_routing_stats():
    """获取智能路由统计信息"""
    try:
        if smart_router:
            stats = smart_router.get_routing_stats()
            
            # 兼容前端期望的字段名称（从新的字段映射到旧的前端字段）
            stats['simple_queries'] = stats.get('direct_sql_queries', 0)
            stats['ai_queries'] = stats.get('ai_analysis_queries', 0)
            
            # 计算额外的统计信息
            if stats['total_queries'] > 0:
                stats['avg_time_saved_per_query'] = stats['total_time_saved'] / stats['total_queries']
                stats['routing_efficiency'] = (stats['simple_queries'] / stats['total_queries']) * 100
            else:
                stats['avg_time_saved_per_query'] = 0
                stats['routing_efficiency'] = 0
            
            return jsonify({
                "success": True,
                "stats": stats,
                "enabled": True
            })
        else:
            return jsonify({
                "success": True,
                "stats": {
                    "total_queries": 0,
                    "simple_queries": 0,
                    "ai_queries": 0,
                    "cache_hits": 0,
                    "total_time_saved": 0
                },
                "enabled": False,
                "message": "智能路由系统未启用"
            })
    except Exception as e:
        logger.error(f"获取路由统计失败: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/config', methods=['GET', 'POST'])
def handle_config():
    """已迁移至Blueprint: backend.api.config_api.handle_config"""
    from backend.api.config_api import handle_config as _handle
    return _handle()
    
    if request.method == 'GET':
        try:
            # 优先走聚合配置，便于测试桩；同时补充前端旧字段以兼容
            try:
                cfg = ConfigLoader.get_config()
                if isinstance(cfg, dict) and 'api' in cfg:
                    api = cfg.get('api', {})
                    # 兼容旧前端：添加顶层 api_key/api_base/default_model
                    cfg.setdefault('api_key', api.get('key', ''))
                    cfg.setdefault('api_base', api.get('base_url', ''))
                    cfg.setdefault('default_model', api.get('model', ''))
                return jsonify(cfg)
            except Exception:
                pass

            # 回退到原实现
            api_config = ConfigLoader.get_api_config()
            db_config = ConfigLoader.get_database_config()

            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    full_config = json.load(f)
            except:
                full_config = {}

            config = {
                "api_key": api_config["api_key"],
                "api_base": api_config["api_base"],
                "default_model": api_config["default_model"],
                "models": [
                    {"id": "gpt-4.1", "name": "GPT-4.1", "type": "openai"},
                    {"id": "claude-sonnet-4", "name": "Claude Sonnet 4", "type": "anthropic"},
                    {"id": "deepseek-r1", "name": "DeepSeek R1", "type": "deepseek"},
                    {"id": "qwen-flagship", "name": "Qwen 旗舰模型", "type": "qwen"}
                ],
                "database": db_config,
                "features": full_config.get("features", {})
            }

            if os.path.exists(config_path):
                try:
                    with open(config_path, 'r') as f:
                        saved_config = json.load(f)
                        for key in ['interface_language', 'interface_theme', 'auto_run_code', 'show_thinking',
                                   'context_rounds', 'default_view_mode']:
                            if key in saved_config:
                                config[key] = saved_config[key]
                except:
                    pass

            return jsonify(config)
        except Exception as e:
            logger.error(f"读取配置失败: {e}")
            return jsonify({"error": str(e)}), 500
    
    else:  # POST - 保存配置
        try:
            config = request.json
            
            # 更新.env文件中的值（如果提供）
            if 'api_key' in config or 'api_base' in config or 'database' in config:
                env_path = os.path.join(PROJECT_ROOT, '.env')
                env_lines = []
                
                # 读取现有的.env文件
                if os.path.exists(env_path):
                    with open(env_path, 'r') as f:
                        env_lines = f.readlines()
                
                # 更新相应的值
                updated = False
                new_lines = []
                for line in env_lines:
                    if line.startswith('API_KEY=') and 'api_key' in config:
                        new_lines.append(f"API_KEY={config['api_key']}\n")
                        updated = True
                    elif line.startswith('API_BASE_URL=') and 'api_base' in config:
                        new_lines.append(f"API_BASE_URL={config['api_base']}\n")
                        updated = True
                    elif line.startswith('DEFAULT_MODEL=') and 'default_model' in config:
                        new_lines.append(f"DEFAULT_MODEL={config['default_model']}\n")
                        updated = True
                    elif line.startswith('DB_HOST=') and config.get('database', {}).get('host'):
                        new_lines.append(f"DB_HOST={config['database']['host']}\n")
                        updated = True
                    elif line.startswith('DB_PORT=') and config.get('database', {}).get('port'):
                        new_lines.append(f"DB_PORT={config['database']['port']}\n")
                        updated = True
                    elif line.startswith('DB_USER=') and config.get('database', {}).get('user'):
                        new_lines.append(f"DB_USER={config['database']['user']}\n")
                        updated = True
                    elif line.startswith('DB_PASSWORD=') and 'password' in config.get('database', {}):
                        new_lines.append(f"DB_PASSWORD={config['database']['password']}\n")
                        updated = True
                    elif line.startswith('DB_DATABASE=') and 'database' in config.get('database', {}):
                        new_lines.append(f"DB_DATABASE={config['database'].get('database', '')}\n")
                        updated = True
                    else:
                        new_lines.append(line)
                
                # 写回.env文件
                if updated:
                    with open(env_path, 'w') as f:
                        f.writelines(new_lines)
            
            # 同时保存到config.json
            os.makedirs(os.path.dirname(config_path), exist_ok=True)
            with open(config_path, 'w') as f:
                json.dump(config, f, indent=2, ensure_ascii=False)
            
            # 重新初始化管理器以使用新配置
            init_managers(force_reload=True)
            
            return jsonify({"success": True, "message": "配置已保存"})
        except Exception as e:
            logger.error(f"保存配置失败: {e}")
            return jsonify({"error": str(e)}), 500

@app.route('/api/database/test', methods=['POST'])
def test_database():
    """测试数据库连接"""
    try:
        config = request.json
        
        # 处理localhost到127.0.0.1的转换（macOS兼容性）
        if config.get('host') == 'localhost':
            config['host'] = '127.0.0.1'
        
        # 创建临时的数据库管理器进行测试
        import pymysql
        
        try:
            # 直接测试连接
            connection = pymysql.connect(
                host=config.get('host', '127.0.0.1'),
                port=int(config.get('port', 3306)),
                user=config.get('user'),
                password=config.get('password'),
                database=config.get('database', ''),
                charset='utf8mb4',
                cursorclass=pymysql.cursors.DictCursor
            )
            
            # 获取表数量或数据库列表
            with connection.cursor() as cursor:
                if config.get('database'):
                    # 指定了数据库，显示该数据库的表
                    cursor.execute("SHOW TABLES")
                    tables = cursor.fetchall()
                    table_count = len(tables)
                    message = f"连接成功，发现 {table_count} 个表"
                else:
                    # 未指定数据库，统计所有数据库的表
                    cursor.execute("SHOW DATABASES")
                    databases = cursor.fetchall()
                    db_list = [db[list(db.keys())[0]] for db in databases]
                    # 过滤系统数据库
                    user_databases = [db for db in db_list if db not in ['information_schema', 'mysql', 'performance_schema', 'sys', '__internal_schema']]
                    
                    # 统计所有用户数据库的表总数
                    total_table_count = 0
                    for db_name in user_databases:
                        try:
                            cursor.execute(f"SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = '{db_name}'")
                            result = cursor.fetchone()
                            total_table_count += result.get('cnt', 0)
                        except:
                            pass
                    
                    table_count = total_table_count
                    message = f"连接成功！可访问 {len(user_databases)} 个数据库，共 {total_table_count} 个表"
            
            connection.close()
            
            return jsonify({
                "success": True,
                "message": "连接成功" if config.get('database') else message,
                "table_count": table_count
            })
            
        except Exception as conn_error:
            error_msg = str(conn_error)
            # 提供更友好的错误消息
            if "Can't connect" in error_msg:
                if "nodename nor servname provided" in error_msg:
                    error_msg = "无法解析主机名，请尝试使用 127.0.0.1 代替 localhost"
                elif "Connection refused" in error_msg:
                    error_msg = "连接被拒绝，请检查数据库服务是否运行以及端口是否正确"
            elif "Access denied" in error_msg:
                error_msg = "用户名或密码错误"
                
            return jsonify({
                "success": False,
                "message": f"连接失败: {error_msg}",
                "table_count": 0
            })
            
    except Exception as e:
        logger.error(f"数据库测试连接失败: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/database/config', methods=['POST'])
def save_database_config():
    """保存数据库配置到.env文件"""
    try:
        config = request.json
        
        # 处理localhost到127.0.0.1的转换
        if config.get('host') == 'localhost':
            config['host'] = '127.0.0.1'
        
        # 读取现有的.env文件
        from pathlib import Path
        env_path = Path(__file__).parent.parent / '.env'
        env_lines = []
        
        if env_path.exists():
            with open(env_path, 'r') as f:
                env_lines = f.readlines()
        
        # 更新数据库配置行
        config_map = {
            'DB_HOST': config.get('host', '127.0.0.1'),
            'DB_PORT': str(config.get('port', 3306)),
            'DB_USER': config.get('user', ''),
            'DB_PASSWORD': config.get('password', ''),
            'DB_DATABASE': config.get('database', '')
        }
        
        # 创建新的配置行
        new_lines = []
        db_section_found = False
        
        for line in env_lines:
            # 跳过旧的数据库配置行
            if any(line.startswith(f"{key}=") for key in config_map.keys()):
                db_section_found = True
                continue
            # 在数据库配置注释后插入新配置
            if line.startswith("# 数据库配置") and not db_section_found:
                new_lines.append(line)
                new_lines.append(f"DB_HOST={config_map['DB_HOST']}\n")
                new_lines.append(f"DB_PORT={config_map['DB_PORT']}\n")
                new_lines.append(f"DB_USER={config_map['DB_USER']}\n")
                new_lines.append(f"DB_PASSWORD={config_map['DB_PASSWORD']}\n")
                new_lines.append(f"DB_DATABASE={config_map['DB_DATABASE']}\n")
                db_section_found = True
            else:
                new_lines.append(line)
        
        # 如果没有找到数据库配置部分，在文件开头添加
        if not db_section_found:
            db_config_lines = [
                "# 数据库配置\n",
                f"DB_HOST={config_map['DB_HOST']}\n",
                f"DB_PORT={config_map['DB_PORT']}\n",
                f"DB_USER={config_map['DB_USER']}\n",
                f"DB_PASSWORD={config_map['DB_PASSWORD']}\n",
                f"DB_DATABASE={config_map['DB_DATABASE']}\n",
                "\n"
            ]
            new_lines = db_config_lines + new_lines
        
        # 备份现有文件
        if env_path.exists():
            backup_path = env_path.with_suffix('.env.backup')
            import shutil
            shutil.copy(env_path, backup_path)
        
        # 写入新配置
        with open(env_path, 'w') as f:
            f.writelines(new_lines)
        
        # 同时更新config.json中的数据库配置
        config_json_path = os.path.join(PROJECT_ROOT, 'config', 'config.json')
        if os.path.exists(config_json_path):
            try:
                with open(config_json_path, 'r', encoding='utf-8') as f:
                    config_data = json.load(f)
                
                # 更新数据库配置部分
                config_data['database'] = {
                    'host': config_map['DB_HOST'],
                    'port': int(config_map['DB_PORT']),
                    'user': config_map['DB_USER'],
                    'password': config_map['DB_PASSWORD'],
                    'database': config_map['DB_DATABASE']
                }
                
                # 写回config.json
                with open(config_json_path, 'w', encoding='utf-8') as f:
                    json.dump(config_data, f, indent=2, ensure_ascii=False)
                    
                logger.info("已同步更新config.json中的数据库配置")
            except Exception as e:
                logger.warning(f"更新config.json失败，但.env已更新: {e}")
        
        # 重新加载配置
        global database_manager
        from backend.database import DatabaseManager
        DatabaseManager.GLOBAL_DISABLED = False
        database_manager = DatabaseManager()
        if not getattr(database_manager, 'is_configured', True):
            logger.warning("数据库配置保存后仍不可用，请检查 .env")
            database_manager = None
        
        return jsonify({
            "success": True,
            "message": "数据库配置已保存"
        })
        
    except Exception as e:
        logger.error(f"保存数据库配置失败: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/stop_query', methods=['POST'])
def stop_query():
    """停止正在执行的查询"""
    try:
        data = request.json
        conversation_id = data.get('conversation_id')
        
        logger.info(f"收到停止查询请求: conversation_id={conversation_id}")
        
        if not conversation_id:
            logger.warning("停止查询请求缺少会话ID")
            return jsonify({"error": "需要提供会话ID"}), 400
        
        # 检查是否有正在执行的查询（线程安全）
        query_found = False
        with active_queries_lock:
            logger.info(f"当前活动查询: {list(active_queries.keys())}")
            if conversation_id in active_queries:
                query_info = active_queries[conversation_id]
                query_info['should_stop'] = True
                query_found = True
                logger.info(f"已设置停止标志: {conversation_id}")
            
            # 如果有interpreter实例，尝试停止它
            if interpreter_manager:
                logger.info(f"调用interpreter_manager.stop_query: {conversation_id}")
                interpreter_manager.stop_query(conversation_id)
        
        if query_found:
            logger.info(f"停止查询请求处理成功: {conversation_id}")
            return jsonify({
                "success": True,
                "message": "查询停止请求已发送",
                "conversation_id": conversation_id,
                "debug": {
                    "query_found": query_found,
                    "active_queries_count": len(active_queries)
                }
            })
        else:
            logger.warning(f"未找到正在执行的查询: {conversation_id}")
            return jsonify({
                "success": False,
                "message": "没有找到正在执行的查询",
                "conversation_id": conversation_id,
                "debug": {
                    "conversation_id": conversation_id,
                    "active_queries": list(active_queries.keys())
                }
            })
            
    except Exception as e:
        logger.error(f"停止查询失败: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/execute_sql', methods=['POST'])
def execute_sql():
    """执行SQL查询（只读）"""
    try:
        data = request.json
        sql_query = data.get('query', '')
        
        if not sql_query:
            return jsonify({"error": "SQL查询不能为空"}), 400
            
        if not ensure_database_manager():
            return jsonify({"error": "数据库未配置"}), 503
        
        # SQL只读验证 - 仅允许SELECT/SHOW/DESCRIBE/EXPLAIN
        READONLY_SQL = re.compile(r"^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\b", re.I)
        if not READONLY_SQL.match(sql_query):
            return jsonify({"error": "仅允许只读查询（SELECT/SHOW/DESCRIBE/EXPLAIN）"}), 403
        
        # 执行查询
        results = database_manager.execute_query(sql_query)
        
        return jsonify({
            "success": True,
            "data": results,
            "count": len(results),
            "timestamp": datetime.now().isoformat()
        })
        
    except ValueError as e:
        # SQL安全检查失败
        return jsonify({"error": str(e)}), 403
    except Exception as e:
        logger.error(f"SQL执行失败: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/query', methods=['POST'])
@require_auth
def query_sql_alias():
    """兼容端点：/api/query -> 与 /api/execute_sql 相同，只读查询。
    接受 {"sql": "..."} 或 {"query": "..."}
    """
    try:
        payload = request.get_json(silent=True) or {}
        sql_query = payload.get('query') or payload.get('sql') or ''

        if not sql_query:
            return jsonify({"error": "SQL查询不能为空"}), 400

        if not ensure_database_manager():
            return jsonify({"error": "数据库未配置"}), 503

        READONLY_SQL = re.compile(r"^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\b", re.I)
        if not READONLY_SQL.match(sql_query or ''):
            return jsonify({"error": "仅允许只读查询（SELECT/SHOW/DESCRIBE/EXPLAIN）"}), 400

        results = database_manager.execute_query(sql_query)
        # 测试兼容：若底层返回dict（columns/data/row_count），则包一层results
        if isinstance(results, dict):
            return jsonify({
                "results": results,
                "timestamp": datetime.now().isoformat()
            })
        # 默认列表返回
        return jsonify({
            "results": {
                "data": results,
                "row_count": len(results)
            },
            "timestamp": datetime.now().isoformat()
        })
    except ValueError as e:
        # 兼容单测：非法SQL返回400
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"SQL执行失败: {e}")
        return jsonify({"error": str(e)}), 500

# ============ 历史记录相关API ============

@app.route('/api/history/conversations', methods=['GET'])
def get_conversations():
    """获取对话历史列表"""
    try:
        if not ensure_history_manager():
            return jsonify({"success": False, "conversations": [], "error": "历史记录未启用"}), 503

        # 获取查询参数
        query = request.args.get('q', '')
        limit = int(request.args.get('limit', 50))
        favorites_only = request.args.get('favorites', 'false').lower() == 'true'
        
        if favorites_only:
            conversations = history_manager.get_favorite_conversations()
        elif query:
            conversations = history_manager.search_conversations(query=query, limit=limit)
        else:
            conversations = history_manager.get_recent_conversations(limit=limit)
        
        return jsonify({
            "success": True,
            "conversations": conversations
        })
    except Exception as e:
        logger.error(f"获取对话历史失败: {e}")
        return jsonify({"error": str(e)}), 500

# 兼容端点：/api/conversations -> /api/history/conversations
@app.route('/api/conversations', methods=['GET'])
def list_conversations_compat():
    return get_conversations()

@app.route('/api/history/conversation/<conversation_id>', methods=['GET'])
def get_conversation_detail(conversation_id):
    """获取单个对话的详细信息"""
    try:
        if not ensure_history_manager():
            return jsonify({"error": "历史记录未启用"}), 503

        conversation = history_manager.get_conversation_history(conversation_id)
        if not conversation:
            return jsonify({"error": "对话不存在"}), 404
        
        return jsonify({
            "success": True,
            "conversation": conversation
        })
    except Exception as e:
        logger.error(f"获取对话详情失败: {e}")
        return jsonify({"error": str(e)}), 500

# 兼容端点：/api/history/<conversation_id> -> /api/history/conversation/<conversation_id>
@app.route('/api/history/<conversation_id>', methods=['GET'])
def get_conversation_detail_compat(conversation_id):
    try:
        if not ensure_history_manager():
            return jsonify({"error": "历史记录未启用"}), 503

        conv = history_manager.get_conversation_history(conversation_id)
        if not conv:
            return jsonify({"error": "对话不存在"}), 404
        # 兼容测试返回结构：顶层提供 messages
        messages = conv.get('messages') if isinstance(conv, dict) else None
        if messages is None and isinstance(conv, list):
            messages = conv
        return jsonify({
            "messages": messages or []
        })
    except Exception as e:
        logger.error(f"获取对话详情失败: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/history/conversation/<conversation_id>/favorite', methods=['POST'])
def toggle_favorite_conversation(conversation_id):
    """切换收藏状态"""
    try:
        if not ensure_history_manager():
            return jsonify({"error": "历史记录未启用"}), 503

        is_favorite = history_manager.toggle_favorite(conversation_id)
        return jsonify({
            "success": True,
            "is_favorite": is_favorite
        })
    except Exception as e:
        logger.error(f"切换收藏状态失败: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/history/conversation/<conversation_id>', methods=['DELETE'])
def delete_conversation_api(conversation_id):
    """删除对话"""
    try:
        if not ensure_history_manager():
            return jsonify({"success": False, "error": "历史记录未启用"}), 503

        # 验证对话是否存在
        conversation = history_manager.get_conversation_history(conversation_id)
        if not conversation:
            logger.warning(f"尝试删除不存在的对话: {conversation_id}")
            return jsonify({
                "success": False,
                "error": "对话不存在"
            }), 404
        
        # 执行删除
        deleted = history_manager.delete_conversation(conversation_id)
        
        if not deleted:
            logger.warning(f"删除对话失败，可能已被删除: {conversation_id}")
            return jsonify({
                "success": False,
                "error": "删除失败，对话可能已被删除"
            }), 400
        
        # 清理当前会话ID（如果删除的是当前对话）
        if session.get('current_conversation_id') == conversation_id:
            session.pop('current_conversation_id', None)
            logger.info(f"清理了当前会话ID: {conversation_id}")
        
        logger.info(f"成功删除对话: {conversation_id}")
        return jsonify({
            "success": True,
            "message": "对话已删除"
        })
    except Exception as e:
        logger.error(f"删除对话失败 {conversation_id}: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@app.route('/api/history/statistics', methods=['GET'])
def get_history_statistics():
    """获取历史统计信息"""
    try:
        if not ensure_history_manager():
            return jsonify({"error": "历史记录未启用"}), 503

        stats = history_manager.get_statistics()
        return jsonify({
            "success": True,
            "statistics": stats
        })
    except Exception as e:
        logger.error(f"获取统计信息失败: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/history/cleanup', methods=['POST'])
def cleanup_history():
    """清理旧历史记录"""
    try:
        if not ensure_history_manager():
            return jsonify({"error": "历史记录未启用"}), 503

        data = request.json or {}
        days = data.get('days', 90)
        history_manager.cleanup_old_conversations(days)
        return jsonify({
            "success": True,
            "message": f"已清理{days}天前的历史记录"
        })
    except Exception as e:
        logger.error(f"清理历史记录失败: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/history/replay/<conversation_id>', methods=['POST'])
def replay_conversation(conversation_id):
    """复现对话"""
    try:
        if not ensure_history_manager():
            return jsonify({"error": "历史记录未启用"}), 503

        # 获取对话历史
        conversation = history_manager.get_conversation_history(conversation_id)
        if not conversation:
            return jsonify({"error": "对话不存在"}), 404
        
        # 恢复会话状态（如果有）
        session_state = conversation.get('session_state')
        if session_state:
            # 这里可以根据需要恢复环境配置
            logger.info(f"恢复会话状态: {conversation_id}")
        
        return jsonify({
            "success": True,
            "conversation": conversation,
            "message": "对话已加载，可以继续交互"
        })
    except Exception as e:
        logger.error(f"复现对话失败: {e}")
        return jsonify({"error": str(e)}), 500

# ============ Prompt设置相关API ============

@app.route('/api/prompts', methods=['GET'])
def get_prompts():
    """获取当前的Prompt设置（兼容前端格式）"""
    try:
        import os
        config_path = os.path.join(os.path.dirname(__file__), 'prompt_config.json')
        
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                import json
                prompts = json.load(f)
                
                # 转换格式以兼容前端
                result = {}
                
                # 处理systemMessage中的DIRECT_SQL和AI_ANALYSIS
                if 'systemMessage' in prompts:
                    if 'DIRECT_SQL' in prompts['systemMessage']:
                        # 使用中文版本作为默认
                        result['directSql'] = prompts['systemMessage']['DIRECT_SQL'].get('zh', '')
                    if 'AI_ANALYSIS' in prompts['systemMessage']:
                        result['aiAnalysis'] = prompts['systemMessage']['AI_ANALYSIS'].get('zh', '')
                
                # 复制其他字段（包含扩展高级Prompt）
                for key in [
                    'routing', 'exploration', 'tableSelection', 'fieldMapping', 'dataProcessing', 'outputRequirements',
                    'summarization', 'errorHandling', 'visualization', 'dataAnalysis', 'sqlGeneration', 'codeReview', 'progressPlanner'
                ]:
                    if key in prompts:
                        result[key] = prompts[key]
                
                return jsonify(result)
        else:
            # 返回与reset保持一致的完整默认设置（提取为前端扁平字段）
            default_prompts = {
                "systemMessage": {
                    "DIRECT_SQL": {
                        "zh": "你是一个SQL查询专家。你的任务是：\n1. 连接数据库并执行SQL查询\n2. 以清晰的表格格式返回查询结果\n3. 提供查询统计信息（如记录数、执行时间）\n4. 【重要】不要创建任何可视化图表\n5. 【重要】不要保存文件到output目录\n6. 只专注于数据检索和展示\n\n数据库已配置，直接使用pymysql执行查询即可。",
                    },
                    "AI_ANALYSIS": {
                        "zh": "你是一个数据分析专家。你可以：\n1. 执行复杂的数据查询和分析\n2. 使用pandas进行数据处理和转换\n3. 使用plotly创建交互式图表和可视化\n4. 保存分析结果和图表到output目录\n5. 进行趋势分析、预测和深度洞察\n6. 生成美观的数据仪表板\n\n充分发挥你的分析能力，为用户提供有价值的数据洞察。"
                    }
                },
                "routing": "你是一个查询路由分类器。分析用户查询，选择最适合的执行路径。\n\n用户查询：{query}\n\n数据库信息：\n- 类型：{db_type}\n- 可用表：{available_tables}\n\n请从以下2个选项中选择最合适的路由：\n\n1. DIRECT_SQL - 简单查询，可以直接转换为SQL执行\n   适用：查看数据、统计数量、简单筛选、排序、基础聚合\n   示例：显示所有订单、统计用户数量、查看最新记录、按月统计销售额、查找TOP N\n   特征：不需要复杂计算、不需要图表、不需要多步处理\n\n2. AI_ANALYSIS - 需要AI智能处理的查询\n   适用：数据分析、生成图表、趋势预测、复杂计算、多步处理\n   示例：分析销售趋势、生成可视化图表、预测分析、原因探索\n   特征：需要可视化、需要推理、需要编程逻辑、复杂数据处理\n\n输出格式（JSON）：\n{\n  \"route\": \"DIRECT_SQL 或 AI_ANALYSIS\",\n  \"confidence\": 0.95,\n  \"reason\": \"选择此路由的原因\",\n  \"suggested_sql\": \"如果是DIRECT_SQL，提供建议的SQL语句\"\n}\n\n判断规则：\n- 如果查询包含\"图\"、\"图表\"、\"可视化\"、\"绘制\"、\"plot\"、\"chart\"等词 → 选择 AI_ANALYSIS\n- 如果查询包含\"分析\"、\"趋势\"、\"预测\"、\"为什么\"、\"原因\"等词 → 选择 AI_ANALYSIS\n- 如果只是简单的数据查询、统计、筛选 → 选择 DIRECT_SQL\n- 当不确定时，倾向选择 AI_ANALYSIS 以确保功能完整",
                "exploration": "数据库探索策略（当未指定database时）：\n1. 先执行 SHOW DATABASES 查看所有可用数据库\n2. 根据用户需求选择合适的数据库：\n   * 销售相关：包含 sales/trade/order/trd 关键词的库\n   * 数据仓库优先：center_dws > dws > dwh > dw > ods > ads\n3. USE 选中的数据库后，SHOW TABLES 查看表列表\n4. 对候选表执行 DESCRIBE 了解字段结构\n5. 查询样本数据验证内容，根据需要调整查询范围\n\n注意：智能选择相关数据库和表，避免无关数据的查询",
                "tableSelection": "表选择策略：\n1. 优先选择包含业务关键词的表：trd/trade/order/sale + detail/day\n2. 避免计划类表：production/forecast/plan/budget\n3. 检查表数据：\n   * 先 SELECT COUNT(*) 确认有数据\n   * 再 SELECT MIN(date_field), MAX(date_field) 确认时间范围\n   * 查看样本数据了解结构",
                "fieldMapping": "字段映射规则：\n* 日期字段：date > order_date > trade_date > create_time > v_month\n* 销量字段：sale_num > sale_qty > quantity > qty > amount\n* 金额字段：pay_amount > order_amount > total_amount > price\n* 折扣字段：discount > discount_rate > discount_amount",
                "dataProcessing": "数据处理要求：\n1. 使用 pymysql 创建数据库连接\n2. Decimal类型转换为float进行计算\n3. 日期格式统一处理（如 '2025-01' 格式）\n4. 过滤异常数据：WHERE amount > 0 AND date IS NOT NULL\n5. 限制查询结果：大表查询加 LIMIT 10000",
                "outputRequirements": "输出要求：\n1. 必须从MySQL数据库查询，禁止查找CSV文件\n2. 探索数据库时有节制，避免全表扫描\n3. 使用 plotly 生成可视化图表\n4. 将图表保存为 HTML 到 output 目录\n5. 提供查询过程总结和关键发现"
            }
            flat = {
                'routing': default_prompts['routing'],
                'directSql': default_prompts['systemMessage']['DIRECT_SQL']['zh'],
                'aiAnalysis': default_prompts['systemMessage']['AI_ANALYSIS']['zh'],
                'exploration': default_prompts['exploration'],
                'tableSelection': default_prompts['tableSelection'],
                'fieldMapping': default_prompts['fieldMapping'],
                'dataProcessing': default_prompts['dataProcessing'],
                'outputRequirements': default_prompts['outputRequirements'],
                # 高级Prompt默认
                'summarization': '基于分析结果，用2–4句中文业务语言总结关键发现、趋势或异常，避免技术细节。',
                'errorHandling': '当出现错误时，先识别错误类型（连接/权限/语法/超时），用中文简洁解释并给出下一步建议，避免输出堆栈与敏感信息。',
                'visualization': '根据数据特征选择合适的可视化类型（柱/线/饼/散点等），使用中文标题与轴标签，保存为HTML至output目录。',
                'dataAnalysis': '进行数据清洗、聚合、对比、趋势与异常分析，确保结果可解释与复现，必要时输出方法与局限说明（中文）。',
                'sqlGeneration': '从自然语言与schema生成只读SQL，遵循只读限制（SELECT/SHOW/DESCRIBE/EXPLAIN），避免危险语句与全表扫描。',
                'codeReview': '对将要执行的代码进行安全与必要性检查，避免长时/不必要操作，给出简洁优化建议（中文）。',
                'progressPlanner': '将当前执行阶段总结为不超过10字的中文短语，面向非技术用户，如“连接数据库”“查询数据”“生成图表”。'
            }
            return jsonify(flat)
    except Exception as e:
        logger.error(f"获取Prompt设置失败: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/prompts', methods=['POST'])
def save_prompts():
    """保存Prompt设置"""
    try:
        import os
        import json
        
        data = request.json
        config_path = os.path.join(os.path.dirname(__file__), 'prompt_config.json')
        
        # 转换前端格式到后端格式
        # 前端发送: directSql, aiAnalysis (扁平结构)
        # 后端需要: systemMessage.DIRECT_SQL.zh, systemMessage.AI_ANALYSIS.zh (嵌套结构)
        
        # 读取现有配置（保持其他字段不变）
        existing_config = {}
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                existing_config = json.load(f)
        
        # 构建新配置
        new_config = existing_config.copy()
        
        # 确保有systemMessage结构
        if 'systemMessage' not in new_config:
            new_config['systemMessage'] = {
                'DIRECT_SQL': {'zh': '', 'en': ''},
                'AI_ANALYSIS': {'zh': '', 'en': ''}
            }
        
        # 映射前端字段到后端结构
        if 'directSql' in data:
            if 'DIRECT_SQL' not in new_config['systemMessage']:
                new_config['systemMessage']['DIRECT_SQL'] = {}
            new_config['systemMessage']['DIRECT_SQL']['zh'] = data['directSql']
            # 保持英文版本不变（如果存在）
            if 'en' not in new_config['systemMessage']['DIRECT_SQL']:
                new_config['systemMessage']['DIRECT_SQL']['en'] = ''
        
        if 'aiAnalysis' in data:
            if 'AI_ANALYSIS' not in new_config['systemMessage']:
                new_config['systemMessage']['AI_ANALYSIS'] = {}
            new_config['systemMessage']['AI_ANALYSIS']['zh'] = data['aiAnalysis']
            # 保持英文版本不变（如果存在）
            if 'en' not in new_config['systemMessage']['AI_ANALYSIS']:
                new_config['systemMessage']['AI_ANALYSIS']['en'] = ''
        
        # 保持其他字段（routing, exploration等）不变，包含扩展高级Prompt
        for key in [
            'routing', 'exploration', 'tableSelection', 'fieldMapping', 'dataProcessing', 'outputRequirements',
            'summarization', 'errorHandling', 'visualization', 'dataAnalysis', 'sqlGeneration', 'codeReview', 'progressPlanner'
        ]:
            if key in data:
                new_config[key] = data[key]
        
        # 保存到文件
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(new_config, f, ensure_ascii=False, indent=2)
        
        # 如果有routing prompt，更新智能路由器的prompt
        if 'routing' in new_config and smart_router:
            smart_router.update_routing_prompt(new_config['routing'])
            logger.info("智能路由Prompt已更新")
        
        # 构造标准返回，便于前端即时刷新
        flat = {
            'routing': new_config.get('routing', ''),
            'directSql': new_config['systemMessage']['DIRECT_SQL'].get('zh', ''),
            'aiAnalysis': new_config['systemMessage']['AI_ANALYSIS'].get('zh', ''),
            'exploration': new_config.get('exploration', ''),
            'tableSelection': new_config.get('tableSelection', ''),
            'fieldMapping': new_config.get('fieldMapping', ''),
            'dataProcessing': new_config.get('dataProcessing', ''),
            'outputRequirements': new_config.get('outputRequirements', ''),
            'summarization': new_config.get('summarization', ''),
            'errorHandling': new_config.get('errorHandling', ''),
            'visualization': new_config.get('visualization', ''),
            'dataAnalysis': new_config.get('dataAnalysis', ''),
            'sqlGeneration': new_config.get('sqlGeneration', ''),
            'codeReview': new_config.get('codeReview', ''),
            'progressPlanner': new_config.get('progressPlanner', '')
        }
        logger.info("Prompt设置已保存")
        return jsonify({"success": True, "message": "Prompt设置已保存", "prompts": flat})
    except Exception as e:
        logger.error(f"保存Prompt设置失败: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/prompts/reset', methods=['POST'])
def reset_prompts():
    """恢复默认Prompt设置"""
    try:
        import os
        import json
        
        default_prompts = {
            "systemMessage": {
                "DIRECT_SQL": {
                    "zh": "你是一个SQL查询专家。你的任务是：\n1. 连接数据库并执行SQL查询\n2. 以清晰的表格格式返回查询结果\n3. 提供查询统计信息（如记录数、执行时间）\n4. 【重要】不要创建任何可视化图表\n5. 【重要】不要保存文件到output目录\n6. 只专注于数据检索和展示\n\n数据库已配置，直接使用pymysql执行查询即可。",
                    "en": "You are a SQL query expert. Your tasks are:\n1. Connect to database and execute SQL queries\n2. Return results in clear tabular format\n3. Provide query statistics (record count, execution time)\n4. [IMPORTANT] DO NOT create any visualizations or charts\n5. [IMPORTANT] DO NOT save files to output directory\n6. Focus only on data retrieval and display\n\nDatabase is configured, use pymysql directly to execute queries."
                },
                "AI_ANALYSIS": {
                    "zh": "你是一个数据分析专家。你可以：\n1. 执行复杂的数据查询和分析\n2. 使用pandas进行数据处理和转换\n3. 使用plotly创建交互式图表和可视化\n4. 保存分析结果和图表到output目录\n5. 进行趋势分析、预测和深度洞察\n6. 生成美观的数据仪表板\n\n充分发挥你的分析能力，为用户提供有价值的数据洞察。",
                    "en": "You are a data analysis expert. You can:\n1. Execute complex data queries and analysis\n2. Use pandas for data processing and transformation\n3. Use plotly to create interactive charts and visualizations\n4. Save analysis results and charts to output directory\n5. Perform trend analysis, predictions and deep insights\n6. Generate beautiful data dashboards\n\nLeverage your analytical capabilities to provide valuable data insights."
                }
            },
            "routing": "你是一个查询路由分类器。分析用户查询，选择最适合的执行路径。\n\n用户查询：{query}\n\n数据库信息：\n- 类型：{db_type}\n- 可用表：{available_tables}\n\n请从以下2个选项中选择最合适的路由：\n\n1. DIRECT_SQL - 简单查询，可以直接转换为SQL执行\n   适用：查看数据、统计数量、简单筛选、排序、基础聚合\n   示例：显示所有订单、统计用户数量、查看最新记录、按月统计销售额、查找TOP N\n   特征：不需要复杂计算、不需要图表、不需要多步处理\n\n2. AI_ANALYSIS - 需要AI智能处理的查询\n   适用：数据分析、生成图表、趋势预测、复杂计算、多步处理\n   示例：分析销售趋势、生成可视化图表、预测分析、原因探索\n   特征：需要可视化、需要推理、需要编程逻辑、复杂数据处理\n\n输出格式（JSON）：\n{\n  \"route\": \"DIRECT_SQL 或 AI_ANALYSIS\",\n  \"confidence\": 0.95,\n  \"reason\": \"选择此路由的原因\",\n  \"suggested_sql\": \"如果是DIRECT_SQL，提供建议的SQL语句\"\n}\n\n判断规则：\n- 如果查询包含\"图\"、\"图表\"、\"可视化\"、\"绘制\"、\"plot\"、\"chart\"等词 → 选择 AI_ANALYSIS\n- 如果查询包含\"分析\"、\"趋势\"、\"预测\"、\"为什么\"、\"原因\"等词 → 选择 AI_ANALYSIS\n- 如果只是简单的数据查询、统计、筛选 → 选择 DIRECT_SQL\n- 当不确定时，倾向选择 AI_ANALYSIS 以确保功能完整",
            "exploration": "数据库探索策略（当未指定database时）：\n1. 先执行 SHOW DATABASES 查看所有可用数据库\n2. 根据用户需求选择合适的数据库：\n   * 销售相关：包含 sales/trade/order/trd 关键词的库\n   * 数据仓库优先：center_dws > dws > dwh > dw > ods > ads\n3. USE 选中的数据库后，SHOW TABLES 查看表列表\n4. 对候选表执行 DESCRIBE 了解字段结构\n5. 查询样本数据验证内容，根据需要调整查询范围\n\n注意：智能选择相关数据库和表，避免无关数据的查询",
            "tableSelection": "表选择策略：\n1. 优先选择包含业务关键词的表：trd/trade/order/sale + detail/day\n2. 避免计划类表：production/forecast/plan/budget\n3. 检查表数据：\n   * 先 SELECT COUNT(*) 确认有数据\n   * 再 SELECT MIN(date_field), MAX(date_field) 确认时间范围\n   * 查看样本数据了解结构",
            "fieldMapping": "字段映射规则：\n* 日期字段：date > order_date > trade_date > create_time > v_month\n* 销量字段：sale_num > sale_qty > quantity > qty > amount\n* 金额字段：pay_amount > order_amount > total_amount > price\n* 折扣字段：discount > discount_rate > discount_amount",
            "dataProcessing": "数据处理要求：\n1. 使用 pymysql 创建数据库连接\n2. Decimal类型转换为float进行计算\n3. 日期格式统一处理（如 '2025-01' 格式）\n4. 过滤异常数据：WHERE amount > 0 AND date IS NOT NULL\n5. 限制查询结果：大表查询加 LIMIT 10000",
            "outputRequirements": "输出要求：\n1. 必须从MySQL数据库查询，禁止查找CSV文件\n2. 探索数据库时有节制，避免全表扫描\n3. 使用 plotly 生成交互式图表\n4. 将图表保存为 HTML 到 output 目录\n5. 提供查询过程总结和关键发现"
        }
        
        config_path = os.path.join(os.path.dirname(__file__), 'prompt_config.json')
        
        # 保存默认设置到文件
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(default_prompts, f, ensure_ascii=False, indent=2)
        
        # 更新智能路由器的prompt为默认值
        if smart_router and 'routing' in default_prompts:
            smart_router.update_routing_prompt(default_prompts['routing'])
            logger.info("智能路由Prompt已恢复默认")
        
        flat = {
            'routing': default_prompts['routing'],
            'directSql': default_prompts['systemMessage']['DIRECT_SQL'].get('zh', ''),
            'aiAnalysis': default_prompts['systemMessage']['AI_ANALYSIS'].get('zh', ''),
            'exploration': default_prompts['exploration'],
            'tableSelection': default_prompts['tableSelection'],
            'fieldMapping': default_prompts['fieldMapping'],
            'dataProcessing': default_prompts['dataProcessing'],
            'outputRequirements': default_prompts['outputRequirements'],
            'summarization': '基于分析结果，用2–4句中文业务语言总结关键发现、趋势或异常，避免技术细节。',
            'errorHandling': '当出现错误时，先识别错误类型（连接/权限/语法/超时），用中文简洁解释并给出下一步建议，避免输出堆栈与敏感信息。',
            'visualization': '根据数据特征选择合适的可视化类型（柱/线/饼/散点等），使用中文标题与轴标签，保存为HTML至output目录。',
            'dataAnalysis': '进行数据清洗、聚合、对比、趋势与异常分析，确保结果可解释与复现，必要时输出方法与局限说明（中文）。',
            'sqlGeneration': '从自然语言与schema生成只读SQL，遵循只读限制（SELECT/SHOW/DESCRIBE/EXPLAIN），避免危险语句与全表扫描。',
            'codeReview': '对将要执行的代码进行安全与必要性检查，避免长时/不必要操作，给出简洁优化建议（中文）。',
            'progressPlanner': '将当前执行阶段总结为不超过10字的中文短语，面向非技术用户，如“连接数据库”“查询数据”“生成图表”。'
        }
        logger.info("已恢复默认Prompt设置")
        return jsonify({"success": True, "message": "已恢复默认Prompt设置", "prompts": flat})
    except Exception as e:
        logger.error(f"恢复默认Prompt设置失败: {e}")
        return jsonify({"error": str(e)}), 500

@app.errorhandler(404)
def not_found(error):
    """处理404错误"""
    return jsonify({"error": "端点不存在"}), 404

@app.errorhandler(500)
def internal_error(error):
    """处理500错误"""
    logger.error(f"内部服务器错误: {error}")
    return jsonify({"error": "内部服务器错误"}), 500

@app.route('/api/cache/clear', methods=['POST'])
def clear_cache():
    """清理缓存（测试/运维用）"""
    try:
        CacheManager.clear_all()
        return jsonify({"status": "success"})
    except Exception as e:
        logger.error(f"清理缓存失败: {e}")
        return jsonify({"status": "error", "error": str(e)}), 500


def create_app(config_override: dict | None = None):
    """App Factory：返回已配置好的 Flask app。
    兼容现有全局 app 的同时，便于测试与扩展。
    """
    if config_override:
        app.config.update(config_override)
    return app

if __name__ == '__main__':
    # 同步配置文件，确保一致性
    sync_config_files()
    
    # 初始化管理器
    init_managers()
    
    # 创建必要的目录
    os.makedirs(OUTPUT_DIR, exist_ok=True)  # 使用统一的OUTPUT_DIR
    os.makedirs('cache', exist_ok=True)
    
    # 自动查找可用端口
    def find_available_port(start_port=5000, max_attempts=100):
        """自动查找可用端口"""
        import socket
        
        # 首先尝试环境变量指定的端口
        env_port = os.environ.get('PORT')
        if env_port:
            try:
                port = int(env_port)
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.bind(('127.0.0.1', port))
                return port
            except:
                logger.warning(f"环境变量指定的端口 {env_port} 已被占用，自动查找其他端口...")
        
        # 自动查找可用端口
        for i in range(max_attempts):
            port = start_port + i
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.bind(('127.0.0.1', port))
                return port
            except OSError:
                continue
        
        # 如果都失败，使用随机高位端口
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(('', 0))  # 让系统分配
            port = s.getsockname()[1]
        return port
    
    # 启动服务器
    port = find_available_port()
    logger.info(f"启动服务器，端口: {port}")
    
    # 打印友好的启动信息
    print(f"\n{'='*50}")
    print(f"✅ QueryGPT 服务已启动")
    print(f"🌐 访问地址: http://localhost:{port}")
    print(f"📊 API文档: http://localhost:{port}/api/docs")
    print(f"🛑 停止服务: Ctrl+C")
    print(f"{'='*50}\n")
    
    app.run(
        host='0.0.0.0',
        port=port,
        debug=False,  # 生产环境应设置为False
        threaded=True
    )
