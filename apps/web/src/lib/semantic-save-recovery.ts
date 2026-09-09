import { api } from "@/lib/api/client";
import type { SemanticEntry } from "@/lib/types/api";

export interface SemanticSaveTarget {
  projectId: string; key: string; entryId?: string; expectedHead?: string | null; previousVersion?: number;
  content?: { value: string; entryType: SemanticEntry["entry_type"]; state: SemanticEntry["state"]; businessName: string };
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;

export function inspectSemanticSaveEntry(value: unknown, target: SemanticSaveTarget, receipt = false): SemanticEntry {
  if (!record(value) || !text(value.id) || value.project_id !== target.projectId || value.key !== target.key
    || (target.entryId && value.id !== target.entryId) || !text(value.active_revision_id)
    || !Number.isSafeInteger(value.revision_number) || Number(value.revision_number) < 1
    || typeof value.value !== "string" || typeof value.is_active !== "boolean"
    || !["scope_presentation", "metric", "dimension", "relationship", "business_rule", "cleaning_rule", "verified_query"].includes(value.entry_type as string)
    || !["candidate", "confirmed", "locked"].includes(value.state as string) || !["active", "unverified", "stale"].includes(value.validity as string)
    || !["inferred", "user", "verified_analysis", "imported"].includes(value.source as string)
    || typeof value.confidence !== "number" || !Number.isFinite(value.confidence)
    || (value.definition !== null && !record(value.definition)) || !Array.isArray(value.evidence) || !value.evidence.every(record)
    || !Array.isArray(value.allowed_actions) || !value.allowed_actions.every(item => typeof item === "string")
    || (value.scope_id !== undefined && value.scope_id !== null && typeof value.scope_id !== "string")
    || (value.source_refs !== undefined && (!Array.isArray(value.source_refs) || !value.source_refs.every(record)))) throw new Error("Unconfirmed definition identity");
  if (receipt && (value.active_revision_id === target.expectedHead
    || (target.previousVersion !== undefined && value.revision_number !== target.previousVersion + 1))) throw new Error("Unconfirmed definition revision");
  if (receipt && target.content && (value.value !== target.content.value || value.entry_type !== target.content.entryType || value.state !== target.content.state
    || !record(value.definition) || value.definition.business_name !== target.content.businessName)) throw new Error("Unconfirmed definition content");
  return value as unknown as SemanticEntry;
}

export async function readSemanticSaveTarget(target: SemanticSaveTarget, signal: AbortSignal): Promise<SemanticEntry | null> {
  const base = `/api/v1/projects/${encodeURIComponent(target.projectId)}/knowledge`;
  const response = target.entryId
    ? await api.get(`${base}/${encodeURIComponent(target.entryId)}`, { signal })
    : await api.get(`${base}/lookup`, { params: { key: target.key }, signal });
  if (!target.entryId && response.data.data === null) return null;
  return inspectSemanticSaveEntry(response.data.data, target);
}
