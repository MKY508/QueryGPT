"use client";

import { useState, useMemo, useId } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronUp, ChevronDown, Download, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { dataColumns, downloadCsv } from "@/lib/csv";
import { compareNumericValues, isNumericCell } from "@/lib/numeric-values";
import { dataCellText, dataCellValue, sortTableRows } from "@/lib/tabular-data";
import { DataViewDialog, type DataViewSnapshot } from "@/components/data/DataViewDialog";

import type { DataRow } from "@/lib/types/api";

interface DataTableProps {
  data: DataRow[];
  title?: string;
  maxRows?: number;
}

type SortDirection = "asc" | "desc" | null;

export function DataTable({ data, title, maxRows = 100 }: DataTableProps) {
  const t = useTranslations("assistant");
  const tChart = useTranslations("chartDisplay");
  const tData = useTranslations("dataView");
  const locale = useLocale();
  const titleId = useId();
  const tableId = useId();
  const [dataView, setDataView] = useState<DataViewSnapshot | null>(null);
  const [exportError, setExportError] = useState(false);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // 获取列名
  const columns = useMemo(() => dataColumns(data ?? []), [data]);

  // 排序数据
  const sortedData = useMemo(() => {
    return sortTableRows(data ?? [], sortColumn && sortDirection ? { column: sortColumn, direction: sortDirection } : null, locale);
  }, [data, sortColumn, sortDirection, locale]);

  const previewLimit = Number.isNaN(maxRows) ? 100 : Math.max(0, Math.floor(maxRows));
  const visibleRows = Math.min(sortedData?.length || 0, previewLimit);
  const totalPages = Math.ceil(visibleRows / pageSize);
  const page = Math.min(currentPage, Math.max(1, totalPages));

  // 分页数据
  const paginatedData = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedData?.slice(start, Math.min(start + pageSize, visibleRows)) || [];
  }, [sortedData, page, visibleRows]);

  // 处理排序
  const handleSort = (column: string) => {
    setCurrentPage(1);
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

    setExportError(false);
    try { downloadCsv(sortedData, `query_result_${Date.now()}.csv`, columns); }
    catch { setExportError(true); }
  };

  if (!data || data.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 bg-card rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-secondary border-b border-border">
        <div className="text-sm text-foreground">
          <span id={titleId}>{title || t("queryResult")}</span>
          <span className="text-muted-foreground ml-2">({t("rows", { count: data.length })})</span>
          {visibleRows < data.length && <span className="ml-2 text-xs text-muted-foreground">{tData("previewRows", { count: visibleRows, total: data.length })}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
        <button type="button" aria-label={tData("openFor", { title: title || t("queryResult") })}
          onClick={() => setDataView({ title: title || t("queryResult"), rows: structuredClone(data),
            sort: sortColumn && sortDirection ? { column: sortColumn, direction: sortDirection } : null })}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"><Table2 size={14} />{tData("open")}</button>
        <button
          type="button"
          onClick={exportCSV}
          className="flex items-center gap-1 px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted rounded-lg transition-colors"
        >
          <Download size={14} />
          {t("exportCsv")}
        </button>
        </div>
      </div>

      {exportError && <p role="alert" className="px-4 py-2 text-sm text-destructive">{tData("exportError")}</p>}

      {/* Table */}
      <div role="region" aria-labelledby={titleId} tabIndex={0}
        className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40">
        <table id={tableId} aria-labelledby={titleId} className="w-full text-sm">
          <thead>
            <tr className="bg-secondary border-b border-border">
              {columns.map((col) => (
                <th
                  key={col}
                  scope="col"
                  aria-sort={
                    sortColumn === col && sortDirection
                      ? sortDirection === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                  className="p-0 text-left font-medium text-foreground whitespace-nowrap"
                >
                  <button
                    type="button"
                    onClick={() => handleSort(col)}
                    className="flex w-full items-center gap-1 px-4 py-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
                  >
                    {col}
                    {sortColumn === col && (
                      sortDirection === "asc" ? (
                        <ChevronUp size={14} className="text-primary" />
                      ) : (
                        <ChevronDown size={14} className="text-primary" />
                      )
                    )}
                  </button>
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
                {columns.map((col) => {
                  const value = dataCellValue(row, col);
                  const isNumber = isNumericCell(value);
                  const negative = isNumber && compareNumericValues(value, 0) === -1;
                  return (
                    <td
                      key={col}
                      className={cn(
                        "px-4 py-2.5 whitespace-nowrap max-w-xs truncate",
                        isNumber && "tabular-nums",
                        negative
                          ? "font-medium text-destructive"
                          : "text-muted-foreground"
                      )}
                      title={dataCellText(value)}
                    >
                      {value === null || value === undefined ? (
                        <span className="text-muted-foreground/50" aria-label={tChart("nullValue")}>—</span>
                      ) : (
                        dataCellText(value)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-secondary border-t border-border">
          <div role="status" aria-atomic="true" className="text-sm text-muted-foreground">
            {t("page", { current: page, total: totalPages })}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              aria-controls={tableId}
              onClick={() => setCurrentPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="min-h-11 px-3 py-1 text-sm border border-border rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t("prevPage")}
            </button>
            <button
              type="button"
              aria-controls={tableId}
              onClick={() => setCurrentPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="min-h-11 px-3 py-1 text-sm border border-border rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t("nextPage")}
            </button>
          </div>
        </div>
      )}
      {dataView && <DataViewDialog snapshot={dataView} onClose={() => setDataView(null)} />}
    </div>
  );
}
