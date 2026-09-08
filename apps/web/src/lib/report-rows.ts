/** Read retained rows without number conversion or a table-view dependency. */
export function reportContentRows(content: Record<string, unknown>) {
  for (const key of ["rows", "data", "items", "values"] as const) {
    const value = content[key];
    if (!Array.isArray(value)) continue;
    const rows = value.filter((row): row is Record<string, unknown> =>
      row !== null && typeof row === "object" && !Array.isArray(row));
    return { key, rows };
  }
  return null;
}
