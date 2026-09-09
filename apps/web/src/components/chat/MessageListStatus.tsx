"use client";

import {ArrowRight, CircleAlert, Loader2, PencilLine, Settings2} from "lucide-react";
import {useTranslations} from "next-intl";
import {Button} from "@/components/ui/button";

/** A received question is not a completed analysis step. */
export function PendingTaskReport({task, modelReady, onOpenSettings, onContinue, onEdit}: {
  task: string;
  modelReady: boolean;
  onOpenSettings: () => void;
  onContinue: () => void;
  onEdit: () => void;
}) {
  const t = useTranslations("messageList");
  return <div className="min-h-0 flex-1 overflow-y-auto bg-background px-7 py-8">
    <article data-testid="pending-task-report" className="mx-auto grid w-full max-w-[1080px] grid-cols-[minmax(0,1fr)_260px] overflow-hidden rounded-xl border border-border bg-card">
      <div className="min-w-0 px-8 py-8">
        <p className="text-xs font-medium text-muted-foreground">{t("pendingTaskTitle")}</p>
        <h1 className="mt-4 whitespace-pre-wrap text-2xl font-semibold leading-snug tracking-tight text-foreground [overflow-wrap:anywhere]">{task}</h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">{t("pendingTaskHint")}</p>
        <div className="mt-8 flex flex-wrap gap-2">
          <Button onClick={modelReady ? onContinue : onOpenSettings}>
            {modelReady ? <ArrowRight size={16} /> : <Settings2 size={16} />}
            {modelReady ? t("continueOrPick") : t("pickService")}
          </Button>
          <Button variant="outline" onClick={onEdit}><PencilLine size={15} />{t("editTask")}</Button>
        </div>
      </div>
      <aside className="border-l border-border bg-muted/25 px-6 py-8">
        <p className="text-sm font-medium text-foreground">{modelReady ? t("serviceReady") : t("waitingForService")}</p>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("dataOptional")}</p>
      </aside>
    </article>
  </div>;
}

/** Loading and retry share a surface; only the caller can restart a request. */
export function ConversationStatus({loading, error, onRetry}: {
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  const t = useTranslations("messageList");
  return <div className="min-h-0 flex-1 overflow-y-auto bg-background px-7 py-8">
    <section role={loading ? "status" : "alert"} className="mx-auto grid w-full max-w-[920px] grid-cols-[20px_minmax(0,1fr)] gap-3 rounded-xl border border-border bg-card p-6">
      {loading ? <Loader2 aria-hidden="true" size={18} className="mt-0.5 animate-spin text-primary motion-reduce:animate-none" /> : <CircleAlert aria-hidden="true" size={18} className="mt-0.5 text-warning" />}
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground">{loading ? t("openingReport") : t("reportUnavailable")}</h2>
        {!loading && <>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">{error}</p>
          {onRetry && <Button variant="outline" className="mt-4" onClick={onRetry}>{t("reopen")}</Button>}
        </>}
      </div>
    </section>
  </div>;
}
