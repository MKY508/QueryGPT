"""Shared runtime service container and orchestration helpers."""

from __future__ import annotations

import logging
import threading
from datetime import datetime
from typing import Any, Dict, Optional

from backend.services.database import DatabaseManager
from backend.services.history import HistoryManager
from backend.services.interpreter import InterpreterManager
from backend.prompts import PromptTemplates
from backend.services.guard import DatabaseGuard
from backend.services.router import SmartRouter
from backend.services.executor import DirectSQLExecutor


class ServiceContainer:
    """Central place to manage lazy-initialised services and runtime state."""

    def __init__(self) -> None:
        self.logger = logging.getLogger(__name__)
        self.prompt_templates = PromptTemplates()

        # Lazily-initialised managers
        self.interpreter_manager: Optional[InterpreterManager] = None
        self.database_manager: Optional[DatabaseManager] = None
        self.history_manager: Optional[HistoryManager] = None
        self.smart_router: Optional[SmartRouter] = None
        self.sql_executor: Optional[DirectSQLExecutor] = None
        self.database_guard: Optional[DatabaseGuard] = None

        # Runtime state
        self.bootstrap_done: bool = False
        self._active_queries: Dict[str, Dict[str, Any]] = {}

        # Internal locks
        self._manager_lock = threading.RLock()
        self._active_queries_lock = threading.RLock()

    # ------------------------------------------------------------------
    # Manager lifecycle helpers
    # ------------------------------------------------------------------
    def sync_config_files(self) -> None:
        """Configuration sync placeholder kept for backwards compatibility."""
        return

    def init_managers(self, force_reload: bool = False) -> None:
        """Initialise core managers, tolerating absent configuration."""
        with self._manager_lock:
            self.sync_config_files()

            # Database manager (best-effort)
            db_manager: Optional[DatabaseManager]
            try:
                candidate = DatabaseManager()
                if not getattr(candidate, "is_configured", True):
                    self.logger.warning("数据库配置缺失，禁用数据库相关功能")
                    candidate = None
                db_manager = candidate
            except RuntimeError as exc:
                self.logger.warning("数据库未配置: %s", exc)
                db_manager = None
            except Exception as exc:  # pragma: no cover - defensive logging
                self.logger.error("数据库管理器初始化失败: %s", exc)
                db_manager = None
            self.database_manager = db_manager
            if self.database_guard is None:
                # Ensure guard is always initialized even if db_manager is None initially
                self.database_guard = DatabaseGuard(db_manager)
            else:
                self.database_guard.update_manager(db_manager)

            # Interpreter manager
            try:
                self.interpreter_manager = InterpreterManager()
            except Exception as exc:  # pragma: no cover - defensive logging
                self.logger.error("InterpreterManager 初始化失败: %s", exc)
                self.interpreter_manager = None

            # SQL executor provides graceful fallback even without DB config
            self.sql_executor = DirectSQLExecutor(self.database_manager)

            # Smart router initialisation (optional)
            try:
                self.smart_router = SmartRouter(
                    self.database_manager,
                    self.interpreter_manager,
                    self.database_guard
                )
            except Exception as exc:
                self.logger.warning("智能路由器初始化失败，将使用默认路由: %s", exc)
                self.smart_router = None

            # History manager
            if force_reload or self.history_manager is None:
                try:
                    self.history_manager = HistoryManager()
                except Exception as exc:  # pragma: no cover - defensive logging
                    self.logger.error("历史记录管理器初始化失败: %s", exc)
                    self.history_manager = None

            self.logger.info(
                "管理器初始化完成: database=%s, interpreter=%s, smart_router=%s",
                bool(self.database_manager),
                bool(self.interpreter_manager),
                bool(self.smart_router),
            )

    def ensure_history_manager(self, force_reload: bool = False) -> bool:
        if self.history_manager is None or force_reload:
            try:
                self.init_managers(force_reload=force_reload)
            except Exception as exc:  # pragma: no cover - defensive logging
                self.logger.error("初始化 history_manager 失败: %s", exc)
        return self.history_manager is not None

    def ensure_database_manager(self, force_reload: bool = False) -> bool:
        if force_reload:
            try:
                self.init_managers(force_reload=True)
            except Exception as exc:  # pragma: no cover - defensive logging
                self.logger.error("初始化 database_manager 失败: %s", exc)
            return self.database_manager is not None and getattr(
                self.database_manager, "is_configured", True
            )

        db_ready = self.database_manager is not None and getattr(
            self.database_manager, "is_configured", True
        )
        if db_ready:
            return True

        try:
            self.init_managers(force_reload=self.database_manager is None)
        except Exception as exc:  # pragma: no cover - defensive logging
            self.logger.error("初始化 database_manager 失败: %s", exc)
        return self.database_manager is not None and getattr(
            self.database_manager, "is_configured", True
        )

    # ------------------------------------------------------------------
    # Active query tracking
    # ------------------------------------------------------------------
    def mark_query_started(self, conversation_id: str, metadata: Optional[Dict[str, Any]] = None) -> None:
        payload = {"start_time": datetime.now(), "should_stop": False}
        if metadata:
            payload.update(metadata)
        with self._active_queries_lock:
            self._active_queries[conversation_id] = payload

    def mark_query_should_stop(self, conversation_id: str) -> None:
        with self._active_queries_lock:
            if conversation_id in self._active_queries:
                self._active_queries[conversation_id]["should_stop"] = True

    def clear_active_query(self, conversation_id: str) -> None:
        with self._active_queries_lock:
            self._active_queries.pop(conversation_id, None)

    def get_stop_status(self, conversation_id: Optional[str]) -> bool:
        if not conversation_id:
            return False
        with self._active_queries_lock:
            return self._active_queries.get(conversation_id, {}).get("should_stop", False)

    def active_queries_snapshot(self) -> Dict[str, Dict[str, Any]]:
        with self._active_queries_lock:
            return {cid: data.copy() for cid, data in self._active_queries.items()}


# Module-level singleton used throughout the app
service_container = ServiceContainer()
