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
    """路由类型（可扩展）"""
    QA = "qa"                    # 礼貌拒绝/问答
    SQL_ONLY = "sql_only"        # 快速SQL核查
    ANALYSIS = "analysis"        # 深度分析
    ABORTED = "aborted"          # 兜底终止

class AIRoutingClassifier:
    """
    AI路由分类器
    使用LLM判断查询类型并选择最优路径
    """
    
    # 默认路由分类Prompt
    DEFAULT_ROUTING_PROMPT = """你是一个查询路由分类器。分析用户查询，选择最适合的执行路径，并仅输出规范 JSON。

用户查询：{query}

数据库信息：
- 类型：{db_type}
- 可用表：{available_tables}

请从以下路由中选择其一：

1. QA
   - 适用：闲聊、非数据库问题、缺乏业务上下文的提问
   - 输出：礼貌拒绝或引导用户描述数据库相关需求
   - 不执行 SQL/代码

2. SQL_ONLY
   - 适用：明确的取数需求（聚合、筛选、排序）
   - 要求：生成 SQL，按步骤验证结果，可进行必要的库表探索
   - 不绘图、不安装额外库

3. ANALYSIS
   - 适用：复杂分析、可视化、趋势研判、需要 Python 脚本的任务
   - 允许：执行 Python、生成图表，必要时经用户确认安装库

如判断输入与数据库无关，应选择 QA。
如请求不完整但可能需要数据，倾向 SQL_ONLY 并在 reason 中指出缺失信息。

输出 JSON（仅此内容）：
{
  "route": "QA | SQL_ONLY | ANALYSIS",
  "confidence": 0.0-1.0,
  "reason": "简要说明判断依据",
  "suggested_plan": ["步骤1", "步骤2"],
  "suggested_sql": "如为 SQL_ONLY，可给出建议 SQL"
}

若无法判定，请将 route 设置为 "ANALYSIS" 并说明原因。"""
    
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
                RouteType.QA.value: 0,
                RouteType.SQL_ONLY.value: 0,
                RouteType.ANALYSIS.value: 0,
                RouteType.ABORTED.value: 0
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
            route_type = result.get('route', RouteType.ANALYSIS.value)
            if route_type not in self.stats["route_counts"]:
                self.stats["route_counts"][route_type] = 0
            self.stats["route_counts"][route_type] += 1
            
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
                    if 'SQL_ONLY' in response:
                        result['route'] = 'SQL_ONLY'
                    elif 'ANALYSIS' in response:
                        result['route'] = 'ANALYSIS'
                    elif 'QA' in response:
                        result['route'] = 'QA'
                    else:
                        raise ValueError("响应中缺少route字段")
                
                # 规范化路由类型
                route_map = {
                    'QA': RouteType.QA.value,
                    'qa': RouteType.QA.value,
                    'SQL_ONLY': RouteType.SQL_ONLY.value,
                    'sql_only': RouteType.SQL_ONLY.value,
                    'DIRECT_SQL': RouteType.SQL_ONLY.value,
                    'direct_sql': RouteType.SQL_ONLY.value,
                    'ANALYSIS': RouteType.ANALYSIS.value,
                    'analysis': RouteType.ANALYSIS.value,
                    'AI_ANALYSIS': RouteType.ANALYSIS.value,
                    'ai_analysis': RouteType.ANALYSIS.value,
                    # 兼容历史命名
                    'SIMPLE_ANALYSIS': RouteType.ANALYSIS.value,
                    'COMPLEX_ANALYSIS': RouteType.ANALYSIS.value,
                    'VISUALIZATION': RouteType.ANALYSIS.value,
                    'ABORTED': RouteType.ABORTED.value,
                    'aborted': RouteType.ABORTED.value
                }
                
                result['route'] = route_map.get(result['route'], RouteType.ANALYSIS.value)
                result['confidence'] = float(result.get('confidence', 0.8))
                
                # 确保有reason字段
                if 'reason' not in result:
                    result['reason'] = '基于查询内容判断'

                # 规范化建议计划
                suggested_plan = result.get('suggested_plan')
                if suggested_plan is None:
                    result['suggested_plan'] = []
                elif isinstance(suggested_plan, str):
                    result['suggested_plan'] = [s.strip() for s in suggested_plan.split('\n') if s.strip()]

                if 'suggested_sql' not in result:
                    result['suggested_sql'] = ''
                
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
            RouteType.QA.value: [
                r'\bqa\b',
                r'\b拒绝\b',
                r'与数据库无关',
                r'仅提供礼貌回复',
                r'无法回答',
                r'仅能提供引导'
            ],
            RouteType.SQL_ONLY.value: [
                r'\bsql_only\b',
                r'\bdirect_sql\b',
                r'快速.*查询',
                r'仅执行sql',
                r'不.*图表',
                r'一步步.*sql',
                r'route.*sql'
            ],
            RouteType.ANALYSIS.value: [
                r'\banalysis\b',
                r'\bai_analysis\b',
                r'需要.*分析',
                r'需要.*可视化',
                r'生成.*图表',
                r'多步.*处理',
                r'复杂.*任务'
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
        
        # 默认返回分析路由
        return {
            'route': RouteType.ANALYSIS.value,
            'confidence': 0.5,
            'reason': '无法确定路由类型，使用默认AI分析'
        }
    
    def _get_default_route(self, query: str) -> Dict[str, Any]:
        """
        获取默认路由（当LLM不可用时） - 简化版
        """
        query_lower = query.lower()
        
        ai_keywords = ['图', '图表', '可视化', 'chart', 'graph', 'plot', 
                      '分析', '趋势', '预测', '为什么', '原因', 'analyze', '对比', '可视化']
        sql_keywords = ['select', 'show', '显示', '查看', '列出', '统计', '数量', 'sum', 'avg']
        chit_chat_keywords = ['聊', '故事', '笑话', '天气', '股票怎么看', '你是谁', '你好', '谢谢']

        if any(word in query_lower for word in chit_chat_keywords):
            return {
                'route': RouteType.QA.value,
                'confidence': 0.55,
                'reason': '疑似闲聊/非数据库问题'
            }
        if any(word in query_lower for word in ai_keywords):
            return {
                'route': RouteType.ANALYSIS.value,
                'confidence': 0.6,
                'reason': '检测到分析/可视化关键词（规则匹配）'
            }
        if any(word in query_lower for word in sql_keywords):
            return {
                'route': RouteType.SQL_ONLY.value,
                'confidence': 0.5,
                'reason': '可能是取数请求（规则匹配）'
            }
        return {
            'route': RouteType.ANALYSIS.value,
            'confidence': 0.4,
            'reason': '默认使用分析路由（无LLM服务）'
        }
    
    def _get_fallback_route(self, query: str) -> Dict[str, Any]:
        """
        获取失败时的后备路由 - 简化版
        """
        return {
            'route': RouteType.ABORTED.value,
            'confidence': 0.0,
            'reason': '分类失败，已回退至兜底路由',
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