"use client";

import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createAnalysisSettlementRefresher } from "@/lib/analysis-settlement-refresh";
import { useChatStore, type AnalysisSettlement } from "@/lib/stores/chat";
import { useProjectStore } from "@/lib/stores/project";

const refreshers = new WeakMap<QueryClient, ReturnType<typeof createAnalysisSettlementRefresher>>();

export function useAnalysisSettlementRefresh(settlements: readonly AnalysisSettlement[]) {
  const client = useQueryClient();
  useEffect(() => {
    let refresh = refreshers.get(client);
    if (!refresh) {
      refresh = createAnalysisSettlementRefresher({
        invalidate: queryKey => client.invalidateQueries({ queryKey }),
        currentProject: () => useProjectStore.getState().currentProjectId,
        refreshProject: () => useProjectStore.getState().refreshCurrent(),
        acknowledge: id => useChatStore.getState().acknowledgeAnalysisSettlement(id),
      });
      refreshers.set(client, refresh);
    }
    for (const settlement of settlements) void refresh(settlement);
  }, [client, settlements]);
}
