"""
改进的日志配置 - 解决QueryGPT日志文件暴涨问题
包含日志轮转、大小限制和性能优化
"""
import logging
import logging.handlers
import os
from pathlib import Path

def setup_logging(app_name="querygpt", log_dir=None):
    """设置日志系统，包含轮转和大小限制"""
    
    # 确定日志目录
    if log_dir is None:
        log_dir = Path(__file__).parent.parent / "logs"
    else:
        log_dir = Path(log_dir)
    
    # 创建日志目录
    log_dir.mkdir(exist_ok=True)
    
    # 日志文件路径
    log_file = log_dir / f"{app_name}.log"
    
    # 创建格式化器
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - [%(filename)s:%(lineno)d] - %(message)s'
    )
    
    # 创建轮转文件处理器（每个文件最大10MB，保留5个备份）
    file_handler = logging.handlers.RotatingFileHandler(
        log_file,
        maxBytes=10*1024*1024,  # 10MB
        backupCount=5,
        encoding='utf-8'
    )
    file_handler.setFormatter(formatter)
    file_handler.setLevel(logging.INFO)  # 文件只记录INFO及以上
    
    # 创建控制台处理器
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    console_handler.setLevel(logging.WARNING)  # 控制台只显示WARNING及以上
    
    # 配置根日志器
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    
    # 清除现有处理器
    root_logger.handlers.clear()
    
    # 添加处理器
    root_logger.addHandler(file_handler)
    root_logger.addHandler(console_handler)
    
    # 降低第三方库的日志级别（这些是造成日志暴涨的主要原因）
    third_party_loggers = [
        'urllib3',
        'werkzeug',
        'litellm',
        'httpx',
        'openai',
        'httpcore',
        'requests',
        'transformers',
        'tensorflow',
        'torch',
        'sqlalchemy',
        'alembic',
        'PIL',
        'matplotlib',
        'numpy',
        'pandas',
        'selenium',
        'uvicorn',
        'fastapi'
    ]
    
    for logger_name in third_party_loggers:
        logging.getLogger(logger_name).setLevel(logging.WARNING)
    
    # 特别处理LiteLLM（这个库的日志特别多）
    logging.getLogger('LiteLLM').setLevel(logging.ERROR)
    logging.getLogger('litellm.utils').setLevel(logging.ERROR)
    logging.getLogger('litellm.litellm_core_utils').setLevel(logging.ERROR)
    logging.getLogger('litellm.proxy').setLevel(logging.ERROR)
    
    return root_logger

def clean_old_logs(log_dir=None, days=7):
    """清理旧日志文件"""
    if log_dir is None:
        log_dir = Path(__file__).parent.parent / "logs"
    else:
        log_dir = Path(log_dir)
    
    if not log_dir.exists():
        return
    
    from datetime import datetime, timedelta
    
    cutoff_time = datetime.now() - timedelta(days=days)
    
    for log_file in log_dir.glob("*.log*"):
        try:
            mtime = datetime.fromtimestamp(log_file.stat().st_mtime)
            if mtime < cutoff_time:
                log_file.unlink()
                print(f"删除旧日志: {log_file}")
        except Exception as e:
            print(f"无法删除 {log_file}: {e}")

def setup_request_logging():
    """设置请求日志的特殊处理"""
    import logging
    
    class RequestFilter(logging.Filter):
        """过滤器：减少请求日志的冗余信息"""
        def filter(self, record):
            # 过滤掉某些不必要的日志
            if record.name == 'werkzeug':
                # 只保留错误和警告
                return record.levelno >= logging.WARNING
            
            # 过滤掉健康检查的日志
            if hasattr(record, 'getMessage'):
                msg = record.getMessage()
                if '/health' in msg or '/ping' in msg:
                    return False
                    
            return True
    
    # 添加过滤器到根日志器
    for handler in logging.getLogger().handlers:
        handler.addFilter(RequestFilter())
