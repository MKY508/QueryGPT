"use client";

import { useEffect, useId, useRef, type RefObject } from "react";
import { Button } from "./button";

export function DiscardChangesDialog({ title, description, continueLabel, discardLabel, disabled, fallbackFocus, onContinue, onDiscard }: {
  title: string; description: string; continueLabel: string; discardLabel: string;
  disabled: boolean;
  fallbackFocus: RefObject<HTMLElement | null>;
  onContinue: () => void;
  onDiscard: () => void;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const discardRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const parent = origin?.closest("dialog");
    const fallback = fallbackFocus.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    // APG: initial focus stays on the least destructive action.
    continueRef.current?.focus();
    return () => {
      if (dialog?.open && typeof dialog.close === "function") dialog.close();
      // Do not return into an editor that is itself being closed/unmounted.
      if (parent?.open) (origin?.isConnected ? origin : fallback)?.focus({ preventScroll: true });
    };
  }, [fallbackFocus]);

  return <dialog ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    className="m-auto max-h-[88dvh] w-[460px] max-w-none overflow-y-auto rounded-xl border border-border bg-card p-6 text-foreground shadow-2xl backdrop:bg-black/40"
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onContinue(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
        if (event.key === "Escape") event.preventDefault();
        return;
      }
      if (event.key !== "Tab") return;
      if (event.shiftKey && document.activeElement === continueRef.current) {
        event.preventDefault(); (disabled ? continueRef : discardRef).current?.focus();
      } else if (!event.shiftKey && document.activeElement === (disabled ? continueRef.current : discardRef.current)) {
        event.preventDefault(); continueRef.current?.focus();
      }
    }}>
    <h3 id={`${id}-title`} className="text-base font-semibold">{title}</h3>
    <p id={`${id}-description`} className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
    <div className="mt-6 flex justify-end gap-2">
      <Button ref={continueRef} onClick={onContinue}>{continueLabel}</Button>
      <Button ref={discardRef} variant="outline" onClick={onDiscard} disabled={disabled}
        className="text-destructive hover:border-destructive/50 hover:bg-destructive/5">{discardLabel}</Button>
    </div>
  </dialog>;
}
