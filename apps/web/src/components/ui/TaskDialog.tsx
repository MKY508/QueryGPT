"use client";

import type { ReactNode, RefObject } from "react";
import { X } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

/** Desktop task frame. Callers own requests, session identity and native opening. */
export function TaskDialog({ dialogRef, writingRef, activeRef, busy, blockCancel = false, title, name, closeLabel, onClose, onEscape, actions, size = "wide", children }: {
  dialogRef: RefObject<HTMLDialogElement | null>; writingRef: RefObject<boolean>;
  activeRef?: RefObject<boolean>;
  busy: boolean; title: string; name?: string; closeLabel: string;
  blockCancel?: boolean; size?: "wide" | "compact"; actions?: ReactNode;
  onClose: () => void; onEscape?: () => void; children: ReactNode;
}) {
  const close = () => { if (!writingRef.current && (!activeRef || activeRef.current)) onClose(); };
  return <dialog ref={dialogRef} aria-label={title} aria-modal="true"
    onClose={event => { if (!event.currentTarget.open) close(); }}
    onCancel={event => {
      if (writingRef.current || blockCancel) event.preventDefault();
      else if (onEscape) { event.preventDefault(); onEscape(); }
    }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) {
        event.preventDefault(); return;
      }
      if (event.key === "Escape" && onEscape) {
        event.preventDefault();
        if (!writingRef.current && !blockCancel) onEscape();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && ["s", "p"].includes(event.key.toLowerCase())) event.preventDefault();
    }}
    className={cn("report-screen-view m-auto max-h-[90vh] max-w-none overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/40",
      size === "wide" ? "h-[min(760px,90vh)] w-[1120px]" : "w-[760px]")}>
    <div className={cn("flex min-h-0 flex-col", size === "wide" ? "h-full" : "max-h-[90vh]")}>
      <header className="flex h-[60px] shrink-0 items-center justify-between gap-4 border-b border-border px-5">
        <div className="min-w-0"><h2 className="text-sm font-semibold">{title}</h2>{name && <p className="mt-1 truncate text-xs text-muted-foreground">{name}</p>}</div>
        <div className="flex shrink-0 items-center gap-2">{actions}<Button autoFocus variant="ghost" size="icon" disabled={busy} onClick={close} aria-label={closeLabel}><X size={17} /></Button></div>
      </header>
      {children}
    </div>
  </dialog>;
}
