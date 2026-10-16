import { api } from "@/lib/api/client";

export interface ReportCopyRequest { request_id: string; expected_version: number; title: string }
export interface ReportCopyResult { request_id: string; project_id: string; source_report_id: string; source_version: number; report_id: string }
export class ReportCopyError extends Error {
  constructor(readonly kind: "changed" | "unavailable" | "failed") { super(kind); this.name = "ReportCopyError"; }
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

function response(response: unknown, project: string, source: string, request: ReportCopyRequest, nullable: boolean): ReportCopyResult | null {
  const value = record(response) && record(response.data) ? response.data.data : undefined;
  if (value === null && nullable) return null;
  if (!record(value) || value.project_id !== project || value.source_report_id !== source
    || value.request_id !== request.request_id || value.source_version !== request.expected_version
    || !uuid(value.report_id) || value.report_id === source) throw new Error("Invalid report copy acknowledgement");
  return value as unknown as ReportCopyResult;
}
function normalizeError(error: unknown, resolving = false): never {
  if (record(error) && record(error.response)) {
    const status = Number(error.response.status);
    const data = error.response.data;
    if (record(data) && record(data.detail) && data.detail.code === "report_copy_unavailable") throw new ReportCopyError("unavailable");
    // A rejected read cannot prove whether the earlier write was committed.
    if (resolving) throw error;
    if (status === 404 || status === 409) throw new ReportCopyError("changed");
    if ([400, 401, 403, 413, 422].includes(status)) throw new ReportCopyError("failed");
  }
  throw error;
}
export async function copyReport(project: string, source: string, request: ReportCopyRequest): Promise<ReportCopyResult> {
  try {
    return response(await api.post(`/api/v1/projects/${project}/reports/${source}/copies`, request, { timeout: 150000 }), project, source, request, false)!;
  } catch (error) { return normalizeError(error); }
}
export async function resolveReportCopy(project: string, source: string, request: ReportCopyRequest, signal?: AbortSignal): Promise<ReportCopyResult | null> {
  try {
    return response(await api.post(`/api/v1/projects/${project}/reports/${source}/copies/resolve`, request, { signal, timeout: 20000 }), project, source, request, true);
  } catch (error) { return normalizeError(error, true); }
}

/** Title limits count Unicode code points, like the API, never half a surrogate. */
export function reportCopyTitle(title: string, suffix: string): string {
  return [...title].slice(0, Math.max(0, 200 - [...suffix].length)).join("") + suffix;
}
