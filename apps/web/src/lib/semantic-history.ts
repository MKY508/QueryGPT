import { api } from "@/lib/api/client";
import type { SemanticEntry, SemanticEntryRevision, SemanticRevisionSnapshot } from "@/lib/types/api";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const number = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const types = new Set(["scope_presentation", "metric", "dimension", "relationship", "business_rule", "cleaning_rule", "verified_query"]);

function snapshot(value: unknown): value is SemanticRevisionSnapshot {
  return record(value) && typeof value.key === "string" && typeof value.value === "string" && types.has(value.entry_type as string)
    && ["candidate", "confirmed", "locked"].includes(value.state as string) && ["active", "unverified", "stale"].includes(value.validity as string)
    && ["inferred", "user", "verified_analysis", "imported"].includes(value.source as string)
    && ["definition_only", "needs_validation", "verified", "blocked"].includes(value.execution_state as string) && record(value.execution_details)
    && typeof value.confidence === "number" && Number.isFinite(value.confidence)
    && (value.definition === null || record(value.definition)) && Array.isArray(value.evidence) && value.evidence.every(record)
    && (value.scope_id === undefined || value.scope_id === null || typeof value.scope_id === "string")
    && typeof value.is_active === "boolean";
}

export interface SemanticHistory { current: SemanticEntry; revisions: SemanticEntryRevision[] }
export class SemanticHistoryConflict extends Error {}

export function inspectSemanticHistory(current: unknown, revisions: unknown, projectId: string, entryId: string): SemanticHistory {
  if (!snapshot(current) || !record(current) || current.id !== entryId || current.project_id !== projectId || !Array.isArray(current.allowed_actions)
    || !Array.isArray(revisions)) throw new Error("Invalid definition history");
  const ids = new Set<string>(), numbers = new Set<number>();
  for (const item of revisions) {
    if (!record(item) || item.project_id !== projectId || item.semantic_entry_id !== entryId || !text(item.id) || !number(item.revision_number)
      || !snapshot(item.snapshot) || typeof item.created_at !== "string" || ids.has(item.id) || numbers.has(item.revision_number)) throw new Error("Invalid definition revision");
    ids.add(item.id); numbers.add(item.revision_number);
  }
  const sorted = [...revisions as SemanticEntryRevision[]].sort((a, b) => b.revision_number - a.revision_number);
  if (sorted.length && (sorted[0].id !== current.active_revision_id || sorted[0].revision_number !== current.revision_number)) throw new SemanticHistoryConflict();
  if (!sorted.length && current.active_revision_id) throw new SemanticHistoryConflict();
  return { current: current as unknown as SemanticEntry, revisions: sorted };
}

export async function readSemanticHistory(projectId: string, entryId: string, signal: AbortSignal): Promise<SemanticHistory> {
  const url = `/api/v1/projects/${encodeURIComponent(projectId)}/knowledge/${encodeURIComponent(entryId)}`;
  const [entry, revisions] = await Promise.all([api.get(url, { signal }), api.get(`${url}/revisions`, { signal })]);
  return inspectSemanticHistory(entry.data.data, revisions.data.data, projectId, entryId);
}

export function revisionEntry(revision: SemanticEntryRevision): SemanticEntry {
  // Historical presentation must never borrow today's source labels or evidence.
  return { ...revision.snapshot, id: revision.semantic_entry_id, project_id: revision.project_id, allowed_actions: [],
    active_revision_id: revision.id, revision_number: revision.revision_number, created_at: revision.created_at, updated_at: revision.created_at };
}

function equal(left: unknown, right: unknown): boolean {
  const pending: [unknown, unknown][] = [[left, right]];
  let checked = 0;
  while (pending.length) {
    if (++checked > 50000) return false;
    const [a, b] = pending.pop()!;
    if (Object.is(a, b)) continue;
    if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length || keys.some(key => !Object.hasOwn(b, key))) return false;
    if (keys.length + pending.length > 50000) return false;
    for (const key of keys) pending.push([(a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]]);
  }
  return true;
}

export function semanticHistoryChanges(current: SemanticEntry, revision: SemanticEntryRevision): string[] {
  const old = revision.snapshot;
  return [
    !equal(current.value, old.value) && "meaning",
    !equal(current.definition ?? null, old.definition) && "definition",
    current.entry_type !== old.entry_type && "type",
    (current.scope_id ?? null) !== (old.scope_id ?? null) && "scope",
    (current.state !== old.state || current.validity !== old.validity || (current.is_active !== false) !== (old.is_active !== false)) && "adoption",
  ].filter((value): value is string => typeof value === "string");
}

export async function restoreSemanticHistory(history: SemanticHistory, revisionId: string): Promise<SemanticEntry> {
  const { current, revisions } = history;
  const target = revisions.find(item => item.id === revisionId);
  if (!text(current.active_revision_id) || !target || target.id === current.active_revision_id || target.snapshot.is_active === false
    || target.project_id !== current.project_id || target.semantic_entry_id !== current.id || revisions[0]?.id !== current.active_revision_id) throw new Error("Revision cannot be restored");
  const response = await api.post(`/api/v1/projects/${encodeURIComponent(current.project_id)}/knowledge/${encodeURIComponent(current.id)}/revisions/${encodeURIComponent(target.id)}/restore`,
    { expected_active_revision_id: current.active_revision_id });
  const value: unknown = response.data.data;
  if (!snapshot(value) || !record(value) || value.id !== current.id || value.project_id !== current.project_id || !text(value.active_revision_id)
    || value.active_revision_id === current.active_revision_id || !number(value.revision_number) || value.revision_number !== (current.revision_number ?? 0) + 1
    || !Array.isArray(value.allowed_actions)) throw new Error("Unconfirmed restoration response");
  return value as unknown as SemanticEntry;
}
