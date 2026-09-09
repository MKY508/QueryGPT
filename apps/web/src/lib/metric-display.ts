import type { ReportBlock } from "@/lib/reports";
import { formatExactNumber, numericValue } from "./numeric-values";

export const METRIC_STYLES = ["raw", "number", "currency", "percent"] as const;
export const METRIC_CURRENCIES = ["CNY", "USD", "EUR", "GBP", "JPY", "HKD"] as const;
export interface MetricDisplay {
  style: typeof METRIC_STYLES[number];
  decimals: number | null;
  currency: typeof METRIC_CURRENCIES[number];
  grouping: boolean;
  suffix: string;
}

export function metricDisplay(config: Record<string, unknown>): MetricDisplay {
  const candidate = config.metric_display;
  const raw = candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? candidate as Record<string, unknown> : {};
  return {
    style: METRIC_STYLES.includes(raw.style as MetricDisplay["style"]) ? raw.style as MetricDisplay["style"] : "raw",
    decimals: typeof raw.decimals === "number" && Number.isInteger(raw.decimals) && raw.decimals >= 0 && raw.decimals <= 8 ? raw.decimals : null,
    currency: METRIC_CURRENCIES.includes(raw.currency as MetricDisplay["currency"]) ? raw.currency as MetricDisplay["currency"] : "CNY",
    grouping: raw.grouping !== false,
    suffix: typeof raw.suffix === "string" ? Array.from(raw.suffix).slice(0, 32).join("") : "",
  };
}

export function metricValue(content: Record<string, unknown>): string | number | null {
  for (const key of ["value", "metric", "amount", "result"]) {
    // An explicitly absent current value must not resurrect an older alias.
    if (Object.prototype.hasOwnProperty.call(content, key)) {
      const value = content[key];
      if (value === null) return null;
      if (typeof value === "number" || typeof value === "string") return value;
    }
  }
  return null;
}

export function metricDisplayText(block: Pick<ReportBlock, "content" | "config">, locale: string): string {
  const value = metricValue(block.content);
  if (value === null || value === "") return "—";
  const display = metricDisplay(block.config);
  const exact = numericValue(value);
  // Already-authored values ("128万元", "12%") are not parsed into another unit.
  if (!exact) return typeof value === "number" ? "—" : value;
  let text = String(value);
  if (display.style !== "raw") {
    const defaults = display.style === "currency" ? (display.currency === "JPY" ? 0 : 2)
      : display.style === "percent" ? 1 : Math.min(100, exact.decimalPlaces());
    const options: Intl.NumberFormatOptions = {
      useGrouping: display.grouping,
      maximumFractionDigits: display.decimals ?? defaults,
      minimumFractionDigits: display.decimals ?? (display.style === "currency" ? defaults : 0),
      style: display.style === "number" ? "decimal" : display.style,
      ...(display.style === "currency" ? { currency: display.currency } : {}),
    };
    // Intl supports at most 100 fraction digits: retain finer values by default.
    if (!(display.style === "number" && display.decimals === null && exact.decimalPlaces() > 100)) {
      text = formatExactNumber(value, options, locale);
    }
  }
  return display.suffix.trim() ? `${text} ${display.suffix.trim()}` : text;
}
