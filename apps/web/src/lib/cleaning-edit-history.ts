import type { VisualCleaningOperation } from "./types/api";

interface CleaningHistoryEntry {
  operations: VisualCleaningOperation[];
  skippedKeys: readonly string[];
  weight: number;
}

export interface CleaningEditHistory {
  past: CleaningHistoryEntry[];
  present: CleaningHistoryEntry;
  future: CleaningHistoryEntry[];
}

type CleaningHistoryAction =
  | { type: "record"; operations: VisualCleaningOperation[] }
  | { type: "toggle"; key: string }
  | { type: "undo" | "redo" };

// Weight is a conservative text/structure budget, not a JavaScript heap limit.
const HISTORY_LIMITS = { depth: 50, weight: 8_000_000 };

export function cleaningOperationKey(operation: VisualCleaningOperation): string {
  return `${operation.operation}:${"column" in operation ? operation.column : "all"}`;
}

export function activeCleaningOperations(snapshot: CleaningHistoryEntry): VisualCleaningOperation[] {
  const skipped = new Set(snapshot.skippedKeys);
  return snapshot.operations.filter((operation) => !skipped.has(cleaningOperationKey(operation)));
}

function entry(operations: VisualCleaningOperation[], skippedKeys: readonly string[] = []): CleaningHistoryEntry {
  let weight = 0;
  const owned = operations.map((operation) => {
    weight += 32 + operation.operation.length + ("column" in operation ? operation.column.length : 0);
    if (operation.operation !== "replace_text_values") return Object.freeze({ ...operation });
    const replacements = operation.replacements.map((replacement) => {
      weight += 16 + replacement.from_value.length + replacement.to_value.length;
      return Object.freeze({ ...replacement });
    });
    Object.freeze(replacements);
    return Object.freeze({ ...operation, replacements });
  });
  Object.freeze(owned);
  const skipped = new Set(skippedKeys);
  const retainedKeys = owned.map(cleaningOperationKey).filter((key) => skipped.has(key));
  weight += retainedKeys.reduce((total, key) => total + 16 + key.length, 0);
  return { operations: owned, skippedKeys: Object.freeze(retainedKeys), weight };
}

function sameOperations(left: readonly VisualCleaningOperation[], right: readonly VisualCleaningOperation[]): boolean {
  return left.length === right.length && left.every((operation, index) => {
    const other = right[index];
    if (operation.operation !== other.operation) return false;
    if ("column" in operation && (!("column" in other) || operation.column !== other.column)) return false;
    if (operation.operation === "fill_missing" && other.operation === "fill_missing") return operation.value === other.value;
    if (operation.operation !== "replace_text_values" || other.operation !== "replace_text_values") return true;
    return operation.replacements.length === other.replacements.length && operation.replacements.every((pair, pairIndex) => {
      const next = other.replacements[pairIndex];
      return pair.from_value === next.from_value && pair.to_value === next.to_value;
    });
  });
}

/** Compare the current draft, not its undo/redo depth or only enabled steps. */
export function hasCleaningEdits(snapshot: CleaningEditHistory["present"], saved: readonly VisualCleaningOperation[]): boolean {
  return snapshot.skippedKeys.length > 0 || !sameOperations(snapshot.operations, saved);
}

export function createCleaningEditHistory(operations: VisualCleaningOperation[]): CleaningEditHistory {
  return { past: [], present: entry(operations), future: [] };
}

/** Redux's past/present/future recipe, scoped to uncommitted cleaning edits. */
export function createCleaningHistoryReducer(limits = HISTORY_LIMITS) {
  return (state: CleaningEditHistory, action: CleaningHistoryAction): CleaningEditHistory => {
    const past = state.past.slice();
    let future = state.future.slice();
    let present = state.present;
    if (action.type === "record") {
      // Preserve the established execution order: mappings follow preparation.
      const operations = [
        ...action.operations.filter((operation) => operation.operation !== "replace_text_values"),
        ...action.operations.filter((operation) => operation.operation === "replace_text_values"),
      ];
      if (sameOperations(state.present.operations, operations)) return state;
      past.push(present);
      present = entry(operations, present.skippedKeys);
      future = [];
    } else if (action.type === "toggle") {
      if (!present.operations.some((operation) => cleaningOperationKey(operation) === action.key)) return state;
      past.push(present);
      present = entry(present.operations, present.skippedKeys.includes(action.key)
        ? present.skippedKeys.filter((key) => key !== action.key)
        : [...present.skippedKeys, action.key]);
      future = [];
    } else {
      const from = action.type === "undo" ? past : future;
      const to = action.type === "undo" ? future : past;
      const target = from.pop();
      if (!target) return state;
      to.push(present);
      present = target;
    }

    let weight = [...past, ...future].reduce((total, item) => total + item.weight, 0);
    while (past.length + future.length > limits.depth || weight > limits.weight) {
      // Evict the farthest edge, retaining the nearest undo/redo when possible.
      const side = past.length >= future.length ? past : future;
      const removed = side.shift();
      if (!removed) break;
      weight -= removed.weight;
    }
    return { past, present, future };
  };
}

export const cleaningEditHistoryReducer = createCleaningHistoryReducer();
