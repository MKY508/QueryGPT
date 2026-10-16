"use client";

import { ReportEditingControls } from "./ReportEditingControls";
import { InlineNotice } from "@/components/ui/InlineNotice";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ReportPageNavigator } from "./ReportPageNavigator";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Copy,
  Download,
  History,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  LayoutDashboard,
  Loader2,
  MoreHorizontal,
  PanelLeftClose,
  PanelRightClose,
  Plus,
  Printer,
  RefreshCw,
  Redo2,
  Search,
  Sparkles,
  Undo2,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import {
  exportReportExcel,
  getReport,
  refreshReportBlock,
  refreshReportPage,
  ReportConflictError,
  ReportSaveUnconfirmedError,
  isDefinitiveReportSaveError,
  ReportRefreshError,
  REPORT_REFRESH_ERROR_KEYS,
  type ReportSerializationCopy,
  updateReport,
  resolveReportSave,
  type ReportBlock,
  type ReportBlockType,
  type ReportDraftContext,
  type ReportDocument,
  type ReportPage,
  type ReportRefreshPlan,
} from "@/lib/reports";
import { ReportRefreshDialog } from "./ReportRefreshDialog";
import { ReportActionMenu } from "./ReportActionMenu";
import type { AnalysisArtifact, AnalysisHistoryItem } from "@/lib/types/api";
import { cn } from "@/lib/utils";
import { registerDesktopNavigationGuard } from "@/lib/desktop-app-info";
import { acknowledgeReportRecoverySave, reportRecoveryBase, removeReportRecoveryDraft, restoreReportRecoveryDraft, ReportRecoveryJournal, type ReportRecoveryDraft, type ReportRecoverySummary } from "@/lib/report-recovery";
import { historyNeedsSourceCopy, reconcileReportAfterSave, ReportEditHistory, resolveReportSelection } from "@/lib/report-edit-history";
import { reportHistoryField } from "@/lib/report-editor-fields";
import {
  canCopyReportImage, copyReportImage, renderReportImage, ReportImageError, reportImageFilename, waitForReportAssets,
} from "@/lib/report-image";
import type { ReportDraftPlan } from "@/lib/reports";
import { useProjectConversationId } from "@/lib/hooks/useProjectConversationId";
import { readReportLibraryView, writeReportLibraryView } from "@/lib/report-library";
import {
  InvestigationPicker,
  type InvestigationPickerMode,
} from "./InvestigationPicker";
import { ReportBlockCard, supportsReportBlockRefresh } from "./ReportBlockCard";
import { ReportPrintView } from "./ReportPrintView";
import { ReportPdfDialog } from "./ReportPdfDialog";
import { ReportRecoveryPanel } from "./ReportRecoveryPanel";
import { ReportVersionsDialog } from "./ReportVersionsDialog";
import { restoreReportVersion } from "@/lib/report-versions";
import { useReportRecoveryLibrary } from "./useReportRecoveryLibrary";
import { useReportPanels } from "./useReportPanels";
import { useReportKeyboard } from "./useReportKeyboard";
import { useReportReading } from "./useReportReading";
import { ReportOutline } from "./ReportOutline";
import { ReportFindDialog } from "./ReportFindDialog";
import { duplicateReportPage, moveReportBlock, moveReportPage, reorderReportPage } from "@/lib/report-page-editing";
import { ReportMoveBlockDialog } from "./ReportMoveBlockDialog";
import { ReportPropertyPanel } from "./ReportPropertyPanel";
import { ReportTextEditor } from "./ReportTextEditor";
import { isReportTextBlock } from "@/lib/report-text";
import { ReportConflictPanel } from "./ReportConflictPanel";
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
import type { ReportSelection } from "@/lib/report-interactions";
import { selectionLabel } from "./ReportSelectionControl";
import { configureReportFilter } from "@/lib/report-filter-connections";
import { ReportFilterControl } from "./ReportFilterControl";

type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";
type ExportKind = "pdf" | "excel" | "png" | "clipboard";
interface ExportSnapshot {
  report: ReportDocument;
  filters: Record<string, string>;
  selections: ReportSelection[];
  pageIds?: string[];
}
interface ImageSnapshot extends ExportSnapshot {
  pageId: string;
}


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

function gridStyle(block: ReportBlock): CSSProperties {
  return {
    "--report-column": `${block.layout.x + 1} / span ${block.layout.w}`,
    "--report-column-span": `span ${block.layout.w} / span ${block.layout.w}`,
    "--report-row": `${block.layout.y + 1} / span ${block.layout.h}`,
  } as CSSProperties;
}


export { reconcileReportAfterSave } from "@/lib/report-edit-history";

interface ReportWorkspaceProps {
  projectId: string;
  reportId: string;
  initialRunId?: string;
}

interface ConflictReview {
  comparisonOnly: boolean;
  id: symbol;
  base: ReportDocument;
  mine: ReportDocument;
  latest: ReportDocument | null;
  session: number;
  revision: number;
  controller: AbortController;
  journal: ReportRecoveryJournal;
  loading: boolean;
  failed: boolean;
  applying: boolean;
  applyFailed: boolean;
}

export function ReportWorkspace(props: ReportWorkspaceProps) {
  // A report owns its editing session. Responses and local UI state from the
  // previous report must never become the state of a newly opened report.
  return <ReportWorkspaceSession key={`${props.projectId}:${props.reportId}`} {...props} />;
}

