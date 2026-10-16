import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ReportCopyRequest } from "./report-copy";

export interface PendingReportCopy {
  schema: 1; id: string; projectId: string; sourceReportId: string; sourceTitle: string;
  createdAt: number; request: ReportCopyRequest;
}
export interface PendingCopyCursor { createdAt: number; id: string }
export interface PendingCopyPage { items: PendingReportCopy[]; total: number; next: PendingCopyCursor | null }
export class PendingCopyChangedError extends Error {}
interface CopyDatabase extends DBSchema {
  copies: { key: [string, string]; value: PendingReportCopy;
    indexes: { project: string; source: [string, string]; newest: [string, number, string] } };
}
const databaseName = "receiptbi-report-copy-journal";
const eventName = "receiptbi:report-copy-journal";
let database: Promise<IDBPDatabase<CopyDatabase>> | undefined;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const title = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && [...value].length <= 200 && !value.includes("\0");

export function isPendingReportCopy(value: unknown): value is PendingReportCopy {
  if (!object(value) || value.schema !== 1 || !uuid(value.id) || !uuid(value.projectId) || !uuid(value.sourceReportId)
    || !title(value.sourceTitle) || !Number.isSafeInteger(value.createdAt) || Number(value.createdAt) < 0 || !object(value.request)) return false;
  const request = value.request;
  return Object.keys(request).sort().join(",") === "expected_version,request_id,title"
    && request.request_id === value.id && Number.isSafeInteger(request.expected_version) && Number(request.expected_version) >= 1
    && title(request.title) && request.title === request.title.trim();
}
function validated(value: unknown, projectId: string): PendingReportCopy {
  if (!isPendingReportCopy(value) || value.projectId !== projectId) throw new Error("Unreadable copy recovery request");
  return value;
}
function same(left: PendingReportCopy, right: PendingReportCopy): boolean {
  return left.projectId === right.projectId && left.id === right.id && left.sourceReportId === right.sourceReportId
    && left.sourceTitle === right.sourceTitle && left.createdAt === right.createdAt
    && left.request.title === right.request.title && left.request.expected_version === right.request.expected_version
    && left.request.request_id === right.request.request_id;
}
function openCopyDatabase() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("Copy recovery unavailable"));
  if (!database) {
    const connection = openDB<CopyDatabase>(databaseName, 1, {
      upgrade(db) {
        const store = db.createObjectStore("copies", { keyPath: ["projectId", "id"] });
        store.createIndex("project", "projectId");
        store.createIndex("source", ["projectId", "sourceReportId"], { unique: true });
        store.createIndex("newest", ["projectId", "createdAt", "id"]);
      },
      blocking() { void connection.then((db) => db.close()); database = undefined; },
      terminated() { database = undefined; },
    });
    const opening = new Promise<IDBPDatabase<CopyDatabase>>((resolve, reject) => {
      let expired = false;
      const timer = setTimeout(() => { expired = true; reject(new Error("Copy recovery timed out")); }, 2000);
      connection.then((db) => { clearTimeout(timer); if (expired) db.close(); else resolve(db); },
        (error: unknown) => { clearTimeout(timer); reject(error); });
    });
    database = opening;
    void opening.catch(() => { if (database === opening) database = undefined; });
  }
  return database;
}

function notify(projectId: string) {
  if (typeof window === "undefined") return;
  // Notifications carry only a scope, never a trusted replacement record.
  window.dispatchEvent(new CustomEvent(eventName, { detail: projectId }));
  if (typeof window.BroadcastChannel === "function") {
    try {
      const channel = new window.BroadcastChannel(eventName);
      try { channel.postMessage({ projectId }); } finally { channel.close(); }
    } catch { /* A notification failure cannot undo a committed journal write. */ }
  }
}
export function subscribePendingCopies(projectId: string, changed: () => void): () => void {
  const local = (event: Event) => { if ((event as CustomEvent<unknown>).detail === projectId) changed(); };
  const visible = () => { if (document.visibilityState === "visible") changed(); };
  let channel: BroadcastChannel | null = null;
  try { if (typeof window.BroadcastChannel === "function") channel = new window.BroadcastChannel(eventName); }
  catch { /* Focus/visibility and same-window notifications remain available. */ }
  if (channel) channel.onmessage = (event: MessageEvent<unknown>) => { if (object(event.data) && event.data.projectId === projectId) changed(); };
  window.addEventListener(eventName, local); window.addEventListener("focus", changed);
  document.addEventListener("visibilitychange", visible);
  return () => { channel?.close(); window.removeEventListener(eventName, local); window.removeEventListener("focus", changed); document.removeEventListener("visibilitychange", visible); };
}

