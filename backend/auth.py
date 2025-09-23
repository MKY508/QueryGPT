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
            logger.debug("API_ACCESS_SECRET 未设置，跳过认证模块初始化")
        
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
        # 安全修复：验证令牌格式，防止注入攻击
        if not token or not isinstance(token, str):
            return False
        
        # 检查是否包含危险字符（路径遍历、XSS等）
        dangerous_patterns = [
            '../',  # 路径遍历
            '..',   # 路径遍历
            '<',    # XSS
            '>',    # XSS
            'script',  # XSS
            'javascript:',  # XSS
            'onclick',  # XSS
            '\x00',  # 空字节注入
            '\n',   # 换行符注入
            '\r',   # 回车符注入
        ]
        
        token_lower = token.lower()
        for pattern in dangerous_patterns:
            if pattern in token_lower:
                logger.warning(f"检测到危险的令牌模式: {pattern}")
                return False
        
        # 验证令牌格式（应该是十六进制字符串）
        import re
        if not re.match(r'^[a-f0-9]{64}$', token) and token != "no-auth-token":
            logger.warning(f"无效的令牌格式: {token[:10]}...")
            return False
        
        if not self.api_secret:
            # 未配置认证时，只允许特定的无认证令牌
            return token == "no-auth-token"
        
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

    # 兼容测试：提供 is_enabled 方法
    def is_enabled(self) -> bool:
        return bool(self.api_secret)

# 创建全局认证实例
auth_manager = SimpleAuth()

def require_auth(f):
    """认证装饰器"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # 如果未配置认证，直接通过
        if not auth_manager.is_enabled():
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
        if auth_header and auth_manager.is_enabled():
            parts = auth_header.split()
            if len(parts) == 2 and parts[0] == 'Bearer':
                token = parts[1]
                if not auth_manager.verify_token(token):
                    return jsonify({'error': '无效或过期的令牌'}), 401
        
        return f(*args, **kwargs)
    
    return decorated_function
