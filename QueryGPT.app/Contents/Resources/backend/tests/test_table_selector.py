"""
表选择器单元测试 - 确保代码质量
"""
import unittest
import sys
from pathlib import Path

# 添加父目录到路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from table_selector import TableClassifier, FieldMapper, SmartTableSelector


class TestTableClassifier(unittest.TestCase):
    """测试表分类器"""
    
    def setUp(self):
        """初始化测试环境"""
        self.classifier = TableClassifier()
    
    def test_classify_sales_table(self):
        """测试销售表识别"""
        # 测试明显的销售表
        self.assertEqual(
            self.classifier.classify("dwd_invoice_sales_detail"),
            "sales"
        )
        self.assertEqual(
            self.classifier.classify("dws_revenue_summary"),
            "sales"
        )
    
    def test_classify_purchase_table(self):
        """测试采购表识别"""
        # 测试明显的采购表
        self.assertEqual(
            self.classifier.classify("dwd_oea_purchase_order_detail"),
            "purchase"
        )
        self.assertEqual(
            self.classifier.classify("dws_procurement_summary"),
            "purchase"
        )
    
    def test_classify_unknown_table(self):
        """测试未知表处理"""
        self.assertEqual(
            self.classifier.classify("some_random_table"),
            "unknown"
        )
    
    def test_classify_with_fields(self):
        """测试基于字段的分类"""
        # 包含客户字段的应该是销售表
        sales_fields = ["customer_id", "invoice_no", "sales_amount"]
        self.assertEqual(
            self.classifier.classify("ambiguous_table", sales_fields),
            "sales"
        )
        
        # 包含供应商字段的应该是采购表
        purchase_fields = ["supplier_id", "vendor_name", "purchase_qty"]
        self.assertEqual(
            self.classifier.classify("ambiguous_table", purchase_fields),
            "purchase"
        )


class TestFieldMapper(unittest.TestCase):
    """测试字段映射器"""
    
    def setUp(self):
        """初始化测试环境"""
        self.mapper = FieldMapper()
    
    def test_get_quantity_fields(self):
        """测试获取数量字段"""
        # 销售数量字段
        sales_qty = self.mapper.get_field_name("quantity", "sales")
        self.assertIn("sales_qty", sales_qty)
        
        # 采购数量字段
        purchase_qty = self.mapper.get_field_name("quantity", "purchase")
        self.assertIn("done_quantity", purchase_qty)
    
    def test_get_department_fields(self):
        """测试获取部门字段"""
        dept_fields = self.mapper.get_field_name("department")
        self.assertIn("business_unit", dept_fields)
        self.assertIn("organization_code", dept_fields)
    
    def test_find_field_case_insensitive(self):
        """测试大小写不敏感的字段查找"""
        available = ["Sales_Qty", "INVOICE_DATE", "Business_Unit"]
        
        # 应该能找到 Sales_Qty
        found = self.mapper.find_field(available, "quantity", "sales")
        self.assertEqual(found, "Sales_Qty")
        
        # 应该能找到 Business_Unit
        found = self.mapper.find_field(available, "department")
        self.assertEqual(found, "Business_Unit")
    
    def test_find_field_not_exists(self):
        """测试字段不存在的情况"""
        available = ["some_field", "another_field"]
        found = self.mapper.find_field(available, "quantity", "sales")
        self.assertIsNone(found)


class TestSmartTableSelector(unittest.TestCase):
    """测试智能表选择器"""
    
    def setUp(self):
        """初始化测试环境"""
        self.selector = SmartTableSelector()
    
    def test_select_sales_table(self):
        """测试选择销售表"""
        tables = [
            "dwd_oea_purchase_order_detail",
            "dwd_invoice_sales_detail",
            "dim_product"
        ]
        
        # 查询包含销售关键词
        best = self.selector.select_best_table(tables, "查询本月销售额")
        self.assertEqual(best, "dwd_invoice_sales_detail")
    
    def test_select_purchase_table(self):
        """测试选择采购表"""
        tables = [
            "dwd_invoice_sales_detail",
            "dwd_oea_purchase_order_detail",
            "dim_supplier"
        ]
        
        # 查询包含采购关键词
        best = self.selector.select_best_table(tables, "统计采购金额")
        self.assertEqual(best, "dwd_oea_purchase_order_detail")
    
    def test_select_with_empty_list(self):
        """测试空表列表处理"""
        best = self.selector.select_best_table([], "查询销售")
        self.assertIsNone(best)
    
    def test_get_query_fields(self):
        """测试获取查询字段"""
        fields = self.selector.get_query_fields("查询销售数量", "sales")
        
        # 应该包含数量字段
        self.assertIn("quantity", fields)
        self.assertIn("sales_qty", fields["quantity"])
        
        # 应该包含部门字段
        self.assertIn("department", fields)
        
        # 应该包含日期字段
        self.assertIn("date", fields)


class TestCodeQuality(unittest.TestCase):
    """测试代码质量 - 避免代码坏味道"""
    
    def test_no_long_methods(self):
        """确保没有过长的方法"""
        import inspect
        from table_selector import TableClassifier, FieldMapper, SmartTableSelector
        
        max_lines = 25  # 方法不应超过25行
        
        for cls in [TableClassifier, FieldMapper, SmartTableSelector]:
            for name, method in inspect.getmembers(cls, predicate=inspect.isfunction):
                if not name.startswith('_'):  # 只检查公共方法
                    source = inspect.getsource(method)
                    lines = source.count('\n')
                    self.assertLessEqual(
                        lines, max_lines,
                        f"{cls.__name__}.{name} 方法超过 {max_lines} 行 ({lines} 行)"
                    )
    
    def test_single_responsibility(self):
        """确保类遵循单一职责原则"""
        # TableClassifier 只负责分类
        classifier = TableClassifier()
        self.assertTrue(hasattr(classifier, 'classify'))
        self.assertFalse(hasattr(classifier, 'map_fields'))
        
        # FieldMapper 只负责映射
        mapper = FieldMapper()
        self.assertTrue(hasattr(mapper, 'get_field_name'))
        self.assertFalse(hasattr(mapper, 'classify'))


if __name__ == '__main__':
    unittest.main()