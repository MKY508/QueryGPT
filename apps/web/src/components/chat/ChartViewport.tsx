"use client";

import { cloneElement, useLayoutEffect, useRef, useState, type ReactElement } from "react";

type ChartSize = { width: number; height: number };

/** Recharts 2 measures hidden parents as 0×0. Follow its measured-pixel sizing
 * pattern, but don't mount a plot until both real content dimensions exist.
 * Presentation choices and editor drafts stay in the parent component. */
export function ChartViewport({ children }: { children: ReactElement<Partial<ChartSize>> | null | undefined }) {
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ChartSize | null>(null);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    let live = true;
    const measure = (width: number, height: number) => {
      if (!live) return;
      const next = Number.isFinite(width) && Number.isFinite(height) && width >= 1 && height >= 1
        ? { width: Math.round(width), height: Math.round(height) } : null;
      setSize((current) => current?.width === next?.width && current?.height === next?.height ? current : next);
    };
    if (typeof ResizeObserver === "undefined") {
      // Legacy fallback only. Modern browsers report an initial content box on
      // observe(), without forcing a synchronous layout read during mounting.
      const read = () => measure(element.clientWidth, element.clientHeight);
      const frame = requestAnimationFrame(read);
      window.addEventListener("resize", read);
      return () => { live = false; cancelAnimationFrame(frame); window.removeEventListener("resize", read); };
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries.find((item) => item.target === element);
      if (entry) measure(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => { live = false; observer.disconnect(); };
  }, []);
  return <div ref={container} className="h-full w-full min-w-0" data-chart-viewport>
    {size && children ? cloneElement(children, size) : null}
  </div>;
}
