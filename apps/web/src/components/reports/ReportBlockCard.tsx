"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Legend,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  getChartPalette,
  type ChartPaletteId,
  type ChartStack,
  type ChartValueFormat,
} from "@/lib/charts";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Copy,
  MoreHorizontal,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { ReportBlock } from "@/lib/reports";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "next-intl";

import type { ChartSelectionControl } from "@/lib/report-interactions";
import { chartMarkSelection, renderReportSelectionDot } from "./report-chart-interactions";
import { ReportSelectionControl } from "./ReportSelectionControl";
import { ReportFilterControl } from "./ReportFilterControl";

interface ReportBlockCardProps {
  block: ReportBlock;
  editing: boolean;
  selected: boolean;
  staticRendering?: boolean;
  onSelect: () => void;
  onMove: (direction: -1 | 1) => void;
  onResize: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRefresh?: () => void;
  refreshDisabled?: boolean;
  refreshing?: boolean;
  filterValue?: string;
  filterConnectedCount?: number;
  interaction?: ChartSelectionControl;
  onFilterValueChange?: (value: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanReportProse(value: string): string {
  return value
    .replace(/。{2,}/g, "。")
    .replace(/！{2,}/g, "！")
    .replace(/？{2,}/g, "？")
    .replace(/\.{4,}/g, "…");
}

function isPngChart(block: ReportBlock): boolean {
  if (block.block_type !== "chart") return false;
  const snapshot = isRecord(block.source_ref?.snapshot)
    ? block.source_ref.snapshot
    : undefined;
  const payload = isRecord(snapshot?.payload) ? snapshot.payload : undefined;
  const formats = [
    payload?.format,
    payload?.media_type,
    payload?.mime_type,
    snapshot?.media_type,
    snapshot?.mime_type,
    block.content.format,
    block.content.media_type,
    block.content.mime_type,
  ];
  return (
    formats.some((value) => {
      if (typeof value !== "string") return false;
      const normalized = value.trim().toLowerCase();
      return normalized === "png" || normalized === "image/png";
    }) || typeof block.content.image_url === "string"
  );
}

function supportsRefresh(block: ReportBlock): boolean {
  const hasSavedRefreshBinding = isRecord(block.source_ref?.refresh_binding);
  return (
    !block.id.startsWith("local-") &&
    typeof block.version === "number" &&
    block.source_kind === "artifact" &&
    (block.source_available === true || hasSavedRefreshBinding) &&
    (block.block_type === "table" ||
      (block.block_type === "chart" && !isPngChart(block)))
  );
}

function textValue(content: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = content[key];
    if (typeof value === "string" || typeof value === "number") {
      return cleanReportProse(String(value));
    }
  }
  return "";
}

function rowsFromContent(content: Record<string, unknown>): Record<string, unknown>[] {
  const candidates = [content.rows, content.data, content.items, content.values];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(isRecord);
    }
  }
  return [];
}

function chartKeys(
  rows: Record<string, unknown>[],
  config: Record<string, unknown>
): { x: string; ys: string[] } | null {
  const first = rows[0];
  if (!first) return null;
  const keys = Object.keys(first);
  const isNumericField = (key: string) =>
    keys.includes(key) && rows.some((row) => typeof row[key] === "number");
  const configuredX = typeof config.x_key === "string" ? config.x_key : "";
  const configuredY = typeof config.y_key === "string" ? config.y_key : "";
  const configuredYs = Array.isArray(config.y_keys)
    ? config.y_keys.filter(
        (key): key is string => typeof key === "string" && isNumericField(key)
      )
    : [];
  const x = configuredX && keys.includes(configuredX) ? configuredX : keys[0];
  const fallbackY =
    configuredY && isNumericField(configuredY)
      ? configuredY
      : keys.find((key) => typeof first[key] === "number" && key !== x) || keys[1];
  const ys = configuredYs.length ? configuredYs : fallbackY ? [fallbackY] : [];
  return x && ys.length ? { x, ys } : null;
}

const CHART_VALUE_FORMATS = new Set<ChartValueFormat>([
  "auto",
  "number",
  "integer",
  "compact",
  "currency",
  "percent",
]);

function chartValueFormat(value: unknown): ChartValueFormat {
  return CHART_VALUE_FORMATS.has(value as ChartValueFormat)
    ? (value as ChartValueFormat)
    : "auto";
}

