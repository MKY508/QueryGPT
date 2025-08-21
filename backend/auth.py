"""
简单的身份认证模块
提供基本的API密钥认证
"""
import os
import hashlib
import hmac
import time
from functools import wraps
from flask import request, jsonify
import logging

logger = logging.getLogger(__name__)

class SimpleAuth:
    """简单的认证管理器"""
    
    def __init__(self):
        # 从环境变量获取API访问密钥
        self.api_secret = os.getenv('API_ACCESS_SECRET', None)
        if not self.api_secret:
            logger.warning("API_ACCESS_SECRET未设置，认证功能将被禁用")
        
        # 存储有效的会话令牌（生产环境应使用Redis）
        self.valid_tokens = {}
        # 令牌过期时间（秒）
        self.token_ttl = 3600  # 1小时
    
    def generate_token(self, user_id: str) -> str:
        """生成访问令牌"""
        if not self.api_secret:
            return "no-auth-token"
        
        # 生成令牌
        timestamp = str(int(time.time()))
        message = f"{user_id}:{timestamp}"
        token = hmac.new(
            self.api_secret.encode(),
            message.encode(),
            hashlib.sha256
        ).hexdigest()
        
        # 存储令牌
        self.valid_tokens[token] = {
            'user_id': user_id,
            'created_at': time.time()
        }
        
        return token
    
    def verify_token(self, token: str) -> bool:
        """验证令牌是否有效"""
        if not self.api_secret:
            return True  # 未配置认证时允许访问
        
        if token not in self.valid_tokens:
            return False
        
        # 检查令牌是否过期
        token_info = self.valid_tokens[token]
        if time.time() - token_info['created_at'] > self.token_ttl:
            del self.valid_tokens[token]
            return False
        
        return True
    
    def cleanup_expired_tokens(self):
        """清理过期的令牌"""
        current_time = time.time()
        expired_tokens = [
            token for token, info in self.valid_tokens.items()
            if current_time - info['created_at'] > self.token_ttl
        ]
        for token in expired_tokens:
            del self.valid_tokens[token]

# 创建全局认证实例
auth_manager = SimpleAuth()

def require_auth(f):
    """认证装饰器"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # 如果未配置认证，直接通过
        if not auth_manager.api_secret:
            return f(*args, **kwargs)
        
        # 从请求头获取令牌
        auth_header = request.headers.get('Authorization')
        if not auth_header:
            return jsonify({'error': '缺少认证令牌'}), 401
        
        # 解析令牌（格式：Bearer <token>）
        parts = auth_header.split()
        if len(parts) != 2 or parts[0] != 'Bearer':
            return jsonify({'error': '无效的认证格式'}), 401
        
        token = parts[1]
        
        # 验证令牌
        if not auth_manager.verify_token(token):
            return jsonify({'error': '无效或过期的令牌'}), 401
        
        return f(*args, **kwargs)
    
    return decorated_function

def optional_auth(f):
    """可选认证装饰器 - 有令牌时验证，没有时也允许访问"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # 如果提供了令牌，验证它
        auth_header = request.headers.get('Authorization')
        if auth_header and auth_manager.api_secret:
            parts = auth_header.split()
            if len(parts) == 2 and parts[0] == 'Bearer':
                token = parts[1]
                if not auth_manager.verify_token(token):
                    return jsonify({'error': '无效或过期的令牌'}), 401
        
        return f(*args, **kwargs)
    
    return decorated_function