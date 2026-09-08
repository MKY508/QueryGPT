"use client";

import { useCallback, useMemo, useReducer } from "react";
import type { ReportDocument, ReportPage } from "@/lib/reports";
import { connectedReportFilters } from "@/lib/report-filter-connections";
import { interactionKey, makeReportSelection, type CrossFilterValue } from "@/lib/report-interactions";
import { EMPTY_REPORT_READING, readReportPage, reportReadingReducer } from "@/lib/report-reading";

/** The keyed report workspace owns the session; this hook owns only reading choices. */
export function useReportReading(report: ReportDocument | null, activePage: ReportPage | null, editing: boolean) {
  const [state, dispatch] = useReducer(reportReadingReducer, EMPTY_REPORT_READING);
  const connected = useMemo(() => report ? connectedReportFilters(report) : [], [report]);
  const page = useMemo(() => activePage ? readReportPage(activePage, state, connected, editing) : null,
    [activePage, state, connected, editing]);

  const reset = useCallback(() => dispatch({ type: "reset" }), []);
  const clearSelections = useCallback((pageId?: string, sourceKey?: string) =>
    dispatch({ type: "clear", pageId, sourceKey }), []);
  const setFilter = useCallback((blockId: string, value: string) => dispatch({ type: "filter", blockId, value }), []);
  const remap = useCallback((pageIds: ReadonlyMap<string, string>, blockIds: ReadonlyMap<string, string>) =>
    dispatch({ type: "remap", pageIds, blockIds }), []);
  const select = useCallback((blockId: string, value: CrossFilterValue | undefined) => {
    if (!activePage || editing) return;
    const source = activePage.blocks.find(block => block.id === blockId);
    if (!source) return;
    if (value === undefined) {
      dispatch({ type: "clear", pageId: activePage.id, sourceKey: interactionKey(source) });
      return;
    }
    // Only values visible in this projection can originate a new chart action.
    const control = page?.blocks.find(item => item.block.id === blockId)?.selection;
    if (!control?.values.some(item => item === value)) return;
    const selection = makeReportSelection(activePage, source, value);
    if (selection) dispatch({ type: "toggle", selection });
  }, [activePage, editing, page]);

  return { state, page, reset, clearSelections, setFilter, remap, select };
}
