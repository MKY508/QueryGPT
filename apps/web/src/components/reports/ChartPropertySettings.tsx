"use client";

import { useMemo, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { ChartPaletteId, ChartValueFormat } from "@/lib/charts";
import type { ReportBlock } from "@/lib/reports";
import { chartNumber, isNumericCell } from "@/lib/numeric-values";
import { blockRows, interactionFields } from "@/lib/report-interactions";
import { cn } from "@/lib/utils";
import fieldStyles from "@/components/ui/FieldControl.module.css";
import { ReportPropertySection } from "./ReportPropertySection";

const CHART_VALUE_FORMATS: readonly ChartValueFormat[] = [
  "auto",
  "number",
  "integer",
  "compact",
  "currency",
  "percent",
];

const CHART_PALETTE_IDS: readonly ChartPaletteId[] = [
  "receiptbi",
  "receiptbi-muted",
  "categorical",
  "monochrome",
];

function chartValueFormat(value: unknown): ChartValueFormat {
  return CHART_VALUE_FORMATS.includes(value as ChartValueFormat)
    ? (value as ChartValueFormat)
    : "auto";
}

function chartPalette(value: unknown): ChartPaletteId {
  return CHART_PALETTE_IDS.includes(value as ChartPaletteId)
    ? (value as ChartPaletteId)
    : "receiptbi";
}

function configRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function chartSeriesLabels(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(configRecord(value)).flatMap(([key, label]) =>
      typeof label === "string" && label.trim() ? [[key, label] as const] : []
    )
  );
}

