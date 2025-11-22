"""
数据库守卫模块
提供数据库健康检查与统一的失败响应工具，支持被多个入口复用。
"""

from __future__ import annotations

import logging
import time
from threading import Lock
from typing import Any, Dict, Optional

from backend.core.config import ConfigLoader

logger = logging.getLogger(__name__)

DEFAULT_DB_GUARD_CONFIG: Dict[str, Any] = {
    "auto_check": True,
    "warn_on_failure": True,
    "cache_ttl_seconds": 30,
    "failure_cache_seconds": 5,
    "auto_dismiss_ms": 8000,
    "hint_timeout": 8,
    "emphasis": "low"
}


class DatabaseGuard:
    """封装数据库健康检查逻辑，可被不同模块调用。"""

    def __init__(self, database_manager=None):
        self.database_manager = database_manager
        self._db_health_cache: Dict[str, Any] = {"result": None, "timestamp": 0.0}
        self._db_cache_lock = Lock()

    def update_manager(self, database_manager):
        """更新当前使用的 DatabaseManager 并清空缓存。"""
        self.database_manager = database_manager
        self.clear_cache()

    def clear_cache(self):
        with self._db_cache_lock:
            self._db_health_cache = {"result": None, "timestamp": 0.0}

    @staticmethod
    def sanitize_connection_info(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        if not isinstance(raw, dict):
            return {}
        allowed_keys = ("host", "port", "user", "database")
        return {key: raw.get(key) for key in allowed_keys if raw.get(key) not in (None, "")}

    def _derive_connection_snapshot(
        self,
        context: Dict[str, Any],
        explicit_snapshot: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        target_info = DatabaseGuard.sanitize_connection_info(explicit_snapshot or {})
        ctx_conn = DatabaseGuard.sanitize_connection_info(context.get("connection_info"))
        manager_conn = {}
        if self.database_manager and hasattr(self.database_manager, "config"):
            manager_cfg = getattr(self.database_manager, "config")
            if isinstance(manager_cfg, dict):
                manager_conn = DatabaseGuard.sanitize_connection_info(manager_cfg)

        fallback_conn = {}
        if not target_info and not ctx_conn and not manager_conn:
            try:
                fallback_conn = DatabaseGuard.sanitize_connection_info(ConfigLoader.get_database_config())
            except Exception:  # pylint: disable=broad-except
                fallback_conn = {}

        for key in ("host", "port", "user", "database"):
            if key in target_info and target_info[key] not in (None, ""):
                continue
            candidate = ctx_conn.get(key)
            if candidate in (None, ""):
                candidate = manager_conn.get(key)
            if candidate in (None, ""):
                candidate = fallback_conn.get(key)
            if candidate not in (None, ""):
                target_info[key] = candidate

        return {k: v for k, v in target_info.items() if v not in (None, "")}

    def ensure_database_ready(
        self,
        route_type: str,
        context: Optional[Dict[str, Any]],
        guard_cfg: Optional[Dict[str, Any]] = None,
        connection_snapshot: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """执行数据库健康检查，返回统一结构。"""
        ctx = context if isinstance(context, dict) else {}
        cfg = dict(DEFAULT_DB_GUARD_CONFIG)
        if isinstance(guard_cfg, dict):
            cfg.update({k: v for k, v in guard_cfg.items() if v is not None})

        base_payload = {
            "checked_at": time.time(),
            "target": self._derive_connection_snapshot(ctx, connection_snapshot)
        }

        if bool(ctx.get("force_execute")):
            logger.warning("用户选择忽略数据库连通性检查，继续执行 %s 路线", route_type)
            return {"ok": True, "message": "force_execute", **base_payload}

        if not self.database_manager:
            return {
                "ok": False,
                "message": "未检测到数据库管理器配置，请先完成数据库设置",
                "reason": "manager_missing",
                **base_payload
            }

        if not getattr(self.database_manager, "is_configured", False):
            return {
                "ok": False,
                "message": "数据库参数未配置，无法执行数据查询",
                "reason": "not_configured",
                **base_payload
            }

        if getattr(self.database_manager, "_global_disabled", False):
            return {
                "ok": False,
                "message": "数据库此前连接失败已被禁用，请检查配置后重试",
                "reason": "global_disabled",
                **base_payload
            }

        check, checked_at = self._get_db_health_status(
            force_refresh=bool(ctx.get("force_db_check")),
            success_ttl=cfg.get("cache_ttl_seconds", 30),
            failure_ttl=cfg.get("failure_cache_seconds", 5)
        )
        base_payload["checked_at"] = checked_at

        if check.get("connected"):
            return {"ok": True, "message": "connected", "details": check, **base_payload}

        return {
            "ok": False,
            "message": check.get("error") or "无法连接数据库",
            "reason": check.get("reason", "connection_failed"),
            "details": check,
            **base_payload
        }

    def _get_db_health_status(self, force_refresh: bool, success_ttl: int, failure_ttl: int):
        success_ttl = max(0, success_ttl)
        failure_ttl = max(0, failure_ttl)
        now = time.time()
        with self._db_cache_lock:
            cached_result = self._db_health_cache.get("result")
            cached_timestamp = self._db_health_cache.get("timestamp", 0.0)
            if not force_refresh and cached_result is not None:
                age = now - cached_timestamp
                ttl = failure_ttl if not cached_result.get("connected") else success_ttl
                if ttl > 0 and age <= ttl:
                    return cached_result, cached_timestamp

            try:
                check = self.database_manager.test_connection()
            except Exception as exc:  # pylint: disable=broad-except
                logger.error("数据库健康检查异常: %s", exc)
                check = {"connected": False, "error": str(exc), "reason": "exception"}

            self._db_health_cache = {
                "result": check,
                "timestamp": time.time()
            }
            return check, self._db_health_cache["timestamp"]


def build_guard_block_payload(
    db_check: Dict[str, Any],
    guard_cfg: Optional[Dict[str, Any]],
    *,
    query: str,
    warn_on_failure: bool,
    route_type: str,
    classification: Optional[Dict[str, Any]] = None,
    routing_info: Optional[Dict[str, Any]] = None,
    conversation_id: Optional[str] = None,
    model_name: Optional[str] = None
) -> Dict[str, Any]:
    """构造数据库守卫失败时的响应载荷。"""
    cfg = dict(DEFAULT_DB_GUARD_CONFIG)
    if isinstance(guard_cfg, dict):
        cfg.update({k: v for k, v in guard_cfg.items() if v is not None})

    payload = {
        "success": False,
        "status": "db_unavailable",
        "error": db_check.get("message", "数据库不可用"),
        "db_check": db_check,
        "routing_info": routing_info or {},
        "query_type": route_type,
        "requires_user_action": warn_on_failure,
        "forceable": True,
        "original_query": query,
        "guard_config": cfg,
        "classification": classification or {},
        "connection": db_check.get("target") or {},
        "ui": {
            "auto_dismiss_ms": cfg.get("auto_dismiss_ms", 8000),
            "emphasis": cfg.get("emphasis", "low"),
            "hint_timeout": cfg.get("hint_timeout", 8)
        }
    }

    if conversation_id:
        payload["conversation_id"] = conversation_id
    if model_name:
        payload["model"] = model_name

    return payload


__all__ = [
    "DatabaseGuard",
    "DEFAULT_DB_GUARD_CONFIG",
    "build_guard_block_payload"
]

