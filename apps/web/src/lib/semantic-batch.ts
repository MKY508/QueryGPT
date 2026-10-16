import type { SemanticBatchAction, SemanticBatchResult, SemanticEntry } from "@/lib/types/api";
import { inspectSemanticSaveEntry } from "@/lib/semantic-save-recovery";

export function inspectSemanticBatchResult(value: unknown, projectId: string, action: SemanticBatchAction, entries: SemanticEntry[]): SemanticBatchResult {
  const invalid = () => { throw new Error("Unconfirmed semantic batch result"); };
  if (!value || typeof value !== "object") return invalid();
  const result = value as SemanticBatchResult;
  if (result.action !== action || !Array.isArray(result.items) || result.items.length !== entries.length
    || !Array.isArray(result.queued_entry_ids)) return invalid();
  const expected = new Map(entries.map(entry => [entry.id, entry]));
  const seen = new Set<string>();
  for (const item of result.items) {
    const previous = item && expected.get(item.id);
    if (!previous || seen.has(item.id)) return invalid();
    inspectSemanticSaveEntry(item, { projectId, key: previous.key, entryId: previous.id,
      expectedHead: previous.active_revision_id ?? undefined, previousVersion: previous.revision_number ?? undefined }, action !== "queue_validation");
    if (action === "queue_validation" && item.active_revision_id !== previous.active_revision_id) return invalid();
    seen.add(item.id);
  }
  if (action === "queue_validation") {
    if (typeof result.validation_job_id !== "string" || !result.validation_job_id.trim()
      || !["queued", "running", "completed", "failed"].includes(result.validation_status ?? "")
      || result.queued_entry_ids.length !== entries.length || new Set(result.queued_entry_ids).size !== entries.length
      || result.queued_entry_ids.some(id => !expected.has(id))) return invalid();
  } else if (result.queued_entry_ids.length || result.validation_job_id) return invalid();
  return result;
}
