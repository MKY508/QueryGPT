import { FILE_DIGEST_IDLE_TIMEOUT, FILE_DIGEST_START_TIMEOUT, FILE_DIGEST_WAITING_LIMIT, FILE_DIGEST_WORKERS, type DigestRequest } from "./file-content-digest-protocol";
export { FILE_DIGEST_CHUNK_BYTES } from "./file-content-digest-protocol";

const unavailable = () => new Error("File verification unavailable");
const cancelled = () => new DOMException("File read cancelled", "AbortError");

function digestInWorker(file: Blob, progress?: (fraction: number) => void, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    // This literal form lets both Turbopack and webpack emit the worker entry/chunks.
    const worker = new Worker(new URL("./file-content-digest.worker.ts", import.meta.url), { type: "module", name: "receiptbi-file-check" });
    let done = false;
    let ready = false;
    let loaded = 0;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error?: Error, sha256?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      worker.terminate();
      if (error) reject(error); else resolve(sha256!);
    };
    const abort = () => finish(cancelled());
    const watch = (timeout: number) => { clearTimeout(timer); timer = setTimeout(() => finish(unavailable()), timeout); };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = (event) => { event.preventDefault(); finish(unavailable()); };
    worker.onmessageerror = () => finish(unavailable());
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (done) return;
      const message = event.data;
      if (!message || typeof message !== "object" || !("version" in message) || message.version !== 1 || !("type" in message)) {
        finish(unavailable()); return;
      }
      if (message.type === "ready" && !ready) {
        ready = true;
        watch(FILE_DIGEST_IDLE_TIMEOUT);
        try { worker.postMessage({ version: 1, file } satisfies DigestRequest); }
        catch { finish(unavailable()); }
      } else if (message.type === "progress" && ready && "loaded" in message && "total" in message
        && typeof message.loaded === "number" && Number.isSafeInteger(message.loaded) && message.total === file.size
        && message.loaded > loaded && message.loaded <= file.size) {
        loaded = message.loaded;
        watch(FILE_DIGEST_IDLE_TIMEOUT);
        try { progress?.(loaded / file.size); } catch { finish(unavailable()); }
      } else if (message.type === "done" && ready && loaded === file.size && "sha256" in message
        && typeof message.sha256 === "string" && /^[0-9a-f]{64}$/.test(message.sha256)) {
        finish(undefined, message.sha256);
      } else finish(unavailable());
    };
    watch(FILE_DIGEST_START_TIMEOUT);
    if (signal?.aborted) abort();
  });
}

const waiting: Array<() => void> = [];
let active = 0;
function pump() { while (active < FILE_DIGEST_WORKERS && waiting.length) waiting.shift()!(); }

/** Bound CPU concurrency across projects; each attempt owns and disposes its worker. */
export async function fileContentDigest(file: Blob, progress?: (fraction: number) => void, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  if (waiting.length >= FILE_DIGEST_WAITING_LIMIT) throw unavailable();
  return new Promise((resolve, reject) => {
    const abortWaiting = () => {
      const index = waiting.indexOf(start);
      if (index >= 0) waiting.splice(index, 1);
      signal?.removeEventListener("abort", abortWaiting);
      reject(cancelled());
    };
    const start = () => {
      signal?.removeEventListener("abort", abortWaiting);
      active++;
      const read = async () => {
        signal?.throwIfAborted();
        // No silent main-thread fallback after a worker crashes or fails to load.
        if (typeof Worker !== "undefined") return digestInWorker(file, progress, signal);
        const { digestFileChunks } = await import("./file-content-digest-core");
        return digestFileChunks(file, progress, signal);
      };
      void read().then(resolve, reject).finally(() => { active--; pump(); });
    };
    waiting.push(start);
    signal?.addEventListener("abort", abortWaiting, { once: true });
    if (signal?.aborted) abortWaiting();
    pump();
  });
}
