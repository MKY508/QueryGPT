"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NoticeProps = { children: ReactNode; actions?: ReactNode; tone?: "error" | "neutral"; role?: "alert" | "status"; className?: string } & (
  { onDismiss: () => void; dismissLabel: string } | { onDismiss?: never; dismissLabel?: never }
);

/** Persistent feedback stays next to its task; callers own actions and dismissal. */
export function InlineNotice({ children, actions, tone = "error", role = "alert", className, onDismiss, dismissLabel }: NoticeProps) {
  return <div role={role} className={cn("flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm leading-6",
    tone === "error" ? "border-destructive/20 bg-destructive/5 text-destructive" : "border-border bg-muted/40 text-foreground", className)}>
    <div className="min-w-0 flex-1">{children}</div>
    {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    {onDismiss && <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-destructive"
      aria-label={dismissLabel} onClick={onDismiss}><X size={14} aria-hidden="true" /></Button>}
  </div>;
}
