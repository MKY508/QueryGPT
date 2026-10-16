import { chartNumber, isNumericCell } from "@/lib/numeric-values";

export const CHART_TYPES = [
  "bar",
  "horizontal_bar",
  "line",
  "area",
  "pie",
  "scatter",
] as const;

export type ChartType = (typeof CHART_TYPES)[number];
export type ChartFieldKind = "category" | "number" | "temporal";
export type ChartAggregation =
  | "sum"
  | "avg"
  | "count"
  | "count_distinct"
  | "min"
  | "max";
export type ChartValueFormat =
  | "auto"
  | "number"
  | "integer"
  | "compact"
  | "currency"
  | "percent";
export type ChartOrientation = "vertical" | "horizontal";
export type ChartStack = "none" | "normal" | "percent";

export const RECEIPTBI_CHART_PALETTES = {
  receiptbi: [
    "#397660",
    "#8ba99b",
    "#d68a2e",
    "#39749b",
    "#9a6048",
    "#6f7f8f",
    "#6e9f85",
    "#c7a45b",
  ],
  "receiptbi-muted": [
    "#5f8379",
    "#82968f",
    "#aa9675",
    "#728b9b",
    "#9a7d70",
    "#87929b",
    "#91a79d",
    "#b5a784",
  ],
  categorical: [
    "#16836b",
    "#39749b",
    "#d68a2e",
    "#7b61a8",
    "#b45454",
    "#4f8f9d",
    "#8a9b4e",
    "#9a6048",
  ],
  monochrome: [
    "#0f4b3f",
    "#166451",
    "#16836b",
    "#3a9a83",
    "#68ae9b",
    "#91c3b5",
    "#b6d7cd",
    "#d8e8e3",
  ],
} as const;

export type ChartPaletteId = keyof typeof RECEIPTBI_CHART_PALETTES;

export const CHART_PALETTE_OPTIONS: ReadonlyArray<{
  value: ChartPaletteId;
  labelKey:
    | "paletteReceiptBI"
    | "paletteMuted"
    | "paletteCategorical"
    | "paletteMonochrome";
}> = [
  { value: "receiptbi", labelKey: "paletteReceiptBI" },
  { value: "receiptbi-muted", labelKey: "paletteMuted" },
  { value: "categorical", labelKey: "paletteCategorical" },
  { value: "monochrome", labelKey: "paletteMonochrome" },
];

export type ChartDataPoint = Record<string, unknown>;

export interface ChartDataRef {
  result_name: string;
  result_hash: string;
}

export interface ChartXEncoding {
  field: string;
  label?: string;
  kind?: ChartFieldKind;
}

export interface ChartYEncoding extends ChartXEncoding {
  aggregate?: ChartAggregation;
  format?: ChartValueFormat;
}

export interface ChartEncoding {
  x?: ChartXEncoding;
  y: ChartYEncoding[];
}

export interface ChartPresentation {
  orientation: ChartOrientation;
  stack: ChartStack;
  palette: ChartPaletteId;
}

/**
 * Library-independent, persisted chart contract. Data is injected by ReceiptBI
 * after validating the named result; callers must never treat model-authored
 * renderer options or colors as trusted input.
 */
export interface ChartSpec {
  version: 1;
  type: ChartType;
  title?: string;
  data_ref?: ChartDataRef;
  encoding: ChartEncoding;
  presentation: ChartPresentation;
  data: ChartDataPoint[];
}

/** Historical chat payload kept only for reading previously saved reports. */
export interface LegacyVisualization {
  type?: ChartType;
  title?: string;
  data?: ChartDataPoint[];
  xKey?: string;
  yKey?: string;
  yKeys?: string[];
  result_name?: string;
  result_hash?: string;
  orientation?: ChartOrientation;
  stack?: boolean | ChartStack;
  palette?: unknown;
  colors?: unknown;
}

