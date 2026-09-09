"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { TaskDialog } from "@/components/ui/TaskDialog";
import { Loader2 } from "lucide-react";
import { CSV_DELIMITERS, CSV_ENCODINGS, readCsv, sameCsvInput, type CsvDelimiter, type CsvEncoding, type CsvPreview, type CsvSelection } from "@/lib/csv-import";
import { PreparationPreviewTable } from "./PreparationPreviewTable";

interface Props {
  projectId: string;
  sourceId: string;
  name: string;
  canPrepare: boolean;
  previewOnly?: boolean;
  initialOptions?: unknown;
  onPrepare: (selection: CsvSelection) => Promise<void>;
  onRefreshSource: () => Promise<void>;
  onClose: () => void;
}

export function CsvNavigator({ projectId, sourceId, name, canPrepare, previewOnly = false, initialOptions, onPrepare, onRefreshSource, onClose }: Props) {
  const t = useTranslations("csvImport");
  const common = useTranslations("workbook");
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef(false);
  const writing = useRef(false);
  const [initial] = useState(() => initialOptions as { delimiter?: CsvDelimiter; encoding?: CsvEncoding; header_row?: number; has_header?: boolean; input_fingerprint?: string } | undefined);
  const initialHeaderPending = useRef(true);
  const [delimiter, setDelimiter] = useState<CsvDelimiter>(initial?.delimiter && CSV_DELIMITERS.includes(initial.delimiter) ? initial.delimiter : ",");
  const [encoding, setEncoding] = useState<CsvEncoding | null>(initial?.encoding && CSV_ENCODINGS.includes(initial.encoding) ? initial.encoding : null);
  const [startRow, setStartRow] = useState(1);
  const [rowInput, setRowInput] = useState("1");
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [header, setHeader] = useState<CsvSelection | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<"failed" | "uncertain" | null>(null);
  useEffect(() => {
    active.current = true;
    const element = dialog.current;
    element?.showModal();
    return () => { active.current = false; element?.close(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void readCsv(projectId, sourceId, delimiter, encoding, startRow, controller.signal).then((data) => {
      if (!active.current || controller.signal.aborted) return;
      setPreview(data);
      if (initialHeaderPending.current) {
        initialHeaderPending.current = false;
        if (initial?.input_fingerprint && /^[0-9a-f]{64}$/.test(initial.input_fingerprint)
          && (initial.has_header === false || (Number.isInteger(initial.header_row) && initial.header_row! >= 1 && initial.header_row! <= 1_000_000))) {
          setHeader({ kind: "csv", delimiter: initial.delimiter && CSV_DELIMITERS.includes(initial.delimiter) ? initial.delimiter : data.delimiter, encoding: initial.encoding && CSV_ENCODINGS.includes(initial.encoding) ? initial.encoding : data.encoding,
            source_revision: data.source_revision, input_fingerprint: initial.input_fingerprint,
            ...(initial.has_header === false ? { headerless: true } : { header_row: initial.header_row }) });
        }
      }
    }, () => { if (active.current && !controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [projectId, sourceId, delimiter, encoding, startRow, attempt, initial]);
  const reload = (row = startRow) => {
    if (writing.current) return;
    setStartRow(row); setRowInput(String(row)); setPreview(null); setFailed(false);
    setAttempt((value) => value + 1);
    if (writeError !== "uncertain") setWriteError(null);
  };
  const selection = (): CsvSelection | null => preview ? {
    kind: "csv", delimiter: preview.delimiter, encoding: preview.encoding,
    input_fingerprint: preview.input_fingerprint, source_revision: preview.source_revision,
  } : null;
  const selectHeader = (row?: number) => {
    const current = selection();
    if (writing.current || !current || (row !== undefined && (row > 1_000_000 || !preview?.nonempty_rows.includes(row)))) return;
    setHeader({ ...current, ...(row === undefined ? { headerless: true } : { header_row: row }) });
  };
  const stale = !!header && !!preview && !sameCsvInput(header, preview);
  const requestedRow = /^\d+$/.test(rowInput) ? Number(rowInput) : NaN;
  const validRow = Number.isInteger(requestedRow) && requestedRow >= 1 && requestedRow <= 1_000_000;
  const prepare = async () => {
    const current = selection();
    if (!current || writing.current || !canPrepare || writeError || stale || failed) return;
    writing.current = true; setBusy(true);
    try {
      await onPrepare({ ...current, ...(header?.headerless ? { headerless: true } : header ? { header_row: header.header_row } : {}) });
      if (active.current) onClose();
    } catch (error) {
      if (active.current) {
        const status = (error as { response?: { status?: number } })?.response?.status;
        setWriteError(previewOnly || (status && status >= 400 && status < 500 && status !== 408 && status !== 429) ? "failed" : "uncertain");
      }
    } finally { writing.current = false; if (active.current) setBusy(false); }
  };
  const refreshSource = async () => {
    if (writing.current) return;
    writing.current = true; setBusy(true);
    try { await onRefreshSource(); if (active.current) onClose(); }
    catch { /* Keep uncertain state after a failed read; never repeat the write. */ }
    finally { writing.current = false; if (active.current) setBusy(false); }
  };
  return <TaskDialog dialogRef={dialog} writingRef={writing} busy={busy} title={t("title")} name={name} closeLabel={t("close")} onClose={onClose}>
      <div className="flex flex-wrap items-center gap-5 border-b border-border px-5 py-3 text-xs">
        <label className="flex items-center gap-2">{t("delimiter")}<select value={delimiter} disabled={busy} onChange={(event) => { if (!writing.current) { setDelimiter(event.target.value as CsvDelimiter); reload(1); } }} className="rounded-md border border-border bg-background px-2 py-1">
          <option value=",">{t("comma")}</option><option value=";">{t("semicolon")}</option><option value={"\t"}>{t("tab")}</option><option value="|">{t("pipe")}</option>
        </select></label>
        <label className="flex items-center gap-2">{t("encoding")}<select value={encoding || "auto"} disabled={busy} onChange={(event) => { if (!writing.current) { setEncoding(event.target.value === "auto" ? null : event.target.value as CsvEncoding); reload(1); } }} className="rounded-md border border-border bg-background px-2 py-1">
          <option value="auto">{common("automatic")}</option><option value="utf-8-sig">UTF-8</option><option value="gb18030">GB18030</option>
        </select></label>
        <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); if (validRow) reload(requestedRow); }}>
          <label htmlFor="csv-start-row">{t("startRow")}</label><input id="csv-start-row" type="number" min={1} max={1_000_000} value={rowInput} disabled={busy} onChange={(event) => setRowInput(event.target.value)} className="w-24 rounded-md border border-border bg-background px-2 py-1" />
          <Button variant="ghost" size="sm" type="submit" disabled={busy || !validRow}>{common("goToRow")}</Button>
        </form>
        <Button variant="ghost" size="sm" type="button" disabled={busy || startRow <= 1} onClick={() => reload(Math.max(1, startRow - 12))}>{t("previous")}</Button>
        <Button variant="ghost" size="sm" type="button" disabled={busy || !preview?.has_more_rows || startRow >= 1_000_000} onClick={() => reload(Math.min(1_000_000, startRow + 12))}>{t("next")}</Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3 text-xs">
        <p>{header?.headerless ? t("headerlessSelected") : header ? t("headerSelected", { row: header.header_row!, count: header.header_row! - 1 }) : t("headerAutomatic")}</p>
        <div className="flex gap-3"><Button variant="ghost" size="sm" type="button" disabled={busy || !preview} aria-pressed={!!header?.headerless} onClick={() => selectHeader()}>{common("headerless")}</Button>{header && <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => setHeader(null)}>{common("automatic")}</Button>}</div>
        {stale && <p role="alert" className="w-full text-destructive">{t("headerChanged")}</p>}
      </div>
      {failed ? <p role="alert" className="p-5 text-xs text-destructive">{t("previewFailed")} <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => reload()} className="ml-2">{common("retry")}</Button></p>
        : !preview ? <p role="status" className="flex items-center gap-2 p-5 text-xs text-muted-foreground"><Loader2 size={15} className="animate-spin" />{t("loading")}</p>
          : <><p className="border-b border-border px-5 py-3 text-xs text-muted-foreground">{preview.rows.length ? t("sample", { from: preview.start_row, to: preview.start_row + preview.rows.length - 1 }) : common("empty")}{preview.truncated_columns || preview.truncated_cells ? ` · ${common("shortened")}` : ""}</p><PreparationPreviewTable preview={preview} headerRow={stale ? undefined : header?.header_row} busy={busy} label={t("preview")} rowLabel={t("record")} emptyLabel={common("empty")} headerLabel={(row) => t("useHeader", { row })} onSelectHeader={selectHeader} /></>}
      {writeError && <p role="alert" className="border-t border-border px-5 py-3 text-xs text-destructive">{previewOnly ? common("previewOnlyFailed") : writeError === "uncertain" ? common("uncertain") : t("prepareFailed")}</p>}
      <footer className="mt-auto flex items-center justify-between gap-4 border-t border-border px-5 py-4">
        <p className="text-xs text-muted-foreground">{previewOnly ? common("previewOnlyScope") : t("scope")}</p>
        {writeError === "uncertain" ? <Button variant="outline" size="md" type="button" disabled={busy} onClick={() => void refreshSource()}>{common("refreshSource")}</Button>
          : writeError === "failed" ? <Button variant="outline" size="md" type="button" disabled={busy} onClick={() => reload()}>{common("previewAgain")}</Button>
            : <Button variant="primary" size="md" type="button" disabled={busy || !canPrepare || !preview || failed || stale} onClick={() => void prepare()}>{busy && <Loader2 size={14} className="animate-spin" />}{previewOnly ? common("previewOnlyAction") : t("prepare")}</Button>}
      </footer>
  </TaskDialog>;
}
