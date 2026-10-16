import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from "idb";
import type { ReportBlock, ReportDocument, ReportSerializationCopy } from "./reports";
import { ReportEditHistory } from "./report-edit-history";

export interface ReportPendingSave {
  schema: 1;
  requestId: string;
  snapshot: ReportDocument;
  copy: ReportSerializationCopy;
}

export interface ReportRecoveryDraft {
  schema: 1;
  id: string;
  revision: string;
  projectId: string;
  reportId: string;
  updatedAt: number;
  baseVersion: number;
  document: ReportDocument;
  pendingSave?: ReportPendingSave;
  baseline?: ReportDocument;
}

export interface ReportRecoverySummary extends Omit<ReportRecoveryDraft, "document" | "pendingSave" | "baseline"> {
  title: string;
}
export interface ReportRecoveryCursor { updatedAt: number; id: string }
export interface ReportRecoveryPage {
  items: ReportRecoverySummary[];
  total: number;
  next: ReportRecoveryCursor | null;
}

export function reportRecoverySummary(draft: ReportRecoveryDraft): ReportRecoverySummary {
  return { schema: draft.schema, id: draft.id, revision: draft.revision, projectId: draft.projectId,
    reportId: draft.reportId, updatedAt: draft.updatedAt, baseVersion: draft.baseVersion,
    title: draft.document.title.slice(0, 200) };
}

interface RecoveryDatabase extends DBSchema {
  drafts: {
    key: string;
    value: ReportRecoveryDraft;
    indexes: { report: [string, string] };
  };
  summaries: {
    key: string;
    value: ReportRecoverySummary;
    indexes: { report: [string, string]; newest: [string, string, number, string] };
  };
}

let database: Promise<IDBPDatabase<RecoveryDatabase>> | undefined;
function openRecoveryDatabase() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("Draft storage unavailable"));
  if (!database) {
    const connection = openDB<RecoveryDatabase>("receiptbi-report-recovery", 2, {
      upgrade(db, oldVersion, _newVersion, tx) {
        void tx.done.catch(() => undefined);
        if (oldVersion < 1) db.createObjectStore("drafts", { keyPath: "id" }).createIndex("report", ["projectId", "reportId"]);
        const summaries = db.createObjectStore("summaries", { keyPath: "id" });
        summaries.createIndex("report", ["projectId", "reportId"]);
        summaries.createIndex("newest", ["projectId", "reportId", "updatedAt", "id"]);
        // Cursor migration only materializes one old document at a time. Both
        // stores belong to this upgrade transaction: failure leaves v1 intact.
        void (async () => {
          let cursor = await tx.objectStore("drafts").openCursor();
          while (cursor) {
            const summary = reportRecoverySummary(cursor.value);
            if (!isReportRecoverySummary(summary)) throw new Error("Unreadable draft metadata");
            await summaries.put(summary);
            cursor = await cursor.continue();
          }
        })().catch(() => { try { tx.abort(); } catch { /* Already aborted. */ } });
      },
      blocking() { void connection.then((db) => db.close()); database = undefined; },
      terminated() { database = undefined; },
    });
    // A blocked browser database must not hold the editor's save/close flow
    // indefinitely. Close a connection that arrives after this attempt expires.
    const opening = new Promise<IDBPDatabase<RecoveryDatabase>>((resolve, reject) => {
      let expired = false;
      const timer = setTimeout(() => { expired = true; reject(new Error("Draft storage timed out")); }, 2_000);
      connection.then((db) => {
        clearTimeout(timer);
        if (expired) db.close(); else resolve(db);
      }, (error: unknown) => { clearTimeout(timer); reject(error); });
    });
    database = opening;
    void opening.catch(() => { if (database === opening) database = undefined; });
  }
  return database;
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const blockTypes = new Set(["metric", "chart", "table", "text", "evidence", "filter"]);
const sourceKinds = new Set(["manual", "analysis_run", "artifact"]);
function recoveryId(): string {
  return crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, "0")).join("");
}

