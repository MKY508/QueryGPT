"""
输入验证模块
提供请求参数验证和清理
"""
import re
from typing import Dict, Any, Optional
from functools import wraps
from flask import request, jsonify
import logging

logger = logging.getLogger(__name__)

class InputValidator:
    """输入验证器"""
    
    # 定义验证规则
    RULES = {
        'message': {
            'type': str,
            'min_length': 1,
            'max_length': 2000,
            'required': True,
            'pattern': None  # 允许任何文本
        },
        'model': {
            'type': str,
            'allowed_values': ['gpt-4.1', 'claude-sonnet-4', 'deepseek-r1', 'qwen-flagship'],
            'required': False,
            'default': 'gpt-4.1'
        },
        'conversation_id': {
            'type': str,
            'pattern': r'^[a-f0-9\-]{36}$',  # UUID格式
            'required': False
        },
        'context_rounds': {
            'type': int,
            'min_value': 0,
            'max_value': 10,
            'required': False,
            'default': 3
        },
        'use_database': {
            'type': bool,
            'required': False,
            'default': True
        }
    }
    
    @classmethod
    def validate_field(cls, field_name: str, value: Any) -> tuple[bool, Optional[str], Any]:
        """
        验证单个字段
        
        Returns:
            (是否有效, 错误信息, 清理后的值)
        """
        if field_name not in cls.RULES:
            return True, None, value  # 未定义的字段直接通过
        
        rule = cls.RULES[field_name]
        
        # 检查必需字段
        if value is None:
            if rule.get('required', False):
                return False, f"缺少必需字段: {field_name}", None
            else:
                return True, None, rule.get('default')
        
        # 类型检查
        expected_type = rule.get('type')
        if expected_type and not isinstance(value, expected_type):
            # 尝试类型转换
            try:
                if expected_type == bool:
                    value = str(value).lower() in ('true', '1', 'yes')
                elif expected_type == int:
                    value = int(value)
                elif expected_type == str:
                    value = str(value)
            except (ValueError, TypeError):
                return False, f"字段 {field_name} 类型错误，期望 {expected_type.__name__}", None
        
        # 字符串长度检查
        if isinstance(value, str):
            if 'min_length' in rule and len(value) < rule['min_length']:
                return False, f"字段 {field_name} 太短，最少 {rule['min_length']} 字符", None
            if 'max_length' in rule and len(value) > rule['max_length']:
                return False, f"字段 {field_name} 太长，最多 {rule['max_length']} 字符", None
            
            # 正则表达式验证
            if 'pattern' in rule and rule['pattern']:
                if not re.match(rule['pattern'], value):
                    return False, f"字段 {field_name} 格式不正确", None
        
        # 数值范围检查
        if isinstance(value, (int, float)):
            if 'min_value' in rule and value < rule['min_value']:
                return False, f"字段 {field_name} 值太小，最小值 {rule['min_value']}", None
            if 'max_value' in rule and value > rule['max_value']:
                return False, f"字段 {field_name} 值太大，最大值 {rule['max_value']}", None
        
        # 允许值检查
        if 'allowed_values' in rule and value not in rule['allowed_values']:
            return False, f"字段 {field_name} 值无效，允许的值: {rule['allowed_values']}", None
        
        return True, None, value
    
    @classmethod
    def validate_request(cls, data: Dict[str, Any]) -> tuple[bool, Dict[str, Any], Optional[str]]:
        """
        验证整个请求
        
        Returns:
            (是否有效, 清理后的数据, 错误信息)
        """
        cleaned_data = {}
        errors = []
        
        # 验证每个字段
        for field_name, rule in cls.RULES.items():
            value = data.get(field_name)
            is_valid, error_msg, cleaned_value = cls.validate_field(field_name, value)
            
            if not is_valid:
                errors.append(error_msg)
            elif cleaned_value is not None or not rule.get('required', False):
                cleaned_data[field_name] = cleaned_value
        
        if errors:
            return False, {}, '; '.join(errors)
        
        # 添加未在规则中的字段（保持向后兼容）
        for key, value in data.items():
            if key not in cleaned_data and key not in cls.RULES:
                # 对未知字段进行基本的XSS清理
                if isinstance(value, str):
                    value = cls.sanitize_string(value)
                cleaned_data[key] = value
        
        return True, cleaned_data, None
    
    @staticmethod
    def sanitize_string(text: str) -> str:
        """清理字符串，防止XSS"""
        if not text:
            return text
        
        # 移除或转义危险字符
        dangerous_patterns = [
            (r'<script[^>]*>.*?</script>', ''),  # 移除script标签
            (r'javascript:', ''),  # 移除javascript协议
            (r'on\w+\s*=', ''),  # 移除事件处理器
            (r'<iframe[^>]*>.*?</iframe>', ''),  # 移除iframe
        ]
        
        for pattern, replacement in dangerous_patterns:
            text = re.sub(pattern, replacement, text, flags=re.IGNORECASE | re.DOTALL)
        
        return text.strip()

def is_readonly_query(query: str) -> bool:
    """
    验证SQL查询是否为只读查询
    
    Args:
        query: SQL查询字符串
        
    Returns:
        如果是安全的只读查询返回True，否则返回False
    """
    if not query:
        return False
    
    # 移除多余空格和换行
    query = ' '.join(query.split())
    
    # 只允许这些只读操作
    READONLY_PATTERN = re.compile(
        r'^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\s+',
        re.IGNORECASE
    )
    
    if not READONLY_PATTERN.match(query):
        return False
    
    # 检查危险的SQL模式
    DANGEROUS_PATTERNS = [
        r';\s*(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|TRUNCATE|EXEC|GRANT)',
        r'--',  # SQL注释
        r'/\*.*\*/',  # 块注释
        r'UNION\s+SELECT',  # UNION注入
        r'INTO\s+OUTFILE',  # 文件写入
        r'LOAD_FILE',  # 文件读取
        r'BENCHMARK',  # DoS攻击
        r'SLEEP',  # 基于时间的攻击
        r'@@version',  # 版本泄露（除非在SELECT中）
        r'information_schema',  # 架构探测（除非在SHOW命令中）
    ]
    
    for pattern in DANGEROUS_PATTERNS:
        if re.search(pattern, query, re.IGNORECASE):
            logger.warning(f"检测到危险的SQL模式: {pattern}")
            return False
    
    return True

def validate_input(rules: Dict[str, Dict] = None):
    """
    输入验证装饰器
    
    Args:
        rules: 自定义验证规则（可选）
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            # 获取请求数据
            if request.method == 'POST':
                data = request.get_json() or {}
            else:
                data = request.args.to_dict()
            
            # 使用自定义规则或默认规则
            if rules:
                # 临时替换规则
                original_rules = InputValidator.RULES.copy()
                InputValidator.RULES.update(rules)
                is_valid, cleaned_data, error_msg = InputValidator.validate_request(data)
                InputValidator.RULES = original_rules
            else:
                is_valid, cleaned_data, error_msg = InputValidator.validate_request(data)
            
            if not is_valid:
                return jsonify({
                    'error': '输入验证失败',
                    'details': error_msg
                }), 400
            
            # 将清理后的数据注入到请求中
            request.validated_data = cleaned_data
            
            return f(*args, **kwargs)
        
        return decorated_function
    return decorator