function ReportWorkspaceSession({
  projectId,
  reportId,
  initialRunId,
}: ReportWorkspaceProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const t = useTranslations("reportWorkspace");
  const tDraft = useTranslations("reportDraft");
  const tRecovery = useTranslations("reportRecovery");
  const tBlocks = useTranslations("reportBlocks");
  const tInteractions = useTranslations("reportInteractions");
  const tFind = useTranslations("reportFind");
  const sourceConversationId = useProjectConversationId(projectId, searchParams.get("fromConversation"));
  const [report, setReport] = useState<ReportDocument | null>(null);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [movingBlockId, setMovingBlockId] = useState<string | null>(null);
  const [writingTarget, setWritingTarget] = useState<{ pageId: string; blockId: string; projectId: string; reportId: string } | null>(null);
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
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const findTarget = useRef<{ pageId: string; blockId: string | null; report: ReportDocument } | null>(null);
  const { outlineOpen, propertiesOpen, toggleOutline, toggleProperties,
    showOutline, showProperties, closeOutline: hideOutline, closeProperties: hideProperties } = useReportPanels();
  const outlineRef = useRef<HTMLElement>(null);
  const propertiesRef = useRef<HTMLDivElement>(null);
  const outlineTriggerRef = useRef<HTMLButtonElement>(null);
  const propertiesTriggerRef = useRef<HTMLButtonElement>(null);
  const closeOutline = () => {
    if (outlineRef.current?.contains(document.activeElement)) outlineTriggerRef.current?.focus();
    hideOutline();
  };
  const closeProperties = () => {
    if (propertiesRef.current?.contains(document.activeElement)) propertiesTriggerRef.current?.focus();
    hideProperties();
  };
  const [openMenu, setOpenMenu] = useState<"add" | "more" | "export" | null>(null);
  const pdfSelectionSerialRef = useRef(0);
  const [pdfSelection, setPdfSelection] = useState<{ key: string; projectId: string; reportId: string; pageIds: string[] } | null>(null);
  const changeMoreMenu = useCallback((open: boolean) => {
    setOpenMenu(current => open ? "more" : current === "more" ? null : current);
  }, []);
  const changeAddMenu = useCallback((open: boolean) => {
    setOpenMenu(current => open ? "add" : current === "add" ? null : current);
  }, []);
  const [investigationMode, setInvestigationMode] =
    useState<InvestigationPickerMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadRequested, setReloadRequested] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasConflict, setHasConflict] = useState(false);
  const conflictRef = useRef(false);
  const unconfirmedSaveRef = useRef(false);
  const [saveUnconfirmed, setSaveUnconfirmed] = useState(false);
  const pendingSaveRef = useRef<{
    id: string; original: ReportDocument; snapshot: ReportDocument; revision: number; copy: ReportSerializationCopy;
  } | null>(null);
  const [conflictReview, setConflictReview] = useState<ConflictReview | null>(null);
  const conflictReviewRef = useRef<ConflictReview | null>(null);
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const changeExportMenu = useCallback((open: boolean) => {
    setOpenMenu(current => open ? "export" : current === "export" ? null : current);
    if (open) setExportError(null);
  }, []);
  const [imageCopied, setImageCopied] = useState(false);
  const [imageCopySupported, setImageCopySupported] = useState(false);
  const [imageSnapshot, setImageSnapshot] = useState<ImageSnapshot | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<{ pageId: string; blockId?: string } | null>(null);
  const [refreshReview, setRefreshReview] = useState<{
    projectId: string; reportId: string; pageId: string; blockId?: string;
    expectedVersion: number; editRevision: number; session: number;
  } | null>(null);
  const [versionReview, setVersionReview] = useState<{
    projectId: string; reportId: string; version: number; session: number;
  } | null>(null);
  const versionReviewRef = useRef(false);
  const [printSnapshot, setPrintSnapshot] = useState<ExportSnapshot | null>(null);

  const [recoveryJournal] = useState(() => new ReportRecoveryJournal());
  const [history] = useState(() => new ReportEditHistory(createLocalId));
  const [historyState, setHistoryState] = useState({ undo: false, redo: false });
  const [historyCopy, setHistoryCopy] = useState<{ direction: "undo" | "redo"; target: ReportDocument } | null>(null);
  const composingRef = useRef(false);
  const historyCleanupRef = useRef<Promise<boolean> | null>(null);
  const syncHistory = useCallback(() => {
    setHistoryState({ undo: history.canUndo, redo: history.canRedo });
    setHistoryCopy(null);
  }, [history]);
  const recoveryLibrary = useReportRecoveryLibrary(projectId, reportId, recoveryJournal.id);
  const { items: recoveryDrafts, total: recoveryTotal, failed: recoveryReadFailed, reload: readRecoveryDrafts } = recoveryLibrary;
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState(false);
  const [recoveryWriteFailed, setRecoveryStorageFailed] = useState(false);
  const recoveryStorageFailed = recoveryWriteFailed || recoveryReadFailed;
  const recoveryBusyRef = useRef(false);
  const reportRef = useRef<ReportDocument | null>(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const sessionActiveRef = useRef(false);
  const loadRequestRef = useRef(0);
  const loadInFlightRef = useRef(false);
  const loadControllerRef = useRef<AbortController | null>(null);
  const reportScrollRef = useRef<HTMLElement | null>(null);
  const editRevisionRef = useRef(0);
  const closeDiscardRevisionRef = useRef(0);
  const closeDiscardTouchedRef = useRef(false);
  const closeDiscardApprovalRef = useRef<{ session: number; edit: number } | null>(null);
  const refreshInFlightRef = useRef(false);
  const exportInFlightRef = useRef(false);
  const imageSurfaceRef = useRef<HTMLDivElement | null>(null);
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
  // Translated defaults are content fallbacks for this opening, not a reason
  // to reload persisted data and overwrite a draft when the UI locale changes.
  const [openOptions] = useState(() => ({
    serializationCopy,
    overviewTitle: t("overviewPage"),
    initialRunId,
  }));
  const reportListParams = new URLSearchParams();
  if (initialRunId) reportListParams.set("fromRun", initialRunId);
  if (sourceConversationId) {
    reportListParams.set("fromConversation", sourceConversationId);
  }
  writeReportLibraryView(reportListParams, readReportLibraryView(searchParams));
  const reportListQuery = reportListParams.toString();
  const reportListHref = `/projects/${projectId}/reports${
    reportListQuery ? `?${reportListQuery}` : ""
  }`;

  const load = useCallback(async () => {
    if (savingRef.current || refreshInFlightRef.current || exportInFlightRef.current || recoveryBusyRef.current) return;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    const request = ++loadRequestRef.current;
    loadInFlightRef.current = true;
    const isCurrent = () => sessionActiveRef.current && request === loadRequestRef.current && !controller.signal.aborted;
    setLoading(true);
    setFindOpen(false);
    findTarget.current = null;
    setWritingTarget(null);
    setPdfSelection(null);
    setLoadError(false);
    setReloadRequested(false);
    // Draft discovery is independent of the API request, including an offline,
    // deleted, or still-loading saved report. Reviewing never reconstructs it.
    void readRecoveryDrafts();
    try {
      const next = await getReport(projectId, reportId, openOptions.serializationCopy, controller.signal);
      if (!isCurrent()) return;
      // A confirmed reload only discards this session after a fresh report was
      // obtained. If clearing its backup fails, retain the current editor too.
      if (!await recoveryJournal.clear()) throw new Error("Unable to discard the current draft");
      if (!isCurrent()) return;
      const pages = next.pages.length
        ? orderedPages(next)
        : [createReportPage(openOptions.overviewTitle, 0)];
      const normalized = { ...next, pages };
      reportRef.current = normalized;
      history.reset(normalized);
      conflictRef.current = false;
      unconfirmedSaveRef.current = false;
      pendingSaveRef.current = null;
      setSaveUnconfirmed(false);
      setHasConflict(false);
      syncHistory();
      editRevisionRef.current = 0;
      dirtyRef.current = false;
      setReport(normalized);
      setActivePageId(pages[0]?.id || null);
      setSelectedBlockId(null);
      setWritingTarget(null);
      setEditing(Boolean(openOptions.initialRunId) || totalBlocks(normalized) === 0);
      setInvestigationMode(openOptions.initialRunId ? "smart" : null);
      setDirty(false);
      setSaveState("idle");
      setSaveError(null);
      setExportError(null);
      setRefreshError(null);
      setRefreshing(null);
      setOpenMenu(null);
      resetReading();
      return true;
    } catch {
      if (isCurrent()) setLoadError(true);
      return false;
    } finally {
      if (isCurrent()) {
        loadInFlightRef.current = false;
        setLoading(false);
      }
    }
  }, [projectId, reportId, openOptions, recoveryJournal, readRecoveryDrafts, history, syncHistory, resetReading]);

  useLayoutEffect(() => {
    versionReviewRef.current = false;
    setVersionReview(null);
    sessionActiveRef.current = true;
    const unsubscribe = recoveryJournal.subscribe(setRecoveryStorageFailed);
    void load();
    return () => {
      sessionActiveRef.current = false;
      loadRequestRef.current += 1;
      loadControllerRef.current?.abort();
      conflictReviewRef.current?.controller.abort();
      conflictReviewRef.current = null;
      unsubscribe();
      void recoveryJournal.flush();
    };
  }, [load, recoveryJournal]);

  useEffect(() => {
    const flush = () => { void recoveryJournal.flush(); };
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [recoveryJournal]);

  useEffect(() => { setImageCopySupported(canCopyReportImage()); }, []);
  useEffect(() => {
    if (!imageCopied) return;
    const timer = window.setTimeout(() => setImageCopied(false), 3_000);
    return () => window.clearTimeout(timer);
  }, [imageCopied]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const approval = closeDiscardApprovalRef.current;
      closeDiscardApprovalRef.current = null;
      if (approval && approval.session === loadRequestRef.current && approval.edit === editRevisionRef.current
        && !savingRef.current && !refreshInFlightRef.current && !exportInFlightRef.current
        && !loadInFlightRef.current && !recoveryBusyRef.current && !historyCleanupRef.current) return;
      if (!dirtyRef.current && !savingRef.current && !refreshInFlightRef.current && !exportInFlightRef.current && !historyCleanupRef.current) return;
      void recoveryJournal.flush();
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [recoveryJournal]);

  const visiblePages = useMemo(() => (report ? orderedPages(report) : []), [report]);
  const activePageNumber = Math.max(
    1,
    visiblePages.findIndex((page) => page.id === activePage?.id) + 1
  );
  const reportMutationDisabled = Boolean(refreshing) || Boolean(refreshReview) || Boolean(versionReview) || recoveryBusy;
  useEffect(() => {
    if (findOpen || !findTarget.current) return;
    const target = findTarget.current;
    findTarget.current = null;
    // Dialog cleanup restores its opener first. Then this explicit navigation
    // owns focus, provided the report/page have not changed underneath it.
    if (!sessionActiveRef.current || reportRef.current !== target.report || activePageId !== target.pageId
      || document.querySelector('dialog[open], [aria-modal="true"]')) return;
    const node = target.blockId
      ? Array.from(reportScrollRef.current?.querySelectorAll<HTMLElement>("[data-report-block]") || []).find((item) => item.dataset.reportBlock === target.blockId)
      : reportScrollRef.current?.querySelector<HTMLElement>("[data-report-page-heading]");
    node?.focus({ preventScroll: true });
    node?.scrollIntoView?.({ block: target.blockId ? "center" : "start" });
  }, [findOpen, activePageId, report]);
  const pageHasRefreshableData = activePage?.blocks.some(supportsReportBlockRefresh) ?? false;
  const activePageNarrative =
    typeof activePage?.config.narrative === "string"
      ? activePage.config.narrative.trim()
      : "";
  const selectedBlock = useMemo(
    () => activePage?.blocks.find((block) => block.id === selectedBlockId) || null,
    [activePage, selectedBlockId]
  );
  const writingPage = editing && writingTarget?.projectId === projectId && writingTarget.reportId === reportId
    ? report?.pages.find(page => page.id === writingTarget.pageId) : undefined;
  const writingBlock = writingPage?.blocks.find(block => block.id === writingTarget?.blockId && isReportTextBlock(block));
  if (writingTarget && (!writingBlock || writingPage?.id !== activePage?.id || writingBlock.id !== selectedBlockId)) setWritingTarget(null);
  useLayoutEffect(() => {
    if (report) history.rememberSelection(report, { pageId: activePage?.id || null, blockId: selectedBlock?.id || null });
  }, [history, report, activePage, selectedBlock]);
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
  const mutateReport = useCallback((updater: (current: ReportDocument) => ReportDocument, typing = false) => {
    const current = reportRef.current;
    if (!current || !sessionActiveRef.current || loadInFlightRef.current || refreshInFlightRef.current || recoveryBusyRef.current || versionReviewRef.current) return;
    const next = updater(current);
    if (next === current) return;
    history.record(next, typing ? reportHistoryField(document.activeElement) : null, composingRef.current);
    syncHistory();
    // Commit synchronously at the event boundary. A queued save must see this
    // edit even before React renders, and render replay must not mutate refs.
    reportRef.current = next;
    dirtyRef.current = true;
    editRevisionRef.current += 1;
    recoveryJournal.checkpoint(next);
    setReport(next);
    setDirty(true);
    setSaveState((current) => (current === "saving" ? current : "idle"));
    setSaveError(null);
    setRefreshError(null);
    setReloadRequested(false);
    return next;
  }, [recoveryJournal, history, syncHistory]);

  const navigateHistory = useCallback((direction: "undo" | "redo", confirmed?: ReportDocument) => {
    if (versionReviewRef.current) return;
    if (!sessionActiveRef.current || !reportRef.current || loadInFlightRef.current || savingRef.current
      || refreshInFlightRef.current || exportInFlightRef.current || recoveryBusyRef.current || composingRef.current) return;
    const target = history.peek(direction);
    if (!target) return;
    if (confirmed && confirmed !== target) { setHistoryCopy(null); return; }
    if (!confirmed && historyNeedsSourceCopy(target)) { setHistoryCopy({ direction, target }); return; }
    const next = history.move(direction, !!confirmed);
    if (!next) return;
    const selection = history.selection || resolveReportSelection(next, { pageId: activePageId, blockId: selectedBlockId });
    const focused = document.activeElement;
    const focusCard = focused instanceof Element && !!focused.closest("[data-report-block]");
    reportRef.current = next;
    dirtyRef.current = history.dirty || Boolean(pendingSaveRef.current);
    editRevisionRef.current += 1;
    if (dirtyRef.current) recoveryJournal.checkpoint(next);
    else {
      const cleanup = recoveryJournal.clear();
      historyCleanupRef.current = cleanup;
      void cleanup.finally(() => { if (historyCleanupRef.current === cleanup) historyCleanupRef.current = null; });
    }
    setReport(next);
    setDirty(dirtyRef.current);
    setSaveState(dirtyRef.current ? "idle" : "saved");
    setSaveError(null);
    setRefreshError(null);
    setReloadRequested(false);
    setActivePageId(selection.pageId);
    setSelectedBlockId(selection.blockId);
    setOpenMenu(null);
    if (selection.pageId !== activePageId || selection.blockId !== selectedBlockId || focusCard) requestAnimationFrame(() => {
      // A later edit or navigation owns the focus; don't let an old frame steal it.
      if (reportRef.current !== next || history.selection?.blockId !== selection.blockId || history.selection?.pageId !== selection.pageId
        || document.querySelector('dialog[open], [aria-modal="true"]')) return;
      if (!selection.blockId) { reportScrollRef.current?.scrollTo?.({ top: 0 }); return; }
      const node = Array.from(reportScrollRef.current?.querySelectorAll<HTMLElement>("[data-report-block]") || [])
        .find((element) => element.dataset.reportBlock === selection.blockId);
      if (focusCard) node?.focus({ preventScroll: true });
      node?.scrollIntoView?.({ block: "center" });
    });
    syncHistory();
  }, [history, recoveryJournal, syncHistory, activePageId, selectedBlockId]);

  const restoreRecoveryDraft = useCallback(async (draft: ReportRecoveryDraft) => {
    const current = reportRef.current;
    if (!current || dirtyRef.current || recoveryBusyRef.current || savingRef.current || loadInFlightRef.current
      || refreshInFlightRef.current || exportInFlightRef.current) return;
    const baseline = reportRecoveryBase(draft, current);
    const restored = baseline && restoreReportRecoveryDraft(draft, baseline);
    if (!restored) { setRecoveryError(true); return; }
    recoveryBusyRef.current = true;
    setRecoveryBusy(true);
    setRecoveryError(false);
    try {
      if (!await recoveryJournal.adopt(draft, restored)) throw new Error("Draft changed");
      if (!sessionActiveRef.current) return;
      history.reset(baseline!);
      history.record(restored);
      const needsMerge = baseline!.version !== current.version;
      conflictRef.current = needsMerge;
      unconfirmedSaveRef.current = false;
      setHasConflict(needsMerge);
      setSaveUnconfirmed(false);
      syncHistory();
      reportRef.current = restored;
      dirtyRef.current = true;
      editRevisionRef.current += 1;
      setReport(restored);
      setDirty(true);
      setEditing(true);
      setActivePageId(restored.pages[0]?.id || null);
      setSelectedBlockId(null);
      resetReading();
      setSaveState("idle");
      setSaveError(null);
      setRecoveryOpen(false);
      await readRecoveryDrafts();
    } catch { if (sessionActiveRef.current) setRecoveryError(true); }
    finally { recoveryBusyRef.current = false; if (sessionActiveRef.current) setRecoveryBusy(false); }
  }, [recoveryJournal, readRecoveryDrafts, history, syncHistory, resetReading]);

  const resolveRecoverySave = useCallback(async (draft: ReportRecoveryDraft): Promise<"confirmed" | "unconfirmed" | "failed"> => {
    const current = reportRef.current;
    const pending = draft.pendingSave;
    if (!pending || !current || draft.projectId !== projectId || draft.reportId !== reportId
      || pending.snapshot.created_at !== current.created_at || dirtyRef.current || !sessionActiveRef.current || recoveryBusyRef.current
      || savingRef.current || loadInFlightRef.current || refreshInFlightRef.current || exportInFlightRef.current) return "failed";
    const session = loadRequestRef.current;
    const isCurrent = () => sessionActiveRef.current && session === loadRequestRef.current;
    recoveryBusyRef.current = true;
    setRecoveryBusy(true);
    setRecoveryError(false);
    try {
      // Resolve is a receipt lookup, not a retry: opening an old draft must not
      // send a previously undelivered write to the report.
      const saved = await resolveReportSave(projectId, reportId, {
        save_request_id: pending.requestId, title: pending.snapshot.title, description: pending.snapshot.description,
        status: pending.snapshot.status, expected_version: pending.snapshot.version, pages: pending.snapshot.pages,
      }, pending.copy);
      if (!isCurrent()) return "failed";
      if (!saved) return "unconfirmed";
      const latest = await getReport(projectId, reportId, serializationCopy);
      if (!isCurrent()) return "failed";
      if (latest.id !== current.id || latest.project_id !== current.project_id || latest.created_at !== current.created_at
        || latest.version < saved.version || !await acknowledgeReportRecoverySave(draft, saved)) return "failed";
      if (!isCurrent()) return "failed";
      reportRef.current = latest;
      history.reset(latest);
      syncHistory();
      setReport(latest);
      setActivePageId((id) => latest.pages.some((page) => page.id === id) ? id : latest.pages[0]?.id || null);
      setSelectedBlockId(null);
      await readRecoveryDrafts();
      return "confirmed";
    } catch { return "failed"; }
    finally { recoveryBusyRef.current = false; if (isCurrent()) setRecoveryBusy(false); }
  }, [projectId, reportId, serializationCopy, history, syncHistory, readRecoveryDrafts]);

  const removeRecoveryDraft = useCallback(async (draft: ReportRecoverySummary) => {
    if (recoveryBusyRef.current) return;
    recoveryBusyRef.current = true;
    setRecoveryBusy(true);
    setRecoveryError(false);
    try {
      if (!await removeReportRecoveryDraft(draft)) throw new Error("Draft changed");
      await readRecoveryDrafts();
    } catch { if (sessionActiveRef.current) setRecoveryError(true); }
    finally { recoveryBusyRef.current = false; if (sessionActiveRef.current) setRecoveryBusy(false); }
  }, [readRecoveryDrafts]);

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

      scrollReportToTop();
    },
    [scrollReportToTop]
  );

  const selectOutlineBlock = (pageId: string, blockId: string) => {
    setActivePageId(pageId);
    setSelectedBlockId(blockId);
    showProperties();
    requestAnimationFrame(() => {
      const node = Array.from(reportScrollRef.current?.querySelectorAll<HTMLElement>("[data-report-block]") || [])
        .find((element) => element.dataset.reportBlock === blockId);
      node?.scrollIntoView?.({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    });
  };

  const editPage = useCallback(
    (pageId: string, command: ReportPageCommand, typing = false) =>
      mutateReport(current => editReportDocument(current, pageId, command), typing),
    [mutateReport]
  );

  const changePage = (updates: Partial<ReportPage>) => {
    if (refreshInFlightRef.current || !activePage) return;
    editPage(activePage.id, { type: "update-page", updates }, true);
  };

  const changeBlockById = (pageId: string, blockId: string, updates: Partial<ReportBlock>) => {
    if (refreshInFlightRef.current) return;
    editPage(pageId, { type: "update-block", blockId, updates }, true);
  };
  const changeBlock = (updates: Partial<ReportBlock>) => {
    if (activePage && selectedBlock) changeBlockById(activePage.id, selectedBlock.id, updates);
  };
  const openTextEditor = (pageId: string, blockId: string) => {
    if (reportMutationDisabled || loadInFlightRef.current || refreshInFlightRef.current || exportInFlightRef.current) return;
    const block = reportRef.current?.pages.find(page => page.id === pageId)?.blocks.find(block => block.id === blockId);
    if (!block || !isReportTextBlock(block)) return;
    history.closeGroup();
    setActivePageId(pageId); setSelectedBlockId(blockId);

    setWritingTarget({ pageId, blockId, projectId, reportId });
  };

  const addBlock = (type: ReportBlockType) => {
    if (refreshInFlightRef.current || !activePage) return;
    const block = createManualBlock(type, blocksCopy);
    if (!editPage(activePage.id, { type: "append-blocks", blocks: [block] })) return;
    setSelectedBlockId(block.id);
    showProperties();
    setOpenMenu(null);
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
    showProperties();
  };

  const openInvestigation = (mode: InvestigationPickerMode) => {
    if (refreshInFlightRef.current) return;
    setInvestigationMode(mode);
    setOpenMenu(null);
  };

  const addGeneratedDraft = (
    run: AnalysisHistoryItem,
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
    showOutline();
    setExportError(null);
  };

  const rememberBlockAction = (blockId: string) => {
    const current = reportRef.current;
    if (current) history.rememberSelection(current, { pageId: activePageId, blockId });
  };

  const moveBlock = (blockId: string, direction: -1 | 1) => {
    if (refreshInFlightRef.current || !activePage) return;
    rememberBlockAction(blockId);
    editPage(activePage.id, { type: "move-block", blockId, direction });
  };

  const moveBlockToPage = (blockId: string, pageId: string) => {
    if (!editing || reportMutationDisabled) return;
    rememberBlockAction(blockId);
    const moved = mutateReport((current) => moveReportBlock(current, blockId, pageId));
    if (!moved) return;
    setMovingBlockId(null);
    setActivePageId(pageId);
    setSelectedBlockId(blockId);

    requestAnimationFrame(() => {
      const node = Array.from(reportScrollRef.current?.querySelectorAll<HTMLElement>("[data-report-block]") || [])
        .find((element) => element.dataset.reportBlock === blockId);
      node?.focus({ preventScroll: true });
      node?.scrollIntoView?.({ block: "center" });
    });
  };

  const resizeBlock = (blockId: string, direction: -1 | 1) => {
    if (refreshInFlightRef.current || !activePage) return;
    rememberBlockAction(blockId);
    editPage(activePage.id, { type: "resize-block", blockId, direction });
  };

  const duplicateBlock = (blockId: string) => {
    if (refreshInFlightRef.current || !activePage) return;
    const source = activePage.blocks.find(block => block.id === blockId);
    if (!source) return;
    rememberBlockAction(blockId);
    const duplicateId = createLocalId("block");
    if (editPage(activePage.id, {
      type: "duplicate-block", blockId, newBlockId: duplicateId,
      title: t("duplicateTitle", { title: source.title }),
      connectionKeys: { interaction_key: crypto.randomUUID(), filter_target_key: crypto.randomUUID() },
    })) setSelectedBlockId(duplicateId);
  };

  const deleteBlock = (blockId: string) => {
    if (refreshInFlightRef.current || !activePage) return;
    rememberBlockAction(blockId);
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
    history.rememberSelection(report, { pageId, blockId: pageId === activePageId ? selectedBlockId : null });
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

  const movePage = (pageId: string, direction: -1 | 1) => {
    mutateReport((current) => {
      const pages = moveReportPage(current.pages, pageId, direction);
      return pages === current.pages ? current : { ...current, pages };
    });
  };

  const reorderPage = (pageId: string, targetId: string, edge: "before" | "after") => {
    mutateReport((current) => {
      const pages = reorderReportPage(current.pages, pageId, targetId, edge);
      return pages === current.pages ? current : { ...current, pages };
    });
  };

  const duplicatePage = (pageId: string) => {
    const current = reportRef.current;
    const source = current?.pages.find((page) => page.id === pageId);
    if (!current || !source || reportMutationDisabled) return;
    const duplicate = duplicateReportPage(current, pageId, t("duplicateTitle", { title: source.title.slice(0, 145) }));
    if (duplicate && mutateReport((latest) => latest === current ? duplicate.document : latest)) selectReportPage(duplicate.page.id);
  };

  const save = useCallback(async (): Promise<boolean> => {
    if (versionReviewRef.current) return false;
    const currentReport = reportRef.current;
    if (
      !sessionActiveRef.current ||
      loadInFlightRef.current ||
      refreshInFlightRef.current ||
      !currentReport ||
      savingRef.current ||
      recoveryBusyRef.current
    ) {
      return false;
    }
    if (!dirtyRef.current && !pendingSaveRef.current) return true;
    if (conflictRef.current) return false;
    const sessionRequest = loadRequestRef.current;
    const isCurrent = () => sessionActiveRef.current && sessionRequest === loadRequestRef.current;
    const retry = Boolean(pendingSaveRef.current);
    const attempt = pendingSaveRef.current ?? {
      id: crypto.randomUUID(), original: currentReport, snapshot: structuredClone(currentReport),
      revision: editRevisionRef.current, copy: { ...serializationCopy },
    };
    pendingSaveRef.current = attempt;
    const sentRevision = attempt.revision;
    const sentSnapshot = attempt.snapshot;
    history.closeGroup();
    savingRef.current = true;
    setSaveState("saving");
    setSaveError(null);
    setRefreshError(null);
    try {
      // Best-effort restart recovery, with the existing visible storage warning
      // on failure. Storage quota must not prevent saving to the actual report.
      await recoveryJournal.beginSave({ schema: 1, requestId: attempt.id, snapshot: sentSnapshot, copy: attempt.copy }, reportRef.current || currentReport);
      if (!isCurrent()) return false;
      const saved = await updateReport(projectId, sentSnapshot.id, {
        save_request_id: attempt.id,
        retry_save: retry,
        title: sentSnapshot.title,
        description: sentSnapshot.description,
        status: sentSnapshot.status,
        expected_version: sentSnapshot.version,
        pages: sentSnapshot.pages,
      }, attempt.copy);
      if (!isCurrent()) return false;
      pendingSaveRef.current = null;
      recoveryJournal.settleSave(saved);
      const acknowledged = history.acknowledge(attempt.original, saved);
      syncHistory();
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
        setWritingTarget(current => current ? { ...current, pageId: identity.pageIds.get(current.pageId) || current.pageId,
          blockId: identity.blockIds.get(current.blockId) || current.blockId } : null);
        setPdfSelection(current => current ? { ...current, pageIds: current.pageIds.map(id => identity.pageIds.get(id) || id) } : null);
        dirtyRef.current = false;
        setDirty(false);
        setSaveState("saved");
        await recoveryJournal.clear();
        return isCurrent() && editRevisionRef.current === sentRevision;
      } else {
        const latest = reportRef.current || currentReport;
        const reconciled = { ...reconcileReportAfterSave(latest, sentSnapshot, saved), report: acknowledged };
        reportRef.current = reconciled.report;
        recoveryJournal.checkpoint(reconciled.report);
        setReport(reconciled.report);
        setActivePageId((current) =>
          current ? reconciled.pageIds.get(current) || current : current
        );
        setSelectedBlockId((current) =>
          current ? reconciled.blockIds.get(current) || current : current
        );
        remapReading(reconciled.pageIds, reconciled.blockIds);
        setWritingTarget(current => current ? { ...current, pageId: reconciled.pageIds.get(current.pageId) || current.pageId,
          blockId: reconciled.blockIds.get(current.blockId) || current.blockId } : null);
        setPdfSelection(current => current ? { ...current, pageIds: current.pageIds.map(id => reconciled.pageIds.get(id) || id) } : null);
        dirtyRef.current = true;
        setDirty(true);
        setSaveState("idle");
        return false;
      }
    } catch (error) {
      if (!isCurrent()) return false;
      if (isDefinitiveReportSaveError(error)) {
        pendingSaveRef.current = null;
        if (history.savedDocument) recoveryJournal.settleSave(history.savedDocument);
        if (reportRef.current) recoveryJournal.checkpoint(reportRef.current);
      }
      if (error instanceof ReportConflictError) {
        conflictRef.current = true;
        setHasConflict(true);
        unconfirmedSaveRef.current = error instanceof ReportSaveUnconfirmedError;
        setSaveUnconfirmed(unconfirmedSaveRef.current);
      }
      setSaveState(error instanceof ReportConflictError ? "conflict" : "error");
      setSaveError(errorMessage(error, t("saveError"), t("conflictError")));
      return false;
    } finally {
      savingRef.current = false;
    }
  }, [projectId, serializationCopy, t, recoveryJournal, history, syncHistory, remapReading]);

  const finishConflictReview = useCallback(() => {
    conflictReviewRef.current?.controller.abort();
    conflictReviewRef.current = null;
    setConflictReview(null);
    recoveryBusyRef.current = false;
    setRecoveryBusy(false);
  }, []);

  const readConflictLatest = useCallback(async (review: ConflictReview) => {
    try {
      const latest = await getReport(projectId, reportId, serializationCopy, review.controller.signal);
      if (!sessionActiveRef.current || conflictReviewRef.current?.controller !== review.controller || review.controller.signal.aborted) return;
      const next = { ...review, latest, loading: false, failed: false };
      conflictReviewRef.current = next;
      setConflictReview(next);
    } catch {
      if (!sessionActiveRef.current || conflictReviewRef.current?.controller !== review.controller || review.controller.signal.aborted) return;
      const next = { ...review, loading: false, failed: true };
      conflictReviewRef.current = next;
      setConflictReview(next);
    }
  }, [projectId, reportId, serializationCopy]);

  const openConflictReview = () => {
    const current = reportRef.current;
    const base = history.savedDocument;
    if (!current || !base || !conflictRef.current || !sessionActiveRef.current || recoveryBusyRef.current
      || savingRef.current || loadInFlightRef.current || refreshInFlightRef.current || exportInFlightRef.current
      || historyCleanupRef.current || composingRef.current) return;
    const review: ConflictReview = {
      comparisonOnly: unconfirmedSaveRef.current,
      id: Symbol(), base: structuredClone(base), mine: structuredClone(current), latest: null,
      session: loadRequestRef.current, revision: editRevisionRef.current, controller: new AbortController(),
      journal: new ReportRecoveryJournal(), loading: true, failed: false, applying: false, applyFailed: false,
    };
    recoveryBusyRef.current = true;
    setRecoveryBusy(true);
    conflictReviewRef.current = review;
    setConflictReview(review);
    setReloadRequested(false);
    void readConflictLatest(review);
  };

  const applyConflictReview = async (merged: ReportDocument) => {
    const review = conflictReviewRef.current;
    if (!review?.latest || review.loading || review.applying || review.comparisonOnly) return;
    const isCurrent = () => sessionActiveRef.current && conflictReviewRef.current?.id === review.id
      && loadRequestRef.current === review.session && editRevisionRef.current === review.revision;
    if (!isCurrent()) return;
    const applying = { ...review, applying: true, applyFailed: false };
    conflictReviewRef.current = applying;
    setConflictReview(applying);
    // Retain the pre-merge local document independently before replacing it.
    // The normal session checkpoint can then move to the merged/latest base.
    review.journal.settleSave(review.base);
    review.journal.checkpoint(review.mine);
    const preserved = await review.journal.flush();
    if (!isCurrent()) return;
    if (!preserved) {
      const failed = { ...review, applying: false, applyFailed: true };
      conflictReviewRef.current = failed;
      setConflictReview(failed);
      return;
    }
    history.reset(review.latest);
    history.record(merged);
    syncHistory();
    reportRef.current = merged;
    editRevisionRef.current += 1;
    dirtyRef.current = true;
    conflictRef.current = false;
    recoveryJournal.settleSave(review.latest);
    recoveryJournal.checkpoint(merged);
    setReport(merged);
    setDirty(true);
    setHasConflict(false);
    setSaveState("idle");
    setSaveError(null);
    setRefreshError(null);
    setEditing(true);
    setActivePageId((id) => merged.pages.some((page) => page.id === id) ? id : merged.pages[0]?.id || null);
    setSelectedBlockId(null);
    resetReading();
    finishConflictReview();
    void readRecoveryDrafts();
  };

  useLayoutEffect(() => registerDesktopNavigationGuard(async () => {
    if (!sessionActiveRef.current || loadInFlightRef.current || refreshInFlightRef.current || exportInFlightRef.current || savingRef.current || recoveryBusyRef.current || historyCleanupRef.current) return false;
    return dirtyRef.current ? save() : true;
  }, () => {
    if (!sessionActiveRef.current || loadInFlightRef.current || refreshInFlightRef.current || exportInFlightRef.current || savingRef.current || recoveryBusyRef.current || historyCleanupRef.current) return "busy";
    return dirtyRef.current ? "dirty" : "clean";
  }, async () => {
    if (!sessionActiveRef.current || recoveryBusyRef.current || savingRef.current || refreshInFlightRef.current || exportInFlightRef.current || loadInFlightRef.current) return false;
    recoveryBusyRef.current = true;
    const session = loadRequestRef.current;
    const edit = editRevisionRef.current;
    const operation = ++closeDiscardRevisionRef.current;
    closeDiscardTouchedRef.current = true;
    closeDiscardApprovalRef.current = null;
    try {
      if (!await recoveryJournal.clear() || !sessionActiveRef.current || session !== loadRequestRef.current
        || edit !== editRevisionRef.current || operation !== closeDiscardRevisionRef.current) return false;
      closeDiscardApprovalRef.current = { session, edit };
      return true;
    }
    finally { recoveryBusyRef.current = false; }
  }, () => {
    closeDiscardRevisionRef.current += 1;
    closeDiscardApprovalRef.current = null;
    if (!closeDiscardTouchedRef.current) return;
    closeDiscardTouchedRef.current = false;
    // A canceled/vetoed close leaves the live draft unsaved. Restore its
    // recovery checkpoint without saving or changing the report itself.
    if (sessionActiveRef.current && dirtyRef.current && reportRef.current) {
      const pending = pendingSaveRef.current;
      if (pending) {
        void recoveryJournal.beginSave({ schema: 1, requestId: pending.id, snapshot: pending.snapshot, copy: pending.copy }, reportRef.current);
      } else {
        if (history.savedDocument) recoveryJournal.settleSave(history.savedDocument);
        recoveryJournal.checkpoint(reportRef.current);
        void recoveryJournal.flush();
      }
    }
  }), [save, recoveryJournal, history]);

  const refreshData = useCallback(
    async (pageId: string, blockId?: string, approved?: ReportRefreshPlan) => {
      if (versionReviewRef.current) return;
      const currentReport = reportRef.current;
      if (approved && (!currentReport || dirtyRef.current || currentReport.id !== approved.report_id || projectId !== approved.project_id || pageId !== approved.page_id || (blockId ?? null) !== approved.block_id)) throw new ReportConflictError();
      if (!sessionActiveRef.current || loadInFlightRef.current || !currentReport || dirtyRef.current || savingRef.current || refreshInFlightRef.current || exportInFlightRef.current || recoveryBusyRef.current || historyCleanupRef.current || composingRef.current) return;
      const page = currentReport.pages.find((page) => page.id === pageId);
      if (!page) return;
      const block = blockId ? page.blocks.find((candidate) => candidate.id === blockId) : undefined;
      const expectedVersion = blockId ? block?.version : page.version;
      if (typeof expectedVersion !== "number" || (!blockId && !page.blocks.some(supportsReportBlockRefresh))) return;
      if (!approved) {
        setRefreshReview({ projectId, reportId: currentReport.id, pageId, blockId, expectedVersion, editRevision: editRevisionRef.current, session: loadRequestRef.current });
        return;
      }
      if (approved.expected_version !== expectedVersion) throw new ReportConflictError();

      const sentRevision = editRevisionRef.current;
      const sessionRequest = loadRequestRef.current;
      const isCurrent = () => sessionActiveRef.current && sessionRequest === loadRequestRef.current;
      refreshInFlightRef.current = true;
      setRefreshError(null);
      setRefreshing({ pageId, blockId });
      try {
        const refreshed = blockId ? await refreshReportBlock(
          projectId,
          currentReport.id,
          pageId,
          blockId,
          expectedVersion,
          serializationCopy,
          approved.source_plan,
        ) : await refreshReportPage(projectId, currentReport.id, pageId, expectedVersion, serializationCopy, approved.source_plan);
        if (!isCurrent()) return;
        if (editRevisionRef.current !== sentRevision) {
          setRefreshError(t("refreshError"));
          return;
        }
        reportRef.current = refreshed;
        history.reset(refreshed);
        recoveryJournal.settleSave(refreshed);
        conflictRef.current = false;
        unconfirmedSaveRef.current = false;
        pendingSaveRef.current = null;
        setSaveUnconfirmed(false);
        setHasConflict(false);
        syncHistory();
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
        setRefreshReview(null);
      } catch (error) {
        if (isCurrent()) {
          setRefreshError(t(error instanceof ReportRefreshError
            ? REPORT_REFRESH_ERROR_KEYS[error.code]
            : "refreshError"));
        }
        throw error;
      } finally {
        refreshInFlightRef.current = false;
        setRefreshing(null);
      }
    },
    [
      projectId,
      serializationCopy,
      t,
      history,
      recoveryJournal,
      syncHistory,
    ]
  );

  const beginExport = useCallback((kind: ExportKind): boolean => {
    if (versionReviewRef.current) return false;
    if (!sessionActiveRef.current || loadInFlightRef.current || savingRef.current || exportInFlightRef.current || refreshInFlightRef.current || recoveryBusyRef.current) return false;
    exportInFlightRef.current = true;
    setOpenMenu(null);
    setExportError(null);
    setImageCopied(false);
    setExporting(kind);
    return true;
  }, []);

  const finishExport = useCallback(() => {
    exportInFlightRef.current = false;
    setExporting(null);
  }, []);

  const handleExportPdf = useCallback(async (pageIds?: readonly string[]): Promise<boolean> => {
    const current = reportRef.current;
    if (!current) return false;
    if (pageIds && (!pageIds.length || pageIds.some(id => !current.pages.some(page => page.id === id)))) {
      setExportError(t("pdfPagesChanged"));
      return false;
    }
    if (!beginExport("pdf")) return false;
    const snapshot: ExportSnapshot = {
      report: structuredClone(current),
      filters: { ...filterValues },
      selections: editing ? [] : structuredClone(reportSelections),
      pageIds: pageIds ? [...new Set(pageIds)] : undefined,
    };
    try {
      if (!(await save())) {
        setExportError(t("saveBeforeExport"));
        return false;
      }
      flushSync(() => setPrintSnapshot(snapshot));
      const node = document.querySelector<HTMLElement>(".report-print-view");
      if (!node) throw new ReportImageError("image_unavailable");
      await waitForReportAssets(node);
      if (!sessionActiveRef.current) return false;
      window.print();
      // The print UI opened; this does not assert that the user saved a PDF.
      return true;
    } catch {
      setExportError(t("pdfExportError"));
      return false;
    } finally {
      setPrintSnapshot(null);
      finishExport();
    }
  }, [beginExport, editing, filterValues, finishExport, reportSelections, save, t]);

  const handleExportExcel = useCallback(async () => {
    if (!beginExport("excel")) return;
    try {
      if (!(await save())) {
        setExportError(t("saveBeforeExport"));
        return;
      }
      const currentReport = reportRef.current;
      if (!currentReport) return;
      const file = await exportReportExcel(projectId, currentReport.id);
      if (!sessionActiveRef.current) return;
      downloadBlob(
        file,
        exportFileName(currentReport.title, "xlsx", t("reportFileFallback"))
      );
    } catch {
      setExportError(t("excelExportError"));
    } finally {
      finishExport();
    }
  }, [beginExport, finishExport, projectId, save, t]);

  const handleExportImage = useCallback(async (kind: "png" | "clipboard") => {
    if (!activePage || !reportRef.current || !beginExport(kind)) return;
    // Freeze the selected page and its filter choices at the user's click.
    // Saving can remap temporary page/block IDs, so capture these together.
    const snapshot: ImageSnapshot = {
      report: structuredClone(reportRef.current),
      pageId: activePage.id,
      filters: { ...filterValues },
      selections: editing ? [] : structuredClone(reportSelections),
    };
    let saveFailed = false;
    const image = (async () => {
      if (!(await save())) {
        saveFailed = true;
        throw new Error("save_before_export");
      }
      flushSync(() => setImageSnapshot(snapshot));
      const node = imageSurfaceRef.current?.querySelector<HTMLElement>(".report-image-view");
      if (!node) throw new ReportImageError("image_unavailable");
      return renderReportImage(node);
    })();
    try {
      if (kind === "clipboard") {
        // Call before awaiting save/render so clipboard activation stays valid.
        await copyReportImage(image);
        setImageCopied(true);
      } else {
        const file = await image;
        if (!sessionActiveRef.current) return;
        downloadBlob(file, reportImageFilename(snapshot.report.title, activePage.title, t("reportFileFallback")));
      }
    } catch (error) {
      setExportError(saveFailed ? t("saveBeforeExport")
        : error instanceof ReportImageError && error.code === "too_large" ? t("imageExportTooLarge")
          : kind === "clipboard" ? t("imageCopyError") : t("imageExportError"));
    } finally {
      // A denied clipboard request may settle before rendering. Keep the capture
      // surface/lock until its promise settles, and consume any later rejection.
      await image.catch(() => undefined);
      setImageSnapshot(null);
      finishExport();
    }
  }, [activePage, beginExport, editing, filterValues, finishExport, reportSelections, save, t]);

  useReportKeyboard({ editing, blocked: Boolean(findOpen || recoveryOpen || investigationMode || historyCopy || conflictReview || movingBlockId || refreshReview || versionReview),
    composing: composingRef, onSave: () => { if (!exportInFlightRef.current) void save(); },
    onPrint: () => { void handleExportPdf(); }, onHistory: navigateHistory });

  const recoveryNotice = (recoveryTotal > 0 || recoveryStorageFailed) && <InlineNotice role="status" tone="neutral" className="mx-5 my-3 shrink-0" actions={<>
    {recoveryStorageFailed && <Button type="button" variant="ghost" size="sm" onClick={() => { void recoveryJournal.flush().then((ok) => { if (ok) void readRecoveryDrafts(); }); }}>{tRecovery("retry")}</Button>}
    {recoveryTotal > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => { setRecoveryError(false); setRecoveryOpen(true); void readRecoveryDrafts(); }}>{tRecovery("review")}</Button>}
  </>}>
    {recoveryStorageFailed ? tRecovery("storageFailed") : tRecovery("found", { count: recoveryTotal })}
  </InlineNotice>;
  const recoveryPanel = recoveryOpen && <ReportRecoveryPanel key="recovery" drafts={recoveryDrafts} report={loading || loadError ? null : report} dirty={dirty}
    total={recoveryTotal} hasMore={!!recoveryLibrary.next} loadingMore={recoveryLibrary.loading} listFailed={recoveryLibrary.failed}
    onLoadMore={() => void recoveryLibrary.loadMore()} onReload={() => void readRecoveryDrafts()}
    busy={recoveryBusy || saveState === "saving" || Boolean(refreshing) || Boolean(exporting)} error={recoveryError}
    onRestore={(draft) => void restoreRecoveryDraft(draft)} onResolveSave={resolveRecoverySave}
    onRemove={(draft) => void removeRecoveryDraft(draft)} onClose={() => setRecoveryOpen(false)} />;

  const refreshDialog = refreshReview && refreshReview.projectId === projectId && refreshReview.reportId === reportId && <ReportRefreshDialog key={`${projectId}:${reportId}:${refreshReview.pageId}:${refreshReview.blockId || "page"}`} {...refreshReview}
    onConfirm={async (plan) => {
      if (!sessionActiveRef.current || refreshReview.session !== loadRequestRef.current || refreshReview.editRevision !== editRevisionRef.current || savingRef.current || refreshInFlightRef.current || exportInFlightRef.current || recoveryBusyRef.current) throw new ReportConflictError();
      await refreshData(refreshReview.pageId, refreshReview.blockId, plan);
    }}
    onReload={async () => { if (dirtyRef.current || !await load()) throw new Error("Report reload did not finish"); setRefreshReview(null); }}
    onClose={() => setRefreshReview(null)} />;

  const versionsDialog = versionReview && versionReview.projectId === projectId && versionReview.reportId === reportId && <ReportVersionsDialog
    key={`${versionReview.projectId}:${versionReview.reportId}:${versionReview.session}`} projectId={projectId} reportId={reportId}
    currentVersion={versionReview.version} copy={openOptions.serializationCopy}
    onRestore={async (version) => {
      const isCurrent = () => sessionActiveRef.current && loadRequestRef.current === versionReview.session
        && reportRef.current?.id === versionReview.reportId && reportRef.current.project_id === versionReview.projectId;
      if (!isCurrent() || dirtyRef.current || savingRef.current || refreshInFlightRef.current || exportInFlightRef.current || recoveryBusyRef.current) throw new ReportConflictError();
      savingRef.current = true;
      setSaveState("saving");
      let ownsWrite = true;
      try {
        await restoreReportVersion(projectId, reportId, version, versionReview.version, openOptions.serializationCopy);
        if (!isCurrent()) throw new ReportConflictError();
        savingRef.current = false;
        ownsWrite = false;
        if (!await load()) throw new Error("Restored report could not be loaded");
      } finally {
        if (ownsWrite) savingRef.current = false;
        if (isCurrent()) setSaveState("idle");
      }
    }}
    onReload={async () => { if (dirtyRef.current || !await load()) throw new Error("Report reload did not finish"); }}
    onClose={() => { versionReviewRef.current = false; setVersionReview(null); }} />;

  if (loading) {
    return (
      <>{refreshDialog}{versionsDialog}{recoveryPanel}<main className="flex h-screen flex-col items-center justify-center gap-5 bg-background px-6 text-sm text-muted-foreground">
        <p className="flex items-center"><Loader2 size={18} className="mr-2 animate-spin" />{t("opening")}</p>
        {recoveryNotice}
      </main></>
    );
  }

  if (!report || !activePage) {
    return (
      <>{refreshDialog}{versionsDialog}{recoveryPanel}<main className="flex h-screen flex-col items-center justify-center bg-background px-6 text-center">
        <CircleAlert size={24} className="text-destructive" />
        <h1 className="mt-4 text-lg font-semibold">{t("notOpenTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{loadError ? t("loadError") : t("unavailable")}</p>
        <button type="button" onClick={() => void load()} className="mt-5 inline-flex h-9 items-center gap-2 bg-primary px-4 text-xs font-semibold text-primary-foreground">
          <RefreshCw size={14} />
          {t("reopen")}
        </button>
        <div className="mt-5">{recoveryNotice}</div>
      </main></>
    );
  }

  return (
    <>
    {findOpen && <ReportFindDialog report={report} query={findQuery} onQuery={setFindQuery} onClose={() => setFindOpen(false)}
      onSelect={({ pageId, blockId }) => {
        const current = reportRef.current;
        const page = current?.pages.find((item) => item.id === pageId);
        if (!current || !page || (blockId && !page.blocks.some((block) => block.id === blockId))
          || loadInFlightRef.current || refreshInFlightRef.current || exportInFlightRef.current || savingRef.current) return;
        findTarget.current = { pageId, blockId, report: current };
        setFindOpen(false); setActivePageId(pageId); setSelectedBlockId(blockId);
      }} />}
    {refreshDialog}
    {versionsDialog}
    {pdfSelection && pdfSelection.projectId === projectId && pdfSelection.reportId === reportId && <ReportPdfDialog key={pdfSelection.key}
      report={report} currentPageId={activePage.id} selectedIds={pdfSelection.pageIds} busy={Boolean(exporting)} error={exportError}
      onSelection={pageIds => {
        if (!exportInFlightRef.current) setPdfSelection(current => current?.key === pdfSelection.key ? { ...current, pageIds } : current);
      }}
      onExport={() => { void handleExportPdf(pdfSelection.pageIds).then(opened => {
        if (opened) setPdfSelection(current => current?.key === pdfSelection.key ? null : current);
      }); }}
      onClose={() => { if (!exportInFlightRef.current) setPdfSelection(null); }} />}
    {editing && movingBlockId && report.pages.some((page) => page.blocks.some((block) => block.id === movingBlockId)) &&
      <ReportMoveBlockDialog key={movingBlockId} report={report} blockId={movingBlockId} disabled={reportMutationDisabled}
        onMove={(pageId) => moveBlockToPage(movingBlockId, pageId)} onClose={() => setMovingBlockId(null)} />}
    {recoveryPanel}
    <main inert={findOpen} className="report-screen-view report-editor-shell flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground"
      data-editing={editing}
      onPointerDownCapture={() => history.closeGroup()} onBlurCapture={() => { history.closeGroup(); composingRef.current = false; }}
      onCompositionStartCapture={() => { history.closeGroup(); composingRef.current = true; }}
      onCompositionEndCapture={() => { composingRef.current = false; history.closeGroup(); }}>
      {writingBlock && writingPage && <ReportTextEditor block={writingBlock} pageTitle={writingPage.title}
        disabled={reportMutationDisabled || Boolean(exporting)} saving={saveState === "saving"}
        saveDisabled={!dirty || hasConflict || reportMutationDisabled || Boolean(exporting)}
        status={t(saveState === "saving" ? "saving" : dirty ? "unsavedChanges" : "saved")}
        error={hasConflict ? t(saveUnconfirmed ? "saveUnconfirmed" : "conflictError") : saveError}
        warning={recoveryStorageFailed ? tRecovery("storageFailed") : null}
        canUndo={historyState.undo && !reportMutationDisabled && saveState !== "saving" && !exporting}
        canRedo={historyState.redo && !reportMutationDisabled && saveState !== "saving" && !exporting}
        onUndo={() => navigateHistory("undo")} onRedo={() => navigateHistory("redo")}
        onChange={(updates) => changeBlockById(writingPage.id, writingBlock.id, updates)}
        onSave={() => void save()} onClose={() => { history.closeGroup(); composingRef.current = false; setWritingTarget(null); }} />}
      <header className="flex shrink-0 flex-col border-b border-border bg-card">
        <div className="flex h-[60px] min-w-0 items-center gap-2 px-5">
          <Link
            href={reportListHref}
            aria-label={t("backToReports")}
            onClick={(event) => {
              // Opening another tab does not leave this editing session.
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
              if (savingRef.current || refreshInFlightRef.current || exportInFlightRef.current || recoveryBusyRef.current) {
                event.preventDefault();
                return;
              }
              if (!dirtyRef.current) return;
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
            <Button variant="ghost" size="icon" aria-label={outlineOpen ? t("collapseOutline") : t("expandOutline")} ref={outlineTriggerRef} aria-expanded={outlineOpen} onClick={toggleOutline}>
              <PanelLeftClose size={16} className={!outlineOpen ? "rotate-180" : ""} />
            </Button>
          )}
          <div className="min-w-0">
            {editing ? (
              <input
                value={report.title}
                aria-label={t("reportTitle")}
                maxLength={200}
                disabled={reportMutationDisabled}
                data-report-history
                onChange={(event) => mutateReport((current) => current.title === event.target.value ? current : { ...current, title: event.target.value }, true)}
                className="h-8 w-80 min-w-20 truncate border-0 bg-transparent px-1 text-sm font-semibold outline-none focus:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
              />
            ) : (
              <h1 className="max-w-80 truncate text-sm font-semibold">{t("readerTitle")}</h1>
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

        <div className="report-toolbar relative flex min-h-12 min-w-0 shrink-0 items-center gap-1.5 border-t border-border/70 px-5 py-1.5">
          {editing && (
            <>
              <div className="flex items-center border-r border-border pr-1">
                <Button variant="ghost" size="icon" aria-label={t("undo")} title={t("undo")} aria-keyshortcuts="Control+Z Meta+Z"
                  disabled={!historyState.undo || reportMutationDisabled || saveState === "saving" || Boolean(exporting)} onClick={() => navigateHistory("undo")}
                  ><Undo2 size={15} /></Button>
                <Button variant="ghost" size="icon" aria-label={t("redo")} title={t("redo")} aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
                  disabled={!historyState.redo || reportMutationDisabled || saveState === "saving" || Boolean(exporting)} onClick={() => navigateHistory("redo")}
                  ><Redo2 size={15} /></Button>
              </div>
              <ReportActionMenu label={t("addContent")} text={t("addContent")} icon={<Plus size={15} />}
                open={openMenu === "add"} onOpenChange={changeAddMenu} disabled={reportMutationDisabled}
                actions={[
                  ...blockOptions.map(option => ({ id: option.type, label: option.label, title: option.description,
                    icon: <Plus size={14} />, disabled: reportMutationDisabled, onSelect: () => addBlock(option.type) })),
                  { id: "investigation", label: t("pickFromInvestigation"), title: t("pickFromInvestigationDescription"),
                    icon: <Check size={14} />, disabled: reportMutationDisabled, onSelect: () => openInvestigation("manual") },
                ]} />
              <Button variant="ghost" size="icon" aria-label={propertiesOpen ? t("collapseSettings") : t("expandSettings")} ref={propertiesTriggerRef} aria-expanded={propertiesOpen} onClick={toggleProperties}>
                <PanelRightClose size={16} className={!propertiesOpen ? "rotate-180" : ""} />
              </Button>
            </>
          )}

          <Button variant="ghost" size="icon" aria-label={tFind("title")} title={tFind("title")}
            disabled={reportMutationDisabled || loading || loadError || saveState === "saving" || Boolean(exporting)}
            onClick={() => {
              if (loadInFlightRef.current || refreshInFlightRef.current || exportInFlightRef.current || savingRef.current || recoveryBusyRef.current) return;
              history.closeGroup(); setOpenMenu(null);
               setFindOpen(true);
            }}><Search size={16} /></Button>

          <ReportActionMenu label={t("moreActions")} icon={<MoreHorizontal size={17} />}
            open={openMenu === "more"} onOpenChange={changeMoreMenu} actions={[
              ...(editing ? [{ id: "arrange", label: t("smartArrange"), icon: <Sparkles size={15} />,
                disabled: reportMutationDisabled, onSelect: () => openInvestigation("smart") }] : []),
              { id: "versions", label: t("versionHistory"), icon: <History size={15} />,
                disabled: reportMutationDisabled || dirty || saveState === "saving" || !!exporting || hasConflict || saveUnconfirmed,
                title: dirty ? t("saveBeforeVersionHistory") : undefined,
                onSelect: () => {
                  if (dirtyRef.current || savingRef.current || loadInFlightRef.current || refreshInFlightRef.current || exportInFlightRef.current || recoveryBusyRef.current || versionReviewRef.current) return;
                  history.closeGroup(); versionReviewRef.current = true;
                  setVersionReview({ projectId, reportId, version: report.version, session: loadRequestRef.current });
                } },
              ...(pageHasRefreshableData ? [{ id: "refresh", label: refreshing && !refreshing.blockId ? t("refreshingPage") : t("refreshPage"),
                icon: refreshing && !refreshing.blockId ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />,
                disabled: dirty || saveState === "saving" || Boolean(exporting) || reportMutationDisabled || typeof activePage.version !== "number",
                title: dirty ? t("saveBeforePageRefresh") : t("refreshPageDescription"),
                onSelect: () => void refreshData(activePage.id) }] : []),
            ]} />

          <ReportActionMenu label={t("exportReport")} text={imageCopied ? t("pageImageCopied") : t("export")}
            icon={exporting ? <Loader2 size={14} className="animate-spin" /> : imageCopied ? <Check size={14} /> : <Download size={14} />}
            open={openMenu === "export"} onOpenChange={changeExportMenu}
            disabled={Boolean(exporting) || saveState === "saving" || reportMutationDisabled}
            actions={[
              { id: "pdf", label: t("exportPdf"), icon: <Printer size={14} />, onSelect: () => { void handleExportPdf(); } },
              { id: "pdf-pages", label: t("exportPdfPages"), icon: <FileText size={14} />, onSelect: () => {
                if (loadInFlightRef.current || savingRef.current || exportInFlightRef.current || reportMutationDisabled) return;
                setExportError(null);
                setPdfSelection({ key: String(++pdfSelectionSerialRef.current), projectId, reportId, pageIds: [activePage.id] });
              } },
              { id: "excel", label: t(reportSelections.length || Object.values(filterValues).some(value => value.trim()) ? "exportExcelFull" : "exportExcel"),
                icon: <FileSpreadsheet size={14} />, onSelect: () => { void handleExportExcel(); } },
              { id: "png", label: t("exportPng"), icon: <ImageIcon size={14} />, onSelect: () => { void handleExportImage("png"); } },
              ...(imageCopySupported ? [{ id: "clipboard", label: t("copyPageImage"), icon: <Copy size={14} />,
                onSelect: () => { void handleExportImage("clipboard"); } }] : []),
            ]} />

          <span className="sr-only" role="status">{imageCopied ? t("pageImageCopied") : ""}</span>

          <ReportEditingControls editing={editing} onModeChange={next => {
            setEditing(next); setOpenMenu(null);
            if (next) clearSelections();
          }} canSave={dirty && !hasConflict && !reportMutationDisabled}
            status={saveState === "saving" ? "saving" : saveState === "saved" ? "saved" : "ready"}
            onSave={() => void save()} />
        </div>
      </header>

      {recoveryNotice}

      {conflictReview && <ReportConflictPanel key={String(conflictReview.session) + ":" + conflictReview.revision}
        base={conflictReview.base} mine={conflictReview.mine} latest={conflictReview.latest}
        comparisonOnly={conflictReview.comparisonOnly}
        loading={conflictReview.loading} applying={conflictReview.applying} failed={conflictReview.failed} applyFailed={conflictReview.applyFailed}
        onClose={() => { if (!conflictReviewRef.current?.applying) finishConflictReview(); }}
        onRetry={() => {
          const current = conflictReviewRef.current;
          if (!current || current.loading || current.applying) return;
          current.controller.abort();
          const next = { ...current, controller: new AbortController(), loading: true, failed: false };
          conflictReviewRef.current = next;
          setConflictReview(next);
          void readConflictLatest(next);
        }}
        onApply={(merged) => void applyConflictReview(merged)} />}

      {historyCopy && <InlineNotice tone="neutral" className="mx-5 my-3 shrink-0" actions={<>
        <Button variant="ghost" size="sm" onClick={() => setHistoryCopy(null)}>{t("historyCancel")}</Button>
        <Button variant="outline" size="sm" disabled={reportMutationDisabled || saveState === "saving" || Boolean(exporting)}
          onClick={() => navigateHistory(historyCopy.direction, historyCopy.target)}>{t("historyRestoreCopy")}</Button>
      </>}>{t("historySourceMissing")}</InlineNotice>}

      {(saveState === "error" ||
        hasConflict ||
        exportError ||
        refreshError || loadError) && (
        <InlineNotice className="mx-5 my-3 shrink-0" actions={(hasConflict || loadError || refreshError) && <>
              {hasConflict && !reloadRequested && <Button variant="outline" size="sm" disabled={reportMutationDisabled || saveState === "saving" || Boolean(exporting)} onClick={openConflictReview}>{t(saveUnconfirmed ? "compareSavedContent" : "compareChanges")}</Button>}
              {reloadRequested ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => setReloadRequested(false)}>{t("keepEditing")}</Button>
                  <Button variant="ghost" size="sm" onClick={() => void load()}>{t("discardAndReload")}</Button>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={() => dirtyRef.current ? setReloadRequested(true) : void load()}>{t("reload")}</Button>
              )}
            </>}>
          {reloadRequested ? t("reloadDiscardWarning") : loadError ? t("loadError") : hasConflict ? t(saveUnconfirmed ? "saveUnconfirmed" : "conflictError") : saveError || exportError || refreshError}
        </InlineNotice>
      )}

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {editing && (
          <div hidden={!outlineOpen} className="h-full shrink-0">
            <ReportOutline pages={report.pages} activePageId={activePage.id} selectedBlockId={selectedBlockId}
              containerRef={outlineRef}
              disabled={reportMutationDisabled} blockLabel={(type) => blockTypeLabel(type, blocksCopy)}
              onSelectPage={selectReportPage} onSelectBlock={selectOutlineBlock} onAddPage={addPage}
              onMovePage={movePage} onReorderPage={reorderPage} onDuplicatePage={duplicatePage} onDeletePage={deletePage} onClose={closeOutline} />
          </div>
        )}

        <section ref={reportScrollRef} className={cn("min-w-0 flex-1 overflow-y-auto", editing ? "bg-background" : "bg-muted/30")}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.defaultPrevented && activeSelections.length &&
              !(event.target instanceof Element && event.target.closest("input,select,textarea,[contenteditable=true],dialog,[role=dialog]"))) {
              event.preventDefault(); clearPageSelections();
            }
          }}>
          {(visiblePages.length > 1 || editing) && (
            <ReportPageNavigator
              pages={visiblePages}
              activePageId={activePage.id}
              editing={editing}
              mutationDisabled={reportMutationDisabled}
              onSelectPage={selectReportPage}
              onAddPage={outlineOpen ? undefined : addPage}
            />
          )}
          <div
            className={cn(
              "report-document report-canvas mx-auto my-0 min-h-full px-8 pb-20 pt-8",
              editing
                ? "max-w-[1320px]"
                : "my-8 min-h-[calc(100%-4rem)] px-10 max-w-[1120px] border border-border/80 bg-card shadow-[0_20px_55px_-34px_rgba(15,45,35,0.38)]"
            )}
          >
            <div data-report-page-heading={activePage.id} tabIndex={-1} aria-label={activePage.title}
              className="mb-6 border-b border-border pb-5 outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                  <LayoutDashboard size={14} />
                  {editing ? t("pagePosition", { current: activePageNumber, total: visiblePages.length }) : activePage.title}
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
              {editing && <h2 className="mt-4 text-3xl font-semibold tracking-tight">{activePage.title}</h2>}
              {!editing && <h2 className="mt-3 text-4xl font-semibold tracking-[-0.045em]">{report.title}</h2>}
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
                        showProperties();
                      }}
                      onEditText={!reportMutationDisabled ? () => openTextEditor(activePage.id, block.id) : undefined}
                      onMove={(direction) => moveBlock(block.id, direction)}
                      onMoveToPage={report.pages.length > 1 && !reportMutationDisabled ? () => setMovingBlockId(block.id) : undefined}
                      onResize={(direction) => resizeBlock(block.id, direction)}
                      onDuplicate={() => duplicateBlock(block.id)}
                      onDelete={() => deleteBlock(block.id)}
                      onRefresh={() => void refreshData(activePage.id, block.id)}
                      refreshDisabled={dirty || reportMutationDisabled}
                      refreshing={refreshing?.pageId === activePage.id && (!refreshing.blockId || refreshing.blockId === block.id)}
                      interaction={selection ? { ...selection, onSelect: value => reading.select(block.id, value) } : undefined}
                      filterValue={filterValues[block.id] || ""}
                      filterConnectedCount={filterConnectedCount}
                      onFilterValueChange={(value) => setFilter(block.id, value)}
                    />
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {editing && (
          <div ref={propertiesRef} hidden={!propertiesOpen} role="region"
            aria-label={t("blockSettingsPanel")} tabIndex={-1}
            className="h-full min-h-0 shrink-0"
            onKeyDown={(event) => {
              if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || composingRef.current) return;
              if (event.target instanceof Element && event.target.closest('dialog, [role="dialog"]')) return;
              event.preventDefault(); event.stopPropagation(); closeProperties();
            }}>
            <ReportPropertyPanel
              report={report}
              page={activePage}
              block={selectedBlock}
              disabled={reportMutationDisabled}
              onClose={closeProperties}
              onChangePage={changePage}
              onChangeBlock={changeBlock}
              onEditText={selectedBlock && isReportTextBlock(selectedBlock) ? () => openTextEditor(activePage.id, selectedBlock.id) : undefined}
              onChangeFilterConnection={(change) => {
                if (!selectedBlock) return;
                mutateReport((current) => configureReportFilter(current, selectedBlock.id, change));
                setFilter(selectedBlock.id, "");
              }}
            />
          </div>
        )}
      </div>

      {investigationMode && <InvestigationPicker
        open
        projectId={projectId}
        initialRunId={initialRunId}
        initialMode={investigationMode}
        currentReport={reportDraftContext}
        onClose={() => setInvestigationMode(null)}
        onAdd={addImportedBlocks}
        onGenerateDraft={addGeneratedDraft}
      />}
    </main>
    {printSnapshot && (
      <ReportPrintView report={printSnapshot.report} filterValues={printSnapshot.filters} selections={printSnapshot.selections} pageIds={printSnapshot.pageIds} />
    )}
    {imageSnapshot && (
      <div ref={imageSurfaceRef} aria-hidden="true">
        <ReportPrintView report={imageSnapshot.report} filterValues={imageSnapshot.filters} selections={imageSnapshot.selections} imagePageId={imageSnapshot.pageId} />
      </div>
    )}
    </>
  );
}
