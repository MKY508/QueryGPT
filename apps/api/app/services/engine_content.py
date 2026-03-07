"""Helpers for parsing and cleaning model output."""

from __future__ import annotations

import json
import re
from typing import Any

import structlog

logger = structlog.get_logger()


def parse_thinking_markers(content: str) -> list[str]:
    """Return unique thinking markers in appearance order."""
    pattern = r"\[thinking:\s*([^\]]+)\]"
    return [match.group(1).strip() for match in re.finditer(pattern, content)]


def extract_python_block(content: str) -> str | None:
    """Extract a python or ipython code block."""
    python_match = re.search(
        r"```(?:python|ipython|py)\s*([\s\S]*?)```", content, re.IGNORECASE
    )
    if python_match:
        return python_match.group(1).strip()
    return None


def extract_sql_block(content: str) -> str | None:
    """Extract SQL from a fenced block or a raw SELECT statement."""
    sql_match = re.search(r"```sql\s*([\s\S]*?)```", content, re.IGNORECASE)
    if sql_match:
        return sql_match.group(1).strip()

    select_match = re.search(r"(SELECT\s+[\s\S]*?(?:;|$))", content, re.IGNORECASE)
    if select_match:
        return select_match.group(1).strip().rstrip(";") + ";"

    return None


def extract_chart_config(content: str) -> dict[str, Any] | None:
    """Extract a JSON chart config from a fenced chart block."""
    pattern = r"```chart\s*\n?([\s\S]*?)\n?```"
    match = re.search(pattern, content, re.IGNORECASE)
    if not match:
        return None

    try:
        config = json.loads(match.group(1).strip())
    except json.JSONDecodeError as exc:
        logger.warning("Failed to parse chart config", error=str(exc))
        return None

    if "type" in config:
        logger.info("Extracted chart config", chart_type=config.get("type"))
        return config
    return None


def clean_content_for_display(content: str) -> str:
    """Strip executable blocks and internal markers from model output."""
    content = re.sub(r"```sql\s*[\s\S]*?```", "", content, flags=re.IGNORECASE)
    content = re.sub(
        r"```(?:python|ipython|py)\s*[\s\S]*?```",
        "",
        content,
        flags=re.IGNORECASE,
    )
    content = re.sub(r"```chart\s*[\s\S]*?```", "", content, flags=re.IGNORECASE)
    content = re.sub(r"\[thinking:\s*[^\]]+\]", "", content)
    content = re.sub(r"\n{3,}", "\n\n", content)
    return content.strip()
