"""
配置加载模块 - 统一从.env文件读取配置
"""
import os
import json
import logging
from typing import Dict, Any
from pathlib import Path

logger = logging.getLogger(__name__)

CONFIG_PATH = Path(__file__).parent.parent / 'config' / 'config.json'

PLACEHOLDER_KEYS = {
    '',
    'not-needed',
    'not_needed',
    'notneeded',
    'your-openai-api-key-here',
    'your-anthropic-api-key-here',
    'your-custom-api-key-here',
    'your-api-key-here'
}

MODEL_TYPE_PRESETS = {
    'openai': {
        'provider': 'openai',
        'default_base': 'https://api.openai.com/v1',
        'requires_api_key': True,
        'requires_api_base': True
    },
    'qwen': {
        'provider': 'dashscope',
        'default_base': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        'requires_api_key': True,
        'requires_api_base': True
    },
    'dashscope': {
        'provider': 'dashscope',
        'default_base': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        'requires_api_key': True,
        'requires_api_base': True
    },
    'deepseek': {
        'provider': 'deepseek',
        'default_base': 'https://api.deepseek.com/v1',
        'requires_api_key': True,
        'requires_api_base': True
    },
    'anthropic': {
        'provider': 'anthropic',
        'default_base': 'https://api.anthropic.com/v1',
        'requires_api_key': True,
        'requires_api_base': True
    },
    'groq': {
        'provider': 'groq',
        'default_base': 'https://api.groq.com/openai/v1',
        'requires_api_key': True,
        'requires_api_base': True
    },
    'azure': {
        'provider': 'azure',
        'default_base': '',
        'requires_api_key': True,
        'requires_api_base': True
    },
    'ollama': {
        'provider': 'ollama',
        'default_base': 'http://localhost:11434',
        'requires_api_key': False,
        'requires_api_base': True
    },
    'moonshot': {
        'provider': 'moonshot',
        'default_base': 'https://api.moonshot.cn/v1',
        'requires_api_key': True,
        'requires_api_base': True
    },
    'custom': {
        'provider': 'custom',
        'default_base': '',
        'requires_api_key': False,
        'requires_api_base': False
    }
}

