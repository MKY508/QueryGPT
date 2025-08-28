"""
认证包装器
为语义层提供简化的认证功能
"""

from functools import wraps
from flask import jsonify

def require_auth(f):
    """
    简化的认证装饰器
    暂时允许所有请求，避免依赖主应用的认证系统
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # 暂时跳过认证，允许所有请求
        # 在生产环境中应该实现真正的认证
        return f(*args, **kwargs)
    return decorated_function

def optional_auth(f):
    """可选认证装饰器"""
    return f