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
        
        # 初始化AI分类器
        llm_service = llm_manager.get_service()
        self.ai_classifier = AIRoutingClassifier(llm_service, custom_prompt)
        
        # 初始化SQL执行器
        self.sql_executor = DirectSQLExecutor(database_manager) if database_manager else None
        
        # 路由统计
        self.routing_stats = {
            "total_queries": 0,
            "direct_sql_queries": 0,
            "simple_analysis_queries": 0,
            "complex_analysis_queries": 0,
            "visualization_queries": 0,
            "ai_classification_time": 0,
            "total_time_saved": 0.0,
            "fallback_count": 0
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
            
            # 使用AI进行分类
            classification = self.ai_classifier.classify(query, routing_context)
            route_type = classification.get('route', RouteType.COMPLEX_ANALYSIS.value)
            confidence = classification.get('confidence', 0.5)
            
            logger.info(f"🤖 AI路由决策: {route_type} (置信度: {confidence:.2f})")
            logger.info(f"   原因: {classification.get('reason', '未提供')}")
            
            # 记录AI分类时间
            self.routing_stats["ai_classification_time"] += classification.get('classification_time', 0)
            
            # 根据路由类型执行
            if route_type == RouteType.DIRECT_SQL.value:
                result = self._execute_direct_sql(query, classification, context)
                self.routing_stats["direct_sql_queries"] += 1
                
            elif route_type == RouteType.SIMPLE_ANALYSIS.value:
                result = self._execute_simple_analysis(query, classification, context)
                self.routing_stats["simple_analysis_queries"] += 1
                
            elif route_type == RouteType.VISUALIZATION.value:
                result = self._execute_visualization(query, context)
                self.routing_stats["visualization_queries"] += 1
                
            else:  # COMPLEX_ANALYSIS
                result = self._execute_complex_analysis(query, context)
                self.routing_stats["complex_analysis_queries"] += 1
            
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
            # 失败时降级到完整AI处理
            return self._execute_complex_analysis(query, context)
    
    def _prepare_routing_context(self, context: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """
        准备路由上下文信息
        """
        routing_context = {
            'db_type': 'MySQL/Doris',
            'tables': []
        }
        
        # 获取可用表信息
        if self.database_manager:
            try:
                tables = self.database_manager.get_tables()
                routing_context['tables'] = ', '.join(tables[:20])  # 限制数量
            except:
                pass
        
        return routing_context
    
    def _execute_direct_sql(self, query: str, classification: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """
        执行直接SQL查询
        """
        try:
            # 检查是否有建议的SQL
            suggested_sql = classification.get('suggested_sql')
            
            if suggested_sql and self.sql_executor:
                logger.info(f"执行AI建议的SQL: {suggested_sql[:100]}...")
                result = self.sql_executor.execute(suggested_sql)
                
                if result['success']:
                    return self._format_sql_result(result, query)
            
            # 如果没有SQL或执行失败，降级到简单分析
            logger.info("无法执行直接SQL，降级到简单分析")
            return self._execute_simple_analysis(query, classification, context)
            
        except Exception as e:
            logger.error(f"直接SQL执行失败: {e}")
            return self._execute_complex_analysis(query, context)
    
    def _execute_simple_analysis(self, query: str, classification: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """
        执行简单分析（SQL + 轻量处理）
        """
        logger.info("执行简单分析路径")
        # 暂时降级到复杂分析，后续可以实现优化的简单分析流程
        return self._execute_complex_analysis(query, context)
    
    def _execute_visualization(self, query: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """
        执行可视化查询
        """
        logger.info("执行可视化路径 - 需要生成图表")
        # 直接使用完整AI流程，确保生成图表
        return self._execute_complex_analysis(query, context)
    
    def _execute_complex_analysis(self, query: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """
        执行复杂分析（完整AI流程）
        """
        logger.info("执行复杂分析路径 - 使用完整AI流程")
        
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
            result["query_type"] = "complex_analysis"
            return result
        else:
            return {
                "success": False,
                "error": "InterpreterManager未初始化",
                "query_type": "complex_analysis"
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
        
        # 计算路由分布
        if stats["total_queries"] > 0:
            total = stats["total_queries"]
            stats["route_distribution"] = {
                "direct_sql": (stats["direct_sql_queries"] / total * 100),
                "simple_analysis": (stats["simple_analysis_queries"] / total * 100),
                "complex_analysis": (stats["complex_analysis_queries"] / total * 100),
                "visualization": (stats["visualization_queries"] / total * 100)
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