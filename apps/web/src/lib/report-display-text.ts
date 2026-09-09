/** Shared prose projection for report cards and content navigation. */
export function cleanReportProse(value: string): string {
  return value.replace(/。{2,}/g, "。").replace(/！{2,}/g, "！").replace(/？{2,}/g, "？").replace(/\.{4,}/g, "…");
}

export function reportTextValue(content: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(content, key)) continue;
    const value = content[key];
    if (typeof value === "string" || typeof value === "number") return cleanReportProse(String(value));
  }
  return "";
}
