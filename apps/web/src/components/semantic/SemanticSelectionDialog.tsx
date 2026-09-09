"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, X } from "lucide-react";
import type { SemanticBatchAction, SemanticEntry } from "@/lib/types/api";
import { useModalFocus } from "@/lib/use-modal-focus";
import type { SemanticSelection } from "@/lib/semantic-selection";
import { TaskDialog } from "@/components/ui/TaskDialog";
import { Button } from "@/components/ui/button";

export const SEMANTIC_BATCH_ACTIONS: SemanticBatchAction[] = ["queue_validation", "attest", "remember", "ignore", "restore"];

export function SemanticSelectionDialog({ selection, visibleIds, present, allowed, busy, error, onRemove, onApply, onClose }: {
  selection: SemanticSelection; visibleIds: Set<string>;
  present: (entry: SemanticEntry) => { title: string; description: string; scope: string };
  allowed: (action: SemanticBatchAction) => boolean;
  busy: boolean; error: string | null;
  onRemove: (id: string) => void; onApply: (action: SemanticBatchAction) => void; onClose: () => void;
}) {
  const t = useTranslations("projectUnderstanding.selection");
  const actionId = useId();
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLElement>(null);
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const [action, setAction] = useState<SemanticBatchAction | null>(null);
  const active = useRef(false);
  const entries = [...selection.values()];
  const reviewNeeded = entries.some(item => item.needsReview);
  const canApply = entries.length > 0 && !!action && allowed(action) && !reviewNeeded && !busy;
  useModalFocus({ active: true, containerRef: dialog, initialFocusRef: heading, onClose: () => { if (!busy) onClose(); } });
  useEffect(() => {
    active.current = true;
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    return () => { active.current = false; if (node?.open) node.close(); };
  }, []);

  return <TaskDialog dialogRef={dialog} writingRef={{ current: busy }} activeRef={active} busy={busy} autoFocusClose={false}
    title={t("title")} name={t("count", { count: entries.length })} closeLabel={t("close")} onClose={onClose} onEscape={onClose}>
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] overflow-hidden">
      <section ref={heading} tabIndex={-1} aria-label={t("items")} className="min-h-0 min-w-0 overflow-y-auto outline-none">
        <ol className="divide-y divide-border">
          {entries.map(({ entry, needsReview }, index) => {
            const content = present(entry);
            return <li key={entry.id} className="flex items-start gap-3 px-5 py-4">
              <span aria-hidden="true" className="w-5 shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
              <div className="min-w-0 flex-1"><h3 className="break-words text-sm font-semibold">{content.title}</h3>
                <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{content.description}</p>
                <p className="mt-2 break-words text-[11px] text-muted-foreground">{content.scope}{!visibleIds.has(entry.id) ? ` · ${t("elsewhereItem")}` : ""}</p>
                {needsReview && <p className="mt-2 text-xs font-medium text-destructive">{t("changedItem")}</p>}
              </div>
              <Button variant="ghost" size="icon" ref={node => { if (node) removeButtons.current.set(entry.id, node); else removeButtons.current.delete(entry.id); }}
                type="button" disabled={busy} aria-label={t("remove", { name: content.title })} onClick={() => {
                  (removeButtons.current.get(entries[index + 1]?.entry.id) ?? removeButtons.current.get(entries[index - 1]?.entry.id) ?? heading.current)?.focus();
                  onRemove(entry.id);
                }}><X size={15} /></Button>
            </li>;
          })}
        </ol>
      </section>
      <section aria-label={t("actionTitle")} className="min-h-0 overflow-y-auto border-l border-border bg-secondary/25 p-5">
        <fieldset disabled={busy || reviewNeeded}><legend className="mb-3 text-xs font-semibold">{t("actionTitle")}</legend>
          <div className="space-y-2">{SEMANTIC_BATCH_ACTIONS.map(value => <label key={value}
            className={`flex cursor-pointer items-start gap-2.5 rounded-md border p-3 text-xs has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-40 ${action === value ? "border-primary bg-primary/[0.06]" : "border-transparent hover:bg-muted"}`}>
            <input type="radio" name="semantic-batch-action" value={value} checked={action === value} aria-labelledby={`${actionId}-${value}-label`} aria-describedby={`${actionId}-${value}-description`} disabled={!allowed(value)} onChange={() => setAction(value)} className="mt-0.5 shrink-0 accent-primary" />
            <span><span id={`${actionId}-${value}-label`} className="block font-semibold">{t(`actions.${value}.label`)}</span><span id={`${actionId}-${value}-description`} className="mt-1 block leading-5 text-muted-foreground">{t(`actions.${value}.description`)}</span></span>
          </label>)}</div>
        </fieldset>
        <p className="mt-4 text-[11px] leading-5 text-muted-foreground">{reviewNeeded ? t("changed") : t("availability")}</p>
      </section>
    </div>
    <footer className="shrink-0 space-y-3 border-t border-border bg-card px-5 py-4">
      {error && <p role="alert" className="text-xs leading-5 text-destructive">{error}</p>}
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" type="button" disabled={busy} onClick={onClose}>{t("continue")}</Button>
        <Button type="button" disabled={!canApply} onClick={() => { if (canApply && action) onApply(action); }}>
          {busy ? <Loader2 size={14} className="shrink-0 animate-spin" /> : <Check size={14} className="shrink-0" />}
          {busy ? t("working") : action ? t(`actions.${action}.confirm`, { count: entries.length }) : t("chooseAction")}
        </Button>
      </div>
    </footer>
  </TaskDialog>;
}
