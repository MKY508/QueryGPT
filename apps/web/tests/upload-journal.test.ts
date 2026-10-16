import "fake-indexeddb/auto";
import { openDB } from "idb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listPendingUploads, uploadJournal, MAX_PENDING_UPLOADS, type PendingUpload } from "@/lib/upload-journal";

const file = { name: "orders.csv", size: 32 };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("persistent upload journal", () => {
  it("keeps v2 content identity immutable while retaining metadata-only v1 records", async () => {
    const project = crypto.randomUUID(), id = crypto.randomUUID(), hash = "a".repeat(64);
    const legacy = await uploadJournal.prepare(project, crypto.randomUUID(), file);
    const current = await uploadJournal.prepare(project, id, file, hash);
    expect(current).toMatchObject({ schema: 2, sha256: hash });
    expect(await uploadJournal.prepare(project, id, file, hash)).toEqual(current);
    await expect(uploadJournal.prepare(project, id, file, "b".repeat(64))).rejects.toThrow();
    await expect(uploadJournal.prepare(project, legacy.id, file, hash)).rejects.toThrow();
    await expect(uploadJournal.require({ ...current, schema: 2, sha256: "b".repeat(64) })).rejects.toThrow();
    await expect(uploadJournal.remove([legacy, { ...current, schema: 2, sha256: "b".repeat(64) }])).rejects.toThrow();
    expect(await listPendingUploads()).toEqual(expect.arrayContaining([legacy, current]));
    await uploadJournal.remove([legacy, current]);
  });
  it("commits immutable metadata once, reopens it, and conditionally clears a batch", async () => {
    const project = crypto.randomUUID(), id = crypto.randomUUID();
    const [left, right] = await Promise.all([uploadJournal.prepare(project, id, file), uploadJournal.prepare(project, id, file)]);
    expect(left).toEqual(right);
    expect(Object.keys(left).sort()).toEqual(["createdAt", "id", "name", "projectId", "schema", "size"]);
    vi.resetModules();
    const reopened = await import("@/lib/upload-journal");
    expect(await reopened.listPendingUploads()).toContainEqual(left);
    const other = await uploadJournal.prepare(project, crypto.randomUUID(), file);
    await expect(uploadJournal.remove([other, { ...left, size: 999 }])).rejects.toThrow();
    await uploadJournal.require(other); // The whole failed clear rolled back.
    await expect(uploadJournal.prepare(project, id, { ...file, size: 999 })).rejects.toThrow();
    await reopened.uploadJournal.remove([left]);
    await expect(uploadJournal.require(left)).rejects.toThrow();
    const replacement = await uploadJournal.prepare(project, crypto.randomUUID(), file);
    await uploadJournal.remove([left]);
    await uploadJournal.require(replacement);
    await uploadJournal.remove([other, replacement]);
  });

  it("enforces per-project and total caps without pruning and rejects corrupted records", async () => {
    const db = await openDB("receiptbi-upload-recovery", 1);
    const projects = Array.from({ length: 5 }, () => crypto.randomUUID());
    const records: PendingUpload[] = Array.from({ length: MAX_PENDING_UPLOADS }, (_, i) => ({
      schema: 1, projectId: projects[Math.floor(i / 100)], id: crypto.randomUUID(), name: file.name, size: file.size, createdAt: i,
    }));
    let tx = db.transaction("pending", "readwrite");
    for (const record of records.slice(0, 100)) await tx.store.add(record);
    await tx.done;
    await expect(uploadJournal.prepare(projects[0], crypto.randomUUID(), file)).rejects.toThrow();
    tx = db.transaction("pending", "readwrite");
    for (const record of records.slice(100)) await tx.store.add(record);
    await tx.done;
    await expect(uploadJournal.prepare(crypto.randomUUID(), crypto.randomUUID(), file)).rejects.toThrow();
    expect(await listPendingUploads()).toHaveLength(MAX_PENDING_UPLOADS);
    await db.put("pending", { ...records[0], file: "unexpected payload" });
    await expect(listPendingUploads()).rejects.toThrow();
    await expect(uploadJournal.remove([records[0]])).rejects.toThrow();
    await db.put("pending", records[0]);
    await uploadJournal.remove(records);
    db.close();
  });

  it("does not publish partial records on quota failure or confuse notification failure with failed persistence", async () => {
    const project = crypto.randomUUID(), id = crypto.randomUUID();
    vi.spyOn(IDBObjectStore.prototype, "add").mockImplementationOnce(() => { throw new DOMException("full", "QuotaExceededError"); });
    await expect(uploadJournal.prepare(project, id, file)).rejects.toThrow();
    expect((await listPendingUploads()).some((item) => item.id === id)).toBe(false);
    vi.stubGlobal("BroadcastChannel", class { constructor() { throw new Error("unavailable"); } });
    const pending = await uploadJournal.prepare(project, id, file);
    await uploadJournal.require(pending);
    vi.stubGlobal("indexedDB", undefined);
    await expect(listPendingUploads()).rejects.toThrow();
    vi.unstubAllGlobals();
    await uploadJournal.remove([pending]);
  });
});
