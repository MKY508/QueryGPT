import type { ReportBlock, ReportPage } from "./reports";
import { reportContentRows } from "./report-rows";
import {
  applyReportBlockUpdates, applyStaticReportFilters,
  type ActiveReportFilter, type ReportFilterOperator,
} from "@/components/reports/report-blocks";

export type CrossFilterValue = string | number | boolean | null;
export interface CrossFilterRule {
  field: string;
  targets: { key: string; field: string }[];
}
export interface ReportSelection {
  pageId: string;
  sourceKey: string;
  ruleKey: string;
  value: CrossFilterValue;
}
export interface ResolvedSelection extends ReportSelection {
  source: ReportBlock;
  rule: CrossFilterRule;
}
export interface ChartSelectionControl {
  field: string;
  values: CrossFilterValue[];
  selected?: ReportSelection;
  onSelect: (value: CrossFilterValue | undefined) => void;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function blockRows(block: ReportBlock) {
  return reportContentRows(block.content);
}

export function interactionFields(block: ReportBlock): string[] {
  if (block.block_type !== "chart" && block.block_type !== "table") return [];
  if (block.content.image_url) return [];
  return [...new Set((blockRows(block)?.rows || []).flatMap(Object.keys))];
}

export function isCrossFilterValue(value: unknown): value is CrossFilterValue {
  return value === null || typeof value === "boolean" ||
    (typeof value === "string" && value.length <= 4096) ||
    (typeof value === "number" && Number.isFinite(value));
}

export function selectionValueKey(value: CrossFilterValue): string {
  return JSON.stringify(value);
}

export function selectionValues(block: ReportBlock, field: string): CrossFilterValue[] {
  const values = new Map<string, CrossFilterValue>();
  for (const row of blockRows(block)?.rows || []) {
    if (!Object.prototype.hasOwnProperty.call(row, field) || !isCrossFilterValue(row[field])) continue;
    values.set(selectionValueKey(row[field]), row[field]);
  }
  return [...values.values()];
}

export function interactionKey(block: ReportBlock): string {
  const value = block.config.interaction_key;
  return typeof value === "string" && value.length <= 200 ? value : "";
}

function uniqueBlock(page: ReportPage, key: string): ReportBlock | undefined {
  if (!key) return undefined;
  const matches = page.blocks.filter((block) => interactionKey(block) === key);
  return matches.length === 1 ? matches[0] : undefined;
}

export function crossFilterRule(page: ReportPage, source: ReportBlock): CrossFilterRule | null {
  const raw = source.config.filter_action;
  if (source.block_type !== "chart" || !record(raw) || typeof raw.field !== "string" ||
    !interactionFields(source).includes(raw.field) || !Array.isArray(raw.targets)) return null;
  const targets = raw.targets.flatMap((item) => {
    if (!record(item) || typeof item.key !== "string" || typeof item.field !== "string") return [];
    const target = uniqueBlock(page, item.key);
    if (!target || target.id === source.id || !interactionFields(target).includes(item.field)) return [];
    return [{ key: item.key, field: item.field }];
  }).filter((item, index, list) => list.findIndex((other) => other.key === item.key) === index);
  return { field: raw.field, targets };
}

/** Designer action: stable local configuration keys survive server-assigned block IDs. */
export function configureCrossFilter(
  page: ReportPage, sourceId: string, field: string,
  targetId?: string, targetField?: string,
  newKey: () => string = () => crypto.randomUUID(),
): ReportPage {
  const source = page.blocks.find((block) => block.id === sourceId);
  if (!source || source.block_type !== "chart") return page;
  if (field && !interactionFields(source).includes(field)) return page;
  const config = { ...source.config };
  if (!field) {
    delete config.filter_action;
    return { ...page, blocks: page.blocks.map((block) => block === source
      ? applyReportBlockUpdates(block, { config }) : block) };
  }
  const rule = crossFilterRule(page, source);
  const targets = rule?.targets.filter((item) =>
    uniqueBlock(page, item.key)?.id !== targetId) || [];
  let changedTarget: ReportBlock | undefined;
  if (targetId && targetField) {
    const target = page.blocks.find((block) => block.id === targetId);
    if (!target || target === source || !interactionFields(target).includes(targetField)) return page;
    const key = uniqueBlock(page, interactionKey(target)) ? interactionKey(target) : newKey();
    changedTarget = { ...target, config: { ...target.config, interaction_key: key } };
    targets.push({ key, field: targetField });
  }
  config.interaction_key = uniqueBlock(page, interactionKey(source)) ? interactionKey(source) : newKey();
  config.filter_action = { field, targets };
  return { ...page, blocks: page.blocks.map((block) => block === source
    ? applyReportBlockUpdates(block, { config }) : changedTarget && block.id === changedTarget.id ? changedTarget : block) };
}

export function makeReportSelection(
  page: ReportPage, source: ReportBlock, value: CrossFilterValue,
): ReportSelection | null {
  const rule = crossFilterRule(page, source);
  const sourceKey = interactionKey(source);
  if (!rule?.targets.length || uniqueBlock(page, sourceKey) !== source ||
    !selectionValues(source, rule.field).some((item) => item === value)) return null;
  return { pageId: page.id, sourceKey, ruleKey: JSON.stringify(rule), value };
}

export function resolveSelections(page: ReportPage, selections: ReportSelection[]): ResolvedSelection[] {
  return selections.flatMap((selection) => {
    if (selection.pageId !== page.id) return [];
    const source = uniqueBlock(page, selection.sourceKey);
    if (!source) return [];
    const current = makeReportSelection(page, source, selection.value);
    const rule = crossFilterRule(page, source);
    return current?.ruleKey === selection.ruleKey && rule ? [{ ...selection, source, rule }] : [];
  });
}

const FILTER_OPERATORS = new Set<ReportFilterOperator>([
  "contains", "equals", "not_equals", "greater_than", "greater_or_equal", "less_than", "less_or_equal",
]);

export function pageReportFilters(page: ReportPage, values: Record<string, string>): ActiveReportFilter[] {
  return page.blocks.flatMap((block) => {
    // Explicit connections must never fall back to same-name page filtering.
    if (block.config.filter_scope === "report") return [];
    if (block.block_type !== "filter" || typeof block.config.field !== "string") return [];
    const field = block.config.field.trim();
    const value = values[block.id] || "";
    const raw = block.config.operator as ReportFilterOperator;
    return field && value.trim() ? [{ field, value, operator: FILTER_OPERATORS.has(raw) ? raw : "contains" }] : [];
  });
}

export function applyReportInteractions(
  block: ReportBlock, filters: ActiveReportFilter[], selections: ResolvedSelection[],
): ReportBlock {
  const filtered = applyStaticReportFilters(block, filters);
  const collection = blockRows(filtered);
  if (!collection || !interactionFields(block).length) return filtered;
  const predicates = selections.flatMap((selection) => selection.rule.targets
    .filter((target) => target.key === interactionKey(block))
    .map((target) => ({ field: target.field, value: selection.value })));
  if (!predicates.length) return filtered;
  const rows = collection.rows.filter((row) => predicates.every(({ field, value }) =>
    Object.prototype.hasOwnProperty.call(row, field) && row[field] === value));
  return { ...filtered, content: {
    ...filtered.content, [collection.key]: rows, _filter_applied: true,
    _filter_source_rows: filtered.content._filter_source_rows ?? collection.rows.length,
  } };
}
