import type { VisualCleaningOperation } from "./types/api";
import { cleaningOperationKey } from "./cleaning-edit-history";
import { isCleaningFieldName } from "./cleaning-field-names";
import { copyTextReplacements, MAX_RECIPE_TEXT_REPLACEMENTS } from "./text-value-replacements";

export interface SavedVisualCleaningState {
  operations: VisualCleaningOperation[];
  operationKeys: Set<string>;
  hasSavedOperations: boolean;
  hasUnsupportedOperations: boolean;
  blockedOperations: unknown[];
  omittedOperations: number;
}

const MAX_STEPS = 100;
const COMMON_KEYS = ["operation", "contract_version", "replayed"];
const STEP_KEYS: Record<VisualCleaningOperation["operation"], readonly string[]> = {
  drop_exact_duplicates: ["count"],
  trim_text: ["column", "error_policy"],
  normalize_currency: ["column", "error_policy"],
  normalize_datetime: ["column", "error_policy"],
  fill_missing: ["column", "value"],
  replace_text_values: ["column", "replacements"],
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function boundedColumn(value: unknown): value is string {
  if (!isCleaningFieldName(value)) return false;
  return value.length <= 10_000 || (value.length <= 20_000 && Array.from(value).length <= 10_000);
}

/** Mirrors the known backend v1 fields before projecting into editable controls. */
export function editableSavedOperation(value: unknown): VisualCleaningOperation | null {
  if (!record(value) || !Object.prototype.hasOwnProperty.call(value, "operation") || typeof value.operation !== "string"
    || !Object.prototype.hasOwnProperty.call(STEP_KEYS, value.operation)) return null;
  const operation = value.operation as VisualCleaningOperation["operation"];
  const allowed = new Set([...COMMON_KEYS, ...STEP_KEYS[operation]]);
  if (Object.keys(value).some(key => !allowed.has(key))
    || ("contract_version" in value && value.contract_version !== 1)
    || ("replayed" in value && typeof value.replayed !== "boolean")) return null;
  if (operation === "drop_exact_duplicates") {
    if ("count" in value && (typeof value.count !== "number" || !Number.isSafeInteger(value.count) || value.count < 0)) return null;
    return { operation };
  }
  if (!boundedColumn(value.column)) return null;
  const column = value.column;
  if (operation === "fill_missing") return value.value === 0 ? { operation, column, value: 0 } : null;
  if (operation === "replace_text_values") {
    const replacements = copyTextReplacements(value.replacements);
    return replacements ? { operation, column, replacements } : null;
  }
  const policy = operation === "trim_text" ? "preserve_original" : "set_null";
  if ("error_policy" in value && value.error_policy !== policy) return null;
  return { operation, column };
}

export function rawOperationKey(value: unknown): string | null {
  if (!record(value) || typeof value.operation !== "string") return null;
  const operation = value.operation;
  if (!operation.trim() || operation.startsWith("replay_") || operation === "reapply_recipe") return null;
  if (isCleaningFieldName(value.column)) return `${operation}:${value.column}`;
  if (typeof value.sheet === "string" && value.sheet.trim()) return `${operation}:${value.sheet}`;
  if (typeof value.row === "number" && Number.isFinite(value.row)) return `${operation}:${value.row}`;
  return `${operation}:all`;
}

export function inspectSavedVisualCleaningOperations(value: unknown): SavedVisualCleaningState {
  const state: SavedVisualCleaningState = { operations: [], operationKeys: new Set(), hasSavedOperations: false, hasUnsupportedOperations: false, blockedOperations: [], omittedOperations: 0 };
  if (value === null || value === undefined) return state;
  if (!record(value) || ("operations" in value && !Array.isArray(value.operations))) {
    return { ...state, hasSavedOperations: true, hasUnsupportedOperations: true };
  }
  if (!("operations" in value)) return state;
  const raw = value.operations as unknown[];
  state.hasSavedOperations = raw.length > 0;
  // Oversized methods stay read-only; do not mount an unbounded editor draft.
  const visible = raw.slice(0, MAX_STEPS);
  for (const item of visible) {
    const key = rawOperationKey(item);
    if (key) state.operationKeys.add(key);
  }
  if (raw.length > MAX_STEPS) {
    return { ...state, hasUnsupportedOperations: true, blockedOperations: visible, omittedOperations: raw.length - MAX_STEPS };
  }
  const editableKeys = new Set<string>();
  let replacementCount = 0;
  for (const item of visible) {
    const parsed = editableSavedOperation(item);
    if (!parsed || editableKeys.has(cleaningOperationKey(parsed))) {
      state.hasUnsupportedOperations = true;
      state.blockedOperations.push(item);
      continue;
    }
    editableKeys.add(cleaningOperationKey(parsed));
    if (parsed.operation === "replace_text_values") replacementCount += parsed.replacements.length;
    state.operations.push(parsed);
  }
  if (replacementCount > MAX_RECIPE_TEXT_REPLACEMENTS) state.hasUnsupportedOperations = true;
  return state;
}

/** Compatibility projection only. Editors must also inspect the whole method. */
export function parseSavedVisualCleaningOperations(value: unknown): VisualCleaningOperation[] {
  return inspectSavedVisualCleaningOperations(value).operations;
}
