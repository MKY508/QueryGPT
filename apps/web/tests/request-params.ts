/** Inspect Axios mock arguments without assuming an untyped payload's shape. */
export function requestParams(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Expected query parameter object");
  return Object.fromEntries<unknown>(Object.entries(value));
}
