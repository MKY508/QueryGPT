"""
语义映射器
将业务术语映射到技术字段，增强查询理解
"""

import logging
import re
from typing import Dict, List, Any, Optional, Tuple
import json
from difflib import SequenceMatcher

logger = logging.getLogger(__name__)

class SemanticMapper:
    """语义映射器"""
    
    def __init__(self, manager):
        """
        初始化语义映射器
        
        Args:
            manager: SemanticLayerManager实例
        """
        self.manager = manager
        self.mapping_cache = {}
        
    def enhance_prompt_with_semantics(self, user_query: str, datasource_id: str = None) -> str:
        """
        使用语义信息增强用户查询
        
        Args:
            user_query: 用户的原始查询
            datasource_id: 可选的数据源ID
            
        Returns:
            增强后的查询提示
        """
        # 获取相关的语义信息
        semantic_info = self.manager.get_semantic_for_query(user_query)
        
        # 构建增强的提示
        enhanced_prompt = self._build_enhanced_prompt(
            user_query, semantic_info, datasource_id
        )
        
        return enhanced_prompt
        
    def _build_enhanced_prompt(self, user_query: str, 
                              semantic_info: Dict[str, Any], 
                              datasource_id: str = None) -> str:
        """构建增强的提示"""
        prompt_parts = []
        
        # 原始查询
        prompt_parts.append(f"## 用户查询\n{user_query}\n")
        
        # 添加术语映射
        if semantic_info['mappings']:
            prompt_parts.append("## 业务术语映射")
            for term, info in semantic_info['mappings'].items():
                prompt_parts.append(f"- {term}: {info['definition']}")
                if info.get('sql_template'):
                    prompt_parts.append(f"  SQL模板: {info['sql_template']}")
            prompt_parts.append("")
            
        # 添加相关表信息
        if semantic_info['related_tables']:
            prompt_parts.append("## 相关数据表")
            for table in semantic_info['related_tables'][:5]:  # 最多显示5个
                table_path = f"{table['datasource_id']}.{table['schema_name']}.{table['table_name']}"
                prompt_parts.append(
                    f"- {table_path}: {table.get('display_name', table['table_name'])}"
                )
                if table.get('description'):
                    prompt_parts.append(f"  描述: {table['description']}")
            prompt_parts.append("")
            
        # 添加相关字段信息
        if semantic_info['related_columns']:
            prompt_parts.append("## 相关字段")
            for column in semantic_info['related_columns'][:10]:  # 最多显示10个
                field_path = f"{column['table_name']}.{column['column_name']}"
                prompt_parts.append(
                    f"- {field_path}: {column.get('display_name', column['column_name'])}"
                )
                if column.get('description'):
                    prompt_parts.append(f"  描述: {column['description']}")
                if column.get('business_type'):
                    prompt_parts.append(f"  业务类型: {column['business_type']}")
                if column.get('unit'):
                    prompt_parts.append(f"  单位: {column['unit']}")
            prompt_parts.append("")
            
        # 添加查询建议
        suggestions = self._generate_query_suggestions(user_query, semantic_info)
        if suggestions:
            prompt_parts.append("## 查询建议")
            for suggestion in suggestions:
                prompt_parts.append(f"- {suggestion}")
            prompt_parts.append("")
            
        return "\n".join(prompt_parts)
        
    def map_business_to_technical(self, business_term: str) -> Optional[Dict[str, Any]]:
        """
        将业务术语映射到技术字段
        
        Args:
            business_term: 业务术语
            
        Returns:
            映射信息字典，包含表名、字段名等
        """
        # 首先尝试精确匹配
        exact_match = self._find_exact_match(business_term)
        if exact_match:
            return exact_match
            
        # 尝试模糊匹配
        fuzzy_match = self._find_fuzzy_match(business_term)
        if fuzzy_match:
            return fuzzy_match
            
        # 尝试智能推理
        inferred_match = self._infer_mapping(business_term)
        if inferred_match:
            return inferred_match
            
        return None
        
    def _find_exact_match(self, term: str) -> Optional[Dict[str, Any]]:
        """精确匹配"""
        results = self.manager.search_semantic(term)
        
        # 优先匹配术语表
        for glossary in results['glossary']:
            if glossary['term'].lower() == term.lower():
                return {
                    'type': 'glossary',
                    'term': glossary['term'],
                    'definition': glossary['definition'],
                    'sql_template': glossary.get('sql_template'),
                    'related_tables': json.loads(glossary.get('related_tables', '[]')),
                    'related_columns': json.loads(glossary.get('related_columns', '[]'))
                }
                
        # 匹配表名
        for table in results['tables']:
            if table['display_name'] and table['display_name'].lower() == term.lower():
                return {
                    'type': 'table',
                    'datasource_id': table['datasource_id'],
                    'schema_name': table['schema_name'],
                    'table_name': table['table_name'],
                    'display_name': table['display_name'],
                    'description': table.get('description')
                }
                
        # 匹配字段名
        for column in results['columns']:
            if column['display_name'] and column['display_name'].lower() == term.lower():
                return {
                    'type': 'column',
                    'datasource_id': column['datasource_id'],
                    'schema_name': column['schema_name'],
                    'table_name': column['table_name'],
                    'column_name': column['column_name'],
                    'display_name': column['display_name'],
                    'description': column.get('description'),
                    'business_type': column.get('business_type')
                }
                
        return None
        
    def _find_fuzzy_match(self, term: str, threshold: float = 0.8) -> Optional[Dict[str, Any]]:
        """模糊匹配"""
        best_match = None
        best_score = 0
        
        # 搜索相似术语
        results = self.manager.search_semantic(term)
        
        # 检查所有结果
        all_items = []
        
        for glossary in results['glossary']:
            all_items.append({
                'type': 'glossary',
                'name': glossary['term'],
                'data': glossary
            })
            
        for table in results['tables']:
            if table.get('display_name'):
                all_items.append({
                    'type': 'table',
                    'name': table['display_name'],
                    'data': table
                })
                
        for column in results['columns']:
            if column.get('display_name'):
                all_items.append({
                    'type': 'column',
                    'name': column['display_name'],
                    'data': column
                })
                
        # 计算相似度
        for item in all_items:
            similarity = SequenceMatcher(None, term.lower(), item['name'].lower()).ratio()
            if similarity > best_score and similarity >= threshold:
                best_score = similarity
                best_match = item
                
        if best_match:
            return self._format_match_result(best_match)
            
        return None
        
    def _infer_mapping(self, term: str) -> Optional[Dict[str, Any]]:
        """基于规则和模式推理映射"""
        # 检查是否包含常见的业务关键词
        patterns = {
            '销售': ['sale', 'order', '订单'],
            '客户': ['customer', 'cust', '用户'],
            '产品': ['product', 'sku', '商品'],
            '金额': ['amount', 'amt', 'price'],
            '数量': ['quantity', 'qty', 'num'],
            '日期': ['date', 'time', '时间'],
            '状态': ['status', 'state', '标志'],
            '库存': ['inventory', 'stock', '存货'],
            '财务': ['finance', 'accounting', '记账'],
            '采购': ['purchase', 'procurement', '订货']
        }
        
        for key, values in patterns.items():
            if key in term:
                # 搜索相关的表和字段
                for value in values:
                    results = self.manager.search_semantic(value)
                    if results['tables'] or results['columns']:
                        return {
                            'type': 'inferred',
                            'term': term,
                            'inferred_from': key,
                            'related_keywords': values,
                            'tables': results['tables'][:3],
                            'columns': results['columns'][:5]
                        }
                        
        return None
        
    def _format_match_result(self, match: Dict[str, Any]) -> Dict[str, Any]:
        """格式化匹配结果"""
        if match['type'] == 'glossary':
            data = match['data']
            return {
                'type': 'glossary',
                'term': data['term'],
                'definition': data['definition'],
                'sql_template': data.get('sql_template'),
                'related_tables': json.loads(data.get('related_tables', '[]')),
                'related_columns': json.loads(data.get('related_columns', '[]'))
            }
        elif match['type'] == 'table':
            data = match['data']
            return {
                'type': 'table',
                'datasource_id': data['datasource_id'],
                'schema_name': data['schema_name'],
                'table_name': data['table_name'],
                'display_name': data['display_name'],
                'description': data.get('description')
            }
        elif match['type'] == 'column':
            data = match['data']
            return {
                'type': 'column',
                'datasource_id': data['datasource_id'],
                'schema_name': data['schema_name'],
                'table_name': data['table_name'],
                'column_name': data['column_name'],
                'display_name': data['display_name'],
                'description': data.get('description'),
                'business_type': data.get('business_type')
            }
        return match
        
    def _generate_query_suggestions(self, user_query: str, 
                                   semantic_info: Dict[str, Any]) -> List[str]:
        """生成查询建议"""
        suggestions = []
        
        # 基于找到的表和字段生成建议
        if semantic_info['related_tables']:
            table = semantic_info['related_tables'][0]
            suggestions.append(
                f"可以查询表 {table['table_name']} ({table.get('display_name', '')})"
            )
            
        if semantic_info['related_columns']:
            columns = semantic_info['related_columns'][:3]
            column_names = [c['column_name'] for c in columns]
            suggestions.append(
                f"相关字段: {', '.join(column_names)}"
            )
            
        # 基于术语生成建议
        if semantic_info['mappings']:
            for term, info in list(semantic_info['mappings'].items())[:2]:
                if info.get('sql_template'):
                    suggestions.append(
                        f"术语'{term}'可以使用SQL: {info['sql_template']}"
                    )
                    
        return suggestions
        
    def translate_sql_with_semantics(self, sql: str) -> str:
        """
        将包含业务术语的SQL转换为技术SQL
        
        Args:
            sql: 包含业务术语的SQL
            
        Returns:
            转换后的技术SQL
        """
        translated_sql = sql
        
        # 提取SQL中的标识符（表名、字段名等）
        identifiers = self._extract_sql_identifiers(sql)
        
        # 尝试映射每个标识符
        for identifier in identifiers:
            mapping = self.map_business_to_technical(identifier)
            if mapping:
                if mapping['type'] == 'table':
                    # 替换表名
                    full_table = f"{mapping['schema_name']}.{mapping['table_name']}"
                    translated_sql = translated_sql.replace(identifier, full_table)
                elif mapping['type'] == 'column':
                    # 替换字段名
                    translated_sql = translated_sql.replace(
                        identifier, mapping['column_name']
                    )
                elif mapping['type'] == 'glossary' and mapping.get('sql_template'):
                    # 使用SQL模板
                    translated_sql = translated_sql.replace(
                        identifier, f"({mapping['sql_template']})"
                    )
                    
        return translated_sql
        
    def _extract_sql_identifiers(self, sql: str) -> List[str]:
        """从SQL中提取标识符"""
        # 移除字符串字面量
        sql_no_strings = re.sub(r"'[^']*'", '', sql)
        
        # 提取可能的标识符
        pattern = r'\b[a-zA-Z_\u4e00-\u9fa5][a-zA-Z0-9_\u4e00-\u9fa5]*\b'
        identifiers = re.findall(pattern, sql_no_strings)
        
        # 过滤SQL关键词
        sql_keywords = {
            'select', 'from', 'where', 'group', 'by', 'order', 'having',
            'limit', 'offset', 'and', 'or', 'not', 'in', 'like', 'between',
            'join', 'inner', 'left', 'right', 'outer', 'on', 'as', 'is',
            'null', 'count', 'sum', 'avg', 'max', 'min', 'distinct'
        }
        
        filtered = [i for i in identifiers if i.lower() not in sql_keywords]
        
        return list(set(filtered))
        
    def get_table_semantic_context(self, datasource_id: str, schema_name: str, 
                                  table_name: str) -> Dict[str, Any]:
        """获取表的完整语义上下文"""
        tables = self.manager.get_tables(datasource_id, schema_name)
        
        for table in tables:
            if table['table_name'] == table_name:
                # 获取列信息
                columns = self.manager.get_columns(table['id'])
                
                return {
                    'table': table,
                    'columns': columns,
                    'formatted_context': self._format_table_context(table, columns)
                }
                
        return {}
        
    def _format_table_context(self, table: Dict[str, Any], 
                             columns: List[Dict[str, Any]]) -> str:
        """格式化表的语义上下文"""
        context_parts = []
        
        # 表信息
        context_parts.append(f"表: {table['table_name']}")
        if table.get('display_name'):
            context_parts.append(f"中文名: {table['display_name']}")
        if table.get('description'):
            context_parts.append(f"描述: {table['description']}")
        if table.get('tags'):
            context_parts.append(f"标签: {', '.join(table['tags'])}")
            
        # 列信息
        context_parts.append("\n字段:")
        for column in columns:
            col_info = f"- {column['column_name']}"
            if column.get('display_name'):
                col_info += f" ({column['display_name']})"
            if column.get('data_type'):
                col_info += f" [{column['data_type']}]"
            if column.get('description'):
                col_info += f": {column['description']}"
            context_parts.append(col_info)
            
        return "\n".join(context_parts)
        
    def batch_annotate(self, datasource_id: str, annotations: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        批量标注
        
        Args:
            datasource_id: 数据源ID
            annotations: 标注列表
            
        Returns:
            标注结果统计
        """
        results = {
            'success_count': 0,
            'failed_count': 0,
            'errors': []
        }
        
        for annotation in annotations:
            try:
                if annotation['type'] == 'table':
                    table_id = self.manager.save_table_semantic(
                        datasource_id,
                        annotation['schema_name'],
                        annotation['table_name'],
                        annotation['semantic_info']
                    )
                    if table_id > 0:
                        results['success_count'] += 1
                    else:
                        results['failed_count'] += 1
                        results['errors'].append(
                            f"Failed to save table {annotation['table_name']}"
                        )
                elif annotation['type'] == 'column':
                    success = self.manager.save_column_semantic(
                        annotation['table_id'],
                        annotation['column_name'],
                        annotation['semantic_info']
                    )
                    if success:
                        results['success_count'] += 1
                    else:
                        results['failed_count'] += 1
                        results['errors'].append(
                            f"Failed to save column {annotation['column_name']}"
                        )
            except Exception as e:
                results['failed_count'] += 1
                results['errors'].append(str(e))
                
        return results