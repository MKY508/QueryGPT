import type { AnalysisSettlement } from "@/lib/stores/chat";

interface RefreshEffects {
  invalidate: (key: readonly string[]) => Promise<unknown>;
  currentProject: () => string | null;
  refreshProject: () => Promise<unknown>;
  acknowledge: (id: string) => void;
}

const PROJECT_RESOURCES = ["analysis-corrections", "analysis-correction-targets",
  "analysis-correction-target-options", "analysis-runs", "standing-analyses", "artifacts"];

/** One owner for each in-flight settlement, independent of component mounts. */
export function createAnalysisSettlementRefresher(effects: RefreshEffects) {
  const inFlight = new Map<string, Promise<void>>();
  return (settlement: AnalysisSettlement): Promise<void> => {
    const existing = inFlight.get(settlement.id);
    if (existing) return existing;
    const completion = Promise.resolve().then(async () => {
      const refreshes: (() => Promise<unknown>)[] = [() => effects.invalidate(["models"])];
      if (settlement.projectId) {
        const projectId = settlement.projectId;
        for (const resource of PROJECT_RESOURCES) refreshes.push(() => effects.invalidate([resource, projectId]));
        refreshes.push(async () => {
          if (effects.currentProject() === projectId) await effects.refreshProject();
        });
      }
      // A failed reader must not prevent the other resources from being refreshed.
      await Promise.allSettled(refreshes.map(refresh => Promise.resolve().then(refresh)));
      effects.acknowledge(settlement.id);
    }).finally(() => { inFlight.delete(settlement.id); });
    inFlight.set(settlement.id, completion);
    return completion;
  };
}
