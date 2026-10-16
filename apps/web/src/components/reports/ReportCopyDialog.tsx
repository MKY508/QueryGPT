"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { TaskDialog } from "@/components/ui/TaskDialog";
import { Button } from "@/components/ui/button";
import field from "@/components/ui/FieldControl.module.css";
import { copyReport, reportCopyTitle, ReportCopyError, resolveReportCopy, type ReportCopyRequest, type ReportCopyResult } from "@/lib/report-copy";
import { PendingCopyChangedError, pendingCopyForSource, preparePendingCopy, removePendingCopy, requirePendingCopy, type PendingReportCopy } from "@/lib/report-copy-journal";

interface CopyDialogProps {
  projectId: string; reportId: string; title: string; version: number;
  pending?: PendingReportCopy;
  onCreated: (id: string) => void; onClose: () => void; onReload: () => void;
}
export function ReportCopyDialog(props: CopyDialogProps) {
  return <ReportCopySession key={`${props.projectId}:${props.reportId}:${props.pending?.id ?? "new"}`} {...props} />;
}
function scoped(pending: PendingReportCopy, project: string, source: string) {
  if (pending.projectId !== project || pending.sourceReportId !== source) throw new PendingCopyChangedError("Copy scope changed");
  return pending;
}
function ReportCopySession({ projectId, reportId, title: sourceTitle, version, pending, onCreated, onClose, onReload }: CopyDialogProps) {
  const t = useTranslations("reportCopy");
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const initialFocus = useRef(true);
  const active = useRef(false);
  const writing = useRef(true);
  const request = useRef<ReportCopyRequest | null>(null);
  const journal = useRef<PendingReportCopy | null>(null);
  const readController = useRef<AbortController | null>(null);
  const [title, setTitle] = useState(() => pending?.request.title ?? reportCopyTitle(sourceTitle, t("suffix")));
  const [busy, setBusy] = useState(true);
  const [pendingCopy, setPendingCopy] = useState<PendingReportCopy | null>(null);
  const [armedDismiss, setArmedDismiss] = useState(false);
  const [outcome, setOutcome] = useState<"ready" | "uncertain" | "absent" | "changed" | "unavailable" | "failed" | "storageFailed" | "gone">("ready");
  const outcomeRef = useRef(outcome);
  const [result, setResult] = useState<ReportCopyResult | null>(null);
  const setOutcomeState = useCallback((next: typeof outcome) => { outcomeRef.current = next; setOutcome(next); }, []);
  const titleTooLong = [...title.trim()].length > 200;
  const validTitle = title.trim().length > 0 && !titleTooLong && !title.includes("\0");

  useEffect(() => {
    active.current = true;
    const previous = document.activeElement;
    const element = dialog.current; element?.showModal();
    const controller = new AbortController(); readController.current = controller;
    let checkingServer = false;
    void (async () => {
      try {
        const saved = pending ? await requirePendingCopy(pending) : await pendingCopyForSource(projectId, reportId);
        if (!active.current || controller.signal.aborted) return;
        if (saved) {
          scoped(saved, projectId, reportId);
          journal.current = saved; request.current = saved.request;
          setPendingCopy(saved); setTitle(saved.request.title); setOutcomeState("uncertain");
          checkingServer = true;
          const created = await resolveReportCopy(projectId, reportId, saved.request, controller.signal);
          if (!active.current || controller.signal.aborted) return;
          if (created) setResult(created); else setOutcomeState("absent");
        }
      } catch (failure) {
        if (active.current && !controller.signal.aborted) setOutcomeState(failure instanceof PendingCopyChangedError ? "gone"
          : checkingServer ? (failure instanceof ReportCopyError ? failure.kind : "uncertain") : "storageFailed");
      } finally {
        if (active.current && !controller.signal.aborted) { writing.current = false; setBusy(false); }
      }
    })();
    return () => {
      active.current = false; controller.abort(); readController.current?.abort(); element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [projectId, reportId, pending, setOutcomeState]);

  useEffect(() => {
    if (busy || !initialFocus.current) return;
    initialFocus.current = false;
    if (input.current && !input.current.disabled) { input.current.focus(); input.current.select(); }
    else dialog.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [busy]);

  const create = async () => {
    if (writing.current || !validTitle || !["ready", "absent"].includes(outcomeRef.current)) return;
    // A retry after read-only resolution reuses the complete original intent.
    const intent = request.current ?? { request_id: crypto.randomUUID(), expected_version: version, title: title.trim() };
    request.current = intent;
    writing.current = true; setBusy(true);
    let dispatched = false;
    try {
      if (journal.current) {
        await requirePendingCopy(journal.current);
      } else {
        const prepared = await preparePendingCopy(projectId, reportId, sourceTitle, intent);
        if (!active.current) return;
        scoped(prepared.pending, projectId, reportId);
        journal.current = prepared.pending; request.current = prepared.pending.request;
        setPendingCopy(prepared.pending); setTitle(prepared.pending.request.title);
        if (!prepared.created) { setOutcomeState("uncertain"); return; }
      }
      if (!active.current) return;
      dispatched = true;
      const created = await copyReport(projectId, reportId, request.current);
      if (active.current) setResult(created);
    } catch (failure) {
      if (active.current) setOutcomeState(failure instanceof PendingCopyChangedError ? "gone"
        : dispatched ? (failure instanceof ReportCopyError ? failure.kind : "uncertain") : "storageFailed");
    } finally { writing.current = false; if (active.current) setBusy(false); }
  };
  const resolve = async () => {
    if (writing.current || !request.current || !journal.current || outcomeRef.current !== "uncertain") return;
    writing.current = true; setBusy(true);
    const controller = new AbortController(); readController.current = controller;
    try {
      await requirePendingCopy(journal.current);
      if (!active.current || controller.signal.aborted) return;
      const created = await resolveReportCopy(projectId, reportId, request.current, controller.signal);
      if (!active.current || controller.signal.aborted) return;
      if (created) setResult(created);
      else setOutcomeState("absent");
    } catch (failure) {
      if (active.current && !controller.signal.aborted) setOutcomeState(failure instanceof PendingCopyChangedError ? "gone" : failure instanceof ReportCopyError ? failure.kind : "uncertain");
    } finally { writing.current = false; if (active.current) setBusy(false); }
  };

  const leave = async (open = false) => {
    if (writing.current) return;
    writing.current = true; setBusy(true);
    // Closing an unknown operation preserves its reminder. Explicitly opening
    // or acknowledging a confirmed copy may remove only this exact reminder.
    if (result && journal.current) await removePendingCopy(journal.current).catch(() => false);
    if (active.current) { if (open && result) onCreated(result.report_id); else onClose(); }
    writing.current = false;
    if (active.current) setBusy(false);
  };
  const dismiss = async () => {
    if (writing.current || !journal.current) return;
    if (!armedDismiss) { setArmedDismiss(true); return; }
    writing.current = true; setBusy(true);
    try {
      const removed = await removePendingCopy(journal.current);
      if (active.current) { if (removed) onClose(); else setOutcomeState("gone"); }
    } catch { if (active.current) setOutcomeState("storageFailed"); }
    finally { writing.current = false; if (active.current) setBusy(false); }
  };

  return <TaskDialog dialogRef={dialog} writingRef={writing} activeRef={active} busy={busy}
    autoFocusClose={false} size="compact" title={t("title")} closeLabel={t("close")}
    onClose={() => void leave()} onEscape={() => void leave()}>
    <form className="min-h-0 overflow-y-auto" onSubmit={(event) => { event.preventDefault(); if (!result) void create(); }}>
      <div className="space-y-4 px-5 py-5">
        <p className="text-xs leading-5 text-muted-foreground">{t("scope")}</p>
        <label className="block text-xs font-medium">
          {t("name")}
          <input ref={input} value={title} aria-invalid={titleTooLong || undefined} onChange={(event) => setTitle(event.target.value)} disabled={busy || outcome !== "ready" || !!result}
            className={`${field.control} mt-2`} />
        </label>
        {titleTooLong && <p role="alert" className="text-xs text-destructive">{t("nameTooLong")}</p>}
        {outcome !== "ready" && !result && <p role="alert" className="text-xs leading-5 text-destructive">{t(outcome)}</p>}
        {result && <p role="status" className="text-xs">{t("created")}</p>}
        {armedDismiss && <p role="alert" className="text-xs leading-5 text-muted-foreground">{t("dismissWarning")}</p>}
      </div>
      <footer className="flex justify-end gap-2 border-t border-border px-5 py-4">
        {busy && <Loader2 aria-label={t("working")} size={16} className="mr-auto mt-2 animate-spin" />}
        {pendingCopy && !result && <Button variant="ghost" size="md" disabled={busy} onClick={() => void dismiss()} className="mr-auto text-xs">{t(armedDismiss ? "confirmDismiss" : "dismiss")}</Button>}
        <Button variant="ghost" size="md" disabled={busy} onClick={() => void leave()} className="text-xs">{t("close")}</Button>
        {result ? <Button size="md" disabled={busy} onClick={() => void leave(true)} className="text-xs">{t("open")}</Button>
          : outcome === "uncertain" ? <Button size="md" disabled={busy} onClick={() => void resolve()} className="text-xs">{t("check")}</Button>
            : outcome === "changed" || outcome === "unavailable" || outcome === "storageFailed" || outcome === "gone" ? <Button variant="outline" size="md" disabled={busy} onClick={onReload} className="text-xs">{t("reload")}</Button>
              : outcome !== "failed" && <Button size="md" type="submit" disabled={busy || !validTitle} className="text-xs">{t(outcome === "absent" ? "retry" : "create")}</Button>}
      </footer>
    </form>
  </TaskDialog>;
}
