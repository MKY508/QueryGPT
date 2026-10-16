import "fake-indexeddb/auto";
import { openDB } from "idb";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as journal from "@/lib/report-copy-journal";

const intent = () => ({ request_id: crypto.randomUUID(), expected_version: 3, title: "下期报告" });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("persistent copy journal", () => {
  it("commits one immutable intent per source and finds it from a reopened module", async () => {
    const project = crypto.randomUUID(), source = crypto.randomUUID();
    const left = intent(), right = intent();
    const results = await Promise.all([
      journal.preparePendingCopy(project, source, "原报告", left),
      journal.preparePendingCopy(project, source, "原报告", right),
    ]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results[0].pending).toEqual(results[1].pending);
    expect((await journal.listPendingCopies(project)).total).toBe(1);
    vi.resetModules();
    const reopened = await import("@/lib/report-copy-journal");
    const recovered = await reopened.pendingCopyForSource(project, source);
    expect(recovered).toEqual(results[0].pending);
    expect(recovered!.request).toEqual(results.find((result) => result.created)!.pending.request);
    expect(await reopened.removePendingCopy({ ...recovered!, request: { ...recovered!.request, title: "stale" } })).toBe(false);
    expect(await journal.requirePendingCopy(recovered!)).toEqual(recovered);
  });

  it("paginates within the project and a stale dismissal cannot erase a replacement", async () => {
    const project = crypto.randomUUID(), other = crypto.randomUUID();
    const copies = await Promise.all(Array.from({ length: 12 }, () => journal.preparePendingCopy(project, crypto.randomUUID(), "原报告", intent())));
    await journal.preparePendingCopy(other, crypto.randomUUID(), "别的项目", intent());
    const first = await journal.listPendingCopies(project);
    expect(first.total).toBe(12); expect(first.items).toHaveLength(10); expect(first.next).not.toBeNull();
    const second = await journal.listPendingCopies(project, first.next);
    expect(second.items).toHaveLength(2); expect(second.next).toBeNull();
    expect(new Set([...first.items, ...second.items].map((copy) => copy.id)).size).toBe(12);
    const old = copies[0].pending;
    expect(await journal.removePendingCopy(old)).toBe(true);
    const next = (await journal.preparePendingCopy(project, old.sourceReportId, "新的操作", intent())).pending;
    expect(await journal.removePendingCopy(old)).toBe(true);
    expect(await journal.pendingCopyForSource(project, old.sourceReportId)).toEqual(next);
    await expect(journal.requirePendingCopy(old)).rejects.toThrow();
  });

  it("fails closed on unavailable/quota/corrupt storage without making notifications a write failure", async () => {
    const project = crypto.randomUUID(), source = crypto.randomUUID();
    const add = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    await expect(journal.preparePendingCopy(project, source, "原报告", intent())).rejects.toThrow("Full");
    add.mockRestore();
    expect((await journal.listPendingCopies(project)).total).toBe(0);
    const nativeChannel = Object.getOwnPropertyDescriptor(window, "BroadcastChannel");
    Object.defineProperty(window, "BroadcastChannel", { configurable: true, value: class { constructor() { throw new Error("unavailable"); } } });
    try {
      const changed = vi.fn(); const unsubscribe = journal.subscribePendingCopies(project, changed);
      const pending = (await journal.preparePendingCopy(project, source, "原报告", intent())).pending;
      expect(changed).toHaveBeenCalledTimes(1); unsubscribe();
      const db = await openDB("receiptbi-report-copy-journal", 1);
      await db.put("copies", { ...pending, request: { ...pending.request, expected_version: "forged" } });
      db.close();
      await expect(journal.pendingCopyForSource(project, source)).rejects.toThrow();
      await expect(journal.listPendingCopies(project)).rejects.toThrow();
      await expect(journal.removePendingCopy(pending)).rejects.toThrow();
    } finally {
      if (nativeChannel) Object.defineProperty(window, "BroadcastChannel", nativeChannel); else Reflect.deleteProperty(window, "BroadcastChannel");
    }
    vi.stubGlobal("indexedDB", undefined);
    await expect(journal.preparePendingCopy(crypto.randomUUID(), crypto.randomUUID(), "原报告", intent())).rejects.toThrow();
  });
});
