"""
AI驱动的智能查询路由系统
使用LLM进行查询分类，选择最优执行路径
"""
import logging
import json
import time
import re  # 添加re模块导入，修复运行时NameError
from typing import Dict, Any, Optional, Tuple
from enum import Enum

logger = logging.getLogger(__name__)

class RouteType(Enum):
    """路由类型（简化版：2种路由）"""
    DIRECT_SQL = "direct_sql"        # 直接SQL执行（简单查询）
    AI_ANALYSIS = "ai_analysis"      # AI处理（包括分析、可视化等所有复杂任务）

class AIRoutingClassifier:
    """
    AI路由分类器
    使用LLM判断查询类型并选择最优路径
    """
    
    # 默认路由分类Prompt（简化版）
    DEFAULT_ROUTING_PROMPT = """你是一个查询路由分类器。分析用户查询，选择最适合的执行路径。

用户查询：{query}

数据库信息：
- 类型：{db_type}
- 可用表：{available_tables}

请从以下2个选项中选择最合适的路由：

1. DIRECT_SQL - 简单查询，可以直接转换为SQL执行
   适用：查看数据、统计数量、简单筛选、排序、基础聚合
   示例：显示所有订单、统计用户数量、查看最新记录、按月统计销售额
   特征：不需要复杂计算、不需要图表、不需要多步处理

2. AI_ANALYSIS - 需要AI智能处理的查询
   适用：数据分析、生成图表、趋势预测、复杂计算、多步处理
   示例：分析销售趋势、生成可视化图表、预测分析、原因探索
   特征：需要可视化、需要推理、需要编程逻辑、复杂数据处理

输出格式（JSON）：
{
  "route": "DIRECT_SQL 或 AI_ANALYSIS",
  "confidence": 0.95,
  "reason": "选择此路由的原因",
  "suggested_sql": "如果是DIRECT_SQL，提供建议的SQL语句"
}

判断规则：
- 如果查询包含"图"、"图表"、"可视化"、"绘制"、"plot"、"chart"等词 → 选择 AI_ANALYSIS
- 如果查询包含"分析"、"趋势"、"预测"、"为什么"、"原因"等词 → 选择 AI_ANALYSIS  
- 如果只是简单的数据查询、统计、筛选 → 选择 DIRECT_SQL
- 当不确定时，倾向选择 AI_ANALYSIS 以确保功能完整"""
    
    def __init__(self, llm_service=None, custom_prompt=None):
        """
        初始化AI路由分类器
        
        Args:
            llm_service: LLM服务实例
            custom_prompt: 自定义路由prompt
        """
        self.llm_service = llm_service
        self.routing_prompt = custom_prompt or self.DEFAULT_ROUTING_PROMPT
        
        # 分类统计（简化版）
        self.stats = {
            "total_classifications": 0,
            "route_counts": {
                RouteType.DIRECT_SQL.value: 0,
                RouteType.AI_ANALYSIS.value: 0
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
            route_type = result.get('route', RouteType.AI_ANALYSIS.value)
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
            
            # 更新token统计（response是字典，不是对象）
            if isinstance(response, dict) and 'usage' in response:
                usage = response['usage']
                if isinstance(usage, dict):
                    self.stats["total_tokens_used"] += usage.get('total_tokens', 0)
            
            return response.get('content', '')
        except Exception as e:
            logger.error(f"LLM调用失败: {e}")
            raise
    
    def _parse_llm_response(self, response: str) -> Dict[str, Any]:
        """
        解析LLM响应（增强错误处理）
        """
        try:
            # 清理响应字符串
            response = response.strip()
            
            # 处理可能的不完整JSON响应
            if response.startswith('{') and not response.endswith('}'):
                # 尝试补全不完整的JSON
                logger.warning(f"检测到不完整的JSON响应，尝试补全: {response[:100]}...")
                # 计算需要的闭合括号
                open_braces = response.count('{') - response.count('}')
                response += '}' * open_braces
            
            # 尝试解析JSON响应
            if '{' in response and '}' in response:
                # 提取JSON部分
                json_start = response.find('{')
                json_end = response.rfind('}') + 1
                json_str = response[json_start:json_end]
                
                # 清理可能的转义字符和换行
                json_str = json_str.replace('\n', ' ').replace('\r', '').strip()
                
                # 尝试修复常见的JSON错误
                # 处理可能的尾随逗号
                json_str = re.sub(r',\s*}', '}', json_str)
                json_str = re.sub(r',\s*]', ']', json_str)
                
                try:
                    result = json.loads(json_str)
                except json.JSONDecodeError as je:
                    logger.warning(f"JSON解析失败，尝试修复: {je}")
                    # 尝试使用更宽松的解析
                    import ast
                    try:
                        # 将单引号转换为双引号
                        json_str = json_str.replace("'", '"')
                        result = json.loads(json_str)
                    except:
                        # 如果还是失败，返回降级路由
                        logger.error(f"无法解析JSON: {json_str[:200]}")
                        return self._get_fallback_route("")
                
                # 验证必需字段
                if 'route' not in result:
                    # 尝试从响应文本中提取路由类型
                    if 'DIRECT_SQL' in response:
                        result['route'] = 'DIRECT_SQL'
                    elif 'AI_ANALYSIS' in response:
                        result['route'] = 'AI_ANALYSIS'
                    else:
                        raise ValueError("响应中缺少route字段")
                
                # 规范化路由类型（简化版）
                route_map = {
                    'DIRECT_SQL': RouteType.DIRECT_SQL.value,
                    'AI_ANALYSIS': RouteType.AI_ANALYSIS.value,
                    'direct_sql': RouteType.DIRECT_SQL.value,
                    'ai_analysis': RouteType.AI_ANALYSIS.value,
                    # 兼容旧的路由类型
                    'SIMPLE_ANALYSIS': RouteType.AI_ANALYSIS.value,
                    'COMPLEX_ANALYSIS': RouteType.AI_ANALYSIS.value,
                    'VISUALIZATION': RouteType.AI_ANALYSIS.value,
                }
                
                result['route'] = route_map.get(result['route'], RouteType.AI_ANALYSIS.value)
                result['confidence'] = float(result.get('confidence', 0.8))
                
                # 确保有reason字段
                if 'reason' not in result:
                    result['reason'] = '基于查询内容判断'
                
                return result
            else:
                # 如果不是JSON格式，尝试解析文本响应
                return self._parse_text_response(response)
                
        except Exception as e:
            logger.error(f"解析LLM响应失败: {e}, 响应: {response[:200]}")
            return self._get_fallback_route("")
    
    def _parse_text_response(self, response: str) -> Dict[str, Any]:
        """
        解析文本格式的响应 - 简化版（2种路由）
        """
        import re
        response_lower = response.lower()
        
        # 定义简化的匹配模式
        patterns = {
            RouteType.DIRECT_SQL.value: [
                r'\bdirect_sql\b', 
                r'^1\b',
                r'^\s*1\s*\.', 
                r'选择.*direct.*sql',
                r'路由.*1\b',
                r'简单查询',
                r'直接.*sql'
            ],
            RouteType.AI_ANALYSIS.value: [
                r'\bai_analysis\b',
                r'^2\b',
                r'^\s*2\s*\.',
                r'选择.*ai.*analysis',
                r'路由.*2\b',
                # 兼容旧的路由类型
                r'\bsimple_analysis\b',
                r'\bcomplex_analysis\b',
                r'\bvisualization\b',
                r'需要.*分析',
                r'需要.*可视化',
                r'生成.*图表'
            ]
        }
        
        # 计算每个路由类型的匹配分数
        scores = {}
        for route_type, route_patterns in patterns.items():
            score = 0
            for pattern in route_patterns:
                if re.search(pattern, response_lower):
                    score += 1
            scores[route_type] = score
        
        # 选择得分最高的路由
        if scores:
            best_route = max(scores, key=scores.get)
            max_score = scores[best_route]
            
            if max_score > 0:
                # 根据匹配数量计算置信度
                confidence = min(0.5 + max_score * 0.15, 0.95)
                return {
                    'route': best_route,
                    'confidence': confidence,
                    'reason': f'文本匹配分析（匹配度: {max_score}）'
                }
        
        # 默认返回AI分析路由
        return {
            'route': RouteType.AI_ANALYSIS.value,
            'confidence': 0.5,
            'reason': '无法确定路由类型，使用默认AI分析'
        }
    
    def _get_default_route(self, query: str) -> Dict[str, Any]:
        """
        获取默认路由（当LLM不可用时） - 简化版
        """
        query_lower = query.lower()
        
        # 简单的关键词匹配作为后备方案
        # 检查是否需要AI处理的关键词
        ai_keywords = ['图', '图表', '可视化', 'chart', 'graph', 'plot', 
                      '分析', '趋势', '预测', '为什么', '原因', 'analyze']
        
        # 检查是否是简单SQL查询的关键词
        sql_keywords = ['select', 'show', '显示', '查看', '列出', '统计', '数量']
        
        if any(word in query_lower for word in ai_keywords):
            return {
                'route': RouteType.AI_ANALYSIS.value,
                'confidence': 0.6,
                'reason': '检测到分析/可视化关键词（规则匹配）'
            }
        elif any(word in query_lower for word in sql_keywords) and \
             not any(word in query_lower for word in ai_keywords):
            return {
                'route': RouteType.DIRECT_SQL.value,
                'confidence': 0.5,
                'reason': '可能是简单查询（规则匹配）'
            }
        else:
            return {
                'route': RouteType.AI_ANALYSIS.value,
                'confidence': 0.4,
                'reason': '默认使用AI分析（无LLM服务）'
            }
    
    def _get_fallback_route(self, query: str) -> Dict[str, Any]:
        """
        获取失败时的后备路由 - 简化版
        """
        return {
            'route': RouteType.AI_ANALYSIS.value,
            'confidence': 0.3,
            'reason': '分类失败，使用最安全的AI分析路由',
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