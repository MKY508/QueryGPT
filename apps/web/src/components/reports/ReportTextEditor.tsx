"use client";

import { useEffect, useId, useRef } from "react";
import { ArrowLeft, Columns2, Eye, Loader2, Pencil, Redo2, Save, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReportBlock } from "@/lib/reports";
import { reportBlockText } from "@/lib/report-text";
import { cn } from "@/lib/utils";
import { ReportBlockCard } from "./ReportBlockCard";
import { Button } from "@/components/ui/button";
import { containModalTab } from "@/lib/use-modal-focus";
import { useReportWritingMode } from "./useReportWritingMode";

const noop = () => {};
type ReportTextEditorProps = {
  block: ReportBlock; pageTitle: string; disabled: boolean; saving: boolean; saveDisabled: boolean;
  status: string; error?: string | null; warning?: string | null; canUndo: boolean; canRedo: boolean;
  onUndo: () => void; onRedo: () => void; onChange: (updates: Partial<ReportBlock>) => void;
  onSave: () => void; onClose: () => void;
};

/** A view of the report's live draft, not a second unsaved copy of its text. */
export function ReportTextEditor({ block, pageTitle, disabled, saving, saveDisabled, status, error, warning,
  canUndo, canRedo, onUndo, onRedo, onChange, onSave, onClose }: ReportTextEditorProps) {
  const t = useTranslations("reportWriting");
  const tWorkspace = useTranslations("reportWorkspace");
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const { body, heading, viewport, mode, changeMode, isComposing, beginComposition, endComposition, focusHeading, focusBody } = useReportWritingMode(block.id, dialog);
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;
    if (element && !element.open) {
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
    }
    body.current?.focus();
    return () => {
      if (element?.open && typeof element.close === "function") element.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [body]);

  const modes = [{ value: "write", icon: Pencil }, { value: "compare", icon: Columns2 }, { value: "preview", icon: Eye }] as const;
  return <dialog ref={dialog} data-report-editor-dialog data-report-history aria-modal="true" aria-labelledby={titleId}
    onCompositionStartCapture={beginComposition}
    onCompositionEndCapture={endComposition}
    onBlurCapture={endComposition}
    onCancel={(event) => { event.preventDefault(); if (!isComposing()) onClose(); }}
    onKeyDown={(event) => {
      if (event.defaultPrevented || isComposing() || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      containModalTab(event, event.currentTarget);
    }}
    className="m-auto h-[min(760px,90vh)] max-h-[90vh] w-[1120px] max-w-none overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/40">
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-[60px] shrink-0 items-center justify-between gap-4 border-b border-border px-5">
        <div className="flex min-w-0 items-center gap-4">
          <Button type="button" onClick={onClose} aria-label={t("back")} title={t("back")}
            variant="ghost" size="icon"><ArrowLeft size={18} /></Button>
          <div className="min-w-0"><h2 id={titleId} className="text-sm font-semibold text-primary">{t("title")}</h2>
            <p className="mt-1 max-w-64 truncate text-xs text-muted-foreground">{pageTitle}</p></div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" onClick={onUndo} disabled={!canUndo} aria-label={tWorkspace("undo")} title={tWorkspace("undo")}
            variant="ghost" size="icon"><Undo2 size={16} /></Button>
          <Button type="button" onClick={onRedo} disabled={!canRedo} aria-label={tWorkspace("redo")} title={tWorkspace("redo")}
            variant="ghost" size="icon"><Redo2 size={16} /></Button>
          <Button type="button" onClick={onSave} disabled={saveDisabled || saving} aria-keyshortcuts="Control+S Meta+S"
            className="ml-2">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}{tWorkspace(saving ? "saving" : "save")}</Button>
        </div>
      </header>
      <div role="group" aria-label={t("viewMode")} className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/20 px-5 py-2">
        {modes.map(({ value, icon: Icon }) => <Button key={value} type="button" aria-pressed={mode === value} onClick={() => changeMode(value)}
          variant="ghost" size="sm" className={mode === value ? "bg-primary/10 text-primary" : undefined}>
          <Icon size={14} />{t(value)}</Button>)}
      </div>
      <div ref={viewport} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className={cn("grid min-h-full", mode === "compare" && "grid-cols-2")}>
          {mode !== "preview" && <section aria-label={t("writingArea")} className="mx-auto flex min-h-[400px] w-full max-w-3xl flex-col gap-5 px-8 py-7">
            <input ref={heading} onFocus={focusHeading} value={block.title} maxLength={200} disabled={disabled} aria-label={t("heading")} placeholder={t("headingPlaceholder")}
              onChange={(event) => onChange({ title: event.target.value })}
              className="w-full min-w-0 border-0 bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/60 disabled:opacity-60" />
            <textarea ref={body} onFocus={focusBody} value={reportBlockText(block)} disabled={disabled} aria-label={t("body")} placeholder={t("bodyPlaceholder")}
              onChange={(event) => onChange({ content: { ...block.content, text: event.target.value } })}
              className="min-h-72 w-full flex-1 resize-none border-0 bg-transparent text-base leading-8 outline-none placeholder:text-muted-foreground/60 disabled:opacity-60" />
          </section>}
          {mode !== "write" && <section aria-label={t("previewArea")} className={cn("min-w-0 bg-muted/25 px-8 py-7", mode === "compare" && "border-l border-border")}>
            <div className="mx-auto max-w-3xl"><p className="mb-4 text-[11px] font-semibold text-muted-foreground">{t("previewArea")}</p>
              <ReportBlockCard block={block} editing={false} selected={false} staticRendering onSelect={noop} onMove={noop} onResize={noop} onDuplicate={noop} onDelete={noop} />
            </div>
          </section>}
        </div>
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs">
        <div className="min-w-0 flex-1">
          {error && <p role="alert" className="text-destructive">{error}</p>}
          {warning && <p role="alert" className={cn("text-warning", error && "mt-1")}>{warning}</p>}
          <p role="status" className={error || warning ? "sr-only" : "text-muted-foreground"}>{status}</p>
        </div>
        <Button type="button" onClick={onClose} variant="ghost" size="sm" className="ml-auto">{t("back")}</Button>
      </footer>
    </div>
  </dialog>;
}
