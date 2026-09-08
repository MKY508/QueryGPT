// Generated from app/models/analysis_state.py. Run scripts/generate-analysis-state.py.
export const ANALYSIS_STATES = ["understanding", "investigating", "waiting_confirmation", "completed", "needs_attention"] as const;
export type AnalysisState = (typeof ANALYSIS_STATES)[number];

export const TERMINAL_ANALYSIS_STATES: readonly AnalysisState[] = ["waiting_confirmation", "completed", "needs_attention"];
