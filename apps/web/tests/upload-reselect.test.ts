import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileUploadQueue } from "@/lib/file-upload-queue";
import { fileContentDigest } from "@/lib/file-content-digest";
import { listPendingUploads, uploadJournal } from "@/lib/upload-journal";
import { hasUnfinishedUploads } from "@/lib/upload-lifecycle";

const originalFile = () => new File(["id,amount\n1,10\n"], "orders.csv");
function fixture() {
  const send = vi.fn(async (_project: string, _file: File, _progress: (fraction: number | null) => void, _id: string, _hash?: string) => {});
  const resolve = vi.fn<() => Promise<"added" | "removed" | null>>().mockResolvedValue(null);
  const journal = { ...uploadJournal };
  const digest = vi.fn(fileContentDigest);
  const settled = vi.fn(async () => {});
  const queue = new FileUploadQueue({ send, resolve, journal, digest, settled, claim: () => true, release: vi.fn(), changed: vi.fn() });
  return { queue, send, resolve, journal, digest, settled };
}
async function saved() {
  const file = originalFile(), project = crypto.randomUUID();
  const hash = await fileContentDigest(file);
  const record = await uploadJournal.prepare(project, crypto.randomUUID(), file, hash);
  return { file, project, hash, record };
}
afterEach(async () => { await uploadJournal.remove(await listPendingUploads()); vi.restoreAllMocks(); });

