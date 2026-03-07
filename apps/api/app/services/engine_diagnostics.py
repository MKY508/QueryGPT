"""Diagnostics helpers for the chat execution engine."""

from typing import TypedDict

from app.services.model_runtime import categorize_model_error


class DiagnosticEntry(TypedDict, total=False):
    attempt: int
    phase: str
    status: str
    message: str
    error_code: str | None
    error_category: str | None
    recoverable: bool | None
    sql: str | None
    python: str | None


def truncate_text(value: str | None, limit: int = 400) -> str | None:
    if not value:
        return None
    normalized = value.strip()
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 3] + "..."


def build_diagnostic_entry(
    *,
    attempt: int,
    phase: str,
    status: str,
    message: str,
    error_code: str | None = None,
    error_category: str | None = None,
    recoverable: bool | None = None,
    sql: str | None = None,
    python: str | None = None,
) -> DiagnosticEntry:
    return {
        "attempt": attempt,
        "phase": phase,
        "status": status,
        "message": message,
        "error_code": error_code,
        "error_category": error_category,
        "recoverable": recoverable,
        "sql": truncate_text(sql),
        "python": truncate_text(python),
    }


def categorize_generation_failure(message: str) -> tuple[str, str, bool]:
    category = categorize_model_error(message)
    code_map = {
        "auth": "MODEL_AUTH_ERROR",
        "timeout": "MODEL_TIMEOUT",
        "connection": "MODEL_CONNECTION_ERROR",
        "model_not_found": "MODEL_NOT_FOUND",
        "rate_limited": "MODEL_RATE_LIMITED",
        "provider_format": "PROVIDER_FORMAT_ERROR",
        "unknown": "MODEL_EXECUTION_ERROR",
    }
    recoverable = category in {"timeout", "rate_limited"}
    return code_map.get(category, "MODEL_EXECUTION_ERROR"), category, recoverable


def categorize_sql_error(message: str) -> tuple[str, str, bool]:
    normalized = message.lower()
    if any(
        token in normalized
        for token in (
            "password authentication failed",
            "access denied",
            "authentication failed",
            "login failed",
        )
    ):
        return "DB_AUTH_ERROR", "connection", False
    if any(
        token in normalized
        for token in (
            "connection refused",
            "could not connect",
            "can't connect",
            "server closed the connection",
            "timed out",
            "name or service not known",
            "network is unreachable",
        )
    ):
        return "DB_CONNECTION_ERROR", "connection", False
    if any(token in normalized for token in ("syntax", "parse error", "sql syntax", "near ")):
        return "SQL_SYNTAX_ERROR", "sql", True
    if any(
        token in normalized
        for token in ("no such table", "doesn't exist", "undefined table", "unknown table")
    ):
        return "SQL_TABLE_ERROR", "schema", True
    if any(
        token in normalized
        for token in (
            "no such column",
            "unknown column",
            "undefined column",
            "ambiguous column",
        )
    ):
        return "SQL_COLUMN_ERROR", "schema", True
    if any(
        token in normalized
        for token in ("只允许执行只读查询", "危险关键字", "多语句", "sql 注释", "只读查询")
    ):
        return "SQL_SAFETY_ERROR", "safety", False
    return "SQL_EXECUTION_ERROR", "sql", True


def categorize_python_error(message: str) -> tuple[str, str, bool]:
    normalized = message.lower()
    if "检测到不安全的操作" in message:
        return "PYTHON_SECURITY_ERROR", "safety", False
    if "语法错误" in message or "syntaxerror" in normalized:
        return "PYTHON_SYNTAX_ERROR", "python", True
    if "timed out" in normalized or "timeout" in normalized:
        return "PYTHON_TIMEOUT", "python", True
    if any(
        token in normalized
        for token in (
            "nameerror",
            "attributeerror",
            "typeerror",
            "valueerror",
            "keyerror",
            "indexerror",
            "modulenotfounderror",
            "runtimeerror",
            "执行错误",
        )
    ):
        return "PYTHON_RUNTIME_ERROR", "python", True
    return "PYTHON_EXECUTION_ERROR", "python", True
