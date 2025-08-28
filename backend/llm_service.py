"""
LLM服务封装
提供统一的LLM调用接口，支持多种模型
"""
import logging
import json
from typing import Dict, Any, Optional
import requests
from backend.config_loader import ConfigLoader

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
        self.api_key = api_config.get('api_key')
        self.api_base = api_config.get('api_base', 'https://api.openai.com/v1')
        
        # 设置模型
        self.model_name = model_name or api_config.get('default_model', 'gpt-4.1')
        
        # 统计信息
        self.stats = {
            "total_requests": 0,
            "successful_requests": 0,
            "failed_requests": 0,
            "total_tokens": 0,
            "total_cost": 0.0
        }
    
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
        self.stats["total_requests"] += 1
        
        try:
            # 构建请求
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }
            
            data = {
                "model": self.model_name,
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a query routing assistant. Analyze queries and determine the best execution path. Always respond in JSON format."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                "temperature": temperature,
                "max_tokens": max_tokens,
                "response_format": {"type": "json_object"}  # 请求JSON格式响应
            }
            
            # 发送请求 - 处理URL拼接，避免双斜杠
            api_url = self.api_base.rstrip('/') + '/chat/completions'
            response = requests.post(
                api_url,
                headers=headers,
                json=data,
                timeout=10
            )
            
            if response.status_code != 200:
                raise Exception(f"API请求失败: {response.status_code} - {response.text}")
            
            result = response.json()
            
            # 提取内容
            content = result['choices'][0]['message']['content']
            usage = result.get('usage', {})
            
            # 更新统计
            self.stats["successful_requests"] += 1
            self.stats["total_tokens"] += usage.get('total_tokens', 0)
            
            # 估算成本（简单估算，实际成本取决于模型）
            self._estimate_cost(usage)
            
            return {
                "content": content,
                "usage": usage,
                "model": self.model_name,
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