describe("verified original-file reselection", () => {
  it("keeps a held batch stopped after original-file verification until an explicit same-identity retry", async () => {
    const { project, record, file, hash } = await saved();
    const next = fixture(); next.queue.restore([record]);
    next.digest.mockImplementationOnce(async selected => {
      next.queue.pause(project);
      return fileContentDigest(selected);
    });
    await next.queue.enqueue(project, [new File(["id\n2"], "current.csv"), new File(["id\n3"], "waiting.csv")]);
    expect(next.send).toHaveBeenCalledOnce();
    expect(next.queue.snapshot(project)).toMatchObject({ paused: true, busy: false });
    await next.queue.reselect(project, record.id, file);
    expect(next.send).toHaveBeenCalledOnce();
    expect(next.queue.snapshot(project).items[0]).toMatchObject({ status: "uncertain", retryable: true, reselectable: false });
    expect(next.queue.snapshot(project).paused).toBe(true);
    await uploadJournal.require(record);
    await next.queue.retry(project, record.id);
    expect(next.send.mock.calls[1]).toEqual([project, file, expect.any(Function), record.id, hash]);
    expect(next.send.mock.calls.map(call => call[1].name)).toEqual(["current.csv", "orders.csv", "waiting.csv"]);
    expect(next.queue.snapshot(project).paused).not.toBe(true);
    expect(await listPendingUploads()).toEqual([]);
  });

  it("retains a full-content identity before first send and resumes the same intent after restoring", async () => {
    const project = crypto.randomUUID(), file = originalFile();
    const first = fixture();
    first.send.mockImplementationOnce(async (_project, selected, _progress, id, hash) => {
      expect(await listPendingUploads()).toContainEqual(expect.objectContaining({ schema: 2, projectId: project, id, sha256: hash }));
      expect(hash).toBe(await fileContentDigest(selected));
      throw new Error("lost response");
    });
    await first.queue.enqueue(project, [file]);
    const records = await listPendingUploads();
    const next = fixture();
    next.queue.restore(records);
    expect(next.send).not.toHaveBeenCalled();
    expect(next.resolve).not.toHaveBeenCalled();
    expect(next.queue.snapshot(project).items[0].reselectable).toBe(true);
    await next.queue.reselect(project, records[0].id, originalFile());
    expect(next.send).toHaveBeenCalledOnce();
    expect(next.send.mock.calls[0].slice(3)).toEqual(first.send.mock.calls[0].slice(3));
    expect(next.queue.snapshot(project).items[0]).toMatchObject({ status: "added", progress: 100, reselectable: false });
    expect(await listPendingUploads()).toEqual([]);
  });

  it("rejects a different name, size or same-length content and never guesses legacy file identity", async () => {
    const { project, record, file } = await saved();
    const next = fixture(); next.queue.restore([record]);
    for (const wrong of [new File(["short"], file.name), new File(["id,amount\n1,10\n"], "another.csv"), new File(["id,amount\n1,20\n"], file.name)]) {
      await next.queue.reselect(project, record.id, wrong);
      expect(next.queue.snapshot(project).items[0]).toMatchObject({ status: "uncertain", reselectable: true, errorKey: "fileUploadReselectMismatch" });
      await uploadJournal.require(record);
    }
    expect(next.digest).toHaveBeenCalledOnce();
    expect(next.send).not.toHaveBeenCalled();
    const legacy = await uploadJournal.prepare(project, crypto.randomUUID(), file);
    next.queue.restore([record, legacy]);
    await next.queue.reselect(project, legacy.id, file);
    expect(next.queue.snapshot(project).items[1].reselectable).toBe(false);
    expect(next.send).not.toHaveBeenCalled();
  });

  it("checks completed or removed outcomes before reading and refuses to resend on failed checks", async () => {
    for (const outcome of ["added", "removed", "error"] as const) {
      const { project, record, file, hash } = await saved();
      const next = fixture(); next.queue.restore([record]);
      if (outcome === "error") next.resolve.mockRejectedValueOnce(new Error("offline"));
      else next.resolve.mockResolvedValueOnce(outcome);
      await next.queue.reselect(project, record.id, file);
      expect(next.resolve).toHaveBeenCalledWith(project, record.id, hash);
      expect(next.digest).not.toHaveBeenCalled();
      expect(next.send).not.toHaveBeenCalled();
      expect(next.queue.snapshot(project).items[0].status).toBe(outcome === "error" ? "uncertain" : outcome);
      if (outcome === "error") await uploadJournal.require(record);
    }
  });

  it("keeps the original record when verification is cancelled or another window clears it", async () => {
    const { project, record, file, hash } = await saved();
    const next = fixture(); next.queue.restore([record]);
    let finish!: (hash: string) => void;
    next.digest.mockImplementationOnce(async () => new Promise((resolve) => { finish = resolve; }));
    const reading = next.queue.reselect(project, record.id, file);
    await vi.waitFor(() => expect(next.queue.snapshot(project).items[0].verifying).toBe(true));
    expect(hasUnfinishedUploads({ [project]: next.queue.snapshot(project) })).toBe(true);
    await next.queue.clear(project);
    await next.queue.reselect(project, record.id, file); // No overlapping read or upload.
    next.queue.cancel(project, record.id); finish(hash); await reading;
    expect(next.queue.snapshot(project).items[0]).toMatchObject({ status: "uncertain", reselectable: true, verifying: false });
    await uploadJournal.require(record);
    next.digest.mockImplementationOnce(async () => { await uploadJournal.remove([record]); return hash; });
    await next.queue.reselect(project, record.id, file);
    expect(next.queue.snapshot(project).items[0].errorKey).toBe("fileUploadRecoveryChanged");
    expect(next.send).not.toHaveBeenCalled();
    expect(next.queue.snapshot(project).busy).toBe(false);
  });

  it("can cancel the initial read without persisting or sending, and retains readable failures for retry", async () => {
    const project = crypto.randomUUID(), next = fixture();
    next.digest.mockImplementationOnce(async (_file, _progress, signal) => {
      const item = next.queue.snapshot(project).items[0];
      expect(item.status).toBe("preparing");
      next.queue.cancel(project, item.id); signal?.throwIfAborted(); return "";
    });
    await next.queue.enqueue(project, [originalFile()]);
    expect(next.queue.snapshot(project).items[0].status).toBe("cancelled");
    next.digest.mockRejectedValueOnce(new Error("file missing"));
    await next.queue.enqueue(project, [originalFile()]);
    expect(next.queue.snapshot(project).items[1]).toMatchObject({ status: "failed", retryable: true, errorKey: "fileUploadReadFailed" });
    expect(next.send).not.toHaveBeenCalled();
    expect(await listPendingUploads()).toEqual([]);
  });
});
