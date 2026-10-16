import type { RuntimeMessageKey } from "@/i18n/runtime";
import { fileUploadErrorKey } from "@/lib/file-upload";
import { isSupportedUploadFile } from "@/lib/file-formats";
import { fileContentDigest } from "@/lib/file-content-digest";
import { isPendingUpload, UploadJournalError, type PendingUpload, type UploadJournal } from "@/lib/upload-journal";

import type { UploadItem, UploadSnapshot } from "@/lib/upload-state";
export const MAX_UPLOAD_ITEMS = 100;

interface Entry {
  item: UploadItem;
  file?: File;
  attempt?: symbol;
  unconfirmedAttempt?: boolean;
  pending?: PendingUpload;
  controller?: AbortController;
}
interface ProjectQueue {
  entries: Entry[];
  notice: RuntimeMessageKey | null;
}
interface QueueOptions {
  claim: (projectId: string) => boolean;
  release: (projectId: string) => void;
  send: (
    projectId: string,
    file: File,
    progress: (fraction: number | null) => void,
    requestId: string,
    sha256?: string,
  ) => Promise<void>;
  resolve?: (projectId: string, requestId: string, sha256?: string) => Promise<"added" | "removed" | null>;
  digest?: typeof fileContentDigest;
  journal?: UploadJournal;
  changed: (projectId: string, snapshot: UploadSnapshot) => void;
  settled: (projectId: string) => Promise<void>;
}

const retryable = new Set<RuntimeMessageKey>([
  "fileUploadBusy",
  "fileUploadNoSpace",
  "fileUploadWriteFailed",
  "fileUploadTimeout",
  "fileUploadInvalid",
]);
const pauseAfter = new Set<RuntimeMessageKey>([
  "fileUploadBusy",
  "fileUploadNoSpace",
  "fileUploadWriteFailed",
  "fileUploadTimeout",
  "fileUploadOutcomeUnknown",
]);

/** In-memory, project-owned batches; File references never enter store snapshots. */
export class FileUploadQueue {
  private projects = new Map<string, ProjectQueue>();
  private running = new Set<string>();
  private paused = new Set<string>();
  private dismissed = new Set<string>();

  constructor(private options: QueueOptions) {}

  snapshot(projectId: string): UploadSnapshot {
    const queue = this.projects.get(projectId);
    return {
      items: queue?.entries.map(({ item }) => ({ ...item })) ?? [],
      busy: this.running.has(projectId),
      notice: queue?.notice ?? null,
      ...(this.paused.has(projectId) ? { paused: true } : {}),
    };
  }

  private emit(projectId: string) {
    this.options.changed(projectId, this.snapshot(projectId));
  }

  private readingProgress(projectId: string, entry: Entry, fraction: number) {
    const progress = Math.floor(fraction * 100);
    if (entry.item.progress === progress) return;
    entry.item = { ...entry.item, progress };
    this.emit(projectId);
  }

  /** Recovery only restores records. It never sends files or queries the API. */
  restore(records: PendingUpload[]): void {
    if (records.some((record) => !isPendingUpload(record))) throw new UploadJournalError("unavailable");
    const key = (projectId: string, id: string) => `${projectId}/${id}`;
    const present = new Set(records.map((record) => key(record.projectId, record.id)));
    const changed = new Set<string>();
    for (const [projectId, queue] of this.projects) {
      if (this.running.has(projectId)) continue;
      const kept = queue.entries.filter((entry) => !(entry.item.recovered && entry.item.status === "uncertain" && !present.has(key(projectId, entry.item.id))));
      if (kept.length !== queue.entries.length) {
        queue.entries = kept;
        changed.add(projectId);
      }
    }
    for (const record of records) {
      if (this.dismissed.has(key(record.projectId, record.id))) continue;
      const queue = this.projects.get(record.projectId) ?? { entries: [], notice: null };
      if (queue.entries.some((entry) => entry.item.id === record.id)) continue;
      queue.entries.push({ pending: record, unconfirmedAttempt: true, item: {
        id: record.id, name: record.name, status: "uncertain", progress: null,
        retryable: false, recovered: true, reselectable: record.schema === 2,
      } });
      this.projects.set(record.projectId, queue);
      changed.add(record.projectId);
    }
    for (const projectId of changed) this.emit(projectId);
  }

  private async settleJournal(entry: Entry, queue: ProjectQueue): Promise<void> {
    if (!entry.pending || !this.options.journal) return;
    try {
      await this.options.journal.remove([entry.pending]);
      entry.pending = undefined;
    } catch {
      // A failed local cleanup cannot turn a confirmed import into a failure.
      queue.notice = "fileUploadRecoveryCleanupFailed";
    }
  }

