"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { PreparationDialog } from "./PreparationDialog";
import { Loader2 } from "lucide-react";
import { readWorkbook, type WorkbookPreview, type WorkbookSelection } from "@/lib/workbook";
import { PreparationPreviewTable } from "./PreparationPreviewTable";

interface Props {
  projectId: string;
  sourceId: string;
  name: string;
  canPrepare: boolean;
  previewOnly?: boolean;
  onPrepare: (selection: WorkbookSelection) => Promise<void>;
  onRefreshSource: () => Promise<void>;
  onClose: () => void;
}

/** A project/source-keyed navigator: changing tabs never submits a preparation. */
export function WorkbookNavigator({ projectId, sourceId, name, canPrepare, previewOnly = false, onPrepare, onRefreshSource, onClose }: Props) {
  const t = useTranslations("workbook");
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef(false);
  const writing = useRef(false);
  const [sheet, setSheet] = useState<string | null>(null);
  const [startRow, setStartRow] = useState(1);
  const [rowInput, setRowInput] = useState("1");
  const [header, setHeader] = useState<WorkbookSelection | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [catalog, setCatalog] = useState<WorkbookPreview["sheets"]>([]);
  const [preview, setPreview] = useState<WorkbookPreview | null>(null);
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
    void readWorkbook(projectId, sourceId, sheet, controller.signal, startRow).then((result) => {
      if (!active.current || controller.signal.aborted) return;
      setCatalog(result.sheets);
      setPreview(result);
    }, () => { if (active.current && !controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [projectId, sourceId, sheet, startRow, attempt]);

  const choose = (value: string | null, row = value === sheet ? startRow : 1) => {
    if (writing.current) return;
    if (value !== sheet) setHeader(null);
    setSheet(value);
    setStartRow(row);
    setRowInput(String(row));
    setPreview(null);
    setFailed(false);
    setAttempt((current) => current + 1);
    if (writeError !== "uncertain") setWriteError(null);
  };
  const headerStale = !!header && !!preview && (header.sheet !== preview.selected_sheet
    || header.input_fingerprint !== preview.input_fingerprint || header.source_revision !== preview.source_revision);
  const selectHeader = (row: number) => {
    if (writing.current || row > 1_000_000 || !preview?.selected_sheet || !preview.nonempty_rows.includes(row)) return;
    setHeader({ sheet: preview.selected_sheet, header_row: row, input_fingerprint: preview.input_fingerprint, source_revision: preview.source_revision });
  };
  const requestedRow = /^\d+$/.test(rowInput) ? Number(rowInput) : NaN;
  const selectGeneratedHeaders = () => {
    if (writing.current || !preview?.selected_sheet) return;
    setHeader({ sheet: preview.selected_sheet, headerless: true, input_fingerprint: preview.input_fingerprint, source_revision: preview.source_revision });
  };
  const validRow = Number.isInteger(requestedRow) && requestedRow >= 1 && requestedRow <= 1_000_000;
  const prepare = async () => {
    if (!preview?.selected_sheet || preview.selected_sheet !== sheet || !canPrepare || writing.current || writeError || headerStale) return;
    writing.current = true;
    setBusy(true);
    setWriteError(null);
    try {
      await onPrepare({ sheet: preview.selected_sheet, input_fingerprint: preview.input_fingerprint, source_revision: preview.source_revision, ...(header?.headerless ? { headerless: true } : header ? { header_row: header.header_row } : {}) });
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
    writing.current = true;
    setBusy(true);
    try { await onRefreshSource(); if (active.current) onClose(); }
    catch { /* Preserve the unconfirmed state until a successful source read. */ }
    finally { writing.current = false; if (active.current) setBusy(false); }
  };
  return <PreparationDialog dialogRef={dialog} writingRef={writing} busy={busy} title={t("title")} name={name} closeLabel={t("close")} onClose={onClose}>
      <div className="flex min-h-0 flex-1">
        <aside className="w-56 shrink-0 overflow-auto border-r border-border p-3" aria-label={t("sheets")}>
          <p className="mb-2 px-2 text-xs font-semibold text-muted-foreground">{t("sheets")}</p>
          {catalog.map((item) => <Button variant="ghost" size="sm" type="button" key={item.name} disabled={busy} aria-pressed={sheet === item.name}
            aria-label={item.hidden ? `${item.name} (${t("hidden")})` : item.name}
            onClick={() => choose(item.name)} className={`block w-full break-words px-3 py-2 text-left text-xs disabled:opacity-45 ${sheet === item.name ? "bg-muted font-semibold" : "hover:bg-muted/60"}`}>
            {item.name}{item.hidden && <span className="ml-2 text-[10px] font-normal text-muted-foreground">{" "}{t("hidden")}</span>}
          </Button>)}
        </aside>
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {sheet && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 text-xs">
            <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); if (validRow) choose(sheet, requestedRow); }}>
              <label htmlFor="workbook-start-row">{t("startRow")}</label>
              <input id="workbook-start-row" type="number" min={1} max={1_000_000} step={1} value={rowInput} disabled={busy} onChange={(event) => setRowInput(event.target.value)} className="w-24 rounded-md border border-border bg-background px-2 py-1" />
              <Button variant="ghost" size="sm" type="submit" disabled={busy || !validRow}>{t("goToRow")}</Button>
            </form>
            <div className="flex gap-3">
              <Button variant="ghost" size="sm" type="button" disabled={busy || startRow <= 1} onClick={() => choose(sheet, Math.max(1, startRow - 12))}>{t("previousRows")}</Button>
              <Button variant="ghost" size="sm" type="button" disabled={busy || !preview?.has_more_rows || startRow >= 1_000_000} onClick={() => choose(sheet, Math.min(1_000_000, startRow + 12))}>{t("nextRows")}</Button>
            </div>
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <p>{header?.headerless ? t("headerlessSelected") : header ? t("headerSelected", { row: header.header_row!, count: header.header_row! - 1 }) : t("headerAutomatic")}</p>
              <div className="flex gap-3">
                <Button variant="ghost" size="sm" type="button" disabled={busy || !preview?.selected_sheet} aria-pressed={!!header?.headerless} onClick={selectGeneratedHeaders}>{t("headerless")}</Button>
                {header && <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => setHeader(null)}>{t("automatic")}</Button>}
              </div>
            </div>
            {headerStale && <p role="alert" className="w-full text-destructive">{t("headerChanged")}</p>}
          </div>}
          {failed ? <p role="alert" className="p-5 text-xs text-destructive">{t("previewFailed")} <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => choose(sheet)} className="ml-2">{t("retry")}</Button></p>
            : !preview ? <p role="status" className="flex items-center gap-2 p-5 text-xs text-muted-foreground"><Loader2 size={15} className="animate-spin" />{t("loading")}</p>
              : !sheet ? <p className="p-5 text-sm text-muted-foreground">{t("choose")}</p>
                : <>
                  <p className="border-b border-border px-4 py-3 text-xs text-muted-foreground">{preview.rows.length ? t("sample", { from: preview.start_row, to: preview.start_row + preview.rows.length - 1 }) : t("empty")}{preview.truncated_columns || preview.truncated_cells ? ` · ${t("shortened")}` : ""}</p>
                  {preview.missing_formula_results > 0 && <p className="border-b border-border px-4 py-3 text-xs text-warning">{t("missingFormula")}</p>}
                  <PreparationPreviewTable preview={preview} headerRow={headerStale ? undefined : header?.header_row} busy={busy} label={t("preview")} rowLabel={t("row")} emptyLabel={t("empty")} headerLabel={(row) => t("useHeader", { row })} onSelectHeader={selectHeader} />
                </>}
        </section>
      </div>
      {writeError && <p role="alert" className="border-t border-border px-5 py-3 text-xs leading-5 text-destructive">{t(previewOnly ? "previewOnlyFailed" : writeError === "uncertain" ? "uncertain" : "prepareFailed")}</p>}
      <footer className="flex items-center justify-between gap-4 border-t border-border px-5 py-4">
        <p className="text-xs text-muted-foreground">{t(previewOnly ? "previewOnlyScope" : "scope")}</p>
        {writeError === "uncertain" ? <Button variant="outline" size="md" type="button" disabled={busy} onClick={() => void refreshSource()}>{t("refreshSource")}</Button>
          : writeError === "failed" ? <Button variant="outline" size="md" type="button" disabled={busy} onClick={() => choose(sheet)}>{t("previewAgain")}</Button>
          : <Button variant="primary" size="md" type="button" disabled={busy || !canPrepare || !sheet || preview?.selected_sheet !== sheet || failed || headerStale} onClick={() => void prepare()}>{busy && <Loader2 size={14} className="animate-spin" />}{t(previewOnly ? "previewOnlyAction" : "prepare")}</Button>}
      </footer>
  </PreparationDialog>;
}
