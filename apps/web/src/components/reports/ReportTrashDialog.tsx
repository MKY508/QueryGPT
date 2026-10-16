"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { TaskDialog } from "@/components/ui/TaskDialog";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/SearchField";
import { listReportTrash, permanentlyDeleteReport, previewTrashedReport, restoreTrashedReport } from "@/lib/report-trash";
import { ReportConflictError, type ReportDocument, type ReportLibraryPage, type ReportListItem, type ReportSerializationCopy } from "@/lib/reports";
import { ReportPrintView } from "./ReportPrintView";
import { ReportLibraryLayout } from "./ReportLibraryLayout";

interface ReportTrashProps {
  projectId: string; copy: ReportSerializationCopy; onChanged: () => void; onClose: () => void;
}

export function ReportTrashDialog(props: ReportTrashProps) {
  return <ReportTrashSession key={props.projectId} {...props} />;
}

function ReportTrashSession({ projectId, copy, onChanged, onClose }: ReportTrashProps) {
  const t = useTranslations("reportTrash");
  const tIndex = useTranslations("reportIndex");
  const locale = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const initialFocus = useRef(true);
  const active = useRef(false);
  const writing = useRef(false);
  const listing = useRef(false);
  const reconcile = useRef(false);
  const listController = useRef<AbortController | null>(null);
  const previewController = useRef<AbortController | null>(null);
  const [directory, setDirectory] = useState<ReportLibraryPage | null>(null);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReportDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [armedPurge, setArmedPurge] = useState(false);
  const [error, setError] = useState<"readFailed" | "previewFailed" | "conflict" | "uncertain" | null>(null);
  const [notice, setNotice] = useState<"restored" | "purged" | null>(null);

  const readList = useCallback(async (page: number, query: string) => {
    listController.current?.abort(); previewController.current?.abort();
    const controller = new AbortController(); listController.current = controller;
    listing.current = true;
    try {
      const next = await listReportTrash(projectId, page, query, controller.signal);
      if (active.current && !controller.signal.aborted) {
        setDirectory(next); setAppliedSearch(query); setError(null); reconcile.current = false;
      }
    } catch {
      if (active.current && !controller.signal.aborted) setError(reconcile.current ? "uncertain" : "readFailed");
    } finally {
      if (active.current && !controller.signal.aborted) { listing.current = false; setLoading(false); }
    }
  }, [projectId]);

  const reloadList = (page: number, query: string) => {
    setLoading(true); setSelected(null); setPreview(null); setPreviewLoading(false); setArmedPurge(false);
    return readList(page, query);
  };

  useEffect(() => {
    active.current = true;
    const previous = document.activeElement;
    const element = dialog.current; element?.showModal();
    void readList(1, "");
    return () => {
      active.current = false; listController.current?.abort(); previewController.current?.abort(); element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [readList]);

  useEffect(() => {
    if (loading || !initialFocus.current) return;
    initialFocus.current = false;
    searchInput.current?.focus();
  }, [loading]);

  const choose = async (item: ReportListItem) => {
    if (writing.current || listing.current || reconcile.current) return;
    previewController.current?.abort();
    const controller = new AbortController(); previewController.current = controller;
    setSelected(item.id); setPreview(null); setPreviewLoading(true); setError(null); setNotice(null); setArmedPurge(false);
    try {
      const document = await previewTrashedReport(projectId, item.id, item.version, copy, controller.signal);
      if (active.current && !controller.signal.aborted) setPreview(document);
    } catch (failure) {
      if (active.current && !controller.signal.aborted) {
        reconcile.current = failure instanceof ReportConflictError;
        setError(reconcile.current ? "conflict" : "previewFailed");
      }
    } finally { if (active.current && !controller.signal.aborted) setPreviewLoading(false); }
  };

  const change = async (purge: boolean) => {
    if (writing.current || listing.current || reconcile.current || !preview || preview.id !== selected || error) return;
    if (purge && !armedPurge) { setArmedPurge(true); return; }
    writing.current = true; setBusy(true); setNotice(null);
    try {
      if (purge) await permanentlyDeleteReport(projectId, preview.id, preview.version);
      else await restoreTrashedReport(projectId, preview.id, preview.version, copy);
      if (!active.current) return;
      setNotice(purge ? "purged" : "restored");
      // Never leave an acknowledged removal selectable if the refetch fails.
      setDirectory(null); setPreview(null); setSelected(null); setArmedPurge(false);
      await reloadList(directory?.page ?? 1, appliedSearch);
    } catch (failure) {
      if (active.current) {
        reconcile.current = true;
        setArmedPurge(false);
        setError(failure instanceof ReportConflictError ? "conflict" : "uncertain");
      }
    } finally {
      writing.current = false;
      if (active.current) { setBusy(false); onChanged(); }
    }
  };
  const reload = (page = directory?.page ?? 1, query = appliedSearch) => {
    if (writing.current) return;
    void reloadList(page, query);
  };
  const blocked = busy || loading || error === "uncertain" || error === "conflict" || error === "readFailed";

  return <TaskDialog dialogRef={dialog} writingRef={writing} activeRef={active} busy={busy} autoFocusClose={false} title={t("title")} closeLabel={t("close")} onClose={onClose}
    actions={<Button variant="ghost" size="icon" disabled={busy || loading} aria-label={t("reload")} onClick={() => reload()}><RefreshCw size={16} /></Button>}>
    <ReportLibraryLayout directoryLabel={t("reports")} directory={<>
        <form role="search" aria-label={t("search")} onSubmit={(event) => { event.preventDefault(); reload(1, search.trim()); }} className="mb-4 flex gap-2">
          <SearchField inputRef={searchInput} label={t("search")} clearLabel={tIndex("clearSearch")} maxLength={200} value={search}
            onChange={setSearch} onQueryChange={value => { if (!value && (appliedSearch || listing.current)) reload(1, ""); }}
            disabled={busy} className="flex-1" onKeyDown={event => {
              if (event.key === "Enter" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
            }} />
          <Button variant="outline" size="md" type="submit" disabled={busy} className="text-xs">{t("find")}</Button>
        </form>
        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? <Loader2 aria-label={t("loading")} size={18} className="mx-auto my-4 animate-spin" /> : directory?.items.map((item) =>
            <Button variant="ghost" size="sm" type="button" key={item.id} aria-pressed={selected === item.id} disabled={blocked} onClick={() => void choose(item)}
              className="mb-1 block w-full p-3 text-left text-xs aria-pressed:bg-muted disabled:opacity-50 h-auto shrink-0">
              <span className="block truncate font-semibold">{item.title}</span>
              <span className="mt-1 block text-muted-foreground">{item.deleted_at && new Date(item.deleted_at).toLocaleString(locale)}</span>
              <span className="mt-1 block text-muted-foreground">{t("stats", { pages: item.page_count, blocks: item.block_count })}</span>
            </Button>)}
          {!loading && directory?.count === 0 && <p className="p-3 text-xs leading-5 text-muted-foreground">{t(appliedSearch ? "noMatches" : "empty")}</p>}
        </div>
        {!!directory && directory.page_count > 1 && <nav aria-label={t("pagination")} className="mt-3 flex items-center justify-between gap-2 text-xs">
          <Button variant="ghost" size="sm" type="button" aria-label={t("previous")} disabled={blocked || directory.page <= 1} onClick={() => reload(directory.page - 1)} className="p-1"><ChevronLeft size={16} /></Button>
          <span>{directory.page} / {directory.page_count}</span>
          <Button variant="ghost" size="sm" type="button" aria-label={t("next")} disabled={blocked || directory.page >= directory.page_count} onClick={() => reload(directory.page + 1)} className="p-1"><ChevronRight size={16} /></Button>
        </nav>}
      </>}>
      <section aria-label={t("preview")} className="min-h-0 min-w-0 flex-1 overflow-auto p-4">
        {previewLoading ? <Loader2 size={18} className="mx-auto my-8 animate-spin" /> : preview ? <ReportPrintView report={preview} filterValues={{}} preview />
          : <p className="mt-8 text-center text-xs text-muted-foreground">{t("choose")}</p>}
      </section>
    </ReportLibraryLayout>
    <footer className="shrink-0 space-y-3 border-t border-border px-5 py-4">
      {error && <p role="alert" className="text-xs text-destructive">{t(error)}</p>}
      {notice && <p role="status" className="text-xs">{t(notice)}</p>}
      {armedPurge && preview && <p role="alert" className="text-xs text-destructive">{t("purgeWarning", { title: preview.title })}</p>}
      <div className="flex items-center justify-between gap-6">
        <p className="min-w-0 text-xs leading-5 text-muted-foreground">{t("scope")}</p>
        <div className="flex shrink-0 gap-2">
          {armedPurge && <Button variant="ghost" size="md" type="button" disabled={busy} onClick={() => setArmedPurge(false)} className="text-xs">{t("cancel")}</Button>}
          <Button variant={armedPurge ? "destructive" : "outline"} size="md" type="button" disabled={blocked || previewLoading || !preview || !!error} onClick={() => void change(true)}
            className="text-xs">{t(armedPurge ? "confirmPurge" : "purge")}</Button>
          <Button variant="primary" size="md" type="button" disabled={blocked || previewLoading || !preview || !!error || armedPurge} onClick={() => void change(false)}
            className="text-xs">{t("restore")}</Button>
        </div>
      </div>
    </footer>
  </TaskDialog>;
}
