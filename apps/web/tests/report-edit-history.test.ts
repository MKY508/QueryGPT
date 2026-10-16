import { describe, expect, it } from "vitest";
import { historyNeedsSourceCopy, ReportEditHistory } from "@/lib/report-edit-history";
import type { ReportDocument } from "@/lib/reports";

const report: ReportDocument = { id: "report", project_id: "project", title: "Original", description: "", status: "draft",
  version: 1, created_at: "2026-09-05", updated_at: "2026-09-05", pages: [
    { id: "page", title: "Overview", order_index: 0, config: {}, blocks: [
      { id: "block", title: "Finding", block_type: "text", source_kind: "manual", content: { text: "Original finding" },
        config: {}, order_index: 0, layout: { x: 0, y: 0, w: 6, h: 3 } },
    ] },
  ] };

function history(depth = 100) {
  let sequence = 0;
  const value = new ReportEditHistory((kind) => `local-${kind}-${++sequence}`, depth);
  value.reset(report);
  return value;
}

describe("report edit history", () => {
  it("groups continuous input, splits fields and pauses, and drops redo after a new edit", () => {
    const stack = history();
    const first = { ...report, title: "A" };
    const second = { ...report, title: "AB" };
    const third = { ...report, title: "ABC" };
    stack.record(first, "title", false, 0);
    stack.record(second, "title", false, 300);
    stack.record(third, "title", false, 900);
    expect(stack.move("undo")).toBe(second);
    expect(stack.move("undo")).toBe(report);
    expect(stack.dirty).toBe(false);
    expect(stack.move("redo")).toBe(second);
    stack.record({ ...second, description: "Different field" }, "description", false, 950);
    expect(stack.canRedo).toBe(false);
    expect(stack.move("undo")).toBe(second);
    expect(second.pages).toBe(report.pages);
  });

  it("bounds history, keeps an IME composition together, and closes groups at explicit boundaries", () => {
    const stack = history(2);
    stack.record({ ...report, title: "中" }, "title", true, 0);
    const composed = { ...report, title: "中文" };
    stack.record(composed, "title", true, 2_000);
    expect(stack.move("undo")).toBe(report);
    stack.move("redo");
    stack.closeGroup();
    const next = { ...composed, title: "中文标题" };
    stack.record(next, "title", false, 2_010);
    stack.record({ ...next, description: "New action" });
    expect(stack.move("undo")).toBe(next);
    expect(stack.move("undo")).toBe(composed);
    expect(stack.canUndo).toBe(false);
  });

  it("rebases history and edits made during save to canonical IDs without undoing server provenance", () => {
    const stack = history();
    const local = { ...report.pages[0].blocks[0], id: "local-block", source_kind: "artifact" as const, artifact_id: "artifact", source_available: false };
    const sent = { ...report, pages: [{ ...report.pages[0], blocks: [...report.pages[0].blocks, local] }] };
    stack.record(sent);
    stack.closeGroup();
    const current = { ...sent, title: "Typed during save" };
    stack.record(current, "title");
    const saved = { ...sent, version: 2, pages: [{ ...sent.pages[0], blocks: [report.pages[0].blocks[0],
      { ...local, id: "persisted-block", version: 1, source_available: true, source_ref: { title: "Trusted source" } }] }] };
    const reconciled = stack.acknowledge(sent, saved);
    expect(reconciled).toMatchObject({ title: "Typed during save", version: 2 });
    expect(reconciled.pages[0].blocks[1]).toMatchObject({ id: "persisted-block", source_available: true, source_ref: { title: "Trusted source" } });
    expect(stack.move("undo")).toBe(saved);
    expect(stack.dirty).toBe(false);
    const beforeInsertion = stack.move("undo")!;
    expect(beforeInsertion.version).toBe(2);
    expect(beforeInsertion.pages[0].blocks).toHaveLength(1);
    expect(stack.dirty).toBe(true);
    expect(stack.move("redo")).toBe(saved);
  });

  it("recreates committed page/block deletions with shared new identities across undo and redo", () => {
    const stack = history();
    const extra = { ...report.pages[0], id: "second-page", blocks: [{ ...report.pages[0].blocks[0], id: "second-block" }] };
    const initial = { ...report, pages: [report.pages[0], extra] };
    stack.reset(initial);
    const deletion = { ...report, pages: [{ ...report.pages[0], blocks: [] }] };
    stack.record(deletion);
    const saved = { ...deletion, version: 2 };
    stack.acknowledge(deletion, saved);
    const restored = stack.move("undo")!;
    expect(restored.pages[0].id).toBe("page");
    expect(restored.pages[0].blocks[0].id).toMatch(/^local-block-/);
    expect(restored.pages[1].id).toMatch(/^local-page-/);
    expect(restored.pages[1].blocks[0].id).toMatch(/^local-block-/);
    stack.move("redo");
    expect(stack.move("undo")).toBe(restored);
    expect(restored.pages[0].blocks[0].content).toBe(report.pages[0].blocks[0].content);
  });

  it("requires consent before recreating unavailable linked content as a manual copy", () => {
    const stack = history();
    const original = { ...report, pages: [{ ...report.pages[0], blocks: [{ ...report.pages[0].blocks[0],
      source_kind: "artifact" as const, artifact_id: null, source_ref: { artifact_id: "deleted-artifact" }, source_available: false }] }] };
    stack.reset(original);
    const deletion = { ...original, pages: [{ ...original.pages[0], blocks: [] }] };
    stack.record(deletion);
    stack.acknowledge(deletion, { ...deletion, version: 2 });
    expect(historyNeedsSourceCopy(stack.peek("undo")!)).toBe(true);
    expect(stack.move("undo")).toBeNull();
    expect(stack.dirty).toBe(false);
    const copied = stack.move("undo", true)!;
    expect(copied.pages[0].blocks[0]).toMatchObject({ source_kind: "manual", artifact_id: null, analysis_run_id: null });
    expect(copied.pages[0].blocks[0].source_ref).toBeUndefined();
    expect(copied.pages[0].blocks[0].content).toBe(original.pages[0].blocks[0].content);
    expect(historyNeedsSourceCopy(copied)).toBe(false);
  });
});
