"""
工具函数模块 - 统一管理所有辅助函数
包含：日期解析、SSE格式化、进度计划、限流装饰器
"""
import json
import logging
from datetime import datetime, timezone
from typing import Dict, Any, Optional, Callable
from functools import wraps

from backend.llm_service import LLMService

logger = logging.getLogger(__name__)

# ============ 日期解析工具 ============

def parse_date_param(value: str | None) -> datetime | None:
    """解析日期参数（支持多种格式）"""
    if not value:
        return None
    candidate = value.strip()
    if not candidate:
        return None
    try:
        if candidate.endswith('Z'):
            candidate = candidate[:-1] + '+00:00'
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M:%S.%f', '%Y-%m-%d'):
            try:
                parsed = datetime.strptime(candidate, fmt)
                break
            except ValueError:
                parsed = None
        if parsed is None:
            return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def parse_conversation_timestamp(value: str | None) -> datetime | None:
    """解析对话时间戳"""
    if not value:
        return None
    candidate = value.strip()
    if not candidate:
        return None
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M:%S.%f'):
        try:
            return datetime.strptime(candidate, fmt)
        except ValueError:
            continue
    try:
        if candidate.endswith('Z'):
            candidate = candidate[:-1] + '+00:00'
        parsed = datetime.fromisoformat(candidate)
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed
    except ValueError:
        return None


def conversation_in_range(
    conversation: dict, 
    start: datetime | None, 
    end: datetime | None
) -> bool:
    """判断对话是否在指定时间范围内"""
    if not (start or end):
        return True
    timestamp = (conversation.get('updated_at') or
                 conversation.get('created_at'))
    parsed = parse_conversation_timestamp(timestamp)
    if not parsed:
        return False
    if start and parsed < start:
        return False
    if end and parsed > end:
        return False
    return True


# ============ SSE格式化工具 ============

def sse_format(event: str, data: Dict[str, Any]) -> str:
    """格式化SSE事件数据"""
    try:
        payload = json.dumps(data, ensure_ascii=False)
    except Exception:
        payload = json.dumps({"message": str(data)})
    return f"event: {event}\ndata: {payload}\n\n"


# ============ 进度计划生成 ============

def generate_progress_plan(
    user_query: str, 
    route_type: str = 'ai_analysis', 
    language: str = 'zh'
) -> list[str]:
    """调用LLM生成简短进度标签（每项不超过10字，3-6项）。失败时返回默认。"""
    try:
        svc = LLMService()
        prompt = (
            "你是数据分析的执行计划助理。请基于用户需求和执行路径，生成一个最多6步的进度标签列表，"
            "每个标签不超过10个字，简短、友好，便于展示给非技术用户。"
            f"\n- 用户需求: {user_query[:200]}"
            f"\n- 执行路径: {route_type.upper()}"
            "\n只输出JSON，格式如下：\n{\n  \"labels\": [\"准备\", \"解析需求\", \"查询数据\", \"生成图表\", \"总结输出\"]\n}"
        )
        if language == 'en':
            prompt = (
                "You are a progress planner. Based on the user request and execution route, generate 3-6 short step labels"
                ", each no longer than 10 characters, friendly for non-technical users."
                f"\n- User request: {user_query[:200]}"
                f"\n- Route: {route_type.upper()}"
                "\nOutput JSON only in the form:\n{\n  \"labels\": [\"Prepare\", \"Parse\", \"Query\", \"Chart\", \"Summarize\"]\n}"
            )
        res = svc.complete(prompt, temperature=0.2, max_tokens=200)
        if res.get('success'):
            content = res.get('content', '{}')
            data = json.loads(content)
            labels = data.get('labels')
            if isinstance(labels, list) and 1 <= len(labels) <= 8:
                return [str(x)[:10] for x in labels]
    except Exception as e:
        logger.debug(f"生成进度计划失败: {e}")
        pass
    # 默认计划
    return ['准备', '解析需求', '查询数据', '生成图表', '总结输出'] if language != 'en' else ['Prepare', 'Parse', 'Query', 'Chart', 'Summary']


# ============ 限流装饰器 ============

def dynamic_rate_limit(max_requests: int, window_seconds: int):
    """动态限流装饰器工厂（支持运行时打桩）"""
    def deco(f: Callable):
        def wrapper(*args, **kwargs):
            # 运行时获取最新的 rate_limit（支持单测 monkeypatch）
            try:
                from backend import rate_limiter as rl
                rl_func = rl.rate_limit
                try:
                    # 优先按装饰器工厂调用
                    wrapped = rl_func(max_requests=max_requests, window_seconds=window_seconds)(f)
                except TypeError:
                    # 兼容测试桩：rl.rate_limit(f)
                    wrapped = rl_func(f)
                return wrapped(*args, **kwargs)
            except Exception:
                return f(*args, **kwargs)
        # 保留元数据
        try:
            return wraps(f)(wrapper)
        except Exception:
            return wrapper
    return deco