function isReportRecoverySummary(value: unknown): value is ReportRecoverySummary {
  return object(value) && value.schema === 1 && text(value.id) && text(value.revision)
    && text(value.projectId) && text(value.reportId) && text(value.title)
    && Number.isFinite(value.updatedAt) && Number.isInteger(value.baseVersion) && Number(value.baseVersion) >= 1;
}

type RecoveryWrite = IDBPTransaction<RecoveryDatabase, ["drafts", "summaries"], "readwrite">;
async function writeRecovery<T>(operation: (tx: RecoveryWrite) => Promise<T>): Promise<T> {
  const db = await openRecoveryDatabase();
  const tx = db.transaction(["drafts", "summaries"], "readwrite");
  // Observe aborts immediately, including a synchronous clone failure between
  // the first and second write. Never leave a header/body half committed.
  void tx.done.catch(() => undefined);
  try {
    const result = await operation(tx);
    await tx.done;
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* The transaction may have already aborted. */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
}

/** Stored drafts are versioned input, not trusted server documents. */
function isDraftBody(value: unknown): value is ReportRecoveryDraft {
  if (!object(value) || value.schema !== 1 || !text(value.id) || !text(value.revision)
    || !text(value.projectId) || !text(value.reportId) || !Number.isFinite(value.updatedAt)
    || !Number.isInteger(value.baseVersion) || Number(value.baseVersion) < 1) return false;
  const doc = value.document;
  if (!object(doc) || doc.id !== value.reportId || doc.project_id !== value.projectId
    || doc.version !== value.baseVersion || !text(doc.title) || !text(doc.description)
    || !["draft", "published", "archived"].includes(String(doc.status))
    || !text(doc.created_at) || !text(doc.updated_at) || !Array.isArray(doc.pages) || !doc.pages.length || doc.pages.length > 100) return false;
  const ids = new Set<string>();
  let blockCount = 0;
  for (const page of doc.pages) {
    if (!object(page) || !text(page.id) || ids.has(page.id) || !text(page.title)
      || !Number.isFinite(page.order_index) || !object(page.config) || !Array.isArray(page.blocks)) return false;
    ids.add(page.id);
    for (const block of page.blocks) {
      if (++blockCount > 2_000 || !object(block) || !text(block.id) || ids.has(block.id)
        || !blockTypes.has(String(block.block_type)) || !sourceKinds.has(String(block.source_kind))
        || !text(block.title) || !Number.isFinite(block.order_index) || !object(block.content)
        || !object(block.config) || !object(block.layout)
        || ![block.layout.x, block.layout.y, block.layout.w, block.layout.h].every(Number.isFinite)) return false;
      ids.add(block.id);
    }
  }
  return true;
}

export function isReportRecoveryDraft(value: unknown): value is ReportRecoveryDraft {
  if (!isDraftBody(value)) return false;
  const validSnapshot = (snapshot: unknown) => isDraftBody({ ...value, document: snapshot })
    && (snapshot as ReportDocument).created_at === value.document.created_at;
  if (value.baseline !== undefined && (!validSnapshot(value.baseline) || value.pendingSave !== undefined)) return false;
  if (value.pendingSave !== undefined) {
    const pending = value.pendingSave;
    if (!object(pending) || pending.schema !== 1 || !text(pending.requestId)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pending.requestId)
      || !validSnapshot(pending.snapshot) || !object(pending.copy)
      || !["unnamedBlock", "textBlock", "unnamedPage", "unnamedReport"].every((key) => text(pending.copy[key as keyof ReportSerializationCopy]))) return false;
  }
  return true;
}

function assertWritableDraft(draft: ReportRecoveryDraft): void {
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  const { pendingSave, baseline, ...body } = draft;
  if (!isReportRecoveryDraft(draft) || bytes(body) > 8 * 1024 * 1024
    || bytes(pendingSave || baseline || null) > 8 * 1024 * 1024) {
    throw new Error("Draft exceeds recovery limit");
  }
}

