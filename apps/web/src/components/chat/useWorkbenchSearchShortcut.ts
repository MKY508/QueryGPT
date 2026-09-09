"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { hasModalDialog } from "@/lib/use-modal-focus";

/** Native/task dialogs own keyboard actions while the workbench is covered. */
export function useWorkbenchSearchShortcut(root: RefObject<HTMLElement | null>, search: RefObject<HTMLInputElement | null>, onReveal: () => void) {
  const reveal = useRef(onReveal);
  useLayoutEffect(() => { reveal.current = onReveal; }, [onReveal]);
  useEffect(() => {
    let frame: number | null = null;
    const blocked = () => !root.current?.isConnected || !!root.current.closest("[inert]")
      || hasModalDialog(search.current?.closest("dialog"));
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || event.shiftKey
        || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      if (event.repeat || blocked()) return;
      if (frame !== null) cancelAnimationFrame(frame);
      const previousFocus = document.activeElement;
      reveal.current();
      frame = requestAnimationFrame(() => {
        frame = null;
        if (blocked() || !search.current?.isConnected) return;
        const navigation = search.current.closest("dialog");
        if (document.activeElement !== previousFocus && document.activeElement !== document.body
          && !navigation?.contains(document.activeElement)) return;
        search.current.focus({ preventScroll: true });
      });
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [root, search]);
}
