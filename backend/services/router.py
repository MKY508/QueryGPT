"""
AI驱动的智能查询路由系统
完全使用AI进行查询分类和路由决策
"""
import logging
import time
from typing import Dict, Any, Optional
from backend.ai_router import AIRoutingClassifier, RouteType
from backend.services.llm import llm_manager
from backend.core.config import ConfigLoader
from backend.services.guard import DatabaseGuard, build_guard_block_payload

logger = logging.getLogger(__name__)

class SmartRouter:
    """
    智能路由器
    使用AI判断查询类型并选择最优执行路径
    """
    
    def __init__(self, database_manager=None, interpreter_manager=None, database_guard: DatabaseGuard | None = None):
        """
        初始化智能路由器
        
        Args:
            database_manager: 数据库管理器
            interpreter_manager: OpenInterpreter管理器
        """
        self.database_manager = database_manager
        self.database_guard = database_guard or DatabaseGuard(database_manager)
        self.interpreter_manager = interpreter_manager
        
        # 加载保存的routing prompt
        custom_prompt = self._load_routing_prompt()

        # 读取特性开关，避免缺省配置触发异常
        self.feature_flags = self._load_feature_flags()
        
        # 初始化AI分类器并进行健康检查
        self.llm_available = False
        try:
            llm_service = llm_manager.get_service()
            
            # 更详细的健康检查
            if llm_service and llm_service.api_key:
                # 尝试一个简单的测试调用
                test_success = self._test_llm_service(llm_service)
                
                if test_success:
                    self.ai_classifier = AIRoutingClassifier(llm_service, custom_prompt)
                    self.llm_available = True
                    logger.info("✅ 智能路由AI分类器初始化成功并通过健康检查")
                else:
                    self.ai_classifier = AIRoutingClassifier(None, custom_prompt)
                    logger.warning("⚠️ LLM服务健康检查失败，将使用基于规则的路由")
            else:
                self.ai_classifier = AIRoutingClassifier(None, custom_prompt)
                logger.warning("⚠️ 智能路由: LLM服务配置缺失，将使用基于规则的路由")
        except Exception as e:
            logger.error(f"❌ 初始化AI分类器失败: {e}")
            self.ai_classifier = AIRoutingClassifier(None, custom_prompt)
        
        # 路由统计（简化版）
        self.routing_stats = {
            "total_queries": 0,
            "qa_queries": 0,
            "analysis_queries": 0,
            "aborted_queries": 0,
            "ai_classification_time": 0,
            "total_time_saved": 0.0,
            "fallback_count": 0,
            "rule_based_routes": 0,
            "forced_queries": 0
        }
    
    def _load_feature_flags(self) -> Dict[str, Any]:
        """加载最新的功能开关配置"""
        try:
            config = ConfigLoader.get_config()
            features = config.get('features') or {}
            if not isinstance(features, dict):
                return {}
            return features
        except Exception as exc:
            logger.debug("加载功能配置失败，使用默认值: %s", exc)
            return {}
    
    def _test_llm_service(self, llm_service) -> bool:
        """测试LLM服务是否可用"""
        try:
            # 使用正确的方法名 complete 而不是 query
            test_response = llm_service.complete(
                prompt="Hi, this is a test. Please respond with 'OK'.",
                max_tokens=10
            )
            return test_response is not None and len(str(test_response)) > 0
        except Exception as e:
            logger.error(f"LLM服务健康检查失败: {e}")
            return False
    
    def _rule_based_classify(self, query: str) -> Dict[str, Any]:
        """基于规则的查询分类（降级方案）"""
        query_lower = query.lower()
        
        # 关键词检测规则
        visualization_keywords = ['图', '图表', '可视化', '绘制', 'plot', 'chart', 'graph', '趋势图', '饼图', '柱状图']
        analysis_keywords = ['分析', '趋势', '预测', '为什么', '原因', '比较', '对比', '评估', '洞察']
        complex_keywords = ['计算', '统计分析', '相关性', '回归', '聚类', '机器学习']
        simple_keywords = ['显示', '查看', '列出', 'show', 'select', '查询', '统计', '数量', '总数']
        chit_chat_keywords = ['你好', '谢谢', '你是谁', '聊聊', '讲个', '故事', '笑话', '天气', '机器人']
        
        # 检测查询类型
        has_visualization = any(keyword in query_lower for keyword in visualization_keywords)
        has_analysis = any(keyword in query_lower for keyword in analysis_keywords)
        has_complex = any(keyword in query_lower for keyword in complex_keywords)
        has_simple = any(keyword in query_lower for keyword in simple_keywords)
        is_chit_chat = any(keyword in query_lower for keyword in chit_chat_keywords)
        
        # 决策逻辑
        if is_chit_chat and not (has_simple or has_analysis or has_visualization):
            return {
                'route': RouteType.QA.value,
                'confidence': 0.55,
                'reason': '疑似闲聊/非数据库问题',
                'method': 'rule_based'
            }
        if has_visualization or has_complex:
            return {
                'route': RouteType.ANALYSIS.value,
                'confidence': 0.8,
                'reason': f'查询包含{"可视化" if has_visualization else "复杂分析"}需求',
                'method': 'rule_based'
            }
        if has_analysis:
            return {
                'route': RouteType.ANALYSIS.value,
                'confidence': 0.7,
                'reason': '查询需要数据分析',
                'method': 'rule_based'
            }
        if has_simple and not has_visualization and not has_analysis:
            return {
                'route': RouteType.ANALYSIS.value,
                'confidence': 0.6,
                'reason': '检测到取数需求，交由分析流程处理',
                'method': 'rule_based'
            }
        # 默认：如果问题以问号结束或明显对话，走QA，否则走分析
        if query.strip().endswith('？') or query.strip().endswith('?'):
            return {
                'route': RouteType.QA.value,
                'confidence': 0.5,
                'reason': '无法识别数据需求，建议先澄清',
                'method': 'rule_based'
            }
        return {
            'route': RouteType.ANALYSIS.value,
            'confidence': 0.5,
            'reason': '默认使用分析路由确保功能完整',
            'method': 'rule_based'
        }
    
    def route(self, query: str, context: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        智能路由查询到最优执行路径
        
        Args:
            query: 用户查询
            context: 查询上下文
            
        Returns:
            执行结果
        """
        start_time = time.time()
        # 每次路由前刷新功能配置，确保前端修改即时生效
        self.feature_flags = self._load_feature_flags()
        feature_flags = self.feature_flags or {}

        # 拷贝上下文，避免修改原始对象
        context = dict(context or {})
        language = context.get('language', 'zh') or 'zh'
        context.setdefault('language', language)
        self.routing_stats["total_queries"] += 1
        
        try:
            # 准备路由上下文
            routing_context = self._prepare_routing_context(context)
            
            # 决定使用哪种分类方法
            if self.llm_available and self.ai_classifier.llm_service:
                # 使用AI进行分类
                logger.debug("使用AI分类器进行路由决策")
                classification = self.ai_classifier.classify(query, routing_context)
                route_type = classification.get('route', RouteType.ANALYSIS.value)
                confidence = classification.get('confidence', 0.5)
                method = classification.get('method', 'ai')
                
                # 如果AI分类置信度太低，使用规则补充
                if confidence < 0.5:
                    logger.info(f"AI分类置信度较低({confidence:.2f})，使用规则路由补充")
                    rule_classification = self._rule_based_classify(query)
                    
                    # 如果规则路由置信度更高，使用规则路由
                    if rule_classification['confidence'] > confidence:
                        classification = rule_classification
                        route_type = classification['route']
                        confidence = classification['confidence']
                        method = 'rule_based_override'
                        self.routing_stats["rule_based_routes"] += 1
            else:
                # LLM不可用，使用基于规则的分类
                logger.info("LLM服务不可用，使用基于规则的路由")
                classification = self._rule_based_classify(query)
                route_type = classification.get('route', RouteType.ANALYSIS.value)
                confidence = classification.get('confidence', 0.5)
                method = classification.get('method', 'rule_based')
                self.routing_stats["rule_based_routes"] += 1
            
            # 兼容历史配置：将 sql_only 统一归入 ANALYSIS
            if isinstance(route_type, str) and route_type.lower() == 'sql_only':
                route_type = RouteType.ANALYSIS.value
                classification['route'] = route_type
            
            # 验证路由类型
            valid_routes = {
                RouteType.QA.value,
                RouteType.ANALYSIS.value,
                RouteType.ABORTED.value
            }
            if route_type not in valid_routes:
                logger.warning(f"路由类型无效({route_type})，使用默认ANALYSIS")
                route_type = RouteType.ANALYSIS.value
                confidence = 0.5
                self.routing_stats["fallback_count"] += 1

            routing_info = {
                'route_type': route_type,
                'confidence': confidence,
                'reason': classification.get('reason'),
                'classification_time': classification.get('classification_time', 0),
                'plan': classification.get('suggested_plan') or [],
                'method': classification.get('method', 'ai')
            }

            # 将计划、步长等写入上下文，供解释器执行时参考
            if routing_info['plan']:
                context['suggested_plan'] = routing_info['plan']

            thought_cfg = feature_flags.get('thought_stream') if isinstance(feature_flags.get('thought_stream'), dict) else {}
            template_key = 'template_en' if language == 'en' else 'template_zh'
            default_template = 'Step {index}: {summary}' if language == 'en' else '步骤{index}：{summary}'
            context.setdefault('step_logging_enabled', thought_cfg.get('enabled', True))
            context.setdefault('step_template', thought_cfg.get(template_key, default_template))
            context.setdefault('step_min_words', thought_cfg.get('min_words', 3))
            context['route_type'] = route_type.upper() if isinstance(route_type, str) else route_type

            # 路由执行前进行数据库健康检查（仅限需要数据库的路线）
            requires_db = route_type == RouteType.ANALYSIS.value
            use_database = context.get('use_database', True) if isinstance(context, dict) else True
            guard_cfg = feature_flags.get('db_guard', {}) if isinstance(feature_flags.get('db_guard', {}), dict) else {}
            auto_check_db = guard_cfg.get('auto_check', True)
            warn_on_failure = guard_cfg.get('warn_on_failure', True)

            if requires_db and use_database and auto_check_db:
                if not self.database_guard:
                    logger.warning("数据库守卫未初始化，跳过连通性检查")
                else:
                    guard_context = dict(context or {})
                    guard_context.setdefault('force_execute', guard_context.get('force_execute'))
                    db_check = self.database_guard.ensure_database_ready(
                        route_type=route_type,
                        context=guard_context,
                        guard_cfg=guard_cfg
                    )
                    if db_check.get('message') == 'force_execute':
                        self.routing_stats["forced_queries"] += 1
                    if not db_check.get('ok'):
                        self.routing_stats["aborted_queries"] += 1
                        logger.error("数据库健康检查未通过，终止执行: %s", db_check.get('message'))
                        response_payload = build_guard_block_payload(
                            db_check,
                            guard_cfg,
                            query=query,
                            warn_on_failure=warn_on_failure,
                            route_type=route_type,
                            classification=classification,
                            routing_info=routing_info,
                            conversation_id=context.get('conversation_id') if context else None,
                            model_name=context.get('model_name') if context else None
                        )
                        return response_payload
            
            # 记录路由决策
            logger.info(f"🔄 路由决策: {route_type} (置信度: {confidence:.2f}, 方法: {method})")
            logger.info(f"   原因: {classification.get('reason', '未提供')}")
            
            # 记录AI分类时间
            self.routing_stats["ai_classification_time"] += classification.get('classification_time', 0)
            
            # 根据路由类型执行
            if route_type == RouteType.ABORTED.value:
                self.routing_stats["aborted_queries"] += 1
                logger.error("路由分类失败，返回兜底响应")
                return {
                    "success": False,
                    "error": "路由分类失败，请稍后重试",
                    "routing_info": routing_info,
                    "query_type": RouteType.ABORTED.value
                }

            if route_type == RouteType.QA.value:
                result = self._execute_qa_response(query, classification, context)
                self.routing_stats["qa_queries"] += 1
            else:  # 统一走 ANALYSIS 流程
                result = self._execute_ai_analysis(query, context, classification)
                self.routing_stats["analysis_queries"] += 1
            
            # 添加路由信息到结果
            result['routing_info'] = routing_info
            result['classification'] = classification
            
            # 计算时间节省（假设完整AI分析需要5秒）
            total_time = time.time() - start_time
            
            return result
            
        except Exception as e:
            logger.error(f"路由执行失败: {e}")
            self.routing_stats["fallback_count"] += 1
            # 失败时降级到AI处理
            return self._execute_ai_analysis(query, context, {})
    
    def _prepare_routing_context(self, context: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """
        准备路由上下文信息
        """
        routing_context = {
            'db_type': 'MySQL/Doris',
            'tables': []
        }
        
        # 获取可用表信息（仅在数据库已配置且未禁用时）
        if (
            self.database_manager
            and getattr(self.database_manager, 'is_configured', False)
            and not getattr(self.database_manager, '_global_disabled', False)
        ):
            try:
                tables = self.database_manager.get_tables()
                routing_context['tables'] = ', '.join(tables[:20])  # 限制数量
            except Exception:
                logger.debug("加载表信息失败，忽略以避免影响路由")
        
        return routing_context
    

    def _execute_qa_response(self, query: str, classification: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """
        输出礼貌的QA响应，引导用户提供数据库相关问题
        """
        logger.info("执行QA路径 - 礼貌拒绝非数据库问题")

        polite_message = (
            "抱歉，我是一名数据库数据助手，目前只能处理与数据库取数或分析相关的问题。"
            "请您描述需要查询的数据或指标，我会尽力帮忙。"
        )

        # 支持自定义提示（后续可从前端设置注入）
        custom_hint = None
        if context and isinstance(context, dict):
            custom_hint = context.get('qa_hint')
        if custom_hint:
            polite_message = custom_hint

        return {
            "success": True,
            "answer": polite_message,
            "messages": [
                {
                    "role": "assistant",
                    "type": "text",
                    "content": polite_message
                }
            ],
            "query_type": "qa",
            "model": "ai_router",
            "classification": classification
            }
    
    def _execute_ai_analysis(self, query: str, context: Dict[str, Any], classification: Dict[str, Any]) -> Dict[str, Any]:
        """
        执行AI分析（统一处理所有AI任务）
        智能判断是否需要可视化、分析等
        """
        # 根据查询内容智能判断任务类型
        query_lower = query.lower()
        task_hints = []
        
        if any(word in query_lower for word in ['图', '图表', '可视化', 'chart', 'graph', 'plot']):
            task_hints.append("visualization")
            logger.info("执行AI分析路径 - 检测到可视化需求")
        elif any(word in query_lower for word in ['分析', '趋势', '预测', 'analyze', 'trend']):
            task_hints.append("analysis")
            logger.info("执行AI分析路径 - 检测到分析需求")
        else:
            logger.info("执行AI分析路径 - 通用AI处理")
        
        # 防御性编程：确保context不为None
        if context is None:
            context = {}
        context['route_type'] = 'ANALYSIS'
        
        if self.interpreter_manager:
            result = self.interpreter_manager.execute_query(
                query=query,
                context=context,
                model_name=context.get('model_name'),
                conversation_id=context.get('conversation_id'),
                language=context.get('language', 'zh')
            )
            result["query_type"] = "ai_analysis"
            return result
        else:
            return {
                "success": False,
                "error": "InterpreterManager未初始化",
                "query_type": "ai_analysis"
        }
    
    def get_routing_stats(self) -> Dict[str, Any]:
        """
        获取路由统计信息
        """
        stats = self.routing_stats.copy()
        
        # 添加AI分类器统计
        ai_stats = self.ai_classifier.get_stats()
        stats['ai_classifier'] = ai_stats
        
        # 计算路由分布（简化版）
        if stats["total_queries"] > 0:
            total = stats["total_queries"]
            stats["route_distribution"] = {
                "qa": (stats["qa_queries"] / total * 100),
                "analysis": (stats["analysis_queries"] / total * 100),
                "aborted": (stats["aborted_queries"] / total * 100)
            }
            
            # 平均AI分类时间
            stats["avg_ai_classification_time"] = (
                stats["ai_classification_time"] / total
            )
            
            # 平均节省时间
            stats["avg_time_saved"] = stats["total_time_saved"] / total
        
        return stats
    
    def _load_routing_prompt(self) -> str:
        """
        从配置文件加载routing prompt
        
        Returns:
            路由prompt字符串，如果加载失败返回None
        """
        try:
            import json
            import os
            config_path = os.path.join(os.path.dirname(__file__), 'prompt_config.json')
            
            if os.path.exists(config_path):
                with open(config_path, 'r', encoding='utf-8') as f:
                    config = json.load(f)
                    return config.get('routing')
        except Exception as e:
            logger.warning(f"加载routing prompt失败: {e}")
        
        return None
    
    def update_routing_prompt(self, new_prompt: str):
        """
        更新路由prompt
        
        Args:
            new_prompt: 新的路由prompt
        """
        self.ai_classifier.update_routing_prompt(new_prompt)
        logger.info("路由prompt已更新")
