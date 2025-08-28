"""
元数据采集器
自动扫描和采集数据库结构信息
"""

import logging
import pymysql
from typing import Dict, List, Any, Optional
from datetime import datetime
import json
from .semantic_analyzer import SemanticAnalyzer

logger = logging.getLogger(__name__)

class MetadataCollector:
    """数据库元数据采集器"""
    
    def __init__(self, connection_config: Dict[str, Any]):
        """
        初始化元数据采集器
        
        Args:
            connection_config: 数据库连接配置
        """
        self.connection_config = connection_config
        self.connection = None
        self.analyzer = SemanticAnalyzer()  # 初始化语义分析器
        
    def connect(self):
        """建立数据库连接"""
        try:
            self.connection = pymysql.connect(
                host=self.connection_config.get('host'),
                port=self.connection_config.get('port', 3306),
                user=self.connection_config.get('user'),
                password=self.connection_config.get('password'),
                charset='utf8mb4',
                cursorclass=pymysql.cursors.DictCursor
            )
            logger.info(f"Connected to database: {self.connection_config.get('host')}")
            return True
        except Exception as e:
            logger.error(f"Failed to connect to database: {e}")
            return False
            
    def close(self):
        """关闭数据库连接"""
        if self.connection:
            self.connection.close()
            
    def get_databases(self) -> List[str]:
        """获取所有数据库列表"""
        try:
            with self.connection.cursor() as cursor:
                cursor.execute("SHOW DATABASES")
                databases = [row['Database'] for row in cursor.fetchall()]
                # 过滤系统数据库
                system_dbs = ['information_schema', 'mysql', 'performance_schema', 'sys']
                return [db for db in databases if db not in system_dbs]
        except Exception as e:
            logger.error(f"Failed to get databases: {e}")
            return []
            
    def get_tables(self, database: str) -> List[Dict[str, Any]]:
        """
        获取指定数据库的所有表
        
        Args:
            database: 数据库名称
            
        Returns:
            表信息列表
        """
        try:
            with self.connection.cursor() as cursor:
                # 切换到指定数据库
                cursor.execute(f"USE `{database}`")
                
                # 获取所有表
                cursor.execute("SHOW TABLES")
                tables = []
                
                for row in cursor.fetchall():
                    table_name = list(row.values())[0]
                    
                    # 获取表的额外信息
                    cursor.execute(f"SHOW TABLE STATUS LIKE '{table_name}'")
                    table_status = cursor.fetchone()
                    
                    # 获取表的行数（估算）
                    cursor.execute(f"SELECT COUNT(*) as row_count FROM `{table_name}` LIMIT 1")
                    row_count = cursor.fetchone().get('row_count', 0)
                    
                    table_info = {
                        'table_name': table_name,
                        'engine': table_status.get('Engine', ''),
                        'row_count': row_count,
                        'create_time': str(table_status.get('Create_time', '')),
                        'update_time': str(table_status.get('Update_time', '')),
                        'comment': table_status.get('Comment', ''),
                        'collation': table_status.get('Collation', '')
                    }
                    tables.append(table_info)
                    
                return tables
        except Exception as e:
            logger.error(f"Failed to get tables for database {database}: {e}")
            return []
            
    def get_columns(self, database: str, table: str) -> List[Dict[str, Any]]:
        """
        获取指定表的所有列信息
        
        Args:
            database: 数据库名称
            table: 表名称
            
        Returns:
            列信息列表
        """
        try:
            with self.connection.cursor() as cursor:
                cursor.execute(f"USE `{database}`")
                
                # 使用INFORMATION_SCHEMA获取详细列信息
                sql = """
                SELECT 
                    COLUMN_NAME as column_name,
                    DATA_TYPE as data_type,
                    COLUMN_TYPE as column_type,
                    IS_NULLABLE as is_nullable,
                    COLUMN_DEFAULT as default_value,
                    COLUMN_KEY as column_key,
                    EXTRA as extra,
                    COLUMN_COMMENT as comment,
                    CHARACTER_MAXIMUM_LENGTH as max_length,
                    NUMERIC_PRECISION as numeric_precision,
                    NUMERIC_SCALE as numeric_scale,
                    ORDINAL_POSITION as position
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
                ORDER BY ORDINAL_POSITION
                """
                
                cursor.execute(sql, (database, table))
                columns = cursor.fetchall()
                
                # 获取一些示例数据
                for column in columns:
                    try:
                        # 获取该列的几个示例值
                        sample_sql = f"""
                        SELECT DISTINCT `{column['column_name']}` 
                        FROM `{table}` 
                        WHERE `{column['column_name']}` IS NOT NULL
                        LIMIT 5
                        """
                        cursor.execute(sample_sql)
                        samples = cursor.fetchall()
                        column['sample_values'] = [
                            str(row[column['column_name']]) 
                            for row in samples
                        ][:5]  # 最多5个示例
                    except:
                        column['sample_values'] = []
                        
                return columns
        except Exception as e:
            logger.error(f"Failed to get columns for table {database}.{table}: {e}")
            return []
            
    def get_table_relationships(self, database: str, table: str) -> List[Dict[str, Any]]:
        """
        获取表的外键关系
        
        Args:
            database: 数据库名称
            table: 表名称
            
        Returns:
            外键关系列表
        """
        try:
            with self.connection.cursor() as cursor:
                sql = """
                SELECT 
                    kcu.COLUMN_NAME as column_name,
                    kcu.REFERENCED_TABLE_SCHEMA as ref_database,
                    kcu.REFERENCED_TABLE_NAME as ref_table,
                    kcu.REFERENCED_COLUMN_NAME as ref_column,
                    rc.CONSTRAINT_NAME as constraint_name
                FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
                    ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
                    AND kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
                WHERE kcu.TABLE_SCHEMA = %s 
                    AND kcu.TABLE_NAME = %s
                """
                
                cursor.execute(sql, (database, table))
                return cursor.fetchall()
        except Exception as e:
            logger.error(f"Failed to get relationships for table {database}.{table}: {e}")
            return []
            
    def analyze_column_patterns(self, column_name: str, data_type: str) -> Dict[str, Any]:
        """
        分析列名和数据类型，推测业务含义
        
        Args:
            column_name: 列名
            data_type: 数据类型
            
        Returns:
            推测的业务信息
        """
        suggestions = {
            'display_name': '',
            'business_type': '',
            'tags': [],
            'unit': ''
        }
        
        column_lower = column_name.lower()
        
        # 基于列名后缀的模式匹配
        patterns = {
            # 标识符类
            ('_id', 'id$', '_no$', '_code$'): {
                'business_type': 'identifier',
                'display_name_suffix': '编号',
                'tags': ['主键', '标识符']
            },
            # 名称类
            ('_name$', 'name$'): {
                'business_type': 'name',
                'display_name_suffix': '名称',
                'tags': ['名称', '描述']
            },
            # 时间类
            ('_date$', '_time$', '_dt$', 'created_', 'updated_', 'modified_'): {
                'business_type': 'datetime',
                'display_name_suffix': '时间',
                'tags': ['时间', '日期']
            },
            # 金额类
            ('_amount$', '_amt$', '_price$', '_cost$', '_fee$'): {
                'business_type': 'monetary',
                'display_name_suffix': '金额',
                'tags': ['金额', '财务'],
                'unit': '元'
            },
            # 数量类
            ('_num$', '_qty$', '_count$', 'quantity'): {
                'business_type': 'quantity',
                'display_name_suffix': '数量',
                'tags': ['数量', '计数'],
                'unit': '个'
            },
            # 状态类
            ('status', 'state', 'flag', 'is_', 'has_'): {
                'business_type': 'status',
                'display_name_suffix': '状态',
                'tags': ['状态', '标志']
            },
            # 比率类
            ('_rate$', '_ratio$', '_percent$'): {
                'business_type': 'percentage',
                'display_name_suffix': '比率',
                'tags': ['比率', '百分比'],
                'unit': '%'
            }
        }
        
        # 应用模式匹配
        for patterns_tuple, info in patterns.items():
            for pattern in patterns_tuple:
                if pattern.endswith('$'):
                    if column_lower.endswith(pattern[:-1]):
                        suggestions.update(info)
                        break
                elif pattern.endswith('_'):
                    if column_lower.startswith(pattern[:-1]):
                        suggestions.update(info)
                        break
                elif pattern in column_lower:
                    suggestions.update(info)
                    break
                    
        # 基于数据类型的推测
        if 'decimal' in data_type or 'float' in data_type or 'double' in data_type:
            if not suggestions['business_type']:
                suggestions['business_type'] = 'numeric'
                suggestions['tags'].append('数值')
        elif 'date' in data_type or 'time' in data_type:
            suggestions['business_type'] = 'datetime'
            suggestions['tags'].append('时间')
        elif 'char' in data_type or 'text' in data_type:
            if not suggestions['business_type']:
                suggestions['business_type'] = 'text'
                suggestions['tags'].append('文本')
        elif 'int' in data_type:
            if not suggestions['business_type']:
                suggestions['business_type'] = 'numeric'
                suggestions['tags'].append('整数')
                
        # 生成默认显示名称
        if not suggestions['display_name']:
            # 将下划线分隔的名称转换为中文友好的格式
            parts = column_name.split('_')
            suggestions['display_name'] = ''.join(parts)
            
        return suggestions
        
    def collect_full_metadata(self, database: Optional[str] = None) -> Dict[str, Any]:
        """
        采集完整的数据库元数据
        
        Args:
            database: 可选的数据库名称，如果不指定则采集所有数据库
            
        Returns:
            完整的元数据字典
        """
        metadata = {
            'collection_time': datetime.now().isoformat(),
            'datasources': {}
        }
        
        if not self.connect():
            return metadata
            
        try:
            databases = [database] if database else self.get_databases()
            
            for db in databases:
                logger.info(f"Collecting metadata for database: {db}")
                
                db_metadata = {
                    'database_name': db,
                    'tables': {}
                }
                
                tables = self.get_tables(db)
                for table_info in tables:
                    table_name = table_info['table_name']
                    logger.info(f"  Collecting metadata for table: {db}.{table_name}")
                    
                    # 获取列信息
                    columns = self.get_columns(db, table_name)
                    
                    # 为每个列添加智能推测
                    for column in columns:
                        suggestions = self.analyze_column_patterns(
                            column['column_name'],
                            column['data_type']
                        )
                        column['suggestions'] = suggestions
                        
                    # 获取关系信息
                    relationships = self.get_table_relationships(db, table_name)
                    
                    # 使用语义分析器分析表
                    semantic_analysis = self.analyzer.analyze_table(table_name, columns)
                    
                    table_metadata = {
                        'info': table_info,
                        'columns': columns,
                        'relationships': relationships,
                        'semantic_analysis': semantic_analysis  # 添加语义分析结果
                    }
                    
                    db_metadata['tables'][table_name] = table_metadata
                    
                metadata['datasources'][db] = db_metadata
                
        finally:
            self.close()
            
        return metadata
        
    def export_to_json(self, metadata: Dict[str, Any], filepath: str):
        """
        将元数据导出为JSON文件
        
        Args:
            metadata: 元数据字典
            filepath: 输出文件路径
        """
        try:
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(metadata, f, ensure_ascii=False, indent=2, default=str)
            logger.info(f"Metadata exported to {filepath}")
        except Exception as e:
            logger.error(f"Failed to export metadata: {e}")