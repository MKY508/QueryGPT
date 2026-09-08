"use client";

import {
  ArrowLeft,
  BarChart3,
  Check,
  FileText,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Table2,
  Target,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { AnalysisArtifact, AnalysisRunSummary } from "@/lib/types/api";
import type { ReportBlock } from "@/lib/reports";
import {
  listReportAnalysisRuns,
  listRunArtifacts,
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
    run: AnalysisRunSummary,
    artifacts: AnalysisArtifact[],
    plan: ReportDraftPlan
  ) => void;
}

function runTitle(run: AnalysisRunSummary, unnamed: string): string {
  return run.report.title?.trim() || run.query.trim() || unnamed;
}

function dateLabel(value: string, locale: string, recent: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return recent;
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(date);
}

function artifactIcon(kind: AnalysisArtifact["kind"]) {
  if (kind === "metric") return <Target size={14} />;
  if (kind === "chart") return <BarChart3 size={14} />;
  if (kind === "table" || kind === "result_snapshot") return <Table2 size={14} />;
  return <FileText size={14} />;
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

export function InvestigationPicker({
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
  const [runs, setRuns] = useState<AnalysisRunSummary[]>([]);
  const [selectedRun, setSelectedRun] = useState<AnalysisRunSummary | null>(null);
  const [artifacts, setArtifacts] = useState<AnalysisArtifact[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [includeSummary, setIncludeSummary] = useState(false);
  const [search, setSearch] = useState("");
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingArtifacts, setLoadingArtifacts] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [draftPlan, setDraftPlan] = useState<ReportDraftPlan | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const artifactRequestRef = useRef(0);
  const artifactAbortRef = useRef<AbortController | null>(null);
  const draftRequestRef = useRef(0);
  const draftAbortRef = useRef<AbortController | null>(null);
  const drawerRef = useRef<HTMLElement>(null);

  const cancelDraft = useCallback(() => {
    draftRequestRef.current += 1;
    draftAbortRef.current?.abort();
    draftAbortRef.current = null;
    setGeneratingDraft(false);
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
  });

  const loadRunArtifacts = useCallback(
    async (run: AnalysisRunSummary) => {
      artifactRequestRef.current += 1;
      const requestId = artifactRequestRef.current;
      artifactAbortRef.current?.abort();
      cancelDraft();
      const controller = new AbortController();
      artifactAbortRef.current = controller;
      setSelectedRun(run);
      setArtifacts([]);
      setSelectedIds(new Set());
      setIncludeSummary(false);
      setDraftPlan(null);
      setDraftError(null);
      setError(null);
      setLoadingArtifacts(true);
      try {
        const items = await listRunArtifacts(projectId, run.id, controller.signal);
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

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setMode(initialMode);
    setSelectedRun(null);
    setArtifacts([]);
    setSelectedIds(new Set());
    setIncludeSummary(false);
    setSearch("");
    setError(null);
    setDraftError(null);
    setDraftPlan(null);
    setLoadingRuns(true);
    void listReportAnalysisRuns(projectId)
      .then((items) => {
        if (cancelled) return;
        const completed = items.filter((item) => item.state === "completed");
        setRuns(completed);
        const initialRun = initialRunId
          ? completed.find((item) => item.id === initialRunId)
          : undefined;
        if (initialRun) void loadRunArtifacts(initialRun);
      })
      .catch(() => {
        if (!cancelled) {
          setError(t("loadListError"));
        }
      })
      .finally(() => !cancelled && setLoadingRuns(false));
    return () => {
      cancelled = true;
      artifactRequestRef.current += 1;
      artifactAbortRef.current?.abort();
      draftRequestRef.current += 1;
      draftAbortRef.current?.abort();
    };
  }, [initialMode, initialRunId, loadRunArtifacts, open, projectId, t]);

  const filteredRuns = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return runs;
    return runs.filter((run) =>
      `${runTitle(run, t("unnamedRun"))} ${run.query}`
        .toLocaleLowerCase()
        .includes(query)
    );
  }, [runs, search, t]);

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
    setDraftPlan(null);
    setDraftError(null);
    setError(null);
    setSelectedIds(new Set());
    setIncludeSummary(false);
  };

  const backToRuns = () => {
    artifactRequestRef.current += 1;
    artifactAbortRef.current?.abort();
    cancelDraft();
    setLoadingArtifacts(false);
    setSelectedRun(null);
    setArtifacts([]);
    setSelectedIds(new Set());
    setIncludeSummary(false);
    setDraftPlan(null);
    setDraftError(null);
    setError(null);
  };

  const addSelected = () => {
    if (!selectedRun) return;
    const blocks = artifacts
      .filter((artifact) => selectedIds.has(artifact.id))
      .map((artifact) => artifactToReportBlock(artifact, blocksCopy, locale));
    if (includeSummary) {
      blocks.unshift(analysisSummaryToReportBlock(selectedRun, blocksCopy));
    }
    if (!blocks.length) return;
    onAdd(reflowBlocks(blocks));
    closePicker();
  };

  const generateDraft = async () => {
    if (!selectedRun || generatingDraft) return;
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

  const applyDraft = () => {
    if (!selectedRun || !draftPlan) return;
    onGenerateDraft(selectedRun, smartArtifacts, draftPlan);
    closePicker();
  };

  if (!open) return null;

  const selectionCount = selectedIds.size + (includeSummary ? 1 : 0);
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
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/25"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && closePicker()}
    >
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="flex h-full w-full min-w-0 flex-col overflow-x-hidden bg-card shadow-2xl sm:w-[min(520px,calc(100vw-1.5rem))]"
        aria-label={mode === "smart" ? t("smartDrawerAria") : t("manualDrawerAria")}
      >
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            {selectedRun && (
              <button
                type="button"
                aria-label={t("backToRuns")}
                onClick={backToRuns}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">
                {selectedRun
                  ? mode === "smart"
                    ? t("smartReviewTitle")
                    : t("headerSelectContent")
                  : mode === "smart"
                    ? t("smartTitle")
                    : t("manualTitle")}
              </h2>
              <p className="mt-0.5 max-w-full truncate text-[11px] text-muted-foreground">
                {selectedRun
                  ? selectedTitle
                  : mode === "smart"
                    ? t("smartSubtitle")
                    : t("manualSubtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label={t("close")}
            onClick={closePicker}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={17} />
          </button>
        </header>

        <div className="grid shrink-0 grid-cols-2 border-b border-border bg-muted/25 p-1.5">
          <button
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
          </button>
          <button
            type="button"
            aria-pressed={mode === "manual"}
            onClick={() => switchMode("manual")}
            className={`flex h-9 items-center justify-center gap-2 text-xs font-semibold ${
              mode === "manual"
                ? "bg-card text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Check size={14} />
            {t("modeManual")}
          </button>
        </div>

        {!selectedRun && (
          <div className="shrink-0 border-b border-border px-5 py-4">
            <label className="flex h-9 items-center gap-2 border border-input bg-background px-3 focus-within:border-primary">
              <Search size={14} className="text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("searchPlaceholder")}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </label>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error && (
            <p role="alert" className="m-5 border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive">
              {error}
            </p>
          )}
          {(loadingRuns || loadingArtifacts) && (
            <div className="flex min-h-44 items-center justify-center text-sm text-muted-foreground">
              <Loader2 size={17} className="mr-2 animate-spin" />
              {t("loading")}
            </div>
          )}

          {!selectedRun && !loadingRuns && filteredRuns.length === 0 && (
            <div className="px-8 py-20 text-center">
              <p className="text-sm font-medium">{t("emptyTitle")}</p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{t("emptyDesc")}</p>
            </div>
          )}

          {!selectedRun && !loadingRuns && (
            <ol className="divide-y divide-border">
              {filteredRuns.map((run) => {
                const title = runTitle(run, t("unnamedRun"));
                return (
                  <li key={run.id}>
                    <button
                      type="button"
                      onClick={() => void loadRunArtifacts(run)}
                      className="w-full px-5 py-4 text-left transition-colors hover:bg-primary/[0.035]"
                    >
                      <span className="block text-sm font-medium leading-5">{title}</span>
                      <span className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{dateLabel(run.updated_at, locale, t("recent"))}</span>
                        <span aria-hidden="true">·</span>
                        <span className="line-clamp-1">{run.query}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}

          {selectedRun && !loadingArtifacts && mode === "smart" && (
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

          {selectedRun && !loadingArtifacts && mode === "manual" && (
            <div className="divide-y divide-border">
              <section className="flex items-center justify-between gap-4 bg-muted/25 px-5 py-3">
                <div>
                  <h3 className="text-xs font-semibold">{t("manualSelectTitle")}</h3>
                  <p className="mt-1 text-[10px] text-muted-foreground">{t("manualSelectDesc")}</p>
                </div>
                <div className="flex gap-3 text-[11px] font-semibold">
                  <button
                    type="button"
                    onClick={() => {
                      setIncludeSummary(true);
                      setSelectedIds(new Set(artifacts.map((artifact) => artifact.id)));
                    }}
                    className="text-primary hover:underline"
                  >
                    {t("selectAll")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIncludeSummary(false);
                      setSelectedIds(new Set());
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {t("clearSelection")}
                  </button>
                </div>
              </section>
              <label className="flex cursor-pointer items-start gap-3 px-5 py-4 hover:bg-primary/[0.025]">
                <input
                  type="checkbox"
                  checked={includeSummary}
                  onChange={(event) => setIncludeSummary(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <FileText size={14} className="text-primary" />
                    {t("summaryLabel")}
                  </span>
                  <span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {selectedRun.report.summary || selectedRun.query}
                  </span>
                </span>
              </label>
              {artifacts.map((artifact) => (
                <label key={artifact.id} className="flex cursor-pointer items-start gap-3 px-5 py-4 hover:bg-primary/[0.025]">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(artifact.id)}
                    onChange={() =>
                      setSelectedIds((current) => {
                        const next = new Set(current);
                        if (next.has(artifact.id)) next.delete(artifact.id);
                        else next.add(artifact.id);
                        return next;
                      })
                    }
                    className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <span className="text-primary">{artifactIcon(artifact.kind)}</span>
                      {artifact.title}
                    </span>
                    <span className="mt-1 block text-[11px] text-muted-foreground">{t("artifactHint")}</span>
                  </span>
                </label>
              ))}
              {!artifacts.length && !includeSummary && (
                <p className="px-5 py-10 text-center text-xs text-muted-foreground">{t("emptyArtifacts")}</p>
              )}
            </div>
          )}
        </div>

        {selectedRun && !loadingArtifacts && mode === "smart" && (
          <footer className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 sm:flex-nowrap sm:gap-4 sm:px-5">
            <span className="min-w-0 flex-1 text-[10px] leading-4 text-muted-foreground">
              {draftPlan ? t("reviewBeforeApply") : t("smartFooterHint")}
            </span>
            <button
              type="button"
              onClick={draftPlan ? applyDraft : () => void generateDraft()}
              disabled={generatingDraft || Boolean(error)}
              className="inline-flex h-9 shrink-0 items-center gap-2 bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60"
            >
              {generatingDraft ? (
                <Loader2 size={14} className="animate-spin" />
              ) : draftPlan ? (
                <Check size={14} />
              ) : (
                <Sparkles size={14} />
              )}
              {generatingDraft
                ? t("generating")
                : draftPlan
                  ? t("applyDraft")
                  : t("generateButton")}
            </button>
          </footer>
        )}

        {selectedRun && !loadingArtifacts && mode === "manual" && (
          <footer className="flex h-16 shrink-0 items-center justify-between gap-4 border-t border-border px-5">
            <span className="text-xs tabular-nums text-muted-foreground">
              {t("selectionCount", { count: selectionCount })}
            </span>
            <button
              type="button"
              onClick={addSelected}
              disabled={selectionCount === 0}
              className="inline-flex h-9 items-center gap-2 bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-40"
            >
              {selectionCount > 0 ? <Check size={14} /> : <Plus size={14} />}
              {t("addToPage")}
            </button>
          </footer>
        )}
      </aside>
    </div>
  );
}
