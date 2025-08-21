"""
查询澄清器单元测试
"""
import unittest
import sys
from pathlib import Path

# 添加父目录到路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from query_clarifier import QueryClarifier, SmartQueryProcessor


class TestQueryClarifier(unittest.TestCase):
    """测试查询澄清器"""
    
    def setUp(self):
        """初始化测试环境"""
        self.clarifier = QueryClarifier()
    
    def test_time_ambiguity_detection(self):
        """测试时间含糊检测"""
        # 含糊的查询
        needs_clarify, suggestion = self.clarifier.analyze_query("查询销售数据")
        self.assertTrue(needs_clarify)
        self.assertIn("时间", suggestion)
        
        # 清晰的查询
        needs_clarify, _ = self.clarifier.analyze_query("查询2024年7月销售数据")
        self.assertFalse(needs_clarify)
        
        # 有相对时间的查询
        needs_clarify, _ = self.clarifier.analyze_query("查询本月销售数据")
        self.assertFalse(needs_clarify)
    
    def test_metric_ambiguity_detection(self):
        """测试指标含糊检测"""
        # 含糊的"销售" - 单独一个词
        needs_clarify, suggestion = self.clarifier.analyze_query("销售")
        self.assertTrue(needs_clarify)
        if suggestion:  # 可能是时间或指标含糊
            self.assertTrue(
                "销售额还是销售量" in suggestion or "时间" in suggestion
            )
        
        # 清晰的查询
        needs_clarify, _ = self.clarifier.analyze_query("查询本月销售额")
        self.assertFalse(needs_clarify)
    
    def test_scope_ambiguity_detection(self):
        """测试范围含糊检测"""
        # 提到部门但没指定
        needs_clarify, suggestion = self.clarifier.analyze_query("部门销售")
        self.assertTrue(needs_clarify)
        if suggestion:
            self.assertTrue(
                "特定部门还是所有部门" in suggestion or "时间" in suggestion
            )
        
        # 明确指定了范围 - 但可能还缺时间
        result = self.clarifier.analyze_query("所有部门的销售数据")
        # 这个查询虽然明确了范围，但可能因为缺少时间而需要澄清
        # 所以我们只验证如果需要澄清，不是因为范围问题
        if result[0]:  # 如果需要澄清
            self.assertNotIn("特定部门还是所有部门", result[1])
    
    def test_comparison_ambiguity(self):
        """测试对比含糊检测"""
        # 含糊的对比
        needs_clarify, suggestion = self.clarifier.analyze_query("对比销售")
        self.assertTrue(needs_clarify)
        if suggestion:
            self.assertTrue(
                "对比什么" in suggestion or "时间" in suggestion
            )
        
        # 清晰的对比
        needs_clarify, _ = self.clarifier.analyze_query("对比本月和上月销售")
        self.assertFalse(needs_clarify)
    
    def test_suggest_improvements(self):
        """测试改进建议生成"""
        suggestions = self.clarifier.suggest_improvements("销售")
        self.assertTrue(len(suggestions) > 0)
        self.assertTrue(all("销售" in s for s in suggestions))
        
        suggestions = self.clarifier.suggest_improvements("库存")
        self.assertTrue(len(suggestions) > 0)
        self.assertTrue(any("库存" in s for s in suggestions))


class TestSmartQueryProcessor(unittest.TestCase):
    """测试智能查询处理器"""
    
    def setUp(self):
        """初始化测试环境"""
        self.processor = SmartQueryProcessor()
    
    def test_process_clear_query(self):
        """测试处理清晰查询"""
        result = self.processor.process("查询2024年7月销售额")
        self.assertEqual(result["status"], "ready")
        self.assertIn("query", result)
    
    def test_process_ambiguous_query(self):
        """测试处理含糊查询"""
        result = self.processor.process("销售数据")
        self.assertEqual(result["status"], "needs_clarification")
        self.assertIn("message", result)
        self.assertIn("suggestions", result)
    
    def test_format_clarification_response(self):
        """测试格式化澄清响应"""
        result = {
            "status": "needs_clarification",
            "message": "需要更多信息",
            "suggestions": ["建议1", "建议2"]
        }
        
        response = self.processor.format_clarification_response(result)
        self.assertIn("需要更多信息", response)
        self.assertIn("建议1", response)
        self.assertIn("建议2", response)
    
    def test_enhance_query(self):
        """测试查询增强"""
        # 没有时间的查询应该被增强
        result = self.processor.process("统计各部门人数")
        if result["status"] == "ready":
            self.assertIn("默认查询", result["query"])
    
    def test_no_false_positives(self):
        """测试避免误判"""
        # 这些查询都是清晰的，不应该需要澄清
        clear_queries = [
            "查询2024年7月各事业部销售额",
            "统计本月所有产品的库存量",
            "分析第三季度采购成本趋势",
            "对比今年和去年的营收数据"
        ]
        
        for query in clear_queries:
            result = self.processor.process(query)
            self.assertEqual(
                result["status"], "ready",
                f"查询 '{query}' 被误判为需要澄清"
            )


class TestIntegration(unittest.TestCase):
    """集成测试"""
    
    def test_end_to_end_clarification(self):
        """端到端测试澄清流程"""
        processor = SmartQueryProcessor()
        
        # 第一次查询：含糊
        result1 = processor.process("销售")
        self.assertEqual(result1["status"], "needs_clarification")
        
        # 用户根据建议重新查询
        if result1.get("suggestions"):
            # 使用第一个建议
            new_query = result1["suggestions"][0]
            result2 = processor.process(new_query)
            # 建议的查询应该是清晰的
            self.assertEqual(result2["status"], "ready")


if __name__ == '__main__':
    unittest.main()