import { api } from "@/lib/api/client";
import { normalizeDocument, ReportConflictError, type ReportDocument, type ReportSerializationCopy } from "./reports";

export interface ReportVersionItem {
  version: number; title: string; saved_at: string; reason: string; page_count: number; block_count: number;
}
export interface ReportVersionPage { report_id: string; current_version: number; items: ReportVersionItem[]; next_before: number | null }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const base = (project: string, report: string) => `/api/v1/projects/${project}/reports/${report}/revisions`;
function unwrap(response: unknown): unknown {
  if (!record(response) || !record(response.data)) throw new Error("Invalid history response");
  return response.data.data;
}

export async function listReportVersions(project: string, report: string, before?: number, signal?: AbortSignal): Promise<ReportVersionPage> {
  const value = unwrap(await api.get(base(project, report), { params: { limit: 20, ...(before ? { before } : {}) }, signal, timeout: 20000 }));
  if (!record(value) || value.report_id !== report || !positive(value.current_version) || !Array.isArray(value.items) || value.items.length > 20) throw new Error("Invalid history directory");
  let previous = before ?? value.current_version + 1;
  for (const item of value.items) {
    if (!record(item) || !positive(item.version) || item.version >= previous || item.version > value.current_version
      || typeof item.title !== "string" || typeof item.reason !== "string" || typeof item.saved_at !== "string" || !Number.isFinite(Date.parse(item.saved_at))
      || !Number.isSafeInteger(item.page_count) || Number(item.page_count) < 0 || !Number.isSafeInteger(item.block_count) || Number(item.block_count) < 0) throw new Error("Invalid history item");
    previous = item.version;
  }
  if (value.next_before !== null && (!value.items.length || value.next_before !== previous)) throw new Error("Invalid history cursor");
  return value as unknown as ReportVersionPage;
}

export function readReportSnapshot(value: unknown, project: string, report: string, version: number, copy: ReportSerializationCopy): ReportDocument {
  if (!record(value) || value.id !== report || value.project_id !== project || value.version !== version || !Array.isArray(value.pages)
    || typeof value.title !== "string" || !["draft", "published", "archived"].includes(String(value.status))
    || typeof value.created_at !== "string" || !Number.isFinite(Date.parse(value.created_at))
    || typeof value.updated_at !== "string" || !Number.isFinite(Date.parse(value.updated_at))) throw new Error("Invalid history document");
  const ids = new Set<string>();
  for (const page of value.pages) {
    if (!record(page) || typeof page.id !== "string" || ids.has(page.id) || typeof page.title !== "string" || !Array.isArray(page.blocks) || !record(page.config)) throw new Error("Invalid history page");
    ids.add(page.id);
    for (const block of page.blocks) {
      if (!record(block) || typeof block.id !== "string" || ids.has(block.id)
        || !["text", "metric", "chart", "table", "filter", "evidence"].includes(String(block.block_type))
        || !["manual", "artifact", "analysis_run"].includes(String(block.source_kind))
        || !record(block.content) || !record(block.config) || !record(block.layout)) throw new Error("Invalid history block");
      ids.add(block.id);
    }
  }
  return normalizeDocument(value as unknown as ReportDocument, copy);
}

export async function getReportVersion(project: string, report: string, version: number, copy: ReportSerializationCopy, signal?: AbortSignal): Promise<ReportDocument> {
  return readReportSnapshot(unwrap(await api.get(`${base(project, report)}/${version}`, { signal, timeout: 30000 })), project, report, version, copy);
}

export async function restoreReportVersion(project: string, report: string, version: number, expected: number, copy: ReportSerializationCopy): Promise<ReportDocument> {
  try {
    return readReportSnapshot(unwrap(await api.post(`${base(project, report)}/${version}/restore`, { expected_version: expected }, { timeout: 150000 })), project, report, expected + 1, copy);
  } catch (error) {
    if (record(error) && record(error.response) && error.response.status === 409) throw new ReportConflictError();
    throw error;
  }
}
