/** Scatter/Pie can wrap the original source row in another payload object. */
export function chartSourceValue(payload: unknown, field: string, fallback: unknown): unknown {
  if (!payload || typeof payload !== "object") return fallback;
  if (Object.prototype.hasOwnProperty.call(payload, field)) {
    return (payload as Record<string, unknown>)[field];
  }
  const nested = (payload as Record<string, unknown>).payload;
  if (nested && typeof nested === "object" && Object.prototype.hasOwnProperty.call(nested, field)) {
    return (nested as Record<string, unknown>)[field];
  }
  return fallback;
}
