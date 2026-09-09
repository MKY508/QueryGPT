"use client";

import { useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useModalFocus } from "@/lib/use-modal-focus";
import { Button } from "@/components/ui/button";
import { TaskDialog } from "@/components/ui/TaskDialog";

export interface QuestionCursor {
  start: number; end: number; direction: "forward" | "backward" | "none"; scroll: number;
}
export function questionCursor(input: HTMLTextAreaElement): QuestionCursor {
  return { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection,
    scroll: input.scrollTop / Math.max(1, input.scrollHeight - input.clientHeight) };
}
function restoreCursor(input: HTMLTextAreaElement, cursor: QuestionCursor) {
  input.setSelectionRange(Math.min(cursor.start, input.value.length), Math.min(cursor.end, input.value.length), cursor.direction);
  input.scrollTop = cursor.scroll * Math.max(0, input.scrollHeight - input.clientHeight);
}

/** A larger view of the existing question draft, never a second draft or a
 * submission surface. Follows Zulip's expanded compose interaction. */
export function QuestionEditorDialog({ value, projectName, cursor, origin, canReturn, disabled,
  warning, onRetry, onChange, onClose }: {
  value: string; projectName?: string; cursor: QuestionCursor;
  origin: RefObject<HTMLTextAreaElement | null>; canReturn: () => boolean; disabled: boolean;
  warning?: "draftUnretained" | "draftUnreadable" | null;
  onRetry?: () => void; onChange: (value: string) => void; onClose: () => void;
}) {
  const t = useTranslations("inputBar");
  const dialog = useRef<HTMLDialogElement>(null), editor = useRef<HTMLTextAreaElement>(null);
  const writing = useRef(false), active = useRef(false);
  useModalFocus({ active: true, containerRef: dialog, initialFocusRef: editor, onClose });
  const initial = useRef({ cursor, origin, canReturn });
  useEffect(() => {
    const node = dialog.current, body = editor.current, { cursor, origin, canReturn } = initial.current;
    active.current = true;
    if (node && !node.open) node.showModal();
    if (body) { body.focus({ preventScroll: true }); restoreCursor(body, cursor); }
    return () => {
      const lastCursor = body ? questionCursor(body) : cursor;
      active.current = false;
      if (node?.open) node.close();
      const target = origin.current;
      if (canReturn() && target?.isConnected && !target.disabled) {
        if (target.getClientRects().length) target.focus({ preventScroll: true });
        restoreCursor(target, lastCursor);
      }
    };
  }, []);

  return createPortal(<TaskDialog dialogRef={dialog} writingRef={writing} activeRef={active} busy={false} autoFocusClose={false}
    title={t("editorTitle")} name={projectName} closeLabel={t("closeEditor")} onClose={onClose} onEscape={onClose}
    onDragOver={event => { event.stopPropagation(); if (Array.from(event.dataTransfer.types).includes("Files")) event.preventDefault(); }}
    onDrop={event => { event.stopPropagation(); if (event.dataTransfer.files.length) event.preventDefault(); }}>
    <div className="flex min-h-0 flex-1 bg-background px-10 py-6">
      <textarea ref={editor} value={value} disabled={disabled} aria-label={t("questionBody")} placeholder={t("placeholder")}
        onChange={event => onChange(event.target.value)} spellCheck
        className="question-editor-body mx-auto min-h-0 w-full max-w-[76ch] flex-1 resize-none rounded-xl border border-input bg-card px-8 py-6 text-base leading-8 outline-none placeholder:text-muted-foreground/70 focus-visible:border-primary disabled:opacity-60" />
    </div>
    <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-4">
      {warning ? <div role="alert" className="min-w-0 flex-1 text-xs leading-5 text-destructive"><p>{t(warning)}</p>{onRetry && <Button variant="ghost" size="sm" onClick={onRetry} className="mt-1 min-h-8 px-0 font-semibold text-primary">{t("retryDraftRetention")}</Button>}</div> : <span />}
      <Button onClick={onClose} className="ml-auto"><ArrowLeft size={15} />{t("finishEditing")}</Button>
    </footer>
  </TaskDialog>, document.body);
}
