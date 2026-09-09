"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, FileText } from "lucide-react";
import { TaskDialog } from "@/components/ui/TaskDialog";
import { SearchField } from "@/components/ui/SearchField";
import { Button } from "@/components/ui/button";
import { useLocale, useTranslations } from "next-intl";
import type { ReportDocument } from "@/lib/reports";
import { reportSearchIndex, searchReportContent, type ReportSearchEntry } from "@/lib/report-content-search";
import { useModalFocus } from "@/lib/use-modal-focus";

const PAGE_SIZE = 60;
export function ReportFindDialog({ report, query, onQuery, onSelect, onClose }: {
  report: ReportDocument; query: string; onQuery: (query: string) => void;
  onSelect: (target: Pick<ReportSearchEntry, "pageId" | "blockId">) => void; onClose: () => void;
}) {
  const t = useTranslations("reportFind"), locale = useLocale();
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null), results = useRef<HTMLDivElement>(null);
  const writing = useRef(false), active = useRef(false);
  useEffect(() => {
    active.current = true;
    const element = dialog.current; element?.showModal();
    return () => { active.current = false; element?.close(); };
  }, []);
  const scope = JSON.stringify([report.project_id, report.id, query, locale]);
  const [pagination, setPagination] = useState({ scope, limit: PAGE_SIZE });
  if (pagination.scope !== scope) setPagination({ scope, limit: PAGE_SIZE });
  const limit = pagination.scope === scope ? pagination.limit : PAGE_SIZE;
  useLayoutEffect(() => { results.current?.scrollTo?.({ top: 0 }); }, [scope]);
  const index = useMemo(() => reportSearchIndex(report, locale), [report, locale]);
  const matches = useMemo(() => searchReportContent(index, query), [index, query]);
  const visible = matches.slice(0, limit);
  const focusedResult = useRef<HTMLElement | null>(null);
  const reveal = useRef<{ origin: HTMLButtonElement; index: number; matches: typeof matches } | null>(null);
  useLayoutEffect(() => {
    const pending = reveal.current;
    reveal.current = null;
    if (pending && pending.matches === matches && (document.activeElement === pending.origin || document.activeElement === document.body)) {
      const added = results.current?.querySelectorAll<HTMLButtonElement>("button[data-find-result]")[pending.index];
      if (added) { added.focus(); return; }
    }
    if (focusedResult.current && !focusedResult.current.isConnected && document.activeElement === document.body) {
      focusedResult.current = null;
      input.current?.focus({ preventScroll: true });
    }
  });
  const groups = new Map<string, typeof visible>();
  for (const match of visible) {
    const group = groups.get(match.pageId);
    if (group) group.push(match); else groups.set(match.pageId, [match]);
  }
  useModalFocus({ active: true, containerRef: dialog, initialFocusRef: input, onClose });
  const changeQuery = (value: string) => { onQuery(value); };
  const clear = () => { changeQuery(""); input.current?.focus(); };

  return <TaskDialog dialogRef={dialog} writingRef={writing} activeRef={active} busy={false} size="compact" title={t("title")} closeLabel={t("close")} onClose={onClose} onEscape={() => { if (query) clear(); else onClose(); }}>
    <div className="flex min-h-0 flex-col">
      <SearchField inputRef={input} value={query} maxLength={200} label={t("placeholder")} clearLabel={t("clear")} className="mx-5 my-4 shrink-0"
          onChange={changeQuery}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return;
            if (event.key === "ArrowDown") {
              const first = results.current?.querySelector<HTMLButtonElement>("button[data-find-result]");
              if (first) { event.preventDefault(); first.focus(); }
            } else if (event.key === "Enter" && matches[0]) { event.preventDefault(); onSelect(matches[0]); }
          }} />
      <p role="status" className="shrink-0 px-5 pb-3 text-xs text-muted-foreground">{t("count", { count: matches.length })}</p>
      <div ref={results} className="max-h-[60vh] min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border"
        onFocusCapture={(event) => { if (event.target instanceof HTMLElement) focusedResult.current = event.target; }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return;
          const items = Array.from(results.current?.querySelectorAll<HTMLButtonElement>("button[data-find-result]") || []);
          const current = items.indexOf(event.target as HTMLButtonElement);
          if (current < 0) return;
          const next = event.key === "ArrowDown" ? Math.min(current + 1, items.length - 1) : event.key === "ArrowUp" ? current - 1
            : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
          if (next === null) return;
          event.preventDefault();
          if (next < 0) input.current?.focus(); else items[next]?.focus();
        }}>
        {!matches.length && <p className="px-6 py-12 text-center text-sm text-muted-foreground">{t("noMatches")}</p>}
        {[...groups].map(([pageId, group]) => <section key={pageId} aria-label={group[0].pageTitle}>
          <h3 className="sticky top-0 z-10 flex gap-2 border-y border-border bg-muted px-5 py-2 text-xs font-semibold">
            <span className="font-mono text-primary">{String(group[0].pageNumber).padStart(2, "0")}</span>{group[0].pageTitle}
          </h3>
          <ul>{group.map((match) => <li key={JSON.stringify([match.pageId, match.blockId])}>
            <Button variant="ghost" size="md" type="button" data-find-result onClick={() => onSelect(match)}
              aria-label={t("openResult", { title: match.title || t("untitled"), page: match.pageNumber })}
              className="group flex h-auto w-full min-w-0 items-start gap-3 border-b border-border/50 px-5 py-3 text-left hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary">
              <FileText size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{match.title || t("untitled")}</span>
                {match.snippet && <span className="mt-1 block break-words text-xs leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                  {match.snippet.before}<mark className="bg-primary/10 font-semibold text-primary">{match.snippet.match}</mark>{match.snippet.after}
                </span>}
              </span>
              <ArrowUpRight size={14} aria-hidden="true" className="mt-1 shrink-0 text-muted-foreground group-hover:text-primary" />
            </Button>
          </li>)}</ul>
        </section>)}
        {visible.length < matches.length && <Button variant="ghost" size="md" type="button" onClick={(event) => {
          reveal.current = { origin: event.currentTarget, index: visible.length, matches };
          setPagination({ scope, limit: limit + PAGE_SIZE });
        }}
          className="h-auto w-full px-5 py-4 text-xs text-primary hover:bg-primary/5">{t("showMore", { shown: visible.length, total: matches.length })}</Button>}
      </div>
    </div>
  </TaskDialog>;
}
