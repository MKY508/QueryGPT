import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { FileUploadQueue } from "@/lib/file-upload-queue";
import { listPendingUploads, uploadJournal } from "@/lib/upload-journal";

function queue(send = vi.fn(async (_project: string, _file: File, _progress: (fraction: number | null) => void, _id: string) => {})) {
  const resolve = vi.fn<() => Promise<"added" | "removed" | null>>().mockResolvedValue(null);
  const journal = { ...uploadJournal };
  const settled = vi.fn(async () => {});
  return { queue: new FileUploadQueue({ send, resolve, journal, settled, claim: () => true, release: vi.fn(), changed: vi.fn() }), send, resolve, journal, settled };
}
const file = () => new File(["id,amount\n1,10\n"], "orders.csv");

describe("upload recovery lifecycle", () => {
  it("persists before sending, restores without sending, and keeps a late acknowledgement from resurrecting a cleared record", async () => {
    const project = crypto.randomUUID();
    let finish!: () => void;
    const sent = new Promise<void>((done) => { finish = done; });
    const first = queue(vi.fn(async (_project, selected, _progress, id) => {
      expect(await listPendingUploads()).toContainEqual(expect.objectContaining({ projectId: project, id, size: selected.size }));
      await sent;
    }));
    const sending = first.queue.enqueue(project, [file()]);
    await vi.waitFor(() => expect(first.send).toHaveBeenCalledOnce());
    const records = await listPendingUploads();
    const restored = queue();
    restored.queue.restore(records);
    const id = records[0].id;
    expect(restored.queue.snapshot(project).items[0]).toMatchObject({ status: "uncertain", recovered: true, retryable: false });
    expect(restored.send).not.toHaveBeenCalled();
    expect(restored.resolve).not.toHaveBeenCalled();
    restored.resolve.mockResolvedValueOnce("added");
    await restored.queue.check(project, id);
    expect(await listPendingUploads()).toEqual([]);
    expect(restored.queue.snapshot(project).items[0].status).toBe("added");
    finish();
    await sending;
    expect(await listPendingUploads()).toEqual([]);
    expect(first.send).toHaveBeenCalledOnce();
    expect(restored.send).not.toHaveBeenCalled();
  });

  it("keeps recovered records when checking finds nothing or clearing fails, and never replays missing files", async () => {
    const project = crypto.randomUUID(), other = crypto.randomUUID();
    const record = await uploadJournal.prepare(project, crypto.randomUUID(), file());
    const foreign = await uploadJournal.prepare(other, crypto.randomUUID(), file());
    const restored = queue();
    restored.queue.restore([record, foreign]);
    await restored.queue.check(project, record.id);
    expect(restored.queue.snapshot(project).items[0]).toMatchObject({ status: "uncertain", retryable: false, errorKey: "fileUploadRecoveredNotConfirmed" });
    await restored.queue.retry(project, record.id);
    await restored.queue.resume(project);
    expect(restored.send).not.toHaveBeenCalled();
    restored.journal.remove = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockImplementation(uploadJournal.remove);
    await restored.queue.clear(project);
    expect(restored.queue.snapshot(project).items).toHaveLength(1);
    await uploadJournal.require(record);
    await restored.queue.clear(project);
    restored.queue.restore([record, foreign]); // Late snapshot must not revive dismissed rows.
    expect(restored.queue.snapshot(project).items).toEqual([]);
    await uploadJournal.require(foreign);
    await restored.queue.clear(other);
  });

  it("blocks sends on failed persistence or stale intent, and keeps confirmed success when cleanup fails", async () => {
    const project = crypto.randomUUID();
    const active = queue();
    active.journal.prepare = vi.fn().mockRejectedValueOnce(new Error("full")).mockImplementation(uploadJournal.prepare);
    await active.queue.enqueue(project, [file()]);
    const id = active.queue.snapshot(project).items[0].id;
    expect(active.send).not.toHaveBeenCalled();
    expect(active.settled).not.toHaveBeenCalled();
    expect(active.queue.snapshot(project).items[0]).toMatchObject({ status: "failed", retryable: true, errorKey: "fileUploadRecoveryUnavailable" });
    active.send.mockRejectedValueOnce(new Error("lost response"));
    await active.queue.retry(project, id);
    await active.queue.check(project, id);
    const record = (await listPendingUploads()).find((item) => item.id === id)!;
    await uploadJournal.remove([record]); // Another window dismissed it.
    await active.queue.retry(project, id);
    expect(active.send).toHaveBeenCalledOnce();
    expect(active.queue.snapshot(project).items[0].errorKey).toBe("fileUploadRecoveryChanged");
    expect(await listPendingUploads()).toEqual([]);
    await active.queue.clear(project);
    active.journal.remove = vi.fn().mockRejectedValueOnce(new Error("cleanup failed")).mockImplementation(uploadJournal.remove);
    await active.queue.enqueue(project, [file()]);
    expect(active.queue.snapshot(project).items[0].status).toBe("added");
    expect(active.queue.snapshot(project).notice).toBe("fileUploadRecoveryCleanupFailed");
    expect(await listPendingUploads()).toHaveLength(1);
    await active.queue.clear(project);
    expect(await listPendingUploads()).toEqual([]);
  });
});
