"""
语义分析器
提供高级语义推断和分析功能
"""

import re
import logging
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime
import numpy as np

logger = logging.getLogger(__name__)

class SemanticAnalyzer:
    """语义分析器 - 智能推断数据的业务语义"""
    
    def __init__(self):
        # 定义常见的业务模式
        self.init_patterns()
        
    def init_patterns(self):
        """初始化模式库"""
        
        # 度量(Measures)模式
        self.measure_patterns = {
            'amount': ['amount', 'amt', 'price', 'cost', 'fee', 'revenue', 'total', 'sum', 'value'],
            'quantity': ['qty', 'quantity', 'count', 'num', 'number', 'volume'],
            'rate': ['rate', 'ratio', 'percent', 'pct', 'percentage'],
            'score': ['score', 'rating', 'rank', 'level', 'grade']
        }
        
        # 维度(Dimensions)模式
        self.dimension_patterns = {
            'identifier': ['id', 'code', 'no', 'key', 'uuid'],
            'category': ['type', 'category', 'class', 'group', 'segment', 'status', 'state'],
            'name': ['name', 'title', 'label', 'description', 'desc'],
            'location': ['country', 'province', 'city', 'region', 'area', 'address', 'location'],
            'organization': ['company', 'org', 'department', 'dept', 'team', 'branch']
        }
        
        # 时间维度模式
        self.time_patterns = {
            'date': ['date', 'dt', 'day'],
            'time': ['time', 'timestamp', 'datetime'],
            'year': ['year', 'yr'],
            'month': ['month', 'mon'],
            'created': ['created', 'create', 'added', 'insert'],
            'updated': ['updated', 'update', 'modified', 'modify'],
            'deleted': ['deleted', 'delete', 'removed', 'remove']
        }
        
        # 常见的事实表模式
        self.fact_table_patterns = [
            'order', 'transaction', 'sale', 'purchase', 'payment',
            'event', 'log', 'record', 'detail', 'fact', 'activity'
        ]
        
        # 常见的维度表模式
        self.dim_table_patterns = [
            'customer', 'product', 'user', 'account', 'item',
            'category', 'location', 'dim_', 'lookup', 'reference'
        ]
        
    def analyze_table(self, table_name: str, columns: List[Dict]) -> Dict[str, Any]:
        """
        分析表的语义特征
        
        Returns:
            包含表类型、主要实体、度量、维度等信息
        """
        analysis = {
            'table_type': self.classify_table_type(table_name),
            'primary_entity': self.detect_primary_entity(table_name, columns),
            'measures': [],
            'dimensions': [],
            'time_dimensions': [],
            'relationships': [],
            'suggested_name': self.suggest_chinese_name(table_name),
            'suggested_description': '',
            'business_category': self.detect_business_category(table_name),
            'aggregation_level': self.detect_aggregation_level(table_name, columns)
        }
        
        # 分析每个字段
        for column in columns:
            col_analysis = self.analyze_column(column)
            
            if col_analysis['semantic_type'] == 'measure':
                analysis['measures'].append(col_analysis)
            elif col_analysis['semantic_type'] == 'time_dimension':
                analysis['time_dimensions'].append(col_analysis)
            else:
                analysis['dimensions'].append(col_analysis)
                
        # 检测可能的关系
        analysis['relationships'] = self.detect_relationships(table_name, columns)
        
        # 生成描述
        analysis['suggested_description'] = self.generate_description(analysis)
        
        return analysis
        
    def classify_table_type(self, table_name: str) -> str:
        """
        分类表类型：fact（事实表）、dimension（维度表）、bridge（桥接表）
        """
        table_lower = table_name.lower()
        
        # 检查是否是事实表
        for pattern in self.fact_table_patterns:
            if pattern in table_lower:
                return 'fact'
                
        # 检查是否是维度表
        for pattern in self.dim_table_patterns:
            if pattern in table_lower:
                return 'dimension'
                
        # 检查是否是桥接表（多对多关系）
        if '_x_' in table_lower or '_to_' in table_lower or table_lower.count('_') > 3:
            return 'bridge'
            
        # 默认基于表名长度判断
        return 'dimension' if len(table_name) < 20 else 'fact'
        
    def detect_primary_entity(self, table_name: str, columns: List[Dict]) -> str:
        """检测表的主要实体"""
        # 从表名提取
        table_parts = re.split('[_\\s]+', table_name.lower())
        
        # 移除常见前缀和后缀
        prefixes = ['dw', 'dwd', 'dws', 'ods', 'ads', 'dim', 'fact', 'tmp', 'stg']
        suffixes = ['table', 'tab', 'tb', 'detail', 'info', 'data']
        
        filtered_parts = []
        for part in table_parts:
            if part not in prefixes and part not in suffixes and len(part) > 2:
                filtered_parts.append(part)
                
        if filtered_parts:
            return filtered_parts[0]
            
        # 从主键字段推断
        for column in columns:
            if column.get('column_key') == 'PRI':
                col_name = column['column_name'].lower()
                if col_name.endswith('_id'):
                    entity = col_name[:-3]
                    if entity and entity != 'id':
                        return entity
                        
        return table_name.lower()
        
    def analyze_column(self, column: Dict) -> Dict[str, Any]:
        """
        分析字段的语义特征
        """
        col_name = column['column_name'].lower()
        data_type = column.get('data_type', '').lower()
        
        analysis = {
            'column_name': column['column_name'],
            'data_type': data_type,
            'semantic_type': 'dimension',  # 默认为维度
            'business_type': '',
            'suggested_name': '',
            'suggested_aggregations': [],
            'is_nullable': column.get('is_nullable') == 'YES',
            'is_primary_key': column.get('column_key') == 'PRI',
            'is_foreign_key': column.get('column_key') == 'MUL',
            'cardinality': 'unknown',
            'format': '',
            'unit': ''
        }
        
        # 判断是否为度量
        if self.is_measure(col_name, data_type):
            analysis['semantic_type'] = 'measure'
            analysis['suggested_aggregations'] = self.suggest_aggregations(col_name, data_type)
            analysis['business_type'] = self.detect_measure_type(col_name)
            
        # 判断是否为时间维度
        elif self.is_time_dimension(col_name, data_type):
            analysis['semantic_type'] = 'time_dimension'
            analysis['business_type'] = self.detect_time_type(col_name)
            analysis['format'] = self.detect_date_format(column.get('sample_values', []))
            
        # 判断维度类型
        else:
            analysis['business_type'] = self.detect_dimension_type(col_name)
            analysis['cardinality'] = self.estimate_cardinality(column.get('sample_values', []))
            
        # 生成中文建议名
        analysis['suggested_name'] = self.suggest_column_chinese_name(col_name, analysis)
        
        # 检测单位
        if analysis['semantic_type'] == 'measure':
            analysis['unit'] = self.detect_unit(col_name)
            
        return analysis
        
    def is_measure(self, col_name: str, data_type: str) -> bool:
        """判断是否为度量字段"""
        # 数据类型检查
        if not any(t in data_type for t in ['int', 'decimal', 'float', 'double', 'numeric']):
            return False
            
        # ID类字段不是度量
        if any(pattern in col_name for pattern in ['_id', '_code', '_no']):
            return False
            
        # 检查度量模式
        for measure_type, patterns in self.measure_patterns.items():
            for pattern in patterns:
                if pattern in col_name:
                    return True
                    
        return False
        
    def is_time_dimension(self, col_name: str, data_type: str) -> bool:
        """判断是否为时间维度"""
        # 数据类型检查
        if any(t in data_type for t in ['date', 'time', 'timestamp']):
            return True
            
        # 名称模式检查
        for time_type, patterns in self.time_patterns.items():
            for pattern in patterns:
                if pattern in col_name:
                    return True
                    
        return False
        
    def detect_measure_type(self, col_name: str) -> str:
        """检测度量类型"""
        for measure_type, patterns in self.measure_patterns.items():
            for pattern in patterns:
                if pattern in col_name:
                    return measure_type
        return 'numeric'
        
    def detect_time_type(self, col_name: str) -> str:
        """检测时间类型"""
        for time_type, patterns in self.time_patterns.items():
            for pattern in patterns:
                if pattern in col_name:
                    return time_type
        return 'datetime'
        
    def detect_dimension_type(self, col_name: str) -> str:
        """检测维度类型"""
        for dim_type, patterns in self.dimension_patterns.items():
            for pattern in patterns:
                if pattern in col_name:
                    return dim_type
        return 'attribute'
        
    def suggest_aggregations(self, col_name: str, data_type: str) -> List[str]:
        """建议聚合函数"""
        aggregations = ['sum', 'avg', 'min', 'max', 'count']
        
        # 金额类通常不需要avg
        if any(p in col_name for p in ['amount', 'amt', 'price', 'cost', 'fee']):
            return ['sum', 'min', 'max', 'count']
            
        # 数量类
        if any(p in col_name for p in ['qty', 'quantity', 'count', 'num']):
            return ['sum', 'avg', 'min', 'max']
            
        # 比率类
        if any(p in col_name for p in ['rate', 'ratio', 'percent']):
            return ['avg', 'min', 'max']
            
        return aggregations
        
    def detect_unit(self, col_name: str) -> str:
        """检测单位"""
        units = {
            'amount': '元',
            'amt': '元',
            'price': '元',
            'cost': '元',
            'fee': '元',
            'qty': '个',
            'quantity': '个',
            'count': '次',
            'percent': '%',
            'rate': '%',
            'day': '天',
            'hour': '小时',
            'minute': '分钟'
        }
        
        for key, unit in units.items():
            if key in col_name:
                return unit
                
        return ''
        
    def detect_relationships(self, table_name: str, columns: List[Dict]) -> List[Dict]:
        """检测表关系"""
        relationships = []
        
        for column in columns:
            col_name = column['column_name'].lower()
            
            # 检测外键模式
            if col_name.endswith('_id') and column.get('column_key') != 'PRI':
                # 推断相关表
                entity = col_name[:-3]  # 移除_id
                relationships.append({
                    'type': 'many-to-one',
                    'column': column['column_name'],
                    'related_entity': entity,
                    'suggested_table': self.suggest_related_table(entity),
                    'confidence': 0.8
                })
                
        return relationships
        
    def suggest_related_table(self, entity: str) -> str:
        """推测相关表名"""
        # 常见的表名模式
        patterns = [
            entity + 's',  # 复数
            'dim_' + entity,  # 维度表前缀
            entity + '_info',  # 信息表后缀
            entity + '_master'  # 主数据后缀
        ]
        
        return patterns[0]  # 返回最可能的
        
    def estimate_cardinality(self, sample_values: List) -> str:
        """估计基数（唯一值数量）"""
        if not sample_values:
            return 'unknown'
            
        unique_count = len(set(sample_values))
        total_count = len(sample_values)
        
        if unique_count == total_count:
            return 'high'  # 高基数
        elif unique_count < 10:
            return 'low'  # 低基数
        else:
            return 'medium'  # 中基数
            
    def detect_date_format(self, sample_values: List) -> str:
        """检测日期格式"""
        if not sample_values:
            return ''
            
        # 尝试识别格式
        formats = [
            '%Y-%m-%d',
            '%Y/%m/%d',
            '%Y-%m-%d %H:%M:%S',
            '%Y年%m月%d日'
        ]
        
        for fmt in formats:
            try:
                for value in sample_values[:3]:  # 检查前3个样本
                    if value:
                        datetime.strptime(str(value), fmt)
                return fmt
            except:
                continue
                
        return ''
        
    def suggest_chinese_name(self, table_name: str) -> str:
        """建议表的中文名"""
        # 常见表名映射
        name_map = {
            'order': '订单',
            'customer': '客户',
            'product': '产品',
            'user': '用户',
            'sale': '销售',
            'purchase': '采购',
            'inventory': '库存',
            'payment': '支付',
            'transaction': '交易',
            'account': '账户',
            'employee': '员工',
            'department': '部门',
            'category': '类别',
            'supplier': '供应商',
            'contract': '合同'
        }
        
        table_lower = table_name.lower()
        
        # 直接匹配
        for key, value in name_map.items():
            if key in table_lower:
                return value + '表'
                
        # 返回原名
        return table_name
        
    def suggest_column_chinese_name(self, col_name: str, analysis: Dict) -> str:
        """建议字段的中文名"""
        # 基于业务类型的映射
        type_maps = {
            'amount': '金额',
            'quantity': '数量',
            'rate': '比率',
            'score': '分数',
            'identifier': '编号',
            'category': '类型',
            'name': '名称',
            'location': '位置',
            'organization': '组织',
            'date': '日期',
            'time': '时间',
            'created': '创建时间',
            'updated': '更新时间'
        }
        
        # 常见字段映射
        field_map = {
            'id': 'ID',
            'name': '名称',
            'code': '代码',
            'type': '类型',
            'status': '状态',
            'amount': '金额',
            'price': '价格',
            'qty': '数量',
            'quantity': '数量',
            'date': '日期',
            'time': '时间',
            'created_at': '创建时间',
            'updated_at': '更新时间',
            'deleted_at': '删除时间',
            'description': '描述',
            'remark': '备注',
            'phone': '电话',
            'email': '邮箱',
            'address': '地址'
        }
        
        col_lower = col_name.lower()
        
        # 先基于业务类型
        if analysis.get('business_type') in type_maps:
            base_name = type_maps[analysis['business_type']]
            
            # 添加实体前缀
            parts = col_lower.split('_')
            if len(parts) > 1:
                entity = parts[0]
                if entity in ['customer', 'cust']:
                    return '客户' + base_name
                elif entity in ['product', 'prod']:
                    return '产品' + base_name
                elif entity in ['order', 'ord']:
                    return '订单' + base_name
                    
            return base_name
            
        # 直接字段映射
        for key, value in field_map.items():
            if key == col_lower:
                return value
                
        # 组合匹配
        parts = col_lower.split('_')
        chinese_parts = []
        for part in parts:
            if part in field_map:
                chinese_parts.append(field_map[part])
            else:
                chinese_parts.append(part)
                
        if len(chinese_parts) > 1:
            return ''.join(chinese_parts)
            
        return col_name
        
    def detect_business_category(self, table_name: str) -> str:
        """检测业务类别"""
        categories = {
            '销售': ['sale', 'order', 'revenue'],
            '采购': ['purchase', 'supplier', 'procurement'],
            '库存': ['inventory', 'stock', 'warehouse'],
            '财务': ['finance', 'accounting', 'payment', 'invoice'],
            '客户': ['customer', 'client', 'member'],
            '产品': ['product', 'item', 'goods'],
            '人力': ['employee', 'staff', 'hr', 'payroll'],
            '物流': ['logistics', 'shipping', 'delivery'],
            '营销': ['marketing', 'campaign', 'promotion']
        }
        
        table_lower = table_name.lower()
        
        for category, patterns in categories.items():
            for pattern in patterns:
                if pattern in table_lower:
                    return category
                    
        return '通用'
        
    def detect_aggregation_level(self, table_name: str, columns: List[Dict]) -> str:
        """检测聚合级别"""
        table_lower = table_name.lower()
        
        # 基于表名判断
        if any(p in table_lower for p in ['detail', 'transaction', 'record', 'log']):
            return 'transaction'  # 事务级
        elif any(p in table_lower for p in ['daily', 'day']):
            return 'daily'  # 日级
        elif any(p in table_lower for p in ['monthly', 'month']):
            return 'monthly'  # 月级
        elif any(p in table_lower for p in ['yearly', 'year']):
            return 'yearly'  # 年级
        elif any(p in table_lower for p in ['summary', 'agg', 'total']):
            return 'summary'  # 汇总级
            
        # 基于字段判断
        has_date = any(self.is_time_dimension(c['column_name'].lower(), c.get('data_type', '')) 
                      for c in columns)
        has_id = any(c.get('column_key') == 'PRI' for c in columns)
        
        if has_id and has_date:
            return 'transaction'
        elif has_date:
            return 'periodic'  # 周期性
        else:
            return 'snapshot'  # 快照
            
    def generate_description(self, analysis: Dict) -> str:
        """生成表描述"""
        parts = []
        
        # 表类型
        type_desc = {
            'fact': '事实表',
            'dimension': '维度表',
            'bridge': '桥接表'
        }
        parts.append(f"这是一个{type_desc.get(analysis['table_type'], '数据表')}")
        
        # 主要实体
        if analysis['primary_entity']:
            parts.append(f"主要记录{analysis['primary_entity']}相关信息")
            
        # 度量
        if analysis['measures']:
            measure_names = [m['suggested_name'] or m['column_name'] 
                           for m in analysis['measures'][:3]]
            parts.append(f"包含{', '.join(measure_names)}等度量指标")
            
        # 时间维度
        if analysis['time_dimensions']:
            parts.append("支持时间序列分析")
            
        # 聚合级别
        level_desc = {
            'transaction': '记录详细的事务数据',
            'daily': '按日汇总的数据',
            'monthly': '按月汇总的数据',
            'yearly': '按年汇总的数据',
            'summary': '高度汇总的统计数据'
        }
        if analysis['aggregation_level'] in level_desc:
            parts.append(level_desc[analysis['aggregation_level']])
            
        return '，'.join(parts) + '。'