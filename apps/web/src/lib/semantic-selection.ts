import type { SemanticEntry } from "@/lib/types/api";

// Match the existing batch API limit; selection never means all matching rows.
export const SEMANTIC_SELECTION_LIMIT = 100;
export type SemanticSelection = Map<string, { entry: SemanticEntry; needsReview: boolean }>;

export function toggleSemanticSelection(current: SemanticSelection, entries: SemanticEntry[]): SemanticSelection {
  if (!entries.length) return current;
  const next = new Map(current);
  if (entries.every(entry => current.has(entry.id))) entries.forEach(entry => next.delete(entry.id));
  else for (const entry of entries) {
    if (!entry.active_revision_id) return current;
    if (!next.has(entry.id)) next.set(entry.id, { entry, needsReview: false });
  }
  return next.size <= SEMANTIC_SELECTION_LIMIT ? next : current;
}

export function removeSemanticSelection(current: SemanticSelection, ids: string[]): SemanticSelection {
  const next = new Map(current);
  ids.forEach(id => next.delete(id));
  return next.size === current.size ? current : next;
}

/** Keep the version actually selected. A later read must not silently endorse a new one. */
export function reconcileSemanticSelection(current: SemanticSelection, entries: SemanticEntry[]): SemanticSelection {
  const next = new Map(current);
  for (const entry of entries) {
    const selected = current.get(entry.id);
    if (selected && !selected.needsReview && (
      entry.project_id !== selected.entry.project_id || entry.active_revision_id !== selected.entry.active_revision_id
      || entry.is_active !== selected.entry.is_active
      || [...entry.allowed_actions].sort().join() !== [...selected.entry.allowed_actions].sort().join()
    )) next.set(entry.id, { ...selected, needsReview: true });
  }
  return [...next].some(([id, value]) => value !== current.get(id)) ? next : current;
}
