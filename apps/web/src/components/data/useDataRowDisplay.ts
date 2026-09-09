"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";

export const DATA_ROW_DISPLAYS = ["compact", "comfortable", "wrap"] as const;
export type DataRowDisplay = typeof DATA_ROW_DISPLAYS[number];

export function useDataRowDisplay(container: RefObject<HTMLDivElement | null>) {
  const [rowDisplay, setRowDisplay] = useState<DataRowDisplay>("compact");
  const anchor = useRef<{ row: HTMLTableRowElement; offset: number } | null>(null);

  const changeRowDisplay = (next: DataRowDisplay) => {
    if (next === rowDisplay) return;
    anchor.current = null;
    const node = container.current;
    if (node && node.clientHeight > 0) {
      const viewport = node.getBoundingClientRect();
      const top = Math.max(viewport.top, node.querySelector("thead")?.getBoundingClientRect().bottom ?? viewport.top);
      for (const row of node.querySelectorAll<HTMLTableRowElement>("tbody tr[data-data-row]")) {
        const bounds = row.getBoundingClientRect();
        if (bounds.bottom > top && bounds.top < viewport.bottom) {
          anchor.current = { row, offset: bounds.top - top };
          break;
        }
      }
    }
    setRowDisplay(next);
  };

  useLayoutEffect(() => {
    const previous = anchor.current;
    anchor.current = null;
    const node = container.current;
    // Restore before paint, only for this explicit display change. Hidden
    // surfaces and replaced snapshots must not acquire a stale reading position.
    if (previous && node && node.clientHeight > 0 && node.contains(previous.row)) {
      const bounds = previous.row.getBoundingClientRect();
      const top = Math.max(node.getBoundingClientRect().top, node.querySelector("thead")?.getBoundingClientRect().bottom ?? 0);
      // A deeply scrolled multiline row can become shorter than its old hidden
      // portion. Show that record's start instead of scrolling past it.
      const offset = previous.offset > -bounds.height ? previous.offset : 0;
      node.scrollTo({ top: node.scrollTop + bounds.top - top - offset, behavior: "instant" });
    }
  }, [container, rowDisplay]);

  return { rowDisplay, changeRowDisplay };
}
