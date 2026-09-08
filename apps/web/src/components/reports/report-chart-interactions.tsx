import { isCrossFilterValue } from "@/lib/report-interactions";
import { chartSourceValue } from "@/lib/chart-source-value";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Recharts passes a mark envelope, not its plotted numeric value. */
export function chartMarkSelection(mark: unknown, field: string) {
  const payload = isRecord(mark) && isRecord(mark.payload) ? mark.payload : mark;
  const value = chartSourceValue(payload, field, undefined);
  return isCrossFilterValue(value) ? value : undefined;
}

/** ActiveShape accepts unknown; share the same renderer with Line and Area dots. */
export function renderReportSelectionDot(mark: unknown, select: (mark: unknown) => void, color: string) {
  const point = isRecord(mark) ? mark : {};
  const key = typeof point.key === "string" || typeof point.key === "number" ? point.key : undefined;
  if (typeof point.cx !== "number" || !Number.isFinite(point.cx) ||
      typeof point.cy !== "number" || !Number.isFinite(point.cy)) return <g key={key} />;
  const fill = typeof point.stroke === "string" ? point.stroke : typeof point.fill === "string" ? point.fill : color;
  return <circle key={key} cx={point.cx} cy={point.cy} r={4} fill={fill} className="cursor-pointer"
    onClick={event => { event.stopPropagation(); select(mark); }} />;
}
