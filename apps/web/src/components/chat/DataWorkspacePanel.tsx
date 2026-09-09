"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { TabList } from "@/components/ui/TabList";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
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
  PreflightIssue,
  PreflightReport,
  ProjectDataSource,
  SemanticEntry,
} from "@/lib/types/api";
import { useProjectStore } from "@/lib/stores/project";
import { cn } from "@/lib/utils";
import { VisualCleaningEditor } from "./VisualCleaningEditor";

interface DataWorkspacePanelProps {
  embedded?: boolean;
  open: boolean;
  onClose: () => void;
  onConfigureConnection: () => void;
  preprocessingEnabled?: boolean;
  settingsLoaded?: boolean;
  onOpenPreprocessingSettings?: () => void;
  connections?: ConnectionSummary[];
  view?: "sources" | "understanding";
  onViewChange?: (view: "sources" | "understanding") => void;
}

function inferredColumnNames(schema: Record<string, unknown> | undefined): string[] {
  const columns = schema?.columns;
  if (!Array.isArray(columns)) return [];
  return columns
    .map((column) =>
      column && typeof column === "object" && "name" in column
        ? String(column.name || "").trim()
        : ""
    )
    .filter(Boolean);
}

const FIELD_WORD_KEYS = [
  "unit",
  "price",
  "cost",
  "total",
  "amount",
  "revenue",
  "sales",
  "order",
  "id",
  "date",
  "time",
  "store",
  "shop",
  "channel",
  "category",
  "product",
  "quantity",
  "qty",
  "discount",
  "refund",
  "profit",
];

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

