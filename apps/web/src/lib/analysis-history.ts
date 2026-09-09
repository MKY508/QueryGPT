import type { AnalysisHistoryItem, AnalysisHistoryPage } from "@/lib/types/api";

export const HISTORY_FILTERS = ["all", "completed", "waiting_confirmation", "needs_attention", "active"] as const;
export type HistoryFilter = typeof HISTORY_FILTERS[number];
export const HISTORY_PAGE_SIZE = 12;

export const HISTORY_STATE_LABELS = {
  all: "filterAll", completed: "stateCompleted", waiting_confirmation: "statePending",
  needs_attention: "stateNeedsAttention", active: "filterActive", investigating: "stateInvestigating", understanding: "statePreparing",
} as const;

export function analysisHistoryTitle(run: AnalysisHistoryItem, fallback: string): string {
  return run.report.title?.trim() || run.query.trim() || fallback;
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const optionalText = (value: unknown) => value == null || typeof value === "string";

/** A history preview and its navigation target must belong to the requested project. */
export function inspectAnalysisHistoryPage(value: unknown, projectId: string, currentRunId: string | null): AnalysisHistoryPage {
  if (!record(value) || !Array.isArray(value.items)) throw new Error("Invalid analysis history");
  const { total, count, page, page_size: size, page_count: pages } = value;
  if (![total, count, page, size, pages].every(item => typeof item === "number" && Number.isSafeInteger(item))
    || (total as number) < 0 || (count as number) < 0 || (count as number) > (total as number)
    || size !== HISTORY_PAGE_SIZE || pages !== Math.max(1, Math.ceil((count as number) / HISTORY_PAGE_SIZE))
    || (page as number) < 1 || (page as number) > (pages as number)
    || value.items.length !== Math.min(HISTORY_PAGE_SIZE, (count as number) - ((page as number) - 1) * HISTORY_PAGE_SIZE)
    || (value.current_run_id !== null && value.current_run_id !== currentRunId)) throw new Error("Invalid analysis history page");
  const ids = new Set<string>();
  for (const item of value.items) {
    if (!record(item) || typeof item.id !== "string" || !item.id || ids.has(item.id)
      || item.project_id !== projectId || !optionalText(item.conversation_id)
      || typeof item.query !== "string" || typeof item.stage !== "string"
      || !["understanding", "investigating", "waiting_confirmation", "completed", "needs_attention"].includes(String(item.state))
      || !record(item.report) || !optionalText(item.report.title) || !optionalText(item.report.summary)
      || !date(item.created_at) || !date(item.updated_at)) throw new Error("Invalid analysis history item");
    ids.add(item.id);
  }
  return value as unknown as AnalysisHistoryPage;
}
