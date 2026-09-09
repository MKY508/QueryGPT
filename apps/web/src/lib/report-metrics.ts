import type { ReportBlock } from "@/lib/reports";
import { isNumericCell } from "@/lib/numeric-values";

/** A scalar card selects one field; it never totals retained rows or infers units. */
export function metricResultColumns(block: ReportBlock): string[] {
  const rows = block.content.rows;
  const binding = block.source_ref?.refresh_binding;
  const hasSource = !!block.artifact_id
    || (!!binding && typeof binding === "object" && !Array.isArray(binding));
  if (block.source_kind !== "artifact" || !hasSource || !Array.isArray(rows)
    || rows.length !== 1 || block.content.rows_count !== 1 || block.content.sampled !== false
    || !rows[0] || typeof rows[0] !== "object" || Array.isArray(rows[0])) return [];
  const selected = block.config.metric_column;
  return Object.keys(rows[0]).filter((key) => isNumericCell(rows[0][key])
    || (key === selected && rows[0][key] === null));
}

export function metricColumnContent(block: ReportBlock, column: string): Record<string, unknown> {
  const rows = block.content.rows;
  const value = metricResultColumns(block).includes(column) && Array.isArray(rows) ? rows[0][column] : null;
  return {
    rows, rows_count: block.content.rows_count, sampled: block.content.sampled,
    columns: block.content.columns, value, context: "",
  };
}

export function hasMetricResultField(block: ReportBlock): boolean {
  return block.block_type === "metric" && block.source_kind === "artifact"
    && typeof block.config.metric_column === "string" && !!block.config.metric_column;
}