export function DataWorkspacePanel({
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
  const tabsId = useId();
  const locale = useLocale();
  const t = useTranslations("dataWorkspace");
  const fieldWordsRaw = t("fieldWords").split(",").map((s) => s.trim());
  const FIELD_WORDS: Record<string, string> = Object.fromEntries(
    FIELD_WORD_KEYS.map((key, i) => [key, fieldWordsRaw[i] || key]),
  );

  const sourceStatus = (status: string) => {
    if (status === "ready") return { label: t("statusReady"), tone: "text-success bg-success/[0.06]" };
    if (status === "needs_confirmation") {
      return { label: t("statusNeedsReview"), tone: "text-warning bg-warning/[0.06]" };
    }
    if (status === "error") return { label: t("statusNeedsAttention"), tone: "text-destructive bg-destructive/[0.06]" };
    if (status === "attached") return { label: t("statusAwaitingPreparation"), tone: "text-muted-foreground bg-muted" };
    return { label: t("statusSanitizing"), tone: "text-muted-foreground bg-muted" };
  };

  const businessFieldLabel = (value: string): string | null => {
    const normalized = value.trim().replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
    const parts = normalized.split(/[_\s.-]+/).filter(Boolean);
    if (!parts.length || !parts.every((part) => FIELD_WORDS[part])) return null;
    return parts.map((part) => FIELD_WORDS[part]).join("");
  };

  const businessIssueTitle = (issue: PreflightIssue): string => {
    const fieldMatch = issue.title.match(/^([^“”]+?)\s*中有\s*(\d+)\s*个(.+)$/);
    const duplicateKeyMatch = issue.title.match(/^(.+?)\s+有\s+(\d+)\s+条重复出现$/);
    const rawField = fieldMatch?.[1] || duplicateKeyMatch?.[1];
    const field = rawField
      ? businessFieldLabel(rawField) || rawField.trim().slice(0, 80)
      : null;
    const countValue =
      typeof issue.count === "number" && Number.isFinite(issue.count)
        ? issue.count
        : Number(fieldMatch?.[2] || duplicateKeyMatch?.[2] || 0);
    const count = Math.max(0, countValue).toLocaleString(locale);

    switch (issue.code) {
      case "possible_outliers":
        return field
          ? t("issueOutliersField", { field, count })
          : t("issueOutliers", { count });
      case "invalid_currency_values":
        return field
          ? t("issueAmountsField", { field, count })
          : t("issueAmounts", { count });
      case "invalid_date_values":
        return field
          ? t("issueDatesField", { field, count })
          : t("issueDates", { count });
      case "duplicate_business_keys":
        return field
          ? t("issueDuplicates", { label: field, count })
          : t("issueDuplicateKeys", { count });
      case "header_offset":
        return t("issueHeaderOffset", {
          row: (Math.max(0, countValue) + 1).toLocaleString(locale),
        });
      case "empty_regions":
        return t("issueEmptyRegions");
      case "summary_rows":
        return t("issueSummaryRows", { count });
      case "duplicate_rows":
      case "drop_exact_duplicates":
        return t("issueDuplicateRows", { count });
      case "missing_values":
        return t("issueMissingValues", { count });
      case "recipe_replay_drift":
      case "recipe_input_changed":
        return t("issueRecipeChanged", { count });
      case "recipe_replayed":
        return t("issueRecipeReplayed", { count });
      case "imported_recipe_candidate":
        return t("issueImportedRecipe");
      case "schema_drift":
      case "replacement_pending":
        return t("issueSchemaChanged");
      case "replacement_accepted":
        return t("issueReplacementAccepted");
      case "sanitation_reverted":
        return t("issueSanitationReverted");
      case "confirmed_knowledge_reused":
        return t("issueKnowledgeReused");
      case "database_table_budget_reached":
      case "database_catalog_column_budget_reached":
      case "database_table_column_budget_reached":
      case "database_column_budget_reached":
        return t("issueDatabaseScopeLimited");
      case "database_sample_byte_budget_reached":
      case "database_preflight_time_budget_reached":
      case "database_preflight_byte_budget_reached":
        return t("issueDatabaseSampleLimited");
      case "database_tables_partially_unavailable":
      case "no_profileable_columns":
        return t("issueDatabasePartial");
      case "database_catalog_unavailable":
      case "database_preflight_failed":
      case "preflight_failed":
        return t("issuePreparationFailed");
      default:
        if (issue.severity === "critical") return t("issueUnknownFailed");
        return issue.automatic
          ? t("issueUnknownPrepared")
          : t("issueUnknownReview");
    }
  };

  const businessPreflightSummary = (
    report: PreflightReport | undefined,
    source: ProjectDataSource,
  ): string => {
    const asRecord = (value: unknown): Record<string, unknown> =>
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const asCount = (value: unknown): number | null =>
      typeof value === "number" && Number.isFinite(value) && value >= 0
        ? value
        : null;
    const format = (value: number) => value.toLocaleString(locale);
    const snapshot = asRecord(report?.source_snapshot);
    const sourcePreanalysis = asRecord(source.profile_data.preanalysis);
    const preanalysis = asRecord(snapshot.preanalysis);
    const effectivePreanalysis = Object.keys(preanalysis).length
      ? preanalysis
      : sourcePreanalysis;
    const summaryCode = String(
      snapshot.summary_code ?? effectivePreanalysis.summary_code ?? "",
    );
    const summaryFacts = asRecord(
      snapshot.summary_facts ?? effectivePreanalysis.summary_facts,
    );
    const shape = asRecord(effectivePreanalysis.shape);
    const legacySummary = String(
      report?.summary ?? source.profile_data.summary ?? "",
    ).trim();
    const legacySummaryMatchesLocale =
      !summaryCode &&
      legacySummary.length > 0 &&
      (locale.startsWith("zh")
        ? /[\u3400-\u9fff]/u.test(legacySummary)
        : !/[\u3400-\u9fff]/u.test(legacySummary));

    if (source.kind === "connection") {
      const tables = asCount(summaryFacts.profiled_tables ?? shape.profiled_tables);
      const columns = asCount(summaryFacts.profiled_columns ?? shape.columns);
      const relationIndex = asRecord(
        source.profile_data.relation_index ?? sourcePreanalysis.relation_index,
      );
      const indexedRelations = Array.isArray(relationIndex.relations)
        ? relationIndex.relations
        : [];
      const catalogTables =
        asCount(relationIndex.relations_total) ??
        asCount(relationIndex.relations_total_at_least) ??
        asCount(relationIndex.relations_loaded) ??
        (indexedRelations.length ? indexedRelations.length : null);
      const catalogComplete =
        relationIndex.complete !== false && relationIndex.truncated !== true;
      const profileStatus = String(
        summaryFacts.status ??
          snapshot.profile_status ??
          source.profile_data.profile_status ??
          report?.status ??
          source.status,
      );
      if (profileStatus === "error" || source.status === "error") {
        return t("preflightDatabaseFailed");
      }
      if (
        catalogTables !== null &&
        tables !== null &&
        catalogTables !== tables
      ) {
        return t(
          catalogComplete
            ? "preflightDatabaseCatalogReady"
            : "preflightDatabaseCatalogPartial",
          {
            tables: format(catalogTables),
            checked: format(tables),
          },
        );
      }
      if (tables !== null && columns !== null) {
        const parts = [
          t("preflightDatabaseReady", {
            tables: format(tables),
            columns: format(columns),
          }),
        ];
        if (summaryFacts.partial === true || profileStatus === "partial") {
          parts.push(t("preflightDatabasePartial"));
        }
        return parts.join(" · ");
      }
      if (legacySummaryMatchesLocale) return legacySummary;
      return t("preflightDatabasePrepared");
    }

    if (source.status === "error" || report?.status === "error") {
      return t("preflightFileFailed");
    }
    const rows = asCount(summaryFacts.rows ?? snapshot.ready_rows ?? shape.rows);
    const columns = asCount(
      summaryFacts.columns ?? snapshot.ready_columns ?? shape.columns,
    );
    if (rows === null || columns === null) {
      if (legacySummaryMatchesLocale) return legacySummary;
      return source.status === "attached"
        ? t("sourceAwaitingPreparation")
        : t("preflightFilePrepared");
    }
    const parts = [
      t("preflightFileReady", {
        rows: format(rows),
        columns: format(columns),
      }),
    ];
    const automaticCount =
      asCount(summaryFacts.automatic_issue_count) ??
      report?.issues.filter((issue) => issue.automatic).length ??
      0;
    const ambiguityCount =
      asCount(summaryFacts.ambiguity_count) ?? report?.ambiguities.length ?? 0;
    if (automaticCount > 0) {
      parts.push(t("preflightAutomaticHandled", { count: format(automaticCount) }));
    }
    if (ambiguityCount > 0) {
      parts.push(t("preflightDefinitionsPending", { count: format(ambiguityCount) }));
    }
    const recipeSteps = asCount(summaryFacts.recipe_step_count) ?? 0;
    const recipeDrift = asCount(summaryFacts.recipe_drift_count) ?? 0;
    if (recipeDrift > 0) {
      parts.push(t("preflightRecipeChanged"));
    } else if (recipeSteps > 0) {
      parts.push(t("preflightRecipeChecked"));
    }
    return parts.join(" · ");
  };

  const dedupeBusinessIssues = (issues: PreflightIssue[]): PreflightIssue[] => {
    const unique = new Map<string, PreflightIssue>();
    for (const issue of issues) {
      const label = businessIssueTitle(issue);
      const previous = unique.get(label);
      if (!previous || (previous.automatic && !issue.automatic)) {
        unique.set(label, issue);
      }
    }
    return Array.from(unique.values());
  };

  const businessColumnSummary = (values: unknown): string | null => {
    if (!Array.isArray(values) || !values.length) return null;
    const known = Array.from(
      new Set(
        values
          .map((value) => businessFieldLabel(String(value)))
          .filter((value): value is string => Boolean(value))
      )
    );
    const hiddenCount = values.length - known.length;
    const knownLabel = new Intl.ListFormat(locale, {
      style: "short",
      type: "conjunction",
    }).format(known);
    return hiddenCount > 0
      ? t("columnSummaryWithHidden", {
          known: knownLabel,
          hidden: t("hiddenItems", { count: hiddenCount }),
        })
      : knownLabel;
  };

  const knowledgeKindLabel = (kind: SemanticEntry["entry_type"]): string => {
    if (kind === "metric") return t("knowledgeMetric");
    if (kind === "dimension") return t("knowledgeGranularity");
    if (kind === "relationship") return t("knowledgeRelation");
    if (kind === "cleaning_rule") return t("knowledgeMethod");
    if (kind === "verified_query") return t("knowledgeVerified");
    return t("knowledgeDefinition");
  };

  const knowledgeDisplayValue = (entry: SemanticEntry): string => {
    if (entry.entry_type === "relationship" && entry.state === "candidate") {
      return t("relationPreviewHint");
    }
    return entry.value.replace(/\b[a-zA-Z][a-zA-Z0-9_.-]*\b/g, (token) => {
      const lastPart = token.split(".").at(-1) || token;
      const businessLabel = businessFieldLabel(lastPart);
      if (businessLabel) return businessLabel;
      return token.includes("_") || token.includes(".") || /[a-z][A-Z]/.test(token)
        ? t("relatedFields")
        : token;
    });
  };

  const revisionTime = (value: string): string => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t("timeUnconfirmed");
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  };

  const UnderstandingMap = ({
    sources,
    knowledgeCount,
    relationshipCount,
  }: {
    sources: ProjectDataSource[];
    knowledgeCount: number;
    relationshipCount: number;
  }) => {
    if (!sources.length) {
      return (
        <button
          type="button"
          className="flex min-h-40 w-full items-center justify-center border border-dashed border-border bg-background/70 px-6 text-center text-xs leading-5 text-muted-foreground"
        >
          {t("emptyUnderstandingHint")}
        </button>
      );
    }

    return (
      <div
        className="border border-border bg-background/70 p-3"
        aria-label={t("understandingMapAria")}
      >
        <div className="grid grid-cols-2 gap-2">
          {sources.map((source) => (
            <div
              key={source.id}
              data-source-overview-node={source.id}
              className="min-w-0 border border-primary/20 bg-card px-3.5 py-3"
            >
              <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground">
                {source.kind === "connection" ? (
                  <Database size={13} />
                ) : (
                  <FileSpreadsheet size={13} />
                )}
                {t("dataSourcesTab")}
              </div>
              <div className="mt-2 truncate text-sm font-semibold text-foreground">
                {source.name}
              </div>
              <div className="mt-1 text-[11px] text-success">{t("readyBadge")}</div>
            </div>
          ))}
        </div>

        <div
          data-understanding-summary
          className="mt-3 flex flex-wrap items-center justify-between gap-3 border border-success/30 bg-success/[0.05] px-4 py-3"
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
  };

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localView, setLocalView] = useState<"sources" | "understanding">("sources");
  const activeView = view || localView;
  const changeView = (nextView: "sources" | "understanding") => {
    if (view === undefined) setLocalView(nextView);
    onViewChange?.(nextView);
  };
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);
  const [expandedRecipeHistoryIds, setExpandedRecipeHistoryIds] = useState<string[]>([]);
  const [pendingRecipeRestore, setPendingRecipeRestore] = useState<{
    recipeId: string;
    revisionId: string;
  } | null>(null);
  const [recipeHistoryFeedback, setRecipeHistoryFeedback] = useState<{
    recipeId: string;
    message: string;
  } | null>(null);
  const [removingSourceId, setRemovingSourceId] = useState<string | null>(null);
  const [cleaningSourceId, setCleaningSourceId] = useState<string | null>(null);
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
    uploadFile,
    attachConnection,
    profileSource,
    loadRecipeRevisions,
    restoreRecipeRevision,
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

  const acceptFile = (file?: File) => {
    if (file) void uploadFile(file);
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
      if (pendingRecipeRestore?.recipeId === recipeId) setPendingRecipeRestore(null);
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

  const performRecipeRestore = async (recipeId: string, revisionId: string) => {
    setRecipeHistoryFeedback(null);
    try {
      await restoreRecipeRevision(recipeId, revisionId);
      setPendingRecipeRestore(null);
      setRecipeHistoryFeedback({
        recipeId,
        message: t("sanitationRestored"),
      });
    } catch {
      setPendingRecipeRestore(null);
    }
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
  const cleaningSource = sources.find((source) => source.id === cleaningSourceId);
  const cleaningRecipe = recipes.find(
    (recipe) => recipe.data_source_id === cleaningSourceId,
  );
  const cleaningReport = preflightReports.find(
    (report) => report.data_source_id === cleaningSourceId,
  );
  const cleaningColumns = Array.from(
    new Set(
      [
        ...(cleaningSource?.profile_data.sample || []).flatMap((row) =>
          Object.keys(row),
        ),
        ...inferredColumnNames(cleaningReport?.inferred_schema),
      ],
    ),
  );

  return (
    <>
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
            accept=".csv,.xls,.xlsx,.parquet,.json"
            className="hidden"
            onChange={(event) => acceptFile(event.target.files?.[0])}
          />
          <button
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
              acceptFile(event.dataTransfer.files?.[0]);
            }}
            className={cn(
              "flex w-full flex-col items-center border border-dashed px-5 py-7 text-center transition-colors",
              dragging
                ? "border-primary bg-primary/5"
                : "border-border bg-muted/30 hover:border-primary/60 hover:bg-primary/5"
            )}
          >
            {isUploading ? (
              <Loader2 className="animate-spin text-primary" size={24} />
            ) : (
              <UploadCloud className="text-primary" size={24} />
            )}
            <span className="mt-3 text-sm font-semibold text-foreground">
              {t("uploadHint", { state: isUploading ? t("uploadBusy") : t("uploadIdle") })}
            </span>
            <span className="mt-1 text-xs text-muted-foreground">
              {t("uploadFormats")}
            </span>
          </button>

          {error && (
            <div className="flex gap-2 border border-destructive/30 bg-destructive/[0.06] px-3 py-3 text-xs leading-5 text-destructive">
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
                      className="border border-border bg-background px-3 py-3"
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
                                className="mt-1.5 w-full border border-border bg-card px-2.5 py-2 text-sm text-foreground outline-none focus:border-primary"
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
                            <button
                              type="button"
                              disabled={busy || !selectedSourceId}
                              onClick={() =>
                                void performTemplatePreview(template.id, selectedSourceId)
                              }
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline disabled:opacity-50"
                            >
                              {busy && recipeTemplateAction?.kind === "preview" ? (
                                <Loader2 size={13} className="animate-spin" />
                              ) : (
                                <RefreshCw size={13} />
                              )}
                              {t("recipePreviewButton")}
                            </button>
                          )}

                          {visiblePreview && (
                            <div className="border border-success/30 bg-success/[0.05] px-3 py-3">
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
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void performTemplateBind(template.id)}
                                    className="inline-flex items-center gap-1.5 bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                                  >
                                    {busy && recipeTemplateAction?.kind === "bind" ? (
                                      <Loader2 size={13} className="animate-spin" />
                                    ) : (
                                      <Check size={13} />
                                    )}
{t("recipeApply")}
                                    </button>
                                )}
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void performTemplatePreview(template.id, selectedSourceId)
                                  }
                                  className="text-xs font-semibold text-muted-foreground hover:text-primary disabled:opacity-50"
                                >
                                  {t("recipeRecheck")}
                                </button>
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

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">{t("projectSourcesTitle")}</h3>
              <span className="text-xs text-muted-foreground">{t("projectSourcesCount", { count: sources.length })}</span>
            </div>
            <div className="space-y-2">
              {sources.map((source) => {
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
                const replacement = report?.source_snapshot?.replacement;
                const isPendingReplacement =
                  (source.profile_data.activation_state === "pending_confirmation" &&
                    Boolean(source.profile_data.replacement_of)) ||
                  (replacement?.status === "pending_confirmation" &&
                    Boolean(
                      replacement.replaces_source_id || replacement.active_source_id
                    ));
                const status = isPendingReplacement
                  ? { label: t("sourceStatusWaiting"), tone: "text-warning bg-warning/[0.06]" }
                  : sourceStatus(source.status);
                const needsAction =
                  source.status === "needs_confirmation" || source.status === "error";
                const detailsOpen = expandedSourceId === source.id;
                const removing = removingSourceId === source.id;
                const busy = sourceAction?.sourceId === source.id;
                const drift = report?.source_snapshot?.schema_drift;
                const displayedIssues = report
                  ? dedupeBusinessIssues(report.issues)
                  : [];
                return (
                  <div key={source.id} className="border border-border bg-background px-3 py-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 text-primary">
                        {source.kind === "file" ? (
                          <FileSpreadsheet size={18} />
                        ) : (
                          <Database size={18} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">
                          {source.name}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">
                          {businessPreflightSummary(report, source)}
                        </div>
                      </div>
                      <span className={cn("shrink-0 px-2 py-1 text-[11px]", status.tone)}>
                        {status.label}
                      </span>
                    </div>

                    {source.kind === "file" && source.status !== "attached" && (
                      <div className="mt-3 border-t border-border pt-3">
                        <button
                          type="button"
                          onClick={() => setCleaningSourceId(source.id)}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                        >
                          <FileSpreadsheet size={13} />
                          {t("sourceCleanButton")}
                        </button>
                      </div>
                    )}

                    {source.status === "attached" && (
                      <div className="mt-3 border-t border-border pt-3">
                        <button
                          type="button"
                          disabled={busy || !settingsLoaded || !preprocessingEnabled}
                          onClick={() =>
                            void performSourceAction(
                              source.id,
                              () => profileSource(source.id),
                              t("sourcePrepared")
                            )
                          }
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline disabled:opacity-50"
                        >
                          {busy && sourceAction?.kind === "profile" ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Database size={13} />
                          )}
                          {!settingsLoaded
                            ? t("preprocessingLoading")
                            : t("sourcePrepareButton")}
                        </button>
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
                          <div className="mb-3 border border-warning/30 bg-warning/[0.06] px-3 py-3 text-xs leading-5 text-warning">
                            <p>
                              {t("sourceNotInUse")}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void performSourceAction(
                                    source.id,
                                    () => acceptReplacement(source.id),
                                    t("sourceAcceptConfirm")
                                  )
                                }
                                className="inline-flex items-center gap-1.5 bg-primary px-3 py-2 font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                              >
                                {busy && sourceAction?.kind === "accept_replacement" ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <Check size={13} />
                                )}
                                {t("sourceAcceptButton")}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void performSourceAction(
                                    source.id,
                                    () => keepTrustedSource(source.id),
                                    t("sourceRejectConfirm")
                                  )
                                }
                                className="inline-flex items-center gap-1.5 border border-warning/40 bg-background px-3 py-2 font-semibold text-foreground hover:border-primary hover:text-primary disabled:opacity-50"
                              >
                                {busy && sourceAction?.kind === "keep_trusted" ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <RotateCcw size={13} />
                                )}
                                {t("sourceRejectButton")}
                              </button>
                            </div>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-x-3 gap-y-2 text-xs">
                          <button
                            type="button"
                            aria-expanded={detailsOpen}
                            onClick={() =>
                              setExpandedSourceId(detailsOpen ? null : source.id)
                            }
                            className="inline-flex items-center gap-1 font-semibold text-foreground hover:text-primary"
                          >
                            <ChevronDown
                              size={13}
                              className={cn("transition-transform", detailsOpen && "rotate-180")}
                            />
                            {t("sourceReviewChanges")}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            title={t("sourceReviewOnly")}
                            onClick={() =>
                              void performSourceAction(
                                source.id,
                                () => reorganizeSource(source.id),
                                t("sourceRetryHint")
                              )
                            }
                            className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary disabled:opacity-50"
                          >
                            {busy && sourceAction?.kind === "reorganize" ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <RefreshCw size={12} />
                            )}
                            {t("sourceRetryButton")}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setRemovingSourceId(source.id)}
                            className="inline-flex items-center gap-1 text-muted-foreground hover:text-destructive disabled:opacity-50"
                          >
                            <Trash2 size={12} />
                            {t("sourceRemoveButton")}
                          </button>
                        </div>

                        {removing && (
                          <div className="mt-3 border border-destructive/30 bg-destructive/[0.06] px-3 py-3 text-xs leading-5 text-destructive">
                            <p>
                              {t("sourceRemoveHint")}
                            </p>
                            <div className="mt-2 flex gap-3">
                              <button
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
                                className="inline-flex items-center gap-1 font-semibold text-destructive hover:underline disabled:opacity-50"
                              >
                                {busy && sourceAction?.kind === "remove" && (
                                  <Loader2 size={12} className="animate-spin" />
                                )}
                                {t("sourceRemoveConfirm")}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setRemovingSourceId(null)}
                                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                              >
                                {t("sourceRemoveCancel")}
                              </button>
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
                          .slice(0, needsAction ? 8 : 3)
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
                          <button
                            type="button"
                            aria-expanded={recipeHistoryOpen}
                            onClick={() => toggleRecipeHistory(recipe.id)}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground hover:text-primary"
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
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void performSourceAction(
                                source.id,
                                () => reorganizeSource(source.id),
                                t("recipeReapplied")
                              )
                            }
                            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary disabled:opacity-50"
                          >
                            {busy && sourceAction?.kind === "reorganize" ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <RefreshCw size={12} />
                            )}
                            {t("recipeReapplyButton")}
                          </button>
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
                                  className="border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-xs leading-5 text-destructive"
                                >
                                  <p>{recipeRevisionErrorByRecipe[recipe.id]}</p>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void loadRecipeRevisions(recipe.id).catch(
                                        () => undefined
                                      )
                                    }
                                    className="mt-1 font-semibold hover:underline"
                                  >
                                    {t("recipeHistoryRetry")}
                                  </button>
                                </div>
                              )}
                            {!recipeRevisionLoadingByRecipe[recipe.id] &&
                              !recipeRevisionErrorByRecipe[recipe.id] &&
                              recipeRevisions.length > 0 && (
                                <ol className="ml-1 space-y-3 border-l border-border pl-4">
                                  {recipeRevisions.map((revision) => {
                                    const current =
                                      revision.id === recipe.active_revision_id;
                                    const pending =
                                      pendingRecipeRestore?.recipeId === recipe.id &&
                                      pendingRecipeRestore.revisionId === revision.id;
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
                                        {!current && !pending && (
                                          <button
                                            type="button"
                                            disabled={Boolean(restoring)}
                                            aria-label={t("restoreRecipeAria", {
                                              time: formattedTime,
                                            })}
                                            onClick={() =>
                                              setPendingRecipeRestore({
                                                recipeId: recipe.id,
                                                revisionId: revision.id,
                                              })
                                            }
                                            className="mt-1 text-[11px] font-semibold text-primary hover:underline disabled:opacity-50"
                                          >
                                            {t("recipeRestoreButton")}
                                          </button>
                                        )}
                                        {pending && (
                                          <div className="mt-2 border border-warning/30 bg-warning/[0.06] px-2.5 py-2 text-[11px] leading-5 text-warning">
                                            <p>
                                              {t("recipeRestoreHint")}
                                            </p>
                                            <div className="mt-1.5 flex gap-3">
                                              <button
                                                type="button"
                                                disabled={Boolean(restoring)}
                                                onClick={() =>
                                                  void performRecipeRestore(
                                                    recipe.id,
                                                    revision.id
                                                  )
                                                }
                                                className="font-semibold text-primary hover:underline disabled:opacity-50"
                                              >
                                                {restoring === revision.id
                                                  ? t("recipeRestoring")
                                                  : t("recipeRestoreConfirm")}
                                              </button>
                                              <button
                                                type="button"
                                                disabled={Boolean(restoring)}
                                                onClick={() =>
                                                  setPendingRecipeRestore(null)
                                                }
                                                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                                              >
                                                {t("recipeRestoreCancel")}
                                              </button>
                                            </div>
                                          </div>
                                        )}
                                      </li>
                                    );
                                  })}
                                </ol>
                              )}
                            {recipeHistoryFeedback?.recipeId === recipe.id && (
                              <div
                                role="status"
                                className="mt-3 border border-success/30 bg-success/[0.06] px-3 py-2 text-xs leading-5 text-success"
                              >
                                {recipeHistoryFeedback.message}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {!sources.length && (
                <div className="border border-border px-4 py-5 text-center text-xs leading-5 text-muted-foreground">
                  {t("emptyData")}
                </div>
              )}
            </div>
          </section>

          {connections?.some((item) => !attachedConnections.has(item.id)) && (
            <section>
              <h3 className="mb-3 text-sm font-semibold text-foreground">{t("connectExistingDb")}</h3>
              <div className="space-y-2">
                {connections
                  .filter((connection) => !attachedConnections.has(connection.id))
                  .map((connection) => (
                    <button
                      key={connection.id}
                      disabled={isUploading}
                      onClick={() => void attachConnection(connection.id, connection.name)}
                      className="flex w-full items-center gap-3 border border-border bg-background px-3 py-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:opacity-50"
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
                    </button>
                  ))}
              </div>
            </section>
          )}

          {!connections?.length && (
            <section className="border border-border bg-background px-4 py-4">
              <h3 className="text-sm font-semibold text-foreground">{t("connectDbPrompt")}</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {t("connectDbHint")}
              </p>
              <button
                type="button"
                onClick={onConfigureConnection}
                className="mt-3 inline-flex items-center gap-2 bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
              >
                <Plus size={14} />
                {t("connectDbButton")}
              </button>
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
    {cleaningSource?.kind === "file" && (
      <VisualCleaningEditor
        key={cleaningSource.id}
        source={cleaningSource}
        columns={cleaningColumns}
        recipeOperations={cleaningRecipe?.operations || []}
        onClose={() => setCleaningSourceId(null)}
      />
    )}
    </>
  );
}
