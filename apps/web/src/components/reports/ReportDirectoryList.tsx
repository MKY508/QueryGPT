"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { BarChart3, CopyPlus, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReportListItem } from "@/lib/reports";

export function ReportDirectoryList({ reports, href, writeDisabled, armedDeleteId, deletingId, onCopy, onDelete }: {
  reports: readonly ReportListItem[];
  href: (report: ReportListItem) => string;
  writeDisabled: boolean; armedDeleteId: string | null; deletingId: string | null;
  onCopy: (report: ReportListItem) => void; onDelete: (report: ReportListItem) => void;
}) {
  const t = useTranslations("reportIndex"), locale = useLocale();
  const dateFormat = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return <ol aria-label={t("title")} className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
    {reports.map(report => {
      const updated = new Date(report.updated_at);
      const armed = armedDeleteId === report.id;
      return <li key={report.id} className="group flex min-h-[88px] items-center gap-4 px-4 hover:bg-muted/30">
        <Link href={href(report)} className="grid min-w-0 flex-1 grid-cols-[36px_minmax(0,1fr)_150px_160px] items-center gap-4 rounded-md py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
          <span aria-hidden="true" className="inline-flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary"><BarChart3 size={17} /></span>
          <span className="min-w-0"><span className="block truncate text-sm font-semibold group-hover:text-primary">{report.title}</span>{" "}
            <span className="mt-1 block truncate text-xs text-muted-foreground">{report.description || t("defaultDescription")}</span></span>{" "}
          <span className="text-xs text-muted-foreground">{t("reportStats", { pages: report.page_count, blocks: report.block_count })}</span>
          <span className="text-right text-xs tabular-nums text-muted-foreground">{Number.isNaN(updated.valueOf()) ? t("recent") : <time dateTime={report.updated_at}>{dateFormat.format(updated)}</time>}</span>
        </Link>
        <div className="flex w-[140px] shrink-0 items-center justify-end gap-1">
          <Button variant="ghost" size="icon" aria-label={t("copyReport", { title: report.title })} title={t("copy")} disabled={writeDisabled}
            onClick={() => onCopy(report)}><CopyPlus size={15} /></Button>
          <Button variant={armed ? "destructive" : "ghost"} size={armed ? "sm" : "icon"}
            aria-label={armed ? t("confirmDelete") : t("deleteReport", { title: report.title })} disabled={writeDisabled}
            onClick={() => onDelete(report)}>
            {deletingId === report.id ? <Loader2 size={15} className="animate-spin" /> : armed ? t("confirmDelete") : <Trash2 size={15} />}
          </Button>
        </div>
      </li>;
    })}
  </ol>;
}
