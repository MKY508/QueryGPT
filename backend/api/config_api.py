import os
import json
import logging
from datetime import datetime
from flask import Blueprint, request, jsonify
from backend.config_loader import ConfigLoader

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
            api_base = api_config.get("api_base", "")

            # 优先从ConfigLoader提供的可用模型接口（测试友好）
            try:
                simple_models = ConfigLoader.get_available_models()
                if isinstance(simple_models, list) and simple_models:
                    if all(isinstance(x, str) for x in simple_models):
                        models = [
                            {"id": m, "name": m, "type": "custom", "api_base": api_base, "status": "active"}
                            for m in simple_models
                        ]
                    elif all(isinstance(x, dict) for x in simple_models):
                        models = simple_models
                    else:
                        models = []
                    return jsonify({"models": models, "current": api_config.get("default_model")})
            except Exception:
                pass

            if os.path.exists(models_file):
                with open(models_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    if isinstance(data, dict) and 'models' in data:
                        models = data['models']
                    elif isinstance(data, list):
                        models = data
                    else:
                        models = []
            else:
                models = [
                    {"id": "gpt-4o", "name": "GPT-4o", "type": "OpenAI", "api_base": api_base, "status": "active"},
                    {"id": "claude-sonnet-4", "name": "Claude Sonnet 4", "type": "Anthropic", "api_base": api_base, "status": "active"},
                    {"id": "deepseek-r1", "name": "DeepSeek R1", "type": "DeepSeek", "api_base": api_base, "status": "active"},
                    {"id": "qwen-flagship", "name": "Qwen 旗舰模型", "type": "Qwen", "api_base": api_base, "status": "active"}
                ]
            # 标准化ID并自动补全状态（使用模块级 ConfigLoader，避免局部遮蔽）
            try:
                normalized = []
                for m in models:
                    mid = ConfigLoader.normalize_model_id(m.get('id', ''))
                    status = m.get('status') or ('active' if api_config.get('api_key') else 'inactive')
                    normalized.append({
                        **m,
                        'id': mid,
                        'status': status
                    })
                models = normalized
            except Exception:
                pass

            return jsonify({"models": models, "current": api_config.get("default_model")})
        except Exception as e:
            logger.error(f"获取模型列表失败: {e}")
            return jsonify({"error": str(e)}), 500
    else:
        try:
            data = request.json
            os.makedirs(os.path.dirname(models_file), exist_ok=True)
            if isinstance(data, list):
                models_data = {"models": data}
            elif isinstance(data, dict) and 'models' in data:
                models_data = data
            else:
                models_data = {"models": data if isinstance(data, list) else [data]}
            with open(models_file, 'w', encoding='utf-8') as f:
                json.dump(models_data, f, indent=2, ensure_ascii=False)
            return jsonify({"success": True})
        except Exception as e:
            logger.error(f"保存模型失败: {e}")
            return jsonify({"error": str(e)}), 500


@config_bp.route('/api/models/status', methods=['GET'])
def get_model_status():
    """粗略的模型可用性扫描（不做真实外呼，基于配置推断）。
    - 若存在 API Key 且 model 在配置中标为 active，则视为 available=true。
    - 可在后续版本替换为真实健康检查。
    """
    try:
        api_config = ConfigLoader.get_api_config()
        models = []
        for mid, cfg in api_config.get('models', {}).items():
            available = bool(cfg.get('api_key')) and (cfg.get('status', 'active') == 'active')
            models.append({
                'id': mid,
                'available': available,
                'base_url': cfg.get('base_url'),
            })
        return jsonify({'models': models, 'current': api_config.get('default_model')})
    except Exception as e:
        logger.error(f"获取模型状态失败: {e}")
        return jsonify({'error': str(e)}), 500


@config_bp.route('/api/config', methods=['GET', 'POST'])
def handle_config():
    """获取或保存配置（Blueprint版本）"""
    PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    config_path = os.path.join(PROJECT_ROOT, 'config', 'config.json')

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
            # 写入 .env 和 config.json 的逻辑保留在 app 版本，此处可轻量实现或透传
            # 为安全起见，这里仅保存 UI 相关设置到 config.json
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
            return jsonify({"success": True})
        except Exception as e:
            logger.error(f"保存配置失败: {e}")
            return jsonify({"error": str(e)}), 500
