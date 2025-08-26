"""
查询澄清模块 - 识别含糊查询并给出建议
避免生硬的错误提示
"""
import re
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta


class QueryClarifier:
    """查询澄清器 - 识别含糊查询并给出建议"""
    
    def __init__(self):
        """初始化澄清器"""
        self.current_year = datetime.now().year
        self.current_month = datetime.now().month
    
    def analyze_query(self, query: str) -> Tuple[bool, Optional[str]]:
        """
        分析查询是否含糊不清
        
        Args:
            query: 用户查询
            
        Returns:
            (是否需要澄清, 澄清建议)
        """
        query_lower = query.lower()
        
        # 检查各种含糊情况
        clarification = (
            self._check_time_ambiguity(query_lower) or
            self._check_metric_ambiguity(query_lower) or
            self._check_scope_ambiguity(query_lower) or
            self._check_comparison_ambiguity(query_lower)
        )
        
        return (bool(clarification), clarification)
    
    def _check_time_ambiguity(self, query: str) -> Optional[str]:
        """检查时间范围是否含糊"""
        time_keywords = ["销售", "采购", "库存", "营收", "数据", "统计", "分析"]
        
        # 检查是否提到了时间相关词但没有具体时间
        has_business_term = any(kw in query for kw in time_keywords)
        
        if has_business_term:
            # 检查是否有明确的时间
            time_patterns = [
                r'\d{4}\s*年',  # 2024年 或 2024 年
                r'\d{1,2}\s*月',  # 7月 或 7 月
                r'\d{1,2}[-–—]\d{1,2}\s*月',  # 1-7月、1–7月
                r'本月|上月|本年|去年|今年',
                r'第[一二三四]季度',
                r'[0-9]{4}-[0-9]{2}',  # 2024-07
                r'最近|近期',
                r'[qQ][1-4]',  # Q1, Q2, q1, q2等（支持大小写）
                r'\d{1,2}/\d{1,2}',  # 1/1, 7/31等
                r'全年|年度'
            ]
            
            has_time = any(re.search(pattern, query) for pattern in time_patterns)
            
            if not has_time:
                return "需要指定时间段：如'本月'、'2024年7月'或'第三季度'"
        
        return None
    
    def _check_metric_ambiguity(self, query: str) -> Optional[str]:
        """检查指标是否含糊"""
        # 只对非常短的查询进行检查
        if len(query) > 8:  # 超过8个字符通常已经比较明确
            return None
        
        vague_terms = {
            "销售": "请指定：销售额或销售量",
            "业绩": "请明确：销售额、利润或完成率",
            "数据": "请指定数据类型：销售、库存或财务",
            "报表": "请指定报表类型：销售、库存或财务"
        }
        
        # 完全匹配才认为含糊
        query_stripped = query.strip()
        if query_stripped in vague_terms:
            return vague_terms[query_stripped]
        
        return None
    
    def _check_scope_ambiguity(self, query: str) -> Optional[str]:
        """检查范围是否含糊"""
        # 只对非常短且单独提到实体的查询检查
        if len(query) > 10:
            return None
        
        # 如果是"部门销售"这种极短查询才认为含糊
        if query.strip() in ["部门", "产品", "地区", "事业部", "部门销售", "产品销售"]:
            entity = query.strip().replace("销售", "").strip()
            return f"请指定：特定{entity}或所有{entity}"
        
        return None
    
    def _check_comparison_ambiguity(self, query: str) -> Optional[str]:
        """检查对比需求是否明确"""
        # 只检查极短的对比查询
        if query.strip() in ["对比", "比较", "对比销售", "对比数据", "比较销售"]:
            return "请指定对比对象：如'本月和上月'或'部门A和部门B'"
        
        return None
    
    def suggest_improvements(self, query: str) -> List[str]:
        """
        生成查询改进建议
        
        Args:
            query: 用户查询
            
        Returns:
            改进后的示例查询列表
        """
        suggestions = []
        query_lower = query.lower()
        
        # 基于查询内容生成具体建议
        if "销售" in query_lower:
            suggestions.extend([
                f"查询{self.current_year}年{self.current_month}月各事业部销售额",
                f"对比本月和上月的销售量变化",
                f"分析本季度销售额前10的产品"
            ])
        elif "库存" in query_lower:
            suggestions.extend([
                f"查看当前库存预警产品清单",
                f"统计各仓库的库存周转率",
                f"分析库存积压最严重的TOP10产品"
            ])
        elif "采购" in query_lower:
            suggestions.extend([
                f"统计本月各供应商的采购金额",
                f"查看采购订单完成率",
                f"分析采购成本同比变化趋势"
            ])
        else:
            # 通用建议
            suggestions.extend([
                f"查询{self.current_year}年{self.current_month}月的销售数据",
                "按部门统计本季度业绩",
                "生成年度经营分析报告"
            ])
        
        return suggestions[:3]  # 最多返回3个建议


class SmartQueryProcessor:
    """智能查询处理器 - 整合澄清和处理逻辑"""
    
    def __init__(self):
        """初始化处理器"""
        self.clarifier = QueryClarifier()
    
    def process(self, query: str) -> Dict[str, any]:
        """
        处理用户查询
        
        Args:
            query: 用户查询
            
        Returns:
            处理结果字典
        """
        # 分析查询
        needs_clarification, suggestion = self.clarifier.analyze_query(query)
        
        if needs_clarification:
            # 需要澄清
            improvements = self.clarifier.suggest_improvements(query)
            return {
                "status": "needs_clarification",
                "message": suggestion,
                "suggestions": improvements,
                "original_query": query
            }
        else:
            # 查询清晰，可以执行
            return {
                "status": "ready",
                "query": self._enhance_query(query),
                "original_query": query
            }
    
    def _enhance_query(self, query: str) -> str:
        """增强查询，添加默认值"""
        enhanced = query
        
        # 如果没有时间，添加默认时间
        if not re.search(r'\d{4}年|\d{1,2}月|本月|上月', query):
            current = datetime.now()
            enhanced += f"（默认查询{current.year}年{current.month}月数据）"
        
        return enhanced
    
    def format_clarification_response(self, result: Dict) -> str:
        """
        格式化澄清响应
        
        Args:
            result: 处理结果
            
        Returns:
            格式化的响应文本
        """
        if result["status"] == "needs_clarification":
            response = f"{result['message']}\n\n"
            
            if result.get("suggestions"):
                response += "建议查询格式：\n"
                for i, suggestion in enumerate(result["suggestions"], 1):
                    response += f"  {i}. {suggestion}\n"
            
            return response
        elif result["status"] == "ready":
            # 为正常查询提供标准响应
            return "查询已就绪，正在处理您的请求..."
        else:
            # 处理其他状态
            return f"查询状态: {result.get('status', '未知')}"