  private async confirm(projectId: string, entry: Entry, queue: ProjectQueue, outcome: "added" | "removed") {
    entry.unconfirmedAttempt = false;
    entry.item = { ...entry.item, status: outcome, progress: outcome === "added" ? 100 : null,
      retryable: false, reselectable: false,
      errorKey: outcome === "removed" ? "fileUploadSourceRemoved" : undefined };
    entry.file = undefined;
    await this.settleJournal(entry, queue);
    if (outcome === "added") {
      try { await this.options.settled(projectId); }
      catch { queue.notice = "fileUploadListRefreshFailed"; }
    }
  }

  async enqueue(projectId: string, files: readonly File[]): Promise<void> {
    if (!files.length) return;
    const queue: ProjectQueue = this.projects.get(projectId) ?? {
      entries: [],
      notice: null,
    };
    this.projects.set(projectId, queue);
    if (
      this.running.has(projectId) ||
      (queue.entries.some(({ item }) => item.status === "queued") && !this.paused.has(projectId))
    ) {
      queue.notice = "fileUploadQueuePending";
      this.emit(projectId);
      return;
    }
    // Reject the whole selection instead of silently discarding its tail.
    if (queue.entries.length + files.length > MAX_UPLOAD_ITEMS) {
      queue.notice = "fileUploadQueueLimit";
      this.emit(projectId);
      return;
    }
    queue.notice = null;
    for (const file of files) {
      const errorKey =
        file.size === 0
          ? "fileUploadEmpty"
          : isSupportedUploadFile(file.name)
            ? undefined
            : "fileUploadUnsupported";
      queue.entries.push({
        file: errorKey ? undefined : file,
        item: {
          id: crypto.randomUUID(),
          name: file.name,
          status: errorKey ? "failed" : "queued",
          progress: null,
          errorKey,
          retryable: false,
        },
      });
    }
    this.emit(projectId);
    // Additional selections join an idle held batch without implicitly starting it.
    if (!this.paused.has(projectId)) await this.resume(projectId);
  }

  pause(projectId: string): void {
    const queue = this.projects.get(projectId);
    if (!queue?.entries.some(({ item }) => item.status === "queued") || this.paused.has(projectId)) return;
    this.paused.add(projectId);
    this.emit(projectId);
  }

  cancel(projectId: string, id: string): void {
    const entry = this.projects
      .get(projectId)
      ?.entries.find(({ item }) => item.id === id);
    if (entry?.item.status === "preparing" || entry?.item.verifying) {
      entry.controller?.abort();
      return;
    }
    if (!entry || entry.item.status !== "queued") return;
    entry.file = undefined;
    entry.item = { ...entry.item, status: "cancelled" };
    if (!this.projects.get(projectId)?.entries.some(({ item }) => item.status === "queued")) this.paused.delete(projectId);
    this.emit(projectId);
  }

  cancelWaiting(projectId: string): void {
    const queue = this.projects.get(projectId);
    let changed = false;
    for (const entry of queue?.entries ?? []) {
      if (entry.item.status !== "queued") continue;
      entry.file = undefined;
      entry.item = { ...entry.item, status: "cancelled" };
      changed = true;
    }
    // Publish the entire cancellation together, even for a large batch.
    if (changed) this.paused.delete(projectId);
    if (changed) this.emit(projectId);
  }

  async clear(projectId: string): Promise<void> {
    if (this.running.has(projectId)) return;
    const queue = this.projects.get(projectId);
    // Pending items require explicit cancellation, not a history-clear action.
    if (queue?.entries.some(({ item }) => item.status === "queued")) return;
    if (!queue) return;
    const entries = [...queue.entries];
    const pending = entries.flatMap((entry) => entry.pending ? [entry.pending] : []);
    const forget = () => {
      const ids = new Set(entries.map((entry) => entry.item.id));
      for (const id of ids) this.dismissed.add(`${projectId}/${id}`);
      queue.entries = queue.entries.filter((entry) => !ids.has(entry.item.id));
      if (!queue.entries.length) { this.projects.delete(projectId); this.paused.delete(projectId); }
    };
    if (!pending.length || !this.options.journal) {
      forget(); this.emit(projectId); return;
    }
    if (!this.options.claim(projectId)) {
      queue.notice = "fileUploadBusy"; this.emit(projectId); return;
    }
    this.running.add(projectId);
    this.emit(projectId);
    try {
      await this.options.journal.remove(pending);
      forget();
    } catch { queue.notice = "fileUploadRecoveryCleanupFailed"; }
    finally {
      this.running.delete(projectId); this.options.release(projectId); this.emit(projectId);
    }
  }

  async retry(projectId: string, id: string): Promise<void> {
    if (this.running.has(projectId)) return;
    const entry = this.projects
      .get(projectId)
      ?.entries.find(({ item }) => item.id === id);
    if (!entry?.file || !["failed", "uncertain"].includes(entry.item.status) || !entry.item.retryable)
      return;
    entry.item = {
      ...entry.item,
      status: "queued",
      progress: null,
      errorKey: undefined,
      retryable: false,
    };
    await this.resume(projectId);
  }