DEFAULT_MODELS = [
    {
        "id": "gpt-4o",
        "name": "ChatGPT 4o",
        "type": "openai",
        "status": "active",
        "api_base": "https://api.openai.com/v1",
        "model_name": "gpt-4o"
    },
    {
        "id": "qwen-plus",
        "name": "Qwen Plus",
        "type": "qwen",
        "status": "inactive",
        "api_base": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "model_name": "qwen-plus"
    },
    {
        "id": "ollama-llama3",
        "name": "Ollama Llama3 本地",
        "type": "ollama",
        "status": "inactive",
        "api_base": "http://localhost:11434",
        "api_key": "not-needed",
        "model_name": "llama3:latest",
        "litellm_model": "ollama/llama3:latest",
        "requires_api_key": False
    }
]

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
            'gpt4.1': 'gpt-4o',
            '4.1': 'gpt-4o',
            '4o': 'gpt-4o',
            'chatgpt-4o': 'gpt-4o'
        }
        return mapping.get(mid, model_id)
    
    @staticmethod
    def _get_model_preset(model_type: str | None) -> Dict[str, Any]:
        key = (model_type or 'custom').strip().lower()
        preset = MODEL_TYPE_PRESETS.get(key)
        if preset:
            return dict(preset)
        return {
            'provider': key,
            'default_base': '',
            'requires_api_key': False,
            'requires_api_base': False
        }
    
    @staticmethod
    def build_litellm_model_id(provider: str | None, model_name: str | None) -> str:
        name = (model_name or '').strip()
        provider = (provider or '').strip().lower()
        if not name:
            return ''
        if provider in ('', 'openai', 'custom'):
            return name
        if '/' in name:
            return name
        return f"{provider}/{name}"
    
    @classmethod
    def normalize_model_entry(cls, model: Dict[str, Any], default_api_key: str, fallback_api_base: str) -> Dict[str, Any]:
        raw = dict(model or {})
        raw_id = str(raw.get('id') or raw.get('name') or raw.get('model') or '').strip()
        resolved_id = cls.normalize_model_id(raw_id) or raw_id
        preset = cls._get_model_preset(raw.get('type') or raw.get('provider'))
        provider = (raw.get('provider') or preset.get('provider') or 'custom').strip().lower()
        model_type = (raw.get('type') or provider or 'custom').strip().lower()
        api_base = raw.get('api_base') or raw.get('base_url') or preset.get('default_base') or fallback_api_base
        if isinstance(api_base, str):
            api_base = api_base.strip()
            if api_base.endswith('/'):
                api_base = api_base.rstrip('/')
        api_key = (raw.get('api_key') or '').strip()
        if not api_key or api_key in PLACEHOLDER_KEYS:
            api_key = default_api_key
        status = raw.get('status', 'inactive')
        name = raw.get('name') or raw_id or resolved_id
        model_name = raw.get('model_name') or raw.get('deployment_name') or raw.get('model') or raw_id or resolved_id
        litellm_model = raw.get('litellm_model') or cls.build_litellm_model_id(provider, raw.get('litellm_name') or model_name)
        requires_api_key = raw.get('requires_api_key', preset.get('requires_api_key', False))
        requires_api_base = raw.get('requires_api_base', preset.get('requires_api_base', False))

        normalized = {
            'id': raw_id or resolved_id,
            'resolved_id': resolved_id,
            'name': name,
            'type': model_type,
            'provider': provider,
            'status': status,
            'api_key': api_key,
            'api_base': api_base,
            'base_url': api_base,
            'model_name': model_name,
            'litellm_model': litellm_model or model_name,
            'requires_api_key': requires_api_key,
            'requires_api_base': requires_api_base
        }

        for key in ('headers', 'extra_headers', 'timeout', 'metadata'):
            if key in raw and key not in normalized:
                normalized[key] = raw[key]
        # 保留 legacy 字段用于兼容（例如 max_tokens 等）
        for legacy_key in ('max_tokens', 'temperature'):
            if legacy_key in raw:
                normalized[legacy_key] = raw[legacy_key]
        return normalized
    
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
    def _load_config_file() -> Dict[str, Any]:
        """读取 config.json，若不存在则返回空字典"""
        if CONFIG_PATH.exists():
            try:
                with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    return data
            except Exception as exc:
                logger.warning(f"读取配置文件失败 ({CONFIG_PATH}): {exc}")
        return {}
    
    @staticmethod
    def get_database_config() -> Dict[str, Any]:
        """获取数据库配置；优先 .env，其次 config.json，最后回退默认值"""
        ConfigLoader.load_env()
        
        defaults = {
            "host": "127.0.0.1",
            "port": 3306,
            "user": "root",
            "password": "",
            "database": ""
        }
        file_config = ConfigLoader._load_config_file().get('database', {})
        env_host = os.getenv("DB_HOST")
        env_port = os.getenv("DB_PORT")
        env_user = os.getenv("DB_USER")
        env_password = os.getenv("DB_PASSWORD")
        env_database = os.getenv("DB_DATABASE")

        host = env_host or file_config.get('host') or defaults['host']
        port_raw = env_port or file_config.get('port') or defaults['port']
        user = env_user or file_config.get('user') or defaults['user']
        password = env_password if env_password is not None else file_config.get('password', defaults['password'])
        database = env_database if env_database is not None else file_config.get('database', defaults['database'])

        if isinstance(host, str):
            host = host.strip() or defaults['host']
        else:
            host = defaults['host']

        if host in {'localhost', '::1'}:
            host = '127.0.0.1'

        try:
            port = int(port_raw)
        except (TypeError, ValueError):
            logger.warning(f"DB_PORT 值无效 ({port_raw})，使用默认 {defaults['port']}")
            port = defaults['port']

        configured = any([
            env_host,
            env_port,
            env_user,
            env_password,
            env_database,
            bool(file_config)
        ])

        if not configured:
            logger.info("未检测到数据库配置，使用占位默认值")

        return {
            "host": host,
            "port": port,
            "user": user or defaults['user'],
            "password": password or "",
            "database": database or "",
            "configured": configured
        }
    
    # 简单缓存以避免每次磁盘IO读取models.json
    _api_config_cache: Dict[str, Any] | None = None
    _models_mtime: float | None = None

    @staticmethod
    def get_api_config() -> Dict[str, Any]:
        """获取API配置 - 优先从models.json读取模型配置，其次从环境变量"""
        ConfigLoader.load_env()

        models_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config', 'models.json')
        models_entries: list[Any] = []
        try:
            if os.path.exists(models_path):
                mtime = os.path.getmtime(models_path)
                if ConfigLoader._api_config_cache is not None and ConfigLoader._models_mtime == mtime:
                    return ConfigLoader._api_config_cache
                with open(models_path, 'r', encoding='utf-8') as f:
                    models_data = json.load(f)
                if isinstance(models_data, dict):
                    models_entries = models_data.get('models', [])
                elif isinstance(models_data, list):
                    models_entries = models_data
                else:
                    models_entries = []
                ConfigLoader._models_mtime = mtime
                logger.info(f"从models.json加载了 {len(models_entries)} 个模型配置")
        except Exception as exc:
            logger.warning(f"读取models.json失败: {exc}")
            models_entries = []
            ConfigLoader._models_mtime = None

        env_api_key = (
            os.getenv("OPENAI_API_KEY") or
            os.getenv("API_KEY") or
            os.getenv("LLM_API_KEY") or
            "not-needed"
        )
        env_api_base = (
            os.getenv("OPENAI_BASE_URL") or
            os.getenv("OPENAI_API_BASE") or
            os.getenv("API_BASE_URL") or
            os.getenv("LLM_BASE_URL") or
            'http://localhost:11434/v1'
        )
        default_model_env = ConfigLoader.normalize_model_id(os.getenv("DEFAULT_MODEL", "gpt-4o"))

        if not models_entries:
            models_entries = list(DEFAULT_MODELS)

        models: Dict[str, Dict[str, Any]] = {}
        active_candidates: list[str] = []
        for entry in models_entries:
            entry_dict = dict(entry) if isinstance(entry, dict) else {'id': str(entry), 'type': 'custom', 'status': 'inactive'}
            normalized = ConfigLoader.normalize_model_entry(entry_dict, env_api_key, env_api_base)
            key = normalized.get('resolved_id') or normalized['id']
            model_payload = {
                'id': normalized['id'],
                'name': normalized.get('name', normalized['id']),
                'api_key': normalized['api_key'],
                'api_base': normalized['api_base'],
                'base_url': normalized['api_base'],
                'model_name': normalized['model_name'],
                'provider': normalized['provider'],
                'type': normalized['type'],
                'status': normalized.get('status', 'inactive'),
                'litellm_model': normalized.get('litellm_model'),
                'requires_api_key': normalized.get('requires_api_key'),
                'requires_api_base': normalized.get('requires_api_base')
            }
            for passthrough in ('headers', 'extra_headers', 'timeout', 'metadata', 'max_tokens', 'temperature'):
                if normalized.get(passthrough) is not None:
                    model_payload[passthrough] = normalized[passthrough]
            models[key] = model_payload
            if normalized.get('status') == 'active':
                active_candidates.append(key)

        if not models:
            # 确保至少存在一个默认模型
            fallback_entry = ConfigLoader.normalize_model_entry(DEFAULT_MODELS[0], env_api_key, env_api_base)
            key = fallback_entry.get('resolved_id') or fallback_entry['id']
            models[key] = {
                'id': fallback_entry['id'],
                'name': fallback_entry.get('name', fallback_entry['id']),
                'api_key': fallback_entry['api_key'],
                'api_base': fallback_entry['api_base'],
                'base_url': fallback_entry['api_base'],
                'model_name': fallback_entry['model_name'],
                'provider': fallback_entry['provider'],
                'type': fallback_entry['type'],
                'status': fallback_entry.get('status', 'active'),
                'litellm_model': fallback_entry.get('litellm_model'),
                'requires_api_key': fallback_entry.get('requires_api_key'),
                'requires_api_base': fallback_entry.get('requires_api_base')
            }

        default_model = default_model_env
        if active_candidates:
            default_model = ConfigLoader.normalize_model_id(active_candidates[0])
        if default_model not in models and models:
            default_model = next(iter(models.keys()))
        default_entry = models.get(default_model, {})
        resolved_api_key = default_entry.get('api_key') or env_api_key
        if resolved_api_key in PLACEHOLDER_KEYS:
            resolved_api_key = ''
        resolved_api_base = default_entry.get('api_base') or env_api_base

        logger.info(f"使用模型配置: default_model={default_model}, 总共 {len(models)} 个模型")

        api_conf = {
            "api_key": resolved_api_key,
            "api_base": resolved_api_base,
            "default_model": default_model,
            "current_model": default_model,
            "models": models
        }
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
        base = {
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

        file_config = ConfigLoader._load_config_file()
        if isinstance(file_config, dict):
            for key in (
                "interface_language",
                "interface_theme",
                "auto_run_code",
                "show_thinking",
                "context_rounds",
                "default_view_mode"
            ):
                if key in file_config:
                    base[key] = file_config[key]

            if 'features' in file_config and isinstance(file_config['features'], dict):
                base['features'] = file_config['features']

        if 'features' not in base:
            base['features'] = {}

        return base
    
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
