import { api } from "@/lib/api/client";
import type { AnalysisArtifact, AnalysisArtifactSummary, AnalysisHistoryPage } from "@/lib/types/api";
import { REPORT_LIBRARY_PAGE_SIZE, type ReportLibraryView } from "./report-library";

export type ReportStatus = "draft" | "published" | "archived";
export type ReportBlockType =
  | "metric"
  | "chart"
  | "table"
  | "text"
  | "evidence"
  | "filter";
export type ReportBlockSource = "manual" | "analysis_run" | "artifact";

export interface ReportBlockLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ReportBlock {
  id: string;
  /** Pending duplicate's trusted source; omitted after a save acknowledgement. */
  copy_source_block_id?: string;
  block_type: ReportBlockType;
  title: string;
  order_index: number;
  source_kind: ReportBlockSource;
  analysis_run_id?: string | null;
  artifact_id?: string | null;
  source_ref?: Record<string, unknown>;
  source_available?: boolean;
  content: Record<string, unknown>;
  layout: ReportBlockLayout;
  config: Record<string, unknown>;
  version?: number;
  created_at?: string;
  updated_at?: string;
}

export interface ReportPage {
  id: string;
  title: string;
  order_index: number;
  config: Record<string, unknown>;
  version?: number;
  created_at?: string;
  updated_at?: string;
  blocks: ReportBlock[];
}

export interface ReportDocument {
  deleted_at?: string | null;
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: ReportStatus;
  version: number;
  extra_data?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  pages: ReportPage[];
}

export interface ReportRefreshSourceLabel {
  source_id: string;
  name: string;
  kind: "file" | "connection";
  data_version: number | null;
}

export interface ReportRefreshPlan {
  project_id: string; report_id: string; page_id: string; block_id: string | null;
  expected_version: number; source_plan: string;
  blocks: { block_id: string; title: string; previous_source: ReportRefreshSourceLabel | null;
    refreshed_at: string | null; next_source: ReportRefreshSourceLabel }[];
}

export function readReportRefreshSource(value: unknown): ReportRefreshSourceLabel | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  return typeof source.source_id === "string" && typeof source.name === "string"
    && (source.kind === "file" || source.kind === "connection")
    && (source.data_version === null || (typeof source.data_version === "number" && Number.isSafeInteger(source.data_version) && source.data_version > 0))
    ? source as unknown as ReportRefreshSourceLabel : null;
}

export function isDefinitiveReportRefreshError(error: unknown): boolean {
  return error instanceof ReportRefreshError || isDefinitiveReportSaveError(error);
}

export interface ReportListItem {
  deleted_at?: string | null;
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: ReportStatus;
  version: number;
  page_count: number;
  block_count: number;
  created_at: string;
  updated_at: string;
}

export interface ReportCreateInput {
  title: string;
  description?: string;
  status?: ReportStatus;
  pages?: ReportPage[];
}

export interface ReportLibraryPage {
  items: ReportListItem[];
  total: number;
  count: number;
  page: number;
  page_size: number;
  page_count: number;
}

export interface ReportUpdateInput {
  save_request_id?: string;
  retry_save?: boolean;
  title: string;
  description: string;
  status: ReportStatus;
  expected_version: number;
  pages: ReportPage[];
}

export interface ReportSerializationCopy {
  unnamedBlock: string;
  textBlock: string;
  unnamedPage: string;
  unnamedReport: string;
}

export type ReportRequestErrorCode =
  | "list_reports_failed"
  | "create_report_failed"
  | "load_report_failed"
  | "save_report_failed"
  | "refresh_report_block_failed"
  | "refresh_report_page_failed"
  | "delete_report_failed"
  | "export_excel_failed"
  | "list_investigations_failed"
  | "load_investigation_failed"
  | "draft_report_failed";

export class ReportRequestError extends Error {
  readonly code: ReportRequestErrorCode;
  readonly detail?: string;

  constructor(code: ReportRequestErrorCode, detail?: string, readonly status?: number) {
    super(code);
    this.name = "ReportRequestError";
    this.code = code;
    this.detail = detail;
  }
}

export class ReportConflictError extends Error {
  constructor() {
    super("report_conflict");
    this.name = "ReportConflictError";
  }
}

