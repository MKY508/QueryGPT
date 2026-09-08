"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(",");

function available(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const visibility = window.getComputedStyle(element).visibility;
  if (visibility === "hidden" || visibility === "collapse") return false;
  // Responsive master/detail panes stay mounted to retain their place. A
  // hidden ancestor must not become an initial or wraparound focus target.
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    if (window.getComputedStyle(parent).display === "none") return false;
  }
  return true;
}

export function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => element.getAttribute("tabindex") !== "-1" && available(element));
}

/** Inline native dialogs are panels, not overlays that own workspace focus. */
export function hasModalDialog(except?: Element | null): boolean {
  return Array.from(document.querySelectorAll('dialog[open], [aria-modal="true"]:not(dialog)')).some(node =>
    node !== except && (node.getAttribute("aria-modal") === "true" || node.matches(":modal")));
}

interface UseModalFocusOptions {
  active: boolean;
  containerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Implements the keyboard behavior from the WAI-ARIA modal dialog pattern:
 * focus enters the dialog, Tab stays inside it, Escape closes it, and focus
 * returns to the control that opened it.
 */
export function useModalFocus({
  active,
  containerRef,
  onClose,
  initialFocusRef,
}: UseModalFocusOptions): void {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!active) return;

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;
      const requested = initialFocusRef?.current;
      const initialFocus = requested && available(requested) ? requested : focusableElements(container)[0] || container;
      initialFocus.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      const container = containerRef.current;
      if (!container) return;
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = focusableElements(container);
      if (!focusable.length) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      const focusIsOutside = !(
        activeElement instanceof Node && container.contains(activeElement)
      );

      if (event.shiftKey && (activeElement === first || focusIsOutside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || focusIsOutside)) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [active, containerRef, initialFocusRef]);
}
