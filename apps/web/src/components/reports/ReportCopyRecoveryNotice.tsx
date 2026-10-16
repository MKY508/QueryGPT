"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { listPendingCopies, subscribePendingCopies, type PendingCopyCursor, type PendingReportCopy } from "@/lib/report-copy-journal";

export function ReportCopyRecoveryNotice({ projectId, disabled, onResume }: {
  projectId: string; disabled: boolean; onResume: (pending: PendingReportCopy) => void;
}) {
  const t = useTranslations("reportCopyRecovery");
  const locale = useLocale();
  const client = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [before, setBefore] = useState<PendingCopyCursor | null>(null);
  const query = useQuery({
    queryKey: ["pending-report-copies", projectId, before],
    queryFn: () => listPendingCopies(projectId, before),
    retry: false, gcTime: 0, staleTime: 0, networkMode: "always",
    refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  useEffect(() => subscribePendingCopies(projectId, () => {
    void client.invalidateQueries({ queryKey: ["pending-report-copies", projectId] });
  }), [client, projectId]);

  if (query.isPending || (!query.isError && !query.data?.total)) return null;
  if (query.isError) return <div role="alert" className="mb-5 flex items-center justify-between gap-3 border border-border bg-card p-4 text-xs">
    <span>{t("unavailable")}</span>
    <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()} className="inline-flex shrink-0 items-center gap-1.5 hover:underline disabled:opacity-40"><RefreshCw size={13} />{t("retry")}</button>
  </div>;
  const page = query.data!;
  return <section aria-label={t("title")} className="mb-5 border border-border bg-card">
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="flex w-full items-center gap-2 p-4 text-left text-xs font-medium hover:bg-muted/40">
      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{t("count", { count: page.total })}
    </button>
    {expanded && <div className="border-t border-border px-4 pb-3">
      <ul className="divide-y divide-border">
        {page.items.map((pending) => <li key={pending.id} className="flex items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">{pending.request.title}</p>
            <p className="mt-1 truncate text-[11px] text-muted-foreground">{t("source", { title: pending.sourceTitle })} · {new Date(pending.createdAt).toLocaleString(locale)}</p>
          </div>
          <button type="button" disabled={disabled} onClick={() => onResume(pending)} className="shrink-0 rounded border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40">{t("continue")}</button>
        </li>)}
      </ul>
      {(before || page.next) && <div className="flex justify-between pt-2 text-xs">
        <button type="button" disabled={!before || query.isFetching} onClick={() => setBefore(null)} className="hover:underline disabled:opacity-40">{t("newest")}</button>
        {page.next && <button type="button" disabled={query.isFetching} onClick={() => setBefore(page.next)} className="hover:underline disabled:opacity-40">{t("older")}</button>}
      </div>}
    </div>}
  </section>;
}
