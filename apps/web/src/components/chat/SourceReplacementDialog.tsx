"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { PreparationDialog } from "./PreparationDialog";
import { Loader2 } from "lucide-react";
import { getErrorHttpStatus, type ProjectDataSource } from "@/lib/types/api";
import { previewSourceReplacement, type ReplacementPreview, type ReplacementRequest, type ReplacementSelection } from "@/lib/source-replacement";
import { CleaningSamples } from "./CleaningSamples";
import { CsvNavigator } from "./CsvNavigator";
import { WorkbookNavigator } from "./WorkbookNavigator";

interface Props {
  projectId: string;
  source: ProjectDataSource;
  candidates: ProjectDataSource[];
  canApply: boolean;
  onApply: (request: ReplacementRequest & { proof: string }) => Promise<void>;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}

/** Mounted with a project/current-source key; no writes happen on selection. */
export function SourceReplacementDialog({ projectId, source, candidates, canApply, onApply, onRefresh, onClose }: Props) {
  const t = useTranslations("sourceReplacement");
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef(false);
  const writing = useRef(false);
  const request = useRef<AbortController | null>(null);
  const [candidateId, setCandidateId] = useState("");
  const [selection, setSelection] = useState<ReplacementSelection | undefined>();
  const [readerOpen, setReaderOpen] = useState(false);
  const [preview, setPreview] = useState<ReplacementPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"previewFailed" | "applyFailed" | "uncertain" | null>(null);
  const candidate = candidates.find((item) => item.id === candidateId);
  const canRead = !!candidate && /\.(csv|xlsx|xls)$/i.test(candidate.name);
  const Navigator = candidate && /\.csv$/i.test(candidate.name) ? CsvNavigator : WorkbookNavigator;
  useEffect(() => {
    active.current = true;
    const element = dialog.current;
    element?.showModal();
    return () => { active.current = false; request.current?.abort(); element?.close(); };
  }, []);
  const choose = (id: string) => {
    if (writing.current || error === "uncertain") return;
    request.current?.abort(); setPending(false); setPreview(null); setError(null);
    setCandidateId(id); setSelection(undefined); setReaderOpen(false);
  };
  const loadPreview = async (reader = selection) => {
    if (!candidate || writing.current || error === "uncertain") return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setPending(true); setPreview(null); setError(null); setSelection(reader);
    try {
      const result = await previewSourceReplacement(projectId, source.id, { candidate_source_id: candidate.id, ...(reader ? { selection: reader } : {}) }, controller.signal);
      if (active.current && !controller.signal.aborted) setPreview(result);
    } catch {
      if (active.current && !controller.signal.aborted) setError("previewFailed");
    } finally { if (active.current && !controller.signal.aborted) setPending(false); }
  };
  const apply = async () => {
    if (writing.current || !canApply || !preview?.can_apply || !candidate || preview.candidate_source_id !== candidate.id || error || pending) return;
    writing.current = true; setBusy(true);
    try {
      await onApply({ candidate_source_id: candidate.id, ...(selection ? { selection } : {}), proof: preview.proof });
      if (active.current) onClose();
    } catch (reason) {
      if (active.current) {
        const status = getErrorHttpStatus(reason);
        setError(status && status >= 400 && status < 500 && status !== 408 && status !== 429 ? "applyFailed" : "uncertain");
        setPreview(null);
      }
    } finally { writing.current = false; if (active.current) setBusy(false); }
  };
  const refresh = async () => {
    if (writing.current) return;
    writing.current = true; setBusy(true);
    try { await onRefresh(); if (active.current) onClose(); }
    catch { /* A failed read cannot turn an uncertain write into a retry. */ }
    finally { writing.current = false; if (active.current) setBusy(false); }
  };
  return <>
    <PreparationDialog dialogRef={dialog} writingRef={writing} busy={busy} blockCancel={readerOpen} name={source.name} title={t("title")} closeLabel={t("close")} onClose={onClose}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        {candidates.length === 0 ? <p className="text-sm">{t("noCandidates")}</p> : <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-52 flex-1 flex-col gap-2 text-xs">{t("newFile")}<select value={candidateId} disabled={busy || error === "uncertain"} onChange={(event) => choose(event.target.value)} className="rounded-md border border-border bg-background px-3 py-2 text-sm"><option value="">{t("choose")}</option>{candidates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {canRead && <Button variant="outline" type="button" disabled={busy || pending || error === "uncertain"} onClick={() => setReaderOpen(true)}>{t("readerSettings")}</Button>}
          <Button variant="outline" type="button" disabled={!candidate || busy || pending || error === "uncertain"} onClick={() => void loadPreview()}>{pending && <Loader2 size={14} className="animate-spin" />}{t("preview")}</Button>
        </div>}
        {error && <p role="alert" className="text-sm text-destructive">{t(error)}</p>}
        {preview && candidate && preview.candidate_source_id === candidate.id && <>
          <CleaningSamples before={preview.before} after={preview.after} comparisonLabels={[t("current"), t("next")]} />
          <div className="space-y-1 text-sm">
            {preview.input_rows !== preview.after.rows && <p>{t("cleanedRows", { before: preview.input_rows, after: preview.after.rows })}</p>}
            {preview.added_columns.length > 0 && <p>{t("added", { columns: preview.added_columns.join("、") })}</p>}
            {preview.removed_columns.length > 0 && <p className="text-warning">{t("removed", { columns: preview.removed_columns.join("、") })}</p>}
            {preview.type_changes.length > 0 && <p className="text-warning">{t("types", { columns: preview.type_changes.map((item) => item.column).join("、") })}</p>}
            {!preview.added_columns.length && !preview.removed_columns.length && !preview.type_changes.length && <p className="text-muted-foreground">{t("sameColumns")}</p>}
            {preview.unresolved_questions > 0 && <p className="text-warning">{t("questions", { count: preview.unresolved_questions })}</p>}
            {!preview.can_apply && <p role="alert" className="text-destructive">{t("incompatible")}</p>}
          </div>
        </>}
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-border p-5"><p className="text-xs text-muted-foreground">{t("retained")}</p>
        {error === "uncertain" ? <Button variant="outline" type="button" disabled={busy} onClick={() => void refresh()}>{t("refresh")}</Button>
          : <Button variant="primary" type="button" disabled={busy || pending || !canApply || !preview?.can_apply || !!error || !candidate || preview.candidate_source_id !== candidate.id} onClick={() => void apply()}>{busy && <Loader2 size={14} className="animate-spin" />}{t("apply")}</Button>}
      </footer>
    </PreparationDialog>
    {readerOpen && candidate && <Navigator key={`${projectId}:${candidate.id}`} projectId={projectId} sourceId={candidate.id} name={candidate.name} canPrepare={!busy} previewOnly onPrepare={async (reader: ReplacementSelection) => { await loadPreview(reader); }} onRefreshSource={onRefresh} onClose={() => setReaderOpen(false)} />}
  </>;
}