export class ReportSaveUnconfirmedError extends ReportConflictError {
  constructor() { super(); this.name = "ReportSaveUnconfirmedError"; }
}

export function isDefinitiveReportSaveError(error: unknown): boolean {
  if (error instanceof ReportSaveUnconfirmedError) return false;
  return error instanceof ReportConflictError || (error instanceof ReportRequestError
    && typeof error.status === "number" && error.status >= 400 && error.status < 500
    && error.status !== 408 && error.status !== 429);
}

export const REPORT_REFRESH_ERROR_KEYS = {
  report_refresh_source_changed: "refreshSourceChanged",
  report_refresh_source_unavailable: "refreshSourceUnavailable",
  report_refresh_preparation_required: "refreshPreparationRequired",
  report_refresh_file_unavailable: "refreshFileUnavailable",
  report_refresh_no_targets: "refreshNoTargets",
  report_refresh_page_limit: "refreshPageLimit",
  report_refresh_timed_out: "refreshTimedOut",
  report_refresh_failed: "refreshRejected",
  report_refresh_metric_unavailable: "refreshMetricUnavailable",
} as const;

export class ReportRefreshError extends Error {
  constructor(readonly code: keyof typeof REPORT_REFRESH_ERROR_KEYS) {
    super(code);
    this.name = "ReportRefreshError";
  }
}

function responseData<T>(response: { data: unknown }): T {
  const body = response.data;
  if (
    typeof body === "object" &&
    body !== null &&
    "data" in body
  ) {
    return (body as { data: T }).data;
  }
  return body as T;
}

function normalizeError(
  error: unknown,
  code: ReportRequestErrorCode
): Error {
  const candidate = error as {
    response?: { status?: number; data?: { detail?: unknown; message?: string } };
    message?: string;
  };
  if (candidate.response?.status === 409) {
    const detail = candidate.response.data?.detail;
    if (code === "save_report_failed" && detail && typeof detail === "object" && "code" in detail) {
      if (detail.code === "report_save_unconfirmed") return new ReportSaveUnconfirmedError();
      if (detail.code === "report_save_key_reused") return new ReportRequestError(code, undefined, 409);
    }
    if (
      (code === "refresh_report_block_failed" || code === "refresh_report_page_failed") && detail &&
      typeof detail === "object" && "code" in detail
    ) {
      const refreshCode = detail.code;
      if (
        typeof refreshCode === "string" &&
        Object.hasOwn(REPORT_REFRESH_ERROR_KEYS, refreshCode)
      ) {
        return new ReportRefreshError(refreshCode as keyof typeof REPORT_REFRESH_ERROR_KEYS);
      }
    }
    return new ReportConflictError();
  }
  const detail = candidate.response?.data?.detail;
  const visibleDetail =
    typeof detail === "string" && detail.trim().toLowerCase() !== "not found"
      ? detail
      : undefined;
  const message =
    visibleDetail ||
    candidate.response?.data?.message ||
    candidate.message;
  return new ReportRequestError(
    code,
    typeof message === "string" && message.trim() ? message.trim() : undefined,
    candidate.response?.status
  );
}

function persistedId(id: string): string | undefined {
  return id.startsWith("local-") ? undefined : id;
}

function serializeBlock(
  block: ReportBlock,
  orderIndex: number,
  copy: ReportSerializationCopy
) {
  const copySource = !persistedId(block.id) && block.source_kind !== "manual" ? block.copy_source_block_id : undefined;
  return {
    ...(persistedId(block.id) ? { id: block.id } : {}),
    ...(copySource ? { copy_source_block_id: copySource } : {}),
    block_type: block.block_type,
    title: block.title.trim() || copy.unnamedBlock,
    order_index: orderIndex,
    source_kind: block.source_kind,
    analysis_run_id: copySource ? null : block.analysis_run_id || null,
    artifact_id: copySource ? null : block.artifact_id || null,
    ...(block.source_ref ? { source_ref: block.source_ref } : {}),
    content: block.content,
    layout: block.layout,
    config: block.config,
  };
}

function serializePage(page: ReportPage, copy: ReportSerializationCopy) {
  return {
    ...(persistedId(page.id) ? { id: page.id } : {}),
    title: page.title.trim() || copy.unnamedPage,
    order_index: page.order_index,
    config: page.config,
    blocks: page.blocks.map((block, index) => serializeBlock(block, index, copy)),
  };
}

