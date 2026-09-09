/** Field identities are never trimmed, case-folded, or coerced into strings. */
export function isCleaningFieldName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function collectCleaningColumns(sample: unknown, schema: unknown): string[] {
  const columns = new Set<string>();
  if (Array.isArray(sample)) {
    for (const row of sample) {
      if (record(row)) Object.keys(row).filter(isCleaningFieldName).forEach(name => columns.add(name));
    }
  }
  if (record(schema) && Array.isArray(schema.columns)) {
    for (const column of schema.columns) {
      if (record(column) && isCleaningFieldName(column.name)) columns.add(column.name);
    }
  }
  return [...columns];
}

/** Saved source metadata wins over a potentially older report. Legacy sources
 * without their own schema can still use the original report-based directory. */
export function sourceCleaningColumns(profile: unknown, fallbackSchema?: unknown): string[] {
  if (!record(profile)) return [];
  return collectCleaningColumns(profile.sample,
    Object.prototype.hasOwnProperty.call(profile, "schema") ? profile.schema : fallbackSchema);
}

/** Display markers never become source values, field identities, or rules. */
export function cleaningWhitespace(text: string): string {
  return text.replace(/\r\n|[\s\u0085]/g, (character) => {
    if (character === " ") return "·";
    if (character === "\t") return "⇥";
    if (character === "\u00a0" || character === "\u202f") return "⍽";
    if (/^[\r\n\u0085\u2028\u2029]+$/.test(character)) return "↵\n";
    return "␣";
  });
}

export function cleaningColumnLabels(columns: readonly string[]): Map<string, string> {
  const names = [...new Set(columns)];
  const markWhitespace = names.some(name => name.trim() !== name || name.replace(/[\s\u0085]+/g, " ") !== name);
  return new Map(names.map((name, index) => [name, markWhitespace
    // Position distinguishes a real marker character from a displayed space.
    ? `${index + 1} · ${cleaningWhitespace(name).replace(/\n/g, "")}` : name]));
}
