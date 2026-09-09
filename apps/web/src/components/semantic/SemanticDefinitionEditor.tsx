"use client";

import { useEffect, useRef, type FormEventHandler, type ReactNode, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { TaskDialog } from "@/components/ui/TaskDialog";
import { Button } from "@/components/ui/button";
import { useModalFocus } from "@/lib/use-modal-focus";

/** Owns the desktop editor window, not the definition draft or persistence. */
export function SemanticDefinitionEditor({ editing, busy, dirty, saveBlocked, writingRef, initialFocusRef, onClose, onSubmit, confirmation, children }: {
  editing: boolean; busy: boolean; dirty: boolean; saveBlocked: boolean;
  writingRef: RefObject<boolean>; initialFocusRef: RefObject<HTMLInputElement | null>;
  onClose: () => void; onSubmit: FormEventHandler<HTMLFormElement>;
  confirmation?: ReactNode; children: ReactNode;
}) {
  const t = useTranslations("projectUnderstanding");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const activeRef = useRef(true);
  const requestClose = () => { if (!writingRef.current) onClose(); };
  useModalFocus({ active: true, containerRef: dialogRef, initialFocusRef, onClose: requestClose });
  useEffect(() => {
    activeRef.current = true;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      activeRef.current = false;
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <TaskDialog dialogRef={dialogRef} writingRef={writingRef} activeRef={activeRef} busy={busy}
      title={t(editing ? "editor.editTitle" : "editor.addTitle")} closeLabel={t("editor.close")}
      autoFocusClose={false} onClose={requestClose} onEscape={requestClose}>
      <form onSubmit={event => {
        if (writingRef.current || saveBlocked) { event.preventDefault(); return; }
        onSubmit(event);
      }} aria-busy={busy} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-6 py-4">
          <span role="status" className="mr-auto text-xs text-muted-foreground">
            {busy ? t("editor.saving") : dirty ? t("editor.unsaved") : ""}
          </span>
          <Button variant="ghost" disabled={busy} onClick={requestClose}>{t("actions.cancel")}</Button>
          <Button type="submit" disabled={busy || saveBlocked}>
            {busy && <Loader2 size={14} className="animate-spin" />}
            {t(editing ? "actions.saveChanges" : "actions.submitAddDefinition")}
          </Button>
        </footer>
      </form>
      {confirmation}
    </TaskDialog>
  );
}
