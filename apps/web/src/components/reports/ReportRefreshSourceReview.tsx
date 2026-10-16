"use client";

import { useLocale, useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import type { ReportRefreshPlan, ReportRefreshSourceLabel } from "@/lib/reports";
import { groupReportRefreshSources } from "@/lib/report-refresh-review";

export function ReportRefreshSourceReview({ plan }: { plan: ReportRefreshPlan }) {
  const t = useTranslations("reportRefresh"), locale = useLocale();
  const groups = groupReportRefreshSources(plan);
  const changed = groups.filter((group) => group.state === "changed").reduce((count, group) => count + group.blocks.length, 0);
  const sourceText = (source: ReportRefreshSourceLabel | null) => !source ? t("unrecorded")
    : source.data_version ? t("fileVersion", { name: source.name, version: source.data_version }) : source.name;
  return <section aria-label={t("review.title")} className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <p className="font-medium">{t("review.count", { count: plan.blocks.length, groups: groups.length })}</p>
      {changed > 0 && <p className="text-primary">{t("review.changedCount", { count: changed })}</p>}
    </div>
    {groups.map((group) => <section key={group.key} aria-label={sourceText(group.next)} className="overflow-hidden rounded-xl border border-border">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-muted/25 px-4 py-2.5 text-xs">
        <h3 className={group.state === "changed" ? "font-semibold text-primary" : "font-medium text-muted-foreground"}>
          {t(`review.${group.state}`)}
        </h3>
        <span className="shrink-0 tabular-nums text-muted-foreground">{t("review.items", { count: group.blocks.length })}</span>
      </header>
      <dl className="grid grid-cols-2 gap-3 p-4">
        <div className="min-w-0"><dt className="text-[11px] text-muted-foreground">{t("previous")}</dt>
          <dd className="mt-1 text-sm leading-5 [overflow-wrap:anywhere]">{sourceText(group.previous)}</dd>
        </div>
        <div className="min-w-0 border-l-2 border-primary/30 pl-3"><dt className="text-[11px] text-muted-foreground">{t("next")}</dt>
          <dd className="mt-1 text-sm font-medium leading-5 [overflow-wrap:anywhere]">{sourceText(group.next)}</dd>
        </div>
      </dl>
      <details open={group.blocks.length <= 3} className="group border-t border-border/70">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 text-xs text-muted-foreground hover:bg-muted/30 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary">
          {t("review.affected", { count: group.blocks.length })}<ChevronDown size={14} aria-hidden="true" className="shrink-0 group-open:rotate-180" />
        </summary>
        <ul className="max-h-64 overflow-y-auto px-4 pb-2">
          {group.blocks.map((block) => <li key={block.block_id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 border-t border-border/50 py-2 text-xs">
            <span className="min-w-0 flex-1 leading-5 [overflow-wrap:anywhere]">{block.title || t("untitled")}</span>
            {block.refreshed_at && <time dateTime={block.refreshed_at} className="text-[10px] leading-5 text-muted-foreground">
              {t("review.lastRefreshed", { time: new Date(block.refreshed_at).toLocaleString(locale) })}
            </time>}
          </li>)}
        </ul>
      </details>
    </section>)}
  </section>;
}
