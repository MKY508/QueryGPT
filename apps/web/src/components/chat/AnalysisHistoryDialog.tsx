"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight, History, Loader2, LocateFixed, Plus, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { AnalysisHistoryItem } from "@/lib/types/api";
import { analysisHistoryTitle, HISTORY_FILTERS, HISTORY_PAGE_SIZE, HISTORY_STATE_LABELS, type HistoryFilter } from "@/lib/analysis-history";
import { useModalFocus } from "@/lib/use-modal-focus";
import { TaskDialog } from "@/components/ui/TaskDialog";
import { SearchField } from "@/components/ui/SearchField";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { textSearchExcerpt } from "@/lib/text-search-excerpt";
import { useAnalysisHistoryPage } from "./useAnalysisHistoryPage";

export interface AnalysisHistoryDialogProps {
  open: boolean;
  projectId: string | null;
  projectName: string;
  currentAnalysisRunId?: string | null;
  disabled?: boolean;
  onClose: () => void;
  onOpenReport: (conversationId: string, analysisRunId: string) => void;
  onNewAnalysis: () => void;
}

// PatternFly primary-detail: selecting a row previews it; only the explicit
// action changes the investigation. The desktop directory stays visible.
export function AnalysisHistoryDialog(props: AnalysisHistoryDialogProps) {
  return <HistorySession key={props.projectId || "no-project"} {...props} />;
}

