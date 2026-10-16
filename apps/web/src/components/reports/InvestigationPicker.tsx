"use client";

import {
  ArrowLeft,
  Check,
  FileText,
  Loader2,
  Plus,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { AnalysisArtifact, AnalysisArtifactSummary, AnalysisHistoryItem } from "@/lib/types/api";
import type { ReportBlock } from "@/lib/reports";
import {
  listReportArtifactIndex,
  requestReportDraftPlan,
  ReportDraftUnavailableError,
  type ReportDraftContext,
  type ReportDraftPlan,
  type ReportDraftSection,
} from "@/lib/reports";
import {
  analysisSummaryToReportBlock,
  artifactToReportBlock,
  createReportBlocksCopy,
  reflowBlocks,
} from "@/lib/report-blocks";
import { useModalFocus } from "@/lib/use-modal-focus";
import { InvestigationLibrary, type InvestigationLibraryView } from "./InvestigationLibrary";
import { InvestigationContentList } from "./InvestigationContentList";
import { InvestigationSelectionReview } from "./InvestigationSelectionReview";
import { groupInvestigationSelection, investigationSelectionKey, investigationSelectionReducer } from "./investigation-selection";
import { artifactContentKey, useReportArtifactContent } from "./useReportArtifactContent";
import { TaskDialog } from "@/components/ui/TaskDialog";
import { Button } from "@/components/ui/button";

export type InvestigationPickerMode = "smart" | "manual";

interface InvestigationPickerProps {
  open: boolean;
  projectId: string;
  initialRunId?: string;
  initialMode?: InvestigationPickerMode;
  currentReport?: ReportDraftContext;
  onClose: () => void;
  onAdd: (blocks: ReportBlock[]) => void;
  onGenerateDraft: (
    run: AnalysisHistoryItem,
    artifacts: AnalysisArtifact[],
    plan: ReportDraftPlan
  ) => void;
}

function runTitle(run: AnalysisHistoryItem, unnamed: string): string {
  return run.report.title?.trim() || run.query.trim() || unnamed;
}

function legacyPreviewSections(
  plan: ReportDraftPlan,
  labels: Record<ReportDraftSection["role"], string>
): ReportDraftSection[] {
  const sections: ReportDraftSection[] = [
    {
      role: "overview",
      title: labels.overview,
      purpose: "",
      narrative: plan.overview_text,
      artifact_ids: plan.selected_overview || [],
    },
    {
      role: "detail",
      title: labels.detail,
      purpose: "",
      narrative: null,
      artifact_ids: plan.selected_detail || [],
    },
    {
      role: "evidence",
      title: labels.evidence,
      purpose: "",
      narrative: null,
      artifact_ids: plan.selected_evidence || [],
    },
  ];
  return sections.filter(
    (section, index) => index === 0 || section.artifact_ids.length > 0
  );
}

export function InvestigationPicker(props: InvestigationPickerProps) {
  return props.open ? <InvestigationPickerSession key={JSON.stringify([props.projectId, props.initialRunId, props.initialMode])} {...props} /> : null;
}

function InvestigationPickerSession({
  open,
  projectId,
  initialRunId,
  initialMode = "smart",
  currentReport,
  onClose,
  onAdd,
  onGenerateDraft,
}: InvestigationPickerProps) {
  const locale = useLocale();
  const t = useTranslations("investigationPicker");
  const tDraft = useTranslations("reportDraft");
  const tBlocks = useTranslations("reportBlocks");
  const blocksCopy = useMemo(
    () => createReportBlocksCopy((key, values) => tBlocks(key, values)),
    [tBlocks]
  );
  const [mode, setMode] = useState<InvestigationPickerMode>(initialMode);
  const [entryRunId, setEntryRunId] = useState(initialRunId);
  const [libraryView, setLibraryView] = useState<InvestigationLibraryView>({ search: "", page: 1 });
  const [selectedRun, setSelectedRun] = useState<AnalysisHistoryItem | null>(null);
  const [artifacts, setArtifacts] = useState<AnalysisArtifactSummary[]>([]);
  const content = useReportArtifactContent(projectId);
  const [selection, dispatchSelection] = useReducer(investigationSelectionReducer, new Map());
  const [reviewingSelection, setReviewingSelection] = useState(false);
  const selectionGroups = useMemo(() => groupInvestigationSelection(selection), [selection]);
  const selectedCounts = useMemo(() => new Map(selectionGroups.map((group) => [group.run.id, group.items.length])), [selectionGroups]);
  const selectedIds = useMemo(() => new Set(
    [...selection.values()].flatMap((item) => item.kind === "artifact" && item.run.id === selectedRun?.id ? [item.artifact.id] : [])
  ), [selection, selectedRun]);
  const chosenSummary = selectedRun ? selection.get(investigationSelectionKey(selectedRun)) : undefined;
  const includeSummary = Boolean(chosenSummary);
  const manualArtifacts = useMemo(() => artifacts.map((artifact) => {
    const chosen = selectedRun && selection.get(investigationSelectionKey(selectedRun, artifact.id));
    return chosen && chosen.kind === "artifact" ? chosen.artifact : artifact;
  }), [artifacts, selectedRun, selection]);
  const [loadingArtifacts, setLoadingArtifacts] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [applyingDraft, setApplyingDraft] = useState(false);
  const [draftPlan, setDraftPlan] = useState<ReportDraftPlan | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const artifactRequestRef = useRef(0);
  const artifactAbortRef = useRef<AbortController | null>(null);
  const draftRequestRef = useRef(0);
  const draftAbortRef = useRef<AbortController | null>(null);
  const drawerRef = useRef<HTMLDialogElement>(null);
  const writingRef = useRef(false);
  const backRef = useRef<HTMLButtonElement>(null);
  const librarySearchRef = useRef<HTMLInputElement>(null);
  const libraryOpenerRef = useRef<HTMLButtonElement | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const cancelDraft = useCallback(() => {
    draftRequestRef.current += 1;
    draftAbortRef.current?.abort();
    draftAbortRef.current = null;
    setGeneratingDraft(false);
    setApplyingDraft(false);
  }, []);

  const closePicker = useCallback(() => {
    artifactRequestRef.current += 1;
    artifactAbortRef.current?.abort();
    cancelDraft();
    onClose();
  }, [cancelDraft, onClose]);

  useModalFocus({
    active: open,
    containerRef: drawerRef,
    onClose: closePicker,
    initialFocusRef: librarySearchRef,
  });

  useEffect(() => { drawerRef.current?.showModal(); }, []);

  const loadRunArtifacts = useCallback(
    async (run: AnalysisHistoryItem, opener?: HTMLButtonElement) => {
      if (opener) libraryOpenerRef.current = opener;
      artifactRequestRef.current += 1;
      const requestId = artifactRequestRef.current;
      artifactAbortRef.current?.abort();
      cancelDraft();
      const controller = new AbortController();
      artifactAbortRef.current = controller;
      setEntryRunId(undefined);
      setReviewingSelection(false);
      setSelectedRun(run);
      setArtifacts([]);
      setDraftPlan(null);
      setDraftError(null);
      setError(null);
      setLoadingArtifacts(true);
      try {
        const items = await listReportArtifactIndex(projectId, run.id, controller.signal);
        if (requestId !== artifactRequestRef.current || controller.signal.aborted) return;
        setArtifacts(items.filter((item) => item.kind !== "report"));
      } catch {
        if (requestId !== artifactRequestRef.current || controller.signal.aborted) return;
        setError(t("loadRunError"));
      } finally {
        if (requestId === artifactRequestRef.current) setLoadingArtifacts(false);
      }
    },
    [cancelDraft, projectId, t]
  );

  useEffect(() => () => {
    artifactRequestRef.current += 1;
    artifactAbortRef.current?.abort();
    draftRequestRef.current += 1;
    draftAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (reviewingSelection) { backRef.current?.focus({ preventScroll: true }); return; }
    if (selectedRun) {
      const active = document.activeElement;
      // Desktop keeps the source list available. Do not take its focus away
      // merely because the selected investigation's directory arrived.
      if (active instanceof HTMLElement && active !== document.body && active.getClientRects().length) return;
      detailRef.current?.focus({ preventScroll: true });
    } else {
      const opener = libraryOpenerRef.current;
      const target = opener?.isConnected && opener.getClientRects().length ? opener : librarySearchRef.current;
      target?.focus({ preventScroll: true });
    }
  }, [selectedRun, reviewingSelection]);

  const existingArtifactIds = useMemo(
    () => new Set(currentReport?.existing_artifact_ids || []),
    [currentReport]
  );
  const smartArtifacts = useMemo(
    () => artifacts.filter((artifact) => !existingArtifactIds.has(artifact.id)),
    [artifacts, existingArtifactIds]
  );
  const artifactById = useMemo(
    () => new Map(artifacts.map((artifact) => [artifact.id, artifact])),
    [artifacts]
  );

  const switchMode = (nextMode: InvestigationPickerMode) => {
    if (nextMode === mode) return;
    cancelDraft();
    setMode(nextMode);
    setReviewingSelection(false);
    setDraftPlan(null);
    setDraftError(null);
  };

  const addSelected = () => {
    if (mode !== "manual" || !selection.size) return;
    const blocks: ReportBlock[] = [];
    for (const group of selectionGroups) for (const { item } of group.items) {
      if (item.kind === "summary") blocks.push(analysisSummaryToReportBlock(item.run, blocksCopy));
      else {
        const state = content.entries.get(artifactContentKey(item.artifact));
        if (state?.status !== "ready") return;
        blocks.push(artifactToReportBlock(state.artifact, blocksCopy, locale));
      }
    }
    onAdd(reflowBlocks(blocks));
    closePicker();
  };

  const generateDraft = async () => {
    if (!selectedRun || generatingDraft || loadingArtifacts || error) return;
    cancelDraft();
    const requestId = draftRequestRef.current;
    const selectedRunId = selectedRun.id;
    const controller = new AbortController();
    draftAbortRef.current = controller;
    setGeneratingDraft(true);
    setDraftError(null);
    setDraftPlan(null);
    try {
      const plan = await requestReportDraftPlan(
        projectId,
        selectedRunId,
        locale === "en" ? "en" : "zh",
        currentReport,
        controller.signal
      );
      if (
        requestId !== draftRequestRef.current ||
        controller.signal.aborted ||
        selectedRunId !== selectedRun.id
      ) {
        return;
      }
      setDraftPlan(plan);
    } catch (nextError) {
      if (requestId !== draftRequestRef.current || controller.signal.aborted) return;
      setDraftError(
        nextError instanceof ReportDraftUnavailableError
          ? t("draftUnavailable")
          : t("draftError")
      );
    } finally {
      if (requestId === draftRequestRef.current) {
        setGeneratingDraft(false);
        draftAbortRef.current = null;
      }
    }
  };

  const applyDraft = async () => {
    if (!selectedRun || !draftPlan || loadingArtifacts || error || applyingDraft) return;
    cancelDraft();
    const requestId = draftRequestRef.current;
    setApplyingDraft(true);
    setDraftError(null);
    const loaded = await Promise.all(smartArtifacts.map(content.load));
    if (requestId !== draftRequestRef.current) return;
    setApplyingDraft(false);
    if (loaded.some((artifact) => artifact === null)) { setDraftError(t("draftContentFailed")); return; }
    onGenerateDraft(selectedRun, loaded.filter((artifact): artifact is AnalysisArtifact => artifact !== null), draftPlan);
    closePicker();
  };

  const selectionCount = selection.size;
  const selectedStates = [...selection.values()].flatMap((item) => item.kind === "artifact"
    ? [content.entries.get(artifactContentKey(item.artifact))] : []);
  const pendingCount = selectedStates.filter((state) => !state || state.status === "loading").length;
  const failedCount = selectedStates.filter((state) => state?.status === "error").length;
  const previewSections = draftPlan
    ? draftPlan.sections?.length
      ? draftPlan.sections
      : legacyPreviewSections(draftPlan, {
          overview: tDraft("sectionOverview"),
          detail: tDraft("sectionDetail"),
          evidence: tDraft("sectionEvidence"),
        })
    : [];
  const selectedTitle = selectedRun
    ? runTitle(selectedRun, t("unnamedRun"))
    : "";
  const artifactStats = {
    metrics: smartArtifacts.filter((item) => item.kind === "metric").length,
    charts: smartArtifacts.filter((item) => item.kind === "chart").length,
    details: smartArtifacts.filter(
      (item) => item.kind === "table" || item.kind === "result_snapshot"
    ).length,
  };

  return (
    <TaskDialog dialogRef={drawerRef} writingRef={writingRef} busy={false} autoFocusClose={false}
      title={t(mode === "smart" ? "smartTitle" : "manualTitle")}
      name={reviewingSelection ? t("selectedContent") : selectedTitle || undefined}
      closeLabel={t("close")} onClose={closePicker} onEscape={closePicker}>

        <div className="grid shrink-0 grid-cols-2 border-b border-border bg-muted/25 p-1.5">
          <Button variant="ghost"
            type="button"
            aria-pressed={mode === "smart"}
            onClick={() => switchMode("smart")}
            className={`flex h-9 items-center justify-center gap-2 text-xs font-semibold ${
              mode === "smart"
                ? "bg-card text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Sparkles size={14} />
            {t("modeSmart")}
          </Button>
          <Button variant="ghost"
            type="button"
            aria-pressed={mode === "manual"}
            aria-label={t("modeManual")}
            onClick={() => switchMode("manual")}
            className={`flex h-9 items-center justify-center gap-2 text-xs font-semibold ${
              mode === "manual"
                ? "bg-card text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Check size={14} />
            {t("modeManual")}
            {selectionCount > 0 && <span aria-hidden="true" className="min-w-4 bg-primary/10 px-1 text-[10px] tabular-nums text-primary">{selectionCount}</span>}
          </Button>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 w-[320px] shrink-0 flex-col border-r border-border bg-muted/15">
            <InvestigationLibrary projectId={projectId} view={libraryView} onViewChange={setLibraryView}
              initialRunId={entryRunId} onSelect={loadRunArtifacts} searchInputRef={librarySearchRef}
              selectedCounts={selectedCounts} activeRunId={selectedRun?.id} />
          </div>
        {reviewingSelection ? (
          <InvestigationSelectionReview selection={selection}
            contents={content.entries} onLoad={content.load}
            onMoveItem={(key, direction) => dispatchSelection({ type: "moveItem", key, direction })}
            onMoveGroup={(key, direction) => dispatchSelection({ type: "moveGroup", key, direction })}
            onRemove={(key) => dispatchSelection({ type: "remove", key })}
            onClear={() => dispatchSelection({ type: "clear" })} />
        ) : !selectedRun ? (
          <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 px-12 text-center">
            <FileText size={28} strokeWidth={1.25} className="text-primary/70" aria-hidden="true" />
            <h3 className="text-base font-semibold">{t("chooseInvestigation")}</h3>
            <p className="max-w-64 text-sm leading-6 text-muted-foreground">{t(mode === "smart" ? "smartSubtitle" : "manualSubtitle")}</p>
          </div>
        ) : <div ref={detailRef} role="region" aria-label={t("investigationContent")} tabIndex={-1}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40">
          {error && <div className="m-5 border border-destructive/30 bg-destructive/5 px-4 py-3">
            <p role="alert" className="text-xs text-destructive">{error}</p>
            <button type="button" onClick={() => void loadRunArtifacts(selectedRun)}
              className="mt-3 text-xs font-semibold text-primary">{t("retry")}</button>
          </div>}
          {loadingArtifacts && <div role="status" className="flex min-h-44 items-center justify-center text-sm text-muted-foreground">
            <Loader2 size={17} className="mr-2 animate-spin" />{t("loading")}
          </div>}

          {selectedRun && !loadingArtifacts && !error && mode === "smart" && (
            <div className="space-y-0">
              <section className="border-b border-border px-5 py-5">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center bg-primary/10 text-primary">
                    <FileText size={16} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {t("sourceInvestigation")}
                    </p>
                    <h3 className="mt-1 text-sm font-semibold">{selectedTitle}</h3>
                    <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">
                      {selectedRun.report.summary || selectedRun.query}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                  <span className="border border-border px-2 py-1">{t("metricCount", { count: artifactStats.metrics })}</span>
                  <span className="border border-border px-2 py-1">{t("chartCount", { count: artifactStats.charts })}</span>
                  <span className="border border-border px-2 py-1">{t("detailCount", { count: artifactStats.details })}</span>
                </div>
              </section>

              {!draftPlan ? (
                <section className="px-5 py-4">
                  {(currentReport?.has_user_edits ||
                    Boolean(currentReport?.existing_artifact_ids.length)) && (
                    <p className="border-l-2 border-border pl-3 text-[11px] leading-5 text-muted-foreground">
                      {t("existingContentPreserved")}
                    </p>
                  )}
                  {draftError && (
                    <div role="alert" className="mt-5 border border-destructive/30 bg-destructive/5 px-4 py-3">
                      <p className="text-xs font-medium text-destructive">{draftError}</p>
                      <button
                        type="button"
                        onClick={() => switchMode("manual")}
                        className="mt-2 text-[11px] font-semibold text-primary hover:underline"
                      >
                        {t("switchToManual")}
                      </button>
                    </div>
                  )}
                </section>
              ) : (
                <section className="px-5 py-5">
                  {draftError && <p role="alert" className="mb-4 text-xs text-destructive">{draftError}</p>}
                  <div className="flex items-center gap-2 text-primary">
                    <Check size={15} />
                    <h3 className="text-xs font-semibold">{t("previewReady")}</h3>
                  </div>
                  <h4 className="mt-4 text-lg font-semibold tracking-[-0.025em]">{draftPlan.title}</h4>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">{draftPlan.description}</p>
                  <ol className="mt-5 border border-border">
                    {previewSections.map((section, index) => (
                      <li key={`${section.title}-${index}`} className="flex gap-3 border-b border-border px-4 py-3 last:border-b-0">
                        <span className="text-[10px] font-semibold tabular-nums text-primary">{String(index + 1).padStart(2, "0")}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold">{section.title}</p>
                          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                            {section.purpose || t("sectionItems", { count: section.artifact_ids.length })}
                          </p>
                          {section.artifact_ids.length > 0 && (
                            <p className="mt-1.5 line-clamp-2 text-[10px] text-muted-foreground">
                              {section.artifact_ids
                                .map((id) => artifactById.get(id)?.title)
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                  <button
                    type="button"
                    onClick={() => {
                      setDraftPlan(null);
                      setDraftError(null);
                    }}
                    className="mt-3 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
                  >
                    {t("regenerate")}
                  </button>
                </section>
              )}
            </div>
          )}

          {!loadingArtifacts && !error && mode === "manual" && (
            <InvestigationContentList key={selectedRun.id} run={chosenSummary?.run ?? selectedRun}
              artifacts={manualArtifacts} selectedIds={selectedIds}
              contents={content.entries} onLoad={content.load}
              includeSummary={includeSummary} existingIds={existingArtifactIds}
              onSummaryChange={(selected) => dispatchSelection({ type: "summary", run: selectedRun, selected })}
              onToggle={(id) => {
                const artifact = manualArtifacts.find((item) => item.id === id);
                if (artifact) {
                  dispatchSelection({ type: "toggleArtifact", run: selectedRun, artifact });
                  if (!selectedIds.has(id)) void content.load(artifact);
                }
              }}
              onSelectNew={() => {
                dispatchSelection({ type: "selectNew", run: selectedRun, artifacts: manualArtifacts, existingIds: existingArtifactIds });
                manualArtifacts.filter((artifact) => !existingArtifactIds.has(artifact.id)).forEach((artifact) => { void content.load(artifact); });
              }}
              onClear={() => dispatchSelection({ type: "clearRun", run: selectedRun })}
            />
          )}
        </div>}
        </div>

        {selectedRun && !loadingArtifacts && !error && mode === "smart" && (
          <footer className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-t border-border px-5 py-3">
            <span className="min-w-0 flex-1 text-[10px] leading-4 text-muted-foreground">
              {draftPlan && selectionCount > 0 ? t("manualSelectionExcluded", { count: selectionCount }) : draftPlan ? t("reviewBeforeApply") : t("smartFooterHint")}
            </span>
            <Button
              type="button"
              onClick={draftPlan ? applyDraft : () => void generateDraft()}
              disabled={generatingDraft || applyingDraft || Boolean(error)}
              className="text-xs"
            >
              {generatingDraft || applyingDraft ? (
                <Loader2 size={14} className="animate-spin" />
              ) : draftPlan ? (
                <Check size={14} />
              ) : (
                <Sparkles size={14} />
              )}
              {applyingDraft ? t("addingContent") : generatingDraft
                ? t("generating")
                : draftPlan
                  ? t(selectionCount > 0 ? "applyOnlyDraft" : "applyDraft")
                  : t("generateButton")}
            </Button>
          </footer>
        )}

        {mode === "manual" && (!error || selectionCount > 0 || reviewingSelection) && (
          <footer className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-3">
            <Button ref={backRef} variant="ghost" type="button" disabled={!reviewingSelection && selectionCount === 0}
              aria-label={t(reviewingSelection ? "continueSelecting" : "reviewSelection")}
              aria-expanded={reviewingSelection} onClick={() => setReviewingSelection(!reviewingSelection)}
              className="flex min-w-0 items-center gap-1.5 text-left text-xs tabular-nums text-primary disabled:text-muted-foreground">
              <span aria-live="polite">{reviewingSelection ? t("continueSelecting") : t("selectionCount", { count: selectionCount })}
                {(pendingCount > 0 || failedCount > 0) && <span className="mt-1 block text-[10px] text-muted-foreground">{failedCount ? t("failedContentCount", { count: failedCount }) : t("pendingContentCount", { count: pendingCount })}</span>}
              </span>
              {reviewingSelection ? <ArrowLeft size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
            </Button>
            <Button type="button" onClick={addSelected} disabled={selectionCount === 0 || pendingCount > 0 || failedCount > 0}
              className="text-xs">
              {selectionCount > 0 ? <Check size={14} /> : <Plus size={14} />}
              {t("addToPage")}
            </Button>
          </footer>
        )}
    </TaskDialog>
  );
}