export function normalizeDocument(
  document: ReportDocument,
  copy: ReportSerializationCopy
): ReportDocument {
  return {
    ...document,
    description: (document.description as string | null) || "",
    pages: [...(document.pages || [])]
      .sort((left, right) => left.order_index - right.order_index)
      .map((page) => ({
        ...page,
        blocks: [...(page.blocks || [])]
          .sort((left, right) => left.order_index - right.order_index)
          .map((block) => ({
            ...block,
            title:
              (block.title as string | null) ||
              (block.block_type === "text" ? copy.textBlock : copy.unnamedBlock),
            order_index: Number.isFinite(block.order_index) ? block.order_index : 0,
            content: block.content || {},
            config: block.config || {},
            layout: {
              x: Number(block.layout?.x) || 0,
              y: Number(block.layout?.y) || 0,
              w: Number(block.layout?.w) || 6,
              h: Number(block.layout?.h) || 3,
            },
          })),
      })),
  };
}

function normalizeSummary(summary: ReportListItem): ReportListItem {
  return {
    ...summary,
    description: (summary.description as string | null) || "",
  };
}

export async function listReports(projectId: string, signal?: AbortSignal): Promise<ReportListItem[]> {
  try {
    const response = await api.get(`/api/v1/projects/${projectId}/reports`, { signal });
    return responseData<ReportListItem[]>(response).map(normalizeSummary);
  } catch (error) {
    throw normalizeError(error, "list_reports_failed");
  }
}

export async function listReportLibrary(
  projectId: string, view: ReportLibraryView, signal?: AbortSignal
): Promise<ReportLibraryPage> {
  try {
    const response = await api.get(`/api/v1/projects/${projectId}/reports/library`, {
      signal,
      params: { q: view.search, sort: view.sort, status: view.status, page: view.page, page_size: REPORT_LIBRARY_PAGE_SIZE },
    });
    const data = responseData<ReportLibraryPage>(response);
    return { ...data, items: data.items.map(normalizeSummary) };
  } catch (error) {
    throw normalizeError(error, "list_reports_failed");
  }
}

export async function createReport(
  projectId: string,
  input: ReportCreateInput,
  copy: ReportSerializationCopy
): Promise<ReportDocument> {
  try {
    const response = await api.post(`/api/v1/projects/${projectId}/reports`, {
      title: input.title.trim() || copy.unnamedReport,
      description: input.description?.trim() || "",
      status: input.status || "draft",
      pages: input.pages?.map((page) => serializePage(page, copy)),
    });
    return normalizeDocument(responseData<ReportDocument>(response), copy);
  } catch (error) {
    throw normalizeError(error, "create_report_failed");
  }
}

export async function getReport(
  projectId: string,
  reportId: string,
  copy: ReportSerializationCopy,
  signal?: AbortSignal
): Promise<ReportDocument> {
  try {
    const response = await api.get(
      `/api/v1/projects/${projectId}/reports/${reportId}`,
      { signal }
    );
    return normalizeDocument(responseData<ReportDocument>(response), copy);
  } catch (error) {
    throw normalizeError(error, "load_report_failed");
  }
}

function reportUpdateBody(input: ReportUpdateInput, copy: ReportSerializationCopy) {
  return {
    ...(input.save_request_id ? { save_request_id: input.save_request_id, retry_save: input.retry_save ?? false } : {}),
    title: input.title.trim() || copy.unnamedReport,
    description: input.description.trim(),
    status: input.status,
    expected_version: input.expected_version,
    pages: input.pages.map((page) => serializePage(page, copy)),
  };
}

/** Read a retained acknowledgement without replaying the write if it is absent. */
export async function resolveReportSave(
  projectId: string, reportId: string, input: ReportUpdateInput, copy: ReportSerializationCopy,
): Promise<ReportDocument | null> {
  const response = await api.post(`/api/v1/projects/${projectId}/reports/${reportId}/save-receipts/resolve`, reportUpdateBody(input, copy));
  const document = responseData<ReportDocument | null>(response);
  return document === null ? null : normalizeDocument(document, copy);
}

