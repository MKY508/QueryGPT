"""Business report rendering."""

from __future__ import annotations

from app.i18n import t
from app.models.analysis import (
    AnalysisReport,
)


def _report_markdown(report: AnalysisReport, language: str = "zh") -> str:
    parts = [f"## {report.title}", report.summary]
    if report.findings:
        parts.append("\n".join(f"- {finding}" for finding in report.findings))
    if report.confirmation:
        parts.append(
            f"### {t('analysis.confirmation_heading', language)}\n{report.confirmation.question}"
        )
    if report.action and report.action.kind == "add_data":
        requested = "\n".join(f"- {item}" for item in report.action.requested_data)
        parts.append(f"### {report.action.label}\n{report.action.reason}\n{requested}")
    return "\n\n".join(part for part in parts if part)
