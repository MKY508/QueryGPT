"use client";

import { useLayoutEffect, type ReactNode, type RefObject } from "react";
import { hasModalDialog } from "@/lib/use-modal-focus";
import styles from "./WorkbenchNavigation.module.css";

/** Desktop navigation stays mounted when collapsed; only explicit actions move focus. */
export function WorkbenchNavigation({ open, label, panelRef, triggerRef, onClose, children }: {
  open: boolean;
  label: string;
  panelRef: RefObject<HTMLElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open && panel?.contains(document.activeElement) && !hasModalDialog()) {
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, [open, panelRef, triggerRef]);

  return <aside ref={panelRef} hidden={!open} inert={!open} aria-label={label}
    className={styles.navigation}
    onKeyDown={event => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || hasModalDialog()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }}>
    {children}
  </aside>;
}
