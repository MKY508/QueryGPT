"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { hasModalDialog } from "@/lib/use-modal-focus";
import { TaskDialog } from "@/components/ui/TaskDialog";
import { Button } from "@/components/ui/button";

function visibleOrigin(origin: HTMLElement | null): origin is HTMLElement {
  if (!origin?.isConnected || origin.closest('[hidden], [inert], dialog:not([open])')) return false;
  for (let node: HTMLElement | null = origin; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
  }
  return true;
}

export function PromptInsertionDialog({ current, incoming, onCancel, onAppend, onReplace, canReturn, onFallbackFocus }: {
  current: string; incoming: string;
  onCancel: () => void; onAppend: () => void; onReplace: () => void;
  canReturn: () => boolean;
  onFallbackFocus: () => void;
}) {
  const t = useTranslations("promptInsertion");
  const common = useTranslations("common");
  const id = useId(), dialogRef = useRef<HTMLDialogElement>(null), cancelRef = useRef<HTMLButtonElement>(null);
  const writing = useRef(false), active = useRef(false);
  const returnFocus = useRef({ canReturn, onFallbackFocus });
  useEffect(() => { returnFocus.current = { canReturn, onFallbackFocus }; }, [canReturn, onFallbackFocus]);
  useEffect(() => {
    const dialog = dialogRef.current;
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    active.current = true;
    if (dialog && !dialog.open) dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      active.current = false;
      if (dialog?.open) dialog.close();
      if (returnFocus.current.canReturn() && !hasModalDialog()) {
        if (visibleOrigin(origin)) origin.focus({ preventScroll: true });
        else returnFocus.current.onFallbackFocus();
      }
    };
  }, []);

  return createPortal(<TaskDialog dialogRef={dialogRef} writingRef={writing} activeRef={active} busy={false} autoFocusClose={false} size="compact"
    title={t("title")} describedBy={`${id}-description`} closeLabel={common("close")} onClose={onCancel} onEscape={onCancel}
    onDragOver={event => { event.stopPropagation(); if (Array.from(event.dataTransfer.types).includes("Files")) event.preventDefault(); }}
    onDrop={event => { event.stopPropagation(); if (event.dataTransfer.files.length) event.preventDefault(); }}>
    <div tabIndex={0} role="region" aria-label={t("preview")} className="min-h-0 overflow-y-auto overscroll-contain p-5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
      <p id={`${id}-description`} className="mb-5 text-sm leading-6 text-muted-foreground">{t("description")}</p>
      <div className="grid grid-cols-2 gap-5">
        <section className="min-w-0">
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{t("current")}</h3>
          <p data-testid="prompt-current-preview" className="whitespace-pre-wrap break-words rounded-xl border border-border bg-muted/30 p-4 text-sm leading-7 [overflow-wrap:anywhere]">{current}</p>
        </section>
        <section className="min-w-0">
          <h3 className="mb-2 text-xs font-semibold text-primary">{t("incoming")}</h3>
          <p data-testid="prompt-incoming-preview" className="whitespace-pre-wrap break-words rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm leading-7 [overflow-wrap:anywhere]">{incoming}</p>
        </section>
      </div>
    </div>
    <footer className="flex shrink-0 gap-2 border-t border-border px-5 py-4">
      <Button ref={cancelRef} variant="ghost" onClick={onCancel} className="mr-auto">{t("cancel")}</Button>
      <Button onClick={onAppend}>{t("append")}</Button>
      <Button variant="outline" onClick={onReplace}>{t("replace")}</Button>
    </footer>
  </TaskDialog>, document.body);
}