  async check(projectId: string, id: string): Promise<void> {
    const queue = this.projects.get(projectId);
    const entry = queue?.entries.find(({ item }) => item.id === id);
    if (!queue || !entry || entry.item.status !== "uncertain" || this.running.has(projectId) || !this.options.resolve) return;
    if (!this.options.claim(projectId)) {
      queue.notice = "fileUploadBusy";
      this.emit(projectId);
      return;
    }
    this.running.add(projectId);
    entry.item = { ...entry.item, checking: true, retryable: false, errorKey: undefined };
    queue.notice = null;
    this.emit(projectId);
    try {
      const outcome = await this.options.resolve(projectId, id, entry.pending?.schema === 2 ? entry.pending.sha256 : undefined);
      if (outcome === null) {
        // Absence cannot cancel an older request still in flight. Only a
        // same-ID retry is safe, never a newly generated upload intent.
        entry.item = { ...entry.item, errorKey: entry.file ? "fileUploadNotConfirmed" : entry.item.reselectable ? "fileUploadReselectAvailable" : "fileUploadRecoveredNotConfirmed", retryable: !!entry.file };
      } else {
        await this.confirm(projectId, entry, queue, outcome);
      }
    } catch {
      entry.item = { ...entry.item, errorKey: "fileUploadCheckFailed", retryable: false };
    } finally {
      entry.item = { ...entry.item, checking: false };
      this.running.delete(projectId);
      this.options.release(projectId);
      this.emit(projectId);
    }
  }

  /** Explicitly reattach verified original bytes; a recovered legacy record cannot be upgraded by guessing. */
  async reselect(projectId: string, id: string, file: File): Promise<void> {
    const queue = this.projects.get(projectId);
    const entry = queue?.entries.find(({ item }) => item.id === id);
    if (!queue || !entry?.item.reselectable || entry.item.status !== "uncertain" || entry.pending?.schema !== 2
      || this.running.has(projectId) || !this.options.journal || !this.options.resolve) return;
    const pending = entry.pending;
    if (file.name !== pending.name || file.size !== pending.size) {
      entry.item = { ...entry.item, errorKey: "fileUploadReselectMismatch" };
      this.emit(projectId); return;
    }
    if (!this.options.claim(projectId)) {
      queue.notice = "fileUploadBusy"; this.emit(projectId); return;
    }
    this.running.add(projectId);
    const controller = new AbortController();
    entry.controller = controller;
    entry.item = { ...entry.item, checking: true, errorKey: undefined, retryable: false };
    queue.notice = null;
    this.emit(projectId);
    let matched = false;
    let reading = false;
    try {
      await this.options.journal.require(pending);
      const outcome = await this.options.resolve(projectId, id, pending.sha256);
      if (outcome !== null) { await this.confirm(projectId, entry, queue, outcome); return; }
      reading = true;
      entry.item = { ...entry.item, checking: false, verifying: true, progress: 0 };
      this.emit(projectId);
      const digest = await (this.options.digest ?? fileContentDigest)(file, (fraction) => {
        this.readingProgress(projectId, entry, fraction);
      }, controller.signal);
      controller.signal.throwIfAborted();
      if (digest !== pending.sha256) {
        entry.item = { ...entry.item, errorKey: "fileUploadReselectMismatch" }; return;
      }
      await this.options.journal.require(pending);
      controller.signal.throwIfAborted();
      entry.file = file;
      entry.item = { ...entry.item, retryable: true, reselectable: false };
      matched = true;
    } catch (error) {
      entry.item = { ...entry.item, errorKey: controller.signal.aborted ? undefined
        : error instanceof UploadJournalError ? error.reason === "changed" ? "fileUploadRecoveryChanged" : "fileUploadRecoveryUnavailable"
        : reading ? "fileUploadReadFailed" : "fileUploadCheckFailed" };
    } finally {
      entry.controller = undefined;
      entry.item = { ...entry.item, checking: false, verifying: false, progress: entry.item.status === "added" ? 100 : null };
      this.running.delete(projectId); this.options.release(projectId); this.emit(projectId);
    }
    // Reattaching bytes must not lift a hold requested before or during verification.
    // The verified file remains retryable with the same request identity.
    if (matched && !this.paused.has(projectId)) await this.retry(projectId, id);
  }

