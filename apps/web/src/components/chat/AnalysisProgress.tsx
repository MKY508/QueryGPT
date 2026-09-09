import { Check, CircleAlert, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { analysisStageDetailKey } from "@/lib/analysis-activity";
import { isTerminalAnalysisState } from "@/lib/analysis-state";
import type { AnalysisState } from "@/lib/types/analysis-state";

interface AnalysisProgressProps {
  state?: AnalysisState;
  stage?: string;
  finalizing?: boolean;
  stopping?: boolean;
  pending?: boolean;
}

type ProgressTone = "done" | "active" | "waiting" | "attention";

const STATE_PRESENTATION = {
  understanding: { label: "understanding", detail: "understandingDesc", tone: "active" },
  investigating: { label: "verifying", detail: "verifyingDesc", tone: "active" },
  waiting_confirmation: { label: "awaiting", detail: "awaitingDesc", tone: "waiting" },
  completed: { label: "completed", detail: "completedDesc", tone: "done" },
  needs_attention: { label: "needsAttention", detail: "needsAttentionDesc", tone: "attention" },
} as const satisfies Record<AnalysisState, { label: string; detail: string; tone: ProgressTone }>;

export function AnalysisProgress({
  state = "understanding", stage, finalizing = false, stopping = false, pending = false,
}: AnalysisProgressProps) {
  const t = useTranslations("analysisProgress");
  const base = STATE_PRESENTATION[state];
  const settling = finalizing || (pending && isTerminalAnalysisState(state));
  const phase = stopping ? "stopping" : settling ? "finalizing" : undefined;
  const current = phase ? {
    state: phase, tone: "active", label: t(phase), detail: t(phase === "stopping" ? "stoppingDesc" : "finalizingDesc"),
  } : { state, tone: base.tone, label: t(base.label), detail: t(base.detail) };
  // Progress text is presentation only. State comes from the task contract;
  // terminal work-step labels cannot declare success during an active stream.
  const stepKey = analysisStageDetailKey(stage);
  const detail = phase || isTerminalAnalysisState(state) || !stepKey
    || ["completedDesc", "awaitingDesc", "needsAttentionDesc"].includes(stepKey)
    ? current.detail : t(stepKey);

  return (
    <section
      aria-label={t("currentProgressAria")}
      className="w-full max-w-[920px] rounded-xl border border-border bg-card p-6"
    >
      <div
        aria-atomic="true"
        aria-live="polite"
        data-progress-state={current.state}
        className="grid grid-cols-[28px_minmax(0,1fr)] gap-3"
      >
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 flex h-7 w-7 items-center justify-center rounded-full border bg-card",
            current.tone === "done" && "border-primary bg-primary text-primary-foreground",
            current.tone === "active" && "border-primary text-primary",
            current.tone === "attention" && "border-warning text-warning",
            current.tone === "waiting" && "border-warning/60 text-warning"
          )}
        >
          {current.tone === "done" ? (
            <Check size={14} strokeWidth={2.5} />
          ) : current.tone === "active" ? (
            <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
          ) : current.tone === "attention" ? (
            <CircleAlert size={14} />
          ) : (
            <span className="h-2 w-2 rounded-full bg-warning" />
          )}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <h2
              className={cn(
                "text-sm font-semibold tracking-[-0.01em] text-foreground",
                current.tone === "attention" && "text-warning"
              )}
            >
              {current.label}
            </h2>
          </div>
          <p
            className={cn(
              "mt-1 text-xs leading-5 text-muted-foreground",
              current.tone === "attention" && "text-warning/80"
            )}
          >
            {detail}
          </p>
        </div>
      </div>
    </section>
  );
}
