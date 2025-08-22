#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Swagger/OpenAPI integration for QueryGPT API documentation.
This module integrates Flasgger with Flask to provide interactive API documentation.
"""

from flasgger import Swagger
from flask import Flask
import yaml
import os

def init_swagger(app: Flask):
    """
    Initialize Swagger documentation for the Flask application.
    
    Args:
        app: Flask application instance
    
    Returns:
        Swagger instance
    """
    
    # Load OpenAPI specification from YAML file
    openapi_spec_path = os.path.join(
        os.path.dirname(os.path.dirname(__file__)),
        'docs', 'api', 'openapi.yaml'
    )
    
    # Check if OpenAPI spec exists
    if not os.path.exists(openapi_spec_path):
        print(f"Warning: OpenAPI specification not found at {openapi_spec_path}")
        return None
    
    with open(openapi_spec_path, 'r', encoding='utf-8') as f:
        openapi_spec = yaml.safe_load(f)
    
    # Swagger configuration
    swagger_config = {
        "headers": [],
        "specs": [
            {
                "endpoint": 'apispec',
                "route": '/api/apispec.json',
                "rule_filter": lambda rule: True,
                "model_filter": lambda tag: True,
            }
        ],
        "static_url_path": "/api/static",
        "swagger_ui": True,
        "specs_route": "/api/docs",
        "title": "QueryGPT API Documentation",
        "version": openapi_spec.get('info', {}).get('version', '0.4.3'),
        "description": openapi_spec.get('info', {}).get('description', ''),
        "termsOfService": "/api/terms",
        "hide_top_bar": False,
        "swagger_ui_config": {
            "displayOperationId": False,
            "displayRequestDuration": True,
            "docExpansion": "list",
            "filter": True,
            "showExtensions": True,
            "showCommonExtensions": True,
            "tryItOutEnabled": True,
            "supportedSubmitMethods": ["get", "post", "put", "delete", "patch"],
            "validatorUrl": None,
            "persistAuthorization": True,
            "syntaxHighlight": {
                "activate": True,
                "theme": "monokai"
            }
        }
    }
    
    # Template for Swagger UI
    template = {
        "swagger": "2.0",
        "info": openapi_spec.get('info', {}),
        "servers": openapi_spec.get('servers', []),
        "basePath": "/",
        "schemes": ["http", "https"],
        "consumes": ["application/json"],
        "produces": ["application/json"],
        "securityDefinitions": {
            "Bearer": {
                "type": "apiKey",
                "name": "Authorization",
                "in": "header",
                "description": "JWT Authorization header using the Bearer scheme. Example: 'Bearer {token}'"
            }
        },
        "definitions": openapi_spec.get('components', {}).get('schemas', {}),
        "paths": convert_openapi_to_swagger2(openapi_spec.get('paths', {})),
        "tags": openapi_spec.get('tags', [])
    }
    
    # Initialize Swagger
    swagger = Swagger(app, config=swagger_config, template=template)
    
    return swagger


def convert_openapi_to_swagger2(paths):
    """
    Convert OpenAPI 3.0 paths to Swagger 2.0 format.
    
    Args:
        paths: OpenAPI 3.0 paths object
    
    Returns:
        Swagger 2.0 compatible paths
    """
    swagger2_paths = {}
    
    for path, methods in paths.items():
        swagger2_paths[path] = {}
        for method, spec in methods.items():
            if method in ['get', 'post', 'put', 'delete', 'patch', 'options', 'head']:
                swagger2_spec = {
                    'summary': spec.get('summary', ''),
                    'description': spec.get('description', ''),
                    'tags': spec.get('tags', []),
                    'operationId': spec.get('operationId', f"{method}_{path.replace('/', '_')}"),
                    'produces': ['application/json'],
                    'parameters': [],
                    'responses': {}
                }
                
                # Convert parameters
                if 'parameters' in spec:
                    swagger2_spec['parameters'] = spec['parameters']
                
                # Convert requestBody to parameters
                if 'requestBody' in spec:
                    request_body = spec['requestBody']
                    if 'content' in request_body:
                        for content_type, content_spec in request_body['content'].items():
                            if 'schema' in content_spec:
                                swagger2_spec['parameters'].append({
                                    'in': 'body',
                                    'name': 'body',
                                    'required': request_body.get('required', False),
                                    'schema': content_spec['schema']
                                })
                                break
                
                # Convert responses
                for status_code, response in spec.get('responses', {}).items():
                    swagger2_response = {
                        'description': response.get('description', '')
                    }
                    if 'content' in response:
                        for content_type, content_spec in response['content'].items():
                            if 'schema' in content_spec:
                                swagger2_response['schema'] = content_spec['schema']
                                break
                    swagger2_spec['responses'][status_code] = swagger2_response
                
                swagger2_paths[path][method] = swagger2_spec
    
    return swagger2_paths


def add_swagger_annotations(func, method='GET', path='/', summary='', description='', 
                          parameters=None, responses=None, tags=None):
    """
    Add Swagger annotations to a Flask route function.
    
    Args:
        func: Route function to annotate
        method: HTTP method
        path: API path
        summary: Short summary of the endpoint
        description: Detailed description
        parameters: List of parameters
        responses: Dictionary of responses
        tags: List of tags
    
    Returns:
        Annotated function
    """
    swagger_dict = {
        'summary': summary,
        'description': description,
        'tags': tags or [],
        'parameters': parameters or [],
        'responses': responses or {
            '200': {'description': 'Success'},
            '400': {'description': 'Bad Request'},
            '500': {'description': 'Internal Server Error'}
        }
    }
    
    if not hasattr(func, '__swagger__'):
        func.__swagger__ = {}
    
    func.__swagger__[method.lower()] = swagger_dict
    return func


# Middleware for API documentation access control
def require_auth_for_docs(app: Flask):
    """
    Add authentication requirement for API documentation in production.
    
    Args:
        app: Flask application instance
    """
    from functools import wraps
    from flask import request, jsonify, current_app
    import os
    
    @app.before_request
    def check_docs_auth():
        """Check authentication for API documentation endpoints."""
        if request.path in ['/api/docs', '/api/apispec.json'] or \
           request.path.startswith('/api/static/'):
            # In production, require authentication
            if os.getenv('FLASK_ENV') == 'production':
                auth_token = request.headers.get('Authorization')
                api_secret = os.getenv('API_ACCESS_SECRET')
                
                if api_secret and auth_token != f"Bearer {api_secret}":
                    return jsonify({'error': 'Unauthorized access to API documentation'}), 401


# Export initialization function
__all__ = ['init_swagger', 'add_swagger_annotations', 'require_auth_for_docs']