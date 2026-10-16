"use client";

import Image from "next/image";
import { Button } from "@/components/ui/button";
import { ReportActionMenu } from "./ReportActionMenu";
import { readReportRefreshSource } from "@/lib/reports";
import { useState } from "react";
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
  PencilLine,
  RefreshCw,
  Trash2,
  Table2,
} from "lucide-react";
import type { ReportBlock } from "@/lib/reports";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "next-intl";
import type { ChartSelectionControl } from "@/lib/report-interactions";
import { chartMarkSelection, renderReportSelectionDot } from "./report-chart-interactions";
import { ReportSelectionControl } from "./ReportSelectionControl";
import { DataViewDialog, type DataViewSnapshot } from "@/components/data/DataViewDialog";
import { dataCellText, dataColumns, reportContentRows } from "@/lib/tabular-data";
import {
  chartField,
  chartNumber,
  chartNumberKey,
  chartSourceValue,
  compareNumericValues,
  formatNumericValue,
  isNumericCell,
} from "@/lib/numeric-values";
import { hasMetricResultField } from "@/lib/report-metrics";
import { metricDisplayText, metricValue } from "@/lib/metric-display";
import { ReportFilterControl } from "./ReportFilterControl";
import { isReportTextBlock } from "@/lib/report-text";
import { cleanReportProse, reportTextValue as textValue } from "@/lib/report-display-text";

