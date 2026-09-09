import { compareNumericValues, numericSortColumn } from "./numeric-values";
import { tableTextMatcher } from "./table-text-search";

export type TabularRow = Record<string, unknown>;
export type TableSortRule = { column: string; direction: "asc" | "desc" };
export type TableSort = TableSortRule | null;
export type TableSorting = TableSort | readonly TableSortRule[];

export function tableSortRules(sort: TableSorting): TableSortRule[] {
  const rules = sort ? "column" in sort ? [sort] : sort : [];
  const seen = new Set<string>();
  return rules.filter((rule) => {
    if (seen.has(rule.column) || !["asc", "desc"].includes(rule.direction)) return false;
    seen.add(rule.column);
    return true;
  });
}

/** Plain header clicks replace the order; Shift cycles one level in place. */
export function cycleTableSort(rules: readonly TableSortRule[], column: string, append: boolean): TableSortRule[] {
  const current = rules.find((rule) => rule.column === column);
  const next: TableSortRule | null = current?.direction === "desc" ? null
    : { column, direction: current ? "desc" : "asc" };
  if (!append) return next ? [next] : [];
  if (!current) return [...rules, next!];
  return rules.flatMap((rule) => rule.column !== column ? [rule] : next ? [next] : []);
}

export function moveTableItem<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  const next = [...items];
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export { reportContentRows } from "./report-rows";

/** A later sparse row can introduce a field absent from the first row. */
export function dataColumns(rows: readonly TabularRow[]): string[] {
  return [...new Set(rows.flatMap(Object.keys))];
}

export function dataCellValue(row: TabularRow, field: string): unknown {
  return Object.prototype.hasOwnProperty.call(row, field) ? row[field] : undefined;
}

export function dataCellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  // Tabular payloads come from JSON; avoid the unhelpful [object Object] cell.
  try { return JSON.stringify(value) ?? ""; } catch { return String(value); }
}

/** Infer a numeric column from its complete population, never just a search subset. */
function tableComparator(rows: readonly TabularRow[], sort: NonNullable<TableSort>, locale: string) {
  const cell = (row: TabularRow) => dataCellValue(row, sort.column);
  const numeric = numericSortColumn(rows.map(cell));
  const collator = new Intl.Collator(locale, { usage: "sort", sensitivity: "base", numeric: false });
  return (left: TabularRow, right: TabularRow) => {
    const a = cell(left);
    const b = cell(right);
    const aEmpty = a === null || a === undefined || a === "";
    const bEmpty = b === null || b === undefined || b === "";
    if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
    const comparison = numeric ? compareNumericValues(a, b) ?? 0 : collator.compare(dataCellText(a), dataCellText(b));
    return sort.direction === "asc" ? comparison : -comparison;
  };
}

function tableOrderComparator(rows: readonly TabularRow[], rules: readonly TableSortRule[], locale: string) {
  const comparators = rules.map((rule) => tableComparator(rows, rule, locale));
  return (a: TabularRow, b: TabularRow) => {
    for (const compare of comparators) {
      const result = compare(a, b);
      if (result) return result;
    }
    return 0;
  };
}

export function sortTableRows<T extends TabularRow>(rows: readonly T[], sort: TableSorting, locale: string): readonly T[] {
  const rules = tableSortRules(sort);
  return rules.length ? [...rows].sort(tableOrderComparator(rows, rules, locale)) : rows;
}

function tableMatcher(columns: readonly string[], query: string, locale: string) {
  const matches = tableTextMatcher(query, locale);
  return (row: TabularRow) => !query.trim() || columns.some((column) => matches(dataCellText(dataCellValue(row, column))));
}

export function searchTableRows<T extends TabularRow>(rows: readonly T[], columns: readonly string[], query: string, locale: string): readonly T[] {
  return query.trim() ? rows.filter(tableMatcher(columns, query, locale)) : rows;
}

export interface TableRecord { index: number; row: TabularRow }

/** Filter an existing ordered model without sorting again or renumbering rows. */
export function filterTableRecords(records: readonly TableRecord[], columns: readonly string[], query: string, locale: string,
  accepts?: (row: TabularRow) => boolean): readonly TableRecord[] {
  if (!query.trim() && !accepts) return records;
  const matches = tableMatcher(columns, query, locale);
  return records.filter(({ row }) => matches(row) && (!accepts || accepts(row)));
}

/** Snapshot positions remain stable through sorting/filtering, including equal
 * rows and repeated object references. Never inject synthetic keys into data. */
export function tableViewRecords(rows: readonly TabularRow[], sort: TableSorting, columns: readonly string[], query: string, locale: string,
  accepts?: (row: TabularRow) => boolean): TableRecord[] {
  const matches = tableMatcher(columns, query, locale);
  const records = rows.flatMap((row, index) => matches(row) && (!accepts || accepts(row)) ? [{ row, index }] : []);
  const rules = tableSortRules(sort);
  if (rules.length) {
    const compare = tableOrderComparator(rows, rules, locale);
    records.sort((a, b) => compare(a.row, b.row) || a.index - b.index);
  }
  return records;
}
