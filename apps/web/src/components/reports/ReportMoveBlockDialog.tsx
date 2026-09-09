"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, FileText } from "lucide-react";
import { TaskDialog } from "@/components/ui/TaskDialog";
import { SearchField } from "@/components/ui/SearchField";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import type { ReportDocument } from "@/lib/reports";
import { reportBlockMoveImpact } from "@/lib/report-page-editing";

interface ReportMoveProps {
  report: ReportDocument; blockId: string; disabled: boolean;
  onMove: (pageId: string) => void; onClose: () => void;
}

export function ReportMoveBlockDialog(props: ReportMoveProps) {
  return <ReportMoveSession key={JSON.stringify([props.report.project_id, props.report.id, props.blockId])} {...props} />;
}

function ReportMoveSession({ report, blockId, disabled, onMove, onClose }: ReportMoveProps) {
  const t = useTranslations("reportMove");
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const source = report.pages.find((page) => page.blocks.some((block) => block.id === blockId));
  const block = source?.blocks.find((block) => block.id === blockId);
  const pages = [...report.pages].sort((a, b) => a.order_index - b.order_index);
  const matches = pages.filter((page) => page.id !== source?.id && page.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const impact = reportBlockMoveImpact(report, blockId);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    search.current?.focus();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return <TaskDialog dialogRef={dialog} writingRef={{ current: false }} busy={false} size="compact" title={t("title")} name={`${block?.title || t("untitled")} · ${source?.title || ""}`} closeLabel={t("close")} onClose={onClose}>
    <SearchField inputRef={search} label={t("search")} clearLabel={t("clearSearch")} className="mx-5 my-4 shrink-0"
        value={query} onChange={setQuery}
        onKeyDown={(event) => { if (event.key === "ArrowDown" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
          event.preventDefault(); dialog.current?.querySelector<HTMLButtonElement>("[data-move-destination]")?.focus();
        } }} />
    {(impact.hasPageLinks || impact.changesPageFilter) && <p className="mx-5 mb-3 text-xs leading-relaxed text-muted-foreground">
      {impact.hasPageLinks ? t("linksHint") : t("filterHint")}
    </p>}
    <div className="max-h-[60vh] min-h-0 overflow-y-auto px-2 pb-2" aria-label={t("destinations")}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.metaKey || event.ctrlKey || event.altKey) return;
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (!buttons.length || index < 0) return;
        event.preventDefault();
        buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length].focus();
      }}>
      {matches.map((page) => <Button variant="ghost" size="md" key={page.id} type="button" data-move-destination disabled={disabled || !block}
        onClick={() => onMove(page.id)} aria-label={t("moveTo", { title: page.title })}
        className="group flex h-auto min-h-16 w-full items-center gap-3 px-3 py-3 text-left hover:bg-primary/5 focus-visible:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary">
        <span aria-hidden="true" className="flex h-9 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground"><FileText size={16} /></span>
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{page.title}</span>
          <span className="mt-1 block text-[11px] text-muted-foreground">{t("pageDetail", { number: pages.indexOf(page) + 1, count: page.blocks.length })}</span></span>
        <ArrowUpRight size={15} className="shrink-0 text-muted-foreground group-hover:text-primary" />
      </Button>)}
      {!matches.length && <p className="px-3 py-7 text-center text-sm text-muted-foreground">{t("noMatches")}</p>}
    </div>
  </TaskDialog>;
}
