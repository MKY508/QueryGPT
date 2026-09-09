"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReportMetric, ReportNextAction } from "@/lib/types/api";
import { Button } from "@/components/ui/button";

/** Reading-only report sections. Requests and investigation state belong to the card. */
export function AnalysisMetrics({ metrics }: { metrics?: ReportMetric[] }) {
  if (!metrics?.length) return null;
  return <dl className="mt-7 grid grid-cols-3 gap-3">
    {metrics.map((metric, index) => <div key={`${metric.label}-${index}`} className="min-w-0 rounded-xl border border-border bg-background p-4">
      <dt className="break-words text-xs leading-5 text-muted-foreground">{metric.label}</dt>
      <dd className="mt-2 break-words text-2xl font-semibold leading-snug tracking-tight text-foreground tabular-nums [overflow-wrap:anywhere]">{metric.value}</dd>
      {metric.context && <dd className="mt-2 break-words text-xs leading-5 text-muted-foreground">{metric.context}</dd>}
    </div>)}
  </dl>;
}

export function AnalysisFindings({ findings }: { findings?: string[] }) {
  const t = useTranslations("assistantMessage");
  if (!findings?.length) return null;
  return <section className="mt-7">
    <h3 className="text-sm font-semibold text-foreground">{t("keyFindings")}</h3>
    <ol className="mt-3 divide-y divide-border border-y border-border">
      {findings.map((finding, index) => <li key={`${finding}-${index}`} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 py-3.5">
        <span aria-hidden="true" className="text-xs tabular-nums leading-6 text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
        <p className="break-words text-sm leading-6 text-foreground">{finding}</p>
      </li>)}
    </ol>
  </section>;
}

export function AnalysisSuggestions({ actions = [], questions = [], onUsePrompt }: {
  actions?: ReportNextAction[]; questions?: string[]; onUsePrompt: (prompt: string) => void;
}) {
  const t = useTranslations("assistantMessage");
  if (!actions.length && !questions.length) return null;
  return <section className="mt-7">
    <h3 className="text-sm font-semibold text-foreground">{t(actions.length ? "nextSuggestions" : "suggestionCanAsk")}</h3>
    <div className="mt-3 grid grid-cols-2 gap-3">
      {actions.length ? actions.map((action, index) => <Button key={`${action.prompt}-${index}`} variant="outline"
        onClick={() => onUsePrompt(action.prompt)} className="group block h-auto min-w-0 whitespace-normal p-4 text-left">
        <span className="flex items-start justify-between gap-3 text-sm font-medium">
          <span className="min-w-0 break-words">{action.label}</span>
          {action.recommended ? <span className="shrink-0 text-xs text-primary">{t("suggestionDoFirst")}</span> : <ArrowRight size={14} className="mt-0.5 shrink-0 text-muted-foreground" />}
        </span>
        <span className="mt-2 block break-words text-xs font-normal leading-5 text-muted-foreground">{action.reason}</span>
      </Button>) : questions.map((question, index) => <Button key={`${question}-${index}`} variant="outline" onClick={() => onUsePrompt(question)}
        className="h-auto min-w-0 justify-between whitespace-normal p-3 text-left text-sm leading-6">
        <span className="min-w-0 break-words">{question}</span><ArrowRight size={14} className="shrink-0 text-muted-foreground" />
      </Button>)}
    </div>
  </section>;
}
