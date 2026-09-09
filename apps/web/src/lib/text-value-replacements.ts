import type { TextValueReplacement } from "@/lib/types/api";

export const MAX_TEXT_REPLACEMENTS = 100;
export const MAX_RECIPE_TEXT_REPLACEMENTS = 1000;

export function isTextReplacementValue(value: unknown): value is string {
  return typeof value === "string" && value.length <= 2000 && !value.includes("\0")
    && (value.length <= 1000 || Array.from(value).length <= 1000);
}

export function sampleTextReplacementValues(suggestions: readonly unknown[]): string[] {
  return [...new Set(suggestions.slice(0, 8).filter(isTextReplacementValue))];
}

export function textReplacementGroup(existing: readonly TextValueReplacement[], selected: readonly string[], target: string, limit: number):
  { additions: TextValueReplacement[]; error: null } | { additions: []; error: "selection" | "invalid" | "conflict" | "same" | "limit" } {
  const originals = [...new Set(selected)];
  if (!Number.isSafeInteger(limit) || limit < 0) return { additions: [], error: "limit" };
  if (!originals.length) return { additions: [], error: "selection" };
  if (!isTextReplacementValue(target) || originals.some(value => !isTextReplacementValue(value))) return { additions: [], error: "invalid" };
  const used = new Set(existing.map(item => item.from_value));
  if (originals.some(value => used.has(value))) return { additions: [], error: "conflict" };
  const additions = originals.filter(value => value !== target).map(from_value => ({ from_value, to_value: target }));
  if (!additions.length) return { additions: [], error: "same" };
  if (existing.length + additions.length > Math.min(MAX_TEXT_REPLACEMENTS, limit)) return { additions: [], error: "limit" };
  return { additions, error: null };
}

export function textReplacementError(value: unknown): "invalid" | "limit" | "duplicate" | "same" | null {
  if (!Array.isArray(value) || !value.length) return "invalid";
  if (value.length > MAX_TEXT_REPLACEMENTS) return "limit";
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)
      || Object.keys(item).some((key) => key !== "from_value" && key !== "to_value")
      || typeof item.from_value !== "string" || typeof item.to_value !== "string") return "invalid";
    if (!isTextReplacementValue(item.from_value) || !isTextReplacementValue(item.to_value)) return "invalid";
    if (seen.has(item.from_value)) return "duplicate";
    if (item.from_value === item.to_value) return "same";
    seen.add(item.from_value);
  }
  return null;
}

export function copyTextReplacements(value: unknown): TextValueReplacement[] | null {
  if (textReplacementError(value)) return null;
  return (value as TextValueReplacement[]).map(({ from_value, to_value }) => ({ from_value, to_value }));
}
