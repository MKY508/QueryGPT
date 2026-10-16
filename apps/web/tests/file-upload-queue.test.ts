import { describe, expect, it, vi } from "vitest";
import { FileUploadQueue, MAX_UPLOAD_ITEMS } from "@/lib/file-upload-queue";
import { FILE_UPLOAD_ACCEPT, isSupportedUploadFile } from "@/lib/file-formats";

const file = (name = "orders.csv") => new File(["id,amount\n1,10\n"], name);
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, failed) => {
    resolve = done;
    reject = failed;
  });
  return { promise, resolve, reject };
}
function makeQueue(
  send = vi.fn(
    async (
      _id: string,
      _file: File,
      _progress: (fraction: number | null) => void,
    ) => {},
  ),
) {
  const options = {
    send,
    claim: vi.fn(() => true),
    release: vi.fn(),
    changed: vi.fn(),
    settled: vi.fn(async () => {}),
  };
  return { queue: new FileUploadQueue(options), ...options };
}

describe("sequential project upload queue", () => {
  it("holds waiting uploads through current-file acknowledgement and list refresh, then resumes their original files", async () => {
    const current = deferred(), refresh = deferred();
    const { queue, send, settled, release } = makeQueue();
    const selected = [file("first.csv"), file("second.csv")];
    send.mockImplementationOnce(async (_project, _file, progress) => { progress(1); await current.promise; });
    settled.mockImplementationOnce(() => refresh.promise);
    const running = queue.enqueue("A", selected);
    const ids = queue.snapshot("A").items.map(item => item.id);
    queue.pause("A");
    expect(queue.snapshot("A")).toMatchObject({ paused: true, busy: true });
    expect(queue.snapshot("A").items[0]).toMatchObject({ status: "saving", progress: 100 });
    await queue.resume("A"); // Cannot overlap the still-active file or refresh.
    expect(queue.snapshot("A").paused).toBe(true);
    current.resolve();
    await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
    refresh.resolve(); await running;
    expect(queue.snapshot("A")).toMatchObject({ paused: true, busy: false });
    expect(queue.snapshot("A").items.map(item => item.status)).toEqual(["added", "queued"]);
    expect(release).toHaveBeenCalledExactlyOnceWith("A");
    await Promise.all([queue.resume("A"), queue.resume("A")]);
    expect(send.mock.calls.map(call => call[1])).toEqual(selected);
    expect(queue.snapshot("A").items.map(item => item.id)).toEqual(ids);
    expect(queue.snapshot("A").items.map(item => item.status)).toEqual(["added", "added"]);
    expect(queue.snapshot("A").paused).not.toBe(true);
    expect(settled).toHaveBeenCalledTimes(2);
  });

  it("holds only its project and does not resend an uncertain active file when continuing the remainder", async () => {
    const current = deferred();
    const { queue, send } = makeQueue();
    send.mockImplementationOnce(() => current.promise);
    const running = queue.enqueue("A", [file("unknown.csv"), file("remaining.csv")]);
    queue.pause("A");
    await queue.enqueue("B", [file("other.csv")]);
    expect(queue.snapshot("B").items[0].status).toBe("added");
    expect(queue.snapshot("B").paused).not.toBe(true);
    current.reject(new Error("lost reply")); await running;
    expect(queue.snapshot("A")).toMatchObject({ paused: true, busy: false });
    expect(queue.snapshot("A").items[0]).toMatchObject({ status: "uncertain", retryable: false });
    await queue.resume("A");
    expect(send.mock.calls.map(call => call[1].name)).toEqual(["unknown.csv", "other.csv", "remaining.csv"]);
    expect(queue.snapshot("A").items[0].status).toBe("uncertain");
  });

  it("adds files to an idle held batch without starting them or bypassing its whole-selection limit", async () => {
    const current = deferred();
    const { queue, send } = makeQueue();
    send.mockImplementationOnce(() => current.promise);
    const running = queue.enqueue("A", [file("first.csv"), file("waiting.csv")]);
    queue.pause("A"); current.resolve(); await running;
    await queue.enqueue("A", [file("later.csv")]);
    expect(queue.snapshot("A")).toMatchObject({ paused: true, busy: false });
    expect(queue.snapshot("A").items.map(item => item.name)).toEqual(["first.csv", "waiting.csv", "later.csv"]);
    expect(send).toHaveBeenCalledOnce();
    await queue.enqueue("A", Array.from({ length: MAX_UPLOAD_ITEMS }, (_, index) => file(`excess-${index}.csv`)));
    expect(queue.snapshot("A").items).toHaveLength(3);
    expect(queue.snapshot("A").notice).toBe("fileUploadQueueLimit");
    await queue.resume("A");
    expect(send.mock.calls.map(call => call[1].name)).toEqual(["first.csv", "waiting.csv", "later.csv"]);
  });

  it("cancels held waiting files without retaining a stale hold or cancelling the active upload", async () => {
    const current = deferred();
    const { queue, send } = makeQueue();
    send.mockImplementationOnce(() => current.promise);
    const running = queue.enqueue("A", [file("first.csv"), file("waiting.csv"), file("last.csv")]);
    queue.pause("A");
    queue.cancel("A", queue.snapshot("A").items[1].id);
    expect(queue.snapshot("A").paused).toBe(true);
    queue.cancelWaiting("A");
    expect(queue.snapshot("A").paused).not.toBe(true);
    expect(queue.snapshot("A").items.map(item => item.status)).toEqual(["uploading", "cancelled", "cancelled"]);
    current.resolve(); await running;
    await queue.clear("A");
    queue.pause("A");
    expect(queue.snapshot("A").paused).not.toBe(true);
    await queue.enqueue("A", [file("new.csv")]);
    expect(send.mock.calls.map(call => call[1].name)).toEqual(["first.csv", "new.csv"]);
  });

  it("upload reconciliation checks without sending and only retries the original identity after an absent result", async () => {
    const send = vi.fn(async (_project: string, _file: File, _progress: (fraction: number | null) => void, _id: string) => {});
    send.mockRejectedValueOnce(new Error("lost response"));
    send.mockRejectedValueOnce({ response: { status: 429, data: { detail: { code: "file_upload_busy" } } } });
    const resolve = vi.fn<() => Promise<"added" | "removed" | null>>().mockResolvedValueOnce(null);
    const settled = vi.fn(async () => {});
    const queue = new FileUploadQueue({ send, resolve, settled, claim: () => true, release: vi.fn(), changed: vi.fn() });
    await queue.enqueue("A", [file()]);
    const id = queue.snapshot("A").items[0].id;
    await queue.retry("A", id);
    expect(send).toHaveBeenCalledTimes(1);
    await queue.check("A", id);
    expect(queue.snapshot("A").items[0]).toMatchObject({ status: "uncertain", retryable: true });
    expect(send).toHaveBeenCalledTimes(1);
    await queue.retry("A", id);
    expect(send.mock.calls.map((call) => call[3])).toEqual([id, id]);
    expect(queue.snapshot("A").items[0]).toMatchObject({ status: "uncertain", retryable: false });
    resolve.mockResolvedValueOnce("added");
    await queue.check("A", id);
    expect(queue.snapshot("A").items[0].status).toBe("added");
    expect(send.mock.calls[0][1]).toBe(send.mock.calls[1][1]);
  });

  it("upload reconciliation handles unavailable reads, late answers, repeated clicks and removed sources", async () => {
    const send = vi.fn(async () => { throw new Error("lost response"); });
    let finish!: (value: "added" | "removed" | null) => void;
    const resolve = vi.fn<() => Promise<"added" | "removed" | null>>()
      .mockRejectedValueOnce(new Error("private error"))
      .mockImplementationOnce(() => new Promise((done) => { finish = done; }))
      .mockResolvedValueOnce("removed");
    const settled = vi.fn(async () => {});
    const queue = new FileUploadQueue({ send, resolve, settled, claim: () => true, release: vi.fn(), changed: vi.fn() });
    await queue.enqueue("A", [file()]);
    const id = queue.snapshot("A").items[0].id;
    await queue.check("A", id);
    expect(queue.snapshot("A").items[0]).toMatchObject({ status: "uncertain", retryable: false, errorKey: "fileUploadCheckFailed" });
    await queue.enqueue("B", [file("other.csv")]);
    const other = queue.snapshot("B");
    const checking = queue.check("A", id);
    await queue.check("A", id);
    queue.clear("A");
    await queue.retry("A", id);
    expect(queue.snapshot("A").items[0].checking).toBe(true);
    expect(resolve).toHaveBeenCalledTimes(2);
    finish("added");
    await checking;
    expect(queue.snapshot("A").items[0]).toMatchObject({ status: "added", checking: false });
    expect(queue.snapshot("B")).toEqual(other);
    await queue.check("B", other.items[0].id);
    expect(queue.snapshot("B").items[0]).toMatchObject({ status: "removed", retryable: false });
    await queue.retry("B", other.items[0].id);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("accepts the registered JSON Lines extensions without admitting double-extension archives", async () => {
    for (const extension of FILE_UPLOAD_ACCEPT.split(",")) {
      expect(isSupportedUploadFile(`orders${extension.toUpperCase()}`)).toBe(true);
    }
    for (const name of ["orders.jsonl.gz", "orders.ndjson.exe", "orders", "orders.jsonl "]) {
      expect(isSupportedUploadFile(name)).toBe(false);
    }
    const { queue, send } = makeQueue();
    await queue.enqueue("A", [file("orders.JSONL"), file("stores.ndjson"), file("archive.jsonl.gz")]);
    expect(send.mock.calls.map(([, selected]) => selected.name)).toEqual(["orders.JSONL", "stores.ndjson"]);
    expect(queue.snapshot("A").items.map((item) => item.status)).toEqual(["added", "added", "failed"]);
    expect(queue.snapshot("A").items[2].errorKey).toBe("fileUploadUnsupported");
  });

  it("cancels an entire waiting batch atomically without touching the active file or another project", async () => {
    const pending = deferred();
    const { queue, send, changed, claim } = makeQueue();
    send.mockImplementationOnce(async () => pending.promise);
    const run = queue.enqueue("A", [file(), file("stores.csv"), file("returns.csv")]);
    claim.mockReturnValueOnce(false);
    await queue.enqueue("B", [file("other.csv")]);
    changed.mockClear();
    queue.cancelWaiting("A");
    expect(changed).toHaveBeenCalledTimes(1);
    expect(queue.snapshot("A").items.map((item) => item.status)).toEqual(["uploading", "cancelled", "cancelled"]);
    expect(queue.snapshot("B").items[0].status).toBe("queued");
    queue.cancelWaiting("A");
    expect(changed).toHaveBeenCalledTimes(1);
    pending.resolve();
    await run;
    expect(send).toHaveBeenCalledTimes(1);
    expect(queue.snapshot("A").items[0].status).toBe("added");
  });

  it("keeps every selected file, separates transfer from acknowledgement, and refreshes once", async () => {
    const first = deferred();
    const { queue, send, settled } = makeQueue();
    send.mockImplementationOnce(async (_id, _file, progress) => {
      progress(1);
      progress(0.3); // Out-of-order progress cannot move backwards.
      await first.promise;
    });
    const run = queue.enqueue("A", [
      file(),
      file("stores.csv"),
      file("returns.csv"),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(queue.snapshot("A").items.map((item) => item.status)).toEqual([
      "saving",
      "queued",
      "queued",
    ]);
    expect(queue.snapshot("A").items[0].progress).toBe(100);
    first.resolve();
    await run;
    expect(send.mock.calls.map(([, selected]) => selected.name)).toEqual([
      "orders.csv",
      "stores.csv",
      "returns.csv",
    ]);
    expect(
      queue.snapshot("A").items.every((item) => item.status === "added"),
    ).toBe(true);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(queue.snapshot("A"))).not.toContain("id,amount");
  });

  it("pauses unknown outcomes without retrying them and resumes only remaining files", async () => {
    const { queue, send } = makeQueue();
    send.mockRejectedValueOnce(new Error("connection lost"));
    await queue.enqueue("A", [file(), file("stores.csv")]);
    const [uncertain] = queue.snapshot("A").items;
    expect(uncertain.status).toBe("uncertain");
    expect(uncertain.retryable).toBe(false);
    await queue.retry("A", uncertain.id);
    expect(send).toHaveBeenCalledTimes(1);
    await queue.resume("A");
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][1].name).toBe("stores.csv");
    expect(queue.snapshot("A").items.map((item) => item.status)).toEqual([
      "uncertain",
      "added",
    ]);
  });

  it("retries known transient failures explicitly and ignores late progress from the old attempt", async () => {
    const { queue, send } = makeQueue();
    let lateProgress!: (fraction: number | null) => void;
    send.mockImplementationOnce(async (_id, _file, progress) => {
      lateProgress = progress;
      throw {
        response: {
          status: 429,
          data: { detail: { code: "file_upload_busy" } },
        },
      };
    });
    await queue.enqueue("A", [file(), file("stores.csv")]);
    const item = queue.snapshot("A").items[0];
    expect(item.retryable).toBe(true);
    const retry = deferred();
    send.mockImplementationOnce(async () => retry.promise);
    const run = queue.retry("A", item.id);
    lateProgress(1);
    expect(queue.snapshot("A").items[0].status).toBe("uploading");
    retry.resolve();
    await run;
    expect(send).toHaveBeenCalledTimes(3);
    expect(
      queue.snapshot("A").items.every((entry) => entry.status === "added"),
    ).toBe(true);
  });

  it("cancels only waiting files, isolates projects and preserves outcomes when clearing is unsafe", async () => {
    const pending = deferred();
    const { queue, send } = makeQueue();
    send.mockImplementationOnce(async () => pending.promise);
    const run = queue.enqueue("A", [file(), file("stores.csv")]);
    const [active, waiting] = queue.snapshot("A").items;
    queue.cancel("A", active.id);
    queue.cancel("A", waiting.id);
    queue.clear("A");
    expect(queue.snapshot("A").items.map((item) => item.status)).toEqual([
      "uploading",
      "cancelled",
    ]);
    await queue.enqueue("B", [file("other.csv")]);
    expect(queue.snapshot("B").items[0].status).toBe("added");
    expect(queue.snapshot("A").busy).toBe(true);
    pending.resolve();
    await run;
    expect(send).toHaveBeenCalledTimes(2);
    queue.clear("A");
    expect(queue.snapshot("A").items).toEqual([]);
    expect(queue.snapshot("B").items).toHaveLength(1);
  });

  it("rejects an oversized selection as a whole and shows unsupported/empty files individually", async () => {
    const { queue, send } = makeQueue();
    await queue.enqueue(
      "A",
      Array.from({ length: MAX_UPLOAD_ITEMS + 1 }, () => file()),
    );
    expect(send).not.toHaveBeenCalled();
    expect(queue.snapshot("A").notice).toBe("fileUploadQueueLimit");
    expect(queue.snapshot("A").items).toHaveLength(0);
    await queue.enqueue("A", [
      new File([], "empty.csv"),
      file("notes.pdf"),
      file(),
    ]);
    expect(queue.snapshot("A").items.map((item) => item.status)).toEqual([
      "failed",
      "failed",
      "added",
    ]);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
