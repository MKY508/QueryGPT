"use client";

import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  chartField,
  chartNumberKey,
  chartSourceValue,
  formatNumericValue as formatChartValue,
} from "@/lib/numeric-values";
import {
  AreaChart as AreaChartIcon,
  BarChart3,
  BarChartHorizontal,
  LineChart as LineChartIcon,
  PieChart as PieChartIcon,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  getChartPalette,
  type ChartSpec,
  type ChartYEncoding,
} from "@/lib/charts";
import { ChartViewport } from "./ChartViewport";

interface ChartDisplayProps {
  spec: ChartSpec;
}

const TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  color: "hsl(var(--foreground))",
};

// Deterministic local chart-type switching: the same data can be re-rendered
// without another LLM round-trip. Scatter is excluded because it needs a
// numeric x field, which arbitrary category data cannot guarantee.
const TYPE_OPTIONS_BASE: Array<{
  value: ChartSpec["type"];
  Icon: typeof BarChart3;
}> = [
  { value: "bar", Icon: BarChart3 },
  { value: "horizontal_bar", Icon: BarChartHorizontal },
  { value: "line", Icon: LineChartIcon },
  { value: "area", Icon: AreaChartIcon },
  { value: "pie", Icon: PieChartIcon },
];

function encodingLabel(encoding: { field: string; label?: string }): string {
  return encoding.label || encoding.field;
}

function chartSummary(
  spec: ChartSpec,
  chartType: ChartSpec["type"],
  typeLabels: Record<ChartSpec["type"], string>,
  locale: string,
  t: ReturnType<typeof useTranslations<"chartDisplay">>,
): string {
  const x = spec.encoding.x;
  const series = new Intl.ListFormat(locale, {
    style: "short",
    type: "conjunction",
  }).format(spec.encoding.y.map(encodingLabel));
  return t("summaryTemplate", {
    title: spec.title || t("defaultTitle"),
    type: typeLabels[chartType],
    encoding: x ? t("encodingBy", { field: encodingLabel(x) }) : t("encodingUnknown"),
    series,
    count: spec.data.length,
  });
}

