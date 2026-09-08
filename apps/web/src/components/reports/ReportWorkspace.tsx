"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  Eye,
  FileText,
  FileSpreadsheet,
  LayoutDashboard,
  Loader2,
  PanelLeftClose,
  PanelRightClose,
  PencilLine,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  exportReportExcel,
  getReport,
  refreshReportBlock,
  ReportConflictError,
  type ReportSerializationCopy,
  updateReport,
  type ReportBlock,
  type ReportBlockType,
  type ReportDraftContext,
  type ReportDocument,
  type ReportPage,
} from "@/lib/reports";
import type { AnalysisArtifact, AnalysisRunSummary } from "@/lib/types/api";
import { cn } from "@/lib/utils";
import type { ReportDraftPlan } from "@/lib/reports";
import {
  normalizeConversationId,
  storedConversationIdForProject,
  useChatStore,
} from "@/lib/stores/chat";
import {
  InvestigationPicker,
  type InvestigationPickerMode,
} from "./InvestigationPicker";
import { ReportBlockCard } from "./ReportBlockCard";
import { ReportPrintView } from "./ReportPrintView";
import { useReportReading } from "./useReportReading";
import { ReportFilterControl } from "./ReportFilterControl";
import { selectionLabel } from "./ReportSelectionControl";
import { ReportPropertyPanel } from "./ReportPropertyPanel";
import {
  balanceMetricWidths,
  createInvestigationReportDraftFromPlan,
  type ReportDraftCopy,
} from "./report-draft";
import {
  blockTypeLabel,
  createReportBlocksCopy,
  createLocalId,
  createManualBlock,
  createReportPage,
  reportBlockOptions,
} from "@/lib/report-blocks";
import { editReportDocument, type ReportPageCommand } from "@/lib/report-editing";

type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";

const REPORT_COMPACT_WORKSPACE_QUERY = "(max-width: 1279px)";
const REPORT_OUTLINE_IN_FLOW_QUERY = "(min-width: 1280px)";
const REPORT_PROPERTIES_IN_FLOW_QUERY = "(min-width: 1536px)";
function errorMessage(
  error: unknown,
  fallback: string,
  conflict: string
): string {
  return error instanceof ReportConflictError ? conflict : fallback;
}

function savedTime(
  value: string,
  locale: string,
  saved: string,
  savedAt: (time: string) => string
): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return saved;
  return savedAt(new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date));
}

