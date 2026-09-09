"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { tableFrozenOffsets } from "@/lib/table-freezing";

export function useFrozenDataColumns(container: RefObject<HTMLDivElement | null>, requested: number, layout: string) {
  const [offsets, setOffsets] = useState<number[]>([]);
  useLayoutEffect(() => {
    const node = container.current;
    if (!node || requested <= 0) return;
    let active = true;
    const headers = Array.from(node.querySelectorAll<HTMLTableCellElement>("thead th"));
    const measure = () => {
      if (!active) return;
      const widths = headers.map((header) => header.getBoundingClientRect().width);
      const next = tableFrozenOffsets(requested, node.clientWidth, widths[0], widths.slice(1));
      setOffsets((current) => current.length === next.length && current.every((value, index) => value === next[index]) ? current : next);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    for (const header of headers) observer?.observe(header);
    window.addEventListener("resize", measure);
    return () => { active = false; observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [container, requested, layout]);
  return requested > 0 ? offsets : [];
}
