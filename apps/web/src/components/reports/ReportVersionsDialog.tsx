"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { TaskDialog } from "@/components/ui/TaskDialog";
import { Button } from "@/components/ui/button";
import { getReportVersion, listReportVersions, type ReportVersionPage } from "@/lib/report-versions";
import { ReportConflictError, type ReportDocument, type ReportSerializationCopy } from "@/lib/reports";
import { ReportPrintView } from "./ReportPrintView";

const reasons = ["baseline", "created", "copied", "saved", "page_changed", "block_changed", "refreshed", "restored", "trashed", "trash_restored"] as const;

interface ReportVersionsProps {
  projectId: string; reportId: string; currentVersion: number; copy: ReportSerializationCopy;
  onRestore: (version: number) => Promise<void>; onReload: () => Promise<void>; onClose: () => void;
}

export function ReportVersionsDialog(props: ReportVersionsProps) {
  return <ReportVersionsSession key={JSON.stringify([props.projectId, props.reportId, props.currentVersion])} {...props} />;
}

function ReportVersionsSession({ projectId, reportId, currentVersion, copy, onRestore, onReload, onClose }: ReportVersionsProps) {
  const t = useTranslations("reportVersions");
  const locale = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef(false);
  const writing = useRef(false);
  const listing = useRef(false);
  const listController = useRef<AbortController | null>(null);
  const previewController = useRef<AbortController | null>(null);
  const [directory, setDirectory] = useState<ReportVersionPage | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<ReportDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"readFailed" | "previewFailed" | "conflict" | "uncertain" | null>(null);

  useEffect(() => {
    active.current = true;
    const element = dialog.current;
    element?.showModal();
    const controller = new AbortController();
    listController.current = controller;
    void listReportVersions(projectId, reportId, undefined, controller.signal).then((page) => {
      if (active.current && !controller.signal.aborted) {
        setDirectory(page);
        if (page.current_version !== currentVersion) setError("conflict");
      }
    }, () => { if (active.current && !controller.signal.aborted) setError("readFailed"); })
      .finally(() => { if (active.current && !controller.signal.aborted) setLoading(false); });
    return () => { active.current = false; controller.abort(); listController.current?.abort(); previewController.current?.abort(); element?.close(); };
  }, [projectId, reportId, currentVersion]);

  const choose = async (version: number) => {
    if (writing.current || error === "conflict" || error === "uncertain") return;
    previewController.current?.abort();
    const controller = new AbortController();
    previewController.current = controller;
    setSelected(version); setPreview(null); setPreviewLoading(true); setError(null);
    try {
      const saved = await getReportVersion(projectId, reportId, version, copy, controller.signal);
      if (active.current && !controller.signal.aborted) setPreview(saved);
    } catch { if (active.current && !controller.signal.aborted) setError("previewFailed"); }
    finally { if (active.current && !controller.signal.aborted) setPreviewLoading(false); }
  };
  const more = async () => {
    if (listing.current || writing.current || !directory?.next_before || error === "conflict" || error === "uncertain") return;
    listing.current = true; setLoading(true);
    const controller = new AbortController();
    listController.current = controller;
    try {
      const page = await listReportVersions(projectId, reportId, directory.next_before, controller.signal);
      if (active.current && !controller.signal.aborted) {
        if (page.current_version !== currentVersion) { setError("conflict"); return; }
        setDirectory((current) => current ? { ...page, items: [...current.items, ...page.items] } : page);
        setError(null);
      }
    } catch { if (active.current && !controller.signal.aborted) setError("readFailed"); }
    finally { listing.current = false; if (active.current && !controller.signal.aborted) setLoading(false); }
  };
  const restore = async () => {
    if (writing.current || !preview || preview.version === currentVersion || error || loading || previewLoading) return;
    writing.current = true; setBusy(true);
    try { await onRestore(preview.version); if (active.current) onClose(); }
    catch (reason) { if (active.current) setError(reason instanceof ReportConflictError ? "conflict" : "uncertain"); }
    finally { writing.current = false; if (active.current) setBusy(false); }
  };
  const reload = async () => {
    if (writing.current) return;
    writing.current = true; setBusy(true);
    try { await onReload(); if (active.current) onClose(); } catch { /* Keep reconciliation-only state. */ }
    finally { writing.current = false; if (active.current) setBusy(false); }
  };
  const needsReload = error === "conflict" || error === "uncertain" || (error === "readFailed" && !directory);
  return <TaskDialog dialogRef={dialog} writingRef={writing} activeRef={active} busy={busy} title={t("title")} closeLabel={t("close")} onClose={onClose}>
    <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)]">
      <nav aria-label={t("versions")} className="overflow-y-auto border-r border-border p-3">
        {directory?.items.map((item) => <Button variant="ghost" size="md" type="button" key={item.version} aria-pressed={selected === item.version} disabled={busy || needsReload}
          onClick={() => void choose(item.version)} className="mb-1 block w-full p-3 text-left text-xs aria-pressed:bg-muted disabled:opacity-50 h-auto shrink-0">
          <span className="block font-semibold">{t("version", { version: item.version })}{item.version === currentVersion ? ` · ${t("current")}` : ""}</span>
          <span className="mt-1 block text-muted-foreground">{new Date(item.saved_at).toLocaleString(locale)}</span>
          <span className="mt-1 block truncate">{t(`reasons.${reasons.find((reason) => reason === item.reason) ?? "saved"}`)} · {item.title}</span>
        </Button>)}
        {loading && <Loader2 aria-label={t("loading")} size={18} className="mx-auto my-4 animate-spin" />}
        {directory?.next_before && <Button variant="ghost" size="md" type="button" disabled={loading || busy || needsReload} onClick={() => void more()} className="p-3 text-xs font-medium">{t("more")}</Button>}
        {directory && !directory.items.length && <p className="p-3 text-xs leading-5 text-muted-foreground">{t("empty")}</p>}
      </nav>
      <section aria-label={t("preview")} className="min-w-0 overflow-auto bg-muted/20 p-4">
        {previewLoading ? <Loader2 size={18} className="mx-auto my-8 animate-spin" /> : preview ? <ReportPrintView report={preview} filterValues={{}} preview />
          : <p className="mt-8 text-center text-xs text-muted-foreground">{t("choose")}</p>}
      </section>
    </div>
    <footer className="space-y-3 border-t border-border px-5 py-4">
      {error && <p role="alert" className="text-xs text-destructive">{t(error)}</p>}
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs leading-5 text-muted-foreground">{t("scope")}</p>
        {needsReload ? <Button variant="primary" size="md" type="button" disabled={busy} onClick={() => void reload()} className="shrink-0 px-4 py-2 text-xs">{t("reload")}</Button>
          : <Button variant="primary" size="md" type="button" disabled={busy || loading || previewLoading || !preview || preview.version === currentVersion || !!error} onClick={() => void restore()} className="shrink-0 px-4 py-2 text-xs">{t("restore")}</Button>}
      </div>
    </footer>
  </TaskDialog>;
}
