"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import type { SemanticEntry } from "@/lib/types/api";
import { readSemanticHistory, restoreSemanticHistory, revisionEntry, semanticHistoryChanges, SemanticHistoryConflict, type SemanticHistory } from "@/lib/semantic-history";
import { useModalFocus } from "@/lib/use-modal-focus";
import { TaskDialog } from "@/components/ui/TaskDialog";
import { Button } from "@/components/ui/button";
import { SemanticHistoryComparison, type SemanticHistoryPresentation } from "./SemanticHistoryComparison";

const PAGE_SIZE = 20;
type HistoryError = "readFailed" | "conflict" | "uncertain";

interface SemanticHistoryDialogProps {
  projectId: string; entryId: string; label: string; present: (entry: SemanticEntry) => SemanticHistoryPresentation;
  onRestored: (entry: SemanticEntry) => void; onClose: () => void;
}

export function SemanticHistoryDialog(props: SemanticHistoryDialogProps) {
  return <SemanticHistorySession key={JSON.stringify([props.projectId, props.entryId])} {...props} />;
}

function SemanticHistorySession({ projectId, entryId, label, present, onRestored, onClose }: SemanticHistoryDialogProps) {
  const t = useTranslations("semanticHistory"), locale = useLocale();
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLElement>(null), comparison = useRef<HTMLHeadingElement>(null);
  const confirmHeading = useRef<HTMLHeadingElement>(null), restoreButton = useRef<HTMLButtonElement>(null);
  const reloadButton = useRef<HTMLButtonElement>(null);
  const versionButtons = useRef(new Map<string, HTMLButtonElement>());
  const active = useRef(false), writing = useRef(false), controller = useRef<AbortController | null>(null);
  const [history, setHistory] = useState<SemanticHistory | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState<HistoryError | null>(null);
  const [selected, setSelected] = useState<string | null>(null), [limit, setLimit] = useState(PAGE_SIZE);
  const [confirm, setConfirm] = useState(false);
  const focusComparison = useRef(false);
  const [focusVersion, setFocusVersion] = useState<string | null>(null);
  const wasConfirming = useRef(false);
  const revision = history?.revisions.find(item => item.id === selected) ?? null;
  const canRestore = !loading && !busy && !error && !!history?.current.active_revision_id && !!revision
    && revision.id !== history.current.active_revision_id && revision.snapshot.is_active !== false;

  const close = () => { if (!writing.current) onClose(); };
  const escape = () => {
    if (writing.current) return;
    if (confirm) { setConfirm(false); restoreButton.current?.focus(); } else onClose();
  };
  useModalFocus({ active: true, containerRef: dialog, initialFocusRef: heading, onClose: escape });

  const load = async () => {
    if (writing.current) return;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setLoading(true); setError(null); setHistory(null); setConfirm(false); setLimit(PAGE_SIZE);
    try {
      const loaded = await readSemanticHistory(projectId, entryId, request.signal);
      if (!active.current || request.signal.aborted) return;
      setHistory(loaded); setSelected(current => loaded.revisions.some(item => item.id === current) ? current : loaded.current.active_revision_id ?? loaded.revisions[0]?.id ?? null);
    } catch (reason) {
      if (active.current && !request.signal.aborted) setError(reason instanceof SemanticHistoryConflict ? "conflict" : "readFailed");
    } finally { if (active.current && !request.signal.aborted) setLoading(false); }
  };
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });
  useEffect(() => {
    active.current = true; const node = dialog.current;
    if (node && !node.open) node.showModal();
    void loadRef.current();
    return () => { active.current = false; controller.current?.abort(); if (node?.open) node.close(); };
  }, [projectId, entryId]);
  useEffect(() => {
    if (focusComparison.current && selected && !loading) { focusComparison.current = false; comparison.current?.focus({ preventScroll: true }); comparison.current?.scrollIntoView?.({ block: "start" }); }
  }, [selected, loading]);
  useEffect(() => {
    if (confirm) confirmHeading.current?.focus({ preventScroll: true });
    else if (wasConfirming.current) restoreButton.current?.focus();
    wasConfirming.current = confirm;
  }, [confirm]);
  useEffect(() => { if (focusVersion) versionButtons.current.get(focusVersion)?.focus(); }, [focusVersion]);
  useEffect(() => { if (error && !loading) reloadButton.current?.focus(); }, [error, loading]);

  const restore = async () => {
    if (writing.current || !canRestore || !confirm || !history || !revision) return;
    writing.current = true; setBusy(true);
    let saved: SemanticEntry;
    try { saved = await restoreSemanticHistory(history, revision.id); }
    catch (reason) {
      if (active.current) {
        const status = (reason as { response?: { status?: number } })?.response?.status;
        setError(status === 409 || status === 404 ? "conflict" : "uncertain"); setConfirm(false);
      }
      return;
    } finally { writing.current = false; if (active.current) setBusy(false); }
    if (active.current) { onRestored(saved); onClose(); }
  };
  const choose = (id: string) => { if (writing.current || loading) return; focusComparison.current = true; setSelected(id); setConfirm(false); };
  const formatTime = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(locale) : t("unknownDate");

  return <TaskDialog dialogRef={dialog} writingRef={writing} activeRef={active} busy={busy} autoFocusClose={false}
    title={t("title")} name={history ? present(history.current).title : label}
    closeLabel={t("close")} onClose={close} onEscape={escape}>
    <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)]">
      <nav ref={heading} tabIndex={-1} aria-label={t("versions")} className="min-h-0 overflow-y-auto overscroll-contain border-r border-border p-3 outline-none">
        {loading && <p role="status" className="flex items-center justify-center gap-2 p-5 text-xs"><Loader2 size={15} className="animate-spin" />{t("loading")}</p>}
        {history?.revisions.slice(0, limit).map(item => <Button variant="ghost" key={item.id} type="button" aria-pressed={item.id === selected} disabled={busy}
          ref={node => { if (node) versionButtons.current.set(item.id, node); else versionButtons.current.delete(item.id); }}
          onClick={() => choose(item.id)} className="mb-1 block h-auto w-full border-l-2 border-transparent px-3 py-3 text-left text-xs aria-pressed:border-primary aria-pressed:bg-primary/[0.055]">
          <span className="block font-semibold">{t("version", { version: item.revision_number })}{item.id === history.current.active_revision_id ? ` · ${t("currentTag")}` : ""}</span>{" "}
          <span className="mt-1 block text-[11px] text-muted-foreground">{formatTime(item.created_at)}</span>
          {item.restored_from_revision_id && <span className="mt-1 block text-[11px] text-muted-foreground">{t("restoredVersion")}</span>}
        </Button>)}
        {history && !history.revisions.length && <p className="p-5 text-xs text-muted-foreground">{t("empty")}</p>}
        {history && history.revisions.length > limit && <Button variant="ghost" type="button" disabled={busy} onClick={() => { setFocusVersion(history.revisions[limit].id); setLimit(value => value + PAGE_SIZE); }}
          className="w-full border border-border text-xs text-primary">{t("more")}</Button>}
      </nav>
      <section aria-label={t("comparison")} className="min-h-0 min-w-0 overflow-y-auto overscroll-contain p-5">
        <h3 ref={comparison} tabIndex={-1} className="mb-4 text-sm font-semibold outline-none">{t("comparison")}</h3>
        {history && revision ? <SemanticHistoryComparison current={present(history.current)} previous={present(revisionEntry(revision))}
          version={revision.revision_number} changes={semanticHistoryChanges(history.current, revision)} /> : <p className="py-10 text-center text-xs text-muted-foreground">{t("choose")}</p>}
      </section>
    </div>
    <footer className="shrink-0 space-y-3 border-t border-border bg-card px-5 py-3">
      {error && <div role="alert" className="text-xs leading-5 text-destructive">{t(error)}</div>}
      {confirm && revision ? <div>
        <h3 ref={confirmHeading} tabIndex={-1} className="text-sm font-semibold outline-none">{t("confirmTitle", { version: revision.revision_number })}</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("confirmDescription")}</p>
        <div className="mt-3 flex justify-end gap-2"><Button variant="ghost" type="button" disabled={busy} onClick={() => { setConfirm(false); restoreButton.current?.focus(); }}>{t("cancelRestore")}</Button>
          <Button type="button" disabled={busy} onClick={() => void restore()}>{busy ? t("restoring") : t("confirmRestore")}</Button></div>
      </div> : <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">{revision?.snapshot.is_active === false ? t("inactiveVersion") : t("scope")}</p>
        {error ? <Button ref={reloadButton} type="button" disabled={loading || busy} onClick={() => void load()}>{t("reload")}</Button>
          : <Button ref={restoreButton} type="button" disabled={!canRestore} onClick={() => setConfirm(true)}>{t("restore")}</Button>}
      </div>}
    </footer>
  </TaskDialog>;
}
