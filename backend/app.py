"""
Flask主应用 - 模块化重构版本
简洁的API服务端点，路由按功能模块拆分到不同蓝图
"""
import os
import sys
import logging
from flask import Flask, request, jsonify, render_template, send_from_directory
from flask_cors import CORS
from datetime import datetime

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 清理代理环境变量，避免LiteLLM冲突
for k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"):
    os.environ.pop(k, None)

# 导入自定义模块
from backend.config_loader import ConfigLoader
from backend.cache_manager import CacheManager
from backend.core import service_container

# 导入蓝图
from backend.api.config_api import config_bp
from backend.api.chat_api import chat_bp
from backend.api.history_api import history_bp
from backend.api.database_api import database_bp, serve_output as serve_output_file  # 包含数据库和文件服务
from backend.api.prompt_api import prompt_bp

services = service_container

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
OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'output')

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
    from backend.swagger_config import init_swagger
    swagger = init_swagger(app)
    if swagger:
        print("Swagger documentation initialized at /api/docs")
except ImportError:
    print("Flasgger not installed. Run: pip install flasgger")
except Exception as e:
    print(f"Failed to initialize Swagger: {e}")

# 限制CORS来源以提高安全性
try:
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


def sync_config_files():
    """保持兼容的配置同步入口。"""
    services.sync_config_files()


def ensure_history_manager(force_reload: bool = False) -> bool:
    """确保 history_manager 已初始化，必要时重试。"""
    return services.ensure_history_manager(force_reload=force_reload)


def ensure_database_manager(force_reload: bool = False) -> bool:
    """确保 database_manager 已准备好（且已配置）。"""
    return services.ensure_database_manager(force_reload=force_reload)


def init_managers(force_reload: bool = False):
    """初始化各个管理器，数据库未配置时自动降级。"""
    services.init_managers(force_reload=force_reload)


_BOOTSTRAP_DONE = False


@app.before_request
def _bootstrap_on_first_request():
    """在首个请求到达时进行一次性初始化（目录创建和服务初始化）。"""
    global _BOOTSTRAP_DONE
    if _BOOTSTRAP_DONE:
        # 服务已初始化，直接挂载到上下文
        from flask import g
        g.services = services
        g.database_manager = services.database_manager
        g.interpreter_manager = services.interpreter_manager
        g.history_manager = services.history_manager
        g.smart_router = services.smart_router
        g.sql_executor = services.sql_executor
        return
    
    try:
        # 创建必要的目录
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        os.makedirs('cache', exist_ok=True)
    except Exception:
        pass
    
    try:
        # 初始化管理器（延迟初始化，不阻塞启动）
        init_managers()
    except Exception as e:
        logger.error(f"惰性初始化失败: {e}")
    
    # 挂载服务到上下文
    from flask import g
    g.services = services
    g.database_manager = services.database_manager
    g.interpreter_manager = services.interpreter_manager
    g.history_manager = services.history_manager
    g.smart_router = services.smart_router
    g.sql_executor = services.sql_executor
    
    _BOOTSTRAP_DONE = True


# ============ 注册蓝图 ============
# 延迟初始化：在注册蓝图时不立即初始化，而是在首次请求时初始化
# 这样可以快速启动服务，让用户立即看到页面

app.register_blueprint(config_bp)
app.register_blueprint(chat_bp)
app.register_blueprint(history_bp)
app.register_blueprint(database_bp)  # 包含数据库和文件服务
app.register_blueprint(prompt_bp)


@app.route('/output/<path:filename>')
def serve_output_compat(filename):
    """兼容旧版 /output 路径，复用数据库蓝图的文件服务。"""
    return serve_output_file(filename)

# ============ 基础路由 ============

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


# 兼容端点：/api/conversations -> /api/history/conversations
@app.route('/api/conversations', methods=['GET'])
def list_conversations_compat():
    """兼容端点：重定向到历史记录API"""
    # 直接调用历史记录API的处理函数
    from backend.api.history_api import get_conversations
    from backend.core import service_container
    # 临时设置request上下文，因为get_conversations需要访问request
    # 由于已经在Flask请求上下文中，直接调用即可
    return get_conversations()


@app.route('/api/cache/clear', methods=['POST'])
def clear_cache():
    """清理缓存（测试/运维用）"""
    try:
        CacheManager.clear_all()
        return jsonify({"status": "success"})
    except Exception as e:
        logger.error(f"清理缓存失败: {e}")
        return jsonify({"status": "error", "error": str(e)}), 500


# ============ 错误处理 ============

@app.errorhandler(404)
def not_found(error):
    """处理404错误"""
    return jsonify({"error": "端点不存在"}), 404


@app.errorhandler(500)
def internal_error(error):
    """处理500错误"""
    logger.error(f"内部服务器错误: {error}")
    return jsonify({"error": "内部服务器错误"}), 500


# ============ App Factory ============

def create_app(config_override: dict | None = None):
    """App Factory：返回已配置好的 Flask app。
    兼容现有全局 app 的同时，便于测试与扩展。
    """
    if config_override:
        app.config.update(config_override)
    return app


# ============ 启动入口 ============

if __name__ == '__main__':
    # 创建必要的目录（快速操作，不阻塞）
    try:
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        os.makedirs('cache', exist_ok=True)
    except Exception:
        pass
    
    # 不在这里初始化管理器，让它在首次请求时延迟初始化
    # 这样可以快速启动服务，立即响应前端请求
    
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
            s.bind(('', 0))
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
    print(f"💡 提示: 服务初始化将在首次请求时完成")
    print(f"🛑 停止服务: Ctrl+C")
    print(f"{'='*50}\n")
    
    app.run(
        host='0.0.0.0',
        port=port,
        debug=False,
        threaded=True
    )

