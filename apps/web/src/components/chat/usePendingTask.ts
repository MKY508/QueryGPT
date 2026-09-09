"use client";

import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { pendingTaskStore, parsePendingTask } from "@/lib/pending-task";

export function usePendingTask(projectId: string | null, store = pendingTaskStore) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, () => null);
  useLayoutEffect(() => { store.hydrate(); }, [store]);
  const task = useMemo(() => {
    if (!projectId || !snapshot) return null;
    try {
      const parsed = parsePendingTask(JSON.parse(snapshot));
      return parsed?.projectId === projectId ? parsed : null;
    } catch { return null; }
  }, [projectId, snapshot]);
  return {
    task,
    isCurrent: () => Boolean(task && store.getSnapshot() === snapshot),
    // A late result may remove only the snapshot that produced its action.
    clear: () => task ? store.clearIfUnchanged(snapshot) : false,
    write: store.write,
  };
}
