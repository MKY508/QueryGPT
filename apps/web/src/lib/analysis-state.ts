import {
  ANALYSIS_STATES,
  TERMINAL_ANALYSIS_STATES,
  type AnalysisState,
} from "@/lib/types/analysis-state";

export function parseAnalysisState(value: unknown): AnalysisState | undefined {
  return typeof value === "string" && ANALYSIS_STATES.some((state) => state === value)
    ? value as AnalysisState
    : undefined;
}

export function isTerminalAnalysisState(state: AnalysisState | undefined): boolean {
  return state !== undefined && TERMINAL_ANALYSIS_STATES.includes(state);
}
