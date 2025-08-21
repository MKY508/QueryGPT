#!/usr/bin/env python
"""
集成测试脚本 - 测试查询澄清和表选择功能
"""
import sys
sys.path.insert(0, '/Users/maokaiyue/querygpt')

from backend.query_clarifier import QueryClarifier, SmartQueryProcessor
from backend.table_selector import SmartTableSelector


def test_clarification():
    """测试查询澄清功能"""
    print("\n=== 测试查询澄清功能 ===\n")
    
    processor = SmartQueryProcessor()
    
    # 测试含糊查询
    test_queries = [
        "销售",  # 极短，需要澄清
        "查询销售数据",  # 缺少时间
        "查询2024年7月销售额",  # 清晰
        "对比销售",  # 含糊的对比
        "按事业部统计2025年7月的销量，绘制饼图"  # 清晰完整
    ]
    
    for query in test_queries:
        print(f"查询: {query}")
        result = processor.process(query)
        
        if result['status'] == 'needs_clarification':
            print(f"  状态: 需要澄清")
            print(f"  提示: {result['message']}")
            if result.get('suggestions'):
                print(f"  建议:")
                for i, sugg in enumerate(result['suggestions'], 1):
                    print(f"    {i}. {sugg}")
        else:
            print(f"  状态: 清晰，可以执行")
            print(f"  增强查询: {result.get('query', query)}")
        print()


def test_table_selection():
    """测试表选择功能"""
    print("\n=== 测试表选择功能 ===\n")
    
    selector = SmartTableSelector()
    
    # 模拟表列表
    tables = [
        "dwd_oea_purchase_order_detail",  # 采购表
        "dwd_invoice_sales_detail",       # 销售表
        "dws_sales_summary",              # 销售汇总表
        "ods_inventory_stock",            # 库存表
        "center_dws_trade_order"          # 交易表
    ]
    
    # 测试不同查询
    queries = [
        "查询销售额",
        "统计采购成本",
        "分析库存情况"
    ]
    
    for query in queries:
        print(f"查询: {query}")
        best_table = selector.select_best_table(tables, query)
        table_type = selector.classifier.classify(best_table) if best_table else "unknown"
        print(f"  选择的表: {best_table}")
        print(f"  表类型: {table_type}")
        
        # 获取推荐字段
        fields = selector.get_query_fields(query, table_type)
        if fields:
            print(f"  推荐字段:")
            for concept, field_list in fields.items():
                print(f"    {concept}: {', '.join(field_list)}")
        print()


def test_end_to_end():
    """端到端测试"""
    print("\n=== 端到端测试 ===\n")
    
    # 模拟用户查询流程
    user_query = "销售数据"
    print(f"用户查询: {user_query}")
    
    # 1. 检查是否需要澄清
    processor = SmartQueryProcessor()
    result = processor.process(user_query)
    
    if result['status'] == 'needs_clarification':
        print(f"系统回复: {result['message']}")
        print("建议查询:")
        for i, sugg in enumerate(result['suggestions'][:2], 1):
            print(f"  {i}. {sugg}")
        
        # 用户选择一个建议
        user_query = result['suggestions'][0]
        print(f"\n用户重新查询: {user_query}")
        result = processor.process(user_query)
    
    if result['status'] == 'ready':
        print(f"查询已准备好执行: {result['query']}")
        
        # 2. 选择合适的表
        selector = SmartTableSelector()
        tables = [
            "dwd_invoice_sales_detail",
            "dwd_oea_purchase_order_detail"
        ]
        
        best_table = selector.select_best_table(tables, user_query)
        print(f"系统选择的表: {best_table}")
        
        # 3. 生成SQL（模拟）
        print("\n系统将生成SQL并执行查询...")
        print("✅ 测试完成！")


if __name__ == "__main__":
    print("="*60)
    print("QueryGPT 集成测试")
    print("="*60)
    
    test_clarification()
    test_table_selection()
    test_end_to_end()
    
    print("\n" + "="*60)
    print("所有测试完成！")
    print("="*60)