/** Commit the exact intent before any API write. One outstanding intent per source. */
export async function preparePendingCopy(projectId: string, sourceReportId: string, sourceTitle: string, request: ReportCopyRequest): Promise<{ pending: PendingReportCopy; created: boolean }> {
  const pending: PendingReportCopy = { schema: 1, id: request.request_id, projectId, sourceReportId, sourceTitle,
    createdAt: Date.now(), request: { ...request } };
  validated(pending, projectId);
  const db = await openCopyDatabase();
  const tx = db.transaction("copies", "readwrite", { durability: "strict" });
  void tx.done.catch(() => undefined);
  try {
    const existing = await tx.store.index("source").get([projectId, sourceReportId]);
    if (existing) {
      const retained = validated(existing, projectId);
      await tx.done;
      return { pending: retained, created: false };
    }
    await tx.store.add(pending);
    await tx.done; notify(projectId);
    return { pending, created: true };
  } catch (error) {
    try { tx.abort(); } catch { /* Already completed/aborted. */ }
    await tx.done.catch(() => undefined); throw error;
  }
}

export async function pendingCopyForSource(projectId: string, sourceReportId: string): Promise<PendingReportCopy | null> {
  const db = await openCopyDatabase();
  const value = await db.getFromIndex("copies", "source", [projectId, sourceReportId]);
  if (value === undefined) return null;
  const pending = validated(value, projectId);
  if (pending.sourceReportId !== sourceReportId) throw new Error("Copy scope changed");
  return pending;
}
export async function requirePendingCopy(pending: PendingReportCopy): Promise<PendingReportCopy> {
  validated(pending, pending.projectId);
  const db = await openCopyDatabase();
  const value = await db.get("copies", [pending.projectId, pending.id]);
  if (value === undefined) throw new PendingCopyChangedError("Copy reminder no longer exists");
  const current = validated(value, pending.projectId);
  if (!same(current, pending)) throw new PendingCopyChangedError("Copy reminder changed");
  return current;
}
export async function removePendingCopy(pending: PendingReportCopy): Promise<boolean> {
  validated(pending, pending.projectId);
  const db = await openCopyDatabase();
  const tx = db.transaction("copies", "readwrite", { durability: "strict" });
  void tx.done.catch(() => undefined);
  try {
    const value = await tx.store.get([pending.projectId, pending.id]);
    const unchanged = value === undefined || same(validated(value, pending.projectId), pending);
    if (value && unchanged) await tx.store.delete([pending.projectId, pending.id]);
    await tx.done;
    if (unchanged) notify(pending.projectId);
    return unchanged;
  } catch (error) {
    try { tx.abort(); } catch { /* Already completed/aborted. */ }
    await tx.done.catch(() => undefined); throw error;
  }
}
export async function listPendingCopies(projectId: string, before?: PendingCopyCursor | null): Promise<PendingCopyPage> {
  const db = await openCopyDatabase();
  const tx = db.transaction("copies");
  const total = await tx.store.index("project").count(projectId);
  const upper = before ? [projectId, before.createdAt, before.id] : [projectId, []];
  const range = IDBKeyRange.bound([projectId], upper, false, !!before);
  const items: PendingReportCopy[] = [];
  let cursor = await tx.store.index("newest").openCursor(range, "prev");
  while (cursor && items.length < 11) { items.push(validated(cursor.value, projectId)); cursor = await cursor.continue(); }
  await tx.done;
  const more = items.length > 10;
  if (more) items.pop();
  const last = items.at(-1);
  return { items, total, next: more && last ? { createdAt: last.createdAt, id: last.id } : null };
}