const FIELD_KINDS = new Set<ChartFieldKind>([
  "category",
  "number",
  "temporal",
]);
const AGGREGATIONS = new Set<ChartAggregation>([
  "sum",
  "avg",
  "count",
  "count_distinct",
  "min",
  "max",
]);
const VALUE_FORMATS = new Set<ChartValueFormat>([
  "auto",
  "number",
  "integer",
  "compact",
  "currency",
  "percent",
]);
const PALETTE_IDS = new Set<ChartPaletteId>(
  Object.keys(RECEIPTBI_CHART_PALETTES) as ChartPaletteId[],
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isChartType(value: unknown): value is ChartType {
  return CHART_TYPES.includes(value as ChartType);
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text || undefined;
}

function normalizeRows(value: unknown): ChartDataPoint[] | null {
  if (!Array.isArray(value)) return null;
  const rows: ChartDataPoint[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const row: ChartDataPoint = {};
    for (const [key, cell] of Object.entries(item)) {
      if (
        cell !== null &&
        typeof cell !== "string" &&
        typeof cell !== "number" &&
        typeof cell !== "boolean"
      ) {
        return null;
      }
      row[key] = cell;
    }
    rows.push(row);
  }
  return rows;
}

function hasField(rows: ChartDataPoint[], field: string): boolean {
  return rows.some((row) => Object.prototype.hasOwnProperty.call(row, field));
}

function hasNumericValue(rows: ChartDataPoint[], field: string): boolean {
  return rows.some((row) => {
    const value = row[field];
    return isNumericCell(value) && chartNumber(value) !== null;
  });
}

function normalizeXEncoding(
  value: unknown,
  rows: ChartDataPoint[],
): ChartXEncoding | undefined {
  if (!isRecord(value)) return undefined;
  const field = cleanText(value.field);
  if (!field || !hasField(rows, field)) return undefined;
  const label = cleanText(value.label);
  const kind = FIELD_KINDS.has(value.kind as ChartFieldKind)
    ? (value.kind as ChartFieldKind)
    : undefined;
  return { field, ...(label ? { label } : {}), ...(kind ? { kind } : {}) };
}

function normalizeYEncoding(
  value: unknown,
  rows: ChartDataPoint[],
): ChartYEncoding | null {
  const base = normalizeXEncoding(value, rows);
  if (!base || !hasNumericValue(rows, base.field) || !isRecord(value)) {
    return null;
  }
  const aggregate = AGGREGATIONS.has(value.aggregate as ChartAggregation)
    ? (value.aggregate as ChartAggregation)
    : undefined;
  const format = VALUE_FORMATS.has(value.format as ChartValueFormat)
    ? (value.format as ChartValueFormat)
    : undefined;
  return {
    ...base,
    ...(aggregate ? { aggregate } : {}),
    ...(format ? { format } : {}),
  };
}

function normalizePresentation(
  value: unknown,
  type: ChartType,
  seriesCount: number,
): ChartPresentation {
  const input = isRecord(value) ? value : {};
  const supportsOrientation = type === "bar" || type === "horizontal_bar";
  const orientation: ChartOrientation =
    type === "horizontal_bar" ||
    (type === "bar" && input.orientation === "horizontal")
      ? "horizontal"
      : "vertical";
  const supportsStack =
    (supportsOrientation || type === "area") && seriesCount >= 2;
  const stack: ChartStack = supportsStack
    ? input.stack === true
      ? "normal"
      : input.stack === "normal" || input.stack === "percent"
        ? input.stack
        : "none"
    : "none";
  const palette = PALETTE_IDS.has(input.palette as ChartPaletteId)
    ? (input.palette as ChartPaletteId)
    : "receiptbi";
  return { orientation, stack, palette };
}

function normalizeDataRef(value: unknown): ChartDataRef | undefined {
  if (!isRecord(value)) return undefined;
  const resultName = cleanText(value.result_name);
  const resultHash = cleanText(value.result_hash);
  if (!resultName || !resultHash) return undefined;
  return { result_name: resultName, result_hash: resultHash };
}

function safeLegacyX(rows: ChartDataPoint[], requested?: string): string | null {
  if (requested && hasField(rows, requested)) return requested;
  if (hasField(rows, "name")) return "name";
  const columns = Object.keys(rows[0] || {});
  return (
    columns.find((field) =>
      rows.some((row) => {
        const value = row[field];
        return typeof value === "string" || typeof value === "boolean";
      }),
    ) ||
    columns[0] ||
    null
  );
}

function safeLegacyY(
  rows: ChartDataPoint[],
  requested: string[],
  xField: string,
): string[] {
  const selected = requested.filter(
    (field, index) =>
      requested.indexOf(field) === index &&
      field !== xField &&
      hasNumericValue(rows, field),
  );
  if (selected.length > 0) return selected;
  if (xField !== "value" && hasNumericValue(rows, "value")) return ["value"];
  return Object.keys(rows[0] || {}).filter(
    (field) => field !== xField && hasNumericValue(rows, field),
  );
}

/**
 * Converts the current v1 contract and historical chat payloads into one safe
 * shape. V1 bindings are never guessed: malformed explicit encodings are
 * rejected. Field inference exists only for historical payloads that had no
 * encoding contract.
 */
export function normalizeChartSpec(value: unknown): ChartSpec | null {
  if (!isRecord(value) || !isChartType(value.type)) return null;
  const rows = normalizeRows(value.data);
  if (!rows || rows.length === 0) return null;

  if (value.version === 1) {
    if (!isRecord(value.encoding) || !Array.isArray(value.encoding.y)) {
      return null;
    }
    const x = normalizeXEncoding(value.encoding.x, rows);
    // Every currently supported visual chart needs a declared dimension. Do
    // not silently change a v1 chart by guessing one from its result rows.
    if (!x) return null;
    const y = value.encoding.y
      .map((item) => normalizeYEncoding(item, rows))
      .filter((item): item is ChartYEncoding => Boolean(item));
    if (y.length === 0 || y.length !== value.encoding.y.length) return null;
    const renderedY =
      value.type === "pie" || value.type === "scatter" ? y.slice(0, 1) : y;
    const title = cleanText(value.title);
    const dataRef = normalizeDataRef(value.data_ref);
    return {
      version: 1,
      type: value.type,
      ...(title ? { title } : {}),
      ...(dataRef ? { data_ref: dataRef } : {}),
      encoding: { x, y: renderedY },
      presentation: normalizePresentation(
        value.presentation,
        value.type,
        renderedY.length,
      ),
      data: rows,
    };
  }

  const legacy = value as LegacyVisualization;
  const xField = safeLegacyX(rows, cleanText(legacy.xKey));
  if (!xField) return null;
  const requestedY = [
    ...(Array.isArray(legacy.yKeys)
      ? legacy.yKeys.filter((item): item is string => typeof item === "string")
      : []),
    ...(cleanText(legacy.yKey) ? [cleanText(legacy.yKey) as string] : []),
  ];
  const yFields = safeLegacyY(rows, requestedY, xField);
  if (yFields.length === 0) return null;
  const renderedYFields =
    legacy.type === "pie" || legacy.type === "scatter"
      ? yFields.slice(0, 1)
      : yFields;
  const title = cleanText(legacy.title);
  const resultName = cleanText(legacy.result_name);
  const resultHash = cleanText(legacy.result_hash);
  return {
    version: 1,
    type: legacy.type as ChartType,
    ...(title ? { title } : {}),
    ...(resultName && resultHash
      ? { data_ref: { result_name: resultName, result_hash: resultHash } }
      : {}),
    encoding: {
      x: { field: xField },
      y: renderedYFields.map((field) => ({ field, format: "auto" })),
    },
    presentation: normalizePresentation(
      legacy,
      legacy.type as ChartType,
      renderedYFields.length,
    ),
    data: rows,
  };
}

export function getChartPalette(
  palette: ChartPaletteId,
): readonly string[] {
  return RECEIPTBI_CHART_PALETTES[palette];
}