interface ReportBlockCardProps {
  block: ReportBlock;
  editing: boolean;
  selected: boolean;
  staticRendering?: boolean;
  /** Retained row count before slicing a read-only picker preview. */
  previewRowCount?: number;
  onSelect: () => void;
  onEditText?: () => void;
  onMove: (direction: -1 | 1) => void;
  onMoveToPage?: () => void;
  onResize: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRefresh?: () => void;
  refreshDisabled?: boolean;
  refreshing?: boolean;
  filterValue?: string;
  filterConnectedCount?: number;
  onFilterValueChange?: (value: string) => void;
  interaction?: ChartSelectionControl;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export function supportsReportBlockRefresh(block: ReportBlock): boolean {
  const hasSavedRefreshBinding = isRecord(block.source_ref?.refresh_binding);
  return (
    !block.id.startsWith("local-") &&
    typeof block.version === "number" &&
    block.source_kind === "artifact" &&
    (block.source_available === true || hasSavedRefreshBinding) &&
    (block.block_type === "table" ||
      hasMetricResultField(block) ||
      (block.block_type === "chart" && !isPngChart(block)))
  );
}

function rowsFromContent(content: Record<string, unknown>): Record<string, unknown>[] {
  return reportContentRows(content)?.rows || [];
}

function chartKeys(
  rows: Record<string, unknown>[],
  config: Record<string, unknown>
): { x: string; ys: string[] } | null {
  const first = rows[0];
  if (!first) return null;
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const isNumericField = (key: string) =>
    keys.includes(key) && rows.some((row) => isNumericCell(row[key]) && chartNumber(row[key]) !== null);
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
      : keys.find((key) => isNumericField(key) && key !== x);
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
  return formatNumericValue(value, format, locale, 2);
}

function EmptyBlock({ message }: { message: string }) {
  return (
    <div className="flex min-h-24 items-center justify-center border border-dashed border-border bg-muted/20 px-5 text-center text-xs leading-5 text-muted-foreground">
      {message}
    </div>
  );
}

function KpiBlock({ block, compact = false }: { block: ReportBlock; compact?: boolean }) {
  const locale = useLocale();
  const value = cleanReportProse(metricDisplayText(block, locale));
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
      <div title={String(metricValue(block.content) ?? "—")} className={cn(
        "min-w-0 break-all font-mono font-semibold leading-tight tracking-[-0.045em] text-foreground tabular-nums",
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
  const numericKeys = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((key) =>
    rows.some((row) => isNumericCell(row[key]) && chartNumber(row[key]) !== null)
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
  const selectMark = interaction && !editing && !staticRendering ? (mark: unknown) => {
    const value = chartMarkSelection(mark, interaction.field);
    if (value !== undefined) interaction.onSelect(value);
  } : undefined;
  const selectionDot = selectMark ? (mark: unknown) => renderReportSelectionDot(mark, selectMark, colors[0]) : undefined;
  const seriesKeyFromName = (name: unknown, dataKey?: unknown) => {
    const field = chartField(dataKey);
    if (numericKeys.includes(field)) return field;
    const candidate = String(name ?? "");
    return keys.ys.find(
      (key) => key === candidate || seriesLabel(key) === candidate
    );
  };
  const tooltipFormatter = (value: unknown, name: unknown, item?: { dataKey?: unknown; payload?: unknown }) => {
    const key = seriesKeyFromName(name, item?.dataKey);
    const original = key ? chartSourceValue(item?.payload, key, value) : value;
    return [
      key
        ? formatSeriesValue(key, original)
        : formatChartValue(original, numberFormat, locale),
      key ? seriesLabel(key) : String(name ?? ""),
    ];
  };
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
                dataKey={chartNumberKey(key)}
                name={seriesLabel(key)}
                isAnimationActive={!staticRendering}
                stroke={colors[index % colors.length]}
                strokeWidth={2}
                dot={selectMark ? selectionDot : { r: 2, fill: colors[index % colors.length] }}
                activeDot={selectMark ? selectionDot : undefined}
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
                dataKey={chartNumberKey(key)}
                name={seriesLabel(key)}
                isAnimationActive={!staticRendering}
                stroke={colors[index % colors.length]}
                fill={colors[index % colors.length]}
                fillOpacity={0.14}
                strokeWidth={2}
                stackId={stackId}
                dot={selectMark ? selectionDot : false}
                activeDot={selectMark ? selectionDot : undefined}
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
              formatter={(value, _name, item) => [
                formatSeriesValue(keys.ys[0], chartSourceValue(item.payload, keys.ys[0], value)),
                seriesLabel(keys.ys[0]),
              ]}
            />
            <Pie
              data={rows}
              dataKey={chartNumberKey(keys.ys[0])}
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
                  ? ({ name, value, payload }) =>
                      `${String(name ?? "")}: ${formatSeriesValue(keys.ys[0], chartSourceValue(payload, keys.ys[0], value))}`
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
              dataKey={chartNumberKey(scatterXKey)}
              name={scatterXKey}
              type="number"
              tick={{ fontSize: 10 }}
              tickLine={false}
              tickFormatter={(value) => formatChartValue(value, numberFormat, locale)}
            />
            <YAxis
              dataKey={chartNumberKey(scatterYKey)}
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
              isAnimationActive={!staticRendering}
              onClick={selectMark}
              className={selectMark ? "cursor-pointer" : undefined}
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
              <Bar key={key} dataKey={chartNumberKey(key)} name={seriesLabel(key)} fill={colors[index % colors.length]} radius={[0, 2, 2, 0]} isAnimationActive={!staticRendering} stackId={stackId} onClick={selectMark} className={selectMark ? "cursor-pointer" : undefined}>
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
              <Bar key={key} dataKey={chartNumberKey(key)} name={seriesLabel(key)} fill={colors[index % colors.length]} radius={[2, 2, 0, 0]} isAnimationActive={!staticRendering} stackId={stackId} onClick={selectMark} className={selectMark ? "cursor-pointer" : undefined}>
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
  previewRowCount,
}: {
  block: ReportBlock;
  editing?: boolean;
  staticRendering?: boolean;
  previewRowCount?: number;
}) {
  const t = useTranslations("reportWorkspace");
  const tBlocks = useTranslations("reportBlocks");
  const tData = useTranslations("dataView");
  const locale = useLocale();
  const rows = rowsFromContent(block.content);
  const [requestedPage, setPage] = useState(0);
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(requestedPage, pageCount - 1);
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
  const allColumns = dataColumns(rows);
  const columns = allColumns.slice(0, 8);
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
                const numeric = isNumericCell(row[column]);
                return (
                  <td
                    key={column}
                    title={dataCellText(row[column])}
                    className={cn(
                      "max-w-52 truncate px-3 py-2.5 text-muted-foreground",
                      numeric && "text-right font-mono tabular-nums",
                      numeric && compareNumericValues(row[column], 0) === -1 && "text-destructive"
                    )}
                  >
                    {row[column] === null || row[column] === undefined ? "—" : dataCellText(row[column])}
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
          {previewRowCount !== undefined
            ? tBlocks("tablePreviewRows", { count: rows.length.toLocaleString(locale), total: previewRowCount.toLocaleString(locale) })
            : block.content._filter_applied === true
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
          {allColumns.length > columns.length && <span className="ml-3">{tData("previewColumns", { count: columns.length, total: allColumns.length })}</span>}
        </span>
        {!staticRendering && pageCount > 1 && (
          <nav
            aria-label={t("detailPagination", { title: block.title })}
            className="flex shrink-0 items-center gap-1"
          >
            <Button variant="ghost" size="sm" aria-label={t("previousDetailPage")} disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))}>
              <ChevronLeft size={12} />
              <span>{t("previousDetailPage")}</span>
            </Button>
            <span className="min-w-20 px-2 text-center tabular-nums">
              {t("detailPagePosition", { current: page + 1, total: pageCount })}
            </span>
            <Button variant="ghost" size="sm" aria-label={t("nextDetailPage")} disabled={page >= pageCount - 1} onClick={() => setPage(Math.min(pageCount - 1, page + 1))}>
              <span>{t("nextDetailPage")}</span>
              <ChevronRight size={12} />
            </Button>
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
    <p className="whitespace-pre-wrap break-words text-sm leading-7 text-foreground/85 [overflow-wrap:anywhere]">{text}</p>
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
      {text && <p className="whitespace-pre-wrap break-words text-foreground/85 [overflow-wrap:anywhere]">{text}</p>}
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

type ReportBlockActionsProps = Pick<ReportBlockCardProps,
  "selected" | "onMove" | "onMoveToPage" | "onResize" | "onDuplicate" | "onDelete" | "onRefresh" | "refreshDisabled" | "refreshing"
> & { refreshVisible: boolean };

function ReportBlockActions({ selected, onMove, onMoveToPage, onResize, onDuplicate, onDelete,
  onRefresh, refreshDisabled, refreshing, refreshVisible }: ReportBlockActionsProps) {
  const t = useTranslations("reportBlocks");
  const [open, setOpen] = useState(false);
  return <div className={cn("shrink-0 transition-opacity", selected || open ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100")}
    onClick={event => event.stopPropagation()}>
    <ReportActionMenu label={t("blockActions")} icon={<MoreHorizontal size={14} />} align="end"
      open={open} onOpenChange={setOpen} actions={[
        ...(refreshVisible ? [{ id: "refresh", label: t(refreshing ? "refreshing" : refreshDisabled ? "saveBeforeRefresh" : "refreshData"),
          icon: <RefreshCw size={14} className={cn(refreshing && "animate-spin")} />,
          disabled: refreshDisabled || refreshing, onSelect: () => onRefresh?.() }] : []),
        { id: "up", label: t("moveUpAria"), icon: <ArrowUp size={14} />, onSelect: () => onMove(-1) },
        { id: "down", label: t("moveDownAria"), icon: <ArrowDown size={14} />, onSelect: () => onMove(1) },
        ...(onMoveToPage ? [{ id: "page", label: t("moveToPage"), icon: <ChevronRight size={14} />, onSelect: onMoveToPage }] : []),
        { id: "shrink", label: t("shrinkAria"), icon: <ChevronLeft size={14} />, onSelect: () => onResize(-1) },
        { id: "expand", label: t("expandAria"), icon: <ChevronRight size={14} />, onSelect: () => onResize(1) },
        { id: "duplicate", label: t("duplicateAria"), icon: <Copy size={14} />, onSelect: onDuplicate },
        { id: "delete", label: t("deleteAria"), icon: <Trash2 size={14} />, destructive: true, onSelect: onDelete },
      ]} />
  </div>;
}

export function ReportBlockCard({
  block,
  editing,
  selected,
  staticRendering = false,
  previewRowCount,
  onSelect,
  onEditText,
  onMove,
  onMoveToPage,
  onResize,
  onDuplicate,
  onDelete,
  onRefresh,
  refreshDisabled = false,
  refreshing = false,
  filterValue,
  filterConnectedCount,
  onFilterValueChange,
  interaction,
}: ReportBlockCardProps) {
  const t = useTranslations("reportBlocks");
  const tData = useTranslations("dataView");
  const tRefresh = useTranslations("reportRefresh");
  const tWriting = useTranslations("reportWriting");
  const refreshReceipt = isRecord(block.source_ref?.refresh_receipt) ? block.source_ref.refresh_receipt : null;
  const refreshedSource = readReportRefreshSource(refreshReceipt?.source);
  const [dataView, setDataView] = useState<DataViewSnapshot | null>(null);
  const dataRows = (block.block_type === "table" || block.block_type === "chart") && !block.content.image_url
    ? rowsFromContent(block.content) : [];
  const openData = () => {
    const source = typeof block.content._filter_source_rows === "number" ? block.content._filter_source_rows : dataRows.length;
    const total = typeof block.content.rows_count === "number" ? block.content.rows_count : dataRows.length;
    setDataView({ title: block.title, rows: structuredClone(dataRows),
      notice: block.content._filter_applied === true
        ? t("tableFilteredRows", { count: dataRows.length, source })
        : total > dataRows.length ? t("tableRetainedRows", { count: dataRows.length, total }) : undefined,
    });
  };
  const refreshVisible = supportsReportBlockRefresh(block) && Boolean(onRefresh);
  const highlight =
    typeof block.config.highlight === "string"
      ? cleanReportProse(block.config.highlight.trim())
      : "";

  return (
    <article
      data-report-block={block.id}
      role={editing ? "button" : undefined}
      aria-pressed={editing ? selected : undefined}
      tabIndex={editing ? 0 : -1}
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
        "group relative flex min-h-0 flex-col rounded-xl border bg-card px-5 pb-5 pt-4 text-card-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40",
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
          {!staticRendering && refreshedSource && <p className="mt-1 truncate text-[11px] text-muted-foreground">{tRefresh("lastSource", { source: refreshedSource.data_version ? tRefresh("fileVersion", { name: refreshedSource.name, version: refreshedSource.data_version }) : refreshedSource.name })}</p>}
          {typeof block.content.subtitle === "string" && block.content.subtitle && (
            <p className="mt-1 truncate text-xs text-muted-foreground">{block.content.subtitle}</p>
          )}
          {block.config.manual_override === true && (
            <span className="mt-1.5 inline-flex bg-warning/10 px-1.5 py-0.5 text-[9px] font-medium text-warning">
              {t("manualOverride")}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
        {editing && !staticRendering && onEditText && isReportTextBlock(block) && <button type="button" onClick={onEditText}
          aria-label={tWriting("openFor", { title: block.title })} title={tWriting("title")}
          className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground hover:bg-primary/10 hover:text-primary"><PencilLine size={14} /></button>}
        {!staticRendering && !!dataRows.length && <button type="button" onClick={openData}
          title={tData("open")} aria-label={tData("openFor", { title: block.title || tData("untitled") })}
          className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"><Table2 size={14} /></button>}
        {editing && !staticRendering && (
          <ReportBlockActions key={block.id} selected={selected}
            onMove={onMove} onMoveToPage={onMoveToPage} onResize={onResize} onDuplicate={onDuplicate} onDelete={onDelete}
            onRefresh={onRefresh} refreshDisabled={refreshDisabled} refreshing={refreshing}
            refreshVisible={refreshVisible} />
        )}
        </div>
      </header>

      {interaction && !editing && !staticRendering && <ReportSelectionControl control={interaction} />}

      <div className={cn(
        "min-h-0 flex-1",
        editing &&
          (block.block_type === "text" || block.block_type === "evidence") &&
          "overflow-auto"
      )}>
        {block.block_type === "metric" && <KpiBlock block={block} compact={editing} />}
        {block.block_type === "chart" && (
          <ChartBlock
            block={block}
            editing={editing}
            staticRendering={staticRendering}
            interaction={interaction}
          />
        )}
        {block.block_type === "table" && (
          <TableBlock
            block={block}
            editing={editing}
            staticRendering={staticRendering}
            previewRowCount={previewRowCount}
          />
        )}
        {block.block_type === "text" && <TextBlock block={block} />}
        {block.block_type === "evidence" && <EvidenceBlock block={block} />}
        {block.block_type === "filter" && (
          <ReportFilterControl
            block={block}
            connectedCount={filterConnectedCount}
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
      {dataView && !staticRendering && <DataViewDialog snapshot={dataView} onClose={() => setDataView(null)} />}
    </article>
  );
}
