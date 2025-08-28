"""
语义层 API 端点
提供RESTful接口供前端调用
"""

from flask import Blueprint, request, jsonify, current_app
import logging
from typing import Dict, Any
import json
import os
from .manager import SemanticLayerManager
from .collector import MetadataCollector
from .mapper import SemanticMapper
try:
    from ..database import DatabaseManager
except ImportError:
    # 如果无法导入主应用的模块，创建一个占位类
    class DatabaseManager:
        def get_connection_config(self):
            # 返回默认的数据库配置
            return {
                'host': 'localhost',
                'port': 3306,
                'user': 'root',
                'password': ''
            }

# 使用独立的认证包装器
from .auth_wrapper import require_auth

logger = logging.getLogger(__name__)

# 创建蓝图
semantic_bp = Blueprint('semantic', __name__, url_prefix='/api/semantic')

# 全局管理器实例
semantic_manager = None
semantic_mapper = None

def init_semantic_layer():
    """初始化语义层管理器"""
    global semantic_manager, semantic_mapper
    
    if not semantic_manager:
        semantic_manager = SemanticLayerManager()
        semantic_mapper = SemanticMapper(semantic_manager)
        logger.info("Semantic layer initialized")
        
    return semantic_manager, semantic_mapper

# 获取所有数据源
@semantic_bp.route('/datasources', methods=['GET'])
@require_auth
def get_datasources():
    """获取所有数据源"""
    try:
        manager, _ = init_semantic_layer()
        datasources = manager.get_datasources()
        
        # 添加连接状态检查
        for datasource in datasources:
            datasource['status'] = 'active'  # 可以添加实际的连接检查
            
        return jsonify({
            'success': True,
            'datasources': datasources,
            'count': len(datasources)
        })
    except Exception as e:
        logger.error(f"Failed to get datasources: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# 添加或更新数据源
@semantic_bp.route('/datasources', methods=['POST'])
@require_auth
def add_datasource():
    """添加或更新数据源"""
    try:
        data = request.get_json()
        
        # 验证必需字段
        if not data.get('datasource_id'):
            return jsonify({
                'success': False,
                'error': 'datasource_id is required'
            }), 400
            
        manager, _ = init_semantic_layer()
        success = manager.add_datasource(data)
        
        if success:
            return jsonify({
                'success': True,
                'message': f"Datasource {data['datasource_id']} added/updated successfully"
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Failed to add datasource'
            }), 500
    except Exception as e:
        logger.error(f"Failed to add datasource: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# 扫描数据源的元数据
@semantic_bp.route('/datasources/<datasource_id>/scan', methods=['POST'])
@require_auth
def scan_datasource(datasource_id):
    """扫描数据源的元数据"""
    try:
        # 获取数据库连接配置
        db_manager = DatabaseManager()
        connection_config = db_manager.get_connection_config()
        
        # 创建元数据采集器
        collector = MetadataCollector(connection_config)
        
        # 采集元数据 - 如果没有指定数据源ID或为'auto'，则扫描所有数据库
        if not datasource_id or datasource_id == 'auto':
            metadata = collector.collect_full_metadata()  # 扫描所有数据库
            datasource_id = 'main_db'  # 使用默认名称
        else:
            metadata = collector.collect_full_metadata(datasource_id)
        
        # 保存到管理器
        manager, _ = init_semantic_layer()
        
        # 保存数据源信息
        datasource_info = {
            'datasource_id': datasource_id,
            'name': datasource_id,
            'display_name': request.json.get('display_name', '主数据源'),
            'type': 'mysql',
            'connection_config': connection_config
        }
        manager.add_datasource(datasource_info)
        
        # 保存表和字段信息
        for db_name, db_data in metadata['datasources'].items():
            for table_name, table_data in db_data['tables'].items():
                # 获取语义分析结果
                semantic_analysis = table_data.get('semantic_analysis', {})
                
                # 保存表语义（使用智能分析的结果）
                table_semantic = {
                    'display_name': semantic_analysis.get('suggested_name', table_data['info'].get('comment', '')),
                    'description': semantic_analysis.get('suggested_description', ''),
                    'category': semantic_analysis.get('business_category', ''),
                    'tags': [
                        semantic_analysis.get('table_type', ''),
                        semantic_analysis.get('aggregation_level', '')
                    ]
                }
                
                table_id = manager.save_table_semantic(
                    datasource_id, db_name, table_name, table_semantic
                )
                
                # 保存列语义
                # 先检查语义分析中的度量和维度
                measures = {m['column_name']: m for m in semantic_analysis.get('measures', [])}
                dimensions = {d['column_name']: d for d in semantic_analysis.get('dimensions', [])}
                time_dims = {t['column_name']: t for t in semantic_analysis.get('time_dimensions', [])}
                
                for column in table_data['columns']:
                    col_name = column['column_name']
                    
                    # 优先使用语义分析的结果
                    if col_name in measures:
                        col_analysis = measures[col_name]
                        semantic_type = 'measure'
                    elif col_name in time_dims:
                        col_analysis = time_dims[col_name]
                        semantic_type = 'time_dimension'
                    elif col_name in dimensions:
                        col_analysis = dimensions[col_name]
                        semantic_type = 'dimension'
                    else:
                        col_analysis = column.get('suggestions', {})
                        semantic_type = 'dimension'
                    
                    column_semantic = {
                        'data_type': column['data_type'],
                        'display_name': col_analysis.get('suggested_name', column['suggestions'].get('display_name', '')),
                        'description': column.get('comment', ''),
                        'business_type': col_analysis.get('business_type', column['suggestions'].get('business_type', '')),
                        'semantic_type': semantic_type,
                        'unit': col_analysis.get('unit', column['suggestions'].get('unit', '')),
                        'suggested_aggregations': col_analysis.get('suggested_aggregations', []),
                        'synonyms': [],
                        'examples': column.get('sample_values', []),
                        'is_required': column.get('is_nullable') == 'NO',
                        'is_sensitive': False,
                        'is_primary_key': col_analysis.get('is_primary_key', False),
                        'is_foreign_key': col_analysis.get('is_foreign_key', False)
                    }
                    
                    manager.save_column_semantic(
                        table_id, column['column_name'], column_semantic
                    )
                    
        # 获取统计信息
        stats = manager.get_statistics()
        
        return jsonify({
            'success': True,
            'message': f"Scanned datasource {datasource_id}",
            'statistics': stats
        })
    except Exception as e:
        logger.error(f"Failed to scan datasource: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# 获取数据源的表结构
@semantic_bp.route('/metadata/<datasource_id>', methods=['GET'])
@require_auth
def get_metadata(datasource_id):
    """获取数据源的表结构和语义信息"""
    try:
        schema_name = request.args.get('schema')
        
        manager, _ = init_semantic_layer()
        tables = manager.get_tables(datasource_id, schema_name)
        
        # 为每个表添加列信息
        for table in tables:
            table['columns'] = manager.get_columns(table['id'])
            
        return jsonify({
            'success': True,
            'datasource_id': datasource_id,
            'schema_name': schema_name,
            'tables': tables,
            'count': len(tables)
        })
    except Exception as e:
        logger.error(f"Failed to get metadata: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# 更新表的语义信息
@semantic_bp.route('/metadata/<datasource_id>/tables/<table_name>', methods=['POST'])
@require_auth
def update_table_semantic(datasource_id, table_name):
    """更新表的语义信息"""
    try:
        data = request.get_json()
        schema_name = data.get('schema_name', '')
        
        # 添加更新者信息
        data['updated_by'] = 'system'
        
        manager, _ = init_semantic_layer()
        table_id = manager.save_table_semantic(
            datasource_id, schema_name, table_name, data
        )
        
        if table_id > 0:
            return jsonify({
                'success': True,
                'table_id': table_id,
                'message': f"Updated semantic for table {table_name}"
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Failed to update table semantic'
            }), 500
    except Exception as e:
        logger.error(f"Failed to update table semantic: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# 更新列的语义信息
@semantic_bp.route('/metadata/tables/<int:table_id>/columns/<column_name>', methods=['POST'])
@require_auth
def update_column_semantic(table_id, column_name):
    """更新列的语义信息"""
    try:
        data = request.get_json()
        
        # 添加更新者信息
        data['updated_by'] = 'system'
        
        manager, _ = init_semantic_layer()
        success = manager.save_column_semantic(table_id, column_name, data)
        
        if success:
            return jsonify({
                'success': True,
                'message': f"Updated semantic for column {column_name}"
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Failed to update column semantic'
            }), 500
    except Exception as e:
        logger.error(f"Failed to update column semantic: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# 批量更新语义信息
@semantic_bp.route('/metadata/batch', methods=['POST'])
@require_auth
def batch_update_semantic():
    """批量更新语义信息"""
    try:
        data = request.get_json()
        datasource_id = data.get('datasource_id')
        annotations = data.get('annotations', [])
        
        if not datasource_id or not annotations:
            return jsonify({
                'success': False,
                'error': 'datasource_id and annotations are required'
            }), 400
            
        manager, mapper = init_semantic_layer()
        results = mapper.batch_annotate(datasource_id, annotations)
        
        return jsonify({
            'success': True,
            'results': results
        })
    except Exception as e:
        logger.error(f"Failed to batch update semantic: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# 获取业务术语表
@semantic_bp.route('/glossary', methods=['GET'])
@require_auth
def get_glossary():
    """获取业务术语表"""
    try:
        manager, _ = init_semantic_layer()
        
        # 这里需要添加获取术语表的方法
        # 暂时返回示例数据
        glossary = []
        
        return jsonify({
            'success': True,
            'glossary': glossary,
            'count': len(glossary)
        })
    except Exception as e:
        logger.error(f"Failed to get glossary: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# 添加或更新业务术语
@semantic_bp.route('/glossary', methods=['POST'])
@require_auth
def add_glossary_term():
    """添加或更新业务术语"""
    try:
        data = request.get_json()
        
        # 验证必需字段
        if not data.get('term'):
            return jsonify({
                'success': False,
                'error': 'term is required'
            }), 400
            
        # 添加创建者信息
        data['created_by'] = 'system'
        
        manager, _ = init_semantic_layer()
        success = manager.save_glossary_term(data)
        
        if success:
            return jsonify({
                'success': True,
                'message': f"Glossary term '{data['term']}' added/updated successfully"
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Failed to add glossary term'
            }), 500
    except Exception as e:
        logger.error(f"Failed to add glossary term: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# 搜索语义信息
@semantic_bp.route('/search', methods=['GET'])
@require_auth
def search_semantic():
    """搜索语义信息"""
    try:
        keyword = request.args.get('q', '')
        
        if not keyword:
            return jsonify({
                'success': False,
                'error': 'Search keyword is required'
            }), 400
            
        manager, _ = init_semantic_layer()
        results = manager.search_semantic(keyword)
        
        return jsonify({
            'success': True,
            'keyword': keyword,
            'results': results
        })
    except Exception as e:
        logger.error(f"Failed to search semantic: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# 获取智能建议
@semantic_bp.route('/suggest', methods=['POST'])
@require_auth
def get_suggestions():
    """获取智能建议"""
    try:
        data = request.get_json()
        field_name = data.get('field_name', '')
        data_type = data.get('data_type', '')
        
        # 使用采集器的分析方法
        collector = MetadataCollector({})
        suggestions = collector.analyze_column_patterns(field_name, data_type)
        
        return jsonify({
            'success': True,
            'suggestions': suggestions
        })
    except Exception as e:
        logger.error(f"Failed to get suggestions: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# 导出语义层
@semantic_bp.route('/export', methods=['GET'])
@require_auth
def export_semantic():
    """导出语义层为JSON"""
    try:
        manager, _ = init_semantic_layer()
        
        # 创建临时文件
        import tempfile
        import uuid
        
        filename = f"semantic_layer_{uuid.uuid4()}.json"
        filepath = os.path.join(tempfile.gettempdir(), filename)
        
        success = manager.export_semantic_layer(filepath)
        
        if success:
            # 读取文件内容
            with open(filepath, 'r', encoding='utf-8') as f:
                content = json.load(f)
                
            # 删除临时文件
            os.remove(filepath)
            
            return jsonify({
                'success': True,
                'data': content,
                'filename': filename
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Failed to export semantic layer'
            }), 500
    except Exception as e:
        logger.error(f"Failed to export semantic: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# 导入语义层
@semantic_bp.route('/import', methods=['POST'])
@require_auth
def import_semantic():
    """从JSON导入语义层"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'success': False,
                'error': 'No data provided'
            }), 400
            
        # 创建临时文件
        import tempfile
        import uuid
        
        filename = f"import_{uuid.uuid4()}.json"
        filepath = os.path.join(tempfile.gettempdir(), filename)
        
        # 写入数据
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            
        manager, _ = init_semantic_layer()
        success = manager.import_semantic_layer(filepath)
        
        # 删除临时文件
        os.remove(filepath)
        
        if success:
            stats = manager.get_statistics()
            return jsonify({
                'success': True,
                'message': 'Semantic layer imported successfully',
                'statistics': stats
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Failed to import semantic layer'
            }), 500
    except Exception as e:
        logger.error(f"Failed to import semantic: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# 获取统计信息
@semantic_bp.route('/statistics', methods=['GET'])
@require_auth
def get_statistics():
    """获取语义层统计信息"""
    try:
        manager, _ = init_semantic_layer()
        stats = manager.get_statistics()
        
        return jsonify({
            'success': True,
            'statistics': stats
        })
    except Exception as e:
        logger.error(f"Failed to get statistics: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# 增强查询
@semantic_bp.route('/enhance-query', methods=['POST'])
@require_auth
def enhance_query():
    """使用语义信息增强查询"""
    try:
        data = request.get_json()
        user_query = data.get('query', '')
        datasource_id = data.get('datasource_id')
        
        if not user_query:
            return jsonify({
                'success': False,
                'error': 'Query is required'
            }), 400
            
        manager, mapper = init_semantic_layer()
        enhanced_prompt = mapper.enhance_prompt_with_semantics(user_query, datasource_id)
        
        return jsonify({
            'success': True,
            'original_query': user_query,
            'enhanced_prompt': enhanced_prompt
        })
    except Exception as e:
        logger.error(f"Failed to enhance query: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def register_semantic_routes(app):
    """注册语义层路由到Flask应用"""
    app.register_blueprint(semantic_bp)
    logger.info("Semantic layer routes registered")