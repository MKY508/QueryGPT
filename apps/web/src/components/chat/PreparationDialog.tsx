"use client";

import type { ReactNode, RefObject } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Shared desktop frame; each task owns its read and write lifecycle. */
export function PreparationDialog({ dialogRef, writingRef, busy, blockCancel = false, title, name, closeLabel, onClose, children }: {
  dialogRef: RefObject<HTMLDialogElement | null>; writingRef: RefObject<boolean>;
  busy: boolean; title: string; name: string; closeLabel: string;
  blockCancel?: boolean;
  onClose: () => void; children: ReactNode;
}) {
  return <dialog ref={dialogRef} aria-label={title}
    onClose={event => { if (!event.currentTarget.open) onClose(); }}
    onCancel={event => { if (writingRef.current || blockCancel) event.preventDefault(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) {
        event.preventDefault(); event.stopPropagation(); return;
      }
      if ((event.metaKey || event.ctrlKey) && ["s", "p"].includes(event.key.toLowerCase())) event.preventDefault();
    }}
    className="report-screen-view m-auto h-[min(760px,90vh)] max-h-[90vh] w-[1120px] max-w-none overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/40">
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-[60px] shrink-0 items-center justify-between gap-4 border-b border-border px-5">
        <div className="min-w-0"><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 truncate text-xs text-muted-foreground">{name}</p></div>
        <Button autoFocus variant="ghost" size="icon" disabled={busy} onClick={onClose} aria-label={closeLabel}><X size={17} /></Button>
      </header>
      {children}
    </div>
  </dialog>;
}