export async function updateReport(
  projectId: string,
  reportId: string,
  input: ReportUpdateInput,
  copy: ReportSerializationCopy
): Promise<ReportDocument> {
  try {
    const response = await api.patch(
      `/api/v1/projects/${projectId}/reports/${reportId}`,
      reportUpdateBody(input, copy)
    );
    return normalizeDocument(responseData<ReportDocument>(response), copy);
  } catch (error) {
    throw normalizeError(error, "save_report_failed");
  }
}

export async function refreshReportBlock(
  projectId: string,
  reportId: string,
  pageId: string,
  blockId: string,
  expectedVersion: number,
  copy: ReportSerializationCopy,
  sourcePlan?: string,
): Promise<ReportDocument> {
  try {
    const response = await api.post(
      `/api/v1/projects/${projectId}/reports/${reportId}/pages/${pageId}/blocks/${blockId}/refresh`,
      { expected_version: expectedVersion, ...(sourcePlan ? { source_plan: sourcePlan } : {}) },
      { timeout: 150000 },
    );
    return normalizeDocument(responseData<ReportDocument>(response), copy);
  } catch (error) {
    throw normalizeError(error, "refresh_report_block_failed");
  }
}

export async function refreshReportPage(
  projectId: string,
  reportId: string,
  pageId: string,
  expectedVersion: number,
  copy: ReportSerializationCopy,
  sourcePlan?: string,
): Promise<ReportDocument> {
  try {
    const response = await api.post(
      `/api/v1/projects/${projectId}/reports/${reportId}/pages/${pageId}/refresh`,
      { expected_version: expectedVersion, ...(sourcePlan ? { source_plan: sourcePlan } : {}) },
      { timeout: 150000 }
    );
    return normalizeDocument(responseData<ReportDocument>(response), copy);
  } catch (error) {
    throw normalizeError(error, "refresh_report_page_failed");
  }
}

export async function inspectReportRefreshSources(
  projectId: string, reportId: string, pageId: string, expectedVersion: number,
  blockId?: string, signal?: AbortSignal,
): Promise<ReportRefreshPlan> {
  try {
    const suffix = blockId ? `/blocks/${blockId}` : "";
    const response = await api.post(`/api/v1/projects/${projectId}/reports/${reportId}/pages/${pageId}${suffix}/refresh-sources`,
      { expected_version: expectedVersion }, { signal });
    const value = responseData<ReportRefreshPlan>(response);
    if (!value || value.project_id !== projectId || value.report_id !== reportId || value.page_id !== pageId
      || value.block_id !== (blockId ?? null) || value.expected_version !== expectedVersion
      || typeof value.source_plan !== "string" || !/^[0-9a-f]{64}$/.test(value.source_plan)
      || !Array.isArray(value.blocks) || value.blocks.length < 1 || value.blocks.length > 50
      || value.blocks.some((block) => !block || typeof block.block_id !== "string" || typeof block.title !== "string"
        || !readReportRefreshSource(block.next_source) || (block.previous_source !== null && !readReportRefreshSource(block.previous_source))
        || (block.refreshed_at !== null && (typeof block.refreshed_at !== "string" || Number.isNaN(Date.parse(block.refreshed_at)))))
      || new Set(value.blocks.map((block) => block.block_id)).size !== value.blocks.length
      || (blockId && (value.blocks.length !== 1 || value.blocks[0].block_id !== blockId))) {
      throw new Error("Invalid report refresh source plan");
    }
    return value;
  } catch (error) {
    throw normalizeError(error, blockId ? "refresh_report_block_failed" : "refresh_report_page_failed");
  }
}

export async function deleteReport(
  projectId: string,
  reportId: string,
  expectedVersion: number,
): Promise<void> {
  try {
    const response = await api.delete(`/api/v1/projects/${projectId}/reports/${reportId}`, { params: { expected_version: expectedVersion } });
    const result = responseData<{ id: string; deleted: boolean }>(response);
    if (!result || result.id !== reportId || result.deleted !== true) throw new Error("Invalid deletion acknowledgement");
    // Moving to trash is recoverable: keep local drafts for later reconciliation.
  } catch (error) {
    throw normalizeError(error, "delete_report_failed");
  }
}

