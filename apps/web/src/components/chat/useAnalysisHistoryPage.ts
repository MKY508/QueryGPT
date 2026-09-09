"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { HISTORY_PAGE_SIZE, inspectAnalysisHistoryPage, type HistoryFilter } from "@/lib/analysis-history";

export interface AnalysisHistoryView { search: string; filter: HistoryFilter; page: number }

export function useAnalysisHistoryPage(projectId: string | null, currentRunId: string | null,
  view: AnalysisHistoryView, enabled = true, composing = false) {
  const [settledSearch, setSettledSearch] = useState(view.search);
  useEffect(() => {
    const timer = setTimeout(() => setSettledSearch(view.search), 250);
    return () => clearTimeout(timer);
  }, [view.search]);
  const debouncing = Boolean(view.search) && view.search !== settledSearch;
  const selection = { search: view.search, filter: view.filter, currentRunId };
  const query = useQuery({
    // Reuse the existing invalidation prefix when a run completes or changes.
    queryKey: ["analysis-runs", projectId, "history", selection, view.page],
    queryFn: async ({ signal }) => {
      const response = await api.get(`/api/v1/projects/${projectId}/analysis-history`, {
        signal, params: { q: view.search, status: view.filter, page: view.page,
          page_size: HISTORY_PAGE_SIZE, current_run_id: currentRunId || undefined },
      });
      return inspectAnalysisHistoryPage(response.data.data, projectId!, currentRunId);
    },
    enabled: Boolean(projectId) && enabled && !debouncing && !composing,
    placeholderData: (previous, previousQuery) => {
      const key = previousQuery?.queryKey;
      // Only a page turn may retain its previous page. Never display results
      // from another project/search/status/current-result under new controls.
      return key?.[1] === projectId && JSON.stringify(key[3]) === JSON.stringify(selection) ? previous : undefined;
    },
    retry: false,
    networkMode: "always",
    refetchOnWindowFocus: false,
    gcTime: 60_000,
  });
  return { ...query, data: debouncing || composing ? undefined : query.data,
    isLoading: Boolean(projectId) && (debouncing || composing || query.isPending),
    isFetching: query.isFetching || debouncing || composing };
}
