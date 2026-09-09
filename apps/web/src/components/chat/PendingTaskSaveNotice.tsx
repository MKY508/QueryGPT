"use client";

import { useLayoutEffect, useRef } from "react";
import { CircleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export function PendingTaskSaveNotice({ onRetry, onDismiss }: { onRetry: () => void; onDismiss: () => void }) {
  const t = useTranslations("messageList");
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const origin = document.activeElement;
    const notice = root.current;
    return () => {
      if (notice?.contains(document.activeElement) && origin instanceof HTMLElement && origin.isConnected && origin.getClientRects().length) {
        origin.focus({ preventScroll: true });
      }
    };
  }, []);
  return <div ref={root} role="alert" className="flex items-center gap-3 border-b border-destructive/30 bg-destructive/[0.04] px-5 py-3 text-sm">
    <CircleAlert size={17} aria-hidden="true" className="shrink-0 text-destructive" />
    <p className="min-w-0 flex-1 text-foreground">{t("taskSaveFailed")}</p>
    <Button variant="outline" size="sm" onClick={onRetry}>{t("retryTaskSave")}</Button>
    <Button variant="ghost" size="sm" onClick={onDismiss}>{t("stayWithTask")}</Button>
  </div>;
}
