"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { TaskDialog } from "@/components/ui/TaskDialog";
import { Button } from "@/components/ui/button";
import type { ReportDocument } from "@/lib/reports";
import { mergeReportDocuments, type MergeChoice } from "./report-merge";
import { ReportPrintView } from "./ReportPrintView";

const emptyChoices: Readonly<Record<string, MergeChoice>> = {};

export function ReportConflictPanel({ base, mine, latest, loading, applying, failed, applyFailed, comparisonOnly = false, onRetry, onApply, onClose }: {
  base: ReportDocument; mine: ReportDocument; latest: ReportDocument | null;
  loading: boolean; applying: boolean; failed: boolean; applyFailed: boolean;
  comparisonOnly?: boolean;
  onRetry: () => void; onApply: (document: ReportDocument) => void; onClose: () => void;
}) {
  const t = useTranslations("reportConflict");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [decisions, setDecisions] = useState<{ base: ReportDocument; mine: ReportDocument; latest: ReportDocument | null;
    choices: Record<string, MergeChoice> } | null>(null);
  // Choices authorize these exact snapshots, not a later response with the
  // same conflict IDs. A refreshed comparison must be reviewed again.
  const choices = decisions?.base === base && decisions.mine === mine && decisions.latest === latest ? decisions.choices : emptyChoices;
  const [preview, setPreview] = useState<"result" | "mine" | "latest">(comparisonOnly ? "mine" : "result");
  const result = useMemo(() => {
    if (!latest || comparisonOnly) return null;
    try { return mergeReportDocuments(base, mine, latest, choices); }
    catch { return null; }
  }, [base, mine, latest, choices, comparisonOnly]);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  const document = preview === "mine" ? mine : preview === "latest" ? latest : result?.report;
  return <TaskDialog dialogRef={dialogRef} writingRef={{ current: applying }} busy={applying} title={t(comparisonOnly ? "compareTitle" : "title")} closeLabel={t("close")} onClose={onClose}>
      <p className="shrink-0 border-b border-border px-5 py-3 text-xs leading-5 text-muted-foreground">{t(comparisonOnly ? "unconfirmedIntro" : "intro")}</p>
      {(failed || (latest && !result && !comparisonOnly) || applyFailed) && <div role="alert" className="flex items-center justify-between gap-4 px-5 py-3 text-xs text-destructive">
        <span>{t(applyFailed ? "preserveFailed" : "loadFailed")}</span>
        {failed && <Button variant="ghost" size="sm" type="button" disabled={loading || applying} onClick={onRetry} className="">{t("retry")}</Button>}
      </div>}
      {loading && <p role="status" className="flex items-center gap-2 px-5 py-3 text-sm"><Loader2 size={16} className="animate-spin" />{t("loading")}</p>}
      <div className="flex min-h-0 flex-1">
        {!comparisonOnly && <aside className="w-80 shrink-0 overflow-y-auto border-r border-border p-4">
          {result && <p role="status" className="mb-4 text-xs text-muted-foreground">{result.conflicts.length ? t("remaining", { count: result.unresolved }) : t("noConflicts")}</p>}
          {result?.conflicts.map((conflict, index) => <fieldset key={conflict.id} disabled={applying} className="mb-5 min-w-0">
            <legend className="mb-2 text-xs font-semibold">{t(conflict.field)}{conflict.label ? ` · ${conflict.label}` : ""}</legend>
            {conflict.field === "blockPage" && <p className="mb-3 text-xs leading-5 text-muted-foreground">{t("blockPageHint")}</p>}
            {(["mine", "latest"] as const).map((side) => <label key={side} className="mb-2 flex cursor-pointer items-start gap-2 rounded-md border border-border p-2.5 text-xs">
              <input type="radio" name={`conflict-${index}`} value={side} checked={choices[conflict.id] === side}
                onChange={() => setDecisions({ base, mine, latest, choices: { ...choices, [conflict.id]: side } })} className="mt-0.5 accent-primary" />
              <span className="min-w-0"><span className="block font-medium">{t(conflict.field === "copySource"
                ? side === "mine" ? "keepCopy" : "removeCopy" : side === "mine" && conflict.restoresCopy ? "keepCopy" : side)}</span>
                <span className="mt-1 block whitespace-pre-line break-words text-muted-foreground">{conflict[side] === null
                  ? t(conflict.field === "copySource" ? "removeCopyHint" : conflict.field === "pageSettings" ? "settingsPreview" : conflict.field === "blockLinks" ? "noLinks" : "deleted")
                  : conflict.field === "status" ? t(conflict[side] === "published" ? "status_published" : conflict[side] === "archived" ? "status_archived" : "status_draft") : conflict[side] || t("empty")}</span>
              </span>
            </label>)}
            {conflict.restoresCopy && <p className="text-xs leading-5 text-muted-foreground">{t(
              conflict.field === "copySource" ? "copySourceHint" : conflict.field === "page" || conflict.field === "pagesRequired" ? "copyPageHint" : "copyHint")}</p>}
          </fieldset>)}
        </aside>}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 gap-2 border-b border-border p-3" role="group" aria-label={t("preview")}>
            {(["result", "mine", "latest"] as const).filter((side) => !comparisonOnly || side !== "result").map((side) => <Button variant="ghost" size="sm" key={side} type="button" aria-pressed={preview === side}
              disabled={side !== "mine" && !latest} onClick={() => setPreview(side)}
              className={`px-3 py-1.5 text-xs disabled:opacity-45 ${preview === side ? "bg-muted font-semibold" : "text-muted-foreground"}`}>{t(`preview_${side}`)}</Button>)}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">{document && <ReportPrintView report={document} filterValues={{}} preview />}</div>
        </section>
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-border px-5 py-3">
        <span className="text-xs text-muted-foreground">{t(comparisonOnly ? "unconfirmedHint" : "saveHint")}</span>
        {!comparisonOnly && <Button variant="primary" size="sm" type="button" disabled={applying || loading || !result || result.unresolved > 0 || result.report.pages.length === 0}
          onClick={() => { if (result && !result.unresolved) onApply(result.report); }} className="shrink-0 px-4 py-2 text-xs">
          {applying ? t("applying") : t("apply")}
        </Button>}
      </footer>
  </TaskDialog>;
}
