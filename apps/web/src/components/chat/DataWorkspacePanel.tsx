"use client";

import { useId, useRef, useState } from "react";
import { useDataWorkspacePresentation } from "./useDataWorkspacePresentation";
import { Button } from "@/components/ui/button";
import { TabList } from "@/components/ui/TabList";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { FILE_UPLOAD_ACCEPT } from "@/lib/file-formats";
import { SourceUploadQueue } from "./SourceUploadQueue";
import { SourceDirectory } from "./SourceDirectory";
import { SourceStatus } from "./SourceStatus";
import { SourceDataPreview } from "./SourceDataPreview";
import { sourceAwaitsReplacement, sourceDisplayState } from "@/lib/source-directory";
import { sourceIsCurrent } from "@/lib/source-activation";
import { WorkbookNavigator } from "./WorkbookNavigator";
import { CsvNavigator } from "./CsvNavigator";
import { SourceReplacementDialog } from "./SourceReplacementDialog";
import type { CsvSelection } from "@/lib/csv-import";
import type { WorkbookSelection } from "@/lib/workbook";
import {
  AlertCircle,
  ArrowRight,
  BookOpenText,
  Check,
  CheckCircle2,
  ChevronDown,
  Database,
  FileSpreadsheet,
  History,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import type {
  ConnectionSummary,
  PreflightReport,
  ProjectDataSource,
  SemanticEntry,
} from "@/lib/types/api";
import { useProjectStore } from "@/lib/stores/project";
import { cn } from "@/lib/utils";
import { VisualCleaningEditor } from "./VisualCleaningEditor";
import { sourceCleaningColumns } from "@/lib/cleaning-field-names";
import { RecipeReplayDialog } from "./RecipeReplayDialog";
import type { DataWorkspaceView } from "@/lib/workbench-pane";

interface DataWorkspacePanelProps {
  embedded?: boolean;
  open: boolean;
  onClose: () => void;
  onConfigureConnection: () => void;
  preprocessingEnabled?: boolean;
  settingsLoaded?: boolean;
  onOpenPreprocessingSettings?: () => void;
  connections?: ConnectionSummary[];
  view?: DataWorkspaceView;
  onViewChange?: (view: DataWorkspaceView) => void;
}

function isBusinessFacingKnowledge(entry: SemanticEntry): boolean {
  if (entry.entry_type === "verified_query") return false;
  if (
    entry.entry_type === "cleaning_rule" &&
    /^[\[{]/.test(entry.value.trim())
  ) {
    return false;
  }
  return true;
}

export function getPendingUnderstandingCount(knowledge: SemanticEntry[]): number {
  const visibleKnowledge = knowledge
    .filter(isBusinessFacingKnowledge)
    .filter((entry) => !(entry.state === "candidate" && entry.validity === "stale"));
  return visibleKnowledge.filter((entry) => entry.state === "candidate").length;
}

function UnderstandingMap({
  sources,
  reports,
  knowledgeCount,
  relationshipCount,
}: {
  sources: ProjectDataSource[];
  reports: PreflightReport[];
  knowledgeCount: number;
  relationshipCount: number;
}) {
  const t = useTranslations("dataWorkspace");
  if (!sources.length) {
    return (
      <div className="flex min-h-40 w-full items-center justify-center border border-dashed border-border bg-background/70 px-6 text-center text-xs leading-5 text-muted-foreground rounded-xl">
        {t("emptyUnderstandingHint")}
      </div>
    );
  }

  return (
    <div
      className="border border-border bg-background/70 p-3 rounded-xl"
      aria-label={t("understandingMapAria")}
    >
      <div className="grid grid-cols-2 gap-2">
        {sources.map((source) => {
          return (
            <div
              key={source.id}
              data-source-overview-node={source.id}
              className="min-w-0 border border-primary/20 bg-card px-3.5 py-3 rounded-xl"
            >
              <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground">
                {source.kind === "connection" ? <Database size={13} /> : <FileSpreadsheet size={13} />}
                {t("dataSourcesTab")}
              </div>
              <div className="mt-2 truncate text-sm font-semibold text-foreground">
                {source.name}
              </div>
              <SourceStatus source={source} report={reports.find((report) => report.data_source_id === source.id)} compact className="mt-1" />
            </div>
          );
        })}
      </div>
      <div
        data-understanding-summary
        className="mt-3 flex flex-wrap items-center justify-between gap-3 border border-success/30 bg-success/[0.05] px-4 py-3 rounded-xl"
      >
        <div className="flex items-center gap-2 text-xs font-semibold text-success">
          <BookOpenText size={14} />
          {t("knowledgeCount", { count: knowledgeCount })}
        </div>
        <div className="text-xs text-muted-foreground">
          {relationshipCount
            ? t("relationsCount", { count: relationshipCount })
            : t("relationsOnDemand")}
        </div>
      </div>
    </div>
  );
}

export function DataWorkspacePanel(props: DataWorkspacePanelProps) {
  const projectId = useProjectStore(state => state.currentProjectId);
  return <ProjectDataWorkspace key={projectId ?? "no-project"} {...props} />;
}

function ProjectDataWorkspace({
  embedded = false,
  open,
  onClose,
  onConfigureConnection,
  preprocessingEnabled = true,
  settingsLoaded = true,
  connections,
  view,
  onViewChange,
}: DataWorkspacePanelProps) {
  const { locale, businessIssueTitle, businessPreflightSummary, dedupeBusinessIssues, businessColumnSummary, knowledgeKindLabel, knowledgeDisplayValue, revisionTime } = useDataWorkspacePresentation();
  const tabsId = useId();
  const t = useTranslations("dataWorkspace");

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localView, setLocalView] = useState<DataWorkspaceView>("sources");
  const activeView = view || localView;
  const changeView = (nextView: DataWorkspaceView) => {
    if (view === undefined) setLocalView(nextView);
    onViewChange?.(nextView);
  };
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);
  const [expandedRecipeHistoryIds, setExpandedRecipeHistoryIds] = useState<string[]>([]);
  const [replayTarget, setReplayTarget] = useState<{
    projectId: string; sourceId: string; recipeId: string; revisionId?: string;
  } | null>(null);
  const [recipeHistoryFeedback, setRecipeHistoryFeedback] = useState<{
    recipeId: string;
    message: string;
  } | null>(null);
  const [removingSourceId, setRemovingSourceId] = useState<string | null>(null);
  const [cleaningTarget, setCleaningTarget] = useState<{
    projectId: string; sourceId: string; column?: string;
  } | null>(null);
  const [workbookTarget, setWorkbookTarget] = useState<{ projectId: string; sourceId: string } | null>(null);
  const [replacementTarget, setReplacementTarget] = useState<{ projectId: string; sourceId: string } | null>(null);
  const [sourceFeedback, setSourceFeedback] = useState<{
    sourceId: string;
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [templateSourceById, setTemplateSourceById] = useState<Record<string, string>>({});
  const [templateFeedback, setTemplateFeedback] = useState<{
    templateId: string;
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const {
    currentProjectId,
    sources,
    preflightReports,
    recipes,
    recipeRevisionsByRecipe,
    recipeRevisionLoadingByRecipe,
    recipeRevisionRestoringByRecipe,
    recipeRevisionErrorByRecipe,
    recipeTemplates,
    recipeTemplatePreviewById,
    recipeTemplateAction,
    knowledge,
    knowledgeTotal,
    pendingKnowledgeCount,
    relationshipKnowledgeCount,
    isUploading,
    sourceAction,
    error,
    uploadFiles,
    attachConnection,
    profileSource,
    loadRecipeRevisions,
    previewRecipeTemplate,
    bindRecipeTemplate,
    reorganizeSource,
    acceptReplacement,
    keepTrustedSource,
    removeSource,
  } = useProjectStore();

  const attachedConnections = new Set(
    sources.map((source) => source.connection_id).filter(Boolean)
  );

  const acceptFiles = (files: File[]) => {
    if (files.length && currentProjectId) void uploadFiles(files);
  };

  const performSourceAction = async (
    sourceId: string,
    action: () => Promise<void>,
    successMessage: string
  ) => {
    setSourceFeedback(null);
    try {
      await action();
      setSourceFeedback({ sourceId, tone: "success", message: successMessage });
    } catch {
      setSourceFeedback({
        sourceId,
        tone: "error",
        message: t("sanitationFailed"),
      });
    }
  };

  const toggleRecipeHistory = (recipeId: string) => {
    const opening = !expandedRecipeHistoryIds.includes(recipeId);
    setExpandedRecipeHistoryIds((current) =>
      opening ? [...current, recipeId] : current.filter((id) => id !== recipeId)
    );
    if (!opening) {
      return;
    }
    if (recipeHistoryFeedback?.recipeId === recipeId) setRecipeHistoryFeedback(null);
    if (
      !(recipeId in recipeRevisionsByRecipe) &&
      !recipeRevisionLoadingByRecipe[recipeId]
    ) {
      void loadRecipeRevisions(recipeId).catch(() => undefined);
    }
  };

  const reviewRecipe = (sourceId: string, revisionId?: string) => {
    if (!currentProjectId || sourceAction) return;
    const recipe = recipes.find((item) => item.data_source_id === sourceId);
    if (!recipe) {
      void performSourceAction(sourceId, () => reorganizeSource(sourceId), t("recipeReapplied"));
      return;
    }
    setRecipeHistoryFeedback(null);
    setReplayTarget({ projectId: currentProjectId, sourceId, recipeId: recipe.id, revisionId });
  };

  const performTemplatePreview = async (templateId: string, sourceId: string) => {
    setTemplateFeedback(null);
    try {
      await previewRecipeTemplate(templateId, sourceId);
    } catch {
      setTemplateFeedback({
        templateId,
        tone: "error",
        message: t("sanitationNotDryRun"),
      });
    }
  };

  const performTemplateBind = async (templateId: string) => {
    setTemplateFeedback(null);
    try {
      await bindRecipeTemplate(templateId);
      setTemplateFeedback({
        templateId,
        tone: "success",
        message: t("sanitationAppliedNoTouch"),
      });
    } catch {
      setTemplateFeedback({
        templateId,
        tone: "error",
        message: t("sanitationChanged"),
      });
    }
  };

  const visibleKnowledge = knowledge
    .filter(isBusinessFacingKnowledge)
    .filter((entry) => !(entry.state === "candidate" && entry.validity === "stale"))
    .sort((left, right) => {
      const priority = { candidate: 0, confirmed: 1, locked: 2 };
      return priority[left.state] - priority[right.state];
    });
  const displayedKnowledge = visibleKnowledge.slice(0, 8);
  // A project round trip must not reopen a previous project's editor.
  if (cleaningTarget && cleaningTarget.projectId !== currentProjectId) setCleaningTarget(null);
  const cleaningSource = cleaningTarget?.projectId === currentProjectId
    ? sources.find((source) => source.id === cleaningTarget.sourceId && source.project_id === cleaningTarget.projectId) : undefined;
  const replacementSource = replacementTarget?.projectId === currentProjectId
    ? sources.find((source) => source.id === replacementTarget.sourceId) : undefined;
  const replacementCandidates = sources.filter((source) => source.kind === "file"
    && ["attached", "error"].includes(source.status) && !source.profile_data.replacement_of
    && !recipes.some((recipe) => recipe.data_source_id === source.id));
  const workbookSource = workbookTarget?.projectId === currentProjectId
    ? sources.find((source) => source.id === workbookTarget.sourceId) : undefined;
  const PreparationNavigator = workbookSource && (workbookSource.format?.toLowerCase() === "csv" || /\.csv$/i.test(workbookSource.name)) ? CsvNavigator : WorkbookNavigator;
  const cleaningRecipe = recipes.find(
    (recipe) => recipe.data_source_id === cleaningSource?.id,
  );
  const cleaningReport = preflightReports.find(
    (report) => report.data_source_id === cleaningSource?.id,
  );
  const cleaningColumns = sourceCleaningColumns(cleaningSource?.profile_data, cleaningReport?.inferred_schema);
  const openCleaning = (source: ProjectDataSource, column?: string) => {
    if (!currentProjectId || source.project_id !== currentProjectId || source.kind !== "file" || source.status === "attached") return;
    const report = preflightReports.find((item) => item.data_source_id === source.id);
    if (column !== undefined && !sourceCleaningColumns(source.profile_data, report?.inferred_schema).includes(column)) return;
    setCleaningTarget({ projectId: currentProjectId, sourceId: source.id, column });
  };

  return (
    <>
    {open && replayTarget && replayTarget.projectId === currentProjectId && sources.some((source) => source.id === replayTarget.sourceId) && <RecipeReplayDialog
      key={`${replayTarget.projectId}:${replayTarget.recipeId}:${replayTarget.revisionId || "current"}`}
      {...replayTarget} name={sources.find((source) => source.id === replayTarget.sourceId)!.name}
      canApply={settingsLoaded && preprocessingEnabled && !sourceAction}
      onApply={async (request) => {
        await useProjectStore.getState().replayRecipe(replayTarget.projectId, replayTarget.sourceId, replayTarget.recipeId, request);
        if (useProjectStore.getState().currentProjectId === replayTarget.projectId) setRecipeHistoryFeedback({ recipeId: replayTarget.recipeId, message: t("recipeReapplied") });
      }}
      onRefresh={async () => { if (useProjectStore.getState().currentProjectId !== replayTarget.projectId) throw new Error("Project changed"); await useProjectStore.getState().refreshCurrent({ throwOnError: true }); }}
      onClose={() => setReplayTarget(null)} />}
    {replacementSource && currentProjectId && <SourceReplacementDialog key={`${currentProjectId}:${replacementSource.id}`} projectId={currentProjectId} source={replacementSource} candidates={replacementCandidates} canApply={settingsLoaded && preprocessingEnabled && !sourceAction}
      onApply={(request) => useProjectStore.getState().replaceSource(currentProjectId, replacementSource.id, request)}
      onRefresh={async () => { if (useProjectStore.getState().currentProjectId !== currentProjectId) throw new Error("Project changed"); await useProjectStore.getState().refreshCurrent({ throwOnError: true }); }}
      onClose={() => setReplacementTarget(null)} />}
    <aside
      className={cn(
        embedded
          ? "workbench-data-panel relative min-h-0 flex-1 overflow-hidden bg-card"
          : "fixed inset-y-0 right-0 z-40 h-full w-[900px] overflow-hidden border-l border-border bg-card shadow-2xl transition-transform duration-200",
        embedded ? (!open && "hidden") : open ? "translate-x-0" : "pointer-events-none translate-x-full border-l-0"
      )}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="flex h-full w-full min-w-0 flex-col">
        <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-border px-5">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {activeView === "sources" ? t("panelTitleSources") : t("panelTitleUnderstanding")}
            </h2>
          </div>
          <Button variant="ghost" size="icon"
            onClick={onClose}
            aria-label={t("closeWorkspaceAria")}
          >
            <X size={18} />
          </Button>
        </div>

        {!embedded && <TabList id={tabsId} label={t("panelTitleSources")} value={activeView} onChange={changeView}
          className="px-5" items={[
            { value: "sources", label: t("dataSourcesTab") },
            { value: "understanding", label: <>{t("understandingTab")}{pendingKnowledgeCount > 0 &&
              <span className="ml-1.5 rounded-md bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">{pendingKnowledgeCount}</span>}</> },
          ]} />}

        <div id={tabsId + "-panel"} role={embedded ? undefined : "tabpanel"}
          aria-labelledby={embedded ? undefined : tabsId + "-" + activeView} className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {activeView === "sources" ? (
            <>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={FILE_UPLOAD_ACCEPT}
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              acceptFiles(files);
            }}
          />
          <Button variant="outline" size="sm"
            type="button"
            disabled={!currentProjectId || isUploading}
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              acceptFiles(Array.from(event.dataTransfer.files ?? []));
            }}
            className={cn("h-auto min-h-7 whitespace-normal",
              "flex w-full items-center rounded-lg border border-dashed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              sources.length ? "gap-3 px-4 py-3 text-left" : "flex-col px-5 py-7 text-center",
              dragging
                ? "border-primary bg-primary/5"
                : "border-border bg-muted/30 hover:border-primary/60 hover:bg-primary/5"
            )}
          >
            {isUploading ? (
              <Loader2 className="shrink-0 animate-spin text-primary" size={sources.length ? 20 : 24} />
            ) : (
              <UploadCloud className="shrink-0 text-primary" size={sources.length ? 20 : 24} />
            )}
            <span className={cn("min-w-0", !sources.length && "mt-3")}>
              <span className="block text-sm font-semibold text-foreground">
                {t("uploadHint", { state: isUploading ? t("uploadBusy") : t("uploadIdle") })}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">{t("uploadFormats")}</span>
            </span>
          </Button>

          <SourceUploadQueue />

          {error && (
            <div className="flex gap-2 border border-destructive/30 bg-destructive/[0.06] px-3 py-3 text-xs leading-5 text-destructive rounded-xl">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          {recipeTemplates.length > 0 && (
            <section>
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {t("recipeSectionTitle")}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {t("recipeSectionDesc")}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t("recipeCount", { count: recipeTemplates.length })}
                </span>
              </div>
              <div className="space-y-2">
                {recipeTemplates.map((template) => {
                  const compatibleSources = sources.filter((source) =>
                    template.compatible_source_ids.includes(source.id)
                  );
                  const selectedSourceId =
                    templateSourceById[template.id] || compatibleSources[0]?.id || "";
                  const preview = recipeTemplatePreviewById[template.id];
                  const visiblePreview =
                    preview?.source_id === selectedSourceId ? preview : undefined;
                  const busy = recipeTemplateAction?.templateId === template.id;
                  const rowsRemoved = visiblePreview
                    ? visiblePreview.before.rows - visiblePreview.after.rows
                    : 0;
                  const columnsChanged = visiblePreview
                    ? visiblePreview.after.columns - visiblePreview.before.columns
                    : 0;
                  const feedback =
                    templateFeedback?.templateId === template.id
                      ? templateFeedback
                      : null;
                  return (
                    <div
                      key={template.id}
                      className="border border-border bg-background px-3 py-3 rounded-xl"
                    >
                      <div className="flex items-start gap-3">
                        <History size={17} className="mt-0.5 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-foreground">
                            {template.name}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {t("recipeRevisions", { count: template.revision_count })}
                          </div>
                        </div>
                      </div>

                      {compatibleSources.length > 0 ? (
                        <div className="mt-3 space-y-2 border-t border-border pt-3">
                          {compatibleSources.length > 1 && (
                            <label className="block text-xs text-muted-foreground">
                              {t("recipeForData")}
                              <select
                                value={selectedSourceId}
                                onChange={(event) =>
                                  setTemplateSourceById((current) => ({
                                    ...current,
                                    [template.id]: event.target.value,
                                  }))
                                }
                                className="mt-1.5 w-full border border-border bg-card px-2.5 py-2 text-sm text-foreground outline-none focus:border-primary rounded-md"
                              >
                                {compatibleSources.map((source) => (
                                  <option key={source.id} value={source.id}>
                                    {source.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          {!visiblePreview && (
                            <Button variant="ghost" size="sm"
                              type="button"
                              disabled={busy || !selectedSourceId}
                              onClick={() =>
                                void performTemplatePreview(template.id, selectedSourceId)
                              }
                              className="inline-flex items-center gap-1.5 text-xs text-primary h-auto min-h-7 whitespace-normal"
                            >
                              {busy && recipeTemplateAction?.kind === "preview" ? (
                                <Loader2 size={13} className="animate-spin" />
                              ) : (
                                <RefreshCw size={13} />
                              )}
                              {t("recipePreviewButton")}
                            </Button>
                          )}

                          {visiblePreview && (
                            <div className="border border-success/30 bg-success/[0.05] px-3 py-3 rounded-xl">
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <div className="text-[11px] text-muted-foreground">{t("recipePreviewBefore")}</div>
                                  <div className="mt-1 text-sm font-semibold text-foreground">
                                    {t("recipePreviewRows", {
                                      count: visiblePreview.before.rows.toLocaleString(locale),
                                      items: visiblePreview.before.columns,
                                    })}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[11px] text-muted-foreground">{t("recipePreviewAfter")}</div>
                                  <div className="mt-1 text-sm font-semibold text-foreground">
                                    {t("recipePreviewRows", {
                                      count: visiblePreview.after.rows.toLocaleString(locale),
                                      items: visiblePreview.after.columns,
                                    })}
                                  </div>
                                </div>
                              </div>
                              <div className="mt-2 text-xs leading-5 text-muted-foreground">
                                {rowsRemoved > 0
                                  ? t("recipeExcludeRows", { count: rowsRemoved.toLocaleString(locale) })
                                  : t("recipeKeepRows")}
                                {columnsChanged !== 0
                                  ? t("recipeColumnChange", {
                                      verb: t(
                                        columnsChanged > 0
                                          ? "recipeColumnAdd"
                                          : "recipeColumnRemove"
                                      ),
                                      count: Math.abs(columnsChanged),
                                    })
                                  : t("recipeKeepColumns")}
                              </div>
                              {dedupeBusinessIssues(visiblePreview.issues)
                                .slice(0, 4)
                                .map((issue, index) => (
                                <div
                                  key={`${issue.code}-${index}`}
                                  className="mt-1.5 flex items-start gap-1.5 text-xs leading-5 text-muted-foreground"
                                >
                                  <CheckCircle2
                                    size={13}
                                    className="mt-0.5 shrink-0 text-success"
                                  />
                                  {businessIssueTitle(issue)}
                                </div>
                                ))}
                              <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                                {t("recipeNoChange")}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-3">
                                {visiblePreview.can_apply && (
                                  <Button variant="primary" size="sm"
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void performTemplateBind(template.id)}
                                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs h-auto min-h-7 whitespace-normal"
                                  >
                                    {busy && recipeTemplateAction?.kind === "bind" ? (
                                      <Loader2 size={13} className="animate-spin" />
                                    ) : (
                                      <Check size={13} />
                                    )}
{t("recipeApply")}
                                    </Button>
                                )}
                                <Button variant="ghost" size="sm"
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void performTemplatePreview(template.id, selectedSourceId)
                                  }
                                  className="text-xs text-muted-foreground hover:text-primary h-auto min-h-7 whitespace-normal"
                                >
                                  {t("recipeRecheck")}
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="mt-3 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
                          {t("recipeNoData")}
                        </p>
                      )}

                      {feedback && (
                        <div
                          role={feedback.tone === "error" ? "alert" : "status"}
                          className={cn(
                            "mt-3 border px-3 py-2 text-xs leading-5",
                            feedback.tone === "success"
                              ? "border-success/30 bg-success/[0.06] text-success"
                              : "border-destructive/30 bg-destructive/[0.06] text-destructive"
                          )}
                        >
                          {feedback.message}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <SourceDirectory key={currentProjectId} sources={sources} reports={preflightReports}>
              {(source) => {
                const isWorkbook = source.kind === "file" && (["xls", "xlsx"].includes((source.format || "").toLowerCase()) || /\.xlsx?$/i.test(source.name));
                const isCsv = source.kind === "file" && (source.format?.toLowerCase() === "csv" || /\.csv$/i.test(source.name));
                const report = preflightReports.find(
                  (item) => item.data_source_id === source.id
                );
                const recipe = recipes.find(
                  (item) => item.data_source_id === source.id
                );
                const recipeHistoryOpen = recipe
                  ? expandedRecipeHistoryIds.includes(recipe.id)
                  : false;
                const recipeRevisions = recipe
                  ? recipeRevisionsByRecipe[recipe.id] || []
                  : [];
                const isPendingReplacement = sourceAwaitsReplacement(source, report);
                const displayState = sourceDisplayState(source, report);
                const needsAction =
                  ["activation_pending", "preparation_review", "needs_confirmation", "error"].includes(displayState);
                const detailsOpen = expandedSourceId === source.id;
                const removing = removingSourceId === source.id;
                const busy = sourceAction?.sourceId === source.id;
                const drift = report?.source_snapshot?.schema_drift;
                const displayedIssues = report
                  ? dedupeBusinessIssues(report.issues)
                  : [];
                return (
                  <div key={source.id} className="border border-border bg-background px-3 py-3 rounded-xl">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 text-primary">
                        {source.kind === "file" ? (
                          <FileSpreadsheet size={18} />
                        ) : (
                          <Database size={18} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="break-words text-sm font-medium text-foreground [overflow-wrap:anywhere]">
                          {source.name}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">
                          {businessPreflightSummary(report, source)}
                        </div>
                        {isWorkbook && typeof source.profile_data.selected_sheet === "string" && <p className="mt-1 truncate text-xs text-muted-foreground">{t("selectedSheet", { sheet: source.profile_data.selected_sheet })}{source.profile_data.has_header === false ? ` · ${t("noHeader")}` : typeof source.profile_data.header_row === "number" ? ` · ${t("selectedHeader", { row: source.profile_data.header_row })}` : ""}</p>}
                      </div>
                      <SourceStatus source={source} report={report} className="shrink-0" />
                    </div>

                    {source.kind === "file" && (source.status !== "attached" || isWorkbook || isCsv) && (
                      <div className="mt-3 flex flex-wrap gap-4 border-t border-border pt-3">
                        {recipe?.status === "applied" && ["ready", "needs_confirmation"].includes(source.status) && sourceIsCurrent(source) && !isPendingReplacement && <Button variant="ghost" size="sm" type="button" disabled={!!sourceAction || !currentProjectId || !settingsLoaded || !preprocessingEnabled} onClick={() => { if (currentProjectId) setReplacementTarget({ projectId: currentProjectId, sourceId: source.id }); }} className="inline-flex items-center gap-1.5 text-xs text-primary h-auto min-h-7 whitespace-normal"><RefreshCw size={13} />{t("sourceUpdateFile")}</Button>}
                        {(isWorkbook || isCsv) && <Button variant="ghost" size="sm" type="button" disabled={busy || !currentProjectId} onClick={() => {
                          if (currentProjectId) setWorkbookTarget({ projectId: currentProjectId, sourceId: source.id });
                        }} className="inline-flex items-center gap-1.5 text-xs text-primary h-auto min-h-7 whitespace-normal"><FileSpreadsheet size={13} />{t(isCsv ? "sourceCsvOptions" : "sourceSheets")}</Button>}
                        {source.status !== "attached" && <Button variant="ghost" size="sm"
                          type="button"
                          onClick={() => openCleaning(source)}
                          className="inline-flex items-center gap-1.5 text-xs text-primary h-auto min-h-7 whitespace-normal"
                        >
                          <FileSpreadsheet size={13} />
                          {t("sourceCleanButton")}
                        </Button>}
                      </div>
                    )}

                    {source.status === "attached" && (
                      <div className="mt-3 border-t border-border pt-3">
                        <Button variant="ghost" size="sm"
                          type="button"
                          disabled={busy || !settingsLoaded || !preprocessingEnabled}
                          onClick={() => {
                            if ((isWorkbook || isCsv) && currentProjectId) setWorkbookTarget({ projectId: currentProjectId, sourceId: source.id });
                            else void performSourceAction(
                              source.id,
                              () => profileSource(source.id),
                              t("sourcePrepared")
                            );
                          }}
                          className="inline-flex items-center gap-1.5 text-xs text-primary h-auto min-h-7 whitespace-normal"
                        >
                          {busy && sourceAction?.kind === "profile" ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Database size={13} />
                          )}
                          {!settingsLoaded
                            ? t("preprocessingLoading")
                            : t("sourcePrepareButton")}
                        </Button>
                        {settingsLoaded && !preprocessingEnabled && (
                          <div className="mt-2 border-l-2 border-warning/50 bg-warning/[0.06] px-3 py-2 text-xs leading-5 text-muted-foreground">
                            <p>{t("preprocessingDisabled")}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {needsAction && (
                      <div className="mt-3 border-t border-border pt-3">
                        {isPendingReplacement && (
                          <div className="mb-3 border border-warning/30 bg-warning/[0.06] px-3 py-3 text-xs leading-5 text-warning rounded-xl">
                            <p>
                              {t("sourceNotInUse")}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Button variant="primary" size="sm"
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void performSourceAction(
                                    source.id,
                                    () => acceptReplacement(source.id),
                                    t("sourceAcceptConfirm")
                                  )
                                }
                                className="inline-flex items-center gap-1.5 px-3 py-2 h-auto min-h-7 whitespace-normal"
                              >
                                {busy && sourceAction?.kind === "accept_replacement" ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <Check size={13} />
                                )}
                                {t("sourceAcceptButton")}
                              </Button>
                              <Button variant="outline" size="sm"
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void performSourceAction(
                                    source.id,
                                    () => keepTrustedSource(source.id),
                                    t("sourceRejectConfirm")
                                  )
                                }
                                className="inline-flex items-center gap-1.5 border border-warning/40 bg-background px-3 py-2 text-foreground hover:border-primary hover:text-primary h-auto min-h-7 whitespace-normal"
                              >
                                {busy && sourceAction?.kind === "keep_trusted" ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <RotateCcw size={13} />
                                )}
                                {t("sourceRejectButton")}
                              </Button>
                            </div>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-x-3 gap-y-2 text-xs">
                          <Button variant="ghost" size="sm"
                            type="button"
                            aria-expanded={detailsOpen}
                            onClick={() =>
                              setExpandedSourceId(detailsOpen ? null : source.id)
                            }
                            className="inline-flex items-center gap-1 text-foreground hover:text-primary h-auto min-h-7 whitespace-normal"
                          >
                            <ChevronDown
                              size={13}
                              className={cn("transition-transform", detailsOpen && "rotate-180")}
                            />
                            {t("sourceReviewChanges")}
                          </Button>
                          <Button variant="ghost" size="sm"
                            type="button"
                            disabled={!!sourceAction || !settingsLoaded || !preprocessingEnabled || source.status === "superseded"}
                            title={t("sourceReviewOnly")}
                            onClick={() => reviewRecipe(source.id)}
                            className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary h-auto min-h-7 whitespace-normal"
                          >
                            {busy && sourceAction?.kind === "reorganize" ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <RefreshCw size={12} />
                            )}
                            {t("sourceRetryButton")}
                          </Button>
                          <Button variant="ghost" size="sm"
                            type="button"
                            disabled={busy}
                            onClick={() => setRemovingSourceId(source.id)}
                            className="inline-flex items-center gap-1 text-muted-foreground hover:text-destructive h-auto min-h-7 whitespace-normal"
                          >
                            <Trash2 size={12} />
                            {t("sourceRemoveButton")}
                          </Button>
                        </div>

                        {removing && (
                          <div className="mt-3 border border-destructive/30 bg-destructive/[0.06] px-3 py-3 text-xs leading-5 text-destructive rounded-xl">
                            <p>
                              {t("sourceRemoveHint")}
                            </p>
                            <div className="mt-2 flex gap-3">
                              <Button variant="ghost" size="sm"
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void performSourceAction(
                                    source.id,
                                    async () => {
                                      await removeSource(source.id);
                                      setRemovingSourceId(null);
                                    },
                                    t("sourceRemoved")
                                  )
                                }
                                className="inline-flex items-center gap-1 text-destructive h-auto min-h-7 whitespace-normal"
                              >
                                {busy && sourceAction?.kind === "remove" && (
                                  <Loader2 size={12} className="animate-spin" />
                                )}
                                {t("sourceRemoveConfirm")}
                              </Button>
                              <Button variant="ghost" size="sm"
                                type="button"
                                disabled={busy}
                                onClick={() => setRemovingSourceId(null)}
                                className="text-muted-foreground hover:text-foreground h-auto min-h-7 whitespace-normal"
                              >
                                {t("sourceRemoveCancel")}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {sourceFeedback?.sourceId === source.id && (
                      <div
                        role={sourceFeedback.tone === "error" ? "alert" : "status"}
                        className={cn(
                          "mt-3 border px-3 py-2 text-xs leading-5",
                          sourceFeedback.tone === "success"
                            ? "border-success/30 bg-success/[0.06] text-success"
                            : "border-destructive/30 bg-destructive/[0.06] text-destructive"
                        )}
                      >
                        {sourceFeedback.message}
                      </div>
                    )}

                    {displayedIssues.length && (!needsAction || detailsOpen) ? (
                      <div className="mt-3 border-t border-border pt-2">
                        {needsAction && (
                          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            {source.status === "error" ? t("sourceDriftTitleError") : t("sourceDriftTitleChanges")}
                          </div>
                        )}
                        {displayedIssues
                          .slice(0, needsAction ? 8 : detailsOpen ? displayedIssues.length : 3)
                          .map((issue, issueIndex) => (
                          <div
                            key={`${issue.code}-${issue.title}-${issueIndex}`}
                            className={cn(
                              "flex items-start gap-2 py-1 text-xs",
                              issue.automatic ? "text-muted-foreground" : "text-warning"
                            )}
                          >
                            {issue.automatic ? (
                              <CheckCircle2
                                size={13}
                                className="mt-0.5 shrink-0 text-success"
                              />
                            ) : (
                              <AlertCircle
                                size={13}
                                className="mt-0.5 shrink-0 text-warning"
                              />
                            )}
                            {businessIssueTitle(issue)}
                          </div>
                          ))}
                        {!needsAction && displayedIssues.length > 3 && (
                          <Button variant="ghost" size="sm"
                            type="button"
                            aria-expanded={detailsOpen}
                            onClick={() => setExpandedSourceId(detailsOpen ? null : source.id)}
                            className="mt-1 text-xs text-muted-foreground hover:text-foreground h-auto min-h-7 whitespace-normal"
                          >
                            {detailsOpen
                              ? t("sourceCollapseIssues")
                              : t("sourceShowAllIssues", { count: displayedIssues.length })}
                          </Button>
                        )}
                        {drift && detailsOpen && (
                          <div className="mt-2 border-l-2 border-primary/40 bg-muted/40 px-2.5 py-2 text-xs leading-5 text-muted-foreground">
                            {businessColumnSummary(drift.added_columns) ? (
                              <div>{t("sourceDriftAdded")}{businessColumnSummary(drift.added_columns)}</div>
                            ) : null}
                            {businessColumnSummary(drift.removed_columns) ? (
                              <div>{t("sourceDriftMissing")}{businessColumnSummary(drift.removed_columns)}</div>
                            ) : null}
                            {drift.type_changes?.length ? (
                              <div>
                                {t("sourceDriftRenamed")}
                                {businessColumnSummary(
                                  drift.type_changes.map((item) => item.column).filter(Boolean)
                                ) || t("sourceDriftChangesCount", { count: drift.type_changes.length })}
                              </div>
                            ) : null}
                          </div>
                        )}
                        {report?.ambiguities?.length ? (
                          <div className="mt-2 flex items-start gap-2 border-l-2 border-warning/50 bg-warning/[0.06] px-2.5 py-2 text-xs leading-5 text-warning">
                            <AlertCircle size={13} className="mt-0.5 shrink-0 text-warning" />
                            <span>
                              {t("sourceAmbiguitiesHint", {
                                count: report?.ambiguities.length ?? 0,
                              })}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {recipe && (
                      <div className="mt-3 border-t border-border pt-3">
                        <div className="flex items-center justify-between gap-3">
                          <Button variant="ghost" size="sm"
                            type="button"
                            aria-expanded={recipeHistoryOpen}
                            onClick={() => toggleRecipeHistory(recipe.id)}
                            className="inline-flex items-center gap-1.5 text-xs text-foreground hover:text-primary h-auto min-h-7 whitespace-normal"
                          >
                            <History size={12} />
                            {t("recipeHistoryTitle")}
                            {recipeRevisions.length ? ` ${recipeRevisions.length}` : ""}
                            <ChevronDown
                              size={12}
                              className={cn(
                                "transition-transform",
                                recipeHistoryOpen && "rotate-180"
                              )}
                            />
                          </Button>
                          <Button variant="ghost" size="sm"
                            type="button"
                            disabled={!!sourceAction || !settingsLoaded || !preprocessingEnabled || source.status === "superseded"}
                            onClick={() => reviewRecipe(source.id)}
                            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary h-auto min-h-7 whitespace-normal"
                          >
                            {busy && sourceAction?.kind === "reorganize" ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <RefreshCw size={12} />
                            )}
                            {t("recipeReapplyButton")}
                          </Button>
                        </div>

                        {recipeHistoryOpen && (
                          <div className="mt-3">
                            {recipeRevisionLoadingByRecipe[recipe.id] && (
                              <div
                                role="status"
                                className="flex items-center gap-2 py-2 text-xs text-muted-foreground"
                              >
                                <Loader2 size={13} className="animate-spin" />
                                {t("recipeHistoryLoading")}
                              </div>
                            )}
                            {!recipeRevisionLoadingByRecipe[recipe.id] &&
                              recipeRevisionErrorByRecipe[recipe.id] && (
                                <div
                                  role="alert"
                                  className="border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-xs leading-5 text-destructive rounded-xl"
                                >
                                  <p>{recipeRevisionErrorByRecipe[recipe.id]}</p>
                                  <Button variant="ghost" size="sm"
                                    type="button"
                                    onClick={() =>
                                      void loadRecipeRevisions(recipe.id).catch(
                                        () => undefined
                                      )
                                    }
                                    className="mt-1 h-auto min-h-7 whitespace-normal"
                                  >
                                    {t("recipeHistoryRetry")}
                                  </Button>
                                </div>
                              )}
                            {!recipeRevisionLoadingByRecipe[recipe.id] &&
                              !recipeRevisionErrorByRecipe[recipe.id] &&
                              recipeRevisions.length > 0 && (
                                <ol className="ml-1 space-y-3 border-l border-border pl-4">
                                  {recipeRevisions.map((revision) => {
                                    const current =
                                      revision.id === recipe.active_revision_id;
                                    const restoring =
                                      recipeRevisionRestoringByRecipe[recipe.id];
                                    const formattedTime = revisionTime(
                                      revision.created_at
                                    );
                                    const summary =
                                      revision.reason ||
                                      (revision.state === "candidate"
                                        ? t("recipeStatusPending")
                                        : revision.state === "reverted"
                                          ? t("recipeStatusReverted")
                                          : t("recipeStatusVerified"));
                                    return (
                                      <li key={revision.id} className="relative">
                                        <span
                                          aria-hidden="true"
                                          className={cn(
                                            "absolute -left-[21px] top-1.5 h-2 w-2 rounded-full border-2 border-background",
                                            current ? "bg-success" : "bg-muted-foreground/30"
                                          )}
                                        />
                                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                          <time dateTime={revision.created_at}>
                                            {formattedTime}
                                          </time>
                                          {current && (
                                            <span className="bg-success/[0.06] px-1.5 py-0.5 text-success">
                                              {recipe.status === "reverted"
                                                ? t("recipeBadgePending")
                                                : t("recipeBadgeCurrent")}
                                            </span>
                                          )}
                                        </div>
                                        <p className="mt-1 text-xs leading-5 text-foreground">
                                          {summary}
                                        </p>
                                        {!current && (
                                          <Button variant="ghost" size="sm"
                                            type="button"
                                            disabled={Boolean(restoring) || !!sourceAction || !settingsLoaded || !preprocessingEnabled || source.status === "superseded"}
                                            aria-label={t("restoreRecipeAria", {
                                              time: formattedTime,
                                            })}
                                            onClick={() => reviewRecipe(source.id, revision.id)}
                                            className="mt-1 text-[11px] text-primary h-auto min-h-7 whitespace-normal"
                                          >
                                            {t("recipeRestoreButton")}
                                          </Button>
                                        )}
                                      </li>
                                    );
                                  })}
                                </ol>
                              )}
                            {recipeHistoryFeedback?.recipeId === recipe.id && (
                              <div
                                role="status"
                                className="mt-3 border border-success/30 bg-success/[0.06] px-3 py-2 text-xs leading-5 text-success rounded-xl"
                              >
                                {recipeHistoryFeedback.message}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    <SourceDataPreview source={source} report={report} onCleanColumn={(column) => openCleaning(source, column)} />
                  </div>
                );
              }}
          </SourceDirectory>

          {connections?.some((item) => !attachedConnections.has(item.id)) && (
            <section>
              <h3 className="mb-3 text-sm font-semibold text-foreground">{t("connectExistingDb")}</h3>
              <div className="space-y-2">
                {connections
                  .filter((connection) => !attachedConnections.has(connection.id))
                  .map((connection) => (
                    <Button variant="outline" size="sm"
                      key={connection.id}
                      disabled={isUploading}
                      onClick={() => void attachConnection(connection.id, connection.name)}
                      className="flex w-full items-center gap-3 border border-border bg-background px-3 py-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 h-auto min-h-7 whitespace-normal"
                    >
                      <Database size={17} className="text-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">
                          {connection.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {connection.driver.toUpperCase()}
                        </div>
                      </div>
                      <Plus size={16} className="text-muted-foreground" />
                    </Button>
                  ))}
              </div>
            </section>
          )}

          {!connections?.length && (
            <section className="border border-border bg-background px-4 py-4 rounded-xl">
              <h3 className="text-sm font-semibold text-foreground">{t("connectDbPrompt")}</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {t("connectDbHint")}
              </p>
              <Button variant="primary" size="sm"
                type="button"
                onClick={onConfigureConnection}
                className="mt-3 inline-flex items-center gap-2 px-3 py-2 text-xs h-auto min-h-7 whitespace-normal"
              >
                <Plus size={14} />
                {t("connectDbButton")}
              </Button>
            </section>
          )}
            </>
          ) : (
            <div className="space-y-5">
              <section className="border-y border-border py-4">
                <div className="flex items-start gap-3">
                  <BookOpenText size={18} className="mt-0.5 shrink-0 text-primary" />
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      {t("understandingTitle")}
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {t("understandingDesc")}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 divide-x divide-border border-y border-border py-3 text-center">
                  <div>
                    <div className="text-lg font-semibold text-foreground">
                      {knowledgeTotal}
                    </div>
                    <div className="text-[10px] text-muted-foreground">{t("understandingFilterAll")}</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-foreground">
                      {pendingKnowledgeCount}
                    </div>
                    <div className="text-[10px] text-muted-foreground">{t("understandingFilterPending")}</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-foreground">
                      {relationshipKnowledgeCount}
                    </div>
                    <div className="text-[10px] text-muted-foreground">{t("understandingFilterRelations")}</div>
                  </div>
                </div>
                {currentProjectId && (
                  <Link
                    href={`/projects/${currentProjectId}/understanding`}
                    className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-primary hover:underline"
                  >
                    {t("understandingViewAll")}
                    <ArrowRight size={13} />
                  </Link>
                )}
              </section>

              <section>
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-foreground">{t("relationsTitle")}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("relationsDesc")}
                  </p>
                </div>
                <UnderstandingMap
                  sources={sources}
                  reports={preflightReports}
                  knowledgeCount={knowledgeTotal}
                  relationshipCount={relationshipKnowledgeCount}
                />
              </section>

              <section className="space-y-3" aria-label={t("understandingPreviewAria")}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">{t("recentTitle")}</h3>
                  <span className="text-[11px] text-muted-foreground">{t("recentHint")}</span>
                </div>

                {displayedKnowledge.map((entry) => (
                  <article
                    key={entry.id}
                    className="border-b border-border px-1 py-3 last:border-b-0"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground">
                        {knowledgeKindLabel(entry.entry_type)}
                      </div>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {entry.validity === "stale"
                          ? t("ruleStatusIgnored")
                          : entry.state === "locked"
                            ? t("ruleStatusLocked")
                            : entry.state === "confirmed"
                              ? t("ruleStatusMemorized")
                              : t("ruleStatusPending")}
                      </span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-foreground">
                      {knowledgeDisplayValue(entry)}
                    </p>
                  </article>
                ))}

                {!displayedKnowledge.length && (
                  <div className="border-y border-border px-4 py-6 text-center">
                    <BookOpenText size={20} className="mx-auto text-primary" />
                    <div className="mt-2 text-sm font-medium text-foreground">
                      {t("noUnderstanding")}
                    </div>
                  </div>
                )}

                {currentProjectId && (
                  <Link
                    href={`/projects/${currentProjectId}/understanding`}
                    className="inline-flex w-full items-center justify-center gap-2 bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
                  >
                    {t("manageUnderstanding")}
                    <ArrowRight size={14} />
                  </Link>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </aside>
    {workbookSource && workbookTarget && <PreparationNavigator key={`${workbookTarget.projectId}:${workbookTarget.sourceId}`}
      projectId={workbookTarget.projectId} sourceId={workbookSource.id} name={workbookSource.name}
      initialOptions={{ ...(workbookSource.profile_data.csv_options as object || {}), header_row: workbookSource.profile_data.header_row, has_header: workbookSource.profile_data.has_header, input_fingerprint: workbookSource.fingerprint }}
      canPrepare={settingsLoaded && preprocessingEnabled && workbookSource.status !== "superseded" && !sourceAction}
      onPrepare={async (selection: WorkbookSelection | CsvSelection) => {
        if (useProjectStore.getState().currentProjectId !== workbookTarget.projectId) throw new Error("Project changed");
        await profileSource(workbookSource.id, selection);
      }}
      onRefreshSource={async () => {
        if (useProjectStore.getState().currentProjectId !== workbookTarget.projectId) throw new Error("Project changed");
        await useProjectStore.getState().refreshCurrent({ throwOnError: true });
      }} onClose={() => setWorkbookTarget(null)} />}
    {cleaningSource?.kind === "file" && (
      <VisualCleaningEditor
        key={`${cleaningSource.project_id}:${cleaningSource.id}`}
        source={cleaningSource}
        columns={cleaningColumns}
        initialColumn={cleaningTarget?.column}
        recipeOperations={cleaningRecipe?.operations || []}
        onClose={() => setCleaningTarget(null)}
      />
    )}
    </>
  );
}
