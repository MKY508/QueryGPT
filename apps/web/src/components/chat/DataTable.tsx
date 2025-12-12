"use client";

import { useState, useMemo } from "react";
import { ChevronUp, ChevronDown, Download } from "lucide-react";
import { cn } from "@/lib/utils";

import type { DataRow } from "@/lib/types/api";

interface DataTableProps {
  data: DataRow[];
  title?: string;
  maxRows?: number;
}

type SortDirection = "asc" | "desc" | null;

export function DataTable({ data, title, _maxRows = 100 }: DataTableProps) {
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // 获取列名
  const columns = useMemo(() => {
    if (!data || data.length === 0) return [];
    return Object.keys(data[0]);
  }, [data]);

  // 排序数据
  const sortedData = useMemo(() => {
    if (!data || !sortColumn || !sortDirection) return data;

    return [...data].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];

      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
      }

      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      return sortDirection === "asc"
        ? aStr.localeCompare(bStr)
        : bStr.localeCompare(aStr);
    });
  }, [data, sortColumn, sortDirection]);

  // 分页数据
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedData?.slice(start, start + pageSize) || [];
  }, [sortedData, currentPage]);

  const totalPages = Math.ceil((sortedData?.length || 0) / pageSize);

  // 处理排序
  const handleSort = (column: string) => {
    if (sortColumn === column) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else if (sortDirection === "desc") {
        setSortColumn(null);
        setSortDirection(null);
      }
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  // 导出 CSV
  const exportCSV = () => {
    if (!data || data.length === 0) return;

    const headers = columns.join(",");
    const rows = data.map((row) =>
      columns
        .map((col) => {
          const val = row[col];
          if (val === null || val === undefined) return "";
          if (typeof val === "string" && val.includes(",")) {
            return `"${val.replace(/"/g, '""')}"`;
          }
          return String(val);
        })
        .join(",")
    );

    const csv = [headers, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `query_result_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!data || data.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 bg-card rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-secondary border-b border-border">
        <div className="text-sm text-foreground">
          {title || `查询结果`}
          <span className="text-muted-foreground ml-2">({data.length} 行)</span>
        </div>
        <button
          onClick={exportCSV}
          className="flex items-center gap-1 px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted rounded-lg transition-colors"
        >
          <Download size={14} />
          导出 CSV
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary border-b border-border">
              {columns.map((col) => (
                <th
                  key={col}
                  onClick={() => handleSort(col)}
                  className="px-4 py-3 text-left font-medium text-foreground cursor-pointer hover:bg-muted transition-colors whitespace-nowrap"
                >
                  <div className="flex items-center gap-1">
                    {col}
                    {sortColumn === col && (
                      sortDirection === "asc" ? (
                        <ChevronUp size={14} className="text-primary" />
                      ) : (
                        <ChevronDown size={14} className="text-primary" />
                      )
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedData.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className={cn(
                  "border-b border-border/50 hover:bg-muted/50 transition-colors",
                  rowIndex % 2 === 0 ? "bg-background" : "bg-secondary/30"
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col}
                    className="px-4 py-2.5 text-muted-foreground whitespace-nowrap max-w-xs truncate"
                    title={String(row[col] ?? "")}
                  >
                    {row[col] === null || row[col] === undefined ? (
                      <span className="text-muted-foreground/50 italic">NULL</span>
                    ) : (
                      String(row[col])
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 bg-secondary border-t border-border">
          <div className="text-sm text-muted-foreground">
            第 {currentPage} / {totalPages} 页
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 text-sm border border-border rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              上一页
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 text-sm border border-border rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
