import type { ReportPage } from "./reports";
import {
  applyReportInteractions, crossFilterRule, interactionKey, resolveSelections, selectionValues,
  type ReportSelection,
} from "./report-interactions";
import { reportFiltersForPage, type ConnectedReportFilter } from "./report-filter-connections";

/** Ephemeral reader state. Never part of the report document or edit history. */
export interface ReportReadingState {
  filters: Record<string, string>;
  selections: ReportSelection[];
}

export const EMPTY_REPORT_READING: ReportReadingState = { filters: {}, selections: [] };

type ReadingAction =
  | { type: "reset" }
  | { type: "filter"; blockId: string; value: string }
  | { type: "toggle"; selection: ReportSelection }
  | { type: "clear"; pageId?: string; sourceKey?: string }
  | { type: "remap"; pageIds: ReadonlyMap<string, string>; blockIds: ReadonlyMap<string, string> };

export function reportReadingReducer(state: ReportReadingState, action: ReadingAction): ReportReadingState {
  switch (action.type) {
    case "reset": return EMPTY_REPORT_READING;
    case "filter": {
      if ((state.filters[action.blockId] || "") === action.value) return state;
      const filters = { ...state.filters };
      if (action.value) filters[action.blockId] = action.value;
      else delete filters[action.blockId];
      return { ...state, filters };
    }
    case "toggle": {
      const next = action.selection;
      const previous = state.selections.find(item => item.pageId === next.pageId && item.sourceKey === next.sourceKey);
      const selections = state.selections.filter(item => item.pageId !== next.pageId || item.sourceKey !== next.sourceKey);
      if (!previous || previous.value !== next.value || previous.ruleKey !== next.ruleKey) selections.push(next);
      return { ...state, selections };
    }
    case "clear": {
      const selections = state.selections.filter(item =>
        (action.pageId !== undefined && item.pageId !== action.pageId) ||
        (action.sourceKey !== undefined && item.sourceKey !== action.sourceKey));
      return selections.length === state.selections.length ? state : { ...state, selections };
    }
    case "remap": return {
      filters: Object.fromEntries(Object.entries(state.filters).map(([id, value]) => [action.blockIds.get(id) ?? id, value])),
      // Cross-filter keys are document configuration; only the page gets a new server identity.
      selections: state.selections.map(item => ({ ...item, pageId: action.pageIds.get(item.pageId) ?? item.pageId })),
    };
  }
}

/** The same projection feeds the live canvas, PDF and image capture. */
export function readReportPage(
  page: ReportPage, state: ReportReadingState, connected: ConnectedReportFilter[],
  editing = false,
) {
  const filters = reportFiltersForPage(page, state.filters, connected);
  const selections = editing ? [] : resolveSelections(page, state.selections);
  const selectionBySource = new Map(selections.map(item => [item.sourceKey, item]));
  const sourceCounts = new Map<string, number>();
  for (const block of page.blocks) {
    const key = interactionKey(block);
    if (key) sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
  }
  const connectedCounts = new Map(connected.map(item => [item.block.id, item.targets.length]));
  return {
    selections,
    inheritedFilters: connected.filter(({ block, targets }) =>
      !page.blocks.some(item => item.id === block.id) && targets.some(target => target.page.id === page.id)),
    blocks: page.blocks.map(source => {
      const block = applyReportInteractions(source, filters, selections);
      const key = interactionKey(source);
      const rule = !editing && sourceCounts.get(key) === 1 ? crossFilterRule(page, source) : null;
      const selection = rule?.targets.length ? {
        field: rule.field,
        values: selectionValues(block, rule.field),
        selected: selectionBySource.get(key),
      } : undefined;
      return { block, selection, filterConnectedCount: connectedCounts.get(source.id) };
    }),
  };
}
