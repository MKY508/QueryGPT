"""聊天API蓝图 - 处理用户查询和流式响应"""
import os
import json
import logging
import re
import uuid as uuid_module
from flask import Blueprint, request, jsonify, Response, g
from datetime import datetime

from backend.core.auth import optional_auth
from backend.services.limiter import rate_limit
from backend.core.config import ConfigLoader
from backend.core import service_container
from backend.services.guard import build_guard_block_payload
from backend.common.utils import sse_format, generate_progress_plan, dynamic_rate_limit

logger = logging.getLogger(__name__)

# 创建蓝图
chat_bp = Blueprint('chat', __name__, url_prefix='/api')

services = service_container


def _get_services():
    """从 Flask 上下文获取服务实例（优先），否则回退到全局服务容器"""
    if hasattr(g, 'services'):
        return g.services
    return services


def _get_database_manager():
    """获取数据库管理器"""
    if hasattr(g, 'database_manager'):
        return g.database_manager
    return services.database_manager


def _get_history_manager():
    """获取历史记录管理器"""
    if hasattr(g, 'history_manager'):
        return g.history_manager
    return services.history_manager


def _get_interpreter_manager():
    """获取解释器管理器"""
    if hasattr(g, 'interpreter_manager'):
        return g.interpreter_manager
    return services.interpreter_manager


def _get_smart_router():
    """获取智能路由器"""
    if hasattr(g, 'smart_router'):
        return g.smart_router
    return services.smart_router


def _get_database_guard():
    """获取数据库守卫实例"""
    if hasattr(g, 'database_guard'):
        return g.database_guard
    return getattr(services, 'database_guard', None)


def _refresh_manager_aliases():
    """刷新管理器别名"""
    pass  # 直接使用_get_*函数访问


def _get_stop_status(conversation_id):
    """线程安全地获取停止状态"""
    return services.get_stop_status(conversation_id)


def ensure_database_manager(force_reload: bool = False) -> bool:
    """确保 database_manager 已准备好（优化版本，减少锁竞争）"""
    db_manager = _get_database_manager()
    if db_manager is not None and getattr(db_manager, "is_configured", True):
        return True
    # 只有真正需要时才调用初始化
    return services.ensure_database_manager(force_reload=force_reload)


def ensure_history_manager(force_reload: bool = False) -> bool:
    """确保 history_manager 已初始化（优化版本）"""
    if _get_history_manager() is not None:
        return True
    return services.ensure_history_manager(force_reload=force_reload)


def init_managers(force_reload: bool = False):
    """初始化各个管理器"""
    services.init_managers(force_reload=force_reload)


