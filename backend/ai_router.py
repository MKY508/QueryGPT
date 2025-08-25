"""
AI驱动的智能查询路由系统
使用LLM进行查询分类，选择最优执行路径
"""
import logging
import json
import time
from typing import Dict, Any, Optional, Tuple
from enum import Enum

logger = logging.getLogger(__name__)

class RouteType(Enum):
    """路由类型"""
    DIRECT_SQL = "direct_sql"        # 直接SQL执行
    SIMPLE_ANALYSIS = "simple_analysis"  # 简单分析（SQL+轻处理）  
    COMPLEX_ANALYSIS = "complex_analysis"  # 复杂分析（完整AI）
    VISUALIZATION = "visualization"    # 需要生成图表

class AIRoutingClassifier:
    """
    AI路由分类器
    使用LLM判断查询类型并选择最优路径
    """
    
    # 默认路由分类Prompt
    DEFAULT_ROUTING_PROMPT = """你是一个查询路由分类器。分析用户查询，选择最适合的执行路径。

用户查询：{query}

数据库信息：
- 类型：{db_type}
- 可用表：{available_tables}

请从以下选项中选择最合适的路由：

1. DIRECT_SQL - 简单查询，可以直接转换为SQL执行
   适用：查看数据、统计数量、简单筛选、排序
   示例：显示所有订单、统计用户数量、查看最新记录

2. SIMPLE_ANALYSIS - 需要SQL查询+简单数据处理
   适用：分组统计、简单计算、数据汇总
   示例：按月统计销售额、计算平均值、对比不同类别

3. COMPLEX_ANALYSIS - 需要复杂分析或多步处理
   适用：趋势分析、预测、复杂计算、需要编程逻辑
   示例：分析销售趋势、预测未来销量、相关性分析

4. VISUALIZATION - 需要生成图表或可视化
   适用：任何明确要求图表、图形、可视化的查询
   示例：生成销售图表、绘制趋势图、创建饼图

输出格式（JSON）：
{
  "route": "选择的路由类型",
  "confidence": 0.95,
  "reason": "选择此路由的原因",
  "suggested_sql": "如果是DIRECT_SQL，提供建议的SQL语句"
}

重要：
- 只要用户提到"图"、"图表"、"可视化"、"绘制"等词，必须选择 VISUALIZATION
- 如果查询包含"为什么"、"原因"、"预测"等需要推理的词，选择 COMPLEX_ANALYSIS
- 尽可能选择简单的路由以提高性能"""
    
    def __init__(self, llm_service=None, custom_prompt=None):
        """
        初始化AI路由分类器
        
        Args:
            llm_service: LLM服务实例
            custom_prompt: 自定义路由prompt
        """
        self.llm_service = llm_service
        self.routing_prompt = custom_prompt or self.DEFAULT_ROUTING_PROMPT
        
        # 分类统计
        self.stats = {
            "total_classifications": 0,
            "route_counts": {
                RouteType.DIRECT_SQL.value: 0,
                RouteType.SIMPLE_ANALYSIS.value: 0,
                RouteType.COMPLEX_ANALYSIS.value: 0,
                RouteType.VISUALIZATION.value: 0
            },
            "avg_classification_time": 0,
            "total_tokens_used": 0
        }
    
    def classify(self, query: str, context: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        使用AI对查询进行分类
        
        Args:
            query: 用户查询
            context: 上下文信息（如数据库信息）
            
        Returns:
            分类结果字典
        """
        start_time = time.time()
        self.stats["total_classifications"] += 1
        
        try:
            # 准备上下文信息
            db_type = context.get('db_type', 'MySQL') if context else 'MySQL'
            available_tables = context.get('tables', '未知') if context else '未知'
            
            # 构建prompt
            prompt = self.routing_prompt.format(
                query=query,
                db_type=db_type,
                available_tables=available_tables[:500]  # 限制表信息长度
            )
            
            # 调用LLM进行分类
            if self.llm_service:
                response = self._call_llm(prompt)
                result = self._parse_llm_response(response)
            else:
                # 如果没有LLM服务，返回默认路由
                logger.warning("LLM服务未初始化，使用默认路由")
                result = self._get_default_route(query)
            
            # 更新统计
            route_type = result.get('route', RouteType.COMPLEX_ANALYSIS.value)
            self.stats["route_counts"][route_type] = self.stats["route_counts"].get(route_type, 0) + 1
            
            # 计算平均分类时间
            classification_time = time.time() - start_time
            total_count = self.stats["total_classifications"]
            self.stats["avg_classification_time"] = (
                (self.stats["avg_classification_time"] * (total_count - 1) + classification_time) / total_count
            )
            
            result['classification_time'] = classification_time
            logger.info(f"AI路由分类完成: {route_type} (耗时: {classification_time:.2f}s)")
            
            return result
            
        except Exception as e:
            logger.error(f"AI路由分类失败: {e}")
            # 失败时返回最安全的路由
            return self._get_fallback_route(query)
    
    def _call_llm(self, prompt: str) -> str:
        """
        调用LLM服务
        """
        if not self.llm_service:
            raise ValueError("LLM服务未初始化")
        
        # 这里需要根据实际的LLM服务接口调整
        # 示例代码，需要替换为实际调用
        try:
            # 使用较低的temperature以获得更稳定的分类结果
            response = self.llm_service.complete(
                prompt=prompt,
                temperature=0.1,
                max_tokens=200
            )
            
            # 更新token统计
            if hasattr(response, 'usage'):
                self.stats["total_tokens_used"] += response.usage.get('total_tokens', 0)
            
            return response.get('content', '')
        except Exception as e:
            logger.error(f"LLM调用失败: {e}")
            raise
    
    def _parse_llm_response(self, response: str) -> Dict[str, Any]:
        """
        解析LLM响应
        """
        try:
            # 尝试解析JSON响应
            if '{' in response and '}' in response:
                # 提取JSON部分
                json_start = response.find('{')
                json_end = response.rfind('}') + 1
                json_str = response[json_start:json_end]
                result = json.loads(json_str)
                
                # 验证必需字段
                if 'route' not in result:
                    raise ValueError("响应中缺少route字段")
                
                # 规范化路由类型
                route_map = {
                    'DIRECT_SQL': RouteType.DIRECT_SQL.value,
                    'SIMPLE_ANALYSIS': RouteType.SIMPLE_ANALYSIS.value,
                    'COMPLEX_ANALYSIS': RouteType.COMPLEX_ANALYSIS.value,
                    'VISUALIZATION': RouteType.VISUALIZATION.value,
                }
                
                result['route'] = route_map.get(result['route'], RouteType.COMPLEX_ANALYSIS.value)
                result['confidence'] = float(result.get('confidence', 0.8))
                
                return result
            else:
                # 如果不是JSON格式，尝试解析文本响应
                return self._parse_text_response(response)
                
        except Exception as e:
            logger.error(f"解析LLM响应失败: {e}, 响应: {response[:200]}")
            return self._get_fallback_route("")
    
    def _parse_text_response(self, response: str) -> Dict[str, Any]:
        """
        解析文本格式的响应
        """
        response_lower = response.lower()
        
        if 'direct_sql' in response_lower or '1' in response:
            return {
                'route': RouteType.DIRECT_SQL.value,
                'confidence': 0.7,
                'reason': '检测到简单查询'
            }
        elif 'simple_analysis' in response_lower or '2' in response:
            return {
                'route': RouteType.SIMPLE_ANALYSIS.value,
                'confidence': 0.7,
                'reason': '检测到简单分析需求'
            }
        elif 'visualization' in response_lower or '4' in response:
            return {
                'route': RouteType.VISUALIZATION.value,
                'confidence': 0.7,
                'reason': '检测到可视化需求'
            }
        else:
            return {
                'route': RouteType.COMPLEX_ANALYSIS.value,
                'confidence': 0.6,
                'reason': '默认使用复杂分析'
            }
    
    def _get_default_route(self, query: str) -> Dict[str, Any]:
        """
        获取默认路由（当LLM不可用时）
        """
        query_lower = query.lower()
        
        # 简单的关键词匹配作为后备方案
        if any(word in query_lower for word in ['图', '图表', '可视化', 'chart', 'graph', 'plot']):
            return {
                'route': RouteType.VISUALIZATION.value,
                'confidence': 0.6,
                'reason': '检测到可视化关键词（规则匹配）'
            }
        elif any(word in query_lower for word in ['select', 'show', '显示', '查看', '列出']):
            return {
                'route': RouteType.DIRECT_SQL.value,
                'confidence': 0.5,
                'reason': '可能是简单查询（规则匹配）'
            }
        else:
            return {
                'route': RouteType.COMPLEX_ANALYSIS.value,
                'confidence': 0.4,
                'reason': '默认路由（无LLM服务）'
            }
    
    def _get_fallback_route(self, query: str) -> Dict[str, Any]:
        """
        获取失败时的后备路由
        """
        return {
            'route': RouteType.COMPLEX_ANALYSIS.value,
            'confidence': 0.3,
            'reason': '分类失败，使用最安全的路由',
            'error': True
        }
    
    def get_stats(self) -> Dict[str, Any]:
        """
        获取分类统计
        """
        stats = self.stats.copy()
        if stats["total_classifications"] > 0:
            # 计算路由分布百分比
            total = stats["total_classifications"]
            stats["route_distribution"] = {
                route: (count / total * 100) 
                for route, count in stats["route_counts"].items()
            }
            
            # 计算平均token消耗
            stats["avg_tokens_per_classification"] = (
                stats["total_tokens_used"] / total
            )
        
        return stats
    
    def update_routing_prompt(self, new_prompt: str):
        """
        更新路由prompt
        
        Args:
            new_prompt: 新的路由prompt模板
        """
        self.routing_prompt = new_prompt
        logger.info("路由prompt已更新")