"""
工具函数模块
提供通用的辅助功能
"""
import json
import logging
from functools import wraps
from flask import jsonify
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

def create_response(success: bool = True, 
                   data: Optional[Dict] = None, 
                   error: Optional[str] = None, 
                   status_code: int = 200) -> Tuple[Dict, int]:
    """
    创建标准化的API响应
    
    Args:
        success: 操作是否成功
        data: 响应数据
        error: 错误信息
        status_code: HTTP状态码
        
    Returns:
        (响应字典, 状态码)
    """
    response = {"success": success}
    
    if data is not None:
        response.update(data)
    
    if error is not None:
        response["error"] = error
        
    return jsonify(response), status_code

def handle_api_errors(func):
    """
    API错误处理装饰器
    自动捕获异常并返回标准错误响应
    """
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except ValueError as e:
            logger.warning(f"{func.__name__} - 参数错误: {e}")
            return create_response(
                success=False, 
                error=str(e), 
                status_code=400
            )
        except PermissionError as e:
            logger.warning(f"{func.__name__} - 权限错误: {e}")
            return create_response(
                success=False,
                error="权限不足",
                status_code=403
            )
        except Exception as e:
            logger.error(f"{func.__name__} - 未预期错误: {e}", exc_info=True)
            return create_response(
                success=False,
                error="服务器内部错误",
                status_code=500
            )
    return wrapper

def validate_json_request(required_fields: list):
    """
    验证JSON请求装饰器
    检查必需字段是否存在
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            from flask import request
            
            if not request.is_json:
                return create_response(
                    success=False,
                    error="请求必须是JSON格式",
                    status_code=400
                )
            
            data = request.get_json()
            missing_fields = [
                field for field in required_fields 
                if field not in data or data[field] is None
            ]
            
            if missing_fields:
                return create_response(
                    success=False,
                    error=f"缺少必需字段: {', '.join(missing_fields)}",
                    status_code=400
                )
            
            return func(*args, **kwargs)
        return wrapper
    return decorator

def sanitize_sql_query(query: str) -> str:
    """
    清理SQL查询，防止SQL注入
    
    Args:
        query: 原始SQL查询
        
    Returns:
        清理后的SQL查询
    """
    # 移除危险的SQL关键字
    dangerous_keywords = [
        'DROP', 'DELETE', 'INSERT', 'UPDATE', 'ALTER', 
        'CREATE', 'TRUNCATE', 'EXEC', 'EXECUTE'
    ]
    
    query_upper = query.upper()
    for keyword in dangerous_keywords:
        if keyword in query_upper:
            raise ValueError(f"不允许执行{keyword}操作")
    
    # 智能移除注释，避免误删字符串字面量中的内容
    cleaned_query = []
    in_single_quote = False
    in_double_quote = False
    i = 0
    
    while i < len(query):
        # 处理字符串字面量
        if query[i] == "'" and not in_double_quote:
            in_single_quote = not in_single_quote
            cleaned_query.append(query[i])
            i += 1
        elif query[i] == '"' and not in_single_quote:
            in_double_quote = not in_double_quote
            cleaned_query.append(query[i])
            i += 1
        # 只在字符串外移除注释
        elif not in_single_quote and not in_double_quote:
            # 检查单行注释 --
            if i < len(query) - 1 and query[i:i+2] == '--':
                # 跳过直到行尾
                while i < len(query) and query[i] != '\n':
                    i += 1
                if i < len(query):
                    cleaned_query.append('\n')  # 保留换行
                    i += 1
            # 检查多行注释 /* */
            elif i < len(query) - 1 and query[i:i+2] == '/*':
                # 跳过直到 */
                i += 2
                while i < len(query) - 1:
                    if query[i:i+2] == '*/':
                        i += 2
                        break
                    i += 1
            else:
                cleaned_query.append(query[i])
                i += 1
        else:
            # 在字符串内，保留所有字符
            cleaned_query.append(query[i])
            i += 1
    
    return ''.join(cleaned_query).strip()

def format_datetime(dt) -> str:
    """
    格式化日期时间为统一格式
    
    Args:
        dt: datetime对象
        
    Returns:
        格式化的日期时间字符串
    """
    if dt is None:
        return None
    return dt.strftime('%Y-%m-%d %H:%M:%S')

def safe_json_dumps(obj: Any, default=str) -> str:
    """
    安全的JSON序列化
    处理datetime等特殊类型
    
    Args:
        obj: 要序列化的对象
        default: 默认转换函数
        
    Returns:
        JSON字符串
    """
    return json.dumps(obj, default=default, ensure_ascii=False)

def get_client_ip():
    """
    获取客户端IP地址
    
    Returns:
        IP地址字符串
    """
    from flask import request
    
    if request.headers.get('X-Forwarded-For'):
        return request.headers['X-Forwarded-For'].split(',')[0]
    elif request.headers.get('X-Real-IP'):
        return request.headers['X-Real-IP']
    else:
        return request.remote_addr or '127.0.0.1'
