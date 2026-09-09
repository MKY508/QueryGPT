"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ChatMessage } from "@/lib/types/chat";
import { AnalysisProgress } from "./AnalysisProgress";

/** Like Streamlit's expandable status container, with product-owned stage
 * labels only. These are observed activities, never a checklist of successes. */
export function InvestigationActivity({ message, query, stopping = false }: { message: ChatMessage; query: string; stopping?: boolean }) {
  const t = useTranslations("investigationActivity"), tp = useTranslations("analysisProgress");
  const steps = message.activitySteps || [];
  return <article className="w-full max-w-[920px] rounded-xl border border-border bg-card" data-testid="investigation-activity">
    <header className="px-7 py-7">
      <p className="text-[11px] font-semibold text-primary">{t("task")}</p>
      <h2 className="mt-3 whitespace-pre-wrap break-words text-2xl font-semibold leading-relaxed tracking-tight">{query || t("untitled")}</h2>
    </header>
    <div className="px-7 pb-6"><AnalysisProgress state={message.analysisState} stage={message.thinkingStage}
      finalizing={Boolean(message.report)} pending stopping={stopping} /></div>
    {steps.length > 0 && <details className="group px-7">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span>{t("recent", { count: steps.length })}</span><ChevronDown size={15} className="shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <ol className="mb-6 ml-1 border-l border-border" aria-label={t("activity")}>
        {steps.map((step, index) => <li key={`${index}:${step}`} className="relative py-2 pl-5 text-xs leading-6 text-muted-foreground">
          <span aria-hidden="true" className="absolute -left-[3px] top-[17px] size-[5px] rounded-full bg-muted-foreground/50" />{tp(step)}
        </li>)}
      </ol>
    </details>}
  </article>;
}
