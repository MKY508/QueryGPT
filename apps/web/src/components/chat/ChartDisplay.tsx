"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
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

interface ChartDisplayProps {
  type: "bar" | "line" | "pie" | "area";
  data: any[];
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
    if (!data || data.length === 0) return { x: xKey, y: yKey };

    const firstItem = data[0];
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
      <div className="flex items-center justify-center h-48 bg-slate-50 rounded-lg text-slate-400">
        暂无数据
      </div>
    );
  }

  const renderChart = () => {
    switch (type) {
      case "bar":
        return (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey={keys.x}
              tick={{ fontSize: 12 }}
              stroke="#94a3b8"
            />
            <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
            <Tooltip
              contentStyle={{
                backgroundColor: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
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
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey={keys.x}
              tick={{ fontSize: 12 }}
              stroke="#94a3b8"
            />
            <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
            <Tooltip
              contentStyle={{
                backgroundColor: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
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
                backgroundColor: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
              }}
            />
            <Legend />
          </PieChart>
        );

      default:
        return (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey={keys.x} tick={{ fontSize: 12 }} stroke="#94a3b8" />
            <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
            <Tooltip />
            <Bar dataKey={keys.y} fill={COLORS[0]} />
          </BarChart>
        );
    }
  };

  return (
    <div className="mt-4 p-4 bg-white rounded-lg border border-slate-200">
      {title && (
        <h4 className="text-sm font-medium text-slate-700 mb-3">{title}</h4>
      )}
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
