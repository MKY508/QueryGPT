"""
配置加载模块 - 统一从.env文件读取配置
"""
import os
import logging
from typing import Dict, Any
from pathlib import Path

logger = logging.getLogger(__name__)

class ConfigLoader:
    """统一的配置加载器，优先使用.env文件"""
    
    @staticmethod
    def load_env():
        """加载.env文件中的环境变量"""
        env_path = Path(__file__).parent.parent / '.env'
        env_example_path = Path(__file__).parent.parent / '.env.example'
        
        if env_path.exists():
            with open(env_path, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#'):
                        if '=' in line:
                            key, value = line.split('=', 1)
                            os.environ[key.strip()] = value.strip()
            logger.info("已加载.env文件配置")
        else:
            logger.warning(f".env文件不存在: {env_path}")
            if env_example_path.exists():
                logger.info("请根据 .env.example 创建 .env 文件并配置相关参数")
                logger.info("执行: cp .env.example .env 然后编辑 .env 文件")
    
    @staticmethod
    def get_database_config() -> Dict[str, Any]:
        """获取数据库配置"""
        ConfigLoader.load_env()
        
        # 不要提供默认值，强制从环境变量读取
        db_host = os.getenv("DB_HOST")
        db_port = os.getenv("DB_PORT")
        db_user = os.getenv("DB_USER")
        db_password = os.getenv("DB_PASSWORD", "")  # 允许空密码
        
        # 验证必需的配置（密码可以为空字符串）
        if not db_host or not db_port or not db_user:
            raise ValueError(
                "数据库配置不完整，请确保.env文件包含：DB_HOST, DB_PORT, DB_USER"
            )
        
        return {
            "host": db_host,
            "port": int(db_port),
            "user": db_user,
            "password": db_password if db_password else "",  # 确保密码至少是空字符串
            "database": os.getenv("DB_DATABASE", "")
        }
    
    @staticmethod
    def get_api_config() -> Dict[str, Any]:
        """获取API配置 - 支持多种命名方式以保持向后兼容"""
        ConfigLoader.load_env()
        
        # 支持多种环境变量名称，优先使用标准命名
        api_key = (
            os.getenv("OPENAI_API_KEY") or      # 标准OpenAI命名
            os.getenv("API_KEY") or              # 旧命名（向后兼容）
            os.getenv("LLM_API_KEY")             # 备选命名
        )
        
        api_base = (
            os.getenv("OPENAI_BASE_URL") or      # 标准命名
            os.getenv("OPENAI_API_BASE") or      # OpenAI SDK标准
            os.getenv("API_BASE_URL") or         # 旧命名（向后兼容）
            os.getenv("LLM_BASE_URL")            # 备选命名
        )
        
        default_model = os.getenv("DEFAULT_MODEL", "gpt-4.1")
        
        # 验证必需的API配置
        if not api_key:
            raise ValueError("API密钥未配置，请在.env文件中设置 OPENAI_API_KEY 或 API_KEY")
        if not api_base:
            raise ValueError("API基础URL未配置，请在.env文件中设置 OPENAI_BASE_URL 或 API_BASE_URL")
        
        return {
            "api_key": api_key,
            "api_base": api_base,
            "default_model": default_model,
            "models": {
                "gpt-4.1": {
                    "api_key": api_key,
                    "base_url": api_base,
                    "model_name": "gpt-4.1"
                },
                "claude-sonnet-4": {
                    "api_key": api_key,
                    "base_url": api_base,
                    "model_name": "claude-sonnet-4"
                },
                "deepseek-r1": {
                    "api_key": api_key,
                    "base_url": api_base,
                    "model_name": "deepseek-r1"
                },
                "qwen-flagship": {
                    "api_key": api_key,
                    "base_url": api_base,
                    "model_name": "qwen-flagship"
                }
            }
        }
    
    @staticmethod
    def get_log_config() -> Dict[str, Any]:
        """获取日志配置"""
        ConfigLoader.load_env()
        
        return {
            "level": os.getenv("LOG_LEVEL", "INFO"),
            "file": os.getenv("LOG_FILE", "logs/app.log"),
            "max_size": int(os.getenv("LOG_MAX_SIZE", "10485760")),
            "backup_count": int(os.getenv("LOG_BACKUP_COUNT", "5"))
        }
    
    @staticmethod
    def get_cache_config() -> Dict[str, Any]:
        """获取缓存配置"""
        ConfigLoader.load_env()
        
        return {
            "ttl": int(os.getenv("CACHE_TTL", "3600")),
            "max_size": int(os.getenv("CACHE_MAX_SIZE", "104857600")),
            "output_dir": os.getenv("OUTPUT_DIR", "output"),
            "cache_dir": os.getenv("CACHE_DIR", "cache")
        }