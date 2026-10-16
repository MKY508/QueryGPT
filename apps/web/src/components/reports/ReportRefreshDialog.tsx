"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { TaskDialog } from "@/components/ui/TaskDialog";
import { Button } from "@/components/ui/button";
import {
  inspectReportRefreshSources,
  isDefinitiveReportRefreshError,
  ReportConflictError,
  type ReportRefreshPlan,
} from "@/lib/reports";
import { ReportRefreshSourceReview } from "./ReportRefreshSourceReview";

interface Props {
  projectId: string;
  reportId: string;
  pageId: string;
  blockId?: string;
  expectedVersion: number;
  onConfirm: (plan: ReportRefreshPlan) => Promise<void>;
  onReload: () => Promise<void>;
  onClose: () => void;
}

type RefreshReviewError = "readFailed" | "changed" | "conflict" | "uncertain";

export function ReportRefreshDialog(props: Props) {
  return <ReportRefreshSession key={JSON.stringify([props.projectId, props.reportId, props.pageId, props.blockId, props.expectedVersion])} {...props} />;
}

function ReportRefreshSession({
  projectId, reportId, pageId, blockId, expectedVersion, onConfirm, onReload, onClose,
}: Props) {
  const t = useTranslations("reportRefresh");
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef(false);
  const writing = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [plan, setPlan] = useState<ReportRefreshPlan | null>(null);
  const [error, setError] = useState<RefreshReviewError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    active.current = true;
    const element = dialog.current;
    element?.showModal();
    return () => {
      active.current = false;
      element?.close();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void inspectReportRefreshSources(
      projectId, reportId, pageId, expectedVersion, blockId, controller.signal,
    ).then((next) => {
      if (active.current && !controller.signal.aborted) setPlan(next);
    }, (reason) => {
      if (active.current && !controller.signal.aborted) {
        setError(reason instanceof ReportConflictError ? "conflict" : "readFailed");
      }
    });
    return () => controller.abort();
  }, [projectId, reportId, pageId, blockId, expectedVersion, attempt]);

  const confirm = async () => {
    if (writing.current || !plan || error) return;
    writing.current = true;
    setBusy(true);
    try {
      await onConfirm(plan);
      if (active.current) onClose();
    } catch (reason) {
      if (active.current) {
        setPlan(null);
        setError(reason instanceof ReportConflictError ? "conflict"
          : isDefinitiveReportRefreshError(reason) ? "changed" : "uncertain");
      }
    } finally {
      writing.current = false;
      if (active.current) setBusy(false);
    }
  };

  const reload = async () => {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    try {
      await onReload();
      if (active.current) onClose();
    } catch {
      // Do not offer another write until the saved report is loaded.
    } finally {
      writing.current = false;
      if (active.current) setBusy(false);
    }
  };

  const needsReload = error === "uncertain" || error === "conflict";

  return (
    <TaskDialog dialogRef={dialog} writingRef={writing} activeRef={active} busy={busy} size="compact" title={t("title")} closeLabel={t("close")} onClose={onClose}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        {!plan && !error && (
          <p role="status" className="flex items-center gap-2 text-sm">
            <Loader2 size={15} className="animate-spin" />{t("loading")}
          </p>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{t(error)}</p>}
        {plan && <ReportRefreshSourceReview plan={plan} />}
        <p className="text-xs text-muted-foreground">{t("scope")}</p>
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-4">
        <span className="text-xs tabular-nums text-muted-foreground">{plan && t("review.refreshCount", { count: plan.blocks.length })}</span>
        {needsReload ? (
          <Button variant="outline" size="md" type="button" disabled={busy} onClick={() => void reload()} className="border border-border px-4 py-2 text-sm">
            {t("reload")}
          </Button>
        ) : error ? (
          <Button variant="outline" size="md" type="button" disabled={busy} onClick={() => {
            setPlan(null);
            setError(null);
            setAttempt((value) => value + 1);
          }} className="border border-border px-4 py-2 text-sm">
            {t("retry")}
          </Button>
        ) : (
          <Button variant="primary" size="md" type="button" disabled={!plan || busy} onClick={() => void confirm()} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium">
            {busy && <Loader2 size={14} className="animate-spin" />}{t("confirm")}
          </Button>
        )}
      </footer>
    </TaskDialog>
  );
}
