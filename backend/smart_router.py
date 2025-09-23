from backend.config_loader import ConfigLoader
"""
AI驱动的智能查询路由系统
完全使用AI进行查询分类和路由决策
"""
import logging
import time
from typing import Dict, Any, Optional
from backend.ai_router import AIRoutingClassifier, RouteType
from backend.llm_service import llm_manager
from backend.sql_executor import DirectSQLExecutor
from backend.config_loader import ConfigLoader

logger = logging.getLogger(__name__)

class SmartRouter:
    """
    智能路由器
    使用AI判断查询类型并选择最优执行路径
    """
    
    def __init__(self, database_manager=None, interpreter_manager=None):
        """
        初始化智能路由器
        
        Args:
            database_manager: 数据库管理器
            interpreter_manager: OpenInterpreter管理器
        """
        self.database_manager = database_manager
        self.interpreter_manager = interpreter_manager
        
        # 加载保存的routing prompt
        custom_prompt = self._load_routing_prompt()

        # 读取特性开关，避免缺省配置触发异常
        try:
            self.feature_flags = ConfigLoader.get_config().get('features', {})
        except Exception:
            self.feature_flags = {}
        
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
        
        # 初始化SQL执行器
        self.sql_executor = DirectSQLExecutor(database_manager) if database_manager else None
        
        # 路由统计（简化版）
        self.routing_stats = {
            "total_queries": 0,
            "direct_sql_queries": 0,
            "ai_analysis_queries": 0,
            "ai_classification_time": 0,
            "total_time_saved": 0.0,
            "fallback_count": 0,
            "rule_based_routes": 0
        }
    
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
        
        # 检测查询类型
        has_visualization = any(keyword in query_lower for keyword in visualization_keywords)
        has_analysis = any(keyword in query_lower for keyword in analysis_keywords)
        has_complex = any(keyword in query_lower for keyword in complex_keywords)
        has_simple = any(keyword in query_lower for keyword in simple_keywords)
        
        # 决策逻辑
        if has_visualization or has_complex:
            return {
                'route': RouteType.AI_ANALYSIS.value,
                'confidence': 0.8,
                'reason': f'查询包含{"可视化" if has_visualization else "复杂分析"}需求',
                'method': 'rule_based'
            }
        elif has_analysis:
            return {
                'route': RouteType.AI_ANALYSIS.value,
                'confidence': 0.7,
                'reason': '查询需要数据分析',
                'method': 'rule_based'
            }
        elif has_simple and not has_visualization and not has_analysis:
            return {
                'route': RouteType.DIRECT_SQL.value,
                'confidence': 0.6,
                'reason': '简单数据查询',
                'method': 'rule_based'
            }
        else:
            # 默认使用AI分析以确保功能完整
            return {
                'route': RouteType.AI_ANALYSIS.value,
                'confidence': 0.5,
                'reason': '无法确定查询类型，使用AI确保功能完整',
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
        self.routing_stats["total_queries"] += 1
        
        try:
            # 准备路由上下文
            routing_context = self._prepare_routing_context(context)
            
            # 决定使用哪种分类方法
            if self.llm_available and self.ai_classifier.llm_service:
                # 使用AI进行分类
                logger.debug("使用AI分类器进行路由决策")
                classification = self.ai_classifier.classify(query, routing_context)
                route_type = classification.get('route', RouteType.AI_ANALYSIS.value)
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
                route_type = classification.get('route', RouteType.AI_ANALYSIS.value)
                confidence = classification.get('confidence', 0.5)
                method = classification.get('method', 'rule_based')
                self.routing_stats["rule_based_routes"] += 1
            
            # 验证路由类型
            if route_type not in [RouteType.DIRECT_SQL.value, RouteType.AI_ANALYSIS.value]:
                logger.warning(f"路由类型无效({route_type})，使用默认AI_ANALYSIS")
                route_type = RouteType.AI_ANALYSIS.value
                confidence = 0.5
                self.routing_stats["fallback_count"] += 1
            
            # 记录路由决策
            logger.info(f"🔄 路由决策: {route_type} (置信度: {confidence:.2f}, 方法: {method})")
            logger.info(f"   原因: {classification.get('reason', '未提供')}")
            
            # 记录AI分类时间
            self.routing_stats["ai_classification_time"] += classification.get('classification_time', 0)
            
            # 根据路由类型执行（简化版：2种路由）
            if route_type == RouteType.DIRECT_SQL.value:
                result = self._execute_direct_sql(query, classification, context)
                self.routing_stats["direct_sql_queries"] += 1
            else:  # AI_ANALYSIS - 统一处理所有AI任务
                result = self._execute_ai_analysis(query, context, classification)
                self.routing_stats["ai_analysis_queries"] += 1
            
            # 添加路由信息到结果
            result['routing_info'] = {
                'route_type': route_type,
                'confidence': confidence,
                'reason': classification.get('reason'),
                'classification_time': classification.get('classification_time', 0)
            }
            
            # 计算时间节省（假设完整AI分析需要5秒）
            total_time = time.time() - start_time
            if route_type == RouteType.DIRECT_SQL.value:
                time_saved = max(0, 5.0 - total_time)
                self.routing_stats["total_time_saved"] += time_saved
            
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
            and not getattr(self.database_manager.__class__, 'GLOBAL_DISABLED', False)
        ):
            try:
                tables = self.database_manager.get_tables()
                routing_context['tables'] = ', '.join(tables[:20])  # 限制数量
            except Exception:
                logger.debug("加载表信息失败，忽略以避免影响路由")
        
        return routing_context
    
    def _execute_direct_sql(self, query: str, classification: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """
        执行直接SQL查询 - 通过OpenInterpreter但限制其功能
        """
        logger.info("执行DIRECT_SQL路径 - 限制OpenInterpreter只执行SQL查询")
        
        # 为context添加路由类型标记，让interpreter_manager知道这是简单查询
        if context is None:
            context = {}
        
        # 标记这是DIRECT_SQL路由，需要限制性prompt
        context['route_type'] = 'DIRECT_SQL'
        context['restrict_visualization'] = True  # 禁止生成图表
        context['suggested_sql'] = classification.get('suggested_sql', '')
        
        # 优先走确定性的 DirectSQLExecutor，避免LLM生成非只读SQL
        if self.sql_executor:
            try:
                suggested_sql = classification.get('suggested_sql') or ''
                sql = suggested_sql.strip()
                if not sql:
                    # 简单的自然语言转SQL（规则模板）
                    try:
                        from backend.sql_executor import NaturalLanguageToSQL
                        converter = NaturalLanguageToSQL()
                        sql = converter.convert(query) or ''
                    except Exception:
                        sql = ''
                if sql:
                    exec_res = self.sql_executor.execute(sql)
                    if exec_res.get('success'):
                        # 格式化为统一的聊天结果结构（文本描述 + 可选表格摘要）
                        formatted = self._format_sql_result(exec_res, sql)
                        formatted["routing_info"] = {
                            "route_type": "DIRECT_SQL",
                            "confidence": classification.get('confidence', 0),
                            "reason": classification.get('reason', '简单SQL查询')
                        }
                        return formatted
            except Exception as _e:
                logger.warning(f"DirectSQLExecutor 执行失败，回退到解释器: {_e}")

        # 回退：调用 interpreter_manager 执行（限制性 prompt）
        if self.interpreter_manager:
            result = self.interpreter_manager.execute_query(
                query=query,
                context=context,
                model_name=context.get('model_name'),
                conversation_id=context.get('conversation_id'),
                language=context.get('language', 'zh')
            )
            result["query_type"] = "direct_sql"
            result["routing_info"] = {
                "route_type": "DIRECT_SQL",
                "confidence": classification.get('confidence', 0),
                "reason": classification.get('reason', '简单SQL查询')
            }
            return result
        else:
            logger.error("interpreter_manager未初始化")
            return {
                "success": False,
                "error": "系统未正确初始化",
                "query_type": "direct_sql"
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
    
    def _format_sql_result(self, exec_result: Dict[str, Any], query: str) -> Dict[str, Any]:
        """
        格式化SQL执行结果
        """
        if not exec_result.get('success'):
            return {
                "success": False,
                "error": exec_result.get('error', '执行失败')
            }
        
        data_info = exec_result.get('data', {})
        
        # 构建响应
        response_content = []
        
        # 添加执行成功消息
        response_content.append({
            "type": "text",
            "content": f"✅ 查询执行成功\n{data_info.get('description', '')}"
        })
        
        # 如果有数据，添加数据展示
        if data_info.get('type') == 'table' and data_info.get('data'):
            import pandas as pd
            df = pd.DataFrame(data_info['data'])
            
            # 限制显示行数
            if len(df) > 20:
                display_df = df.head(20)
                response_content.append({
                    "type": "text",
                    "content": f"显示前20行（共{len(df)}行）：\n{display_df.to_string(index=False)}"
                })
            else:
                response_content.append({
                    "type": "text",
                    "content": f"查询结果：\n{df.to_string(index=False)}"
                })
        
        return {
            "success": True,
            "result": {
                "content": response_content
            },
            "query_type": "direct_sql",
            "execution_time": exec_result.get('execution_time', 0),
            "sql": exec_result.get('sql'),
            "model": "ai_router"
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
                "direct_sql": (stats["direct_sql_queries"] / total * 100),
                "ai_analysis": (stats["ai_analysis_queries"] / total * 100)
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
