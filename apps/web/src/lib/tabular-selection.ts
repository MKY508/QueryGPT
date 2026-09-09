import type { TableRecord } from "./tabular-data";

/** Snapshot positions distinguish equal rows and repeated object references. */
export function updateTableSelection(current: ReadonlySet<number>, indices: readonly number[], checked: boolean): Set<number> {
  const next = new Set(current);
  for (const index of indices) {
    if (checked) next.add(index); else next.delete(index);
  }
  return next;
}

/** Ranges follow the current filtered order, even across pages. An anchor
 * excluded by a filter cannot select unseen records between old positions. */
export function tableSelectionRange(records: readonly TableRecord[], anchor: number | null, target: number): number[] {
  const end = records.findIndex((record) => record.index === target);
  if (end < 0) return [];
  const start = anchor === null ? -1 : records.findIndex((record) => record.index === anchor);
  if (start < 0) return [target];
  return records.slice(Math.min(start, end), Math.max(start, end) + 1).map((record) => record.index);
}
