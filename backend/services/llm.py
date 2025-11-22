"""
LLM服务封装
提供统一的LLM调用接口，支持多种模型
"""
import logging
import json
import os
from typing import Dict, Any, Optional, Tuple
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from backend.core.config import ConfigLoader, PLACEHOLDER_KEYS

try:
    from litellm import completion as litellm_completion
    from litellm.exceptions import LiteLLMException
    LITELLM_AVAILABLE = True
except Exception:  # pragma: no cover - liteLLM 为可选依赖
    litellm_completion = None
    LiteLLMException = Exception
    LITELLM_AVAILABLE = False

logger = logging.getLogger(__name__)

class LLMService:
    """
    LLM服务封装类
    提供统一的接口调用不同的LLM模型
    """
    
    def __init__(self, model_name: Optional[str] = None):
        """
        初始化LLM服务
        
        Args:
            model_name: 指定使用的模型，默认使用配置中的默认模型
        """
        # 加载API配置
        api_config = ConfigLoader.get_api_config()
        self.api_config = api_config

        requested_model = model_name or api_config.get('default_model', 'gpt-4o')
        self.model_name = ConfigLoader.normalize_model_id(requested_model)
        self.model_settings = api_config.get('models', {}).get(self.model_name, {})
        if not self.model_settings and requested_model in api_config.get('models', {}):
            # 兼容未标准化ID的情况
            self.model_settings = api_config['models'][requested_model]
        self.model_settings = dict(self.model_settings) if isinstance(self.model_settings, dict) else {}

        self.model_settings.setdefault('model_name', self.model_settings.get('model_name') or self.model_name)
        provider = (self.model_settings.get('provider') or self.model_settings.get('type') or 'openai').lower()
        self.provider = provider
        self.model_settings['provider'] = provider
        self.model_settings['type'] = provider

        self.api_key = self._resolve_api_key()
        self.api_base = self._resolve_api_base()
        self.timeout = self.model_settings.get('timeout', 15)
        self.litellm_model = self.model_settings.get('litellm_model') or ConfigLoader.build_litellm_model_id(
            self.provider,
            self.model_settings.get('model_name')
        )
        if not self.litellm_model:
            self.litellm_model = self.model_settings.get('model_name') or self.model_name
        
        # 统计信息
        self.stats = {
            "total_requests": 0,
            "successful_requests": 0,
            "failed_requests": 0,
            "total_tokens": 0,
            "total_cost": 0.0
        }
    
    def _create_session(self) -> requests.Session:
        """创建带有重试机制的HTTP会话"""
        session = requests.Session()
        retry = Retry(
            total=3,
            read=3,
            connect=3,
            backoff_factor=0.5,
            status_forcelist=(500, 502, 503, 504)
        )
        adapter = HTTPAdapter(max_retries=retry)
        session.mount('http://', adapter)
        session.mount('https://', adapter)
        return session

    def _resolve_api_key(self) -> str:
        candidate = (self.model_settings.get('api_key') or '').strip()
        if not candidate or candidate in PLACEHOLDER_KEYS:
            candidate = (self.api_config.get('api_key') or '').strip()
        if candidate in PLACEHOLDER_KEYS:
            return ''
        return candidate
    
    def _resolve_api_base(self) -> str:
        base = (self.model_settings.get('api_base') or self.model_settings.get('base_url') or '').strip()
        if not base:
            base = (self.api_config.get('api_base') or '').strip()
        if base.endswith('/'):
            base = base.rstrip('/')
        return base
    
    def complete(self, prompt: str, temperature: float = 0.1, max_tokens: int = 200) -> Dict[str, Any]:
        """
        调用LLM完成文本生成
        
        Args:
            prompt: 输入提示词
            temperature: 温度参数（0-1），越低越确定
            max_tokens: 最大生成token数
            
        Returns:
            响应字典，包含生成的内容和使用统计
        """
        requires_api_key = self.model_settings.get('requires_api_key')
        if requires_api_key is None:
            requires_api_key = self.provider not in {'ollama', 'custom', 'local'}

        if requires_api_key and not self.api_key:
            # 用户尚未配置密钥，不视为错误，直接返回跳过结果
            logger.debug("LLM调用跳过：模型 %s 未配置有效 API KEY", self.model_name)
            return {
                "content": "未配置 API Key，无法使用该模型。",
                "error": "API Key Missing",
                "success": False,
                "skipped": True
            }

        self.stats["total_requests"] += 1

        messages = [
            {
                "role": "system",
                "content": "You are a query routing assistant. Analyze queries and determine the best execution path. Always respond in JSON format."
            },
            {
                "role": "user",
                "content": prompt
            }
        ]

        try:
            response_payload = None
            if LITELLM_AVAILABLE:
                response_payload = self._complete_via_litellm(messages, temperature, max_tokens)

            if response_payload is None:
                if self.provider == 'ollama':
                    response_payload = self._complete_via_ollama(messages, temperature)
                else:
                    response_payload = self._complete_via_http(messages, temperature, max_tokens)

            content, usage = self._extract_response_content(response_payload)
            
            # 只要能成功提取响应（即使内容为空），就认为调用成功
            # 这样测试时即使返回空内容也会显示成功
            self.stats["successful_requests"] += 1
            self.stats["total_tokens"] += usage.get('total_tokens', 0)
            self._estimate_cost(usage)

            return {
                "content": content or "",  # 确保返回空字符串而不是 None
                "usage": usage,
                "model": self.model_settings.get('model_name', self.model_name),
                "success": True
            }

        except Exception as e:
            logger.error(f"LLM调用失败: {e}")
            self.stats["failed_requests"] += 1

            return {
                "content": "",
                "error": str(e),
                "success": False
            }
    
    def _complete_via_litellm(self, messages: list[Dict[str, Any]], temperature: float, max_tokens: int):
        if not LITELLM_AVAILABLE or not self.litellm_model or self.provider == 'ollama':
            return None
        try:
            kwargs: Dict[str, Any] = {
                "model": self.litellm_model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens
            }
            if self.api_key:
                kwargs["api_key"] = self.api_key
            if self.api_base:
                kwargs["api_base"] = self.api_base
            provider = self._resolve_litellm_provider()
            if provider:
                kwargs["custom_llm_provider"] = provider
            extra_headers = self.model_settings.get('headers') or self.model_settings.get('extra_headers')
            if isinstance(extra_headers, dict):
                kwargs["extra_headers"] = extra_headers
            return litellm_completion(**kwargs)
        except LiteLLMException as exc:
            logger.warning(f"LiteLLM调用失败: {exc}")
            return None
        except Exception as exc:
            logger.warning(f"LiteLLM执行异常，降级至HTTP请求: {exc}")
            return None
    
    def _complete_via_http(self, messages: list[Dict[str, Any]], temperature: float, max_tokens: int):
        if not self.api_base:
            raise ValueError("未配置API地址")
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        extra_headers = self.model_settings.get('headers') or self.model_settings.get('extra_headers')
        if isinstance(extra_headers, dict):
            headers.update(extra_headers)
        payload = {
            "model": self.model_settings.get('model_name', self.model_name),
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens
        }
        if self.provider in ('openai', 'custom', ''):
            payload["response_format"] = {"type": "json_object"}
        api_url = self.api_base.rstrip('/') + '/chat/completions'
        session = self._create_session()
        try:
            response = session.post(api_url, headers=headers, json=payload, timeout=self.timeout)
            if response.status_code >= 400:
                raise RuntimeError(f"API请求失败: {response.status_code} - {response.text}")
            return response.json()
        finally:
            session.close()
    
    def _complete_via_ollama(self, messages: list[Dict[str, Any]], temperature: float):
        base = self.api_base
        if not base:
             base = os.getenv('OLLAMA_HOST') or os.getenv('OLLAMA_BASE_URL') or 'http://localhost:11434'
        url = base.rstrip('/') + '/api/chat'
        payload = {
            "model": self.model_settings.get('model_name', self.model_name),
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": temperature
            }
        }
        session = self._create_session()
        try:
            response = session.post(url, json=payload, timeout=self.timeout)
            if response.status_code >= 400:
                raise RuntimeError(f"Ollama请求失败: {response.status_code} - {response.text}")
            data = response.json()
        finally:
            session.close()
        
        if 'choices' not in data:
            message = data.get('message', {}) or {}
            content = message.get('content', '')
            data['choices'] = [{'message': {'content': content}}]
        if 'usage' not in data:
            prompt_tokens = data.get('prompt_eval_count') or 0
            completion_tokens = data.get('eval_count') or 0
            data['usage'] = {
                'prompt_tokens': prompt_tokens,
                'completion_tokens': completion_tokens,
                'total_tokens': prompt_tokens + completion_tokens
            }
        return data
    
    def _resolve_litellm_provider(self) -> Optional[str]:
        provider = self.provider
        if provider in ('', 'openai', 'custom', 'ollama'):
            return None
        provider_map = {
            'qwen': 'dashscope',
            'dashscope': 'dashscope',
            'ali': 'dashscope'
        }
        return provider_map.get(provider, provider)
    
    def _response_to_dict(self, response: Any) -> Dict[str, Any]:
        if isinstance(response, dict):
            return response
        for attr in ('model_dump', 'dict', 'to_dict'):
            func = getattr(response, attr, None)
            if callable(func):
                try:
                    data = func()
                    if isinstance(data, dict):
                        return data
                except Exception:
                    continue
        if hasattr(response, '__dict__'):
            return dict(response.__dict__)
        return {}
    
    def _extract_response_content(self, response: Any) -> Tuple[str, Dict[str, Any]]:
        data = self._response_to_dict(response)
        choices = data.get('choices') or []
        content = ''
        if choices:
            choice = choices[0]
            if isinstance(choice, dict):
                message = choice.get('message', {}) or {}
                content = message.get('content') or choice.get('text', '')
            else:
                message = getattr(choice, 'message', None)
                if isinstance(message, dict):
                    content = message.get('content', '')
                else:
                    content = getattr(message, 'content', '') or getattr(choice, 'text', '')
        usage = data.get('usage') or {}
        if not isinstance(usage, dict) and hasattr(usage, '__dict__'):
            usage = dict(usage.__dict__)
        if 'total_tokens' not in usage:
            usage['total_tokens'] = usage.get('prompt_tokens', 0) + usage.get('completion_tokens', 0)
        return content, usage
    
    def apply_overrides(self, overrides: Dict[str, Any]):
        if not overrides:
            return
        if overrides.get('model'):
            self.model_name = ConfigLoader.normalize_model_id(overrides['model'])
        if overrides.get('provider'):
            self.provider = overrides['provider'].lower()
            self.model_settings['provider'] = self.provider
            self.model_settings['type'] = self.provider
        for key in ('model_name', 'litellm_model'):
            if overrides.get(key):
                self.model_settings[key] = overrides[key]
        if overrides.get('api_key') is not None:
            candidate = overrides.get('api_key') or ''
            self.model_settings['api_key'] = candidate
            self.api_key = '' if candidate in PLACEHOLDER_KEYS else candidate
        if overrides.get('api_base') is not None:
            base = (overrides.get('api_base') or '').strip()
            if base.endswith('/'):
                base = base.rstrip('/')
            self.model_settings['api_base'] = base
            self.model_settings['base_url'] = base
            self.api_base = base
        if overrides.get('litellm_model'):
            self.litellm_model = overrides['litellm_model']
        # 重新回退缺失字段
        if not self.api_key:
            self.api_key = self._resolve_api_key()
        if not self.api_base:
            self.api_base = self._resolve_api_base()
        if not self.litellm_model:
            self.litellm_model = ConfigLoader.build_litellm_model_id(
                self.provider,
                self.model_settings.get('model_name')
            )
    
    @staticmethod
    def test_model_connection(model_payload: Dict[str, Any]) -> Tuple[bool, str]:
        try:
            target_id = model_payload.get('model') or model_payload.get('id')
            service = LLMService(target_id)
            service.apply_overrides(model_payload)
            result = service.complete("ping", temperature=0, max_tokens=8)
            if result.get('success'):
                return True, (result.get('content') or 'OK')[:200]
            return False, result.get('error', '未知错误')
        except Exception as exc:
            return False, str(exc)
    
    def complete_simple(self, prompt: str) -> str:
        """
        简化的调用接口，直接返回生成的文本
        
        Args:
            prompt: 输入提示词
            
        Returns:
            生成的文本内容
        """
        result = self.complete(prompt)
        return result.get('content', '')
    
    def _estimate_cost(self, usage: Dict[str, Any]):
        """
        估算API调用成本
        
        Args:
            usage: token使用统计
        """
        # 简单的成本估算（实际价格需要根据模型调整）
        # GPT-4: $0.03/1K input tokens, $0.06/1K output tokens
        # GPT-3.5: $0.001/1K input tokens, $0.002/1K output tokens
        
        input_tokens = usage.get('prompt_tokens', 0)
        output_tokens = usage.get('completion_tokens', 0)
        
        if 'gpt-4' in self.model_name.lower():
            cost = (input_tokens * 0.03 + output_tokens * 0.06) / 1000
        else:
            cost = (input_tokens * 0.001 + output_tokens * 0.002) / 1000
        
        self.stats["total_cost"] += cost
    
    def get_stats(self) -> Dict[str, Any]:
        """
        获取服务统计信息
        """
        stats = self.stats.copy()
        
        # 计算成功率
        if stats["total_requests"] > 0:
            stats["success_rate"] = (
                stats["successful_requests"] / stats["total_requests"] * 100
            )
            stats["avg_tokens_per_request"] = (
                stats["total_tokens"] / stats["total_requests"]
            )
        
        return stats
    
    def reset_stats(self):
        """
        重置统计信息
        """
        self.stats = {
            "total_requests": 0,
            "successful_requests": 0,
            "failed_requests": 0,
            "total_tokens": 0,
            "total_cost": 0.0
        }


