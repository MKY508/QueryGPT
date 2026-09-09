"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslations } from "next-intl";
import type { SemanticEntry } from "@/lib/types/api";
import { readSemanticSaveTarget, type SemanticSaveTarget } from "@/lib/semantic-save-recovery";
import { Button } from "@/components/ui/button";
import { DiscardChangesDialog } from "@/components/ui/DiscardChangesDialog";
import type { SemanticHistoryPresentation } from "./SemanticHistoryComparison";

interface RecoveryProps {
  target: SemanticSaveTarget;
  conflict: boolean;
  draft: { title: string; description: string };
  present: (entry: SemanticEntry) => SemanticHistoryPresentation;
  fallbackFocus: RefObject<HTMLElement | null>;
  onLoad: (entry: SemanticEntry) => void;
  onRetry: () => void;
}

type ReadState =
  | { status: "idle" | "loading" | "error" }
  | { status: "ready"; entry: SemanticEntry | null };

export function SemanticSaveRecovery(props: RecoveryProps) {
  const { target } = props;
  const identity = JSON.stringify([
    target.projectId, target.key, target.entryId, target.expectedHead, target.previousVersion,
  ]);
  return <RecoverySession key={identity} {...props} />;
}

function RecoverySession({ target, conflict, draft, present, fallbackFocus, onLoad, onRetry }: RecoveryProps) {
  const t = useTranslations("semanticSaveRecovery");
  const [state, setState] = useState<ReadState>({ status: "idle" });
  const [confirm, setConfirm] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    resultHeading.current?.focus({ preventScroll: true });
    resultHeading.current?.scrollIntoView?.({ block: "start" });
    return () => controller.current?.abort();
  }, []);

  const read = async () => {
    if (controller.current || confirm) return;
    const request = new AbortController();
    const origin = document.activeElement;
    controller.current = request;
    setState({ status: "loading" });
    try {
      const entry = await readSemanticSaveTarget(target, request.signal);
      if (!request.signal.aborted) setState({ status: "ready", entry });
    } catch {
      if (!request.signal.aborted) setState({ status: "error" });
    } finally {
      if (!request.signal.aborted) {
        controller.current = null;
        if (document.activeElement === origin) resultHeading.current?.focus({ preventScroll: true });
      }
    }
  };

  const busy = state.status === "loading";
  const latest = state.status === "ready" ? state.entry : undefined;
  const current = latest ? present(latest) : null;
  const mayRetry = !confirm && state.status === "ready"
    && (latest === null || (latest?.is_active && latest.active_revision_id === target.expectedHead));
  const statusKey = state.status === "error" ? "readFailed"
    : busy ? "reading" : latest === null ? "notFound"
    : latest?.is_active === false ? "inactive" : latest ? "review"
    : conflict ? "conflict" : "uncertain";

  return (
    <section aria-label={t("title")} aria-busy={busy} className="border-b border-border bg-muted/30 px-6 py-5">
      <h3 ref={resultHeading} tabIndex={-1} className="text-sm font-semibold outline-none">{t("title")}</h3>
      <p role="status" className="mt-1 text-xs leading-5 text-muted-foreground">{t(statusKey)}</p>
      {current && (
        <div className="mt-4 grid min-w-0 grid-cols-2 gap-4">
          {[{ label: t("saved"), title: current.title, description: current.description }, { label: t("draft"), ...draft }].map(item => (
            <section key={item.label} aria-label={item.label} className="min-w-0 rounded-xl border border-border bg-card p-4 [overflow-wrap:anywhere]">
              <h4 className="text-xs font-semibold text-muted-foreground">{item.label}</h4>
              <p className="mt-2 whitespace-pre-wrap text-sm font-medium">{item.title || t("unnamed")}</p>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-5">{item.description || t("noDescription")}</p>
            </section>
          ))}
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy || confirm} onClick={() => void read()}>
          {t(state.status === "idle" || busy ? "read" : "refresh")}
        </Button>
        {latest?.is_active && <Button disabled={confirm} onClick={() => setConfirm(true)}>{t("load")}</Button>}
        {mayRetry && <Button variant="ghost" onClick={onRetry}>{t("retry")}</Button>}
      </div>
      {confirm && latest && (
        <DiscardChangesDialog title={t("loadTitle")} description={t("loadDescription")}
          continueLabel={t("keep")} discardLabel={t("confirmLoad")} disabled={busy} fallbackFocus={fallbackFocus}
          onContinue={() => setConfirm(false)}
          onDiscard={() => { if (!busy && latest.is_active) onLoad(latest); }} />
      )}
    </section>
  );
}
