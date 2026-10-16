import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export type PendingUpload = {
  projectId: string; id: string; name: string; size: number; createdAt: number;
} & ({ schema: 1 } | { schema: 2; sha256: string });
export interface UploadJournal {
  prepare(projectId: string, id: string, file: Pick<File, "name" | "size">, sha256?: string): Promise<PendingUpload>;
  require(record: PendingUpload): Promise<void>;
  remove(records: PendingUpload[]): Promise<void>;
}
export class UploadJournalError extends Error {
  constructor(public readonly reason: "unavailable" | "limit" | "changed") { super(`Upload recovery ${reason}`); }
}

export const MAX_PENDING_UPLOADS = 500;
export const MAX_PROJECT_PENDING_UPLOADS = 100;
const databaseName = "receiptbi-upload-recovery";
const eventName = "receiptbi:upload-recovery";
interface UploadDatabase extends DBSchema {
  pending: { key: [string, string]; value: PendingUpload; indexes: { project: string } };
}
let database: Promise<IDBPDatabase<UploadDatabase>> | undefined;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function isPendingUpload(value: unknown): value is PendingUpload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const shape = record.schema === 1
    ? Object.keys(record).sort().join(",") === "createdAt,id,name,projectId,schema,size"
    : record.schema === 2 && Object.keys(record).sort().join(",") === "createdAt,id,name,projectId,schema,sha256,size"
      && typeof record.sha256 === "string" && /^[0-9a-f]{64}$/.test(record.sha256);
  return shape && uuid(record.projectId) && uuid(record.id)
    && typeof record.name === "string" && record.name.length > 0 && record.name.length <= 4096 && !record.name.includes("\0")
    && Number.isSafeInteger(record.size) && Number(record.size) > 0
    && Number.isSafeInteger(record.createdAt) && Number(record.createdAt) >= 0;
}
function validated(value: unknown): PendingUpload {
  if (!isPendingUpload(value)) throw new UploadJournalError("unavailable");
  return value;
}
function same(left: PendingUpload, right: PendingUpload): boolean {
  return left.schema === right.schema && left.projectId === right.projectId && left.id === right.id
    && left.name === right.name && left.size === right.size && left.createdAt === right.createdAt
    && (left.schema !== 2 || (right.schema === 2 && left.sha256 === right.sha256));
}
function openUploadDatabase(): Promise<IDBPDatabase<UploadDatabase>> {
  if (typeof indexedDB === "undefined") return Promise.reject(new UploadJournalError("unavailable"));
  if (!database) {
    const connection = openDB<UploadDatabase>(databaseName, 1, {
      upgrade(db) { db.createObjectStore("pending", { keyPath: ["projectId", "id"] }).createIndex("project", "projectId"); },
      blocking() { void connection.then((db) => db.close()); database = undefined; },
      terminated() { database = undefined; },
    });
    const opening = new Promise<IDBPDatabase<UploadDatabase>>((resolve, reject) => {
      let expired = false;
      const timer = setTimeout(() => { expired = true; reject(new UploadJournalError("unavailable")); }, 2000);
      connection.then((db) => { clearTimeout(timer); if (expired) db.close(); else resolve(db); },
        (error: unknown) => { clearTimeout(timer); reject(error); });
    });
    database = opening;
    void opening.catch(() => { if (database === opening) database = undefined; });
  }
  return database;
}

function notify() {
  if (typeof window === "undefined") return;
  try { window.dispatchEvent(new Event(eventName)); } catch { /* Commit already succeeded. */ }
  try {
    const channel = new window.BroadcastChannel(eventName);
    try { channel.postMessage("changed"); } finally { channel.close(); }
  } catch { /* Focus and same-window notifications remain available. */ }
}
export function subscribeUploadJournal(changed: () => void): () => void {
  const visible = () => { if (document.visibilityState === "visible") changed(); };
  let channel: BroadcastChannel | undefined;
  try { channel = new window.BroadcastChannel(eventName); channel.onmessage = () => changed(); }
  catch { /* Never trust notification payloads; always reread local storage. */ }
  window.addEventListener(eventName, changed); window.addEventListener("focus", changed);
  document.addEventListener("visibilitychange", visible);
  return () => {
    channel?.close(); window.removeEventListener(eventName, changed); window.removeEventListener("focus", changed);
    document.removeEventListener("visibilitychange", visible);
  };
}

/** Read a bounded, coherent snapshot; never drop old requests to make room. */
export async function listPendingUploads(): Promise<PendingUpload[]> {
  const db = await openUploadDatabase();
  const records = await db.getAll("pending", undefined, MAX_PENDING_UPLOADS + 1);
  if (records.length > MAX_PENDING_UPLOADS) throw new UploadJournalError("limit");
  return records.map(validated).sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}

export const uploadJournal: UploadJournal = {
  async prepare(projectId, id, file, sha256) {
    const record = validated({ ...(sha256 === undefined ? { schema: 1 } : { schema: 2, sha256 }), projectId, id, name: file.name, size: file.size, createdAt: Date.now() });
    const db = await openUploadDatabase();
    const tx = db.transaction("pending", "readwrite", { durability: "strict" });
    void tx.done.catch(() => undefined);
    try {
      const existing = await tx.store.get([projectId, id]);
      if (existing !== undefined) {
        const retained = validated(existing);
        if (!same(retained, { ...record, createdAt: retained.createdAt })) throw new UploadJournalError("changed");
        await tx.done;
        return retained;
      }
      if (await tx.store.count() >= MAX_PENDING_UPLOADS || await tx.store.index("project").count(projectId) >= MAX_PROJECT_PENDING_UPLOADS) throw new UploadJournalError("limit");
      await tx.store.add(record);
      await tx.done;
      notify();
      return record;
    } catch (error) {
      try { tx.abort(); } catch { /* Already settled. */ }
      await tx.done.catch(() => undefined);
      throw error;
    }
  },
  async require(record) {
    validated(record);
    const db = await openUploadDatabase();
    const existing = await db.get("pending", [record.projectId, record.id]);
    if (existing === undefined || !same(validated(existing), record)) throw new UploadJournalError("changed");
  },
  async remove(records) {
    records.forEach(validated);
    if (!records.length) return;
    const db = await openUploadDatabase();
    const tx = db.transaction("pending", "readwrite", { durability: "strict" });
    void tx.done.catch(() => undefined);
    try {
      for (const record of records) {
        const key: [string, string] = [record.projectId, record.id];
        const existing = await tx.store.get(key);
        if (existing === undefined) continue;
        if (!same(validated(existing), record)) throw new UploadJournalError("changed");
        await tx.store.delete(key);
      }
      await tx.done;
      notify();
    } catch (error) {
      try { tx.abort(); } catch { /* Already settled. */ }
      await tx.done.catch(() => undefined);
      throw error;
    }
  },
};
