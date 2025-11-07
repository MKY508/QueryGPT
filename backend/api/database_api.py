"""数据库和文件服务API蓝图"""
import os
import re
import logging
import platform
from datetime import datetime
from flask import Blueprint, request, jsonify, send_from_directory, g
from pathlib import Path

from backend.auth import require_auth
from backend.config_loader import ConfigLoader
from backend.core import service_container
from backend.llm_service import LLMService

logger = logging.getLogger(__name__)

database_bp = Blueprint('database', __name__, url_prefix='/api')
services = service_container

# 获取项目根目录（用于文件服务）
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'output')


def _get_database_manager():
    """从 Flask 上下文获取数据库管理器（优先），否则回退到全局服务容器"""
    if hasattr(g, 'database_manager'):
        return g.database_manager
    return services.database_manager


def _get_smart_router():
    """从 Flask 上下文获取智能路由器（优先），否则回退到全局服务容器"""
    if hasattr(g, 'smart_router'):
        return g.smart_router
    return services.smart_router


def ensure_database_manager(force_reload: bool = False) -> bool:
    """确保 database_manager 已准备好（优化版本，减少锁竞争）"""
    db_manager = _get_database_manager()
    if db_manager is not None and getattr(db_manager, "is_configured", True):
        return True
    # 只有真正需要时才调用初始化
    return services.ensure_database_manager(force_reload=force_reload)


@database_bp.route('/schema', methods=['GET'])
def get_schema():
    """获取数据库结构"""
    try:
        if not ensure_database_manager():
            return jsonify({"error": "数据库未配置"}), 503
        
        database_manager = _get_database_manager()
        schema = database_manager.get_database_schema()
        return jsonify({
            "schema": schema,
            "timestamp": datetime.now().isoformat()
        })
    except Exception as e:
        logger.error(f"获取数据库结构失败: {e}")
        return jsonify({"error": str(e)}), 500


@database_bp.route('/test_connection', methods=['GET'])
def test_connection():
    """测试数据库连接"""
    try:
        if not ensure_database_manager():
            return jsonify({
                "connected": False,
                "error": "数据库未配置",
                "test_queries": []
            }), 503
        
        database_manager = _get_database_manager()
        test_result = database_manager.test_connection()
        test_result["timestamp"] = datetime.now().isoformat()
        
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


@database_bp.route('/test_model', methods=['POST'])
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


@database_bp.route('/routing-stats', methods=['GET'])
def get_routing_stats():
    """获取智能路由统计信息"""
    try:
        smart_router = _get_smart_router()
        if smart_router:
            stats = smart_router.get_routing_stats()
            
            # 兼容前端期望的字段名称
            stats['simple_queries'] = stats.get('direct_sql_queries', 0)
            stats['ai_queries'] = stats.get('ai_analysis_queries', 0)
            
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


@database_bp.route('/database/test', methods=['POST'])
def test_database():
    """测试数据库连接"""
    try:
        config = request.json
        
        # 处理localhost到127.0.0.1的转换
        if config.get('host') == 'localhost':
            config['host'] = '127.0.0.1'
        
        import pymysql
        try:
            connection = pymysql.connect(
                host=config.get('host', '127.0.0.1'),
                port=int(config.get('port', 3306)),
                user=config.get('user'),
                password=config.get('password'),
                database=config.get('database', ''),
                charset='utf8mb4',
                cursorclass=pymysql.cursors.DictCursor
            )
            
            with connection.cursor() as cursor:
                if config.get('database'):
                    cursor.execute("SHOW TABLES")
                    tables = cursor.fetchall()
                    table_count = len(tables)
                    message = f"连接成功，发现 {table_count} 个表"
                else:
                    cursor.execute("SHOW DATABASES")
                    databases = cursor.fetchall()
                    db_list = [db[list(db.keys())[0]] for db in databases]
                    user_databases = [db for db in db_list if db not in ['information_schema', 'mysql', 'performance_schema', 'sys', '__internal_schema']]
                    
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


