"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { hasModalDialog } from "@/lib/use-modal-focus";
import { Button } from "@/components/ui/button";

/** Persistent desktop inspector; reading never makes the list modal. */
export function SemanticDetailPanel({ covered, focusRequest, title, index, count, busy, onNavigate, onReturnFocus, children }: {
  covered: boolean; focusRequest: number; title: string; index: number; count: number; busy: boolean;
  onNavigate: (direction: -1 | 1) => void; onReturnFocus: () => void; children: ReactNode;
}) {
  const t = useTranslations("projectUnderstanding.details");
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null), body = useRef<HTMLDivElement>(null);
  const lastFocusRequest = useRef(0);
  useEffect(() => {
    if (covered || hasModalDialog() || focusRequest === lastFocusRequest.current) return;
    lastFocusRequest.current = focusRequest;
    body.current?.scrollTo?.({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [covered, focusRequest]);

  return <aside aria-labelledby={id} data-testid="semantic-detail-panel"
    onKeyDown={event => {
      if (covered || hasModalDialog() || event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); onReturnFocus();
      }
    }}
    className="flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-border bg-card text-foreground">
    <header className="flex min-h-[60px] shrink-0 items-center border-b border-border px-5 py-3">
      <h2 ref={heading} id={id} tabIndex={-1} className="break-words text-sm font-semibold leading-6 outline-none [overflow-wrap:anywhere]">{title}</h2>
    </header>
    {index >= 0 && <nav aria-label={t("browse")} className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-5 py-2">
      <p role="status" className="text-xs tabular-nums text-muted-foreground">{t("position", { current: index + 1, total: count })}</p>
      <div className="flex gap-1">
        {([-1, 1] as const).map(direction => <Button key={direction} variant="ghost" size="icon" aria-label={t(direction === -1 ? "previous" : "next")}
          aria-disabled={busy || index + direction < 0 || index + direction >= count}
          onClick={() => {
            if (!busy && index + direction >= 0 && index + direction < count) onNavigate(direction);
          }} className="aria-disabled:opacity-30">
          {direction === -1 ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </Button>)}
      </div>
    </nav>}
    <div ref={body} className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-wrap:anywhere]">{children}</div>
  </aside>;
}