@chat_bp.route('/chat/stream', methods=['GET'])
@optional_auth
@rate_limit(max_requests=20, window_seconds=60)
def chat_stream():
    """SSE流式查询：仅推送友好的进度与最终结果，不包含代码。"""
    try:
        interpreter_manager = _get_interpreter_manager()
        history_manager = _get_history_manager()
        smart_router = _get_smart_router()
        database_guard = _get_database_guard()

        if interpreter_manager is None:
            return Response(sse_format('error', {"error": "LLM 解释器未初始化"}), mimetype='text/event-stream')

        # 读取参数（EventSource为GET）
        user_query = request.args.get('query', '')
        model_name = request.args.get('model')
        use_database = request.args.get('use_database', 'true').lower() != 'false'
        context_rounds = int(request.args.get('context_rounds', '3') or 3)
        user_language = request.args.get('language', 'zh')
        requested_conversation_id = request.args.get('conversation_id')

        if not user_query:
            return Response(sse_format('error', {"error": "查询内容不能为空"}), mimetype='text/event-stream')

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
        services.mark_query_started(conv_id)

        # 设置上下文轮数
        if interpreter_manager and context_rounds:
            interpreter_manager.max_history_rounds = context_rounds

        def generate():
            try:
                # 起始事件
                yield sse_format('progress', {'stage': 'start', 'message': '开始处理请求…', 'conversation_id': conv_id})

                # 路由阶段
                route_info = {'route_type': 'ai_analysis', 'confidence': 0}
                config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config', 'config.json')
                smart_enabled = False
                try:
                    if os.path.exists(config_path):
                        with open(config_path, 'r', encoding='utf-8') as f:
                            cfg = json.load(f)
                            smart_enabled = cfg.get('features', {}).get('smart_routing', {}).get('enabled', False)
                except Exception:
                    smart_enabled = False

                if smart_router and smart_enabled:
                    yield sse_format('progress', {'stage': 'classify', 'message': '正在判断最佳执行路径…'})
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
                        yield sse_format('progress', {'stage': 'route', 'message': f"执行路径：{route_type}", 'route': route_info})
                    except Exception:
                        yield sse_format('progress', {'stage': 'route', 'message': '使用默认AI分析路径'})

                # 生成进度计划（短标签）
                try:
                    labels = generate_progress_plan(user_query, route_info.get('route_type', 'ai_analysis'), user_language)
                    yield sse_format('progress_plan', {'labels': labels})
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
                    yield sse_format('progress', {'stage': 'execute', 'message': '正在执行数据库查询…'})
                else:
                    yield sse_format('progress', {'stage': 'analyze', 'message': '正在分析数据与生成图表…'})

                # 执行查询 - 改为流式调用
                stream_generator = interpreter_manager.execute_query(
                    user_query,
                    context=context,
                    model_name=model_name,
                    conversation_id=conv_id,
                    stop_checker=lambda: _get_stop_status(conv_id),
                    language=user_language,
                    stream=True  # 启用流式
                )

                result = None

                # 迭代生成器
                for event in stream_generator:
                    event_type = event.get('type')

                    if event_type == 'step':
                        # 发送进度步骤
                        step_data = event.get('step', {})
                        yield sse_format('progress', {
                            'stage': step_data.get('stage', 'thought'),
                            'message': step_data.get('summary', '')
                        })

                    elif event_type == 'result':
                        # 最终结果
                        result_payload = event.get('payload', {})
                        result = result_payload

                        # 保存助手响应到历史 (已经在 InterpreterManager 中处理了，这里不需要重复保存)
                        # 不过 chat_api 原来有这段逻辑，以防万一 InterpreterManager 没有保存成功，或者逻辑有变
                        # InterpreterManager.execute_query (stream mode) 里已经调用了 _save_to_history

                        # 结果事件
                        yield sse_format('result', {
                            'success': result.get('success', False),
                            'result': result.get('result') or result.get('error'),
                            'model': result.get('model'),
                            'conversation_id': conv_id,
                            'steps': result.get('steps', []),
                            'visualization': result.get('visualization')
                        })

                if not result:
                    # 如果生成器结束但没有结果（异常情况）
                     yield sse_format('error', {'error': 'Execution finished without result', 'conversation_id': conv_id})

                yield sse_format('done', {'conversation_id': conv_id})

            except GeneratorExit:
                # 客户端断开
                services.mark_query_should_stop(conv_id)
                if interpreter_manager:
                    interpreter_manager.stop_query(conv_id)
            except Exception as e:
                logger.error(f"Streaming error: {e}")
                yield sse_format('error', {'error': str(e), 'conversation_id': conv_id})
            finally:
                services.clear_active_query(conv_id)

        headers = {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no'
        }
        return Response(generate(), headers=headers)

    except Exception as e:
        return Response(sse_format('error', {'error': str(e)}), mimetype='text/event-stream')


