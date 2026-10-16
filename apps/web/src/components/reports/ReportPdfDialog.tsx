"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FileText, Loader2, Printer, Search, X } from "lucide-react";
import type { ReportDocument } from "@/lib/reports";
import { cn } from "@/lib/utils";

/** Select logical report pages, not physical sheets produced by the print system. */
export function ReportPdfDialog({ report, currentPageId, selectedIds, busy, error, onSelection, onExport, onClose }: {
  report: ReportDocument; currentPageId: string; selectedIds: readonly string[]; busy: boolean; error: string | null;
  onSelection: (ids: string[]) => void; onExport: () => void; onClose: () => void;
}) {
  const t = useTranslations("reportPdf"), locale = useLocale();
  const titleId = useId(), descriptionId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const composing = useRef(false);
  const [query, setQuery] = useState("");
  const pages = [...report.pages].sort((left, right) => left.order_index - right.order_index);
  const selected = new Set(selectedIds);
  const count = pages.filter(page => selected.has(page.id)).length;
  const needle = query.trim().toLocaleLowerCase(locale);
  const visible = pages.flatMap((page, index) => !needle || `${index + 1} ${page.title}`.toLocaleLowerCase(locale).includes(needle) ? [{ page, index }] : []);
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;
    element?.showModal();
    element?.querySelector<HTMLInputElement>('input[type="checkbox"]:checked')?.focus();
    return () => {
      if (element?.open) element.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  const choose = (ids: string[]) => { if (!busy) onSelection(ids); };
  const close = () => { if (!busy && !composing.current) onClose(); };
  return <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
    className="report-screen-view m-auto max-h-[90dvh] w-[min(620px,96vw)] max-w-none overflow-hidden border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/40"
    onCancel={(event) => { event.preventDefault(); close(); }}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || composing.current) {
        if (event.key === "Escape" || event.key === "Enter") event.preventDefault();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && ["s", "p"].includes(event.key.toLowerCase())) event.preventDefault();
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.type === "search") event.preventDefault();
    }}>
    <form className="flex max-h-[90dvh] min-h-0 flex-col" aria-busy={busy} onSubmit={(event) => {
      event.preventDefault();
      if (!busy && !composing.current && count) onExport();
    }}>
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div className="min-w-0"><h2 id={titleId} className="flex items-center gap-2 text-sm font-semibold"><FileText size={17} className="shrink-0 text-primary" />{t("title")}</h2>
          <p className="mt-1 truncate text-xs text-muted-foreground">{report.title}</p></div>
        <button type="button" disabled={busy} onClick={close} aria-label={t("close")} className="inline-flex h-8 w-8 shrink-0 items-center justify-center hover:bg-muted disabled:opacity-40"><X size={16} /></button>
      </header>
      <div className="shrink-0 border-b border-border px-5 py-3">
        <p id={descriptionId} className="text-xs leading-5 text-muted-foreground">{t("description")}</p>
        <div role="group" aria-label={t("quickSelection")} className="mt-2 flex flex-wrap items-center gap-4 text-xs font-medium">
          <button type="button" disabled={busy} onClick={() => choose(pages.map(page => page.id))} className="min-h-8 text-primary disabled:opacity-40">{t("all")}</button>
          <button type="button" disabled={busy || !pages.some(page => page.id === currentPageId)} onClick={() => choose([currentPageId])} className="min-h-8 text-primary disabled:opacity-40">{t("current")}</button>
          <button type="button" disabled={busy || !count} onClick={() => choose([])} className="min-h-8 text-muted-foreground disabled:opacity-40">{t("clear")}</button>
        </div>
        {pages.length > 8 && <label className="mt-2 flex items-center gap-2 border border-input px-2.5 text-muted-foreground">
          <Search size={14} className="shrink-0" /><input type="search" value={query} maxLength={256} disabled={busy} aria-label={t("search")} placeholder={t("search")}
            onChange={(event) => setQuery(event.target.value)} className="h-9 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none" />
        </label>}
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        <ul aria-label={t("pages")} className="px-3 py-2">
          {visible.map(({ page, index }) => <li key={page.id}>
            <label className={cn("flex min-h-16 items-center gap-3 border-l-2 px-3 py-3", selected.has(page.id) ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted/50", busy && "opacity-60")}>
              <input type="checkbox" checked={selected.has(page.id)} disabled={busy} aria-label={t("page", { number: index + 1, title: page.title })}
                onChange={(event) => choose(event.target.checked ? [...selectedIds, page.id] : selectedIds.filter(id => id !== page.id))}
                className="h-4 w-4 shrink-0 accent-primary" />
              <span aria-hidden="true" className="text-xs tabular-nums text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
              <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium [overflow-wrap:anywhere]">{page.title}</span>
                <span className="mt-1 block text-[11px] text-muted-foreground">{t("contents", { count: page.blocks.length })}</span></span>
              {page.id === currentPageId && <span className="shrink-0 text-[10px] text-muted-foreground">{t("currentBadge")}</span>}
            </label>
          </li>)}
        </ul>
        {!visible.length && <p className="px-5 py-8 text-center text-xs text-muted-foreground">{t("noMatches")}</p>}
      </div>
      <footer className="shrink-0 border-t border-border px-5 py-4">
        {error && <p role="alert" className="mb-3 text-xs leading-5 text-destructive">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" aria-live="polite" className="text-xs text-muted-foreground">{busy ? t("preparing") : t("selected", { count })}</p>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" disabled={busy} onClick={close} className="h-9 px-3 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40">{t("cancel")}</button>
            <button type="submit" disabled={busy || !count} className="inline-flex min-h-9 items-center gap-2 bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}{t("export")}</button>
          </div>
        </div>
      </footer>
    </form>
  </dialog>;
}
