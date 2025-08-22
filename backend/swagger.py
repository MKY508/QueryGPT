"""
Swagger/OpenAPI 文档集成模块
提供交互式API文档界面
"""
import os
from flask import Flask, jsonify
from flasgger import Swagger, swag_from
import yaml

def init_swagger(app: Flask):
    """
    初始化Swagger文档
    
    Args:
        app: Flask应用实例
    """
    
    # 加载OpenAPI规范文件
    openapi_path = os.path.join(
        os.path.dirname(os.path.dirname(__file__)),
        'docs', 'api', 'openapi.yaml'
    )
    
    # 读取OpenAPI规范
    with open(openapi_path, 'r', encoding='utf-8') as f:
        openapi_spec = yaml.safe_load(f)
    
    # Swagger配置
    swagger_config = {
        "headers": [],
        "specs": [
            {
                "endpoint": 'apispec',
                "route": '/api/docs/apispec.json',
                "rule_filter": lambda rule: True,
                "model_filter": lambda tag: True,
            }
        ],
        "static_url_path": "/api/docs/static",
        "swagger_ui": True,
        "specs_route": "/api/docs/",
        "title": "QueryGPT API Documentation",
        "version": "0.4.3",
        "description": """
        QueryGPT API提供自然语言数据查询、可视化和历史管理功能。
        
        ## 快速开始
        
        1. **获取配置**: GET /api/config
        2. **测试连接**: GET /api/test_connection  
        3. **执行查询**: POST /api/chat
        
        ## 认证
        
        如果配置了API_ACCESS_SECRET，需要在请求头中提供Bearer Token：
        ```
        Authorization: Bearer <your-token>
        ```
        
        ## 速率限制
        
        - /api/chat: 每分钟30次
        - 其他端点: 无限制
        """,
        "termsOfService": "",
        "contact": {
            "name": "QueryGPT Support",
            "email": "support@querygpt.com"
        },
        "license": {
            "name": "MIT",
            "url": "https://opensource.org/licenses/MIT"
        }
    }
    
    # 模板配置
    template = {
        "swagger": "2.0",
        "info": {
            "title": openapi_spec['info']['title'],
            "description": openapi_spec['info']['description'],
            "version": openapi_spec['info']['version'],
            "contact": openapi_spec['info']['contact'],
            "license": openapi_spec['info']['license']
        },
        "host": "localhost:5001",
        "basePath": "/",
        "schemes": ["http", "https"],
        "securityDefinitions": {
            "Bearer": {
                "type": "apiKey",
                "name": "Authorization",
                "in": "header",
                "description": "在值中输入: Bearer &lt;token&gt;"
            }
        },
        "security": [
            {"Bearer": []},
            {}  # 允许无认证访问
        ],
        "tags": [
            {"name": "Chat", "description": "自然语言查询接口"},
            {"name": "Configuration", "description": "系统配置管理"},
            {"name": "Models", "description": "AI模型管理"},
            {"name": "Database", "description": "数据库操作"},
            {"name": "History", "description": "历史记录管理"},
            {"name": "System", "description": "系统状态"}
        ]
    }
    
    # 初始化Swagger
    swagger = Swagger(app, config=swagger_config, template=template)
    
    return swagger


def add_swagger_annotations(app: Flask):
    """
    为现有路由添加Swagger注解
    这个函数应该在所有路由定义之后调用
    """
    
    # 为主要端点添加文档字符串
    endpoints_docs = {
        '/api/chat': {
            'tags': ['Chat'],
            'summary': '执行自然语言查询',
            'description': '将自然语言转换为SQL查询并执行',
            'parameters': [
                {
                    'name': 'body',
                    'in': 'body',
                    'required': True,
                    'schema': {
                        'type': 'object',
                        'properties': {
                            'query': {
                                'type': 'string',
                                'description': '自然语言查询',
                                'example': '查询上月销售总额'
                            },
                            'model': {
                                'type': 'string',
                                'description': 'AI模型',
                                'enum': ['gpt-4.1', 'claude-sonnet-4', 'deepseek-r1', 'qwen-flagship']
                            },
                            'conversation_id': {
                                'type': 'string',
                                'description': '会话ID'
                            },
                            'use_database': {
                                'type': 'boolean',
                                'description': '是否使用数据库',
                                'default': True
                            },
                            'context_rounds': {
                                'type': 'integer',
                                'description': '上下文轮数',
                                'default': 3
                            }
                        },
                        'required': ['query']
                    }
                }
            ],
            'responses': {
                200: {
                    'description': '查询成功',
                    'schema': {
                        'type': 'object',
                        'properties': {
                            'success': {'type': 'boolean'},
                            'result': {'type': 'object'},
                            'model': {'type': 'string'},
                            'conversation_id': {'type': 'string'},
                            'timestamp': {'type': 'string'}
                        }
                    }
                },
                400: {'description': '请求参数错误'},
                401: {'description': '认证失败'},
                429: {'description': '超过速率限制'},
                500: {'description': '服务器错误'}
            }
        },
        '/api/config': {
            'tags': ['Configuration'],
            'summary': '获取或更新系统配置',
            'responses': {
                200: {
                    'description': '配置信息',
                    'schema': {
                        'type': 'object',
                        'properties': {
                            'api_key': {'type': 'string'},
                            'api_base': {'type': 'string'},
                            'default_model': {'type': 'string'},
                            'database': {'type': 'object'}
                        }
                    }
                }
            }
        },
        '/api/health': {
            'tags': ['System'],
            'summary': '健康检查',
            'description': '检查服务健康状态',
            'responses': {
                200: {
                    'description': '服务健康',
                    'schema': {
                        'type': 'object',
                        'properties': {
                            'status': {'type': 'string'},
                            'timestamp': {'type': 'string'},
                            'version': {'type': 'string'}
                        }
                    }
                }
            }
        }
    }
    
    return endpoints_docs


# 装饰器工厂函数
def swagger_doc(tag, summary, description=None):
    """
    创建Swagger文档装饰器
    
    Args:
        tag: API标签
        summary: 简短描述
        description: 详细描述
    """
    def decorator(f):
        f.swag_doc = {
            'tags': [tag],
            'summary': summary,
            'description': description or summary
        }
        return f
    return decorator


# 使用示例装饰器
def document_endpoint(endpoint_path):
    """
    为端点添加OpenAPI文档
    
    使用方法:
    @app.route('/api/example')
    @document_endpoint('/api/example')
    def example():
        pass
    """
    def decorator(f):
        # 从OpenAPI规范文件读取文档
        openapi_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            'docs', 'api', 'openapi.yaml'
        )
        
        with open(openapi_path, 'r', encoding='utf-8') as file:
            spec = yaml.safe_load(file)
            
        # 提取对应端点的文档
        if endpoint_path in spec.get('paths', {}):
            f.swag_doc = spec['paths'][endpoint_path]
            
        return f
    return decorator


# API响应模型
def success_response(data=None, message=None):
    """
    标准成功响应
    
    Args:
        data: 响应数据
        message: 成功消息
    
    Returns:
        dict: 标准响应格式
    """
    response = {'success': True}
    if data is not None:
        response['data'] = data
    if message:
        response['message'] = message
    return jsonify(response)


def error_response(error, code=500):
    """
    标准错误响应
    
    Args:
        error: 错误信息
        code: HTTP状态码
    
    Returns:
        tuple: (响应, 状态码)
    """
    return jsonify({
        'success': False,
        'error': str(error)
    }), code


# 导出
__all__ = [
    'init_swagger',
    'add_swagger_annotations',
    'swagger_doc',
    'document_endpoint',
    'success_response',
    'error_response'
]