@chat_bp.route('/chat', methods=['POST'])
@optional_auth
@dynamic_rate_limit(max_requests=30, window_seconds=60)
def chat():
    """处理用户查询"""
    try:
        # 惰性初始化
        if _get_interpreter_manager() is None:
            try:
                init_managers()
            except Exception:
                logger.error("InterpreterManager 未初始化")
        
        interpreter_manager = _get_interpreter_manager()
        history_manager = _get_history_manager()
        smart_router = _get_smart_router()
        database_manager = _get_database_manager()
        database_guard = _get_database_guard()

        data = request.get_json(silent=True) or {}
        user_query = data.get('query') or data.get('message') or ''
        model_name = ConfigLoader.normalize_model_id(data.get('model')) if data.get('model') else None

        if not ensure_history_manager() and data.get('use_history', True):
            logger.warning("历史记录未启用，聊天记录将不会被保存")
        
        use_database = data.get('use_database', True)
        conversation_id = data.get('conversation_id')
        context_rounds = data.get('context_rounds', 3)
        user_language = data.get('language', 'zh')
        force_execute = bool(data.get('force_execute'))
        force_db_check = bool(data.get('force_db_check'))
        
        # 简易SSE兼容
        if data.get('stream') is True:
            def _mini_stream():
                yield "data: {\"status\": \"processing\"}\n\n"
                yield "data: {\"status\": \"done\"}\n\n"
            return Response(_mini_stream(), mimetype='text/event-stream')
        
        # 创建或获取会话ID
        if not conversation_id:
            if history_manager:
                has_chinese = bool(re.search(r'[\u4e00-\u9fff]', user_query))
                query_prefix = "查询: " if has_chinese else "Query: "
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
        
        # 问候语处理
        if any(greeting in query_lower for greeting in greetings):
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
                        "content": greeting_response
                    }]
                },
                "model": model_name or "system",
                "conversation_id": conversation_id,
                "timestamp": datetime.now().isoformat()
            })
        
        # 告别语处理
        if any(farewell in query_lower for farewell in farewells):
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
                "conversation_id": conversation_id,
                "timestamp": datetime.now().isoformat()
            })
        
        # 准备上下文（优化：缓存配置读取，避免重复调用）
        config_snapshot = ConfigLoader.get_config()  # 使用缓存版本
        feature_section = config_snapshot.get('features', {}) if isinstance(config_snapshot.get('features', {}), dict) else {}
        guard_cfg = feature_section.get('db_guard') if isinstance(feature_section.get('db_guard'), dict) else {}
        warn_on_guard_failure = guard_cfg.get('warn_on_failure', True)
        context = {}
        feature_cfg = feature_section
        thought_cfg = feature_cfg.get('thought_stream') if isinstance(feature_cfg.get('thought_stream'), dict) else {}
        template_key = 'template_en' if user_language == 'en' else 'template_zh'
        default_template = 'Step {index}: {summary}' if user_language == 'en' else '步骤{index}：{summary}'
        context['step_logging_enabled'] = thought_cfg.get('enabled', True)
        context['step_template'] = thought_cfg.get(template_key, default_template)
        context['step_min_words'] = thought_cfg.get('min_words', 3)
        context['force_execute'] = force_execute
        context['force_db_check'] = force_db_check
        if use_database:
            if not ensure_database_manager():
                logger.warning("请求使用数据库，但未检测到有效配置，自动降级为非数据库模式")
                use_database = False
            else:
                # 优化：直接从缓存配置获取数据库信息，避免重复读取
                db_config = config_snapshot.get('database', {})
                connection_info = {}
                if isinstance(db_config, dict):
                    connection_info = {
                        'host': db_config.get('host', ''),
                        'port': db_config.get('port', 3306),
                        'user': db_config.get('user', ''),
                        'password': db_config.get('password', ''),
                        'database': db_config.get('database', ''),
                    }

                driver = None
                if database_manager:
                    driver = getattr(database_manager, 'driver', None)
                if not driver and isinstance(db_config, dict):
                    driver = db_config.get('driver') or db_config.get('provider')

                if driver:
                    driver = str(driver).lower()
                    context['database_driver'] = driver
                    connection_info.setdefault('driver', driver)

                    if driver == 'sqlite':
                        sqlite_dsn = connection_info.get('database') or os.getenv('DATABASE_URL', '')
                        if sqlite_dsn:
                            connection_info['database'] = sqlite_dsn
                        context['dialect_guidance'] = {
                            'zh': (
                                "SQLite 不支持 SHOW DATABASES/SHOW TABLES。"
                                "请使用 `PRAGMA database_list;`、`SELECT name FROM sqlite_master WHERE type='table';`、"
                                "`PRAGMA table_info('表名');` 来探索库和表结构。"
                            ),
                            'en': (
                                "SQLite does not support SHOW DATABASES/TABLES. "
                                "Use `PRAGMA database_list;`, `SELECT name FROM sqlite_master WHERE type='table';`, "
                                "and `PRAGMA table_info('table_name');` to explore schemas."
                            )
                        }
                    elif driver in {'mysql', 'doris'}:
                        context['dialect_guidance'] = {
                            'zh': (
                                "MySQL/Doris 支持 `SHOW DATABASES;`、`SHOW TABLES;`、`DESCRIBE 表名;`。"
                                "始终编写只读 SQL（SELECT）并为探索查询加上 LIMIT。"
                            ),
                            'en': (
                                "MySQL/Doris support `SHOW DATABASES;`, `SHOW TABLES;`, and `DESCRIBE <table>;`. "
                                "Stick to read-only SQL (SELECT) and apply LIMIT clauses for exploration."
                            )
                        }
                    else:
                        context['dialect_guidance'] = {
                            'zh': (
                                f"当前数据库驱动 `{driver}` 支持标准的只读 SQL，"
                                "请根据其语法使用安全命令（SELECT/PRAGMA）探索结构。"
                            ),
                            'en': (
                                f"Current database driver `{driver}` supports standard read-only SQL. "
                                "Explore the schema using safe commands such as SELECT or PRAGMA equivalents."
                            )
                        }

                if connection_info:
                    context['connection_info'] = connection_info

                if database_manager and getattr(database_manager, 'is_configured', False):
                    global_disabled = getattr(database_manager, '_global_disabled', False)
                    if not global_disabled:
                        try:
                            db_list = database_manager.get_database_list()
                            context['available_databases'] = db_list
                        except Exception as e:
                            logger.warning(f"获取数据库列表失败，但继续执行: {e}")
        
        full_query = user_query
        
        # 标记查询开始
        services.mark_query_started(conversation_id)
        
        # 保存用户消息到历史记录
        if history_manager and conversation_id:
            history_manager.add_message(
                conversation_id=conversation_id,
                message_type="user",
                content=user_query,
                context={
                    "model": model_name,
                    "use_database": use_database,
                    "context_rounds": context_rounds,
                    "status": "pending"
                }
            )
            try:
                history_manager.update_conversation_status(conversation_id, status='active')
            except Exception:
                pass
        
        try:
            # 检查智能路由是否启用
            smart_routing_cfg = feature_cfg.get('smart_routing') if isinstance(feature_cfg.get('smart_routing'), dict) else {}
            smart_routing_enabled = smart_routing_cfg.get('enabled', False)
            
            # 使用智能路由系统
            if smart_router and smart_routing_enabled:
                logger.info("🚀 使用智能路由系统处理查询 [BETA]")
                router_context = {
                    'model_name': model_name,
                    'conversation_id': conversation_id,
                    'language': user_language,
                    'use_database': use_database,
                    'context_rounds': context_rounds,
                    'stop_checker': lambda: _get_stop_status(conversation_id),
                    'connection_info': context.get('connection_info', {}),
                    'force_execute': force_execute,
                    'feature_flags': feature_cfg,
                    'step_logging_enabled': context.get('step_logging_enabled'),
                    'step_template': context.get('step_template'),
                    'step_min_words': context.get('step_min_words')
                }
                result = smart_router.route(full_query, router_context)
                if result.get('status') == 'db_unavailable':
                    result.update({
                        "conversation_id": conversation_id,
                        "model": model_name or "smart_router",
                        "timestamp": datetime.now().isoformat()
                    })
                    return jsonify(result)
                if 'query_type' in result:
                    logger.info(f"📊 查询类型: {result['query_type']}, 执行时间: {result.get('execution_time', 'N/A')}s")
                result['smart_routing_used'] = True
            else:
                if not smart_routing_enabled:
                    logger.info("智能路由已禁用，使用标准AI流程")
                else:
                    logger.info("智能路由未初始化，使用标准AI流程")
                if use_database and guard_cfg.get('auto_check', True):
                    if not database_guard:
                        logger.warning("数据库守卫未初始化，无法执行预检")
                    else:
                        guard_context = dict(context)
                        guard_context['conversation_id'] = conversation_id
                        guard_context['model_name'] = model_name
                        db_check = database_guard.ensure_database_ready(
                            route_type='analysis',
                            context=guard_context,
                            guard_cfg=guard_cfg
                        )
                        if not db_check.get('ok'):
                            guard_response = build_guard_block_payload(
                                db_check,
                                guard_cfg,
                                query=full_query,
                                warn_on_failure=warn_on_guard_failure,
                                route_type='analysis',
                                routing_info={
                                    'route_type': 'analysis',
                                    'method': 'direct'
                                },
                                conversation_id=conversation_id,
                                model_name=model_name or "interpreter"
                            )
                            guard_response['timestamp'] = datetime.now().isoformat()
                            return jsonify(guard_response)
                result = interpreter_manager.execute_query(
                    full_query,
                    context=context,
                    model_name=model_name,
                    conversation_id=conversation_id,
                    stop_checker=lambda: _get_stop_status(conversation_id),
                    language=user_language
                )
                result['smart_routing_used'] = False
        finally:
            services.clear_active_query(conversation_id)
        
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
                    "model": result.get('model'),
                    "steps": result.get('steps')
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
                conversation_id=conversation_id,
                message_type="assistant",
                content=content_to_save,
                execution_details=execution_details
            )
        
        if result['success']:
            if history_manager and conversation_id:
                try:
                    history_manager.update_last_message_context(
                        conversation_id,
                        message_type='user',
                        updates={'status': 'completed'}
                    )
                    history_manager.update_conversation_status(conversation_id, status='completed')
                except Exception as update_err:
                    logger.warning(f"更新用户消息状态失败: {update_err}")
            resp_payload = {
                "success": True,
                "result": result['result'],
                "model": result['model'],
                "conversation_id": conversation_id,
                "timestamp": datetime.now().isoformat(),
                "steps": result.get('steps', [])
            }
            if result.get('routing_info'):
                resp_payload['routing_info'] = result['routing_info']
            if result.get('classification'):
                resp_payload['classification'] = result['classification']
            if result.get('visualization'):
                resp_payload['visualization'] = result['visualization']
            sql_text = result.get('sql')
            if not sql_text and isinstance(result.get('result'), list):
                for item in result['result']:
                    if isinstance(item, dict) and item.get('type') == 'code' and item.get('format') == 'sql':
                        sql_text = item.get('content')
                        break
            resp_payload['sql'] = sql_text
            if isinstance(result.get('result'), list):
                parts = []
                for item in result['result']:
                    content = item.get('content') if isinstance(item, dict) else None
                    if content:
                        parts.append(_sanitize_user_facing_output(str(content)))
                resp_payload['response'] = '\n'.join(filter(None, parts))[:2000]
            else:
                resp_payload['response'] = _sanitize_user_facing_output(str(result.get('result')))[:2000]
            return jsonify(resp_payload)
        elif result.get('interrupted'):
            if history_manager and conversation_id:
                try:
                    history_manager.remove_last_message(conversation_id, message_type='user', delete_empty=False)
                except Exception as cleanup_err:
                    logger.warning(f"清理中断消息失败: {cleanup_err}")
            return jsonify({
                "success": False,
                "interrupted": True,
                "error": result.get('error', '查询被用户中断'),
                "model": result['model'],
                "conversation_id": conversation_id,
                "partial_result": result.get('partial_result'),
                "timestamp": datetime.now().isoformat()
            }), 200
        else:
            return jsonify({
                "success": False,
                "error": result['error'],
                "model": result['model'],
                "conversation_id": conversation_id,
                "timestamp": datetime.now().isoformat()
            }), 500
            
    except Exception as e:
        logger.error(f"处理查询失败: {e}")
        return jsonify({"error": str(e)}), 500


