"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

import type { ChartDataPoint } from "@/lib/types/api";

interface ChartDisplayProps {
  type: "bar" | "line" | "pie" | "area";
  data: ChartDataPoint[];
  xKey?: string;
  yKey?: string;
  title?: string;
}

const COLORS = [
  "#3b82f6", // blue
  "#10b981", // green
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
];

export function ChartDisplay({
  type,
  data,
  xKey = "name",
  yKey = "value",
  title,
}: ChartDisplayProps) {
  // 自动检测数据键
  const keys = useMemo(() => {
    if (!data || data.length === 0) return { x: xKey, y: yKey, allNumberKeys: [] };

    const firstItem = data[0];
    if (!firstItem || typeof firstItem !== "object") {
      return { x: xKey, y: yKey, allNumberKeys: [] };
    }
    const allKeys = Object.keys(firstItem);

    // 尝试找到合适的 x 和 y 键
    const stringKeys = allKeys.filter(
      (k) => typeof firstItem[k] === "string"
    );
    const numberKeys = allKeys.filter(
      (k) => typeof firstItem[k] === "number"
    );

    return {
      x: stringKeys[0] || xKey,
      y: numberKeys[0] || yKey,
      allNumberKeys: numberKeys,
    };
  }, [data, xKey, yKey]);

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 bg-secondary rounded-lg text-muted-foreground">
        暂无数据
      </div>
    );
  }

  const renderChart = () => {
    switch (type) {
      case "bar":
        return (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey={keys.x}
              tick={{ fontSize: 12 }}
              className="stroke-muted-foreground"
            />
            <YAxis tick={{ fontSize: 12 }} className="stroke-muted-foreground" />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                color: "hsl(var(--foreground))",
              }}
            />
            <Legend />
            {keys.allNumberKeys?.map((key, index) => (
              <Bar
                key={key}
                dataKey={key}
                fill={COLORS[index % COLORS.length]}
                radius={[4, 4, 0, 0]}
              />
            )) || <Bar dataKey={keys.y} fill={COLORS[0]} radius={[4, 4, 0, 0]} />}
          </BarChart>
        );

      case "line":
        return (
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey={keys.x}
              tick={{ fontSize: 12 }}
              className="stroke-muted-foreground"
            />
            <YAxis tick={{ fontSize: 12 }} className="stroke-muted-foreground" />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                color: "hsl(var(--foreground))",
              }}
            />
            <Legend />
            {keys.allNumberKeys?.map((key, index) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={COLORS[index % COLORS.length]}
                strokeWidth={2}
                dot={{ fill: COLORS[index % COLORS.length], strokeWidth: 2 }}
              />
            )) || (
              <Line
                type="monotone"
                dataKey={keys.y}
                stroke={COLORS[0]}
                strokeWidth={2}
              />
            )}
          </LineChart>
        );

      case "area":
        return (
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey={keys.x}
              tick={{ fontSize: 12 }}
              className="stroke-muted-foreground"
            />
            <YAxis tick={{ fontSize: 12 }} className="stroke-muted-foreground" />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                color: "hsl(var(--foreground))",
              }}
            />
            <Legend />
            {keys.allNumberKeys?.map((key, index) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stroke={COLORS[index % COLORS.length]}
                fill={COLORS[index % COLORS.length]}
                fillOpacity={0.2}
                strokeWidth={2}
              />
            )) || (
              <Area
                type="monotone"
                dataKey={keys.y}
                stroke={COLORS[0]}
                fill={COLORS[0]}
                fillOpacity={0.2}
                strokeWidth={2}
              />
            )}
          </AreaChart>
        );

      case "pie":
        return (
          <PieChart>
            <Pie
              data={data}
              dataKey={keys.y}
              nameKey={keys.x}
              cx="50%"
              cy="50%"
              outerRadius={80}
              label={({ name, percent }) =>
                `${name}: ${(percent * 100).toFixed(0)}%`
              }
            >
              {data.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={COLORS[index % COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                color: "hsl(var(--foreground))",
              }}
            />
            <Legend />
          </PieChart>
        );

      default:
        return (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey={keys.x} tick={{ fontSize: 12 }} className="stroke-muted-foreground" />
            <YAxis tick={{ fontSize: 12 }} className="stroke-muted-foreground" />
            <Tooltip />
            <Bar dataKey={keys.y} fill={COLORS[0]} />
          </BarChart>
        );
    }
  };

  return (
    <div className="mt-4 p-4 bg-card rounded-lg border border-border">
      {title && (
        <h4 className="text-sm font-medium text-foreground mb-3">{title}</h4>
      )}
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
