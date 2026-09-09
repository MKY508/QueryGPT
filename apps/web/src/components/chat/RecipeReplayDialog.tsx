"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { TaskDialog } from "@/components/ui/TaskDialog";
import { Loader2 } from "lucide-react";
import { previewRecipeReplay, type RecipeReplayPreview, type RecipeReplayRequest } from "@/lib/recipe-replay";
import { getErrorHttpStatus } from "@/lib/types/api";
import { CleaningSamples } from "./CleaningSamples";

interface Props {
  projectId: string;
  sourceId: string;
  name: string;
  recipeId: string;
  revisionId?: string;
  canApply: boolean;
  onApply: (request: RecipeReplayRequest & { proof: string }) => Promise<void>;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}

export function RecipeReplayDialog({ projectId, sourceId, name, recipeId, revisionId, canApply, onApply, onRefresh, onClose }: Props) {
  const t = useTranslations("recipeReplay");
  const tSource = useTranslations("sourceReplacement");
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef(false);
  const writing = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState<RecipeReplayPreview | null>(null);
  const [error, setError] = useState<"previewFailed" | "changed" | "uncertain" | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    active.current = true;
    const element = dialog.current;
    element?.showModal();
    return () => { active.current = false; element?.close(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void previewRecipeReplay(projectId, sourceId, recipeId, revisionId ? { revision_id: revisionId } : {}, controller.signal)
      .then((value) => { if (active.current && !controller.signal.aborted) setPreview(value); }, () => {
        if (active.current && !controller.signal.aborted) setError("previewFailed");
      });
    return () => controller.abort();
  }, [projectId, sourceId, recipeId, revisionId, attempt]);

  const apply = async () => {
    if (writing.current || !canApply || !preview?.can_apply || error) return;
    writing.current = true;
    setBusy(true);
    try {
      // Pin the exact reviewed revision even when the dialog initially requested the current head.
      await onApply({ revision_id: preview.revision_id, proof: preview.proof });
      if (active.current) onClose();
    } catch (reason) {
      if (active.current) {
        const status = getErrorHttpStatus(reason);
        setError(status && status >= 400 && status < 500 && ![408, 429].includes(status) ? "changed" : "uncertain");
        setPreview(null);
      }
    } finally {
      writing.current = false;
      if (active.current) setBusy(false);
    }
  };
  const refresh = async () => {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    try { await onRefresh(); if (active.current) onClose(); }
    catch { /* A failed read cannot prove a failed write. */ }
    finally { writing.current = false; if (active.current) setBusy(false); }
  };

  return (
    <TaskDialog dialogRef={dialog} writingRef={writing} busy={busy} name={name} title={t("title")} closeLabel={t("close")} onClose={onClose}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        {!preview && !error && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 size={15} className="animate-spin" />{t("loading")}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{t(error)}</p>}
        {preview && <>
          <p className="text-sm">{t("method", { version: preview.revision_number })}</p>
          {preview.before ? <CleaningSamples before={preview.before} after={preview.after} comparisonLabels={[t("before"), t("after")]} />
            : <><p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">{t("noCurrent")}</p><CleaningSamples title={t("after")} before={preview.after} /></>}
          <div className="space-y-1 text-sm">
            {preview.input_changed && <p className="text-warning">{t("inputChanged")}</p>}
            {preview.added_columns.length > 0 && <p>{tSource("added", { columns: preview.added_columns.join("、") })}</p>}
            {preview.removed_columns.length > 0 && <p className="text-warning">{tSource("removed", { columns: preview.removed_columns.join("、") })}</p>}
            {preview.type_changes.length > 0 && <p className="text-warning">{tSource("types", { columns: preview.type_changes.map((item) => item.column).join("、") })}</p>}
            {preview.unresolved_questions > 0 && <p className="text-warning">{tSource("questions", { count: preview.unresolved_questions })}</p>}
            {preview.pending_replacement && <p className="text-warning">{t("pending")}</p>}
            {!preview.can_apply && <p role="alert" className="text-destructive">{t("incompatible")}</p>}
          </div>
        </>}
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-border p-5">
        <p className="text-xs text-muted-foreground">{t("scope")}</p>
        {error === "uncertain" ? <Button variant="outline" type="button" disabled={busy} onClick={() => void refresh()}>{t("refresh")}</Button>
          : error ? <Button variant="outline" type="button" disabled={busy} onClick={() => { setPreview(null); setError(null); setAttempt((value) => value + 1); }}>{t("retry")}</Button>
            : <Button variant="primary" type="button" disabled={busy || !canApply || !preview?.can_apply} onClick={() => void apply()}>{busy && <Loader2 size={14} className="animate-spin" />}{t(revisionId ? "restoreApply" : "apply")}</Button>}
      </footer>
    </TaskDialog>
  );
}