@chat_bp.route('/stop_query', methods=['POST'])
def stop_query():
    """停止正在执行的查询"""
    try:
        data = request.json
        conversation_id = data.get('conversation_id')
        
        logger.info(f"收到停止查询请求: conversation_id={conversation_id}")
        
        if not conversation_id:
            logger.warning("停止查询请求缺少会话ID")
            return jsonify({"error": "需要提供会话ID"}), 400
        
        query_found = False
        active_snapshot = services.active_queries_snapshot()
        logger.info("当前活动查询: %s", list(active_snapshot.keys()))
        if conversation_id in active_snapshot:
            services.mark_query_should_stop(conversation_id)
            query_found = True
            logger.info(f"已设置停止标志: {conversation_id}")

        interpreter = _get_interpreter_manager()
        if interpreter:
            logger.info(f"调用interpreter_manager.stop_query: {conversation_id}")
            interpreter.stop_query(conversation_id)
        
        if query_found:
            logger.info(f"停止查询请求处理成功: {conversation_id}")
            return jsonify({
                "success": True,
                "message": "查询停止请求已发送",
                "conversation_id": conversation_id,
                "debug": {
                    "query_found": query_found,
                    "active_queries_count": len(active_snapshot)
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
                    "active_queries": list(active_snapshot.keys())
                }
            })
    except Exception as e:
        logger.error(f"停止查询失败: {e}")
        return jsonify({"error": str(e)}), 500


def _sanitize_user_facing_output(text: str) -> str:
    import re
    if not isinstance(text, str):
        text = str(text)
    cleaned = re.sub(r'^\[(?:步骤|Step)\s*\d+\].*$', '', text, flags=re.MULTILINE)
    cleaned = re.sub(r'\n{2,}', '\n', cleaned)
    return cleaned.strip()

