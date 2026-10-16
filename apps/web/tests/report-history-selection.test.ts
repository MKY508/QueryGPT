import { describe, expect, it } from "vitest";
import { ReportEditHistory, resolveReportSelection } from "@/lib/report-edit-history";
import { moveReportBlock } from "@/lib/report-page-editing";
import type { ReportDocument } from "@/lib/reports";

function example(): ReportDocument {
  return { id: "report", project_id: "project", title: "Report", description: "", status: "draft", version: 1,
    created_at: "old", updated_at: "old", pages: [
      { id: "p1", title: "Overview", order_index: 0, config: {}, blocks: [{ id: "card", title: "Finding", block_type: "text",
        source_kind: "manual", order_index: 0, content: { text: "Retained" }, config: {}, layout: { x: 0, y: 0, w: 12, h: 3 } }] },
      { id: "p2", title: "Detail", order_index: 1, config: {}, blocks: [] },
    ] };
}
function setup() {
  const base = example(), history = new ReportEditHistory((kind) => `local-restored-${kind}`);
  history.reset(base); history.rememberSelection(base, { pageId: "p1", blockId: "card" });
  return { base, history };
}

describe("report history selection bookmarks", () => {
  it("restores a moved card's page/selection while navigation alone neither dirties the document nor clears redo", () => {
    const { base, history } = setup();
    expect(history.dirty).toBe(false); expect(history.canUndo).toBe(false);
    const moved = moveReportBlock(base, "card", "p2");
    history.record(moved); history.rememberSelection(moved, { pageId: "p2", blockId: "card" });
    expect(history.move("undo")).toBe(base);
    expect(history.selection).toEqual({ pageId: "p1", blockId: "card" });
    history.rememberSelection(base, { pageId: "p2", blockId: null });
    expect(history.dirty).toBe(false); expect(history.canRedo).toBe(true);
    expect(history.move("redo")).toBe(moved);
    expect(history.selection).toEqual({ pageId: "p2", blockId: "card" });
    expect(Object.keys(moved)).toEqual(Object.keys(base));
  });

  it("maps saved local IDs and bookmarks made while a save is in flight", () => {
    const { base, history } = setup();
    const sent = { ...base, pages: [...base.pages, { ...base.pages[1], id: "local-page", order_index: 2,
      blocks: [{ ...base.pages[0].blocks[0], id: "local-card" }] }] };
    history.record(sent); history.rememberSelection(sent, { pageId: "local-page", blockId: "local-card" });
    const current = moveReportBlock(sent, "local-card", "p2");
    history.record(current); history.rememberSelection(current, { pageId: "p2", blockId: "local-card" });
    const saved = structuredClone(sent); saved.version = 2; saved.pages[2].id = "saved-page"; saved.pages[2].blocks[0].id = "saved-card";
    history.acknowledge(sent, saved);
    expect(history.selection).toEqual({ pageId: "p2", blockId: "saved-card" });
    expect(history.move("undo")).toBe(saved);
    expect(history.selection).toEqual({ pageId: "saved-page", blockId: "saved-card" });
    expect(history.dirty).toBe(false);
    history.move("redo"); expect(history.selection).toEqual({ pageId: "p2", blockId: "saved-card" });
  });

  it("maps recreated page/card identities after committed deletion and transfers a confirmed static copy's selection", () => {
    const { base, history } = setup();
    Object.assign(base.pages[0].blocks[0], { source_kind: "artifact", source_available: false, artifact_id: null });
    const sent = { ...base, pages: [base.pages[1]] };
    history.record(sent); history.rememberSelection(sent, { pageId: "p2", blockId: null });
    history.acknowledge(sent, { ...sent, version: 2 });
    expect(history.move("undo")).toBeNull();
    expect(history.selection).toEqual({ pageId: "p2", blockId: null });
    const restored = history.move("undo", true)!;
    expect(history.selection).toEqual({ pageId: "local-restored-page", blockId: "local-restored-block" });
    expect(restored.pages[0].blocks[0].source_kind).toBe("manual");
    history.move("redo"); history.move("undo");
    expect(history.selection?.blockId).toBe("local-restored-block");
  });

  it("follows moved identity, tolerates absent selection, ignores stale renders, and clears bookmarks on reset", () => {
    const { base, history } = setup();
    const moved = moveReportBlock(base, "card", "p2");
    expect(resolveReportSelection(moved, { pageId: "p1", blockId: "card" })).toEqual({ pageId: "p2", blockId: "card" });
    expect(resolveReportSelection(moved, { pageId: "p2", blockId: "missing" })).toEqual({ pageId: "p2", blockId: null });
    history.record(moved); history.rememberSelection(moved, { pageId: "p2", blockId: "card" });
    history.rememberSelection(base, { pageId: "p1", blockId: null });
    expect(history.selection?.blockId).toBe("card");
    history.move("undo"); expect(history.selection?.blockId).toBe("card");
    history.reset(moved); expect(history.selection).toBeUndefined();
    expect(history.canRedo).toBe(false);
  });
});
