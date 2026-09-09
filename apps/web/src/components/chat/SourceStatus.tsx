"use client";

import { useTranslations } from "next-intl";
import type { PreflightReport, ProjectDataSource } from "@/lib/types/api";
import { sourceDisplayState } from "@/lib/source-directory";
import { cn } from "@/lib/utils";

function presentation(state: string) {
  if (state === "history") return { key: "statusHistorical", color: "text-muted-foreground", background: "bg-muted" };
  if (state === "activation_pending") return { key: "sourceStatusWaiting", color: "text-warning", background: "bg-warning/[0.06]" };
  if (state === "preparation_review") return { key: "statusPreparationReview", color: "text-warning", background: "bg-warning/[0.06]" };
  if (state === "ready") return { key: "statusReady", color: "text-success", background: "bg-success/[0.06]" };
  if (state === "needs_confirmation") return { key: "statusNeedsReview", color: "text-warning", background: "bg-warning/[0.06]" };
  if (state === "error") return { key: "statusNeedsAttention", color: "text-destructive", background: "bg-destructive/[0.06]" };
  if (state === "attached") return { key: "statusAwaitingPreparation", color: "text-muted-foreground", background: "bg-muted" };
  return { key: "statusSanitizing", color: "text-muted-foreground", background: "bg-muted" };
}

export function SourceStatus({ source, report, compact, className }: {
  source: ProjectDataSource; report?: PreflightReport; compact?: boolean; className?: string;
}) {
  const t = useTranslations("dataWorkspace");
  const status = presentation(sourceDisplayState(source, report));
  return <span className={cn("inline-flex items-center gap-1.5 text-[11px]", status.color,
    compact ? "" : ["px-2 py-1", status.background], className)}>
    {compact && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
    {t(status.key)}
  </span>;
}
