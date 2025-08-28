"""
语义层管理器
管理数据库表和字段的语义标注信息
"""

import json
import logging
import os
from typing import Dict, List, Any, Optional
from datetime import datetime
import threading
import sqlite3
from pathlib import Path

logger = logging.getLogger(__name__)

class SemanticLayerManager:
    """语义层管理器"""
    
    def __init__(self, config_path: str = None, db_path: str = None):
        """
        初始化语义层管理器
        
        Args:
            config_path: 语义层配置文件路径
            db_path: SQLite数据库路径
        """
        # 配置文件路径
        if config_path:
            self.config_path = config_path
        else:
            self.config_path = os.path.join(
                os.path.dirname(__file__), '..', 'semantic_layer.json'
            )
            
        # 数据库路径
        if db_path:
            self.db_path = db_path
        else:
            self.db_path = os.path.join(
                os.path.dirname(__file__), '..', 'data', 'semantic_layer.db'
            )
            
        # 确保数据目录存在
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        
        # 内存缓存
        self.cache = {}
        self.cache_lock = threading.RLock()
        
        # 初始化数据库
        self._init_database()
        
        # 加载现有配置
        self.load_config()
        
    def _init_database(self):
        """初始化SQLite数据库"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # 创建数据源表
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS datasources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            datasource_id VARCHAR(50) UNIQUE NOT NULL,
            name VARCHAR(100),
            display_name VARCHAR(200),
            type VARCHAR(50),
            connection_config TEXT,
            metadata_updated_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)
        
        # 创建表语义信息表
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS semantic_tables (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            datasource_id VARCHAR(50),
            schema_name VARCHAR(100),
            table_name VARCHAR(100),
            display_name VARCHAR(200),
            description TEXT,
            category VARCHAR(100),
            tags TEXT,
            usage_frequency INTEGER DEFAULT 0,
            created_by VARCHAR(100),
            updated_by VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(datasource_id, schema_name, table_name)
        )
        """)
        
        # 创建字段语义信息表
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS semantic_columns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_id INTEGER,
            column_name VARCHAR(100),
            data_type VARCHAR(50),
            display_name VARCHAR(200),
            description TEXT,
            business_type VARCHAR(50),
            unit VARCHAR(50),
            format VARCHAR(100),
            synonyms TEXT,
            examples TEXT,
            validation_rules TEXT,
            is_required BOOLEAN DEFAULT 0,
            is_sensitive BOOLEAN DEFAULT 0,
            created_by VARCHAR(100),
            updated_by VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (table_id) REFERENCES semantic_tables(id) ON DELETE CASCADE
        )
        """)
        
        # 创建业务术语表
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS semantic_glossary (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            term VARCHAR(200) UNIQUE,
            definition TEXT,
            formula TEXT,
            sql_template TEXT,
            related_tables TEXT,
            related_columns TEXT,
            category VARCHAR(100),
            examples TEXT,
            created_by VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)
        
        # 创建标注历史表
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS annotation_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            object_type VARCHAR(50),
            object_id INTEGER,
            field_name VARCHAR(100),
            old_value TEXT,
            new_value TEXT,
            change_reason TEXT,
            annotated_by VARCHAR(100),
            annotated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)
        
        # 创建索引
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_tables_search 
        ON semantic_tables(datasource_id, schema_name, table_name)
        """)
        
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_columns_search 
        ON semantic_columns(display_name, column_name)
        """)
        
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_glossary_term 
        ON semantic_glossary(term)
        """)
        
        conn.commit()
        conn.close()
        
    def load_config(self):
        """加载JSON配置文件"""
        try:
            if os.path.exists(self.config_path):
                with open(self.config_path, 'r', encoding='utf-8') as f:
                    self.config = json.load(f)
                logger.info(f"Loaded semantic configuration from {self.config_path}")
            else:
                self.config = self._get_default_config()
                logger.info("Using default semantic configuration")
        except Exception as e:
            logger.error(f"Failed to load config: {e}")
            self.config = self._get_default_config()
            
    def _get_default_config(self) -> Dict[str, Any]:
        """获取默认配置"""
        return {
            "数据库映射": {},
            "核心业务表": {},
            "快速搜索索引": {}
        }
        
    def save_config(self):
        """保存配置到JSON文件"""
        try:
            with open(self.config_path, 'w', encoding='utf-8') as f:
                json.dump(self.config, f, ensure_ascii=False, indent=2)
            logger.info(f"Saved semantic configuration to {self.config_path}")
        except Exception as e:
            logger.error(f"Failed to save config: {e}")
            
    def get_datasources(self) -> List[Dict[str, Any]]:
        """获取所有数据源"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute("""
        SELECT * FROM datasources ORDER BY created_at DESC
        """)
        
        datasources = [dict(row) for row in cursor.fetchall()]
        conn.close()
        
        return datasources
        
    def add_datasource(self, datasource_info: Dict[str, Any]) -> bool:
        """添加数据源"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
            INSERT OR REPLACE INTO datasources 
            (datasource_id, name, display_name, type, connection_config, metadata_updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """, (
                datasource_info['datasource_id'],
                datasource_info.get('name'),
                datasource_info.get('display_name'),
                datasource_info.get('type'),
                json.dumps(datasource_info.get('connection_config', {})),
                datetime.now()
            ))
            
            conn.commit()
            logger.info(f"Added datasource: {datasource_info['datasource_id']}")
            return True
        except Exception as e:
            logger.error(f"Failed to add datasource: {e}")
            return False
        finally:
            conn.close()
            
    def get_tables(self, datasource_id: str, schema_name: str = None) -> List[Dict[str, Any]]:
        """获取数据源的表信息"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        if schema_name:
            cursor.execute("""
            SELECT * FROM semantic_tables 
            WHERE datasource_id = ? AND schema_name = ?
            ORDER BY table_name
            """, (datasource_id, schema_name))
        else:
            cursor.execute("""
            SELECT * FROM semantic_tables 
            WHERE datasource_id = ?
            ORDER BY schema_name, table_name
            """, (datasource_id,))
            
        tables = [dict(row) for row in cursor.fetchall()]
        
        # 解析JSON字段
        for table in tables:
            if table['tags']:
                try:
                    table['tags'] = json.loads(table['tags'])
                except:
                    table['tags'] = []
                    
        conn.close()
        return tables
        
    def get_columns(self, table_id: int) -> List[Dict[str, Any]]:
        """获取表的列信息"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute("""
        SELECT * FROM semantic_columns 
        WHERE table_id = ?
        ORDER BY id
        """, (table_id,))
        
        columns = [dict(row) for row in cursor.fetchall()]
        
        # 解析JSON字段
        for column in columns:
            for field in ['synonyms', 'examples', 'validation_rules']:
                if column[field]:
                    try:
                        column[field] = json.loads(column[field])
                    except:
                        column[field] = []
                        
        conn.close()
        return columns
        
    def save_table_semantic(self, datasource_id: str, schema_name: str, 
                           table_name: str, semantic_info: Dict[str, Any]) -> int:
        """保存表的语义信息"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            # 插入或更新表信息
            cursor.execute("""
            INSERT OR REPLACE INTO semantic_tables 
            (datasource_id, schema_name, table_name, display_name, description, 
             category, tags, created_by, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                datasource_id,
                schema_name,
                table_name,
                semantic_info.get('display_name'),
                semantic_info.get('description'),
                semantic_info.get('category'),
                json.dumps(semantic_info.get('tags', [])),
                semantic_info.get('created_by', 'system'),
                semantic_info.get('updated_by', 'system')
            ))
            
            table_id = cursor.lastrowid
            
            # 记录历史
            self._record_history(conn, 'table', table_id, 'update', 
                               None, json.dumps(semantic_info), 
                               semantic_info.get('updated_by', 'system'))
            
            conn.commit()
            logger.info(f"Saved semantic for table: {datasource_id}.{schema_name}.{table_name}")
            return table_id
        except Exception as e:
            logger.error(f"Failed to save table semantic: {e}")
            conn.rollback()
            return -1
        finally:
            conn.close()
            
    def save_column_semantic(self, table_id: int, column_name: str, 
                           semantic_info: Dict[str, Any]) -> bool:
        """保存列的语义信息"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
            INSERT OR REPLACE INTO semantic_columns 
            (table_id, column_name, data_type, display_name, description, 
             business_type, unit, format, synonyms, examples, validation_rules,
             is_required, is_sensitive, created_by, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                table_id,
                column_name,
                semantic_info.get('data_type'),
                semantic_info.get('display_name'),
                semantic_info.get('description'),
                semantic_info.get('business_type'),
                semantic_info.get('unit'),
                semantic_info.get('format'),
                json.dumps(semantic_info.get('synonyms', [])),
                json.dumps(semantic_info.get('examples', [])),
                json.dumps(semantic_info.get('validation_rules', [])),
                semantic_info.get('is_required', False),
                semantic_info.get('is_sensitive', False),
                semantic_info.get('created_by', 'system'),
                semantic_info.get('updated_by', 'system')
            ))
            
            column_id = cursor.lastrowid
            
            # 记录历史
            self._record_history(conn, 'column', column_id, column_name,
                               None, json.dumps(semantic_info),
                               semantic_info.get('updated_by', 'system'))
            
            conn.commit()
            logger.info(f"Saved semantic for column: {column_name}")
            return True
        except Exception as e:
            logger.error(f"Failed to save column semantic: {e}")
            conn.rollback()
            return False
        finally:
            conn.close()
            
    def save_glossary_term(self, term_info: Dict[str, Any]) -> bool:
        """保存业务术语"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
            INSERT OR REPLACE INTO semantic_glossary 
            (term, definition, formula, sql_template, related_tables, 
             related_columns, category, examples, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                term_info['term'],
                term_info.get('definition'),
                term_info.get('formula'),
                term_info.get('sql_template'),
                json.dumps(term_info.get('related_tables', [])),
                json.dumps(term_info.get('related_columns', [])),
                term_info.get('category'),
                json.dumps(term_info.get('examples', [])),
                term_info.get('created_by', 'system')
            ))
            
            conn.commit()
            logger.info(f"Saved glossary term: {term_info['term']}")
            return True
        except Exception as e:
            logger.error(f"Failed to save glossary term: {e}")
            conn.rollback()
            return False
        finally:
            conn.close()
            
    def search_semantic(self, keyword: str) -> Dict[str, Any]:
        """搜索语义信息"""
        results = {
            'tables': [],
            'columns': [],
            'glossary': []
        }
        
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # 搜索表
        cursor.execute("""
        SELECT * FROM semantic_tables 
        WHERE display_name LIKE ? OR description LIKE ? OR table_name LIKE ?
        """, (f'%{keyword}%', f'%{keyword}%', f'%{keyword}%'))
        results['tables'] = [dict(row) for row in cursor.fetchall()]
        
        # 搜索列
        cursor.execute("""
        SELECT c.*, t.datasource_id, t.schema_name, t.table_name 
        FROM semantic_columns c
        JOIN semantic_tables t ON c.table_id = t.id
        WHERE c.display_name LIKE ? OR c.description LIKE ? OR c.column_name LIKE ?
        """, (f'%{keyword}%', f'%{keyword}%', f'%{keyword}%'))
        results['columns'] = [dict(row) for row in cursor.fetchall()]
        
        # 搜索术语
        cursor.execute("""
        SELECT * FROM semantic_glossary 
        WHERE term LIKE ? OR definition LIKE ?
        """, (f'%{keyword}%', f'%{keyword}%'))
        results['glossary'] = [dict(row) for row in cursor.fetchall()]
        
        conn.close()
        return results
        
    def get_semantic_for_query(self, query: str) -> Dict[str, Any]:
        """获取查询相关的语义信息"""
        # 从查询中提取关键词
        keywords = self._extract_keywords(query)
        
        semantic_info = {
            'mappings': {},
            'suggestions': [],
            'related_tables': [],
            'related_columns': []
        }
        
        # 搜索每个关键词
        for keyword in keywords:
            results = self.search_semantic(keyword)
            
            # 整合结果
            if results['tables']:
                semantic_info['related_tables'].extend(results['tables'])
            if results['columns']:
                semantic_info['related_columns'].extend(results['columns'])
            if results['glossary']:
                for term in results['glossary']:
                    semantic_info['mappings'][term['term']] = {
                        'definition': term['definition'],
                        'sql_template': term['sql_template']
                    }
                    
        # 去重
        semantic_info['related_tables'] = self._deduplicate_list(
            semantic_info['related_tables'], 'id'
        )
        semantic_info['related_columns'] = self._deduplicate_list(
            semantic_info['related_columns'], 'id'
        )
        
        return semantic_info
        
    def _extract_keywords(self, query: str) -> List[str]:
        """从查询中提取关键词"""
        # 简单的关键词提取，可以后续优化
        import re
        
        # 移除常见的SQL关键词
        sql_keywords = ['select', 'from', 'where', 'group', 'by', 'order', 
                       'having', 'limit', 'and', 'or', 'not', 'in', 'like']
        
        words = re.findall(r'\w+', query.lower())
        keywords = [w for w in words if w not in sql_keywords and len(w) > 2]
        
        return list(set(keywords))
        
    def _deduplicate_list(self, items: List[Dict], key: str) -> List[Dict]:
        """列表去重"""
        seen = set()
        deduped = []
        for item in items:
            if item[key] not in seen:
                seen.add(item[key])
                deduped.append(item)
        return deduped
        
    def _record_history(self, conn, object_type: str, object_id: int, 
                       field_name: str, old_value: str, new_value: str, 
                       annotated_by: str):
        """记录修改历史"""
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO annotation_history 
        (object_type, object_id, field_name, old_value, new_value, annotated_by)
        VALUES (?, ?, ?, ?, ?, ?)
        """, (object_type, object_id, field_name, old_value, new_value, annotated_by))
        
    def export_semantic_layer(self, filepath: str):
        """导出整个语义层为JSON"""
        export_data = {
            'export_time': datetime.now().isoformat(),
            'datasources': self.get_datasources(),
            'semantic_data': {}
        }
        
        for datasource in export_data['datasources']:
            ds_id = datasource['datasource_id']
            tables = self.get_tables(ds_id)
            
            for table in tables:
                table['columns'] = self.get_columns(table['id'])
                
            export_data['semantic_data'][ds_id] = tables
            
        try:
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(export_data, f, ensure_ascii=False, indent=2, default=str)
            logger.info(f"Exported semantic layer to {filepath}")
            return True
        except Exception as e:
            logger.error(f"Failed to export semantic layer: {e}")
            return False
            
    def import_semantic_layer(self, filepath: str) -> bool:
        """从JSON导入语义层"""
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                import_data = json.load(f)
                
            # 导入数据源
            for datasource in import_data.get('datasources', []):
                self.add_datasource(datasource)
                
            # 导入语义数据
            for ds_id, tables in import_data.get('semantic_data', {}).items():
                for table in tables:
                    # 保存表语义
                    table_id = self.save_table_semantic(
                        ds_id, 
                        table.get('schema_name'),
                        table.get('table_name'),
                        table
                    )
                    
                    # 保存列语义
                    for column in table.get('columns', []):
                        self.save_column_semantic(table_id, column['column_name'], column)
                        
            logger.info(f"Imported semantic layer from {filepath}")
            return True
        except Exception as e:
            logger.error(f"Failed to import semantic layer: {e}")
            return False
            
    def get_statistics(self) -> Dict[str, Any]:
        """获取语义层统计信息"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        stats = {}
        
        # 数据源数量
        cursor.execute("SELECT COUNT(*) FROM datasources")
        stats['datasource_count'] = cursor.fetchone()[0]
        
        # 表数量
        cursor.execute("SELECT COUNT(*) FROM semantic_tables")
        stats['table_count'] = cursor.fetchone()[0]
        
        # 已标注的表数量
        cursor.execute("""
        SELECT COUNT(*) FROM semantic_tables 
        WHERE display_name IS NOT NULL AND display_name != ''
        """)
        stats['annotated_table_count'] = cursor.fetchone()[0]
        
        # 列数量
        cursor.execute("SELECT COUNT(*) FROM semantic_columns")
        stats['column_count'] = cursor.fetchone()[0]
        
        # 已标注的列数量
        cursor.execute("""
        SELECT COUNT(*) FROM semantic_columns 
        WHERE display_name IS NOT NULL AND display_name != ''
        """)
        stats['annotated_column_count'] = cursor.fetchone()[0]
        
        # 业务术语数量
        cursor.execute("SELECT COUNT(*) FROM semantic_glossary")
        stats['glossary_count'] = cursor.fetchone()[0]
        
        # 计算完成度
        if stats['table_count'] > 0:
            stats['table_completion'] = (
                stats['annotated_table_count'] / stats['table_count'] * 100
            )
        else:
            stats['table_completion'] = 0
            
        if stats['column_count'] > 0:
            stats['column_completion'] = (
                stats['annotated_column_count'] / stats['column_count'] * 100
            )
        else:
            stats['column_completion'] = 0
            
        conn.close()
        return stats