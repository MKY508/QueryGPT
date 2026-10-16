"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { TaskDialog } from "@/components/ui/TaskDialog";
import { Button } from "@/components/ui/button";
import type { ReportDocument } from "@/lib/reports";
import { loadReportRecoveryDraft, reportRecoveryBase, restoreReportRecoveryDraft, type ReportRecoveryDraft, type ReportRecoverySummary } from "@/lib/report-recovery";
import { ReportPrintView } from "./ReportPrintView";
import { ReportLibraryLayout } from "./ReportLibraryLayout";
import { InlineNotice } from "@/components/ui/InlineNotice";

interface RecoveryActions {
  report: ReportDocument | null;
  dirty: boolean;
  busy: boolean;
  error: boolean;
  onRestore: (draft: ReportRecoveryDraft) => void;
  onResolveSave?: (draft: ReportRecoveryDraft) => Promise<"confirmed" | "unconfirmed" | "failed">;
  onRemove: (draft: ReportRecoverySummary) => void;
}

/** A keyed preview owns one body read; switching drafts cannot show a stale body. */
function DraftPreview({ summary, report, dirty, busy, error, onRestore, onResolveSave, onRemove, onReload }: RecoveryActions & { summary: ReportRecoverySummary; onReload: () => void }) {
  const t = useTranslations("reportRecovery");
  // The parent remounts this preview whenever the identity/revision changes.
  const [source] = useState(summary);
  const [result, setResult] = useState<{ attempt: number; draft?: ReportRecoveryDraft; failed?: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [saveCheck, setSaveCheck] = useState<"checking" | "confirmed" | "unconfirmed" | "failed" | null>(null);
  const resolveActive = useRef(true);
  const resolving = useRef(false);
  useEffect(() => { resolveActive.current = true; return () => { resolveActive.current = false; }; }, []);
  const draft = result?.attempt === attempt ? result.draft : undefined;
  const loadFailed = result?.attempt === attempt && result.failed;
  const baseline = draft && report ? reportRecoveryBase(draft, report) : null;
  const restored = draft && baseline ? restoreReportRecoveryDraft(draft, baseline) : null;
  const needsMerge = baseline && report && baseline.version !== report.version;
  const checkSave = async () => {
    if (!draft || !onResolveSave || resolving.current || busy || dirty) return;
    resolving.current = true;
    setSaveCheck("checking");
    try {
      const result = await onResolveSave(draft);
      if (resolveActive.current) setSaveCheck(result);
    } catch { if (resolveActive.current) setSaveCheck("failed"); }
    finally { resolving.current = false; }
  };
  useEffect(() => {
    let active = true;
    void loadReportRecoveryDraft(source).then((value) => {
      if (active) setResult({ attempt, draft: value });
    }, () => { if (active) setResult({ attempt, failed: true }); });
    return () => { active = false; };
  }, [source, attempt]);

  return <>
    {(saveCheck === "failed" || saveCheck === "unconfirmed") && <InlineNotice role="status" tone="neutral" className="mx-4 my-3 shrink-0">{t(saveCheck === "unconfirmed" ? "saveStillUnconfirmed" : "saveCheckFailed")}</InlineNotice>}
    {(error || loadFailed) && <InlineNotice className="mx-4 my-3 shrink-0" actions={loadFailed &&
      <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => { setAttempt((value) => value + 1); onReload(); }}>{t("retry")}</Button>}>
      {loadFailed ? t("previewFailed") : t("actionFailed")}
    </InlineNotice>}
    <div className="min-h-0 flex-1 overflow-auto">
      {draft && !loadFailed ? <ReportPrintView report={restored || draft.document} filterValues={{}} preview />
        : !loadFailed && <p role="status" className="flex items-center gap-2 p-5 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" />{t("loadingDraft")}</p>}
    </div>
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-5 py-4 text-xs">
      <p className="max-w-xl leading-5 text-muted-foreground">{confirmRemove ? t("removeWarning") : !report ? t("reportUnavailable") : dirty ? t("currentEdits") : draft?.pendingSave ? t("pendingSaveHint") : needsMerge ? t("mergeHint") : restored ? t("restoreHint") : draft ? t("changedReport") : t("loadingDraft")}</p>
      <div className="flex items-center gap-3">
        {busy && <Loader2 size={14} className="animate-spin" aria-label={t("working")} />}
        {confirmRemove ? <>
          <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => setConfirmRemove(false)} className="font-medium">{t("keepDraft")}</Button>
          <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => { onRemove(summary); setConfirmRemove(false); }} className="font-medium text-destructive">{t("removeDraft")}</Button>
        </> : <>
          <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => setConfirmRemove(true)} className="font-medium text-muted-foreground hover:text-destructive">{t("removeDraft")}</Button>
          {draft?.pendingSave && onResolveSave
            ? <Button variant="primary" size="sm" type="button" disabled={busy || dirty || !report || saveCheck === "checking"} onClick={() => void checkSave()}>{t("checkSave")}</Button>
            : <Button variant="primary" size="sm" type="button" disabled={busy || dirty || !restored} onClick={() => { if (draft) onRestore(draft); }}>{t("restore")}</Button>}
        </>}
      </div>
    </footer>
  </>;
}

export function ReportRecoveryPanel({ drafts, report, dirty, busy, error, onRestore, onResolveSave, onRemove, onClose, total, hasMore, loadingMore, listFailed, onLoadMore, onReload }: RecoveryActions & {
  drafts: ReportRecoverySummary[];
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  listFailed: boolean;
  onLoadMore: () => void;
  onReload: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("reportRecovery");
  const locale = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selectedId, setSelectedId] = useState(drafts[0]?.id);
  const selected = drafts.find((draft) => draft.id === selectedId) || drafts[0];
  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return <TaskDialog dialogRef={dialogRef} writingRef={{ current: busy }} busy={busy} title={t("title")} closeLabel={t("close")} onClose={onClose}>
    <ReportLibraryLayout directoryLabel={t("chooseDraft")} directory={<>
      <p className="mb-3 text-xs text-muted-foreground">{t("loadedCount", { loaded: drafts.length, total })}</p>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {drafts.map(draft => <Button key={draft.id} variant="ghost" type="button" disabled={busy}
          aria-pressed={selected?.id === draft.id} onClick={() => setSelectedId(draft.id)}
          className="mb-1 block h-auto w-full p-3 text-left text-xs aria-pressed:bg-muted">
          <span className="block truncate font-semibold">{draft.title}</span>
          <span className="mt-1 block text-muted-foreground">{new Date(draft.updatedAt).toLocaleString(locale)}</span>
        </Button>)}
      </div>
      {hasMore && <Button variant="ghost" size="sm" type="button" disabled={busy || loadingMore} onClick={onLoadMore} className="mt-3 self-start">{t("loadMore")}</Button>}
    </>}>
      {listFailed && <InlineNotice className="mx-4 my-3 shrink-0" actions={<Button variant="ghost" size="sm" type="button" disabled={loadingMore || busy} onClick={onReload}>{t("retry")}</Button>}>
        {t("listFailed")}
      </InlineNotice>}
      {selected ? <DraftPreview key={selected.id + ":" + selected.revision} summary={selected} report={report} dirty={dirty}
        busy={busy} error={error} onRestore={onRestore} onResolveSave={onResolveSave} onRemove={onRemove} onReload={onReload} />
        : <p role="status" className="p-5 text-sm text-muted-foreground">{loadingMore ? t("loadingDraft") : t("empty")}</p>}
    </ReportLibraryLayout>
  </TaskDialog>;
}
