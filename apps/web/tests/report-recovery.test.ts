import "fake-indexeddb/auto";
import { openDB } from "idb";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReportDocument } from "@/lib/reports";
import {
  isReportRecoveryDraft, listReportRecoveryDrafts, loadReportRecoveryDraft, removeReportRecoveryDraft,
  removeRecoveryDraftsForReport, restoreReportRecoveryDraft, ReportRecoveryJournal, type ReportRecoveryDraft,
  acknowledgeReportRecoverySave, reportRecoveryBase, reportRecoverySummary,
} from "@/lib/report-recovery";

function report(): ReportDocument {
  return { id: crypto.randomUUID(), project_id: "recovery-project", title: "Unsaved title", description: "", status: "draft",
    version: 1, created_at: "2026-09-05T00:00:00Z", updated_at: "2026-09-05T00:00:00Z",
    pages: [{ id: "page-1", title: "Overview", order_index: 0, config: {}, blocks: [{
      id: "block-1", title: "Finding", block_type: "text", order_index: 0, source_kind: "artifact", artifact_id: "artifact-1",
      content: { text: "Draft finding" }, config: {}, layout: { x: 0, y: 0, w: 6, h: 4 },
      source_ref: { captured_at: "old" }, source_available: true,
    }] }],
  };
}

const legacyDocument = report();
const legacyDraft: ReportRecoveryDraft = { schema: 1, id: "legacy-session", revision: "legacy-revision",
  projectId: legacyDocument.project_id, reportId: legacyDocument.id, updatedAt: 1, baseVersion: 1, document: legacyDocument };

