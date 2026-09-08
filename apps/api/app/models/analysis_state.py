"""Durable investigation states, independent of work steps and transport status."""

from enum import StrEnum


class AnalysisState(StrEnum):
    UNDERSTANDING = "understanding"
    INVESTIGATING = "investigating"
    WAITING_CONFIRMATION = "waiting_confirmation"
    COMPLETED = "completed"
    NEEDS_ATTENTION = "needs_attention"


TERMINAL_ANALYSIS_STATES = frozenset(
    {
        AnalysisState.WAITING_CONFIRMATION,
        AnalysisState.COMPLETED,
        AnalysisState.NEEDS_ATTENTION,
    }
)

REPORT_ANALYSIS_STATES = {
    "waiting_confirmation": AnalysisState.WAITING_CONFIRMATION,
    "completed": AnalysisState.COMPLETED,
    "needs_data": AnalysisState.NEEDS_ATTENTION,
}


def parse_analysis_state(value: object) -> AnalysisState | None:
    try:
        return AnalysisState(value)
    except (ValueError, TypeError):
        return None