class LLMServiceManager:
    """
    LLM服务管理器
    管理多个LLM服务实例，支持负载均衡和故障转移
    """
    
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        
        self.services = {}
        self.default_service = None
        self._initialized = True
    
    def get_service(self, model_name: Optional[str] = None) -> LLMService:
        """
        获取LLM服务实例
        
        Args:
            model_name: 模型名称，None则使用默认模型
            
        Returns:
            LLM服务实例
        """
        if model_name is None:
            if self.default_service is None:
                self.default_service = LLMService()
            return self.default_service
        
        if model_name not in self.services:
            self.services[model_name] = LLMService(model_name)
        
        return self.services[model_name]
    
    def get_all_stats(self) -> Dict[str, Any]:
        """
        获取所有服务的统计信息
        """
        all_stats = {}
        
        if self.default_service:
            all_stats['default'] = self.default_service.get_stats()
        
        for model_name, service in self.services.items():
            all_stats[model_name] = service.get_stats()
        
        # 计算总体统计
        total_stats = {
            "total_requests": 0,
            "successful_requests": 0,
            "failed_requests": 0,
            "total_tokens": 0,
            "total_cost": 0.0
        }
        
        for stats in all_stats.values():
            for key in total_stats:
                total_stats[key] += stats.get(key, 0)
        
        return {
            "services": all_stats,
            "total": total_stats
        }


# 全局LLM服务管理器实例
llm_manager = LLMServiceManager()
