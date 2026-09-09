"use client";

import { useEffect, type RefObject } from "react";
import { reportHistoryField } from "@/lib/report-editor-fields";
import { hasModalDialog } from "@/lib/use-modal-focus";

// The writing dialog edits the same document; every other modal owns its task.
// Ordinary desktop panels need no exception to the shared modal boundary.
function otherModalOpen(target: EventTarget | null): boolean {
  const writer = target instanceof Element ? target.closest("dialog[open][data-report-editor-dialog]") : null;
  return hasModalDialog(writer);
}

export function useReportKeyboard({ editing, blocked, composing, onSave, onPrint, onHistory }: {
  editing: boolean; blocked: boolean; composing: RefObject<boolean>;
  onSave: () => void; onPrint: () => void; onHistory: (direction: "undo" | "redo") => void;
}) {
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || composing.current || event.keyCode === 229
        || event.altKey || !(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if ((key === "s" || key === "p") && !event.shiftKey) {
        // Also suppress the browser's Save Page / Print fallback behind a modal.
        event.preventDefault();
        if (!event.repeat && !blocked && !otherModalOpen(event.target)) (key === "s" ? onSave : onPrint)();
        return;
      }
      if ((key !== "z" && key !== "y") || !editing || blocked || otherModalOpen(event.target)) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
        && !reportHistoryField(target)) return;
      event.preventDefault();
      if (!event.repeat) onHistory(key === "y" || event.shiftKey ? "redo" : "undo");
    };
    const beforeInput = (event: InputEvent) => {
      if (event.defaultPrevented || event.isComposing || composing.current || !editing || blocked || otherModalOpen(event.target)
        || !reportHistoryField(event.target)) return;
      if (event.inputType !== "historyUndo" && event.inputType !== "historyRedo") return;
      event.preventDefault();
      onHistory(event.inputType === "historyUndo" ? "undo" : "redo");
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("beforeinput", beforeInput);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("beforeinput", beforeInput);
    };
  }, [editing, blocked, composing, onSave, onPrint, onHistory]);
}
