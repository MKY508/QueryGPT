"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StatusChipProps {
  tone?: "default" | "success" | "warning";
  children: ReactNode;
}

export function StatusChip({ tone = "default", children }: StatusChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs",
        tone === "default" && "border-border bg-background text-muted-foreground",
        tone === "success" && "border-green-500/20 bg-green-500/10 text-green-700",
        tone === "warning" && "border-amber-500/20 bg-amber-500/10 text-amber-700"
      )}
    >
      {children}
    </span>
  );
}
