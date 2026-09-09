"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

type NoticeProps = { children: ReactNode } & (
  { onDismiss: () => void; dismissLabel: string } | { onDismiss?: never; dismissLabel?: never }
);

/** The same inline error surface in a directory or its active editor. */
export function SettingsNotice({ children, onDismiss, dismissLabel }: NoticeProps) {
  return <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm leading-6 text-destructive">
    <div className="min-w-0 flex-1">{children}</div>
    {onDismiss && <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-destructive"
      aria-label={dismissLabel} onClick={onDismiss}><X size={14} aria-hidden="true" /></Button>}
  </div>;
}