function updatedDate(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value.slice(0, 10);
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function orderedPages(report: ReportDocument): ReportPage[] {
  return [...report.pages].sort((left, right) => left.order_index - right.order_index);
}

function totalBlocks(report: ReportDocument): number {
  return report.pages.reduce((total, page) => total + page.blocks.length, 0);
}

function isPristineBlankReport(report: ReportDocument): boolean {
  if (report.description.trim() || report.pages.length !== 1 || totalBlocks(report) !== 0) {
    return false;
  }
  const title = report.title.trim().toLocaleLowerCase();
  const pageTitle = report.pages[0]?.title.trim().toLocaleLowerCase();
  return (
    (title === "新报告" || title === "new report" || title === "untitled report") &&
    (pageTitle === "概览" || pageTitle === "overview")
  );
}

function exportFileName(
  title: string,
  extension: "xlsx",
  fallback: string
): string {
  const safeTitle = title.trim().replace(/[\\/:*?"<>|]/g, "-") || fallback;
  return `${safeTitle}.${extension}`;
}

function uniquePageTitle(
  title: string,
  usedTitles: Set<string>,
  fallback: string
): string {
  const normalized = title.trim() || fallback;
  let candidate = normalized;
  let suffix = 2;
  while (usedTitles.has(candidate.toLocaleLowerCase())) {
    const suffixText = ` ${suffix}`;
    candidate = `${normalized.slice(0, 160 - suffixText.length)}${suffixText}`;
    suffix += 1;
  }
  usedTitles.add(candidate.toLocaleLowerCase());
  return candidate;
}

function downloadBlob(blob: Blob, fileName: string): void {
  if (typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

async function waitForPrintLayout(): Promise<void> {
  await document.fonts?.ready;
  if (typeof window.requestAnimationFrame !== "function") return;
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  const images = Array.from(
    document.querySelectorAll<HTMLImageElement>(".report-print-view img")
  );
  await Promise.all(
    images.map(async (image) => {
      if (typeof image.decode === "function") {
        await image.decode().catch(() => undefined);
        return;
      }
      if (image.complete) return;
      await new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      });
    })
  );
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

function gridStyle(block: ReportBlock): CSSProperties {
  return {
    "--report-column": `${block.layout.x + 1} / span ${block.layout.w}`,
    "--report-column-span": `span ${block.layout.w} / span ${block.layout.w}`,
    "--report-row": `${block.layout.y + 1} / span ${block.layout.h}`,
  } as CSSProperties;
}

function ReportPageNavigator({
  pages,
  activePageId,
  editing,
  mutationDisabled,
  onSelectPage,
  onAddPage,
}: {
  pages: ReportPage[];
  activePageId: string;
  editing: boolean;
  mutationDisabled: boolean;
  onSelectPage: (pageId: string) => void;
  onAddPage: () => void;
}) {
  const t = useTranslations("reportWorkspace");
  const currentIndex = Math.max(
    0,
    pages.findIndex((page) => page.id === activePageId)
  );
  const previousPage = pages[currentIndex - 1];
  const nextPage = pages[currentIndex + 1];

  return (
    <div
      className={cn(
        "sticky top-0 z-20 border-b border-border/80 px-3 py-2 backdrop-blur",
        editing ? "bg-background/95" : "bg-muted/95"
      )}
    >
      <nav
        aria-label={t("pageNavigation")}
        className={cn(
          "mx-auto flex flex-wrap items-center gap-2",
          editing ? "max-w-[1320px]" : "max-w-[1120px]"
        )}
      >
        <div className="flex min-w-0 w-full items-center gap-2 sm:w-auto">
          <span
            aria-live="polite"
            className="shrink-0 font-mono text-[10px] font-semibold tabular-nums text-muted-foreground"
          >
            {t("pagePosition", { current: currentIndex + 1, total: pages.length })}
          </span>
          <select
            aria-label={t("selectPage")}
            value={activePageId}
            onChange={(event) => onSelectPage(event.target.value)}
            className="h-8 min-w-0 flex-1 border border-border bg-card px-2 text-xs font-medium text-foreground outline-none focus:border-primary sm:w-60 sm:flex-none"
          >
            {pages.map((page, index) => (
              <option key={page.id} value={page.id}>
                {String(index + 1).padStart(2, "0")} · {page.title}
              </option>
            ))}
          </select>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={!previousPage}
            aria-label={
              previousPage
                ? t("previousPageNamed", { title: previousPage.title })
                : t("previousPage")
            }
            onClick={() => previousPage && onSelectPage(previousPage.id)}
            className="inline-flex h-8 items-center gap-1 border border-border bg-card px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
          >
            <ChevronLeft size={13} />
            <span className="hidden md:inline">{t("previousPage")}</span>
          </button>
          <button
            type="button"
            disabled={!nextPage}
            aria-label={
              nextPage
                ? t("nextPageNamed", { title: nextPage.title })
                : t("nextPage")
            }
            onClick={() => nextPage && onSelectPage(nextPage.id)}
            className="inline-flex h-8 items-center gap-1 border border-border bg-card px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
          >
            <span className="hidden md:inline">{t("nextPage")}</span>
            <ChevronRight size={13} />
          </button>
          {editing && (
            <button
              type="button"
              aria-label={t("addPage")}
              disabled={mutationDisabled}
              onClick={onAddPage}
              className="ml-1 inline-flex h-8 items-center gap-1 border border-primary/25 bg-primary/[0.06] px-2 text-[11px] font-semibold text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Plus size={13} />
              <span className="hidden sm:inline">{t("addPage")}</span>
            </button>
          )}
        </div>
      </nav>
    </div>
  );
}

interface SaveReconciliation {
  report: ReportDocument;
  pageIds: Map<string, string>;
  blockIds: Map<string, string>;
}

export function reconcileReportAfterSave(
  current: ReportDocument,
  sent: ReportDocument,
  saved: ReportDocument
): SaveReconciliation {
  const pageIds = new Map<string, string>();
  const blockIds = new Map<string, string>();

  const pages = current.pages.map((currentPage) => {
    const sentPageIndex = sent.pages.findIndex((page) => page.id === currentPage.id);
    if (sentPageIndex < 0) return currentPage;
    const sentPage = sent.pages[sentPageIndex];
    const savedPage = sentPage.id.startsWith("local-")
      ? saved.pages.find((page) => page.order_index === sentPage.order_index) ||
        saved.pages[sentPageIndex]
      : saved.pages.find((page) => page.id === sentPage.id);
    if (!savedPage) return currentPage;
    pageIds.set(currentPage.id, savedPage.id);

    const blocks = currentPage.blocks.map((currentBlock) => {
      const sentBlockIndex = sentPage.blocks.findIndex(
        (block) => block.id === currentBlock.id
      );
      if (sentBlockIndex < 0) return currentBlock;
      const sentBlock = sentPage.blocks[sentBlockIndex];
      const savedBlock = sentBlock.id.startsWith("local-")
        ? savedPage.blocks.find(
            (block) => block.order_index === sentBlock.order_index
          ) || savedPage.blocks[sentBlockIndex]
        : savedPage.blocks.find((block) => block.id === sentBlock.id);
      if (!savedBlock) return currentBlock;
      blockIds.set(currentBlock.id, savedBlock.id);
      return {
        ...currentBlock,
        id: savedBlock.id,
        version: savedBlock.version,
        created_at: savedBlock.created_at,
        updated_at: savedBlock.updated_at,
      };
    });

    return {
      ...currentPage,
      id: savedPage.id,
      version: savedPage.version,
      created_at: savedPage.created_at,
      updated_at: savedPage.updated_at,
      blocks,
    };
  });

  return {
    report: {
      ...current,
      version: saved.version,
      updated_at: saved.updated_at,
      extra_data: saved.extra_data,
      pages,
    },
    pageIds,
    blockIds,
  };
}

interface ReportWorkspaceProps {
  projectId: string;
  reportId: string;
  initialRunId?: string;
}

export function ReportWorkspace(props: ReportWorkspaceProps) {
  return <ReportWorkspaceSession key={`${props.projectId}:${props.reportId}`} {...props} />;
}

function ReportWorkspaceSession({ projectId, reportId, initialRunId }: ReportWorkspaceProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const t = useTranslations("reportWorkspace");
  const tDraft = useTranslations("reportDraft");
  const tBlocks = useTranslations("reportBlocks");
  const requestedConversationId = normalizeConversationId(
    searchParams.get("fromConversation")
  );
  const {
    currentConversationId,
    currentConversationMeta,
    lastProjectId,
  } = useChatStore();
  const [report, setReport] = useState<ReportDocument | null>(null);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const activePage = useMemo(
    () => report?.pages.find((page) => page.id === activePageId) || report?.pages[0] || null,
    [activePageId, report]
  );
  const reading = useReportReading(report, activePage, editing);
  const { reset: resetReading, clearSelections, setFilter, remap: remapReading } = reading;
  const { filters: filterValues, selections: reportSelections } = reading.state;
  const activeSelections = reading.page?.selections ?? [];
  const inheritedFilters = reading.page?.inheritedFilters ?? [];
  const clearPageSelections = () => { if (activePage) clearSelections(activePage.id); };
  const tInteractions = useTranslations("reportInteractions");
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [investigationOpen, setInvestigationOpen] = useState(false);
  const [investigationMode, setInvestigationMode] =
    useState<InvestigationPickerMode>("smart");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshingBlockId, setRefreshingBlockId] = useState<string | null>(null);
  const [printViewOpen, setPrintViewOpen] = useState(false);
  const [storedConversationId, setStoredConversationId] = useState<string | null>(null);
  const reportRef = useRef<ReportDocument | null>(null);
  const reportScrollRef = useRef<HTMLElement | null>(null);
  const editRevisionRef = useRef(0);
  const refreshInFlightRef = useRef(false);
  const blocksCopy = useMemo(
    () => createReportBlocksCopy((key, values) => tBlocks(key, values)),
    [tBlocks]
  );
  const blockOptions = useMemo(() => reportBlockOptions(blocksCopy), [blocksCopy]);
  const serializationCopy = useMemo<ReportSerializationCopy>(
    () => ({
      unnamedBlock: tBlocks("unnamedBlock"),
      textBlock: tBlocks("labelText"),
      unnamedPage: tBlocks("unnamedPage"),
      unnamedReport: tBlocks("unnamedReport"),
    }),
    [tBlocks]
  );
  const liveConversationId =
    currentConversationId &&
    (currentConversationMeta?.project_id === projectId || lastProjectId === projectId)
      ? currentConversationId
      : null;
  const sourceConversationId =
    requestedConversationId || liveConversationId || storedConversationId;
  const reportListParams = new URLSearchParams();
  if (initialRunId) reportListParams.set("fromRun", initialRunId);
  if (sourceConversationId) {
    reportListParams.set("fromConversation", sourceConversationId);
  }
  const reportListQuery = reportListParams.toString();
  const reportListHref = `/projects/${projectId}/reports${
    reportListQuery ? `?${reportListQuery}` : ""
  }`;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const next = await getReport(projectId, reportId, serializationCopy);
      const pages = next.pages.length
        ? orderedPages(next)
        : [createReportPage(t("overviewPage"), 0)];
      const normalized = { ...next, pages };
      reportRef.current = normalized;
      editRevisionRef.current = 0;
      setReport(normalized);
      setActivePageId(pages[0]?.id || null);
      setSelectedBlockId(null);
      setEditing(Boolean(initialRunId) || totalBlocks(normalized) === 0);
      setInvestigationMode("smart");
      setInvestigationOpen(Boolean(initialRunId));
      setDirty(false);
      setSaveState("idle");
      setExportError(null);
      setRefreshError(null);
      setRefreshingBlockId(null);
      setExportMenuOpen(false);
      resetReading();
    } catch (error) {
      setLoadError(errorMessage(error, t("loadError"), t("conflictError")));
    } finally {
      setLoading(false);
    }
  }, [initialRunId, projectId, reportId, serializationCopy, t, resetReading]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setStoredConversationId(storedConversationIdForProject(projectId));
  }, [projectId]);

  useEffect(() => {
    const compactWorkspace = window.matchMedia(REPORT_COMPACT_WORKSPACE_QUERY);
    setOutlineOpen(window.matchMedia(REPORT_OUTLINE_IN_FLOW_QUERY).matches);
    setPropertiesOpen(window.matchMedia(REPORT_PROPERTIES_IN_FLOW_QUERY).matches);

    const collapseOutlineWhenCompact = (event: MediaQueryListEvent) => {
      if (event.matches) setOutlineOpen(false);
    };
    compactWorkspace.addEventListener("change", collapseOutlineWhenCompact);
    return () =>
      compactWorkspace.removeEventListener("change", collapseOutlineWhenCompact);
  }, []);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const visiblePages = useMemo(() => (report ? orderedPages(report) : []), [report]);
  const activePageNumber = Math.max(
    1,
    visiblePages.findIndex((page) => page.id === activePage?.id) + 1
  );
  const reportMutationDisabled = Boolean(refreshingBlockId);
  const activePageNarrative =
    typeof activePage?.config.narrative === "string"
      ? activePage.config.narrative.trim()
      : "";
  const selectedBlock = useMemo(
    () => activePage?.blocks.find((block) => block.id === selectedBlockId) || null,
    [activePage, selectedBlockId]
  );
  const reportDraftContext = useMemo<ReportDraftContext | undefined>(() => {
    if (!report) return undefined;
    const existingArtifactIds = new Set<string>();
    for (const page of report.pages) {
      for (const block of page.blocks) {
        if (block.artifact_id) existingArtifactIds.add(block.artifact_id);
      }
    }
    return {
      title: report.title.slice(0, 200),
      description: report.description.slice(0, 1200),
      pages: orderedPages(report)
        .map((page) => page.title.trim().slice(0, 160))
        .filter(Boolean)
        .slice(0, 30),
      existing_artifact_ids: [...existingArtifactIds].slice(0, 200),
      has_user_edits: dirty || !isPristineBlankReport(report),
    };
  }, [dirty, report]);
  const draftCopy = useMemo<ReportDraftCopy>(
    () => ({
      summaryTitle: tDraft("summaryTitle"),
      narrativeTitle: tDraft("narrativeTitle"),
      sectionOverview: tDraft("sectionOverview"),
      sectionDetail: tDraft("sectionDetail"),
      sectionEvidence: tDraft("sectionEvidence"),
      fallbackTitle: tDraft("fallbackTitle"),
      blocks: blocksCopy,
      locale,
    }),
    [blocksCopy, locale, tDraft]
  );
  const mutateReport = useCallback((updater: (current: ReportDocument) => ReportDocument) => {
    const current = reportRef.current;
    if (!current || refreshInFlightRef.current) return;
    const next = updater(current);
    if (next === current) return;
    reportRef.current = next;
    editRevisionRef.current += 1;
    setReport(next);
    setDirty(true);
    setSaveState((current) => (current === "saving" ? current : "idle"));
    setSaveError(null);
    setRefreshError(null);
    return next;
  }, []);

  const scrollReportToTop = useCallback(() => {
    const scroll = () => reportScrollRef.current?.scrollTo?.({ top: 0 });
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(scroll);
    } else {
      scroll();
    }
  }, []);

  const selectReportPage = useCallback(
    (pageId: string) => {
      setActivePageId(pageId);
      setSelectedBlockId(null);
      if (window.matchMedia(REPORT_COMPACT_WORKSPACE_QUERY).matches) {
        setOutlineOpen(false);
      }
      scrollReportToTop();
    },
    [scrollReportToTop]
  );

  const editPage = useCallback(
    (pageId: string, command: ReportPageCommand) =>
      mutateReport(current => editReportDocument(current, pageId, command)),
    [mutateReport]
  );

  const changePage = (updates: Partial<ReportPage>) => {
    if (refreshInFlightRef.current || !activePage) return;
    editPage(activePage.id, { type: "update-page", updates });
  };

  const changeBlock = (updates: Partial<ReportBlock>) => {
    if (refreshInFlightRef.current || !activePage || !selectedBlock) return;
    editPage(activePage.id, { type: "update-block", blockId: selectedBlock.id, updates });
  };

  const addBlock = (type: ReportBlockType) => {
    if (refreshInFlightRef.current || !activePage) return;
    const block = createManualBlock(type, blocksCopy);
    if (!editPage(activePage.id, { type: "append-blocks", blocks: [block] })) return;
    setSelectedBlockId(block.id);
    setPropertiesOpen(true);
    if (window.matchMedia(REPORT_COMPACT_WORKSPACE_QUERY).matches) {
      setOutlineOpen(false);
    }
    setAddMenuOpen(false);
  };

  const addImportedBlocks = (blocks: ReportBlock[]) => {
    if (refreshInFlightRef.current || !activePage || !blocks.length) return;
    const preparedBlocks = balanceMetricWidths(
      blocks.map((block) => ({
        ...block,
        layout: {
          ...block.layout,
          w:
            block.block_type === "chart"
              ? 6
              : block.block_type === "metric"
                ? block.layout.w
                : 12,
          h:
            block.block_type === "chart"
              ? 4
              : block.block_type === "table"
                ? 6
                : block.block_type === "evidence"
                  ? 4
                : block.block_type === "text" &&
                    block.source_kind === "analysis_run" &&
                    !block.artifact_id
                  ? 2
                : block.layout.h,
        },
      }))
    );
    if (!editPage(activePage.id, { type: "append-blocks", blocks: preparedBlocks })) return;
    setSelectedBlockId(preparedBlocks[0].id);
    setPropertiesOpen(true);
    if (window.matchMedia(REPORT_COMPACT_WORKSPACE_QUERY).matches) {
      setOutlineOpen(false);
    }
  };

  const openInvestigation = (mode: InvestigationPickerMode) => {
    if (refreshInFlightRef.current) return;
    setInvestigationMode(mode);
    setAddMenuOpen(false);
    setInvestigationOpen(true);
  };

  const addGeneratedDraft = (
    run: AnalysisRunSummary,
    artifacts: AnalysisArtifact[],
    plan: ReportDraftPlan
  ) => {
    const currentReport = reportRef.current || report;
    if (refreshInFlightRef.current || !currentReport) return;
    const replaceableBlank = !dirty && isPristineBlankReport(currentReport);
    const retainedPages = replaceableBlank ? [] : currentReport.pages;
    const existingArtifactIds = new Set(
      currentReport.pages.flatMap((page) =>
        page.blocks.flatMap((block) => (block.artifact_id ? [block.artifact_id] : []))
      )
    );
    const novelArtifacts = artifacts.filter(
      (artifact) =>
        artifact.kind !== "report" && !existingArtifactIds.has(artifact.id)
    );
    const draft = createInvestigationReportDraftFromPlan(
      run,
      novelArtifacts,
      plan,
      draftCopy,
      retainedPages.length
    );
    const usedTitles = new Set(
      retainedPages.map((page) => page.title.trim().toLocaleLowerCase())
    );
    const draftPages = draft.pages.map((page) => ({
      ...page,
      title: uniquePageTitle(page.title, usedTitles, t("pageFallback")),
    }));
    const pages = [...retainedPages, ...draftPages].map((page, index) => ({
      ...page,
      order_index: index,
    }));

    mutateReport((current) => ({
      ...current,
      title: replaceableBlank ? draft.title : current.title,
      description: replaceableBlank ? draft.description : current.description,
      pages,
    }));
    setActivePageId(draftPages[0]?.id || pages[0]?.id || null);
    setSelectedBlockId(null);
    setEditing(true);
    clearSelections();
    setOutlineOpen(true);
    setPropertiesOpen(false);
    setExportError(null);
  };

  const moveBlock = (blockId: string, direction: -1 | 1) => {
    if (refreshInFlightRef.current || !activePage) return;
    editPage(activePage.id, { type: "move-block", blockId, direction });
  };

  const resizeBlock = (blockId: string, direction: -1 | 1) => {
    if (refreshInFlightRef.current || !activePage) return;
    editPage(activePage.id, { type: "resize-block", blockId, direction });
  };

  const duplicateBlock = (blockId: string) => {
    if (refreshInFlightRef.current || !activePage) return;
    const source = activePage.blocks.find(block => block.id === blockId);
    if (!source) return;
    const duplicateId = createLocalId("block");
    if (editPage(activePage.id, {
      type: "duplicate-block", blockId, newBlockId: duplicateId,
      title: t("duplicateTitle", { title: source.title }),
      connectionKeys: { interaction_key: crypto.randomUUID(), filter_target_key: crypto.randomUUID() },
    })) setSelectedBlockId(duplicateId);
  };

  const deleteBlock = (blockId: string) => {
    if (refreshInFlightRef.current || !activePage) return;
    if (editPage(activePage.id, { type: "remove-block", blockId }) && selectedBlockId === blockId) setSelectedBlockId(null);
  };

  const addPage = () => {
    if (refreshInFlightRef.current || !report) return;
    const page = createReportPage(
      t("pageNumber", { number: report.pages.length + 1 }),
      report.pages.length
    );
    mutateReport((current) => ({ ...current, pages: [...current.pages, page] }));
    selectReportPage(page.id);
  };

  const deletePage = (pageId: string) => {
    if (refreshInFlightRef.current || !report || report.pages.length <= 1) return;
    const deletedIndex = report.pages.findIndex((page) => page.id === pageId);
    const nextPages = report.pages
      .filter((page) => page.id !== pageId)
      .map((page, index) => ({ ...page, order_index: index }));
    mutateReport((current) => ({ ...current, pages: nextPages }));
    if (activePageId === pageId) {
      selectReportPage(nextPages[Math.min(deletedIndex, nextPages.length - 1)].id);
    } else {
      setSelectedBlockId(null);
    }
  };

  const save = useCallback(async (): Promise<boolean> => {
    const currentReport = reportRef.current || report;
    if (
      refreshInFlightRef.current ||
      !currentReport ||
      saveState === "saving"
    ) {
      return false;
    }
    if (!dirty) return true;
    const sentRevision = editRevisionRef.current;
    const sentSnapshot = structuredClone(currentReport);
    setSaveState("saving");
    setSaveError(null);
    setRefreshError(null);
    try {
      const saved = await updateReport(projectId, sentSnapshot.id, {
        title: sentSnapshot.title,
        description: sentSnapshot.description,
        status: sentSnapshot.status,
        expected_version: sentSnapshot.version,
        pages: sentSnapshot.pages,
      }, serializationCopy);
      if (editRevisionRef.current === sentRevision) {
        const identity = reconcileReportAfterSave(sentSnapshot, sentSnapshot, saved);
        reportRef.current = saved;
        setReport(saved);
        setActivePageId((current) =>
          current
            ? identity.pageIds.get(current) ||
              (saved.pages.some((page) => page.id === current)
                ? current
                : saved.pages[0]?.id || null)
            : saved.pages[0]?.id || null
        );
        setSelectedBlockId((current) =>
          current ? identity.blockIds.get(current) || current : current
        );
        remapReading(identity.pageIds, identity.blockIds);
        setDirty(false);
        setSaveState("saved");
        return true;
      } else {
        const latest = reportRef.current || currentReport;
        const reconciled = reconcileReportAfterSave(latest, sentSnapshot, saved);
        reportRef.current = reconciled.report;
        setReport(reconciled.report);
        setActivePageId((current) =>
          current ? reconciled.pageIds.get(current) || current : current
        );
        setSelectedBlockId((current) =>
          current ? reconciled.blockIds.get(current) || current : current
        );
        remapReading(reconciled.pageIds, reconciled.blockIds);
        setDirty(true);
        setSaveState("idle");
        return false;
      }
    } catch (error) {
      setSaveState(error instanceof ReportConflictError ? "conflict" : "error");
      setSaveError(errorMessage(error, t("saveError"), t("conflictError")));
      return false;
    }
  }, [dirty, projectId, report, saveState, serializationCopy, t, remapReading]);

  const refreshBlock = useCallback(
    async (pageId: string, blockId: string) => {
      const currentReport = reportRef.current || report;
      if (!currentReport || dirty || refreshInFlightRef.current) return;
      const block = currentReport.pages
        .find((page) => page.id === pageId)
        ?.blocks.find((candidate) => candidate.id === blockId);
      if (!block || typeof block.version !== "number") return;

      const sentRevision = editRevisionRef.current;
      refreshInFlightRef.current = true;
      setRefreshError(null);
      setRefreshingBlockId(blockId);
      try {
        const refreshed = await refreshReportBlock(
          projectId,
          currentReport.id,
          pageId,
          blockId,
          block.version,
          serializationCopy
        );
        if (editRevisionRef.current !== sentRevision) {
          setRefreshError(t("refreshError"));
          return;
        }
        reportRef.current = refreshed;
        setReport(refreshed);
        setActivePageId((current) =>
          current && refreshed.pages.some((page) => page.id === current)
            ? current
            : refreshed.pages[0]?.id || null
        );
        setSelectedBlockId((current) =>
          current &&
          refreshed.pages.some((page) =>
            page.blocks.some((candidate) => candidate.id === current)
          )
            ? current
            : null
        );
        setSaveState("saved");
      } catch {
        setRefreshError(t("refreshError"));
      } finally {
        refreshInFlightRef.current = false;
        setRefreshingBlockId(null);
      }
    },
    [
      dirty,
      projectId,
      report,
      serializationCopy,
      t,
    ]
  );

  const handleExportPdf = useCallback(async () => {
    if (exporting || refreshInFlightRef.current) return;
    setExportMenuOpen(false);
    setExportError(null);
    setExporting("pdf");
    try {
      if (!(await save())) {
        setExportError(t("saveBeforeExport"));
        return;
      }
      setPrintViewOpen(true);
      await waitForPrintLayout();
      window.print();
    } catch {
      setExportError(t("pdfExportError"));
    } finally {
      setPrintViewOpen(false);
      setExporting(null);
    }
  }, [exporting, save, t]);

  const handleExportExcel = useCallback(async () => {
    if (exporting || refreshInFlightRef.current) return;
    setExportMenuOpen(false);
    setExportError(null);
    setExporting("excel");
    try {
      if (!(await save())) {
        setExportError(t("saveBeforeExport"));
        return;
      }
      const currentReport = reportRef.current;
      if (!currentReport) return;
      const file = await exportReportExcel(projectId, currentReport.id);
      downloadBlob(
        file,
        exportFileName(currentReport.title, "xlsx", t("reportFileFallback"))
      );
    } catch {
      setExportError(t("excelExportError"));
    } finally {
      setExporting(null);
    }
  }, [exporting, projectId, save, t]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [save]);

  if (loading) {
    return (
      <main className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        <Loader2 size={18} className="mr-2 animate-spin" />
        {t("opening")}
      </main>
    );
  }

  if (loadError || !report || !activePage) {
    return (
      <main className="flex h-screen flex-col items-center justify-center bg-background px-6 text-center">
        <CircleAlert size={24} className="text-destructive" />
        <h1 className="mt-4 text-lg font-semibold">{t("notOpenTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{loadError || t("unavailable")}</p>
        <button type="button" onClick={() => void load()} className="mt-5 inline-flex h-9 items-center gap-2 bg-primary px-4 text-xs font-semibold text-primary-foreground">
          <RefreshCw size={14} />
          {t("reopen")}
        </button>
      </main>
    );
  }

  return (
    <>
    <main className="report-screen-view flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-card px-3 py-2 2xl:h-16 2xl:flex-nowrap 2xl:px-5 2xl:py-0">
        <div className="flex w-full min-w-0 items-center gap-2 2xl:w-auto 2xl:flex-1">
          <Link
            href={reportListHref}
            aria-label={t("backToReports")}
            onClick={(event) => {
              if (!dirty) return;
              event.preventDefault();
              void save().then((saved) => {
                if (saved) router.push(reportListHref);
              });
            }}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft size={17} />
          </Link>
          {editing && (
            <button type="button" aria-label={outlineOpen ? t("collapseOutline") : t("expandOutline")} onClick={() => {
              setOutlineOpen((current) => {
                if (!current && window.matchMedia(REPORT_COMPACT_WORKSPACE_QUERY).matches) {
                  setPropertiesOpen(false);
                }
                return !current;
              });
            }} className="inline-flex h-9 w-9 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground">
              <PanelLeftClose size={16} className={!outlineOpen ? "rotate-180" : ""} />
            </button>
          )}
          <div className="min-w-0">
            {editing ? (
              <input
                value={report.title}
                aria-label={t("reportTitle")}
                maxLength={200}
                disabled={reportMutationDisabled}
                onChange={(event) => mutateReport((current) => ({ ...current, title: event.target.value }))}
                className="h-8 w-[min(58vw,420px)] min-w-20 truncate border-0 bg-transparent px-1 text-sm font-semibold outline-none focus:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60 lg:w-[min(36vw,420px)]"
              />
            ) : (
              <h1 className="max-w-[46vw] truncate text-sm font-semibold">{t("readerTitle")}</h1>
            )}
            <p className="px-1 text-[10px] text-muted-foreground">
              {dirty
                ? t("unsavedChanges")
                : savedTime(
                    report.updated_at,
                    locale,
                    t("saved"),
                    (time) => t("savedAt", { time })
                  )}
            </p>
          </div>
        </div>

        <div className="flex w-full min-w-0 shrink-0 items-center justify-start gap-1.5 border-t border-border/70 pt-2 2xl:w-auto 2xl:border-0 2xl:pt-0">
          {editing && (
            <>
              <div className="relative">
                <button type="button" disabled={reportMutationDisabled} onClick={() => setAddMenuOpen((current) => !current)} className="inline-flex h-9 items-center gap-2 px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45">
                  <Plus size={15} />
                  <span className="hidden lg:inline">{t("addContent")}</span>
                  <ChevronDown size={12} className="hidden lg:block" />
                </button>
                {addMenuOpen && (
                  <div className="absolute left-0 top-11 z-30 grid w-[min(360px,calc(100vw-2rem))] grid-cols-2 border border-border bg-popover p-2 sm:left-auto sm:right-0">
                    {blockOptions.map((option) => (
                      <button key={option.type} type="button" onClick={() => addBlock(option.type)} className="p-3 text-left hover:bg-muted">
                        <span className="block text-xs font-semibold">{option.label}</span>
                        <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">{option.description}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => openInvestigation("manual")}
                      className="col-span-2 mt-1 flex items-start gap-3 border-t border-border p-3 text-left hover:bg-muted"
                    >
                      <Check size={15} className="mt-0.5 shrink-0 text-primary" />
                      <span>
                        <span className="block text-xs font-semibold">{t("pickFromInvestigation")}</span>
                        <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">{t("pickFromInvestigationDescription")}</span>
                      </span>
                    </button>
                  </div>
                )}
              </div>
              <button type="button" disabled={reportMutationDisabled} onClick={() => openInvestigation("smart")} className="inline-flex h-9 items-center gap-2 px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 md:px-3">
                <Sparkles size={15} />
                <span className="hidden lg:inline">{t("smartArrange")}</span>
              </button>
              <button type="button" aria-label={propertiesOpen ? t("collapseSettings") : t("expandSettings")} onClick={() => {
                setPropertiesOpen((current) => {
                  if (!current && window.matchMedia(REPORT_COMPACT_WORKSPACE_QUERY).matches) {
                    setOutlineOpen(false);
                  }
                  return !current;
                });
              }} className="inline-flex h-9 w-9 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground">
                <PanelRightClose size={16} className={!propertiesOpen ? "rotate-180" : ""} />
              </button>
            </>
          )}

          <div className="relative">
            <button
              type="button"
              aria-label={t("exportReport")}
              aria-expanded={exportMenuOpen}
              onClick={() => {
                setExportMenuOpen((current) => !current);
                setAddMenuOpen(false);
                setExportError(null);
              }}
              disabled={
                Boolean(exporting) ||
                saveState === "saving" ||
                reportMutationDisabled
              }
              className="inline-flex h-9 items-center gap-1.5 px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-45"
            >
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              <span className="hidden md:inline">{t("export")}</span>
              <ChevronDown size={11} />
            </button>
            {exportMenuOpen && (
              <div className="absolute right-0 top-11 z-30 w-44 border border-border bg-popover p-1.5">
                <button
                  type="button"
                  onClick={() => void handleExportPdf()}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium hover:bg-muted"
                >
                  <Printer size={14} className="text-primary" />
                  {t("exportPdf")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleExportExcel()}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium hover:bg-muted"
                >
                  <FileSpreadsheet size={14} className="text-primary" />
                  {t("exportExcel")}
                </button>
              </div>
            )}
          </div>

          <div className="flex h-9 items-center border border-border bg-background p-0.5">
            <button type="button" aria-pressed={!editing} aria-label={t("readReport")} onClick={() => { setEditing(false); setAddMenuOpen(false); }} className={cn("inline-flex h-7 items-center gap-1.5 px-2.5 text-[11px] font-medium", !editing ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              <Eye size={13} />
              <span className="hidden sm:inline">{t("read")}</span>
            </button>
            <button type="button" aria-pressed={editing} aria-label={t("editReport")} onClick={() => { setEditing(true); clearSelections(); }} className={cn("inline-flex h-7 items-center gap-1.5 px-2.5 text-[11px] font-medium", editing ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              <PencilLine size={13} />
              <span className="hidden sm:inline">{t("edit")}</span>
            </button>
          </div>

          {editing && (
            <button type="button" onClick={() => void save()} disabled={!dirty || saveState === "saving" || reportMutationDisabled} aria-label={saveState === "saving" ? t("saving") : t("save")} className="inline-flex h-9 min-w-9 items-center justify-center gap-2 bg-primary px-2 text-xs font-semibold text-primary-foreground disabled:opacity-45 sm:min-w-20 sm:px-3">
              {saveState === "saving" ? <Loader2 size={14} className="animate-spin" /> : saveState === "saved" ? <Check size={14} /> : <Save size={14} />}
              <span className="hidden sm:inline">{saveState === "saving" ? t("saving") : saveState === "saved" ? t("saved") : t("save")}</span>
            </button>
          )}
        </div>
      </header>

      {(saveState === "error" ||
        saveState === "conflict" ||
        exportError ||
        refreshError) && (
        <div role="alert" className="flex shrink-0 items-center justify-between gap-4 border-b border-destructive/25 bg-destructive/5 px-5 py-2.5 text-xs text-destructive">
          <span>{saveError || exportError || refreshError}</span>
          {saveState === "conflict" && <button type="button" onClick={() => void load()} className="font-semibold hover:underline">{t("reload")}</button>}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {editing && outlineOpen && (
          <button
            type="button"
            aria-label={t("closeOutline")}
            onClick={() => setOutlineOpen(false)}
            className="absolute inset-0 z-30 bg-slate-950/20 xl:hidden"
          />
        )}
        {editing && outlineOpen && (
          <aside className="absolute inset-y-0 left-0 z-40 flex min-h-0 w-[min(280px,85vw)] shrink-0 flex-col border-r border-border bg-card shadow-xl xl:relative xl:inset-auto xl:z-auto xl:h-full xl:w-[232px] xl:shadow-none">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
              <h2 className="text-xs font-semibold">{t("pagesAndBlocks")}</h2>
              <button type="button" aria-label={t("addPage")} disabled={reportMutationDisabled} onClick={addPage} className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45">
                <Plus size={14} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-2">
              {orderedPages(report).map((page, pageIndex) => {
                const active = page.id === activePage.id;
                return (
                  <div key={page.id} className="mb-1">
                    <div className={cn("group flex items-center border-l-2 pr-2", active ? "border-primary bg-primary/[0.05]" : "border-transparent")}>
                      <button type="button" onClick={() => selectReportPage(page.id)} className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left">
                        <span className="text-[10px] tabular-nums text-muted-foreground">{String(pageIndex + 1).padStart(2, "0")}</span>
                        <span className="truncate text-xs font-medium">{page.title}</span>
                      </button>
                      {report.pages.length > 1 && (
                        <button type="button" aria-label={t("deletePage", { title: page.title })} disabled={reportMutationDisabled} onClick={() => deletePage(page.id)} className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground opacity-0 hover:text-destructive disabled:cursor-not-allowed group-hover:opacity-100 focus:opacity-100">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                    {active && (
                      <ol className="ml-8 border-l border-border py-1">
                        {page.blocks.map((block) => (
                          <li key={block.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedBlockId(block.id);
                                setPropertiesOpen(true);
                                if (window.matchMedia(REPORT_COMPACT_WORKSPACE_QUERY).matches) {
                                  setOutlineOpen(false);
                                }
                                document.querySelector(`[data-report-block=\"${block.id}\"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                              }}
                              className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px]", selectedBlockId === block.id ? "font-medium text-primary" : "text-muted-foreground hover:text-foreground")}
                            >
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60" />
                              <span className="truncate">{block.title || blockTypeLabel(block.block_type, blocksCopy)}</span>
                            </button>
                          </li>
                        ))}
                        {!page.blocks.length && <li className="px-3 py-2 text-[10px] text-muted-foreground">{t("noContent")}</li>}
                      </ol>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>
        )}

        <section ref={reportScrollRef} className={cn("min-w-0 flex-1 overflow-y-auto", editing ? "bg-background" : "bg-muted/30")}>
          {(visiblePages.length > 1 || editing) && (
            <ReportPageNavigator
              pages={visiblePages}
              activePageId={activePage.id}
              editing={editing}
              mutationDisabled={reportMutationDisabled}
              onSelectPage={selectReportPage}
              onAddPage={addPage}
            />
          )}
          <div
            className={cn(
              "report-document report-canvas mx-auto my-0 min-h-full px-5 pb-20 pt-8 md:px-8",
              editing
                ? "max-w-[1320px]"
                : "my-6 max-w-[1120px] border border-border/80 bg-card shadow-[0_20px_55px_-34px_rgba(15,45,35,0.38)] md:my-8 md:min-h-[calc(100%-4rem)] md:px-10"
            )}
          >
            <div className="mb-6 border-b border-border pb-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-t-[3px] border-double border-foreground/45 pt-4">
                <div className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                  <LayoutDashboard size={14} />
                  {activePage.title}
                </div>
                {!editing && (
                  <div className="font-mono text-[11px] tabular-nums tracking-[0.08em] text-muted-foreground">
                    {t("receiptLine", {
                      page: activePageNumber,
                      date: updatedDate(report.updated_at, locale),
                    })}
                  </div>
                )}
              </div>
              {!editing && <h2 className="mt-3 text-3xl font-semibold tracking-[-0.045em] md:text-4xl">{report.title}</h2>}
              {editing ? (
                <textarea
                  aria-label={t("reportDescription")}
                  value={report.description}
                  maxLength={4000}
                  disabled={reportMutationDisabled}
                  onChange={(event) => mutateReport((current) => ({ ...current, description: event.target.value }))}
                  placeholder={t("reportDescriptionPlaceholder")}
                  rows={2}
                  className="mt-3 w-full resize-none bg-transparent text-sm leading-6 text-muted-foreground outline-none placeholder:text-muted-foreground/65"
                />
              ) : report.description ? (
                <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{report.description}</p>
              ) : null}
              {activePageNarrative && (
                <p className="mt-4 max-w-4xl border-l-2 border-primary/55 pl-4 text-sm leading-6 text-foreground/80">
                  {activePageNarrative}
                </p>
              )}
            </div>

            {activePage.blocks.length === 0 && !activePageNarrative ? (
              <div className="flex min-h-[420px] flex-col items-center justify-center border border-dashed border-border bg-card/40 px-6 text-center">
                <FileText size={25} strokeWidth={1.5} className="text-primary" />
                <h3 className="mt-4 text-base font-semibold">{t("emptyPageTitle")}</h3>
                <p className="mt-2 max-w-md text-xs leading-5 text-muted-foreground">{t("emptyPageDescription")}</p>
                {editing && (
                  <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                    <button type="button" disabled={reportMutationDisabled} onClick={() => openInvestigation("smart")} className="inline-flex h-9 items-center gap-2 bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-45"><Sparkles size={14} />{t("generateDraft")}</button>
                    <button type="button" disabled={reportMutationDisabled} onClick={() => openInvestigation("manual")} className="inline-flex h-9 items-center gap-2 border border-border bg-card px-4 text-xs font-medium hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-45"><Check size={14} />{t("chooseInvestigationContent")}</button>
                    <button type="button" disabled={reportMutationDisabled} onClick={() => addBlock("text")} className="inline-flex h-9 items-center gap-2 px-3 text-xs font-medium text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"><Plus size={14} />{t("startWithText")}</button>
                  </div>
                )}
              </div>
            ) : (
              <div
                className={cn(
                  "report-layout-grid",
                  reportMutationDisabled && "pointer-events-none"
                )}
                aria-busy={reportMutationDisabled}
                data-editing={editing ? "true" : "false"}
              >
                {!!inheritedFilters.length && <div className="col-span-full flex flex-wrap items-start gap-5 border-b border-border pb-4">
                  {inheritedFilters.map(({ block, targets }) => <ReportFilterControl key={block.id} block={block}
                    value={filterValues[block.id] || ""} connectedCount={targets.length}
                    onChange={(value) => setFilter(block.id, value)} />)}
                </div>}
                {!!activeSelections.length && <div className="col-span-full flex flex-wrap items-center gap-2 pb-3" aria-label={tInteractions("active")}>
                  {activeSelections.map((selection) => {
                    const value = selectionLabel(selection.value, tInteractions("emptyValue"), tInteractions("blankValue"));
                    return <button key={selection.sourceKey} type="button"
                      aria-label={tInteractions("clear", { field: selection.rule.field, value })}
                      onClick={() => clearSelections(selection.pageId, selection.sourceKey)}
                      className="max-w-full truncate rounded border border-primary/25 bg-primary/5 px-2 py-1 text-xs text-primary">
                      {selection.source.title} · {selection.rule.field}：{value} ×
                    </button>;
                  })}
                  <button type="button" onClick={clearPageSelections} className="text-xs text-muted-foreground underline underline-offset-2">{tInteractions("clearAll")}</button>
                </div>}
                {reading.page?.blocks.map(({ block, selection, filterConnectedCount }) => {
                  return (
                  <div
                    key={block.id}
                    style={gridStyle(block)}
                    className="report-layout-block min-h-0"
                    data-block-type={block.block_type}
                  >
                    <ReportBlockCard
                      block={block}
                      editing={editing}
                      selected={selectedBlockId === block.id}
                      onSelect={() => {
                        setSelectedBlockId(block.id);
                        setPropertiesOpen(true);
                        if (window.matchMedia(REPORT_COMPACT_WORKSPACE_QUERY).matches) {
                          setOutlineOpen(false);
                        }
                      }}
                      onMove={(direction) => moveBlock(block.id, direction)}
                      onResize={(direction) => resizeBlock(block.id, direction)}
                      onDuplicate={() => duplicateBlock(block.id)}
                      onDelete={() => deleteBlock(block.id)}
                      onRefresh={() => void refreshBlock(activePage.id, block.id)}
                      refreshDisabled={dirty || reportMutationDisabled}
                      refreshing={refreshingBlockId === block.id}
                      interaction={selection ? { ...selection, onSelect: value => reading.select(block.id, value) } : undefined}
                      filterConnectedCount={filterConnectedCount}
                      filterValue={filterValues[block.id] || ""}
                      onFilterValueChange={(value) => setFilter(block.id, value)}
                    />
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {editing && propertiesOpen && (
          <button
            type="button"
            aria-label={t("closeBlockSettings")}
            onClick={() => setPropertiesOpen(false)}
            className="absolute inset-0 z-30 bg-slate-950/20 2xl:hidden"
          />
        )}
        {editing && propertiesOpen && (
          <div className="absolute inset-y-0 right-0 z-40 min-h-0 shadow-xl 2xl:relative 2xl:inset-auto 2xl:z-auto 2xl:h-full 2xl:shadow-none">
            <ReportPropertyPanel
              page={activePage}
              block={selectedBlock}
              disabled={reportMutationDisabled}
              onChangePage={changePage}
              onChangeBlock={changeBlock}
            />
          </div>
        )}
      </div>

      <InvestigationPicker
        open={investigationOpen}
        projectId={projectId}
        initialRunId={initialRunId}
        initialMode={investigationMode}
        currentReport={reportDraftContext}
        onClose={() => setInvestigationOpen(false)}
        onAdd={addImportedBlocks}
        onGenerateDraft={addGeneratedDraft}
      />
    </main>
    {printViewOpen && (
      <ReportPrintView report={report} filterValues={filterValues} selections={editing ? [] : reportSelections} />
    )}
    </>
  );
}
