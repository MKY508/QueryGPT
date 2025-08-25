"""
Flask主应用
简洁的API服务端点
"""
import os
import sys
import json
import logging
import re
from flask import Flask, request, jsonify, render_template, send_from_directory, session
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

# 初始化Swagger文档（可选）
try:
    from swagger_config import init_swagger
    swagger = init_swagger(app)
    if swagger:
        print("Swagger documentation initialized at /api/docs")
except ImportError:
    print("Flasgger not installed. Run: pip install flasgger")
except Exception as e:
    print(f"Failed to initialize Swagger: {e}")
# 限制CORS来源以提高安全性
CORS(app, resources={r"/api/*": {"origins": ["http://localhost:*", "http://127.0.0.1:*"]}})

# 初始化管理器
interpreter_manager = None
database_manager = None
history_manager = None
prompt_templates = PromptTemplates()

# 存储正在执行的查询任务
active_queries = {}

def init_managers():
    """初始化各个管理器"""
    global interpreter_manager, database_manager, history_manager
    try:
        interpreter_manager = InterpreterManager()
        database_manager = DatabaseManager()
        # 确保data目录存在
        os.makedirs('backend/data', exist_ok=True)
        history_manager = HistoryManager()
        logger.info("管理器初始化成功")
    except Exception as e:
        logger.error(f"管理器初始化失败: {e}")
        import traceback
        traceback.print_exc()

# 路由定义
@app.route('/')
def index():
    """主页路由"""
    return render_template('index.html')

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
    """安全地服务output目录中的HTML文件 - 修复路径遍历漏洞"""
    import os.path
    
    # 1. 规范化路径，移除 ../ 等危险元素
    safe_filename = os.path.normpath(filename)
    
    # 2. 检查是否包含路径遍历尝试
    if safe_filename.startswith('..') or os.path.isabs(safe_filename):
        logger.warning(f"检测到路径遍历尝试: {filename}")
        return jsonify({"error": "非法的文件路径"}), 403
    
    # 3. 只允许特定的文件扩展名
    ALLOWED_EXTENSIONS = {'.html', '.png', '.jpg', '.jpeg', '.svg', '.pdf'}
    file_ext = os.path.splitext(safe_filename)[1].lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        return jsonify({"error": f"不允许访问{file_ext}文件"}), 403
    
    # 4. 构建安全的文件路径
    output_dirs = [
        os.path.join(PROJECT_ROOT, 'backend', 'output'),
        OUTPUT_DIR,
        os.path.join(os.path.dirname(__file__), 'output')
    ]
    
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

@app.route('/api/chat', methods=['POST'])
@optional_auth  # 使用可选认证，允许逐步迁移
@rate_limit(max_requests=30, window_seconds=60)  # 每分钟30次
def chat():
    """处理用户查询"""
    try:
        # 检查interpreter_manager是否已初始化
        if interpreter_manager is None:
            logger.error("InterpreterManager 未初始化")
            return jsonify({"error": "LLM 解释器未初始化"}), 500
            
        data = request.json
        user_query = data.get('query', '')
        model_name = data.get('model')
        use_database = data.get('use_database', True)
        conversation_id = data.get('conversation_id')  # 获取会话ID
        context_rounds = data.get('context_rounds', 3)  # 获取上下文轮数，默认3
        user_language = data.get('language', 'zh')  # 获取用户语言，默认中文
        
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
            return jsonify({"error": "查询内容不能为空"}), 400
        
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
        
        if use_database and database_manager:
            # 方案二：简化传递，让 OpenInterpreter 自主工作
            # 直接传递用户的原始查询
            full_query = user_query
            
            # 从配置加载数据库连接信息
            from backend.config_loader import ConfigLoader
            db_config = ConfigLoader.get_database_config()
            
            # 将连接信息放在 context 中
            context['connection_info'] = {
                'host': db_config['host'],
                'port': db_config['port'],
                'user': db_config['user'],
                'password': db_config['password'],
                'database': db_config.get('database', '')
            }
            
            # 可选：获取数据库列表供参考
            try:
                db_list = database_manager.get_database_list()
                context['available_databases'] = db_list
            except Exception as e:
                logger.warning(f"获取数据库列表失败，但继续执行: {e}")
        else:
            full_query = user_query
        
        # 标记查询开始
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
            # 执行查询，传递会话ID以支持上下文
            result = interpreter_manager.execute_query(
                full_query, 
                context=context,
                model_name=model_name,
                conversation_id=conversation_id,  # 传递会话ID
                stop_checker=lambda: active_queries.get(conversation_id, {}).get('should_stop', False),
                language=user_language  # 传递语言设置
            )
        finally:
            # 清理活跃查询记录
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
            import json
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
            return jsonify({
                "success": True,
                "result": result['result'],
                "model": result['model'],
                "conversation_id": conversation_id,  # 返回会话ID
                "timestamp": datetime.now().isoformat()
            })
        elif result.get('interrupted'):
            # 查询被中断，返回部分结果
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

