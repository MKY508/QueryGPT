"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/SearchField";
import { listReportAnalysisRuns } from "@/lib/reports";
import type { AnalysisHistoryItem, AnalysisHistoryPage } from "@/lib/types/api";

export interface InvestigationLibraryView { search: string; page: number }

export function InvestigationLibrary({ projectId, view, onViewChange, initialRunId, onSelect, searchInputRef, selectedCounts, activeRunId }: {
  projectId: string;
  view: InvestigationLibraryView;
  onViewChange: (view: InvestigationLibraryView) => void;
  initialRunId?: string;
  onSelect: (run: AnalysisHistoryItem, opener?: HTMLButtonElement) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  selectedCounts: ReadonlyMap<string, number>;
  activeRunId?: string;
}) {
  const t = useTranslations("investigationPicker");
  const locale = useLocale();
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    key: string; page?: AnalysisHistoryPage; error?: boolean;
  } | null>(null);
  const [searchText, setSearchText] = useState(view.search);
  const searchRef = searchInputRef;
  const listRef = useRef<HTMLOListElement>(null);
  const key = JSON.stringify([projectId, view.search, view.page, initialRunId, retry]);
  const pending = result?.key !== key;
  const page = pending ? undefined : result?.page;
  const failed = !pending && result?.error;

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void listReportAnalysisRuns(projectId, {
        search: view.search, page: view.page, currentRunId: initialRunId,
      }, controller.signal).then((next) => {
        if (controller.signal.aborted) return;
        setResult({ key, page: next });
        const initial = initialRunId && next.items.find((run) => run.id === initialRunId);
        if (initial) onSelect(initial);
      }).catch(() => {
        if (!controller.signal.aborted) setResult({ key, error: true });
      });
    }, view.search ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [projectId, view.search, view.page, initialRunId, key, onSelect]);

  const clearSearch = () => {
    setSearchText("");
    onViewChange({ search: "", page: 1 });
    searchRef.current?.focus();
  };
  const changePage = (direction: number) => {
    if (!page) return;
    const next = page.page + direction;
    if (next >= 1 && next <= page.page_count) onViewChange({ ...view, page: next });
  };
  const date = (value: string) => {
    const stamp = new Date(value);
    return Number.isNaN(stamp.valueOf()) ? t("recent") : new Intl.DateTimeFormat(locale, {
      year: "numeric", month: "short", day: "numeric",
    }).format(stamp);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={t("libraryLabel")}>
      <div className="shrink-0 border-b border-border px-5 py-4">
          <SearchField inputRef={searchRef} value={searchText} maxLength={512}
            label={t("searchPlaceholder")} clearLabel={t("clearSearch")}
            onChange={setSearchText}
            onQueryChange={(search) => onViewChange({ search, page: 1 })}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === "ArrowDown") {
                const first = listRef.current?.querySelector("button");
                if (first) { event.preventDefault(); first.focus(); }
              }
            }}
          />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={pending}>
        {pending && <p role="status" className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground"><Loader2 size={16} className="animate-spin" />{t("loading")}</p>}
        {failed && <div className="px-5 py-10"><p role="alert" className="text-sm text-destructive">{t("loadListError")}</p><Button variant="ghost" size="sm" onClick={() => setRetry((value) => value + 1)} className="mt-3 text-primary">{t("retry")}</Button></div>}
        {page && initialRunId && page.current_run_id !== initialRunId && <p role="status" className="border-b border-border px-5 py-3 text-xs text-muted-foreground">{t("initialUnavailable")}</p>}
        {page && page.count === 0 && <div className="px-8 py-16 text-center">
          <p className="text-sm font-medium">{view.search ? t("noMatches") : t("emptyTitle")}</p>
          {view.search ? <Button variant="ghost" size="sm" onClick={clearSearch} className="mt-3 text-primary">{t("clearSearch")}</Button> : <p className="mt-2 text-xs leading-5 text-muted-foreground">{t("emptyDesc")}</p>}
        </div>}
        <ol ref={listRef} className="divide-y divide-border" onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          const rows = Array.from(listRef.current?.querySelectorAll("button") ?? []);
          const index = rows.indexOf(event.target as HTMLButtonElement);
          if (index < 0) return;
          let next: number;
          if (event.key === "ArrowDown") next = Math.min(index + 1, rows.length - 1);
          else if (event.key === "ArrowUp") next = index - 1;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = rows.length - 1;
          else return;
          event.preventDefault();
          if (next < 0) searchRef.current?.focus(); else rows[next]?.focus();
        }}>
          {page?.items.map((run) => <li key={run.id}>
            <button type="button" onClick={(event) => onSelect(run, event.currentTarget)} aria-current={activeRunId === run.id ? "true" : undefined}
              className="group flex w-full items-center gap-4 border-l-2 border-transparent px-5 py-4 text-left transition-colors hover:bg-primary/5 aria-[current=true]:border-primary aria-[current=true]:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold leading-5">{run.report.title?.trim() || run.query || t("unnamedRun")}</span>
                <span className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground">{run.report.summary || run.query}</span>
                <span className="mt-2 block text-[10px] tabular-nums text-muted-foreground">{date(run.updated_at)}</span>
                {!!selectedCounts.get(run.id) && <span className="mt-2 inline-block bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary">{t("runSelected", { count: selectedCounts.get(run.id)! })}</span>}
              </span>
              <ArrowRight size={15} aria-hidden="true" className="shrink-0 text-muted-foreground group-hover:text-primary" />
            </button>
          </li>)}
        </ol>
      </div>
      <nav aria-label={t("pagination")} className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-t border-border px-5">
        <span aria-live="polite" className="text-[11px] tabular-nums text-muted-foreground">{page ? t("pageCount", { page: page.page, pages: page.page_count, count: page.count }) : ""}</span>
        <div className="flex gap-1">
          <Button variant="outline" size="icon" aria-label={t("previousPage")} aria-disabled={!page || page.page <= 1} onClick={() => changePage(-1)} className="aria-disabled:opacity-35"><ChevronLeft size={15} /></Button>
          <Button variant="outline" size="icon" aria-label={t("nextPage")} aria-disabled={!page || page.page >= page.page_count} onClick={() => changePage(1)} className="aria-disabled:opacity-35"><ChevronRight size={15} /></Button>
        </div>
      </nav>
    </section>
  );
}