export function ChartDisplay({ spec }: ChartDisplayProps) {
  const locale = useLocale();
  const t = useTranslations("chartDisplay");
  const instanceId = useId().replace(/:/g, "");
  const [typeOverride, setTypeOverride] = useState<ChartSpec["type"] | null>(
    null,
  );
  const chartType = typeOverride ?? spec.type;
  const x = spec.encoding.x;
  const y = spec.encoding.y;
  const palette = getChartPalette(spec.presentation.palette);
  const stacked = spec.presentation.stack !== "none";
  const percentStack = spec.presentation.stack === "percent";
  const horizontal =
    chartType === "horizontal_bar" ||
    spec.presentation.orientation === "horizontal";
  const typeLabels: Record<ChartSpec["type"], string> = {
    bar: t("typeBar"),
    horizontal_bar: t("typeBarHorizontal"),
    line: t("typeLine"),
    area: t("typeArea"),
    pie: t("typePie"),
    scatter: t("typeScatter"),
  };
  const summary = chartSummary(spec, chartType, typeLabels, locale, t);
  const chartId = `chart-${spec.data_ref?.result_hash?.slice(0, 12) || instanceId}`;

  if (!x || y.length === 0 || spec.data.length === 0) {
    return (
      <div className="mt-4 flex h-48 items-center justify-center bg-secondary text-muted-foreground">
        {t("noData")}
      </div>
    );
  }

  const findEncoding = (
    name: unknown,
    dataKey?: unknown,
  ): ChartYEncoding | undefined => {
    const renderedKey = chartField(dataKey);
    const renderedName = String(name);
    return y.find((item) => item.field === renderedKey) ?? y.find(
      (item) =>
        item.field === renderedName ||
        encodingLabel(item) === renderedName,
    );
  };
  const tooltip = (
    <Tooltip
      contentStyle={TOOLTIP_STYLE}
      formatter={(value, name, item) => {
        const encoding = findEncoding(name, item.dataKey);
        const field = encoding?.field || (String(name) === encodingLabel(x) ? x.field : String(name));
        const original = chartSourceValue(item.payload, field, value);
        return [
          // stackOffset="expand" normalizes only the rendered stack. Tooltip
          // payloads still contain the original measure, so preserve its own
          // format instead of turning values such as 120 into 12,000%.
          formatChartValue(original, encoding?.format, locale),
          encoding ? encodingLabel(encoding) : String(name),
        ];
      }}
    />
  );

  const renderChart = () => {
    switch (chartType) {
      case "bar":
      case "horizontal_bar":
        return (
          <BarChart
            data={spec.data}
            layout={horizontal ? "vertical" : "horizontal"}
            stackOffset={percentStack ? "expand" : "none"}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            {horizontal ? (
              <>
                <XAxis
                  type="number"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(value) =>
                    formatChartValue(
                      value,
                      percentStack ? "percent" : y[0]?.format,
                      locale,
                    )
                  }
                  className="stroke-muted-foreground"
                  label={
                    y.length === 1
                      ? {
                          value: encodingLabel(y[0]),
                          position: "insideBottom",
                          offset: -4,
                        }
                      : undefined
                  }
                />
                <YAxis
                  type="category"
                  dataKey={x.field}
                  tick={{ fontSize: 12 }}
                  width={80}
                  className="stroke-muted-foreground"
                />
              </>
            ) : (
              <>
                <XAxis
                  dataKey={x.field}
                  tick={{ fontSize: 12 }}
                  className="stroke-muted-foreground"
                  label={
                    x.label
                      ? { value: x.label, position: "insideBottom", offset: -4 }
                      : undefined
                  }
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  tickFormatter={(value) =>
                    formatChartValue(
                      value,
                      percentStack ? "percent" : y[0]?.format,
                      locale,
                    )
                  }
                  className="stroke-muted-foreground"
                />
              </>
            )}
            {tooltip}
            <Legend />
            {y.map((encoding, index) => (
              <Bar
                key={encoding.field}
                dataKey={chartNumberKey(encoding.field)}
                name={encodingLabel(encoding)}
                fill={palette[index % palette.length]}
                stackId={stacked ? "series" : undefined}
                maxBarSize={48}
                radius={stacked ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
              />
            ))}
          </BarChart>
        );

      case "line":
        return (
          <LineChart data={spec.data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey={x.field}
              tick={{ fontSize: 12 }}
              className="stroke-muted-foreground"
              label={
                x.label
                  ? { value: x.label, position: "insideBottom", offset: -4 }
                  : undefined
              }
            />
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(value) => formatChartValue(value, y[0]?.format, locale)}
              className="stroke-muted-foreground"
            />
            {tooltip}
            <Legend />
            {y.map((encoding, index) => (
              <Line
                key={encoding.field}
                type="monotone"
                dataKey={chartNumberKey(encoding.field)}
                name={encodingLabel(encoding)}
                stroke={palette[index % palette.length]}
                strokeWidth={2}
                dot={{
                  fill: palette[index % palette.length],
                  strokeWidth: 2,
                }}
              />
            ))}
          </LineChart>
        );

      case "area":
        return (
          <AreaChart
            data={spec.data}
            stackOffset={percentStack ? "expand" : "none"}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey={x.field}
              tick={{ fontSize: 12 }}
              className="stroke-muted-foreground"
              label={
                x.label
                  ? { value: x.label, position: "insideBottom", offset: -4 }
                  : undefined
              }
            />
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(value) =>
                formatChartValue(
                  value,
                  percentStack ? "percent" : y[0]?.format,
                  locale,
                )
              }
              className="stroke-muted-foreground"
            />
            {tooltip}
            <Legend />
            {y.map((encoding, index) => (
              <Area
                key={encoding.field}
                type="monotone"
                dataKey={chartNumberKey(encoding.field)}
                name={encodingLabel(encoding)}
                stroke={palette[index % palette.length]}
                fill={palette[index % palette.length]}
                fillOpacity={0.2}
                strokeWidth={2}
                stackId={stacked ? "series" : undefined}
              />
            ))}
          </AreaChart>
        );

      case "pie": {
        const value = y[0];
        return (
          <PieChart>
            <Pie
              data={spec.data}
              dataKey={chartNumberKey(value.field)}
              nameKey={x.field}
              name={encodingLabel(value)}
              cx="50%"
              cy="50%"
              outerRadius={80}
              label={({ name, percent }) =>
                `${name}: ${(percent * 100).toFixed(0)}%`
              }
            >
              {spec.data.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={palette[index % palette.length]}
                />
              ))}
            </Pie>
            {tooltip}
            <Legend />
          </PieChart>
        );
      }

      case "scatter": {
        const value = y[0];
        return (
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              type="number"
              dataKey={chartNumberKey(x.field)}
              name={encodingLabel(x)}
              tick={{ fontSize: 12 }}
              className="stroke-muted-foreground"
            />
            <YAxis
              type="number"
              dataKey={chartNumberKey(value.field)}
              name={encodingLabel(value)}
              tick={{ fontSize: 12 }}
              tickFormatter={(axisValue) =>
                formatChartValue(axisValue, value.format, locale)
              }
              className="stroke-muted-foreground"
            />
            {tooltip}
            <Legend />
            <Scatter
              name={encodingLabel(value)}
              data={spec.data}
              fill={palette[0]}
            />
          </ScatterChart>
        );
      }
    }
  };

  return (
    <figure className="receiptbi-chart mt-4 bg-card p-4" aria-labelledby={`${chartId}-title`}>
      <figcaption
        id={`${chartId}-title`}
        className="mb-3 flex items-center justify-between gap-3"
      >
        <span
          className={
            spec.title ? "text-sm font-medium text-foreground" : "sr-only"
          }
        >
          {spec.title || t("defaultTitle")}
        </span>
        <span
          className="flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5"
          role="group"
          aria-label={t("switchTypeAria")}
        >
          {TYPE_OPTIONS_BASE.map(({ value, Icon }) => {
            const active = chartType === value;
            const label = typeLabels[value];
            return (
              <button
                key={value}
                type="button"
                title={label}
                aria-label={label}
                aria-pressed={active}
                onClick={() => setTypeOverride(value)}
                className={`flex h-6 w-6 items-center justify-center transition-colors ${
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon size={13} />
              </button>
            );
          })}
        </span>
      </figcaption>
      <div className="h-64" role="img" aria-label={summary}>
        <ChartViewport>
          {renderChart()}
        </ChartViewport>
      </div>
      <table className="sr-only">
        <caption>{summary}</caption>
        <thead>
          <tr>
            <th scope="col">{encodingLabel(x)}</th>
            {y.map((encoding) => (
              <th key={encoding.field} scope="col">
                {encodingLabel(encoding)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.data.map((row, rowIndex) => (
            <tr key={rowIndex}>
              <th scope="row">{String(row[x.field] ?? "—")}</th>
              {y.map((encoding) => (
                <td key={encoding.field}>
                  {formatChartValue(row[encoding.field], encoding.format, locale)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
