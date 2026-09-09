"use client";

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

type Pane = "result" | "composer";
const visible = (node: HTMLElement | null): node is HTMLElement => Boolean(node?.isConnected && node.getClientRects().length);

/** Hand off focus only after an explicit pane change. A still-visible result
 * trigger keeps focus, so desktop list and history navigation remain usable. */
export function useWorkbenchPaneFocus(result: RefObject<HTMLDivElement | null>, panel: RefObject<HTMLDivElement | null>,
  composer: RefObject<HTMLDivElement | null>, navigationTrigger: RefObject<HTMLButtonElement | null>) {
  const pending = useRef<{ pane: Pane; origin: Element | null } | null>(null);
  const [request, setRequest] = useState(0);
  const requestFocus = useCallback((pane: Pane) => {
    pending.current = { pane, origin: document.activeElement };
    setRequest((value) => value + 1);
  }, []);

  useLayoutEffect(() => {
    const handoff = pending.current;
    pending.current = null;
    if (!handoff) return;
    const { pane, origin } = handoff;
    const active = document.activeElement;
    const restoredSurface = active === result.current || active === panel.current || active === navigationTrigger.current;
    // A child may have deliberately focused its own control while rendering.
    // Native dialog restoration to a workbench surface is not a new user choice.
    if (active && active !== document.body && active !== origin && !restoredSurface) return;
    if (pane === "result" && origin instanceof HTMLElement && origin !== document.body && visible(origin)) return;

    let target: HTMLElement | null;
    if (pane === "composer") target = composer.current?.querySelector<HTMLTextAreaElement>("textarea:not(:disabled)") || null;
    else target = visible(result.current) ? result.current : panel.current;
    if (!visible(target)) return;
    target.focus({ preventScroll: true });
  }, [request, result, panel, composer, navigationTrigger]);

  return requestFocus;
}
