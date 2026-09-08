"use client";

import { LayoutPanelTop, Settings2 } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  type ChartPaletteId,
  type ChartValueFormat,
} from "@/lib/charts";
import type { ReportBlock, ReportBlockType, ReportPage } from "@/lib/reports";
import {
  blockTypeLabel,
  createReportBlocksCopy,
  reportBlockOptions,
  reportFilterFields,
} from "@/lib/report-blocks";

interface ReportPropertyPanelProps {
  page: ReportPage;
  block: ReportBlock | null;
  disabled?: boolean;
  onChangePage: (updates: Partial<ReportPage>) => void;
  onChangeBlock: (updates: Partial<ReportBlock>) => void;
}

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

function textContent(block: ReportBlock): string {
  const keys = block.block_type === "metric" ? ["value"] : ["text", "summary", "description"];
  for (const key of keys) {
    const value = block.content[key];
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  return "";
}

function blockColumns(block: ReportBlock): string[] {
  for (const key of ["rows", "data", "items", "values"]) {
    const rows = block.content[key];
    if (!Array.isArray(rows)) continue;
    const first = rows.find(
      (row): row is Record<string, unknown> =>
        typeof row === "object" && row !== null && !Array.isArray(row)
    );
    if (first) return Object.keys(first);
  }
  return [];
}

function numericBlockColumns(block: ReportBlock): string[] {
  for (const key of ["rows", "data", "items", "values"]) {
    const rows = block.content[key];
    if (!Array.isArray(rows)) continue;
    const records = rows.filter(
      (row): row is Record<string, unknown> =>
        typeof row === "object" && row !== null && !Array.isArray(row)
    );
    const columns = new Set<string>();
    for (const row of records) {
      for (const [column, value] of Object.entries(row)) {
        if (typeof value === "number" && Number.isFinite(value)) columns.add(column);
      }
    }
    return [...columns];
  }
  return [];
}

export function ReportPropertyPanel({
  page,
  block,
  disabled = false,
  onChangePage,
  onChangeBlock,
}: ReportPropertyPanelProps) {
  const locale = useLocale();
  const t = useTranslations("reportProperty");
  const tBlocks = useTranslations("reportBlocks");
  const blocksCopy = useMemo(
    () => createReportBlocksCopy((key, values) => tBlocks(key, values)),
    [tBlocks]
  );
  const blockOptions = useMemo(() => reportBlockOptions(blocksCopy), [blocksCopy]);
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
  const columns = block ? blockColumns(block) : [];
  const numericColumns = block ? numericBlockColumns(block) : [];
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
  const filterFields = reportFilterFields(page.blocks, locale);
  return (
    <aside className="flex h-full min-h-0 w-[min(300px,92vw)] shrink-0 flex-col border-l border-border bg-card">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-5">
        {block ? <Settings2 size={15} className="text-primary" /> : <LayoutPanelTop size={15} className="text-primary" />}
        <h2 className="text-xs font-semibold">{block ? t("blockSettings") : t("pageSettings")}</h2>
      </div>

      <fieldset
        disabled={disabled}
        className="min-h-0 flex-1 overflow-y-auto border-0 px-5 py-5 disabled:opacity-60"
      >
        {!block ? (
          <div className="space-y-5">
            <label className="block">
              <FieldLabel>{t("pageName")}</FieldLabel>
              <input
                value={page.title}
                maxLength={160}
                onChange={(event) => onChangePage({ title: event.target.value })}
                className="h-9 w-full border border-input bg-background px-3 text-sm outline-none focus:border-primary"
              />
            </label>
            <p className="text-xs leading-5 text-muted-foreground">
              {t("selectBlockHint")}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            <label className="block">
              <FieldLabel>{t("blockType")}</FieldLabel>
              <select
                value={block.block_type}
                onChange={(event) => onChangeBlock({ block_type: event.target.value as ReportBlockType })}
                className="h-9 w-full border border-input bg-background px-3 text-sm outline-none focus:border-primary"
              >
                {blockOptions.map((option) => (
                  <option key={option.type} value={option.type}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <FieldLabel>{t("title")}</FieldLabel>
              <input
                value={block.title}
                aria-label={t("blockTitle")}
                maxLength={200}
                onChange={(event) => onChangeBlock({ title: event.target.value })}
                placeholder={blockTypeLabel(block.block_type, blocksCopy)}
                className="h-9 w-full border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
              />
            </label>

            {(block.block_type === "text" || block.block_type === "evidence") && (
              <label className="block">
                <FieldLabel>{block.block_type === "evidence" ? t("evidenceText") : t("bodyText")}</FieldLabel>
                <textarea
                  value={textContent(block)}
                  onChange={(event) => onChangeBlock({ content: { ...block.content, text: event.target.value } })}
                  rows={8}
                  className="w-full resize-y border border-input bg-background px-3 py-2.5 text-sm leading-6 outline-none focus:border-primary"
                />
              </label>
            )}

            {block.block_type === "metric" && (
              <>
                <label className="block">
                  <FieldLabel>{t("displayValue")}</FieldLabel>
                  <input
                    value={textContent(block)}
                    onChange={(event) => onChangeBlock({ content: { ...block.content, value: event.target.value } })}
                    className="h-9 w-full border border-input bg-background px-3 text-sm outline-none focus:border-primary"
                  />
                </label>
                <label className="block">
                  <FieldLabel>{t("supportingText")}</FieldLabel>
                  <input
                    value={typeof block.content.context === "string" ? block.content.context : ""}
                    onChange={(event) => onChangeBlock({ content: { ...block.content, context: event.target.value } })}
                    className="h-9 w-full border border-input bg-background px-3 text-sm outline-none focus:border-primary"
                  />
                </label>
              </>
            )}

            {block.block_type === "chart" && (
              <div className="space-y-4">
                <label className="block">
                  <FieldLabel>{t("chartStyle")}</FieldLabel>
                  {typeof block.content.image_url === "string" ? (
                    <div className="flex h-9 items-center border border-input bg-muted/30 px-3 text-sm text-muted-foreground">
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
                      className="h-9 w-full border border-input bg-background px-3 text-sm outline-none focus:border-primary"
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
                        className="h-9 w-full border border-input bg-background px-2 text-xs outline-none focus:border-primary"
                      >
                        {columns.map((column) => <option key={column}>{column}</option>)}
                      </select>
                    </label>
                    <fieldset>
                      <FieldLabel>{t("valueSeries")}</FieldLabel>
                      <div className="max-h-28 overflow-y-auto border border-input bg-background px-2 py-1.5">
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
                {editableDataChart && selectedSeries.length > 0 && (
                  <div className="space-y-2 border-t border-border pt-4">
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
                            className="h-9 w-full border border-input bg-background px-2 text-xs outline-none placeholder:text-muted-foreground focus:border-primary"
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
                            className="h-9 w-full border border-input bg-background px-2 text-xs outline-none focus:border-primary"
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
                  <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
                    <label>
                      <FieldLabel>{t("orientation")}</FieldLabel>
                      <select
                        aria-label={t("chartOrientation")}
                        value={supportsOrientation ? chartOrientation : "vertical"}
                        disabled={!supportsOrientation}
                        onChange={(event) =>
                          onChangeBlock({
                            config: { ...block.config, orientation: event.target.value },
                          })
                        }
                        className="h-9 w-full border border-input bg-background px-2 text-xs outline-none focus:border-primary disabled:bg-muted/35 disabled:text-muted-foreground"
                      >
                        <option value="vertical">{t("vertical")}</option>
                        <option value="horizontal">{t("horizontal")}</option>
                      </select>
                    </label>
                    <label>
                      <FieldLabel>{t("stacking")}</FieldLabel>
                      <select
                        aria-label={t("chartStacking")}
                        value={
                          supportsStack &&
                          selectedSeries.length >= 2 &&
                          (block.config.stack === "normal" || block.config.stack === "percent")
                            ? block.config.stack
                            : "none"
                        }
                        disabled={!supportsStack || selectedSeries.length < 2}
                        onChange={(event) =>
                          onChangeBlock({
                            config: { ...block.config, stack: event.target.value },
                          })
                        }
                        className="h-9 w-full border border-input bg-background px-2 text-xs outline-none focus:border-primary disabled:bg-muted/35 disabled:text-muted-foreground"
                      >
                        <option value="none">{t("stackNone")}</option>
                        <option value="normal">{t("stackNormal")}</option>
                        <option value="percent">{t("stackPercent")}</option>
                      </select>
                    </label>
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
                        className="h-9 w-full border border-input bg-background px-2 text-xs outline-none focus:border-primary"
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
                        className="h-9 w-full border border-input bg-background px-2 text-xs outline-none focus:border-primary"
                      >
                        {chartPaletteOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="col-span-2 flex cursor-pointer items-center gap-2 border border-input bg-background px-3 py-2 text-xs">
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
              </div>
            )}

            {block.block_type === "filter" && (
              <div className="space-y-4">
                <label className="block">
                  <FieldLabel>{t("filterField")}</FieldLabel>
                  <select
                    value={typeof block.config.field === "string" ? block.config.field : ""}
                    onChange={(event) =>
                      onChangeBlock({ config: { ...block.config, field: event.target.value } })
                    }
                    disabled={!filterFields.length}
                    className="h-9 w-full border border-input bg-background px-3 text-sm outline-none focus:border-primary disabled:text-muted-foreground"
                  >
                    <option value="">
                      {filterFields.length ? t("selectField") : t("noFilterData")}
                    </option>
                    {filterFields.map((field) => <option key={field}>{field}</option>)}
                  </select>
                </label>
                <label className="block">
                  <FieldLabel>{t("matchMode")}</FieldLabel>
                  <select
                    value={typeof block.config.operator === "string" ? block.config.operator : "contains"}
                    onChange={(event) =>
                      onChangeBlock({ config: { ...block.config, operator: event.target.value } })
                    }
                    className="h-9 w-full border border-input bg-background px-3 text-sm outline-none focus:border-primary"
                  >
                    <option value="contains">{t("operatorContains")}</option>
                    <option value="equals">{t("operatorEquals")}</option>
                    <option value="not_equals">{t("operatorNotEquals")}</option>
                    <option value="greater_than">{t("operatorGreaterThan")}</option>
                    <option value="greater_or_equal">{t("operatorGreaterOrEqual")}</option>
                    <option value="less_than">{t("operatorLessThan")}</option>
                    <option value="less_or_equal">{t("operatorLessOrEqual")}</option>
                  </select>
                </label>
                <label className="block">
                  <FieldLabel>{t("inputHint")}</FieldLabel>
                  <input
                    value={typeof block.config.placeholder === "string" ? block.config.placeholder : ""}
                    onChange={(event) => onChangeBlock({ config: { ...block.config, placeholder: event.target.value } })}
                    className="h-9 w-full border border-input bg-background px-3 text-sm outline-none focus:border-primary"
                  />
                </label>
                <p className="text-[11px] leading-5 text-muted-foreground">
                  {t("filterDescription")}
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 border-t border-border pt-5">
              <label>
                <FieldLabel>{t("width")}</FieldLabel>
                <select
                  value={block.layout.w}
                  onChange={(event) => onChangeBlock({ layout: { ...block.layout, w: Number(event.target.value) } })}
                  className="h-9 w-full border border-input bg-background px-2 text-xs outline-none focus:border-primary"
                >
                  <option value={3}>{t("widthQuarter")}</option>
                  <option value={4}>{t("widthThird")}</option>
                  <option value={6}>{t("widthHalf")}</option>
                  <option value={8}>{t("widthTwoThirds")}</option>
                  <option value={12}>{t("widthFull")}</option>
                </select>
              </label>
              <label>
                <FieldLabel>{t("height")}</FieldLabel>
                <select
                  value={block.layout.h}
                  onChange={(event) => onChangeBlock({ layout: { ...block.layout, h: Number(event.target.value) } })}
                  className="h-9 w-full border border-input bg-background px-2 text-xs outline-none focus:border-primary"
                >
                  <option value={2}>{t("heightCompact")}</option>
                  <option value={3}>{t("heightStandard")}</option>
                  <option value={4}>{t("heightTall")}</option>
                  <option value={6}>{t("heightLarge")}</option>
                </select>
              </label>
            </div>

            {block.source_kind !== "manual" && (
              <p className="border-t border-border pt-4 text-[11px] leading-5 text-muted-foreground">
                {block.source_available === false
                  ? t("sourceUnavailable")
                  : block.config.manual_override === true
                  ? t("sourceEdited")
                  : t("sourceAvailable")}
              </p>
            )}
          </div>
        )}
      </fieldset>
    </aside>
  );
}
