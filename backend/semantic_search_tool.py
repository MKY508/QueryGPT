#!/usr/bin/env python3
"""
语义搜索工具 - 供OpenInterpreter调用
根据中文查询找到对应的数据库表和字段
"""

import json
import os
from typing import Dict, List, Optional, Tuple

class SemanticSearchTool:
    """语义层搜索工具"""
    
    def __init__(self, mapping_file: str = None):
        """初始化搜索工具"""
        if mapping_file is None:
            # 获取当前文件所在目录
            current_dir = os.path.dirname(os.path.abspath(__file__))
            mapping_file = os.path.join(current_dir, 'semantic_layer.json')
        
        with open(mapping_file, 'r', encoding='utf-8') as f:
            self.mappings = json.load(f)
    
    def search_by_keyword(self, keyword: str) -> Dict:
        """
        根据中文关键词搜索对应的表和字段
        
        Args:
            keyword: 中文关键词，如"七折"、"事业部"、"销量"
            
        Returns:
            包含表名、字段名等信息的字典
        """
        # 先在快速索引中精确匹配
        if keyword in self.mappings['快速搜索索引']:
            result = self.mappings['快速搜索索引'][keyword]
            return {
                'found': True,
                'keyword': keyword,
                'field': result['字段'],
                'table': result['表'],
                'description': result['描述']
            }
        
        # 在核心业务表中模糊搜索
        results = []
        for business_name, table_info in self.mappings['核心业务表'].items():
            # 检查关键词是否在业务关键词中
            if keyword in table_info['关键词']:
                results.append({
                    'business': business_name,
                    'table': table_info['表路径'],
                    'table_cn': table_info['中文名'],
                    'fields': table_info['必需字段']
                })
            
            # 检查关键词是否在字段中文名中
            for field_en, field_cn in table_info['必需字段'].items():
                if keyword in field_cn:
                    results.append({
                        'business': business_name,
                        'table': table_info['表路径'],
                        'field': field_en,
                        'field_cn': field_cn
                    })
        
        if results:
            return {
                'found': True,
                'keyword': keyword,
                'matches': results
            }
        
        return {
            'found': False,
            'keyword': keyword,
            'suggestion': '未找到匹配项，请尝试其他关键词'
        }
    
    def get_table_for_query(self, query: str) -> Tuple[str, Dict[str, str]]:
        """
        根据查询语句推荐最合适的表和字段
        
        Args:
            query: 用户的中文查询，如"统计2025年7月各事业部的七折销量"
            
        Returns:
            (表名, 字段映射字典)
        """
        # 提取查询中的关键词
        keywords = []
        for keyword in self.mappings['快速搜索索引'].keys():
            if keyword in query:
                keywords.append(keyword)
        
        # 根据关键词确定最合适的表
        table_scores = {}
        field_mappings = {}
        
        for keyword in keywords:
            search_result = self.search_by_keyword(keyword)
            if search_result['found']:
                table = search_result.get('table')
                if isinstance(table, list):
                    table = table[0]  # 如果有多个表，取第一个
                
                if table:
                    table_scores[table] = table_scores.get(table, 0) + 1
                    
                    # 收集字段映射
                    if table not in field_mappings:
                        field_mappings[table] = {}
                    
                    field = search_result.get('field')
                    if field and field != '*':
                        field_mappings[table][keyword] = field
        
        # 选择得分最高的表
        if table_scores:
            best_table = max(table_scores.items(), key=lambda x: x[1])[0]
            
            # 补充该表的所有必需字段
            for business_name, table_info in self.mappings['核心业务表'].items():
                if table_info['表路径'] == best_table:
                    return best_table, table_info['必需字段']
        
        # 默认返回销售表
        return "center_dws.dws_sale_trd_sku_sale_day_datail", \
               self.mappings['核心业务表']['销售分析']['必需字段']
    
    def get_database_info(self, db_name: str) -> Dict:
        """获取数据库信息"""
        if db_name in self.mappings['数据库映射']:
            return self.mappings['数据库映射'][db_name]
        return None
    
    def list_business_scenarios(self) -> List[str]:
        """列出所有业务场景"""
        return list(self.mappings['核心业务表'].keys())