function HistorySession({ open, projectId, projectName, currentAnalysisRunId = null, disabled = false,
  onClose, onOpenReport, onNewAnalysis }: AnalysisHistoryDialogProps) {
  const t = useTranslations("projectReports"), th = useTranslations("analysisHistory"), locale = useLocale();
  const id = useId();
  const [search, setSearch] = useState(""), [filter, setFilter] = useState<HistoryFilter>("all");
  const [requestedPage, setPage] = useState(1), [composing, setComposing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pagePreview, setPagePreview] = useState<{ page: number; fromPage: number; position: number; count: number; direction: -1 | 1; from: AnalysisHistoryItem; scope: string } | null>(null);
  const [previousCurrent, setPreviousCurrent] = useState(currentAnalysisRunId);
  const currentChanged = previousCurrent !== currentAnalysisRunId;
  if (currentChanged) { setPreviousCurrent(currentAnalysisRunId); setPage(1); setSelectedId(null); }
  const resource = useAnalysisHistoryPage(projectId, currentAnalysisRunId,
    { search, filter, page: currentChanged ? 1 : requestedPage }, open, composing);
  const history = resource.data, runs = history?.items ?? [];
  const page = history?.page ?? requestedPage, count = history?.count ?? 0;
  const pageCount = history?.page_count ?? Math.max(1, requestedPage);
  const scope = JSON.stringify([search, filter, currentAnalysisRunId]);
  const crossing = pagePreview && open && !currentChanged && pagePreview.scope === scope && selectedId === pagePreview.from.id ? pagePreview : null;
  if (pagePreview && !crossing) setPagePreview(null);
  if (history && !resource.isPlaceholderData && !currentChanged && page !== requestedPage) setPage(page);
  if (crossing && history && !resource.isPlaceholderData && !resource.isFetching && !resource.isError) {
    const target = crossing.direction < 0 || page < crossing.page ? runs.at(-1) : runs[0];
    setSelectedId(target?.id ?? null); setPagePreview(null);
  }
  const selected = runs.find(run => run.id === selectedId) ?? crossing?.from;
  if (selectedId && !crossing && history && !resource.isPlaceholderData && !resource.isFetching && !selected) setSelectedId(null);
  const selectedIndex = selected ? runs.indexOf(selected) : -1;
  const previewPosition = crossing?.position ?? (selectedIndex < 0 ? 0 : (page - 1) * HISTORY_PAGE_SIZE + selectedIndex + 1);
  const previewCount = crossing?.count ?? count;
  const currentOutside = history?.current_run_id && !runs.some(run => run.id === history.current_run_id);
  const filtered = Boolean(search.trim()) || filter !== "all";
  const excerpt = search.trim() && !resource.isFetching && !resource.isPlaceholderData
    ? textSearchExcerpt(search.trim().split(/\s+/), { before: 20, after: 40 }) : null;
  const dialog = useRef<HTMLDialogElement>(null), searchInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null), detail = useRef<HTMLElement>(null), detailHeading = useRef<HTMLHeadingElement>(null), reader = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<"preview" | "reading" | "pager" | "list" | null>(null), returnId = useRef<string | null>(null);
  const opening = useRef(false);
  const writing = useRef(false), active = useRef(false);
  const lastFocus = useRef<{ node: HTMLElement; inDetail: boolean } | null>(null);
  const date = (value: string) => new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
  const title = (run: AnalysisHistoryItem) => analysisHistoryTitle(run, t("unnamedRun"));
  const state = (run: AnalysisHistoryItem) => t(HISTORY_STATE_LABELS[run.state]);
  const dot = (run: AnalysisHistoryItem) => run.state === "needs_attention" ? "bg-destructive" : run.state === "waiting_confirmation" ? "bg-warning" : "bg-primary";
  const reset = () => { setSearch(""); setFilter("all"); setPage(1); setSelectedId(null); searchInput.current?.focus(); };
  const backToList = () => { returnId.current = selectedId; pendingFocus.current = "list"; if (crossing) setPage(crossing.fromPage); setPagePreview(null); setSelectedId(null); };
  const escape = () => {
    if (selected) backToList();
    else if (search) { setSearch(""); setPage(1); searchInput.current?.focus(); }
    else onClose();
  };
  useModalFocus({ active: open, containerRef: dialog, initialFocusRef: searchInput, onClose: escape });
  useEffect(() => {
    const node = dialog.current;
    active.current = open;
    if (open && node && !node.open) { opening.current = false; node.showModal(); }
    if (!open && node?.open) node.close();
    return () => { active.current = false; if (node?.open) node.close(); };
  }, [open]);
  useLayoutEffect(() => { if (list.current) list.current.scrollTop = 0; }, [page, search, filter]);
  useLayoutEffect(() => { if (reader.current) reader.current.scrollTop = 0; }, [selected?.id]);
  useLayoutEffect(() => {
    if (!open) return;
    const request = pendingFocus.current; pendingFocus.current = null;
    if (request === "list") (rows.current.get(returnId.current || "") ?? searchInput.current)?.focus({ preventScroll: true });
    if ((request === "preview" || request === "reading") && selected && detailHeading.current) {
      // List navigation retains its origin; reading actions focus the title.
      // A focused pager stays in place for repeated keyboard activation.
      const focused = document.activeElement;
      if (request === "reading" || detail.current?.contains(focused)) detailHeading.current.focus({ preventScroll: true });
    }
    const prior = lastFocus.current;
    if (prior && !prior.node.isConnected && document.activeElement === document.body) {
      (selected ? detailHeading.current : searchInput.current)?.focus({ preventScroll: true });
    }
    if (!selected && (detail.current?.contains(document.activeElement)
      || (prior?.inDetail && !prior.node.isConnected && document.activeElement === document.body))) searchInput.current?.focus();
  }, [selected, open, resource.isError]);
  const inspect = (run: AnalysisHistoryItem, reading = false, retainPager = false) => {
    if (resource.isPlaceholderData || resource.isFetching) return;
    pendingFocus.current = retainPager ? "pager" : reading ? "reading" : "preview"; setSelectedId(run.id);
  };
  const browse = (direction: -1 | 1, retainPager: boolean) => {
    if (!selected || crossing || resource.isFetching || resource.isError || resource.isPlaceholderData) return;
    const next = runs[selectedIndex + direction];
    if (next) { inspect(next, true, retainPager); return; }
    const targetPage = page + direction;
    if (targetPage < 1 || targetPage > pageCount) return;
    pendingFocus.current = retainPager ? "pager" : "reading";
    setPagePreview({ page: targetPage, fromPage: page, position: previewPosition, count, direction, from: selected, scope });
    setPage(targetPage);
  };
  const canOpen = selected && !crossing && !disabled && !resource.isFetching && !resource.isError && !resource.isPlaceholderData && Boolean(selected.conversation_id);
  const openSelected = () => {
    if (!selected || !canOpen || opening.current) return;
    opening.current = true;
    if (selected.id !== currentAnalysisRunId) onOpenReport(selected.conversation_id!, selected.id);
    onClose();
  };

  if (!open) return null;
  return <TaskDialog dialogRef={dialog} writingRef={writing} activeRef={active} busy={false} autoFocusClose={false}
    title={th("title")} name={projectName} closeLabel={th("close")} onClose={onClose} onEscape={escape} blockCancel={composing}
    actions={<><Button variant="ghost" size="icon" disabled={resource.isFetching || !projectId} aria-label={th("refresh")} onClick={() => void resource.refetch()}><RefreshCw size={16} className={resource.isFetching ? "animate-spin" : ""} /></Button>
      <Button variant="outline" disabled={disabled} onClick={() => { if (!opening.current && !disabled) { opening.current = true; onNewAnalysis(); } }}><Plus size={15} />{th("new")}</Button></>}>
    <div className="flex min-h-0 flex-1 flex-col" data-history-preview={Boolean(selected)}
    onFocusCapture={event => { if (event.target instanceof HTMLElement) lastFocus.current = { node: event.target, inDetail: Boolean(detail.current?.contains(event.target)) }; }}
    onKeyDown={event => {
      if (composing || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { if (event.key === "Escape") event.preventDefault(); return; }
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault(); if (!event.repeat) { pendingFocus.current = "list"; returnId.current = null; setSelectedId(null); searchInput.current?.focus(); }
      }
    }}>
    {resource.isError && <div role="alert" className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 border-b border-border bg-card px-5 py-2 text-xs leading-5 text-muted-foreground"><p>{t(history ? "refreshError" : "loadError")}</p><Button variant="ghost" disabled={resource.isFetching} onClick={() => void resource.refetch()}>{t("retry")}</Button></div>}
    <div className="flex min-h-0 flex-1">
      <section className="history-directory flex min-h-0 w-[420px] shrink-0 flex-col border-r border-border bg-background" aria-label={t("investigationsAria")}>
        <div className="shrink-0 border-b border-border px-5 pb-3 pt-4"
          onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} onBlur={() => setComposing(false)}>
            <SearchField inputRef={searchInput} label={th("search")} clearLabel={t("clearSearch")} value={search} maxLength={512}
              onChange={value => { setSearch(value); setPage(1); setSelectedId(null); }}
              onKeyDown={event => { if (event.key === "ArrowDown" && !composing && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) { event.preventDefault(); if (runs[0]) rows.current.get(runs[0].id)?.focus(); } }}
              />
          <div className="mt-3 flex items-center justify-between gap-2">
            <select aria-label={t("filterStatus")} value={filter} onChange={event => { setFilter(event.target.value as HistoryFilter); setPage(1); setSelectedId(null); }} className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground">
              {HISTORY_FILTERS.map(value => <option key={value} value={value}>{t(HISTORY_STATE_LABELS[value])}</option>)}
            </select>
            {currentOutside && <Button variant="ghost" onClick={reset} aria-label={t("backToCurrent")}><LocateFixed size={13} />{t("currentBadge")}</Button>}
            {resource.isFetching && <Loader2 size={14} aria-label={t("loadingAria")} className="shrink-0 animate-spin text-primary" />}
          </div>
        </div>
        <ol ref={list} aria-busy={resource.isFetching} className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-2 [scrollbar-width:thin]">
          {runs.map((run, index) => {
            const summaryExcerpt = excerpt?.(run.report.summary || "");
            const snippet = summaryExcerpt || excerpt?.(run.query || "");
            return <li key={run.id}>
            <Button variant="ghost" ref={node => { if (node) rows.current.set(run.id, node); else rows.current.delete(run.id); }} data-analysis-run-id={run.id}
              aria-label={th("previewAria", { title: title(run) })} aria-pressed={run.id === selectedId} aria-controls={`${id}-detail`}
              aria-describedby={`${id}-meta-${index}${snippet ? ` ${id}-match-${index}` : ""}`} aria-current={run.id === history?.current_run_id ? "page" : undefined}
              aria-disabled={resource.isPlaceholderData || resource.isFetching} onClick={() => inspect(run)}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
                if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                  event.preventDefault();
                  const at = event.key === "Home" ? 0 : event.key === "End" ? runs.length - 1 : index + (event.key === "ArrowDown" ? 1 : -1);
                  const next = runs[at];
                  if (next) rows.current.get(next.id)?.focus(); else if (event.key === "ArrowUp") searchInput.current?.focus();
                }
              }} className={cn("group block h-auto w-full whitespace-normal border px-3 py-3 text-left font-normal focus-visible:ring-inset aria-disabled:opacity-50", run.id === selectedId ? "border-primary/25 bg-primary/[0.06]" : "border-transparent")}>
              <span className="block line-clamp-2 break-words text-sm font-semibold leading-6">{title(run)}</span>{" "}
              {snippet ? <span id={`${id}-match-${index}`} className="mt-1 block break-words text-xs leading-5 text-muted-foreground">
                {!summaryExcerpt && <span className="font-medium">{th("question")} · </span>}
                {snippet.before}<mark className="bg-primary/10 font-semibold text-foreground">{snippet.match}</mark>{snippet.after}
              </span> : run.report.summary && <span className="mt-1 block line-clamp-2 break-words text-xs leading-5 text-muted-foreground">{run.report.summary}</span>}{" "}
              <span id={`${id}-meta-${index}`} className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground"><span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", dot(run))} />{state(run)}<span aria-hidden="true">·</span><time dateTime={run.updated_at}>{date(run.updated_at)}</time>{run.id === history?.current_run_id && <span className="ml-auto text-primary">{t("currentBadge")}</span>}</span>
            </Button>
          </li>; })}
          {!runs.length && <li className="px-5 py-10 text-center text-sm text-muted-foreground">
            {resource.isLoading ? <p>{t("loadingAria")}</p> : !resource.isError ? <><p>{t(filtered ? "noMatches" : "noRuns")}</p>{filtered && <Button variant="ghost" onClick={reset} className="mt-3">{t("clearFilters")}</Button>}</> : null}
          </li>}
        </ol>
        <footer className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-t border-border px-5 py-2">
          <span role="status" className="text-xs tabular-nums text-muted-foreground">{count > 0 && t("range", { first: (page - 1) * HISTORY_PAGE_SIZE + 1, last: (page - 1) * HISTORY_PAGE_SIZE + runs.length, count })}</span>
          {pageCount > 1 && <nav aria-label={t("pagination")} className="flex gap-1">
            {([-1, 1] as const).map(direction => { const inactive = resource.isFetching || (direction < 0 ? page <= 1 : !history || page >= pageCount); return <Button variant="ghost" size="icon" key={direction} aria-label={t(direction < 0 ? "previousPage" : "nextPage")} aria-disabled={inactive} onClick={() => { if (!inactive) { setSelectedId(null); setPage(page + direction); } }} className="aria-disabled:opacity-30 aria-disabled:hover:bg-transparent">{direction < 0 ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}</Button>; })}
          </nav>}
        </footer>
      </section>
      <section ref={detail} id={`${id}-detail`} aria-label={th("preview")} className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
        {selected ? <>
          <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-5">
            <Button variant="ghost" onClick={backToList}><ArrowLeft size={14} />{th("back")}</Button>
            <nav aria-label={th("browsePreview")} className="flex items-center gap-1">
              <span className="mr-2 whitespace-nowrap text-xs tabular-nums text-muted-foreground"><span className="sr-only">{th("position", { position: previewPosition, count: previewCount })}</span><span aria-hidden="true">{previewPosition} / {previewCount}</span></span>
              {([-1, 1] as const).map(direction => { const next = runs[selectedIndex + direction]; const hasPage = direction < 0 ? page > 1 : page < pageCount; const inactive = Boolean(crossing) || resource.isFetching || resource.isError || (!next && !hasPage); return <Button variant="ghost" size="icon" key={direction} aria-label={th(direction < 0 ? "previous" : "next")} aria-disabled={inactive} aria-describedby={`${id}-preview-title`} onClick={event => { if (!inactive) browse(direction, document.activeElement === event.currentTarget); }} className="aria-disabled:opacity-30 aria-disabled:hover:bg-transparent">{direction < 0 ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}</Button>; })}
            </nav>
          </div>
          <div ref={reader} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-7 py-6">
            <p className="mb-4 flex items-center gap-2 text-xs font-medium text-muted-foreground"><span aria-hidden="true" className={cn("size-1.5 rounded-full", dot(selected))} />{state(selected)}{selected.id === history?.current_run_id && <span className="ml-auto text-primary">{t("currentBadge")}</span>}</p>
            <h3 id={`${id}-preview-title`} ref={detailHeading} tabIndex={-1} aria-live="polite" aria-atomic="true" className="break-words text-2xl font-semibold leading-snug tracking-tight outline-none">{title(selected)}</h3>
            <dl className="mt-8 space-y-7">
              <div><dt className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{th("question")}</dt><dd className="whitespace-pre-wrap break-words text-sm leading-7">{selected.query || th("noQuestion")}</dd></div>
              <div className="border-t border-border pt-6"><dt className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{th("summary")}</dt><dd className="whitespace-pre-wrap break-words text-sm leading-7">{selected.report.summary?.trim() || th("noSummary")}</dd></div>
            </dl>
            <dl className="mt-7 grid grid-cols-2 gap-4 border-t border-border pt-6 text-xs text-muted-foreground"><div><dt className="mb-2">{th("created")}</dt><dd><time dateTime={selected.created_at}>{date(selected.created_at)}</time></dd></div><div><dt className="mb-2">{th("updated")}</dt><dd><time dateTime={selected.updated_at}>{date(selected.updated_at)}</time></dd></div></dl>
          </div>
          <footer className="shrink-0 border-t border-border px-7 py-4">
            {disabled && <p className="mb-3 text-xs leading-5 text-muted-foreground">{th("waiting")}</p>}
            {!selected.conversation_id && <p className="mb-3 text-xs leading-5 text-muted-foreground">{th("unavailable")}</p>}
            <Button disabled={!canOpen} onClick={openSelected} className="w-full">{th(selected.id === currentAnalysisRunId ? "returnCurrent" : "openAnalysis")}<ArrowUpRight size={16} /></Button>
          </footer>
        </> : <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center"><History size={36} strokeWidth={1.25} className="mb-5 text-primary/60" /><p className="text-lg font-semibold">{th("choose")}</p><p className="mt-3 max-w-60 text-sm leading-6 text-muted-foreground">{th("chooseHint")}</p></div>}
      </section>
    </div>
    </div>
  </TaskDialog>;
}
