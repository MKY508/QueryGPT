import type { SemanticValidationSelection } from "@/lib/stores/chat";
import { migratePendingTaskStorage, PENDING_TASK_STORAGE_KEY } from "@/lib/storage/legacy";

export interface PendingTask {
  query: string;
  projectId: string | null;
  validationSelection?: SemanticValidationSelection[];
}

export function parsePendingTask(value: unknown): PendingTask | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.query !== "string" || !candidate.query.trim()) return null;
  if (candidate.projectId !== null && typeof candidate.projectId !== "string") return null;

  let validationSelection: SemanticValidationSelection[] | undefined;
  if (candidate.validationSelection !== undefined) {
    if (
      !Array.isArray(candidate.validationSelection) ||
      candidate.validationSelection.length > 100
    ) {
      return null;
    }
    validationSelection = [];
    for (const item of candidate.validationSelection) {
      if (!item || typeof item !== "object") return null;
      const selection = item as Record<string, unknown>;
      if (
        typeof selection.entry_id !== "string" ||
        !selection.entry_id ||
        typeof selection.expected_active_revision_id !== "string" ||
        !selection.expected_active_revision_id
      ) {
        return null;
      }
      validationSelection.push({
        entry_id: selection.entry_id,
        expected_active_revision_id: selection.expected_active_revision_id,
      });
    }
  }
  return {
    query: candidate.query,
    projectId: candidate.projectId as string | null,
    ...(validationSelection ? { validationSelection } : {}),
  };
}

/** One parked task for this tab; snapshots include a per-write identity. */
export function createPendingTaskStore(storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem"> | null) {
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  const getSnapshot = (): string | null => {
    try { return storage()?.getItem(PENDING_TASK_STORAGE_KEY) ?? null; }
    catch { return null; }
  };
  return {
    getSnapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    hydrate: () => {
      try { const target = storage(); if (target) migratePendingTaskStorage(target); }
      catch { /* An unreadable entry is not evidence that it can be removed. */ }
      notify();
    },
    write: (task: PendingTask) => {
      const target = storage();
      if (!target) throw new Error("Task storage unavailable");
      if (!parsePendingTask(task)) throw new Error("Invalid pending task");
      target.setItem(PENDING_TASK_STORAGE_KEY, JSON.stringify({ ...task, receipt: crypto.randomUUID() }));
      notify();
    },
    clearIfUnchanged: (expected: string | null): boolean => {
      if (!expected) return false;
      try {
        const target = storage();
        if (!target || target.getItem(PENDING_TASK_STORAGE_KEY) !== expected) return false;
        target.removeItem(PENDING_TASK_STORAGE_KEY);
        notify();
        return true;
      } catch { return false; }
    },
  };
}

export const pendingTaskStore = createPendingTaskStore(() => typeof window === "undefined" ? null : window.sessionStorage);
