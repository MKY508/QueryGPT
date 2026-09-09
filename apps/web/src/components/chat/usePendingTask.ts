"use client";

import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { pendingTaskStore, parsePendingTask, type PendingTask } from "@/lib/pending-task";

export function usePendingTask(projectId: string | null, store = pendingTaskStore) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, () => null);
  const [failedWrite, setFailedWrite] = useState<{ task: PendingTask; baseline: string | null } | null>(null);
  useLayoutEffect(() => { store.hydrate(); }, [store]);
  const task = useMemo(() => {
    if (!projectId || !snapshot) return null;
    try {
      const parsed = parsePendingTask(JSON.parse(snapshot));
      return parsed?.projectId === projectId ? parsed : null;
    } catch { return null; }
  }, [projectId, snapshot]);
  const failure = failedWrite?.task.projectId === projectId && failedWrite.baseline === snapshot ? failedWrite : null;
  const write = (value: PendingTask): boolean => {
    const baseline = store.getSnapshot();
    try {
      store.write(value);
      setFailedWrite(null);
      return true;
    } catch {
      setFailedWrite({ task: value, baseline });
      return false;
    }
  };
  return {
    task,
    isCurrent: () => Boolean(task && store.getSnapshot() === snapshot),
    // A late result may remove only the snapshot that produced its action.
    clear: () => task ? store.clearIfUnchanged(snapshot) : false,
    write,
    failedTask: failure?.task ?? null,
    retryWrite: () => failure && store.getSnapshot() === failure.baseline ? write(failure.task) : false,
    dismissFailure: () => setFailedWrite(null),
  };
}
