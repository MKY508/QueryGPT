import { api } from "@/lib/api/client";
import type { CsvSelection } from "@/lib/csv-import";
import type { WorkbookSelection } from "@/lib/workbook";
import type { ProjectDataSource } from "@/lib/types/api";

export type ReplacementSelection = CsvSelection | WorkbookSelection;
export type ReplacementRequest = { candidate_source_id: string; selection?: ReplacementSelection };
export type ReplacementSnapshot = { rows: number; columns: number; sample: Record<string, unknown>[] };
export type ReplacementPreview = {
  source_id: string; candidate_source_id: string; proof: string;
  before: ReplacementSnapshot; after: ReplacementSnapshot;
  input_rows: number;
  added_columns: string[]; removed_columns: string[];
  type_changes: { column: string; previous_type: string; current_type: string }[];
  unresolved_questions: number; can_apply: boolean;
};

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function snapshot(value: unknown): value is ReplacementSnapshot {
  return record(value) && count(value.rows) && count(value.columns) && Array.isArray(value.sample)
    && value.sample.length <= 8 && value.sample.every(record);
}
function path(projectId: string, sourceId: string) {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}/replacement`;
}
export async function previewSourceReplacement(projectId: string, sourceId: string, request: ReplacementRequest, signal?: AbortSignal): Promise<ReplacementPreview> {
  const response = await api.post(`${path(projectId, sourceId)}/preview`, request, { signal, timeout: 120000 });
  const value: unknown = response.data?.data;
  if (!record(value) || value.source_id !== sourceId || value.candidate_source_id !== request.candidate_source_id
    || typeof value.proof !== "string" || !/^[0-9a-f]{64}$/.test(value.proof)
    || !snapshot(value.before) || !snapshot(value.after) || typeof value.can_apply !== "boolean"
    || !count(value.input_rows) || !count(value.unresolved_questions) || !strings(value.added_columns) || !strings(value.removed_columns)
    || !Array.isArray(value.type_changes) || !value.type_changes.every((item) => record(item)
      && typeof item.column === "string" && typeof item.previous_type === "string" && typeof item.current_type === "string")) {
    throw new Error("Invalid replacement preview");
  }
  return value as ReplacementPreview;
}
export async function applySourceReplacement(projectId: string, sourceId: string, request: ReplacementRequest & { proof: string }): Promise<ProjectDataSource> {
  const response = await api.post(`${path(projectId, sourceId)}/apply`, request, { timeout: 120000 });
  const value: unknown = response.data?.data;
  if (!record(value) || value.id !== request.candidate_source_id || value.project_id !== projectId
    || !record(value.profile_data) || value.profile_data.is_current !== true
    || !["ready", "needs_confirmation"].includes(String(value.status))) throw new Error("Invalid replacement acknowledgement");
  return value as unknown as ProjectDataSource;
}