export async function listReportRecoveryDrafts(projectId: string, reportId: string, options: {
  before?: ReportRecoveryCursor | null;
  excludeId?: string;
  limit?: number;
} = {}): Promise<ReportRecoveryPage> {
  const db = await openRecoveryDatabase();
  const tx = db.transaction("summaries");
  const size = Math.max(1, Math.min(30, Number.isInteger(options.limit) ? options.limit! : 12));
  const total = await tx.store.index("report").count([projectId, reportId]);
  const excluded = options.excludeId ? await tx.store.get(options.excludeId) : undefined;
  const upper = options.before ? [projectId, reportId, options.before.updatedAt, options.before.id] : [projectId, reportId, []];
  const range = IDBKeyRange.bound([projectId, reportId], upper, false, !!options.before);
  const items: ReportRecoverySummary[] = [];
  let cursor = await tx.store.index("newest").openCursor(range, "prev");
  while (cursor && items.length <= size) {
    if (cursor.value.id !== options.excludeId) {
      if (!isReportRecoverySummary(cursor.value)) throw new Error("Unreadable draft metadata");
      items.push(cursor.value);
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  const hasMore = items.length > size;
  if (hasMore) items.pop();
  const last = items.at(-1);
  return { items, total: total - (excluded?.projectId === projectId && excluded.reportId === reportId ? 1 : 0),
    next: hasMore && last ? { updatedAt: last.updatedAt, id: last.id } : null };
}

export async function loadReportRecoveryDraft(summary: ReportRecoverySummary): Promise<ReportRecoveryDraft> {
  const db = await openRecoveryDatabase();
  const draft = await db.get("drafts", summary.id);
  if (!isReportRecoveryDraft(draft) || draft.revision !== summary.revision
    || draft.projectId !== summary.projectId || draft.reportId !== summary.reportId) throw new Error("Draft changed or unavailable");
  return draft;
}

export async function removeReportRecoveryDraft(draft: Pick<ReportRecoverySummary, "id" | "revision" | "projectId" | "reportId">): Promise<boolean> {
  return writeRecovery(async (tx) => {
    const current = await tx.objectStore("summaries").get(draft.id);
    const unchanged = !current || (current.revision === draft.revision && current.projectId === draft.projectId && current.reportId === draft.reportId);
    if (current && unchanged) {
      await tx.objectStore("drafts").delete(draft.id);
      await tx.objectStore("summaries").delete(draft.id);
    }
    return unchanged;
  });
}

export async function removeRecoveryDraftsForReport(projectId: string, reportId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await writeRecovery(async (tx) => {
    let cursor = await tx.objectStore("summaries").index("report").openCursor([projectId, reportId]);
    while (cursor) {
      await tx.objectStore("drafts").delete(cursor.primaryKey);
      await cursor.delete();
      cursor = await cursor.continue();
    }
  });
}

function sourceIdentity(block: ReportBlock, key: "analysis_run_id" | "artifact_id"): string | null {
  return block[key] || (typeof block.source_ref?.[key] === "string" ? block.source_ref[key] : null);
}
const sameBinding = (left: ReportBlock, right: ReportBlock) => left.source_kind === right.source_kind
  && sourceIdentity(left, "analysis_run_id") === sourceIdentity(right, "analysis_run_id")
  && sourceIdentity(left, "artifact_id") === sourceIdentity(right, "artifact_id");

export function restoreReportRecoveryDraft(draft: ReportRecoveryDraft, saved: ReportDocument): ReportDocument | null {
  if (!isReportRecoveryDraft(draft) || draft.pendingSave || draft.projectId !== saved.project_id || draft.reportId !== saved.id
    || draft.baseVersion !== saved.version || draft.document.created_at !== saved.created_at) return null;
  const pages = new Map(saved.pages.map((page) => [page.id, page]));
  const copySources = new Map(saved.pages.flatMap((page) => page.blocks.map((block) => [block.id, block] as const)));
  for (const page of draft.document.pages) {
    const original = pages.get(page.id);
    if (!original && !page.id.startsWith("local-")) return null;
    if (page.blocks.some((block) => !block.id.startsWith("local-") && !copySources.has(block.id))) return null;
    if (page.blocks.some((block) => block.copy_source_block_id && block.source_kind !== "manual" &&
      (!block.id.startsWith("local-") || !copySources.has(block.copy_source_block_id) ||
        !sameBinding(copySources.get(block.copy_source_block_id)!, block)))) return null;
  }
  return {
    ...saved,
    title: draft.document.title,
    description: draft.document.description,
    status: draft.document.status,
    pages: draft.document.pages.map((page) => {
      const original = pages.get(page.id);
      return { ...page, version: original?.version, created_at: original?.created_at, updated_at: original?.updated_at,
        blocks: page.blocks.map((block) => {
          const source = copySources.get(block.id);
          const copySource = block.copy_source_block_id ? copySources.get(block.copy_source_block_id) : undefined;
          if (copySource && block.source_kind !== "manual") return { ...block,
            source_ref: copySource.source_ref, source_available: copySource.source_available,
            analysis_run_id: copySource.analysis_run_id, artifact_id: copySource.artifact_id,
            version: undefined, created_at: undefined, updated_at: undefined };
          return source && sameBinding(source, block)
            ? { ...block, source_ref: source.source_ref, source_available: source.source_available,
                analysis_run_id: source.analysis_run_id, artifact_id: source.artifact_id,
                version: source.version, created_at: source.created_at, updated_at: source.updated_at }
            : { ...block, source_available: block.source_kind === "manual" };
        }),
      };
    }),
  };
}

/** Only an acknowledged common ancestor can unlock an older draft's merge path. */
export function reportRecoveryBase(draft: ReportRecoveryDraft, current: ReportDocument): ReportDocument | null {
  if (restoreReportRecoveryDraft(draft, current)) return current;
  const base = draft.baseline;
  if (!base || draft.pendingSave || current.project_id !== base.project_id || current.id !== base.id
    || current.created_at !== base.created_at || current.version <= base.version) return null;
  return restoreReportRecoveryDraft(draft, base) ? base : null;
}

/** Atomically replace only the exact reviewed draft; never consume another tab's later edit. */
export async function acknowledgeReportRecoverySave(draft: ReportRecoveryDraft, saved: ReportDocument): Promise<boolean> {
  const pending = draft.pendingSave;
  if (!isReportRecoveryDraft(draft) || !pending || saved.id !== draft.reportId || saved.project_id !== draft.projectId
    || saved.created_at !== pending.snapshot.created_at || saved.version !== draft.baseVersion + 1) return false;
  const history = new ReportEditHistory((kind) => `local-${kind}-${recoveryId()}`);
  history.reset(pending.snapshot);
  // Separate objects after IndexedDB decoding cannot be compared by identity.
  if (JSON.stringify(draft.document) !== JSON.stringify(pending.snapshot)) history.record(draft.document);
  const document = history.acknowledge(pending.snapshot, saved);
  const next: ReportRecoveryDraft = { ...draft, revision: recoveryId(), updatedAt: Date.now(),
    baseVersion: saved.version, document, baseline: saved };
  delete next.pendingSave;
  assertWritableDraft(next);
  return writeRecovery(async (tx) => {
    const current = await tx.objectStore("summaries").get(draft.id);
    if (!current || current.revision !== draft.revision || current.projectId !== draft.projectId || current.reportId !== draft.reportId) return false;
    await tx.objectStore("drafts").put(next);
    await tx.objectStore("summaries").put(reportRecoverySummary(next));
    return true;
  });
}

/** One independent backup per editing session; never overwrite another tab's draft. */
export class ReportRecoveryJournal {
  readonly id = recoveryId();
  private desired: ReportRecoveryDraft | null = null;
  private pending = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private tail: Promise<boolean> = Promise.resolve(true);
  private listeners = new Set<(failed: boolean) => void>();
  private hasWritten = false;
  private pendingSave: ReportPendingSave | undefined;
  private baseline: ReportDocument | undefined;

  subscribe(listener: (failed: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  checkpoint(document: ReportDocument): void {
    this.desired = {
      schema: 1, id: this.id, revision: recoveryId(), projectId: document.project_id,
      reportId: document.id, updatedAt: Date.now(), baseVersion: document.version, document,
      ...(this.pendingSave ? { pendingSave: this.pendingSave } : {}),
      ...(this.baseline ? { baseline: this.baseline } : {}),
    };
    this.pending = true;
    // Throttle rather than debounce: continuous typing still reaches storage.
    this.timer ??= setTimeout(() => { void this.flush(); }, 250);
  }

  beginSave(pending: ReportPendingSave, document: ReportDocument): Promise<boolean> {
    this.pendingSave = pending;
    this.baseline = undefined;
    this.checkpoint(document);
    return this.flush();
  }

  settleSave(baseline: ReportDocument): void {
    this.pendingSave = undefined;
    this.baseline = baseline;
  }

  flush(): Promise<boolean> {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.pending) return this.tail;
    const desired = this.desired;
    this.pending = false;
    this.tail = this.tail.then(async () => {
      try {
        if (desired) {
          assertWritableDraft(desired);
          await writeRecovery(async (tx) => {
            await tx.objectStore("drafts").put(desired);
            await tx.objectStore("summaries").put(reportRecoverySummary(desired));
          });
          this.hasWritten = true;
        } else if (this.hasWritten) {
          await writeRecovery(async (tx) => {
            await tx.objectStore("drafts").delete(this.id);
            await tx.objectStore("summaries").delete(this.id);
          });
          this.hasWritten = false;
        }
        for (const listener of this.listeners) listener(false);
        return true;
      } catch {
        if (this.desired === desired) this.pending = true;
        for (const listener of this.listeners) listener(true);
        return false;
      }
    });
    return this.tail;
  }

  async clear(): Promise<boolean> {
    const previous = this.desired;
    const pendingSave = this.pendingSave;
    const baseline = this.baseline;
    this.pendingSave = undefined;
    this.baseline = undefined;
    this.desired = null;
    this.pending = true;
    const cleared = await this.flush();
    // A failed discard leaves the editor open. A later visibility flush must
    // preserve its draft, not silently retry the abandoned deletion.
    if (!cleared && this.desired === null) {
      this.desired = previous;
      this.pendingSave = pendingSave;
      this.baseline = baseline;
      this.pending = previous !== null;
    }
    return cleared;
  }

  async adopt(source: ReportRecoveryDraft, document: ReportDocument): Promise<boolean> {
    if (!await this.flush()) return false;
    const adopted: ReportRecoveryDraft = { ...source, id: this.id, revision: recoveryId(),
      updatedAt: Date.now(), baseVersion: document.version, document };
    try {
      assertWritableDraft(adopted);
      const transferred = await writeRecovery(async (tx) => {
        const latest = await tx.objectStore("summaries").get(source.id);
        if (!latest || latest.revision !== source.revision || latest.projectId !== source.projectId || latest.reportId !== source.reportId) return false;
        await tx.objectStore("drafts").put(adopted);
        await tx.objectStore("summaries").put(reportRecoverySummary(adopted));
        await tx.objectStore("drafts").delete(source.id);
        await tx.objectStore("summaries").delete(source.id);
        return true;
      });
      if (!transferred) return false;
      this.desired = adopted;
      this.pendingSave = adopted.pendingSave;
      this.baseline = adopted.baseline;
      this.hasWritten = true;
      for (const listener of this.listeners) listener(false);
      return true;
    } catch {
      for (const listener of this.listeners) listener(true);
      return false;
    }
  }
}
