import { useLayoutEffect, useRef, useState, type RefObject } from "react";

type Mode = "write" | "compare" | "preview";
type FieldPosition = { value: string; start: number; end: number; direction: "forward" | "backward" | "none"; top: number; left: number };
function fieldPosition(field: HTMLInputElement | HTMLTextAreaElement | null): FieldPosition | null {
  return field ? { value: field.value, start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0,
    direction: field.selectionDirection ?? "none", top: field.scrollTop, left: field.scrollLeft } : null;
}
function restoreField(field: HTMLInputElement | HTMLTextAreaElement | null, position: FieldPosition | null) {
  // Undo or a draft update in preview may have replaced this text.
  if (!field || !position || field.value !== position.value) return;
  field.setSelectionRange(position.start, position.end, position.direction);
  field.scrollTop = position.top;
  field.scrollLeft = position.left;
}

export function useReportWritingMode(blockId: string, dialog: RefObject<HTMLDialogElement | null>) {
  const body = useRef<HTMLTextAreaElement>(null);
  const heading = useRef<HTMLInputElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const lastField = useRef<"heading" | "body">("body");
  const writingPosition = useRef<{ blockId: string; heading: FieldPosition | null; body: FieldPosition | null; top: number } | null>(null);
  const restoreWriting = useRef(false);
  const composing = useRef(false);
  const [mode, setMode] = useState<Mode>("write");
  const changeMode = (next: Mode) => {
    if (next === mode || composing.current) return;
    if (next === "preview") {
      writingPosition.current = { blockId, heading: fieldPosition(heading.current),
        body: fieldPosition(body.current), top: viewport.current?.scrollTop ?? 0 };
    }
    restoreWriting.current = mode === "preview";
    setMode(next);
  };
  useLayoutEffect(() => {
    if (!restoreWriting.current) return;
    restoreWriting.current = false;
    const position = writingPosition.current;
    if (!position || position.blockId !== blockId) return;
    const field = lastField.current === "heading" ? heading.current : body.current;
    if (field && !field.disabled && dialog.current?.contains(document.activeElement)) field.focus({ preventScroll: true });
    restoreField(heading.current, position.heading);
    restoreField(body.current, position.body);
    if (viewport.current) viewport.current.scrollTop = position.top;
  });

  return {
    body, heading, viewport, mode, changeMode,
    isComposing: () => composing.current,
    beginComposition: () => { composing.current = true; },
    endComposition: () => { composing.current = false; },
    focusHeading: () => { lastField.current = "heading"; },
    focusBody: () => { lastField.current = "body"; },
  };
}