function chartSeriesFormats(value: unknown): Record<string, ChartValueFormat> {
  return Object.fromEntries(
    Object.entries(configRecord(value)).flatMap(([key, format]) =>
      CHART_VALUE_FORMATS.includes(format as ChartValueFormat)
        ? [[key, format as ChartValueFormat] as const]
        : []
    )
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="mb-1.5 block text-[11px] font-medium text-muted-foreground">{children}</span>;
}

/** Block-local chart choices; page interactions and persistence belong to the parent. */
export function ChartPropertySettings({ block, onChangeBlock }: {
  block: ReportBlock; onChangeBlock: (updates: Partial<ReportBlock>) => void;
}) {
  const t = useTranslations("reportProperty");
  const chartValueFormatOptions = useMemo(
    () => [
      { value: "auto" as const, label: t("formatAuto") },
      { value: "number" as const, label: t("formatNumber") },
      { value: "integer" as const, label: t("formatInteger") },
      { value: "compact" as const, label: t("formatCompact") },
      { value: "currency" as const, label: t("formatCurrency") },
      { value: "percent" as const, label: t("formatPercent") },
    ],
    [t]
  );
  const chartPaletteOptions = useMemo(
    () => [
      { value: "receiptbi" as const, label: "ReceiptBI" },
      { value: "receiptbi-muted" as const, label: t("paletteMuted") },
      { value: "categorical" as const, label: t("paletteCategorical") },
      { value: "monochrome" as const, label: t("paletteMonochrome") },
    ],
    [t]
  );
  const columns = interactionFields(block);
  const rows = blockRows(block)?.rows ?? [];
  const numericColumns = columns.filter(column => rows.some(row => isNumericCell(row[column]) && chartNumber(row[column]) !== null));
  const chartType =
    block && typeof block.config.chart_type === "string"
      ? block.config.chart_type
      : "bar";
  const singleSeriesChart = chartType === "pie" || chartType === "scatter";
  const configuredSeries = block
    ? Array.isArray(block.config.y_keys)
      ? block.config.y_keys.filter(
          (key): key is string => typeof key === "string" && numericColumns.includes(key)
        )
      : typeof block.config.y_key === "string" && numericColumns.includes(block.config.y_key)
        ? [block.config.y_key]
        : numericColumns.slice(0, 1)
    : [];
  const selectedSeries = singleSeriesChart
    ? configuredSeries.slice(0, 1)
    : configuredSeries;
  const seriesLabels = block ? chartSeriesLabels(block.config.series_labels) : {};
  const seriesFormats = block ? chartSeriesFormats(block.config.series_formats) : {};
  const chartOrientation =
    block &&
    (block.config.orientation === "vertical" || block.config.orientation === "horizontal")
      ? block.config.orientation
      : chartType === "horizontal_bar"
        ? "horizontal"
        : "vertical";
  const supportsOrientation = chartType === "bar" || chartType === "horizontal_bar";
  const supportsStack = supportsOrientation || chartType === "area";
  const editableDataChart =
    block?.block_type === "chart" && typeof block.content.image_url !== "string";
  return <div className="space-y-4">
    <ReportPropertySection title={t("chartStructure")} defaultOpen>
    <label className="block">
      <FieldLabel>{t("chartStyle")}</FieldLabel>
      {typeof block.content.image_url === "string" ? (
        <div className="flex h-9 items-center rounded-md border border-input bg-muted/30 px-3 text-sm text-muted-foreground">
          {t("generatedChartImage")}
        </div>
      ) : (
        <select
          aria-label={t("chartStyle")}
          value={chartType}
          onChange={(event) => {
            const nextType = event.target.value;
            const nextSingleSeries =
              nextType === "pie" || nextType === "scatter";
            const nextSeries = nextSingleSeries
              ? selectedSeries.slice(0, 1)
              : selectedSeries;
            const nextSupportsStack =
              (nextType === "bar" ||
                nextType === "horizontal_bar" ||
                nextType === "area") &&
              nextSeries.length >= 2;
            onChangeBlock({
              config: {
                ...block.config,
                chart_type: nextType,
                y_key: nextSeries[0] || "",
                y_keys: nextSeries,
                orientation:
                  nextType === "horizontal_bar"
                    ? "horizontal"
                    : "vertical",
                stack: nextSupportsStack
                  ? block.config.stack === "normal" ||
                    block.config.stack === "percent"
                    ? block.config.stack
                    : "none"
                  : "none",
              },
            });
          }}
          className={cn(fieldStyles.control)}
        >
          <option value="bar">{t("chartBar")}</option>
          <option value="horizontal_bar">{t("chartHorizontalBar")}</option>
          <option value="line">{t("chartLine")}</option>
          <option value="area">{t("chartArea")}</option>
          <option value="pie">{t("chartPie")}</option>
          <option value="scatter">{t("chartScatter")}</option>
        </select>
      )}
    </label>
    {columns.length > 1 && (
      <div className="grid grid-cols-2 gap-3">
        <label>
          <FieldLabel>{t("categoryAxis")}</FieldLabel>
          <select
            value={typeof block.config.x_key === "string" ? block.config.x_key : columns[0]}
            onChange={(event) => onChangeBlock({ config: { ...block.config, x_key: event.target.value } })}
            className={cn(fieldStyles.control, "text-xs")}
          >
            {columns.map((column) => <option key={column}>{column}</option>)}
          </select>
        </label>
        <fieldset>
          <FieldLabel>{t("valueSeries")}</FieldLabel>
          <div className="max-h-28 overflow-y-auto rounded-md border border-input bg-background px-2 py-1.5">
            {numericColumns.map((column) => (
              <label key={column} className="flex cursor-pointer items-center gap-2 py-1 text-xs">
                <input
                  type={singleSeriesChart ? "radio" : "checkbox"}
                  name={singleSeriesChart ? `chart-series-${block.id}` : undefined}
                  checked={selectedSeries.includes(column)}
                  onChange={(event) => {
                    const next = singleSeriesChart
                      ? event.target.checked
                        ? [column]
                        : selectedSeries
                      : event.target.checked
                        ? [...selectedSeries, column]
                        : selectedSeries.filter((item) => item !== column);
                    onChangeBlock({
                      config: {
                        ...block.config,
                        y_key: next[0] || "",
                        y_keys: next,
                        stack:
                          supportsStack && next.length >= 2
                            ? block.config.stack || "none"
                            : "none",
                      },
                    });
                  }}
                  className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
                />
                <span className="truncate">{column}</span>
              </label>
            ))}
            {!numericColumns.length && (
              <span className="block py-1 text-[11px] text-muted-foreground">
                {t("noNumericFields")}
              </span>
            )}
          </div>
        </fieldset>
      </div>
    )}
    {editableDataChart && (
      <div className="grid grid-cols-2 gap-3">
        <label>
          <FieldLabel>{t("orientation")}</FieldLabel>
          <select
            aria-label={t("chartOrientation")}
            value={supportsOrientation ? chartOrientation : "vertical"}
            disabled={!supportsOrientation}
            onChange={(event) => onChangeBlock({ config: { ...block.config, orientation: event.target.value } })}
            className={cn(fieldStyles.control, "text-xs")}
          >
            <option value="vertical">{t("vertical")}</option>
            <option value="horizontal">{t("horizontal")}</option>
          </select>
        </label>
        <label>
          <FieldLabel>{t("stacking")}</FieldLabel>
          <select
            aria-label={t("chartStacking")}
            value={supportsStack && selectedSeries.length >= 2 &&
              (block.config.stack === "normal" || block.config.stack === "percent") ? block.config.stack : "none"}
            disabled={!supportsStack || selectedSeries.length < 2}
            onChange={(event) => onChangeBlock({ config: { ...block.config, stack: event.target.value } })}
            className={cn(fieldStyles.control, "text-xs")}
          >
            <option value="none">{t("stackNone")}</option>
            <option value="normal">{t("stackNormal")}</option>
            <option value="percent">{t("stackPercent")}</option>
          </select>
        </label>
      </div>
    )}
    </ReportPropertySection>
    {editableDataChart && <ReportPropertySection title={t("chartAppearance")}>
    {editableDataChart && selectedSeries.length > 0 && (
      <div className="space-y-2">
        <FieldLabel>{t("seriesDisplay")}</FieldLabel>
        {selectedSeries.map((series) => (
          <div key={series} className="grid grid-cols-[minmax(0,1fr)_112px] gap-2">
            <label className="min-w-0">
              <span className="sr-only">{t("seriesDisplayName", { series })}</span>
              <input
                aria-label={t("seriesDisplayName", { series })}
                value={seriesLabels[series] || ""}
                maxLength={80}
                placeholder={series}
                onChange={(event) => {
                  const nextLabels = { ...seriesLabels };
                  const nextLabel = event.target.value;
                  if (nextLabel.trim()) nextLabels[series] = nextLabel;
                  else delete nextLabels[series];
                  const nextConfig = { ...block.config };
                  if (Object.keys(nextLabels).length) {
                    nextConfig.series_labels = nextLabels;
                  } else {
                    delete nextConfig.series_labels;
                  }
                  onChangeBlock({ config: nextConfig });
                }}
                className={cn(fieldStyles.control, "text-xs")}
              />
            </label>
            <label>
              <span className="sr-only">{t("seriesValueFormat", { series })}</span>
              <select
                aria-label={t("seriesValueFormat", { series })}
                value={seriesFormats[series] || ""}
                onChange={(event) => {
                  const nextFormats = { ...seriesFormats };
                  const nextFormat = event.target.value;
                  if (nextFormat) {
                    nextFormats[series] = chartValueFormat(nextFormat);
                  } else {
                    delete nextFormats[series];
                  }
                  const nextConfig = { ...block.config };
                  if (Object.keys(nextFormats).length) {
                    nextConfig.series_formats = nextFormats;
                  } else {
                    delete nextConfig.series_formats;
                  }
                  onChangeBlock({ config: nextConfig });
                }}
                className={cn(fieldStyles.control, "text-xs")}
              >
                <option value="">{t("followDefault")}</option>
                {chartValueFormatOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
        ))}
      </div>
    )}
    {editableDataChart && (
      <div className="grid grid-cols-2 gap-3">
        <label>
          <FieldLabel>{t("defaultValueFormat")}</FieldLabel>
          <select
            aria-label={t("chartValueFormat")}
            value={chartValueFormat(block.config.number_format)}
            onChange={(event) =>
              onChangeBlock({
                config: { ...block.config, number_format: event.target.value },
              })
            }
            className={cn(fieldStyles.control, "text-xs")}
          >
            {chartValueFormatOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          <FieldLabel>{t("palette")}</FieldLabel>
          <select
            aria-label={t("chartPalette")}
            value={chartPalette(block.config.palette)}
            onChange={(event) =>
              onChangeBlock({
                config: { ...block.config, palette: event.target.value },
              })
            }
            className={cn(fieldStyles.control, "text-xs")}
          >
            {chartPaletteOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="col-span-2 flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-xs">
          <input
            type="checkbox"
            aria-label={t("showDataLabels")}
            checked={block.config.show_labels === true}
            onChange={(event) =>
              onChangeBlock({
                config: { ...block.config, show_labels: event.target.checked },
              })
            }
            className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
          />
          {t("showDataLabels")}
        </label>
      </div>
    )}
    </ReportPropertySection>}
  </div>;
}