@database_bp.route('/database/config', methods=['POST'])
def save_database_config():
    """保存数据库配置到.env文件"""
    try:
        config = request.json
        
        # 处理localhost到127.0.0.1的转换
        if config.get('host') == 'localhost':
            config['host'] = '127.0.0.1'
        
        # 读取现有的.env文件
        env_path = Path(__file__).parent.parent.parent / '.env'
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
        
        new_lines = []
        db_section_found = False
        
        for line in env_lines:
            if any(line.startswith(f"{key}=") for key in config_map.keys()):
                db_section_found = True
                continue
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
        
        # 更新当前进程环境变量并清除配置缓存，确保后续读取命中最新值
        for key, value in config_map.items():
            os.environ[key] = str(value or '')
        try:
            ConfigLoader._env_loaded = False
            ConfigLoader.clear_config_cache()
        except Exception:
            pass

        # 同时更新config.json
        PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        config_json_path = os.path.join(PROJECT_ROOT, 'config', 'config.json')
        if os.path.exists(config_json_path):
            try:
                import json
                with open(config_json_path, 'r', encoding='utf-8') as f:
                    config_data = json.load(f)
                
                config_data['database'] = {
                    'host': config_map['DB_HOST'],
                    'port': int(config_map['DB_PORT']),
                    'user': config_map['DB_USER'],
                    'password': config_map['DB_PASSWORD'],
                    'database': config_map['DB_DATABASE']
                }
                
                with open(config_json_path, 'w', encoding='utf-8') as f:
                    json.dump(config_data, f, indent=2, ensure_ascii=False)
                    
                logger.info("已同步更新config.json中的数据库配置")
            except Exception as e:
                logger.warning(f"更新config.json失败，但.env已更新: {e}")
        
        # 重新加载配置
        ensure_database_manager(force_reload=True)
        
        return jsonify({
            "success": True,
            "message": "数据库配置已保存"
        })
    except Exception as e:
        logger.error(f"保存数据库配置失败: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@database_bp.route('/execute_sql', methods=['POST'])
def execute_sql():
    """执行SQL查询（只读）"""
    try:
        data = request.json
        sql_query = data.get('query', '')
        
        if not sql_query:
            return jsonify({"error": "SQL查询不能为空"}), 400
        
        if not ensure_database_manager():
            return jsonify({"error": "数据库未配置"}), 503
        
        # SQL只读验证
        READONLY_SQL = re.compile(r"^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\b", re.I)
        if not READONLY_SQL.match(sql_query):
            return jsonify({"error": "仅允许只读查询（SELECT/SHOW/DESCRIBE/EXPLAIN）"}), 403
        
        database_manager = _get_database_manager()
        results = database_manager.execute_query(sql_query)
        
        if isinstance(results, dict):
            row_count = results.get('row_count')
            if row_count is None:
                data = results.get('data') or []
                row_count = len(data)

            payload = {
                "success": True,
                "data": results,
                "count": row_count,
                "timestamp": datetime.now().isoformat()
            }
        else:
            row_count = len(results)
            payload = {
                "success": True,
                "data": {
                    "rows": results,
                    "row_count": row_count
                },
                "count": row_count,
                "timestamp": datetime.now().isoformat()
            }

        return jsonify(payload)
    except ValueError as e:
        return jsonify({"error": str(e)}), 403
    except Exception as e:
        logger.error(f"SQL执行失败: {e}")
        return jsonify({"error": str(e)}), 500


@database_bp.route('/query', methods=['POST'])
@require_auth
def query_sql_alias():
    """兼容端点：/api/query -> 与 /api/execute_sql 相同"""
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

        database_manager = _get_database_manager()
        results = database_manager.execute_query(sql_query)
        
        if isinstance(results, dict):
            return jsonify({
                "results": results,
                "timestamp": datetime.now().isoformat()
            })
        return jsonify({
            "results": {
                "data": results,
                "row_count": len(results)
            },
            "timestamp": datetime.now().isoformat()
        })
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"SQL执行失败: {e}")
        return jsonify({"error": str(e)}), 500


# ============ 文件服务相关路由 ============

@database_bp.route('/output/<path:filename>')
def serve_output(filename):
    """安全地服务output目录中的HTML文件 - 支持跨平台路径"""
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
        os.path.join(os.path.dirname(os.path.dirname(__file__)), 'output')
    ]
    
    # 检测系统类型并添加特定路径
    system = platform.system().lower()
    logger.info(f"检测到系统类型: {system}, 平台信息: {platform.platform()}")
    
    # Windows 或 WSL 环境
    if system == 'linux':
        try:
            with open('/proc/version', 'r') as f:
                version_info = f.read().lower()
                if 'microsoft' in version_info or 'wsl' in version_info:
                    logger.info("检测到 WSL 环境，添加额外搜索路径")
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

