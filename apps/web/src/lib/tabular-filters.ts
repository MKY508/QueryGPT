import { isNumericCell, numericValue } from "./numeric-values";
import { dataCellText, dataCellValue, type TabularRow } from "./tabular-data";

export type TableFieldKind = "number" | "text" | "boolean" | "structured";
export type TableFilterOperator = "contains" | "not_contains" | "equals" | "not_equals"
  | "starts_with" | "ends_with" | "gt" | "gte" | "lt" | "lte" | "between"
  | "is_missing" | "is_empty_text" | "has_value";
export interface TableFilter {
  id: string;
  field: string;
  operator: TableFilterOperator;
  value: string;
  upper: string;
}
export interface TableFilters { mode: "all" | "any"; rules: TableFilter[] }
export const EMPTY_TABLE_FILTERS: TableFilters = { mode: "all", rules: [] };
const unary: TableFilterOperator[] = ["is_missing", "is_empty_text", "has_value"];

/** Infer from the complete snapshot, independent of search, filters or hidden columns. */
export function tableFieldKinds(rows: readonly TabularRow[], fields: readonly string[]) {
  return new Map(fields.map((field): [string, TableFieldKind] => {
    const values = rows.map((row) => dataCellValue(row, field))
      .filter((value) => value != null && value !== "");
    return [field, values.length && values.every(isNumericCell) ? "number"
      : values.length && values.every((value) => typeof value === "boolean") ? "boolean"
      : values.length && values.every((value) => typeof value === "object") ? "structured" : "text"];
  }));
}

export function tableFilterOperators(kind: TableFieldKind): TableFilterOperator[] {
  if (kind === "number") return ["equals", "not_equals", "gt", "gte", "lt", "lte", "between", ...unary];
  if (kind === "boolean") return ["equals", "not_equals", ...unary];
  if (kind === "structured") return unary;
  return ["contains", "not_contains", "equals", "not_equals", "starts_with", "ends_with", ...unary];
}
export function tableFilterNeedsValue(operator: TableFilterOperator) { return !unary.includes(operator); }

export function tableFilterError(rule: TableFilter, kinds: ReadonlyMap<string, TableFieldKind>) {
  const kind = kinds.get(rule.field);
  if (!kind || !tableFilterOperators(kind).includes(rule.operator)) return "field";
  if (!tableFilterNeedsValue(rule.operator)) return null;
  if (!rule.value.length || (rule.operator === "between" && !rule.upper.length)) return "required";
  if (kind === "number") {
    const value = numericValue(rule.value);
    const upper = rule.operator === "between" ? numericValue(rule.upper) : value;
    if (!value || !upper) return "number";
    if (value.greaterThan(upper)) return "range";
  }
  if (kind === "boolean" && !["true", "false"].includes(rule.value)) return "required";
  return null;
}

/** Seed the existing editor, never a second predicate or a formatted display value. */
export function tableFilterFromValue(field: string, value: unknown, kinds: ReadonlyMap<string, TableFieldKind>): Omit<TableFilter, "id"> | null {
  if (!kinds.has(field)) return null;
  if (value != null && !["string", "number", "boolean"].includes(typeof value)) return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const text = dataCellText(value);
  // Do not truncate an identity to fit the editor or pretend JSON has scalar equality.
  if (text.length > 4096) return null;
  const seed: Omit<TableFilter, "id"> = { field, operator: value == null ? "is_missing" : value === "" ? "is_empty_text" : "equals", value: text, upper: "" };
  return tableFilterError({ ...seed, id: "" }, kinds) ? null : seed;
}

/** Compile once per applied change; decimal bounds never pass through Number. */
export function tableFilterMatcher(filters: TableFilters, kinds: ReadonlyMap<string, TableFieldKind>, locale: string) {
  // A malformed condition must not silently broaden a filtered export.
  if (filters.rules.some((rule) => tableFilterError(rule, kinds))) return () => false;
  const matchers = filters.rules.map((rule) => {
    const kind = kinds.get(rule.field)!;
    const bound = kind === "number" ? numericValue(rule.value) : null;
    const upper = kind === "number" ? numericValue(rule.upper) : null;
    const needle = rule.value.toLocaleLowerCase(locale);
    return (row: TabularRow) => {
      const value = dataCellValue(row, rule.field);
      if (rule.operator === "is_missing") return value == null;
      if (rule.operator === "is_empty_text") return value === "";
      if (rule.operator === "has_value") return value != null && value !== "";
      // Missing/structured cells are not matches for either positive or negated value comparisons.
      if (value == null || typeof value === "object") return false;
      if (kind === "number") {
        const actual = numericValue(value);
        if (!actual || !bound) return false;
        const compared = actual.comparedTo(bound);
        switch (rule.operator) {
          case "equals": return compared === 0;
          case "not_equals": return compared !== 0;
          case "gt": return compared > 0;
          case "gte": return compared >= 0;
          case "lt": return compared < 0;
          case "lte": return compared <= 0;
          case "between": return compared >= 0 && upper !== null && actual.lessThanOrEqualTo(upper);
        }
      }
      const exact = kind === "boolean" ? value === (rule.value === "true") : dataCellText(value) === rule.value;
      const text = dataCellText(value).toLocaleLowerCase(locale);
      switch (rule.operator) {
        case "equals": return exact;
        case "not_equals": return !exact;
        case "contains": return text.includes(needle);
        case "not_contains": return !text.includes(needle);
        case "starts_with": return text.startsWith(needle);
        case "ends_with": return text.endsWith(needle);
        default: return false;
      }
    };
  });
  return (row: TabularRow) => !matchers.length || (filters.mode === "all"
    ? matchers.every((match) => match(row)) : matchers.some((match) => match(row)));
}
