"use client";

import {CheckCircle2, CircleAlert, Radar} from "lucide-react";
import {useTranslations} from "next-intl";
import type {ProjectDataSource, StandingAnalysis} from "@/lib/types/api";
import {Button} from "@/components/ui/button";
import {cn} from "@/lib/utils";

/** Project activity is a complete list, not a two-item preview without a destination. */
export function WorkspaceActivitySummary({sources, standingAnalyses, checkingStandingId, standingFeedback, onOpenData, onCheckStanding}: {
  sources: ProjectDataSource[];
  standingAnalyses: StandingAnalysis[];
  checkingStandingId?: string | null;
  standingFeedback: Record<string, string>;
  onOpenData: () => void;
  onCheckStanding: (standing: StandingAnalysis) => void;
}) {
  const t=useTranslations("chatEmpty");
  if (!sources.length && !standingAnalyses.length) return null;
  const unresolved=sources.filter(source=>source.status!=="ready");
  return <section className={cn("mt-8 grid items-start gap-4",sources.length>0&&standingAnalyses.length>0&&"grid-cols-2")}>
    {sources.length>0 && <Button variant="outline" onClick={onOpenData} className="h-auto min-w-0 items-start justify-start gap-3 rounded-xl p-5 text-left">
      {unresolved.length ? <CircleAlert size={17} className="mt-0.5 shrink-0 text-warning"/> : <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-success"/>}
      <span className="min-w-0">
        <span className="block text-sm font-medium">{t("data")}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{unresolved.length ? t("issuesCount",{count:unresolved.length}) : sources.slice(0,2).map(source=>source.name).join(" · ")}</span>
      </span>
    </Button>}
    {standingAnalyses.length>0 && <section className="min-w-0 rounded-xl border border-border bg-card p-5" aria-label={t("standingTitle")}>
      <header className="flex items-center gap-2"><Radar size={17} className="shrink-0 text-primary"/><h2 className="flex-1 text-sm font-medium">{t("standingTitle")}</h2><span className="text-xs text-muted-foreground">{t("itemsCount",{count:standingAnalyses.length})}</span></header>
      <ul className="mt-3 divide-y divide-border">
        {standingAnalyses.map(standing=>{
          const checking=checkingStandingId===standing.id||Boolean(standing.in_flight);
          const state=checking?"stateChecking":standing.state==="needs_attention"?"statePending":standing.state==="paused"?"statePaused":"standingTitle";
          return <li key={standing.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground [overflow-wrap:anywhere]">{standing.name}</p>
              <p role={standingFeedback[standing.id]?"status":undefined} className={cn("mt-1 text-xs leading-5",standing.state==="needs_attention"?"text-warning":"text-muted-foreground")}>{standingFeedback[standing.id]||t(state)}</p>
            </div>
            {standing.state==="active" && <Button variant="ghost" size="sm" disabled={checking} onClick={()=>onCheckStanding(standing)}>{checking?t("checking"):t("checkChanges")}</Button>}
          </li>;
        })}
      </ul>
    </section>}
  </section>;
}
