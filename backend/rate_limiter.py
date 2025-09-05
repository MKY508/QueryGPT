"""
请求速率限制模块
防止API滥用和DDoS攻击
"""
import time
from collections import defaultdict, deque
from functools import wraps
from flask import request, jsonify
import logging

logger = logging.getLogger(__name__)

class RateLimiter:
    """简单的请求速率限制器"""
    
    def __init__(self, max_requests=60, window_seconds=60):
        """
        初始化速率限制器
        
        Args:
            max_requests: 时间窗口内最大请求数
            window_seconds: 时间窗口（秒）
        """
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        # 存储每个IP的请求时间戳
        self.requests = defaultdict(deque)
        # 黑名单（被临时封禁的IP）
        self.blacklist = {}
        # 封禁时长（秒）
        self.ban_duration = 300  # 5分钟
    
    def is_allowed(self, identifier: str) -> bool:
        """
        检查请求是否被允许
        
        Args:
            identifier: 请求标识符（通常是IP地址）
            
        Returns:
            是否允许请求
        """
        # 使用monotonic避免系统时间回拨影响
        current_time = time.monotonic()
        
        # 检查是否在黑名单中
        if identifier in self.blacklist:
            ban_end_time = self.blacklist[identifier]
            if current_time < ban_end_time:
                return False
            else:
                # 解除封禁
                del self.blacklist[identifier]
        
        # 获取该标识符的请求历史
        request_times = self.requests[identifier]
        
        # 移除时间窗口外的请求
        window_start = current_time - self.window_seconds
        while request_times and request_times[0] < window_start:
            request_times.popleft()
        
        # 检查是否超过限制
        if len(request_times) >= self.max_requests:
            # 添加到黑名单
            self.blacklist[identifier] = current_time + self.ban_duration
            logger.warning(f"IP {identifier} 因超过速率限制被封禁")
            return False
        
        # 记录新请求
        request_times.append(current_time)
        return True
    
    def get_client_identifier(self) -> str:
        """获取客户端标识符（IP地址）"""
        # 尝试获取真实IP
        if request.headers.get('X-Forwarded-For'):
            return request.headers['X-Forwarded-For'].split(',')[0]
        elif request.headers.get('X-Real-IP'):
            return request.headers['X-Real-IP']
        else:
            return request.remote_addr or '127.0.0.1'
    
    def cleanup(self):
        """清理过期的数据"""
        current_time = time.time()
        window_start = current_time - self.window_seconds
        
        # 清理请求历史
        for identifier in list(self.requests.keys()):
            request_times = self.requests[identifier]
            while request_times and request_times[0] < window_start:
                request_times.popleft()
            if not request_times:
                del self.requests[identifier]
        
        # 清理过期的黑名单
        expired_bans = [
            ip for ip, ban_end in self.blacklist.items()
            if current_time >= ban_end
        ]
        for ip in expired_bans:
            del self.blacklist[ip]

# 创建不同级别的限制器
general_limiter = RateLimiter(max_requests=60, window_seconds=60)  # 每分钟60次
strict_limiter = RateLimiter(max_requests=10, window_seconds=60)   # 每分钟10次（敏感操作）

def rate_limit(limiter=None, max_requests=None, window_seconds=None):
    """
    速率限制装饰器
    
    Args:
        limiter: 使用的限制器实例
        max_requests: 自定义最大请求数
        window_seconds: 自定义时间窗口
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            # 使用指定的限制器或创建新的
            if limiter:
                rate_limiter = limiter
            elif max_requests and window_seconds:
                rate_limiter = RateLimiter(max_requests, window_seconds)
            else:
                rate_limiter = general_limiter
            
            # 获取客户端标识
            client_id = rate_limiter.get_client_identifier()
            
            # 检查是否允许请求
            if not rate_limiter.is_allowed(client_id):
                remaining_time = 0
                if client_id in rate_limiter.blacklist:
                    remaining_time = int(rate_limiter.blacklist[client_id] - time.monotonic())
                
                return jsonify({
                    'error': '请求过于频繁，请稍后再试',
                    'retry_after': remaining_time
                }), 429
            
            return f(*args, **kwargs)
        
        return decorated_function
    return decorator

# 定期清理任务（应该在后台线程中运行）
def cleanup_rate_limiters():
    """清理所有速率限制器的过期数据"""
    general_limiter.cleanup()
    strict_limiter.cleanup()
    logger.debug("速率限制器清理完成")
