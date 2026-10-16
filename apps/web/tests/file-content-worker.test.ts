import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileContentDigest } from "@/lib/file-content-digest";
import { FILE_DIGEST_IDLE_TIMEOUT, FILE_DIGEST_START_TIMEOUT, FILE_DIGEST_WAITING_LIMIT } from "@/lib/file-content-digest-protocol";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor(public url: URL, public options: WorkerOptions) { FakeWorker.instances.push(this); }
  emit(value: object) { this.onmessage?.({ data: { version: 1, ...value } } as MessageEvent); }
  complete(size: number) { this.emit({ type: "ready" }); this.emit({ type: "progress", loaded: size, total: size }); this.emit({ type: "done", sha256: "a".repeat(64) }); }
}
const file = () => new File(["abcdefgh"], "orders.csv");
beforeEach(() => { FakeWorker.instances = []; vi.stubGlobal("Worker", FakeWorker); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("file verification worker lifetime", () => {
  it("sends a Blob only after readiness, keeps CPU off the page, and ignores late messages", async () => {
    const selected = file(), progress = vi.fn();
    const read = vi.spyOn(FileReader.prototype, "readAsArrayBuffer");
    const pending = fileContentDigest(selected, progress);
    const worker = FakeWorker.instances[0];
    expect(worker.url.pathname).toContain("file-content-digest.worker.ts");
    expect(worker.options).toMatchObject({ type: "module", name: "receiptbi-file-check" });
    expect(worker.postMessage).not.toHaveBeenCalled();
    worker.emit({ type: "ready" });
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ version: 1, file: selected });
    worker.emit({ type: "progress", loaded: 4, total: 8 });
    worker.emit({ type: "progress", loaded: 8, total: 8 });
    const late = worker.onmessage!;
    worker.emit({ type: "done", sha256: "a".repeat(64) });
    expect(await pending).toBe("a".repeat(64));
    expect(progress.mock.calls.flat()).toEqual([0.5, 1]);
    expect(worker.terminate).toHaveBeenCalledOnce();
    late({ data: { version: 1, type: "progress", loaded: 1, total: 8 } } as MessageEvent);
    expect(progress).toHaveBeenCalledTimes(2);
    expect(read).not.toHaveBeenCalled();
  });

  it("limits concurrency, cancels waiting work immediately and releases only the cancelled active worker", async () => {
    const firstController = new AbortController(), waitingController = new AbortController();
    const first = fileContentDigest(file(), undefined, firstController.signal).catch((error) => error);
    const second = fileContentDigest(file());
    const third = fileContentDigest(file(), undefined, waitingController.signal).catch((error) => error);
    const fourth = fileContentDigest(file());
    expect(FakeWorker.instances).toHaveLength(2);
    waitingController.abort();
    expect(await third).toMatchObject({ name: "AbortError" });
    firstController.abort();
    expect(await first).toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(3));
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(FakeWorker.instances[1].terminate).not.toHaveBeenCalled();
    FakeWorker.instances[1].complete(8); FakeWorker.instances[2].complete(8);
    expect(await Promise.all([second, fourth])).toEqual(["a".repeat(64), "a".repeat(64)]);
    const already = new AbortController(); already.abort();
    await expect(fileContentDigest(file(), undefined, already.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeWorker.instances).toHaveLength(3);
  });

  it("fails closed on invalid messages, read/load errors and callback errors without falling back", async () => {
    const read = vi.spyOn(FileReader.prototype, "readAsArrayBuffer");
    const failures = [
      (w: FakeWorker) => w.emit({ type: "done", sha256: "a".repeat(64) }),
      (w: FakeWorker) => { w.emit({ type: "ready" }); w.emit({ type: "progress", loaded: 9, total: 8 }); },
      (w: FakeWorker) => { w.emit({ type: "ready" }); w.emit({ type: "progress", loaded: 8, total: 9 }); },
      (w: FakeWorker) => { w.emit({ type: "ready" }); w.emit({ type: "error" }); },
      (w: FakeWorker) => w.onerror?.(new ErrorEvent("error", { cancelable: true })),
      (w: FakeWorker) => w.onmessageerror?.(),
      (w: FakeWorker) => { w.postMessage.mockImplementationOnce(() => { throw new Error("clone failed"); }); w.emit({ type: "ready" }); },
    ];
    for (const fail of failures) {
      const pending = fileContentDigest(file());
      const worker = FakeWorker.instances.at(-1)!; fail(worker);
      await expect(pending).rejects.toThrow("verification unavailable");
      expect(worker.terminate).toHaveBeenCalledOnce();
    }
    const pending = fileContentDigest(file(), () => { throw new Error("detached view"); });
    FakeWorker.instances.at(-1)!.complete(8);
    await expect(pending).rejects.toThrow("verification unavailable");
    expect(read).not.toHaveBeenCalled();
  });

  it("releases stalled startup and resets the idle deadline on valid progress", async () => {
    vi.useFakeTimers();
    const startup = fileContentDigest(file()).catch((error) => error);
    await vi.advanceTimersByTimeAsync(FILE_DIGEST_START_TIMEOUT);
    expect(await startup).toBeInstanceOf(Error);
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    const idle = fileContentDigest(file()).catch((error) => error);
    const worker = FakeWorker.instances.at(-1)!; worker.emit({ type: "ready" });
    await vi.advanceTimersByTimeAsync(FILE_DIGEST_IDLE_TIMEOUT - 1);
    worker.emit({ type: "progress", loaded: 4, total: 8 });
    await vi.advanceTimersByTimeAsync(FILE_DIGEST_IDLE_TIMEOUT - 1);
    expect(worker.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await idle).toBeInstanceOf(Error);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds waiting file references without pruning earlier work", async () => {
    const controllers = Array.from({ length: FILE_DIGEST_WAITING_LIMIT + 2 }, () => new AbortController());
    const pending = controllers.map((controller) => fileContentDigest(file(), undefined, controller.signal).catch((error) => error));
    expect(FakeWorker.instances).toHaveLength(2);
    await expect(fileContentDigest(file())).rejects.toThrow("verification unavailable");
    expect(FakeWorker.instances).toHaveLength(2);
    controllers.forEach((controller) => controller.abort());
    const results = await Promise.all(pending);
    expect(results.every((error) => error.name === "AbortError")).toBe(true);
    expect(FakeWorker.instances.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
    const fresh = fileContentDigest(file());
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(3));
    FakeWorker.instances[2].complete(8);
    expect(await fresh).toBe("a".repeat(64));
  });
});