function chartPalette(value: unknown): ChartPaletteId {
  return ["receiptbi", "receiptbi-muted", "categorical", "monochrome"].includes(
    value as ChartPaletteId
  )
    ? (value as ChartPaletteId)
    : "receiptbi";
}

function chartStack(value: unknown): ChartStack {
  return value === "normal" || value === "percent" ? value : "none";
}

function chartSeriesLabels(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, label]) => {
      if (typeof label !== "string") return [];
      const cleanLabel = label.trim().slice(0, 80);
      return cleanLabel ? [[key, cleanLabel] as const] : [];
    })
  );
}

function chartSeriesFormats(value: unknown): Record<string, ChartValueFormat> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, format]) =>
      CHART_VALUE_FORMATS.has(format as ChartValueFormat)
        ? [[key, format as ChartValueFormat] as const]
        : []
    )
  );
}

function formatChartValue(
  value: unknown,
  format: ChartValueFormat,
  locale: string
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value ?? "—");
  if (format === "integer") {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
  }
  if (format === "compact") {
    return new Intl.NumberFormat(locale, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  }
  if (format === "currency") {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "CNY",
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (format === "percent") {
    return new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(value);
  }
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

function EmptyBlock({ message }: { message: string }) {
  return (
    <div className="flex min-h-24 items-center justify-center border border-dashed border-border bg-muted/20 px-5 text-center text-xs leading-5 text-muted-foreground">
      {message}
    </div>
  );
}

function KpiBlock({ block, compact = false }: { block: ReportBlock; compact?: boolean }) {
  const value = textValue(block.content, ["value", "metric", "amount", "result"]);
  const context = textValue(block.content, ["context", "note", "summary", "description"]);
  const change = textValue(block.content, ["change", "delta", "comparison"]);
  const compactValueSize =
    value.length > 14
      ? "text-[1.2rem]"
      : value.length > 10
        ? "text-[1.4rem]"
        : "text-[1.7rem]";
  return (
    <div className={cn("flex flex-col justify-end", compact ? "min-h-0" : "min-h-16")}>
      <div className={cn(
        "min-w-0 whitespace-nowrap font-mono font-semibold leading-none tracking-[-0.045em] text-foreground tabular-nums",
        compact ? compactValueSize : "text-[clamp(1.65rem,3cqi,2.6rem)]"
      )}>
        {value || "—"}
      </div>
      {(change || context) && (
        <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground", compact ? "mt-1.5" : "mt-2.5")}>
          {change && <span className="font-medium text-primary">{change}</span>}
          {context && <span>{context}</span>}
        </div>
      )}
    </div>
  );
}

function ChartBlock({
  block,
  editing = false,
  staticRendering = false,
  interaction,
}: {
  block: ReportBlock;
  editing?: boolean;
  staticRendering?: boolean;
  interaction?: ChartSelectionControl;
}) {
  const locale = useLocale();
  const t = useTranslations("reportBlocks");
  const imageUrl = typeof block.content.image_url === "string" ? block.content.image_url : "";
  if (imageUrl) {
    return (
      <div className={cn(
        "relative w-full overflow-hidden bg-muted/15",
        editing ? "h-full min-h-0" : "h-[260px] min-h-44 print:h-[190px]"
      )}>
        <Image
          src={imageUrl}
          alt={block.title}
          fill
          unoptimized
          sizes="(max-width: 1280px) 100vw, 60vw"
          className="object-contain"
        />
      </div>
    );
  }
  const rows = rowsFromContent(block.content);
  const keys = chartKeys(rows, block.config);
  if (!rows.length || !keys) {
    return (
      <EmptyBlock
        message={
          block.content._filter_applied === true
            ? t("noFilteredData")
            : t("chooseData")
        }
      />
    );
  }
  const chartType = typeof block.config.chart_type === "string" ? block.config.chart_type : "bar";
  const supportedTypes = new Set(["bar", "horizontal_bar", "line", "area", "pie", "scatter"]);
  if (!supportedTypes.has(chartType)) {
    return <EmptyBlock message={t("unsupportedChart")} />;
  }
  const numericKeys = Object.keys(rows[0]).filter((key) =>
    rows.some((row) => typeof row[key] === "number")
  );
  if (chartType === "scatter" && numericKeys.length < 2) {
    return <EmptyBlock message={t("scatterNeedsNumeric")} />;
  }
  const scatterXKey =
    typeof block.config.x_key === "string" && numericKeys.includes(block.config.x_key)
      ? block.config.x_key
      : numericKeys[0];
  const scatterYKey =
    typeof block.config.y_key === "string" && numericKeys.includes(block.config.y_key)
      ? block.config.y_key
      : numericKeys.find((key) => key !== scatterXKey) || numericKeys[1];
  const orientation =
    block.config.orientation === "horizontal" || block.config.orientation === "vertical"
      ? block.config.orientation
      : chartType === "horizontal_bar"
        ? "horizontal"
        : "vertical";
  const stack =
    chartType === "bar" || chartType === "horizontal_bar" || chartType === "area"
      ? chartStack(block.config.stack)
      : "none";
  const stackId = stack === "none" || keys.ys.length < 2 ? undefined : "report-series";
  const numberFormat = chartValueFormat(block.config.number_format);
  const seriesLabels = chartSeriesLabels(block.config.series_labels);
  const seriesFormats = chartSeriesFormats(block.config.series_formats);
  const resolvedSeriesFormats = keys.ys.map(
    (key) => seriesFormats[key] || numberFormat
  );
  const sharedSeriesFormat = resolvedSeriesFormats.every(
    (format) => format === resolvedSeriesFormats[0]
  )
    ? resolvedSeriesFormats[0]
    : numberFormat;
  const axisNumberFormat =
    stack === "percent" && stackId ? "percent" : sharedSeriesFormat;
  const showLabels = block.config.show_labels === true;
  const colors = getChartPalette(chartPalette(block.config.palette));
  const isHorizontalBar =
    (chartType === "bar" || chartType === "horizontal_bar") && orientation === "horizontal";
  const seriesLabel = (key: string) => seriesLabels[key] || key;
  const seriesFormat = (key: string) => seriesFormats[key] || numberFormat;
  const formatSeriesValue = (key: string, value: unknown) =>
    formatChartValue(value, seriesFormat(key), locale);
  const seriesKeyFromName = (name: unknown) => {
    const candidate = String(name ?? "");
    return keys.ys.find(
      (key) => key === candidate || seriesLabel(key) === candidate
    );
  };
  const tooltipFormatter = (value: unknown, name: unknown) => {
    const key = seriesKeyFromName(name);
    return [
      key
        ? formatSeriesValue(key, value)
        : formatChartValue(value, numberFormat, locale),
      key ? seriesLabel(key) : String(name ?? ""),
    ];
  };
  const selectMark = interaction && !editing && !staticRendering ? (mark: unknown) => {
    const value = chartMarkSelection(mark, interaction.field);
    if (value !== undefined) interaction.onSelect(value);
  } : undefined;
  const selectionDot = selectMark ? (mark: unknown) => renderReportSelectionDot(mark, selectMark, colors[0]) : undefined;
  const common = (
    <>
      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
      <XAxis dataKey={keys.x} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
      <YAxis
        tick={{ fontSize: 10 }}
        tickLine={false}
        axisLine={false}
        width={52}
        tickFormatter={(value) => formatChartValue(value, axisNumberFormat, locale)}
      />
      <Tooltip
        formatter={tooltipFormatter}
        contentStyle={{
          border: "1px solid hsl(var(--border))",
          background: "hsl(var(--popover))",
          color: "hsl(var(--popover-foreground))",
          borderRadius: 4,
          fontSize: 12,
        }}
      />
      {keys.ys.length > 1 && <Legend wrapperStyle={{ fontSize: 10 }} />}
    </>
  );

  return (
    <div
      className={cn(
        "w-full",
        editing ? "h-full min-h-0" : "h-[260px] min-h-44 print:h-[190px]"
      )}
      aria-label={t("chartAria", { title: block.title })}
    >
      <ResponsiveContainer width="100%" height="100%">
        {chartType === "line" ? (
          <LineChart data={rows} margin={{ top: showLabels ? 24 : 12, right: 10, bottom: 0, left: 0 }}>
            {common}
            {keys.ys.map((key, index) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={seriesLabel(key)}
                isAnimationActive={!staticRendering}
                stroke={colors[index % colors.length]}
                strokeWidth={2}
                dot={selectionDot ?? { r: 2, fill: colors[index % colors.length] }}
                activeDot={selectionDot}
              >
                {showLabels && (
                  <LabelList
                    dataKey={key}
                    position="top"
                    formatter={(value: unknown) => formatSeriesValue(key, value)}
                  />
                )}
              </Line>
            ))}
          </LineChart>
        ) : chartType === "area" ? (
          <AreaChart
            data={rows}
            stackOffset={stack === "percent" && stackId ? "expand" : "none"}
            margin={{ top: showLabels ? 24 : 12, right: 10, bottom: 0, left: 0 }}
          >
            {common}
            {keys.ys.map((key, index) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                name={seriesLabel(key)}
                isAnimationActive={!staticRendering}
                stroke={colors[index % colors.length]}
                fill={colors[index % colors.length]}
                fillOpacity={0.14}
                strokeWidth={2}
                stackId={stackId}
                dot={selectionDot ?? false}
                activeDot={selectionDot}
              >
                {showLabels && (
                  <LabelList
                    dataKey={key}
                    position="top"
                    formatter={(value: unknown) => formatSeriesValue(key, value)}
                  />
                )}
              </Area>
            ))}
          </AreaChart>
        ) : chartType === "pie" ? (
          <PieChart>
            <Tooltip
              formatter={(value) => [
                formatSeriesValue(keys.ys[0], value),
                seriesLabel(keys.ys[0]),
              ]}
            />
            <Pie
              data={rows}
              dataKey={keys.ys[0]}
              name={seriesLabel(keys.ys[0])}
              nameKey={keys.x}
              isAnimationActive={!staticRendering}
              innerRadius="46%"
              outerRadius="78%"
              paddingAngle={1}
              onClick={selectMark}
              className={selectMark ? "cursor-pointer" : undefined}
              label={
                showLabels
                  ? ({ name, value }) =>
                      `${String(name ?? "")}: ${formatSeriesValue(keys.ys[0], value)}`
                  : false
              }
            >
              {rows.map((_, index) => (
                <Cell key={index} fill={colors[index % colors.length]} />
              ))}
            </Pie>
          </PieChart>
        ) : chartType === "scatter" ? (
          <ScatterChart margin={{ top: 12, right: 10, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" />
            <XAxis
              dataKey={scatterXKey}
              name={scatterXKey}
              type="number"
              tick={{ fontSize: 10 }}
              tickLine={false}
              tickFormatter={(value) => formatChartValue(value, numberFormat, locale)}
            />
            <YAxis
              dataKey={scatterYKey}
              name={seriesLabel(scatterYKey)}
              type="number"
              tick={{ fontSize: 10 }}
              tickLine={false}
              width={52}
              tickFormatter={(value) => formatSeriesValue(scatterYKey, value)}
            />
            <Tooltip cursor={{ strokeDasharray: "2 4" }} formatter={tooltipFormatter} />
            <Scatter
              data={rows}
              name={seriesLabel(scatterYKey)}
              fill={colors[0]}
              onClick={selectMark}
              className={selectMark ? "cursor-pointer" : undefined}
              isAnimationActive={!staticRendering}
            >
              {showLabels && (
                <LabelList
                  dataKey={scatterYKey}
                  position="top"
                  formatter={(value: unknown) => formatSeriesValue(scatterYKey, value)}
                />
              )}
            </Scatter>
          </ScatterChart>
        ) : isHorizontalBar ? (
          <BarChart
            data={rows}
            layout="vertical"
            stackOffset={stack === "percent" && stackId ? "expand" : "none"}
            margin={{ top: 12, right: showLabels ? 54 : 12, bottom: 0, left: 8 }}
          >
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => formatChartValue(value, axisNumberFormat, locale)}
            />
            <YAxis dataKey={keys.x} type="category" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={72} />
            <Tooltip formatter={tooltipFormatter} />
            {keys.ys.length > 1 && <Legend wrapperStyle={{ fontSize: 10 }} />}
            {keys.ys.map((key, index) => (
              <Bar key={key} dataKey={key} name={seriesLabel(key)} fill={colors[index % colors.length]} radius={[0, 2, 2, 0]} isAnimationActive={!staticRendering} stackId={stackId} onClick={selectMark} className={selectMark ? "cursor-pointer" : undefined}>
                {showLabels && (
                  <LabelList
                    dataKey={key}
                    position="right"
                    formatter={(value: unknown) => formatSeriesValue(key, value)}
                  />
                )}
              </Bar>
            ))}
          </BarChart>
        ) : (
          <BarChart
            data={rows}
            stackOffset={stack === "percent" && stackId ? "expand" : "none"}
            margin={{ top: showLabels ? 24 : 12, right: 10, bottom: 0, left: 0 }}
          >
            {common}
            {keys.ys.map((key, index) => (
              <Bar key={key} dataKey={key} name={seriesLabel(key)} fill={colors[index % colors.length]} radius={[2, 2, 0, 0]} isAnimationActive={!staticRendering} stackId={stackId} onClick={selectMark} className={selectMark ? "cursor-pointer" : undefined}>
                {showLabels && (
                  <LabelList
                    dataKey={key}
                    position="top"
                    formatter={(value: unknown) => formatSeriesValue(key, value)}
                  />
                )}
              </Bar>
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function TableBlock({
  block,
  editing = false,
  staticRendering = false,
}: {
  block: ReportBlock;
  editing?: boolean;
  staticRendering?: boolean;
}) {
  const t = useTranslations("reportWorkspace");
  const tBlocks = useTranslations("reportBlocks");
  const locale = useLocale();
  const rows = rowsFromContent(block.content);
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);
  if (!rows.length) {
    return (
      <EmptyBlock
        message={
          block.content._filter_applied === true
            ? tBlocks("noFilteredDetails")
            : tBlocks("chooseDetails")
        }
      />
    );
  }
  const columns = Object.keys(rows[0]).slice(0, 8);
  const pageRows = staticRendering
    ? rows
    : rows.slice(page * pageSize, (page + 1) * pageSize);
  const sourceRows =
    typeof block.content._filter_source_rows === "number"
      ? block.content._filter_source_rows
      : rows.length;
  const totalRows =
    typeof block.content.rows_count === "number" ? block.content.rows_count : sourceRows;
  const start = page * pageSize + 1;
  const end = Math.min(rows.length, (page + 1) * pageSize);
  return (
    <div className={cn(
      "flex min-h-0 flex-col border border-border",
      editing ? "h-full" : staticRendering ? "h-auto" : "max-h-[520px]"
    )}>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[520px] border-collapse text-left text-xs">
        <thead className="sticky top-0 bg-muted/80 backdrop-blur">
          <tr>
            {columns.map((column) => (
              <th key={column} className="border-b border-border px-3 py-2.5 font-semibold">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-border/70 last:border-b-0">
              {columns.map((column) => {
                const numeric = typeof row[column] === "number";
                return (
                  <td
                    key={column}
                    className={cn(
                      "max-w-52 truncate px-3 py-2.5 text-muted-foreground",
                      numeric && "text-right font-mono tabular-nums"
                    )}
                  >
                    {String(row[column] ?? "—")}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        </table>
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-card px-3 py-2 text-[10px] text-muted-foreground">
        <span>
          {block.content._filter_applied === true
            ? tBlocks("tableFilteredRows", {
                count: rows.length.toLocaleString(locale),
                source: sourceRows.toLocaleString(locale),
              })
            : totalRows > rows.length
              ? tBlocks("tableRetainedRows", {
                  count: rows.length.toLocaleString(locale),
                  total: totalRows.toLocaleString(locale),
                })
              : tBlocks("tableRows", { count: rows.length.toLocaleString(locale) })}
          {!staticRendering && rows.length > pageSize
            ? tBlocks("tableCurrentRange", {
                start: start.toLocaleString(locale),
                end: end.toLocaleString(locale),
              })
            : ""}
        </span>
        {!staticRendering && pageCount > 1 && (
          <nav
            aria-label={t("detailPagination", { title: block.title })}
            className="flex items-center border border-border"
          >
            <button type="button" aria-label={t("previousDetailPage")} disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))} className="inline-flex h-7 items-center gap-1 px-2 hover:bg-muted disabled:opacity-30">
              <ChevronLeft size={12} />
              <span className="hidden sm:inline">{t("previousDetailPage")}</span>
            </button>
            <span className="min-w-20 border-x border-border px-2 text-center tabular-nums">
              {t("detailPagePosition", { current: page + 1, total: pageCount })}
            </span>
            <button type="button" aria-label={t("nextDetailPage")} disabled={page >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} className="inline-flex h-7 items-center gap-1 px-2 hover:bg-muted disabled:opacity-30">
              <span className="hidden sm:inline">{t("nextDetailPage")}</span>
              <ChevronRight size={12} />
            </button>
          </nav>
        )}
      </footer>
    </div>
  );
}

function TextBlock({ block }: { block: ReportBlock }) {
  const t = useTranslations("reportBlocks");
  const text = textValue(block.content, ["text", "summary", "description", "value"]);
  return text ? (
    <p className="whitespace-pre-wrap text-sm leading-7 text-foreground/85">{text}</p>
  ) : (
    <EmptyBlock message={t("textPlaceholder")} />
  );
}

function EvidenceBlock({ block }: { block: ReportBlock }) {
  const t = useTranslations("reportBlocks");
  const rows = rowsFromContent(block.content);
  const text = textValue(block.content, ["text", "summary", "description", "value"]);
  return (
    <div className="border-l-2 border-primary/55 pl-4 text-sm leading-6">
      {text && <p className="text-foreground/85">{text}</p>}
      {rows.length > 0 && (
        <ul className={cn("space-y-3", text && "mt-3")}>
          {rows.slice(0, 12).map((item, index) => {
            const label = textValue(item, [
                "label",
                "title",
                "summary",
                "message",
                "purpose",
                "value",
              ]) || t("evidenceFallback", { index: index + 1 });
            const detail = textValue(item, ["text", "detail", "status"]);
            return (
              <li key={index}>
                <span className="block text-sm font-medium text-foreground/85">{label}</span>
                {detail && detail !== label && (
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                    {detail}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > 12 && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          {t("evidenceMore", { count: rows.length - 12 })}
        </p>
      )}
      {!text && !rows.length && <span className="text-muted-foreground">{t("evidenceEmpty")}</span>}
    </div>
  );
}

export function ReportBlockCard({
  block,
  editing,
  selected,
  staticRendering = false,
  onSelect,
  onMove,
  onResize,
  onDuplicate,
  onDelete,
  onRefresh,
  refreshDisabled = false,
  refreshing = false,
  filterValue,
  filterConnectedCount,
  interaction,
  onFilterValueChange,
}: ReportBlockCardProps) {
  const t = useTranslations("reportBlocks");
  const [actionsOpen, setActionsOpen] = useState(false);
  const refreshVisible = supportsRefresh(block) && Boolean(onRefresh);
  const highlight =
    typeof block.config.highlight === "string"
      ? cleanReportProse(block.config.highlight.trim())
      : "";

  useEffect(() => {
    if (!editing) setActionsOpen(false);
  }, [block.id, editing]);

  return (
    <article
      data-report-block={block.id}
      role={editing ? "button" : undefined}
      tabIndex={editing ? 0 : undefined}
      onClick={(event) => {
        if (!editing) return;
        const target = event.target;
        const interactiveTarget =
          target instanceof Element
            ? target.closest(
                "button, input, select, textarea, a, [role='button'], [contenteditable='true']"
              )
            : null;
        if (interactiveTarget && interactiveTarget !== event.currentTarget) {
          return;
        }
        onSelect();
      }}
      onKeyDown={(event) => {
        if (!editing || event.currentTarget !== event.target) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect();
      }}
      className={cn(
        "group relative flex min-h-0 flex-col border bg-card px-5 pb-5 pt-4 text-card-foreground transition-colors",
        editing ? "h-full" : "h-auto",
        block.block_type === "metric" &&
          (editing
            ? "border-t-2 border-t-primary/55 pb-3 pt-2.5"
            : "border-t-2 border-t-primary/55 pb-4 pt-3"),
        editing
          ? "cursor-pointer hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          : "border-border",
        editing && selected ? "border-primary ring-2 ring-primary/10" : "border-border"
      )}
    >
      <header className={cn(
        "flex min-h-6 items-start justify-between gap-3",
        block.block_type === "metric" ? (editing ? "mb-1" : "mb-2.5") : "mb-4"
      )}>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold tracking-[-0.01em]">{block.title}</h3>
          {typeof block.content.subtitle === "string" && block.content.subtitle && (
            <p className="mt-1 truncate text-xs text-muted-foreground">{block.content.subtitle}</p>
          )}
          {block.config.manual_override === true && (
            <span className="mt-1.5 inline-flex bg-warning/10 px-1.5 py-0.5 text-[9px] font-medium text-warning">
              {t("manualOverride")}
            </span>
          )}
        </div>
        {editing && (
          <div
            className={cn(
              "relative shrink-0 transition-opacity",
              selected
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            )}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              aria-label={t("blockActions")}
              aria-expanded={actionsOpen}
              onClick={() => setActionsOpen((current) => !current)}
              className="inline-flex h-7 w-7 items-center justify-center border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <MoreHorizontal size={14} />
            </button>
            {actionsOpen && (
              <div className="absolute right-0 top-8 z-30 grid w-40 grid-cols-2 border border-border bg-popover p-1 shadow-lg">
                {refreshVisible && (
                  <button
                    type="button"
                    disabled={refreshDisabled || refreshing}
                    onClick={() => {
                      onRefresh?.();
                      setActionsOpen(false);
                    }}
                    aria-label={
                      refreshing
                        ? t("refreshing")
                        : refreshDisabled
                          ? t("saveBeforeRefresh")
                          : t("refreshData")
                    }
                    className="col-span-2 flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <RefreshCw
                      size={12}
                      className={cn(refreshing && "animate-spin")}
                    />
                    {refreshing
                      ? t("refreshing")
                      : refreshDisabled
                        ? t("saveBeforeRefresh")
                        : t("refreshData")}
                  </button>
                )}
                <button type="button" onClick={() => { onMove(-1); setActionsOpen(false); }} aria-label={t("moveUpAria")} className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"><ArrowUp size={12} />{t("moveUp")}</button>
                <button type="button" onClick={() => { onMove(1); setActionsOpen(false); }} aria-label={t("moveDownAria")} className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"><ArrowDown size={12} />{t("moveDown")}</button>
                <button type="button" onClick={() => { onResize(-1); setActionsOpen(false); }} aria-label={t("shrinkAria")} className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"><ChevronLeft size={12} />{t("shrink")}</button>
                <button type="button" onClick={() => { onResize(1); setActionsOpen(false); }} aria-label={t("expandAria")} className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"><ChevronRight size={12} />{t("expand")}</button>
                <button type="button" onClick={() => { onDuplicate(); setActionsOpen(false); }} aria-label={t("duplicateAria")} className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"><Copy size={12} />{t("duplicate")}</button>
                <button type="button" onClick={() => { onDelete(); setActionsOpen(false); }} aria-label={t("deleteAria")} className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-destructive hover:bg-destructive/10"><Trash2 size={12} />{t("delete")}</button>
              </div>
            )}
          </div>
        )}
      </header>

      <div className={cn(
        "min-h-0 flex-1",
        editing &&
          (block.block_type === "text" || block.block_type === "evidence") &&
          "overflow-auto"
      )}>
        {block.block_type === "metric" && <KpiBlock block={block} compact={editing} />}
        {block.block_type === "chart" && !editing && !staticRendering && interaction && <ReportSelectionControl control={interaction} />}
        {block.block_type === "chart" && (
          <ChartBlock
            interaction={interaction}
            block={block}
            editing={editing}
            staticRendering={staticRendering}
          />
        )}
        {block.block_type === "table" && (
          <TableBlock
            block={block}
            editing={editing}
            staticRendering={staticRendering}
          />
        )}
        {block.block_type === "text" && <TextBlock block={block} />}
        {block.block_type === "evidence" && <EvidenceBlock block={block} />}
        {block.block_type === "filter" && (
          <ReportFilterControl
            connectedCount={filterConnectedCount}
            block={block}
            value={filterValue}
            onChange={onFilterValueChange}
            staticRendering={staticRendering}
          />
        )}
      </div>

      {highlight && (
        <aside
          role="note"
          aria-label={t("highlight")}
          className={cn(
            "border-l-2 border-primary/55 bg-primary/[0.035]",
            block.block_type === "metric" && editing
              ? "mt-1.5 px-2 py-0.5"
              : "mt-3 px-3 py-2",
            block.block_type !== "metric" && "mt-4"
          )}
        >
          <p className={cn(
            "text-foreground/78",
            block.block_type === "metric" && editing
              ? "truncate text-[9px] leading-4"
              : "whitespace-pre-wrap text-[11px] leading-5"
          )}>
            <span className="mr-2 font-semibold text-primary">{t("highlight")}</span>
            {highlight}
          </p>
        </aside>
      )}
    </article>
  );
}
