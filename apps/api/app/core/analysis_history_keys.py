"""Portable v1 search projection for analysis navigation and its backfill."""

import unicodedata
from typing import Any


def analysis_search_text(query: str, report: Any = None) -> str:
    report = report if isinstance(report, dict) else {}
    fields = [query, report.get("title"), report.get("summary")]
    return unicodedata.normalize("NFKC", "\n".join(v for v in fields if isinstance(v, str))).lower()
