import Decimal from "decimal.js";
import type { ChartValueFormat } from "@/lib/charts";

// Keep configuration isolated from Recharts and other Decimal consumers.
const ExactDecimal = Decimal.clone({ precision: 256, rounding: Decimal.ROUND_HALF_EVEN });
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const CANONICAL_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const formatters = new Map<string, Intl.NumberFormat>();

export function numericValue(value: unknown): Decimal | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const text = String(value).trim();
  if (!text || text.length > 256 || !DECIMAL.test(text)) return null;
  const exponent = text.match(/[eE]([+-]?\d+)$/)?.[1];
  if (exponent && Math.abs(Number(exponent)) > 1000) return null;
  try {
    const result = new ExactDecimal(text);
    return result.isFinite() && Math.abs(result.e) <= 1000 ? result : null;
  } catch {
    return null;
  }
}

export function isNumericCell(value: unknown): boolean {
  // Automatic column discovery must not turn padded codes/empty cells into measures.
  return (
    (typeof value !== "string" || (value.length <= 256 && CANONICAL_DECIMAL.test(value))) &&
    numericValue(value) !== null
  );
}

export function compareNumericValues(left: unknown, right: unknown): number | null {
  const a = numericValue(left);
  const b = numericValue(right);
  return a && b ? a.comparedTo(b) : null;
}

export function numericSortColumn(values: unknown[]): boolean {
  const present = values.filter((value) => value !== null && value !== undefined && value !== "");
  return present.length > 0 && present.every(isNumericCell);
}

/** Approximate geometry only: never write the result back to chart/report data. */
export function chartNumber(value: unknown): number | null {
  const exact = numericValue(value);
  if (!exact) return null;
  const number = exact.toNumber();
  return Number.isFinite(number) && (number !== 0 || exact.isZero()) ? number : null;
}

export function chartNumberKey(field: string) {
  return Object.assign((row: Record<string, unknown>) => chartNumber(row[field]), { field });
}

export function chartField(key: unknown): string {
  if (typeof key === "string") return key;
  return typeof key === "function" && "field" in key && typeof key.field === "string"
    ? key.field : "";
}

export { chartSourceValue } from "./chart-source-value";

type ExactFormatter = (value: number | string | bigint) => string;
const supportsExactIntl =
  (new Intl.NumberFormat("en", { useGrouping: false }).format as ExactFormatter)("9007199254740993") ===
  "9007199254740993";

export function formatNumericValue(
  value: unknown,
  format: ChartValueFormat = "auto",
  locale = "en",
  defaultFractionDigits = 4,
): string {
  if (value === null || value === undefined) return "—";
  const exact = numericValue(value);
  if (!exact) return String(value);
  let options: Intl.NumberFormatOptions;
  switch (format) {
    case "integer": options = { maximumFractionDigits: 0 }; break;
    case "compact": options = { notation: "compact", maximumFractionDigits: 1 }; break;
    case "currency": options = { style: "currency", currency: "CNY", maximumFractionDigits: 2 }; break;
    case "percent": options = { style: "percent", maximumFractionDigits: 1 }; break;
    default:
      options = {
        maximumFractionDigits: format === "number" ? 2
          : typeof value === "string" ? Math.min(100, exact.decimalPlaces()) : defaultFractionDigits,
      };
  }
  // Current Intl accepts decimal strings without an intermediate Number. Older
  // browsers fall back to the original text instead of silently rounding it.
  if (typeof value === "string" && !supportsExactIntl) return value;
  if (format === "auto" && exact.decimalPlaces() > 100) return String(value);
  return formatExactNumber(value, options, locale);
}

/** Shared display boundary. It never writes rounded output back to source data. */
export function formatExactNumber(value: unknown, options: Intl.NumberFormatOptions, locale = "en"): string {
  if (value === null || value === undefined) return "—";
  const exact = numericValue(value);
  if (!exact) return String(value);
  if (typeof value === "string") {
    // Intl's exact-string path still over/underflows outside its supported
    // magnitude range. This Number is a range probe only, never the display input.
    const magnitude = exact.toNumber();
    if (!supportsExactIntl || !Number.isFinite(magnitude) || (magnitude === 0 && !exact.isZero())) return value;
  }
  const key = JSON.stringify([locale, options]);
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    // Formatting an accessible chart table should reuse, not allocate per cell.
    if (formatters.size >= 128) formatters.delete(formatters.keys().next().value!);
    formatters.set(key, formatter);
  }
  return (formatter.format as ExactFormatter)(typeof value === "number" ? value : exact.toString());
}
