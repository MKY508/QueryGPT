import type { TabularRow } from "@/lib/tabular-data";

const MAX_SAMPLE_ROWS = 8;
const MAX_FIELDS = 500;
export type SourceFieldKind = "number" | "text" | "date" | "boolean" | "other";
export interface SourcePreviewField { name: string; kind: SourceFieldKind; missing: number | null }
export interface SourcePreview {
  rows: TabularRow[];
  fields: SourcePreviewField[];
  totalRows: number | null;
  limitedFields: boolean;
  limitedRows: boolean;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function fieldKind(value: unknown): SourceFieldKind {
  if (typeof value !== "string") return "other";
  const type = value.trim().toLowerCase();
  if (/^(u?int(8|16|32|64)?|float(16|32|64)?|double|bigint|smallint|tinyint|hugeint|real)(\[.*\])?$/.test(type) ||
      /^(decimal(128|256)?|numeric)(\(.*\))?$/.test(type)) return "number";
  if (/^(str|string|large_string|utf8|varchar|text)(\[.*\]|\(.*\))?$/.test(type)) return "text";
  if (/^(date(32|64)?|datetime64|timestamp|time(32|64)?)(\[.*\]|\(.*\))?$/.test(type)) return "date";
  if (/^bool(ean)?(\[.*\])?$/.test(type)) return "boolean";
  return "other";
}

/** One source-owned preparation snapshot. Never mix in another preflight report
 * or reconstruct records from per-column examples (which need not share a row). */
export function sourcePreview(profileValue: unknown): SourcePreview {
  const profile = record(profileValue);
  const schema = record(profile?.schema);
  const sample = Array.isArray(profile?.sample) ? profile.sample : [];
  const rows = sample.slice(0, MAX_SAMPLE_ROWS).flatMap((value) => {
    const row = record(value);
    return row ? [row] : [];
  });
  const declaredRows = count(schema?.rows);
  const totalRows = declaredRows !== null && declaredRows >= sample.length ? declaredRows : null;
  const declaredFields = Array.isArray(schema?.columns) ? schema.columns : [];
  let limitedFields = declaredFields.length > MAX_FIELDS;
  const fields = new Map<string, SourcePreviewField>();
  for (const value of declaredFields.slice(0, MAX_FIELDS)) {
    const field = record(value);
    if (!field || typeof field.name !== "string" || !field.name.trim() || fields.has(field.name)) continue;
    const missing = count(field.missing);
    fields.set(field.name, { name: field.name, kind: fieldKind(field.dtype),
      missing: missing !== null && (totalRows === null || missing <= totalRows) ? missing : null });
  }
  for (const row of rows) {
    for (const name of Object.keys(row)) {
      if (fields.has(name)) continue;
      if (fields.size >= MAX_FIELDS) { limitedFields = true; break; }
      fields.set(name, { name, kind: "other", missing: null });
    }
  }
  // Keep exact values and absent-field semantics, while bounding legacy wide samples.
  const boundedRows = rows.map((row) => Object.fromEntries([...fields.keys()]
    .filter((name) => Object.prototype.hasOwnProperty.call(row, name))
    .map((name) => [name, row[name]])));
  return { rows: boundedRows, fields: [...fields.values()], totalRows, limitedFields, limitedRows: sample.length > MAX_SAMPLE_ROWS };
}