beforeAll(async () => {
  const old = await openDB("receiptbi-report-recovery", 1, {
    upgrade(db) { db.createObjectStore("drafts", { keyPath: "id" }).createIndex("report", ["projectId", "reportId"]); },
  });
  await old.put("drafts", { ...legacyDraft, unexpectedPayload: "not directory metadata" });
  old.close();
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("report recovery", () => {
  it("retains a pending save across reopen and rebases later edits onto its acknowledged identities", async () => {
    const sent = report();
    sent.pages[0].blocks.push({ ...structuredClone(sent.pages[0].blocks[0]), id: "local-block-new", source_kind: "manual", artifact_id: null });
    const later = structuredClone(sent);
    later.title = "Typed after sending";
    const journal = new ReportRecoveryJournal();
    const pending = { schema: 1 as const, requestId: crypto.randomUUID(), snapshot: sent,
      copy: { unnamedBlock: "Block", textBlock: "Text", unnamedPage: "Page", unnamedReport: "Report" } };
    expect(await journal.beginSave(pending, sent)).toBe(true);
    journal.checkpoint(later);
    await journal.flush();
    const [summary] = (await listReportRecoveryDrafts(sent.project_id, sent.id)).items;
    expect(summary).not.toHaveProperty("pendingSave");
    const reopened = await loadReportRecoveryDraft(summary);
    expect(reopened.pendingSave).toEqual(pending);
    expect(reopened.document.title).toBe(later.title);
    expect(restoreReportRecoveryDraft(reopened, sent)).toBeNull();
    const saved = structuredClone(sent);
    saved.version = 2;
    saved.pages[0].blocks[1].id = "assigned-block";
    expect(await acknowledgeReportRecoverySave(reopened, saved)).toBe(true);
    const [resolvedSummary] = (await listReportRecoveryDrafts(sent.project_id, sent.id)).items;
    const resolved = await loadReportRecoveryDraft(resolvedSummary);
    expect(resolved.pendingSave).toBeUndefined();
    expect(resolved.baseline).toEqual(saved);
    expect(resolved.document.title).toBe(later.title);
    expect(resolved.document.pages[0].blocks.map((block) => block.id)).toEqual(["block-1", "assigned-block"]);
    expect(restoreReportRecoveryDraft(resolved, saved)?.version).toBe(2);
    expect(reportRecoveryBase(resolved, { ...saved, version: 5 })).toEqual(saved);
    expect(reportRecoveryBase({ ...resolved, baseline: undefined }, { ...saved, version: 5 })).toBeNull();
    expect(await acknowledgeReportRecoverySave(reopened, saved)).toBe(false);
    const adopter = new ReportRecoveryJournal();
    expect(await adopter.adopt(resolved, resolved.document)).toBe(true);
    adopter.checkpoint({ ...resolved.document, title: "Edited again" });
    await adopter.flush();
    expect((await loadReportRecoveryDraft((await listReportRecoveryDrafts(sent.project_id, sent.id)).items[0])).baseline).toEqual(saved);
    await adopter.clear();
  });

  it("preserves pending recovery after stale or failed acknowledgement and rejects invalid save metadata", async () => {
    const sent = report();
    const journal = new ReportRecoveryJournal();
    await journal.beginSave({ schema: 1, requestId: crypto.randomUUID(), snapshot: sent,
      copy: { unnamedBlock: "Block", textBlock: "Text", unnamedPage: "Page", unnamedReport: "Report" } }, sent);
    const old = await loadReportRecoveryDraft((await listReportRecoveryDrafts(sent.project_id, sent.id)).items[0]);
    const saved = { ...sent, version: 2 };
    expect(isReportRecoveryDraft({ ...old, pendingSave: { ...old.pendingSave, requestId: "wrong" } })).toBe(false);
    expect(isReportRecoveryDraft({ ...old, baseline: sent })).toBe(false);
    expect(isReportRecoveryDraft({ ...old, pendingSave: { ...old.pendingSave, snapshot: { ...sent, version: 3 } } })).toBe(false);
    expect(await acknowledgeReportRecoverySave(old, { ...saved, project_id: "another" })).toBe(false);
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    await expect(acknowledgeReportRecoverySave(old, saved)).rejects.toThrow("Full");
    put.mockRestore();
    expect(await loadReportRecoveryDraft(reportRecoverySummary(old))).toEqual(old);
    const deletion = vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(() => { throw new DOMException("Deletion failed", "QuotaExceededError"); });
    expect(await journal.clear()).toBe(false);
    deletion.mockRestore();
    expect(await journal.flush()).toBe(true);
    expect(await loadReportRecoveryDraft(reportRecoverySummary(old))).toEqual(old);
    journal.checkpoint({ ...sent, title: "Other window kept editing" });
    await journal.flush();
    expect((await loadReportRecoveryDraft((await listReportRecoveryDrafts(sent.project_id, sent.id)).items[0])).pendingSave).toEqual(old.pendingSave);
    expect(await acknowledgeReportRecoverySave(old, saved)).toBe(false);
    await journal.clear();
  });

  it("migrates v1 drafts into a compact directory without changing the saved body", async () => {
    const page = await listReportRecoveryDrafts(legacyDocument.project_id, legacyDocument.id);
    expect(page).toMatchObject({ total: 1, next: null, items: [{ id: legacyDraft.id, title: legacyDocument.title }] });
    expect(page.items[0]).not.toHaveProperty("document");
    expect(page.items[0]).not.toHaveProperty("unexpectedPayload");
    expect(await loadReportRecoveryDraft(page.items[0])).toMatchObject(legacyDraft);
    await removeRecoveryDraftsForReport(legacyDocument.project_id, legacyDocument.id);
  });

  it("paginates tied timestamps using metadata only and excludes the current session and other reports", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const doc = report();
    const journals = Array.from({ length: 8 }, () => new ReportRecoveryJournal());
    for (const [index, journal] of journals.entries()) {
      journal.checkpoint({ ...doc, title: `Draft ${index}` });
      await journal.flush();
    }
    const unrelated = new ReportRecoveryJournal();
    unrelated.checkpoint({ ...doc, project_id: "another-project" });
    await unrelated.flush();
    const get = vi.spyOn(IDBObjectStore.prototype, "get");
    const options = { limit: 3, excludeId: journals[0].id };
    const first = await listReportRecoveryDrafts(doc.project_id, doc.id, options);
    const second = await listReportRecoveryDrafts(doc.project_id, doc.id, { ...options, before: first.next });
    const third = await listReportRecoveryDrafts(doc.project_id, doc.id, { ...options, before: second.next });
    expect([first.items.length, second.items.length, third.items.length]).toEqual([3, 3, 1]);
    expect([first.total, second.total, third.total]).toEqual([7, 7, 7]);
    expect(third.next).toBeNull();
    const items = [...first.items, ...second.items, ...third.items];
    expect(items.map((item) => item.id)).toEqual(journals.slice(1).map((journal) => journal.id).sort().reverse());
    expect(items.every((item) => !("document" in item))).toBe(true);
    expect(get.mock.contexts.every((store) => store instanceof IDBObjectStore && store.name === "summaries")).toBe(true);
    expect((await loadReportRecoveryDraft(items[0])).document.title).toBe(items[0].title);
    expect(get.mock.contexts.at(-1)).toHaveProperty("name", "drafts");
    await removeRecoveryDraftsForReport(doc.project_id, doc.id);
    expect((await listReportRecoveryDrafts(doc.project_id, doc.id)).total).toBe(0);
    expect((await listReportRecoveryDrafts("another-project", doc.id)).total).toBe(1);
    await unrelated.clear();
  });

  it("keeps independent tab drafts and only clears the saved session", async () => {
    const doc = report();
    const first = new ReportRecoveryJournal();
    const second = new ReportRecoveryJournal();
    first.checkpoint(doc);
    second.checkpoint({ ...doc, title: "Another window" });
    expect(await first.flush()).toBe(true);
    expect(await second.flush()).toBe(true);
    expect((await listReportRecoveryDrafts(doc.project_id, doc.id)).items).toHaveLength(2);
    await first.clear();
    expect((await listReportRecoveryDrafts(doc.project_id, doc.id)).items.map((draft) => draft.title)).toEqual(["Another window"]);
    await removeRecoveryDraftsForReport(doc.project_id, doc.id);
  });

  it("serializes a queued write before clearing so discarded edits cannot reappear", async () => {
    const doc = report();
    const journal = new ReportRecoveryJournal();
    journal.checkpoint(doc);
    const write = journal.flush();
    const clear = journal.clear();
    await Promise.all([write, clear]);
    expect(await listReportRecoveryDrafts(doc.project_id, doc.id)).toEqual({ items: [], total: 0, next: null });
    journal.checkpoint({ ...doc, title: "A later edit" });
    await journal.flush();
    expect((await listReportRecoveryDrafts(doc.project_id, doc.id)).items[0].title).toBe("A later edit");
    await journal.clear();
  });

  it("refuses stale deletion or adoption and transfers an unchanged draft atomically", async () => {
    const doc = report();
    const original = new ReportRecoveryJournal();
    original.checkpoint(doc);
    await original.flush();
    const [oldSummary] = (await listReportRecoveryDrafts(doc.project_id, doc.id)).items;
    const old = await loadReportRecoveryDraft(oldSummary);
    original.checkpoint({ ...doc, title: "Newer draft" });
    await original.flush();
    expect(await removeReportRecoveryDraft(old)).toBe(false);
    await expect(loadReportRecoveryDraft(oldSummary)).rejects.toThrow("Draft changed or unavailable");
    const recovered = new ReportRecoveryJournal();
    expect(await recovered.adopt(old, doc)).toBe(false);
    const [latestSummary] = (await listReportRecoveryDrafts(doc.project_id, doc.id)).items;
    const latest = await loadReportRecoveryDraft(latestSummary);
    expect(await recovered.adopt(latest, latest.document)).toBe(true);
    const remaining = (await listReportRecoveryDrafts(doc.project_id, doc.id)).items;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ id: recovered.id, title: "Newer draft" });
    expect((await loadReportRecoveryDraft(remaining[0])).document.title).toBe("Newer draft");
    await expect(loadReportRecoveryDraft(latestSummary)).rejects.toThrow("Draft changed or unavailable");
    await recovered.clear();
  });

  it("restores editable content but takes persisted provenance and availability from the current report", async () => {
    const doc = report();
    const journal = new ReportRecoveryJournal();
    journal.checkpoint(doc);
    await journal.flush();
    const [summary] = (await listReportRecoveryDrafts(doc.project_id, doc.id)).items;
    const draft = await loadReportRecoveryDraft(summary);
    const saved = structuredClone(doc);
    saved.title = "Saved title";
    saved.pages[0].blocks[0].source_ref = { captured_at: "current" };
    saved.pages[0].blocks[0].source_available = false;
    const restored = restoreReportRecoveryDraft(draft, saved)!;
    expect(restored.title).toBe("Unsaved title");
    expect(restored.pages[0].blocks[0]).toMatchObject({ content: { text: "Draft finding" }, source_ref: { captured_at: "current" }, source_available: false });
    saved.pages[0].blocks[0].artifact_id = null;
    saved.pages[0].blocks[0].source_ref = { artifact_id: "artifact-1", captured_at: "retained" };
    expect(restoreReportRecoveryDraft(draft, saved)?.pages[0].blocks[0]).toMatchObject({ artifact_id: null, source_ref: { captured_at: "retained" }, source_available: false });
    expect(restoreReportRecoveryDraft(draft, { ...saved, version: 2 })).toBeNull();
    expect(restoreReportRecoveryDraft(draft, { ...saved, project_id: "another-project" })).toBeNull();
    expect(restoreReportRecoveryDraft(draft, { ...saved, pages: [] })).toBeNull();
    await journal.clear();
  });

  it("keeps the previous backup and reports failure if a new draft cannot be stored", async () => {
    const doc = report();
    const journal = new ReportRecoveryJournal();
    const status = vi.fn();
    journal.subscribe(status);
    journal.checkpoint(doc);
    await journal.flush();
    journal.checkpoint({ ...doc, pages: [] });
    expect(await journal.flush()).toBe(false);
    expect(status).toHaveBeenLastCalledWith(true);
    expect((await listReportRecoveryDrafts(doc.project_id, doc.id)).items[0].title).toBe(doc.title);
    journal.checkpoint({ ...doc, title: "Retry" });
    expect(await journal.flush()).toBe(true);
    expect(status).toHaveBeenLastCalledWith(false);
    await journal.clear();
  });

  it("fails visibly when storage is unavailable without claiming a successful checkpoint", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const journal = new ReportRecoveryJournal();
    const status = vi.fn();
    journal.subscribe(status);
    journal.checkpoint(report());
    expect(await journal.flush()).toBe(false);
    expect(status).toHaveBeenCalledWith(true);
  });

  it("rolls back the body when the paired metadata write fails", async () => {
    const doc = report();
    const journal = new ReportRecoveryJournal();
    journal.checkpoint(doc);
    await journal.flush();
    const [previous] = (await listReportRecoveryDrafts(doc.project_id, doc.id)).items;
    const originalPut = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === "summaries") throw new DOMException("Simulated metadata failure", "QuotaExceededError");
      return originalPut.call(this, value, key);
    });
    journal.checkpoint({ ...doc, title: "Must not partly commit" });
    expect(await journal.flush()).toBe(false);
    put.mockRestore();
    expect((await listReportRecoveryDrafts(doc.project_id, doc.id)).items).toEqual([previous]);
    expect((await loadReportRecoveryDraft(previous)).document.title).toBe(doc.title);
    await journal.clear();
  });

  it("rejects malformed or future-format drafts without trying to render them", () => {
    expect(isReportRecoveryDraft({ schema: 2 })).toBe(false);
    const doc = report();
    const value = { schema: 1, id: "draft", revision: "1", projectId: doc.project_id, reportId: doc.id,
      updatedAt: Date.now(), baseVersion: 1, document: doc };
    expect(isReportRecoveryDraft(value)).toBe(true);
    expect(isReportRecoveryDraft({ ...value, document: { ...doc, pages: [{ ...doc.pages[0], blocks: [doc.pages[0].blocks[0], doc.pages[0].blocks[0]] }] } })).toBe(false);
  });
});
