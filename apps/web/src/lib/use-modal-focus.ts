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
  // Hidden mounted panels must not become initial or wraparound focus targets.
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    if (window.getComputedStyle(parent).display === "none") return false;
  }
  return true;
}

export function focusableElements(container: HTMLElement): HTMLElement[] {
  // Traverse in document order, as in Radix FocusScope. Dynamic insertions must
  // retain their place between controls of different element types.
  const elements: HTMLElement[] = [];
  const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof HTMLElement && node.matches(FOCUSABLE_SELECTOR)
      && node.getAttribute("tabindex") !== "-1" && available(node)) elements.push(node);
  }
  return elements;
}

/** Shared by native task frames and overlays that listen at the window boundary. */
export function containModalTab(event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">, container: HTMLElement): void {
  if (event.key !== "Tab") return;
  const focusable = focusableElements(container);
  if (!focusable.length) { event.preventDefault(); container.focus(); return; }
  const active = document.activeElement;
  const outside = !(active instanceof Node && container.contains(active));
  if (event.shiftKey && (active === focusable[0] || outside)) {
    event.preventDefault(); focusable.at(-1)!.focus();
  } else if (!event.shiftKey && (active === focusable.at(-1) || outside)) {
    event.preventDefault(); focusable[0].focus();
  }
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
      containModalTab(event, container);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [active, containerRef, initialFocusRef]);
}
