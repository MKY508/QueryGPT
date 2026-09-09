"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

/** Remember each mounted session's reading position independently of result
 * drafts. Hidden panes must not replace a saved position with a clamped zero. */
export function useResultReadingPosition(canvas: RefObject<HTMLDivElement | null>, key: string | null, visible: boolean,
  layout: string, availableKeys: string) {
  const positions = useRef(new Map<string, { top: number; left: number }>());
  useLayoutEffect(() => {
    const available = new Set<string>(JSON.parse(availableKeys));
    for (const savedKey of positions.current.keys()) if (!available.has(savedKey)) positions.current.delete(savedKey);
  }, [availableKeys]);

  useLayoutEffect(() => {
    const node = canvas.current;
    if (!node || !key || !visible) return;
    let active = true;
    let wasVisible = false;
    let awaitingLayout = true;
    const restore = () => {
      const position = positions.current.get(key) || { top: 0, left: 0 };
      node.scrollTo?.({ top: position.top, left: position.left, behavior: "instant" });
      // Charts can regain their height after their hidden page is revealed.
      // Keep the target until it fits, unless the reader starts interacting.
      awaitingLayout = Math.abs(node.scrollTop - position.top) > 1 || Math.abs(node.scrollLeft - position.left) > 1;
    };
    const measure = () => {
      if (!active) return;
      const shown = node.clientHeight > 0;
      if (shown && (!wasVisible || awaitingLayout)) restore();
      wasVisible = shown;
    };
    measure();
    const remember = () => {
      if (active && !awaitingLayout && node.clientHeight > 0) positions.current.set(key, { top: Math.max(0, node.scrollTop), left: Math.max(0, node.scrollLeft) });
    };
    const takeOver = () => { awaitingLayout = false; remember(); };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    const page = node.querySelector(".workbench-result-page:not([hidden])");
    if (page) observer?.observe(page);
    window.addEventListener("resize", measure);
    node.addEventListener("scroll", remember, { passive: true });
    node.addEventListener("wheel", takeOver, { passive: true });
    node.addEventListener("pointerdown", takeOver);
    node.addEventListener("keydown", takeOver);
    // Do not sample during cleanup: React may already have replaced the old
    // result with a shorter one, clamping the shared container's scroll offset.
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      node.removeEventListener("scroll", remember);
      node.removeEventListener("wheel", takeOver);
      node.removeEventListener("pointerdown", takeOver);
      node.removeEventListener("keydown", takeOver);
    };
  }, [canvas, key, visible, layout]);
}