@app.route('/api/models', methods=['GET', 'POST'])
def handle_models():
    """获取或保存模型列表"""
    models_file = os.path.join(PROJECT_ROOT, 'config', 'models.json')
    
    if request.method == 'GET':
        try:
            # 从.env配置获取模型列表
            api_config = ConfigLoader.get_api_config()
            api_base = api_config["api_base"]
            
            # 首先尝试从配置文件读取
            if os.path.exists(models_file):
                with open(models_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    # 兼容两种格式：直接的数组或者 {"models": [...]}
                    if isinstance(data, dict) and 'models' in data:
                        models = data['models']
                    elif isinstance(data, list):
                        models = data
                    else:
                        models = []
            else:
                # 使用从.env加载的模型列表
                models = [
                    {"id": "gpt-4.1", "name": "GPT-4.1", "type": "OpenAI", "api_base": api_base, "status": "active"},
                    {"id": "claude-sonnet-4", "name": "Claude Sonnet 4", "type": "Anthropic", "api_base": api_base, "status": "active"},
                    {"id": "deepseek-r1", "name": "DeepSeek R1", "type": "DeepSeek", "api_base": api_base, "status": "active"},
                    {"id": "qwen-flagship", "name": "Qwen 旗舰模型", "type": "Qwen", "api_base": api_base, "status": "active"}
                ]
            
            return jsonify({
                "models": models,
                "current": api_config["default_model"]
            })
        except Exception as e:
            logger.error(f"获取模型列表失败: {e}")
            return jsonify({"error": str(e)}), 500
    
    else:  # POST - 保存模型
        try:
            models = request.json
            os.makedirs(os.path.dirname(models_file), exist_ok=True)
            # 保存时包装成 {"models": [...]} 格式
            with open(models_file, 'w', encoding='utf-8') as f:
                json.dump({"models": models}, f, indent=2, ensure_ascii=False)
            return jsonify({"success": True})
        except Exception as e:
            logger.error(f"保存模型失败: {e}")
            return jsonify({"error": str(e)}), 500

@app.route('/api/schema', methods=['GET'])
def get_schema():
    """获取数据库结构"""
    try:
        if not database_manager:
            return jsonify({"error": "数据库未配置"}), 400
            
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
        if not database_manager:
            return jsonify({
                "connected": False,
                "error": "数据库未配置",
                "test_queries": []
            })
            
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
        
        # 从.env获取默认配置
        api_config = ConfigLoader.get_api_config()
        api_key = data.get('api_key', api_config['api_key'])
        api_base = data.get('api_base', api_config['api_base'])
        
        # 使用 OpenAI 客户端测试连接
        from openai import OpenAI
        
        client = OpenAI(
            api_key=api_key,
            base_url=api_base
        )
        
        # 尝试简单的补全请求来测试连接
        try:
            response = client.chat.completions.create(
                model=model_id,
                messages=[{"role": "user", "content": "Hi"}],
                max_tokens=5,
                temperature=0
            )
            
            return jsonify({
                "success": True,
                "message": f"模型 {model_id} 连接成功",
                "response": response.choices[0].message.content if response.choices else "OK"
            })
        except Exception as api_error:
            logger.error(f"模型API调用失败: {api_error}")
            return jsonify({
                "success": False,
                "message": f"模型连接失败: {str(api_error)}"
            })
            
    except Exception as e:
        logger.error(f"模型测试失败: {e}")
        return jsonify({
            "success": False,
            "message": f"测试失败: {str(e)}"
        }), 500

@app.route('/api/config', methods=['GET', 'POST'])
def handle_config():
    """获取或保存配置"""
    config_path = os.path.join(PROJECT_ROOT, 'config', 'config.json')
    
    if request.method == 'GET':
        try:
            # 始终从.env加载最新配置
            api_config = ConfigLoader.get_api_config()
            db_config = ConfigLoader.get_database_config()
            
            # 构建返回的配置
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
                "database": db_config
            }
            
            # 如果config.json存在，合并其他非关键配置
            if os.path.exists(config_path):
                try:
                    with open(config_path, 'r') as f:
                        saved_config = json.load(f)
                        # 只合并UI相关的配置，不覆盖API和数据库配置
                        for key in ['interface_language', 'interface_theme', 'auto_run_code', 'show_thinking']:
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
                    elif line.startswith('DB_PASSWORD=') and config.get('database', {}).get('password'):
                        new_lines.append(f"DB_PASSWORD={config['database']['password']}\n")
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
            init_managers()
            
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
        
        # 重新加载配置
        global database_manager
        from backend.database import DatabaseManager
        database_manager = DatabaseManager()
        
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
        
        if not conversation_id:
            return jsonify({"error": "需要提供会话ID"}), 400
        
        # 检查是否有正在执行的查询
        if conversation_id in active_queries:
            query_info = active_queries[conversation_id]
            query_info['should_stop'] = True
            
            # 如果有interpreter实例，尝试停止它
            if interpreter_manager:
                interpreter_manager.stop_query(conversation_id)
            
            logger.info(f"停止查询请求: {conversation_id}")
            return jsonify({
                "success": True,
                "message": "查询停止请求已发送",
                "conversation_id": conversation_id
            })
        else:
            return jsonify({
                "success": False,
                "message": "没有找到正在执行的查询",
                "conversation_id": conversation_id
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
            
        if not database_manager:
            return jsonify({"error": "数据库未配置"}), 400
        
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

# ============ 历史记录相关API ============

@app.route('/api/history/conversations', methods=['GET'])
def get_conversations():
    """获取对话历史列表"""
    try:
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

@app.route('/api/history/conversation/<conversation_id>', methods=['GET'])
def get_conversation_detail(conversation_id):
    """获取单个对话的详细信息"""
    try:
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

@app.route('/api/history/conversation/<conversation_id>/favorite', methods=['POST'])
def toggle_favorite_conversation(conversation_id):
    """切换收藏状态"""
    try:
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
    """获取当前的Prompt设置"""
    try:
        import os
        config_path = os.path.join(os.path.dirname(__file__), 'prompt_config.json')
        
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                import json
                prompts = json.load(f)
                return jsonify(prompts)
        else:
            # 返回默认设置
            return jsonify({
                "exploration": "先理解用户需求中的业务语义...",
                "tableSelection": "优先选择包含...",
                "fieldMapping": "月份字段...",
                "dataProcessing": "Decimal类型...",
                "outputRequirements": "使用 plotly..."
            })
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
        
        # 保存到文件
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        logger.info("Prompt设置已保存")
        return jsonify({"success": True, "message": "Prompt设置已保存"})
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
            "exploration": "先理解用户需求中的业务语义：\n* \"销量\"通常指实际销售数量（sale_num/sale_qty/quantity）\n* \"七折销量\"：销量字段 * 0.7\n* \"订单金额\"指实际成交金额（knead_pay_amount/pay_amount）\n\n数据库选择优先级：\n* 优先探索数据仓库：center_dws > dws > dwh > dw\n* 其次考虑：ods（原始数据）> ads（汇总数据）",
            "tableSelection": "优先选择包含：trd/trade/order/sale + detail/day 的表（交易明细表）\n避免：production/forecast/plan/budget（计划类表）\n检查表数据量和日期范围，确保包含所需时间段",
            "fieldMapping": "月份字段：v_month > month > year_month > year_of_month\n销量字段：sale_num > sale_qty > quantity > qty\n金额字段：pay_amount > order_amount > total_amount",
            "dataProcessing": "Decimal类型需转换为float进行计算\n日期格式统一处理（如 '2025-01' 格式）\n如果发现负销量或异常值，在SQL中用WHERE条件过滤",
            "outputRequirements": "使用 plotly 生成可视化图表\n将 HTML 文件保存到 output 目录\n提供简洁的总结，包括完成的任务和关键发现"
        }
        
        config_path = os.path.join(os.path.dirname(__file__), 'prompt_config.json')
        
        # 保存默认设置到文件
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(default_prompts, f, ensure_ascii=False, indent=2)
        
        logger.info("已恢复默认Prompt设置")
        return jsonify({"success": True, "message": "已恢复默认Prompt设置"})
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

if __name__ == '__main__':
    # 初始化管理器
    init_managers()
    
    # 创建必要的目录
    os.makedirs(OUTPUT_DIR, exist_ok=True)  # 使用统一的OUTPUT_DIR
    os.makedirs('cache', exist_ok=True)
    
    # 启动服务器
    port = int(os.environ.get('PORT', 5001))
    logger.info(f"启动服务器，端口: {port}")
    
    app.run(
        host='0.0.0.0',
        port=port,
        debug=False,  # 生产环境应设置为False
        threaded=True
    )