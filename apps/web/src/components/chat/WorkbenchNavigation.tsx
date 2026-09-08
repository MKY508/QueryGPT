"use client";

import { useLayoutEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { focusableElements } from "@/lib/use-modal-focus";
import styles from "./WorkbenchNavigation.module.css";

const query = "(min-width: 900px)";
const desktop = () => window.matchMedia(query).matches;
const serverDesktop = () => true;
function subscribe(notify: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}

export function useWorkbenchDesktop() {
  return useSyncExternalStore(subscribe, desktop, serverDesktop);
}

/** One mounted navigation tree, inline on desktop and a native modal on mobile.
 * Reuses the app's native-dialog pattern; the result and composer never move. */
export function WorkbenchNavigation({ open, modal, label, dialogRef, triggerRef, onClose, children }: {
  open: boolean;
  modal: boolean;
  label: string;
  dialogRef: RefObject<HTMLDialogElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const previousMode = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!open) {
      const active = document.activeElement;
      const ownedFocus = active instanceof HTMLElement && dialog.contains(active);
      if (dialog.open) dialog.close();
      // Inline dialogs do not have the modal's native return-focus behavior.
      // Resize and explicit collapse use the same surviving navigation trigger.
      if (ownedFocus && (document.activeElement === active || document.activeElement === document.body)) {
        triggerRef.current?.focus({ preventScroll: true });
      }
      previousMode.current = null;
      return;
    }
    if (dialog.open && previousMode.current === modal) return;
    const active = document.activeElement instanceof HTMLElement && dialog.contains(document.activeElement)
      ? document.activeElement : null;
    if (dialog.open) dialog.close();
    previousMode.current = modal;
    if (modal) dialog.showModal();
    else dialog.setAttribute("open", "");
    const destination = active || (modal ? dialog.querySelector<HTMLElement>('[aria-current="true"], [role="tab"][aria-selected="true"]') : null);
    destination?.focus({ preventScroll: true });
  }, [open, modal, dialogRef, triggerRef]);

  return <dialog ref={dialogRef} aria-label={label} aria-modal={open && modal ? true : undefined}
    data-modal={modal} className={styles.navigation}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => {
      if (event.defaultPrevented) return;
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
        if (event.key === "Escape") event.preventDefault();
        return;
      }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key === "Tab" && modal) {
        const controls = focusableElements(event.currentTarget), first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}
    onClick={event => {
      if (!modal || event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    {children}
  </dialog>;
}
