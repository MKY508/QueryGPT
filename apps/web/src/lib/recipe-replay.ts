import { api } from "@/lib/api/client";
import type { ProjectDataSource } from "@/lib/types/api";
import type { ReplacementSnapshot } from "@/lib/source-replacement";

export type RecipeReplayRequest = { revision_id?: string };
export type RecipeReplayPreview = {
  source_id: string;
  recipe_id: string;
  revision_id: string;
  revision_number: number;
  proof: string;
  before: ReplacementSnapshot | null;
  after: ReplacementSnapshot;
  input_changed: boolean;
  pending_replacement: boolean;
  added_columns: string[];
  removed_columns: string[];
  type_changes: { column: string; previous_type: string; current_type: string }[];
  unresolved_questions: number;
  can_apply: boolean;
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
  return record(value) && count(value.rows) && count(value.columns)
    && Array.isArray(value.sample) && value.sample.length <= 8 && value.sample.every(record);
}
function path(projectId: string, recipeId: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/recipes/${encodeURIComponent(recipeId)}/replay`;
}

export async function previewRecipeReplay(
  projectId: string, sourceId: string, recipeId: string, request: RecipeReplayRequest, signal?: AbortSignal,
): Promise<RecipeReplayPreview> {
  const response = await api.post(`${path(projectId, recipeId)}/preview`, request, { signal, timeout: 120000 });
  const value: unknown = response.data?.data;
  if (!record(value) || value.source_id !== sourceId || value.recipe_id !== recipeId
    || typeof value.revision_id !== "string" || !value.revision_id || (request.revision_id && value.revision_id !== request.revision_id)
    || !count(value.revision_number) || value.revision_number < 1
    || typeof value.proof !== "string" || !/^[0-9a-f]{64}$/.test(value.proof)
    || (value.before !== null && !snapshot(value.before)) || !snapshot(value.after)
    || typeof value.input_changed !== "boolean" || typeof value.pending_replacement !== "boolean"
    || typeof value.can_apply !== "boolean" || !count(value.unresolved_questions)
    || !strings(value.added_columns) || !strings(value.removed_columns)
    || !Array.isArray(value.type_changes) || !value.type_changes.every((item) => record(item)
      && typeof item.column === "string" && typeof item.previous_type === "string" && typeof item.current_type === "string")) {
    throw new Error("Invalid recipe replay preview");
  }
  return value as RecipeReplayPreview;
}

export async function applyRecipeReplay(
  projectId: string, sourceId: string, recipeId: string, request: RecipeReplayRequest & { proof: string },
): Promise<ProjectDataSource> {
  const response = await api.post(`${path(projectId, recipeId)}/apply`, request, { timeout: 120000 });
  const value: unknown = response.data?.data;
  if (!record(value) || value.id !== sourceId || value.project_id !== projectId
    || !["ready", "needs_confirmation"].includes(String(value.status)) || !record(value.profile_data)) {
    throw new Error("Invalid recipe replay acknowledgement");
  }
  return value as unknown as ProjectDataSource;
}
