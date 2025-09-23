from backend.config_loader import ConfigLoader, DEFAULT_MODELS
import os
import json
import logging
from datetime import datetime
from flask import Blueprint, request, jsonify

logger = logging.getLogger(__name__)

config_bp = Blueprint('config_bp', __name__)


@config_bp.route('/api/models', methods=['GET', 'POST'])
def handle_models():
    """获取或保存模型列表（Blueprint版本）"""
    PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    models_file = os.path.join(PROJECT_ROOT, 'config', 'models.json')

    if request.method == 'GET':
        try:
            api_config = ConfigLoader.get_api_config()
            models_from_file = []
            if os.path.exists(models_file):
                try:
                    with open(models_file, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                        if isinstance(data, dict) and 'models' in data:
                            models_from_file = data['models']
                        elif isinstance(data, list):
                            models_from_file = data
                except Exception as exc:
                    logger.warning(f"读取 models.json 失败，使用默认模型: {exc}")
                    models_from_file = []
            if not models_from_file:
                models_from_file = [dict(item) if isinstance(item, dict) else {'id': str(item)} for item in DEFAULT_MODELS]

            normalized_models = []
            for raw_model in models_from_file:
                entry_dict = dict(raw_model) if isinstance(raw_model, dict) else {'id': str(raw_model)}
                normalized = ConfigLoader.normalize_model_entry(
                    entry_dict,
                    api_config.get('api_key', 'not-needed'),
                    api_config.get('api_base', '')
                )
                normalized.pop('resolved_id', None)
                normalized_models.append(normalized)

            current = api_config.get('current_model') or api_config.get('default_model')
            return jsonify({"models": normalized_models, "current": current})
        except Exception as e:
            logger.error(f"获取模型列表失败: {e}")
            return jsonify({"error": str(e)}), 500
    else:
        try:
            data = request.json
            os.makedirs(os.path.dirname(models_file), exist_ok=True)
            # 接受 {models: [...]} 或直接的列表，保持字段原样，不做强制覆盖或状态变更
            if isinstance(data, dict) and 'models' in data:
                raw_models = data['models']
            elif isinstance(data, list):
                raw_models = data
            else:
                raw_models = data if isinstance(data, list) else [data]

            save_models = []
            for m in (raw_models or []):
                if isinstance(m, dict):
                    # 轻量补全 id/name，但不覆盖其他字段
                    mid = m.get('id') or m.get('name')
                    name = m.get('name') or mid
                    nm = {**m}
                    if mid is not None:
                        nm['id'] = mid
                    if name is not None:
                        nm['name'] = name
                    base = nm.get('api_base') or nm.get('base_url')
                    if base:
                        nm['api_base'] = base
                        nm['base_url'] = base
                    provider = nm.get('provider') or nm.get('type')
                    if provider:
                        nm['type'] = provider
                        nm['provider'] = provider
                    if not nm.get('model_name'):
                        nm['model_name'] = mid or name
                    if not nm.get('litellm_model'):
                        nm['litellm_model'] = ConfigLoader.build_litellm_model_id(nm.get('provider'), nm.get('model_name'))
                    save_models.append(nm)
                else:
                    save_models.append({"id": str(m), "name": str(m)})

            models_data = {"models": save_models}
            with open(models_file, 'w', encoding='utf-8') as f:
                json.dump(models_data, f, indent=2, ensure_ascii=False)
            # 使配置缓存失效，确保后续读取到最新
            try:
                ConfigLoader._api_config_cache = None
                ConfigLoader._models_mtime = None
            except Exception:
                pass
            return jsonify({"success": True})
        except Exception as e:
            logger.error(f"保存模型失败: {e}")
            return jsonify({"error": str(e)}), 500


@config_bp.route('/api/models/status', methods=['GET'])
def get_model_status():
    """粗略的模型可用性扫描（不做真实外呼，基于配置推断）。
    规则：
    - 若类型为本地/兼容（如 ollama），且状态为 active，则视为 available=true。
    - 否则需存在有效 API Key（排除占位符），且状态为 active 才视为 available=true。
    """
    try:
        PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        models_file = os.path.join(PROJECT_ROOT, 'config', 'models.json')
        api_config = ConfigLoader.get_api_config()

        placeholder_keys = {
            '', 'not-needed', 'not_needed', 'notneeded',
            'your-openai-api-key-here', 'your-anthropic-api-key-here',
            'your-custom-api-key-here', 'your-api-key-here'
        }

        def is_local_url(url: str | None) -> bool:
            if not url:
                return False
            u = url.lower()
            return ('localhost' in u) or ('127.0.0.1' in u)

        models_status = []
        models_list = []
        try:
            if os.path.exists(models_file):
                with open(models_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    if isinstance(data, dict) and 'models' in data:
                        models_list = data['models']
                    elif isinstance(data, list):
                        models_list = data
        except Exception:
            models_list = []

        # 若文件中没有，回退到聚合配置（字段更少）
        if not models_list:
            for mid, cfg in api_config.get('models', {}).items():
                models_list.append({
                    'id': mid,
                    'api_base': cfg.get('base_url'),
                    'api_key': cfg.get('api_key'),
                    'status': cfg.get('status', 'inactive')
                })

        for m in models_list:
            if not isinstance(m, dict):
                continue
            mid = m.get('id') or m.get('name')
            typ = (m.get('type') or '').lower()
            api_base = m.get('api_base') or m.get('base_url')
            key = (m.get('api_key') or '').strip()
            status = m.get('status', 'inactive')

            if typ in {'ollama', 'local'} or is_local_url(api_base):
                available = status == 'active'
            else:
                available = (status == 'active') and (key not in placeholder_keys)

            models_status.append({'id': mid, 'available': available, 'base_url': api_base})

        return jsonify({'models': models_status, 'current': api_config.get('default_model')})
    except Exception as e:
        logger.error(f"获取模型状态失败: {e}")
        return jsonify({'error': str(e)}), 500


@config_bp.route('/api/config', methods=['GET', 'POST'])
def handle_config():
    """获取或保存配置（Blueprint版本）"""
    PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    config_path = os.path.join(PROJECT_ROOT, 'config', 'config.json')
    env_path = os.path.join(PROJECT_ROOT, '.env')

    if request.method == 'GET':
        try:
            # 优先用聚合配置，并兼容旧字段
            try:
                cfg = ConfigLoader.get_config()
                if isinstance(cfg, dict) and 'api' in cfg:
                    api = cfg.get('api', {})
                    cfg.setdefault('api_key', api.get('key', ''))
                    cfg.setdefault('api_base', api.get('base_url', ''))
                    cfg.setdefault('default_model', api.get('model', ''))
                return jsonify(cfg)
            except Exception:
                pass

            api_config = ConfigLoader.get_api_config()
            db_config = ConfigLoader.get_database_config()
            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    full_config = json.load(f)
            except Exception:
                full_config = {}

            config = {
                "api_key": api_config.get("api_key", ""),
                "api_base": api_config.get("api_base", ""),
                "default_model": api_config.get("default_model", ""),
                "models": [
                    {"id": "gpt-4.1", "name": "GPT-4.1", "type": "openai"},
                    {"id": "claude-sonnet-4", "name": "Claude Sonnet 4", "type": "anthropic"},
                    {"id": "deepseek-r1", "name": "DeepSeek R1", "type": "deepseek"},
                    {"id": "qwen-flagship", "name": "Qwen 旗舰模型", "type": "qwen"}
                ],
                "database": db_config,
                "features": full_config.get("features", {})
            }
            if os.path.exists(config_path):
                try:
                    with open(config_path, 'r') as f:
                        saved_config = json.load(f)
                        for key in ['interface_language', 'interface_theme', 'auto_run_code', 'show_thinking',
                                    'context_rounds', 'default_view_mode']:
                            if key in saved_config:
                                config[key] = saved_config[key]
                except Exception:
                    pass
            return jsonify(config)
        except Exception as e:
            logger.error(f"读取配置失败: {e}")
            return jsonify({"error": str(e)}), 500
    else:
        try:
            config = request.json or {}

            env_updates = {}
            if 'api_key' in config:
                api_key_value = str(config['api_key'])
                for key in ('OPENAI_API_KEY', 'API_KEY', 'LLM_API_KEY'):
                    env_updates[key] = api_key_value

            if 'api_base' in config:
                api_base_value = str(config['api_base'])
                for key in ('OPENAI_BASE_URL', 'OPENAI_API_BASE', 'API_BASE_URL', 'LLM_BASE_URL'):
                    env_updates[key] = api_base_value

            if 'default_model' in config:
                env_updates['DEFAULT_MODEL'] = str(config['default_model'])

            db_cfg = config.get('database') or {}
            if isinstance(db_cfg, dict) and db_cfg:
                host = db_cfg.get('host')
                if host == 'localhost':
                    host = '127.0.0.1'
                if host:
                    env_updates['DB_HOST'] = str(host)
                if db_cfg.get('port') is not None:
                    env_updates['DB_PORT'] = str(db_cfg.get('port'))
                if db_cfg.get('user') is not None:
                    env_updates['DB_USER'] = str(db_cfg.get('user'))
                if db_cfg.get('password') is not None:
                    env_updates['DB_PASSWORD'] = str(db_cfg.get('password'))
                if db_cfg.get('database') is not None:
                    env_updates['DB_DATABASE'] = str(db_cfg.get('database', ''))

            if env_updates:
                env_lines = []
                if os.path.exists(env_path):
                    with open(env_path, 'r', encoding='utf-8') as f:
                        env_lines = f.readlines()
                seen_keys = set()
                new_lines = []
                for line in env_lines:
                    stripped = line.strip()
                    if not stripped or stripped.startswith('#') or '=' not in stripped:
                        new_lines.append(line)
                        continue
                    key, _ = stripped.split('=', 1)
                    if key in env_updates:
                        new_lines.append(f"{key}={env_updates[key]}\n")
                        seen_keys.add(key)
                    else:
                        new_lines.append(line)
                for key, value in env_updates.items():
                    if key not in seen_keys:
                        new_lines.append(f"{key}={value}\n")
                with open(env_path, 'w', encoding='utf-8') as f:
                    f.writelines(new_lines)
                try:
                    ConfigLoader._env_loaded = False
                    ConfigLoader._api_config_cache = None
                    ConfigLoader._models_mtime = None
                except Exception:
                    pass

            ui_keys = ['interface_language', 'interface_theme', 'auto_run_code', 'show_thinking', 'context_rounds', 'default_view_mode', 'features']
            to_save = {k: v for k, v in config.items() if k in ui_keys}
            os.makedirs(os.path.dirname(config_path), exist_ok=True)
            try:
                if os.path.exists(config_path):
                    with open(config_path, 'r', encoding='utf-8') as f:
                        existing = json.load(f)
                else:
                    existing = {}
            except Exception:
                existing = {}
            existing.update(to_save)
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(existing, f, indent=2, ensure_ascii=False)

            try:
                ConfigLoader._env_loaded = False
                ConfigLoader._api_config_cache = None
            except Exception:
                pass

            return jsonify({"success": True})
        except Exception as e:
            logger.error(f"保存配置失败: {e}")
            return jsonify({"error": str(e)}), 500
