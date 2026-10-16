import { api } from "@/lib/api/client";
import { removeRecoveryDraftsForReport } from "./report-recovery";
import { readReportSnapshot } from "./report-versions";
import { ReportConflictError, type ReportDocument, type ReportLibraryPage, type ReportSerializationCopy } from "./reports";

const base = (project: string) => `/api/v1/projects/${project}/report-trash`;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, min = 1): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min;
const date = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
function unwrap(response: unknown): unknown {
  if (!record(response) || !record(response.data)) throw new Error("Invalid trash response");
  return response.data.data;
}
function conflict(error: unknown): never {
  if (record(error) && record(error.response) && [404, 409].includes(Number(error.response.status))) throw new ReportConflictError();
  throw error;
}

export async function listReportTrash(project: string, page = 1, search = "", signal?: AbortSignal): Promise<ReportLibraryPage> {
  const value = unwrap(await api.get(base(project), { params: { page, q: search }, signal, timeout: 20000 }));
  if (!record(value) || !Array.isArray(value.items) || value.items.length > 24 || value.page_size !== 24
    || !integer(value.page) || !integer(value.page_count) || value.page > value.page_count || value.page > page
    || !integer(value.total, 0) || !integer(value.count, 0) || value.count > value.total
    || value.page_count !== Math.max(1, Math.ceil(value.count / 24))
    || value.items.length !== Math.min(24, Math.max(0, value.count - (value.page - 1) * 24))) throw new Error("Invalid trash directory");
  const ids = new Set<string>();
  for (const item of value.items) {
    if (!record(item) || typeof item.id !== "string" || ids.has(item.id) || item.project_id !== project
      || typeof item.title !== "string" || !integer(item.version) || !date(item.deleted_at)
      || !integer(item.page_count, 0) || !integer(item.block_count, 0)) throw new Error("Invalid trash item");
    ids.add(item.id);
  }
  return value as unknown as ReportLibraryPage;
}

export async function previewTrashedReport(project: string, report: string, version: number, copy: ReportSerializationCopy, signal?: AbortSignal): Promise<ReportDocument> {
  try {
    const value = unwrap(await api.get(`${base(project)}/${report}`, { signal, timeout: 30000 }));
    if (!record(value) || !date(value.deleted_at)) throw new Error("Invalid trashed document");
    if (value.version !== version) throw new ReportConflictError();
    return readReportSnapshot(value, project, report, version, copy);
  } catch (error) { return conflict(error); }
}

export async function restoreTrashedReport(project: string, report: string, version: number, copy: ReportSerializationCopy): Promise<ReportDocument> {
  try {
    const value = unwrap(await api.post(`${base(project)}/${report}/restore`, { expected_version: version }, { timeout: 150000 }));
    if (!record(value) || value.deleted_at !== null) throw new Error("Invalid restored document");
    return readReportSnapshot(value, project, report, version + 1, copy);
  } catch (error) { return conflict(error); }
}

export async function permanentlyDeleteReport(project: string, report: string, version: number): Promise<void> {
  try {
    const value = unwrap(await api.delete(`${base(project)}/${report}`, { params: { expected_version: version }, timeout: 30000 }));
    if (!record(value) || value.id !== report || value.deleted !== true) throw new Error("Invalid permanent deletion acknowledgement");
  } catch (error) { return conflict(error); }
  // Only a matching confirmed permanent deletion may erase local recovery drafts.
  // A storage error after that acknowledgement cannot turn into an API retry.
  await removeRecoveryDraftsForReport(project, report).catch(() => undefined);
}
