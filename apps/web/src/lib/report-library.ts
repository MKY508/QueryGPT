import type { ReportStatus } from "./reports";

export const REPORT_LIBRARY_PAGE_SIZE = 24;
export const REPORT_LIBRARY_SEARCH_LIMIT = 200;
export type ReportLibrarySort = "updated" | "created" | "title";
export interface ReportLibraryView {
  search: string;
  sort: ReportLibrarySort;
  status: ReportStatus | "all";
  page: number;
}

export function readReportLibraryView(params: Pick<URLSearchParams, "get">): ReportLibraryView {
  const sort = params.get("sort");
  const status = params.get("status");
  const rawPage = params.get("page") || "1";
  const page = /^[1-9]\d{0,5}$/.test(rawPage) ? Number(rawPage) : 1;
  return {
    search: (params.get("q") || "").slice(0, REPORT_LIBRARY_SEARCH_LIMIT),
    sort: sort === "created" || sort === "title" ? sort : "updated",
    status: status === "draft" || status === "published" || status === "archived" ? status : "all",
    page,
  };
}

/** Only library controls cross the index/editor boundary, never a return URL. */
export function writeReportLibraryView(params: URLSearchParams, view: ReportLibraryView): void {
  for (const key of ["q", "sort", "status", "page"]) params.delete(key);
  if (view.search.trim()) params.set("q", view.search.slice(0, REPORT_LIBRARY_SEARCH_LIMIT));
  if (view.sort !== "updated") params.set("sort", view.sort);
  if (view.status !== "all") params.set("status", view.status);
  if (view.page > 1) params.set("page", String(view.page));
}
