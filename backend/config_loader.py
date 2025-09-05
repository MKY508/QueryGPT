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
    _env_loaded = False

    @staticmethod
    def normalize_model_id(model_id: str) -> str:
        """将常见别名标准化为统一ID，避免前后端显示/调用不一致。
        例如：'gpt-4.1' -> 'gpt-4o', '4o' -> 'gpt-4o'.
        """
        if not model_id:
            return model_id
        mid = model_id.strip().lower()
        mapping = {
            'gpt-4.1': 'gpt-4o',
            '4.1': 'gpt-4o',
            '4o': 'gpt-4o',
        }
        return mapping.get(mid, model_id)
    
    @staticmethod
    def load_env():
        """加载.env文件中的环境变量"""
        # 测试环境下避免读取 .env 干扰单测的 patch.dict
        if os.getenv('TESTING', '').lower() == 'true':
            return
        if ConfigLoader._env_loaded:
            return
        env_path = Path(__file__).parent.parent / '.env'
        env_example_path = Path(__file__).parent.parent / '.env.example'

        if env_path.exists():
            try:
                with open(env_path, 'r') as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith('#'):
                            if '=' in line:
                                key, value = line.split('=', 1)
                                os.environ[key.strip()] = value.strip()
                logger.info("已加载.env文件配置")
            except Exception as e:
                logger.warning(f"读取.env失败: {e}")
        else:
            logger.warning(f".env文件不存在: {env_path}")
            if env_example_path.exists():
                logger.info("请根据 .env.example 创建 .env 文件并配置相关参数")
                logger.info("执行: cp .env.example .env 然后编辑 .env 文件")
        ConfigLoader._env_loaded = True
    
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
    
    # 简单缓存以避免每次磁盘IO读取models.json
    _api_config_cache: Dict[str, Any] | None = None
    _models_mtime: float | None = None

    @staticmethod
    def get_api_config() -> Dict[str, Any]:
        """获取API配置 - 优先从models.json读取模型配置，其次从环境变量"""
        ConfigLoader.load_env()
        
        # 先尝试从 models.json 文件读取模型配置
        models_config = {}
        models_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config', 'models.json')
        try:
            if os.path.exists(models_path):
                mtime = os.path.getmtime(models_path)
                if ConfigLoader._api_config_cache is not None and ConfigLoader._models_mtime == mtime:
                    # 直接基于缓存返回（在函数尾部构建完整dict）
                    cached = ConfigLoader._api_config_cache
                else:
                    import json
                    with open(models_path, 'r', encoding='utf-8') as f:
                        models_data = json.load(f)
                    if isinstance(models_data, dict) and 'models' in models_data:
                        models_config = models_data['models']
                    elif isinstance(models_data, list):
                        models_config = models_data
                    logger.info(f"从models.json加载了 {len(models_config)} 个模型配置")
                    ConfigLoader._models_mtime = mtime
                    cached = None
            else:
                cached = None
        except Exception as e:
            logger.warning(f"读取models.json失败: {e}")
            cached = None
        
        # 从环境变量获取默认的API配置
        api_key = (
            os.getenv("OPENAI_API_KEY") or               # 标准OpenAI命名
            os.getenv("API_KEY") or                      # 旧命名（向后兼容）
            os.getenv("LLM_API_KEY") or                  # 备选命名
            "not-needed"                                 # 默认值（用于本地模型）
        )
        
        # 统一走 OpenAI 兼容路径（可被 OPENAI_BASE_URL 覆盖）
        api_base = (
            os.getenv("OPENAI_BASE_URL") or 'https://api.openai.com/v1'
        )
        
        # 获取默认模型并标准化
        default_model = ConfigLoader.normalize_model_id(os.getenv("DEFAULT_MODEL", "gpt-4o"))
        
        # 构建模型字典：如果有models.json配置就使用，否则使用默认配置
        models = {}
        if ConfigLoader._api_config_cache is not None and cached is ConfigLoader._api_config_cache:
            return ConfigLoader._api_config_cache
        if models_config:
            # 使用models.json中的配置
            placeholder_keys = {
                '', 'not-needed', 'not_needed', 'notneeded',
                'your-openai-api-key-here', 'your-anthropic-api-key-here',
                'your-custom-api-key-here', 'your-api-key-here'
            }
            for model in models_config:
                model_id_raw = model.get('id', model.get('name', ''))
                model_id = ConfigLoader.normalize_model_id(model_id_raw)
                if model_id:
                    # 选择 per-model api_base（若未提供则回退到全局 OPENAI_BASE_URL）
                    per_base = model.get('api_base') or model.get('base_url') or api_base
                    # 选择 api_key：若为占位符或空，则回退到环境变量
                    per_key = (model.get('api_key') or '').strip()
                    key_to_use = per_key if per_key not in placeholder_keys else api_key
                    models[model_id] = {
                        "api_key": key_to_use,
                        "base_url": per_base,
                        "model_name": model.get('model_name', model_id),
                        "status": model.get('status', 'inactive')
                    }
            # 设置默认模型为第一个active的模型
            active_models = [m for m in models_config if m.get('status') == 'active']
            if active_models:
                default_model = ConfigLoader.normalize_model_id(active_models[0].get('id', default_model))
        else:
            # 如果没有models.json，使用默认配置
            models = {
                "gpt-4o": {
                    "api_key": api_key,
                    "base_url": api_base,
                    "model_name": "gpt-4o"
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
        
        # 记录实际使用的模型
        logger.info(f"使用模型配置: default_model={default_model}, 总共 {len(models)} 个模型")
        
        api_conf = {
            "api_key": api_key,
            "api_base": api_base,
            "default_model": default_model,
            "current_model": default_model,  # 添加 current_model 字段
            "models": models
        }
        # 写入缓存
        ConfigLoader._api_config_cache = api_conf
        return api_conf

    @staticmethod
    def get_available_models() -> list:
        """返回可用模型ID列表（供兼容性或前端简单调用）。"""
        api = ConfigLoader.get_api_config()
        return [ConfigLoader.normalize_model_id(k) for k in api.get('models', {}).keys()]

    @staticmethod
    def get_config() -> Dict[str, Any]:
        """返回聚合配置（向后兼容tests期望）。"""
        return {
            "api": {
                "key": os.getenv("OPENAI_API_KEY") or os.getenv("API_KEY", ""),
                "base_url": os.getenv("OPENAI_BASE_URL") or os.getenv("OPENAI_API_BASE") or os.getenv("API_BASE_URL", ""),
                "model": os.getenv("DEFAULT_MODEL", "gpt-4.1"),
                "max_retries": int(os.getenv("API_MAX_RETRIES", "3")),
            },
            "database": ConfigLoader.get_database_config(),
            "security": {
                "enable_auth": os.getenv("ENABLE_AUTH", "false").lower() == "true",
                "allowed_origins": [os.getenv("ALLOWED_ORIGIN", "http://localhost:3000")],
                "rate_limit": int(os.getenv("RATE_LIMIT", "60"))
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
