"""聊天API蓝图 - 处理用户查询和流式响应"""
import os
import json
import logging
import re
import uuid as uuid_module
from flask import Blueprint, request, jsonify, Response
from datetime import datetime

from backend.auth import optional_auth
from backend.rate_limiter import rate_limit
from backend.config_loader import ConfigLoader
from backend.core import service_container
from backend.utils import sse_format, generate_progress_plan, dynamic_rate_limit

logger = logging.getLogger(__name__)

# 创建蓝图
chat_bp = Blueprint('chat', __name__, url_prefix='/api')

services = service_container


def _refresh_manager_aliases():
    """刷新管理器别名"""
    pass  # 直接使用services访问


def _get_stop_status(conversation_id):
    """线程安全地获取停止状态"""
    return services.get_stop_status(conversation_id)


def ensure_database_manager(force_reload: bool = False) -> bool:
    """确保 database_manager 已准备好"""
    return services.ensure_database_manager(force_reload=force_reload)


def ensure_history_manager(force_reload: bool = False) -> bool:
    """确保 history_manager 已初始化"""
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
        interpreter_manager = services.interpreter_manager
        history_manager = services.history_manager
        smart_router = services.smart_router

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

                # 结果事件
                yield sse_format('result', {
                    'success': result.get('success', False),
                    'result': result.get('result') or result.get('error'),
                    'model': result.get('model'),
                    'conversation_id': conv_id
                })

                yield sse_format('done', {'conversation_id': conv_id})

            except GeneratorExit:
                # 客户端断开
                services.mark_query_should_stop(conv_id)
                if interpreter_manager:
                    interpreter_manager.stop_query(conv_id)
            except Exception as e:
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
        if services.interpreter_manager is None:
            try:
                init_managers()
            except Exception:
                logger.error("InterpreterManager 未初始化")
        
        interpreter_manager = services.interpreter_manager
        history_manager = services.history_manager
        smart_router = services.smart_router
        database_manager = services.database_manager

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
        
        # 准备上下文
        context = {}
        config_snapshot = ConfigLoader.get_config()
        feature_section = config_snapshot.get('features', {}) if isinstance(config_snapshot.get('features', {}), dict) else {}
        feature_cfg = feature_section
        thought_cfg = feature_cfg.get('thought_stream') if isinstance(feature_cfg.get('thought_stream'), dict) else {}
        template_key = 'template_en' if user_language == 'en' else 'template_zh'
        default_template = 'Step {index}: {summary}' if user_language == 'en' else '步骤{index}：{summary}'
        context['step_logging_enabled'] = thought_cfg.get('enabled', True)
        context['step_template'] = thought_cfg.get(template_key, default_template)
        context['step_min_words'] = thought_cfg.get('min_words', 3)
        if use_database:
            if not ensure_database_manager():
                logger.warning("请求使用数据库，但未检测到有效配置，自动降级为非数据库模式")
                use_database = False
            else:
                db_config = ConfigLoader.get_database_config()
                context['connection_info'] = {
                    'host': db_config['host'],
                    'port': db_config['port'],
                    'user': db_config['user'],
                    'password': db_config['password'],
                    'database': db_config.get('database', '')
                }
                if database_manager and getattr(database_manager, 'is_configured', False):
                    global_disabled = getattr(type(database_manager), 'GLOBAL_DISABLED', False)
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
                    "context_rounds": context_rounds
                }
            )
        
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
                conversation_id=conversation_id,
                message_type="assistant",
                content=content_to_save,
                execution_details=execution_details
            )
        
        if result['success']:
            resp_payload = {
                "success": True,
                "result": result['result'],
                "model": result['model'],
                "conversation_id": conversation_id,
                "timestamp": datetime.now().isoformat()
            }
            if result.get('routing_info'):
                resp_payload['routing_info'] = result['routing_info']
            if result.get('classification'):
                resp_payload['classification'] = result['classification']
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
                        parts.append(str(content))
                resp_payload['response'] = '\n'.join(parts)[:2000]
            else:
                resp_payload['response'] = str(result.get('result'))[:2000]
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

        interpreter = services.interpreter_manager
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