export async function exportReportExcel(
  projectId: string,
  reportId: string
): Promise<Blob> {
  try {
    const response = await api.get(
      `/api/v1/projects/${projectId}/reports/${reportId}/export.xlsx`,
      { responseType: "blob" }
    );
    return response.data instanceof Blob
      ? response.data
      : new Blob([response.data], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
  } catch (error) {
    throw normalizeError(error, "export_excel_failed");
  }
}

export async function listReportAnalysisRuns(
  projectId: string,
  view: { search: string; page: number; currentRunId?: string },
  signal?: AbortSignal
): Promise<AnalysisHistoryPage> {
  try {
    const response = await api.get(`/api/v1/projects/${projectId}/analysis-history`, {
      signal, params: { purpose: "report", status: "completed", q: view.search, page: view.page,
        page_size: 12, current_run_id: view.currentRunId },
    });
    return responseData<AnalysisHistoryPage>(response);
  } catch (error) {
    throw normalizeError(error, "list_investigations_failed");
  }
}

export async function listRunArtifacts(
  projectId: string,
  runId: string,
  signal?: AbortSignal
): Promise<AnalysisArtifact[]> {
  try {
    const response = await api.get(
      `/api/v1/projects/${projectId}/analysis-runs/${runId}/artifacts`,
      { signal }
    );
    return responseData<AnalysisArtifact[]>(response);
  } catch (error) {
    throw normalizeError(error, "load_investigation_failed");
  }
}

export class ReportArtifactChangedError extends Error {}

export async function listReportArtifactIndex(projectId: string, runId: string, signal?: AbortSignal): Promise<AnalysisArtifactSummary[]> {
  const response = await api.get(`/api/v1/projects/${projectId}/analysis-runs/${runId}/report-artifacts`, { signal });
  return responseData<AnalysisArtifactSummary[]>(response);
}

export async function readReportArtifact(summary: AnalysisArtifactSummary, signal?: AbortSignal): Promise<AnalysisArtifact> {
  try {
    const response = await api.get(`/api/v1/projects/${summary.project_id}/analysis-runs/${summary.analysis_run_id}/report-artifacts/${summary.id}`, {
      signal, params: { expected_updated_at: summary.updated_at },
    });
    const item = responseData<AnalysisArtifact>(response);
    if (item.id !== summary.id || item.project_id !== summary.project_id || item.analysis_run_id !== summary.analysis_run_id ||
        item.updated_at !== summary.updated_at || item.kind !== summary.kind || item.title !== summary.title) {
      throw new ReportArtifactChangedError("artifact_changed");
    }
    return item;
  } catch (error) {
    if ((error as { response?: { status?: number } })?.response?.status === 409) throw new ReportArtifactChangedError("artifact_changed");
    throw error;
  }
}

export interface ReportDraftPlan {
  title: string;
  description: string;
  overview_text: string | null;
  sections?: ReportDraftSection[];
  selected_overview: string[];
  selected_detail: string[];
  selected_evidence: string[];
  highlights: Record<string, string>;
  generated_by: "ai" | "fallback";
}

export interface ReportDraftSection {
  role: "overview" | "detail" | "evidence";
  title: string;
  purpose: string;
  narrative: string | null;
  artifact_ids: string[];
}

export interface ReportDraftContext {
  title: string;
  description: string;
  has_user_edits: boolean;
  existing_artifact_ids: string[];
  pages: string[];
}

export class ReportDraftUnavailableError extends Error {
  readonly detail?: string;

  constructor(detail?: string) {
    super("report_draft_unavailable");
    this.name = "ReportDraftUnavailableError";
    this.detail = detail;
  }
}

export async function requestReportDraftPlan(
  projectId: string,
  runId: string,
  language: "zh" | "en",
  currentReport?: ReportDraftContext,
  signal?: AbortSignal
): Promise<ReportDraftPlan> {
  try {
    const response = await api.post(
      `/api/v1/projects/${projectId}/reports/draft-from-analysis`,
      {
        analysis_run_id: runId,
        language,
        ...(currentReport ? { current_report: currentReport } : {}),
      },
      { signal }
    );
    return responseData<ReportDraftPlan>(response);
  } catch (error) {
    const candidate = error as {
      response?: { status?: number; data?: { detail?: string; message?: string } };
      message?: string;
    };
    if (
      candidate.response?.status === 503 ||
      candidate.response?.status === 404 ||
      candidate.response?.status === 502
    ) {
      throw new ReportDraftUnavailableError(candidate.response?.data?.detail);
    }
    throw normalizeError(error, "draft_report_failed");
  }
}