  async resume(projectId: string): Promise<void> {
    const queue = this.projects.get(projectId);
    if (
      !queue ||
      this.running.has(projectId) ||
      !queue.entries.some(({ item }) => item.status === "queued")
    )
      return;
    if (!this.options.claim(projectId)) {
      queue.notice = "fileUploadBusy";
      this.emit(projectId);
      return;
    }
    this.running.add(projectId);
    this.paused.delete(projectId);
    queue.notice = null;
    this.emit(projectId);
    let attempted = false;
    try {
      for (;;) {
        if (this.paused.has(projectId)) break;
        const entry = queue.entries.find(
          ({ item }) => item.status === "queued",
        );
        if (!entry?.file) break;
        const attempt = Symbol();
        entry.attempt = attempt;
        const controller = new AbortController();
        entry.controller = controller;
        entry.item = { ...entry.item, status: "preparing", progress: null };
        this.emit(projectId);
        let dispatched = false;
        let reading = false;
        try {
          if (this.options.journal) {
            if (entry.pending) await this.options.journal.require(entry.pending);
            else {
              reading = true;
              const digest = await (this.options.digest ?? fileContentDigest)(entry.file, (fraction) => {
                this.readingProgress(projectId, entry, fraction);
              }, controller.signal);
              reading = false;
              controller.signal.throwIfAborted();
              entry.pending = await this.options.journal.prepare(projectId, entry.item.id, entry.file, digest);
            }
          }
          controller.signal.throwIfAborted();
          entry.item = { ...entry.item, status: "uploading", progress: null };
          this.emit(projectId);
          attempted = true;
          dispatched = true;
          await this.options.send(projectId, entry.file, (fraction) => {
            if (
              entry.attempt !== attempt ||
              !["uploading", "saving"].includes(entry.item.status)
            )
              return;
            if (fraction === null || !Number.isFinite(fraction)) return;
            const progress = Math.max(
              entry.item.progress ?? 0,
              Math.min(100, Math.max(0, Math.floor(fraction * 100))),
            );
            if (entry.item.progress === progress) return;
            entry.item = {
              ...entry.item,
              progress,
              status: progress === 100 ? "saving" : "uploading",
            };
            this.emit(projectId);
          }, entry.item.id, entry.pending?.schema === 2 ? entry.pending.sha256 : undefined);
          entry.item = { ...entry.item, status: "added", progress: 100 };
          entry.unconfirmedAttempt = false;
          entry.file = undefined;
          await this.settleJournal(entry, queue);
        } catch (error) {
          if (!dispatched) {
            if (controller.signal.aborted) {
              entry.item = { ...entry.item, status: entry.unconfirmedAttempt ? "uncertain" : "cancelled", progress: null,
                retryable: false, errorKey: undefined };
              if (!entry.unconfirmedAttempt) { entry.file = undefined; await this.settleJournal(entry, queue); }
              continue;
            }
            const reason = error instanceof UploadJournalError ? error.reason : "unavailable";
            entry.item = { ...entry.item, status: entry.unconfirmedAttempt ? "uncertain" : "failed",
              retryable: !entry.unconfirmedAttempt && reason !== "changed",
              errorKey: reading ? "fileUploadReadFailed" : reason === "limit" ? "fileUploadRecoveryLimit" : reason === "changed" ? "fileUploadRecoveryChanged" : "fileUploadRecoveryUnavailable" };
            break;
          }
          const errorKey = fileUploadErrorKey(error);
          if (errorKey === "fileUploadOutcomeUnknown") entry.unconfirmedAttempt = true;
          const removed = errorKey === "fileUploadSourceRemoved";
          const uncertain = !!entry.unconfirmedAttempt && !removed;
          // Rejection of this attempt cannot disprove an older in-flight commit.
          const canRetry = !uncertain && retryable.has(errorKey);
          entry.item = {
            ...entry.item,
            status: uncertain ? "uncertain" : removed ? "removed" : "failed",
            errorKey: uncertain ? "fileUploadOutcomeUnknown" : errorKey,
            retryable: canRetry,
          };
          if (!canRetry && !uncertain) entry.file = undefined;
          if (!uncertain) await this.settleJournal(entry, queue);
          if (uncertain || pauseAfter.has(errorKey)) break;
        } finally {
          entry.controller = undefined;
          entry.attempt = undefined;
          this.emit(projectId);
        }
      }
    } finally {
      try {
        // Refresh once per completed/paused batch, not six requests per file.
        if (attempted) await this.options.settled(projectId);
      } catch {
        queue.notice = "fileUploadListRefreshFailed";
      } finally {
        this.finishBatch(projectId, queue);
      }
    }
  }

  private finishBatch(projectId: string, queue: ProjectQueue) {
    // Inspect current state: enqueue and journal work can change it while awaiting.
    this.running.delete(projectId);
    this.options.release(projectId);
    const hasWaitingFiles = queue.entries.some(({item}) => item.status === "queued");
    if (!hasWaitingFiles) {
      this.paused.delete(projectId);
      if (queue.notice === "fileUploadQueuePending") queue.notice = null;
    }
    this.emit(projectId);
  }
}
