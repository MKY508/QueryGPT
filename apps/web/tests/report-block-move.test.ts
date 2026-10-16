import { describe, expect, it } from "vitest";
import { moveReportBlock, reportBlockMoveImpact } from "@/lib/report-page-editing";
import { ReportEditHistory, reconcileReportAfterSave } from "@/lib/report-edit-history";
import { restoreReportRecoveryDraft, type ReportRecoveryDraft } from "@/lib/report-recovery";
import { mergeReportDocuments } from "@/components/reports/report-merge";
import type { ReportBlock, ReportDocument } from "@/lib/reports";

function example(): ReportDocument {
  const block: ReportBlock = { id: "card", title: "Revenue", block_type: "chart", source_kind: "artifact",
    analysis_run_id: null, artifact_id: null, source_ref: { snapshot: { title: "Historical revenue" } }, source_available: false,
    content: { rows: [{ region: "East", revenue: 42 }] }, order_index: 0,
    config: { interaction_key: "chart-key", filter_action: { field: "region", targets: [{ key: "table-key", field: "region" }] }, filter_target_key: "global-card" },
    layout: { x: 0, y: 0, w: 6, h: 5 }, version: 1 };
  return { id: "report", project_id: "project", title: "Report", description: "", status: "draft", version: 1,
    created_at: "2026-09-06", updated_at: "2026-09-06", pages: [
      { id: "p1", title: "Overview", order_index: 0, config: {}, blocks: [block,
        { ...structuredClone(block), id: "incoming", order_index: 1, config: { interaction_key: "table-key",
          filter_action: { field: "region", targets: [{ key: "chart-key", field: "region" }] } } }] },
      { id: "p2", title: "Detail", order_index: 1, config: {}, blocks: [
        { ...structuredClone(block), id: "other", config: { interaction_key: "chart-key" }, layout: { x: 0, y: 8, w: 12, h: 5 } }] },
      { id: "p3", title: "Notes", order_index: 2, config: {}, blocks: [
        { ...structuredClone(block), id: "filter", block_type: "filter", source_kind: "manual", config: {
          filter_scope: "report", filter_targets: [{ key: "global-card", field: "region" }] } }] },
    ] };
}

describe("cross-page card moves", () => {
  it("preserves identity, source and explicit report filters; clears only affected page links and appends below existing content", () => {
    const source = example(), before = structuredClone(source);
    expect(reportBlockMoveImpact(source, "card")).toEqual({ hasPageLinks: true, changesPageFilter: false });
    const moved = moveReportBlock(source, "card", "p2");
    expect(source).toEqual(before);
    expect(moved.pages[0].blocks.map((block) => block.id)).toEqual(["incoming"]);
    expect(moved.pages[0].blocks[0].config.filter_action).toEqual({ field: "region", targets: [] });
    expect(moved.pages[1].blocks[0]).toBe(source.pages[1].blocks[0]);
    expect(moved.pages[1].blocks[1]).toMatchObject({ id: "card", source_kind: "artifact", source_ref: before.pages[0].blocks[0].source_ref,
      source_available: false, config: { filter_target_key: "global-card" }, layout: { x: 0, y: 13, w: 6, h: 5 } });
    expect(moved.pages[1].blocks[1].config.interaction_key).toBeUndefined();
    expect(moved.pages[1].blocks[1].config.filter_action).toBeUndefined();
    expect(moved.pages[2]).toBe(source.pages[2]);
    for (const [id, page] of [["card", "p1"], ["foreign", "p2"], ["card", "foreign"]]) expect(moveReportBlock(source, id, page)).toBe(source);
    source.pages[2].blocks[0].config.filter_scope = "page";
    expect(reportBlockMoveImpact(source, "filter").changesPageFilter).toBe(true);
    source.pages[0].blocks[1].config = { interaction_key: "chart-key", filter_action: { field: "region", targets: [{ key: "unrelated", field: "region" }] } };
    expect(moveReportBlock(source, "card", "p2").pages[0].blocks[0].config.filter_action).toEqual({ field: "region", targets: [] });
  });

  it("undoes a saved move without recreating a detached card, including after the origin page is removed", () => {
    const source = example();
    const history = new ReportEditHistory((kind) => `local-${kind}-restored`);
    history.reset(source);
    const moved = moveReportBlock(source, "card", "p2");
    // Move the remaining card too, then discard the now-empty source page.
    const bothMoved = moveReportBlock(moved, "incoming", "p2");
    const sent = { ...bothMoved, pages: bothMoved.pages.slice(1) };
    history.record(sent);
    const saved = structuredClone(sent); saved.version = 2;
    saved.pages[0].blocks[1].version = 2;
    history.acknowledge(sent, saved);
    const undo = history.move("undo")!;
    expect(undo).not.toBeNull();
    expect(undo.pages[0].id).toMatch(/^local-page-/);
    expect(undo.pages[0].blocks[0]).toMatchObject({ id: "card", source_kind: "artifact", version: 2 });
    expect(undo.pages[0].blocks[0].config).toEqual(source.pages[0].blocks[0].config);
    expect(history.move("redo")).toBe(saved);
  });

  it("reconciles a newly saved card even when it was moved to a new page while the save was in flight", () => {
    const sent = example(); sent.pages[0].blocks[0].id = "local-card";
    const current = moveReportBlock({ ...sent, pages: [...sent.pages, { id: "local-page-new", title: "New", order_index: 3, config: {}, blocks: [] }] }, "local-card", "local-page-new");
    const saved = structuredClone(sent); saved.version = 2;
    saved.pages[0].blocks[0] = { ...saved.pages[0].blocks[0], id: "saved-card", version: 1, source_available: true, source_ref: { title: "Canonical" } };
    const reconciled = reconcileReportAfterSave(current, sent, saved);
    expect(reconciled.blockIds.get("local-card")).toBe("saved-card");
    expect(reconciled.report.pages[3].blocks[0]).toMatchObject({ id: "saved-card", source_available: true, source_ref: { title: "Canonical" } });
    expect(reconciled.report.pages[0].blocks).toHaveLength(1);
  });

  it("restores a moved draft with canonical provenance and still rejects foreign or repeated identities", () => {
    const saved = example(); const moved = moveReportBlock(saved, "card", "p2");
    const draft: ReportRecoveryDraft = { schema: 1, id: "draft", revision: "r1", projectId: saved.project_id, reportId: saved.id,
      updatedAt: 1, baseVersion: saved.version, document: structuredClone(moved) };
    draft.document.pages[1].blocks[1].source_ref = { title: "Forged" };
    expect(restoreReportRecoveryDraft(draft, saved)?.pages[1].blocks[1].source_ref).toEqual(saved.pages[0].blocks[0].source_ref);
    draft.document.pages[1].blocks[1].id = "foreign";
    expect(restoreReportRecoveryDraft(draft, saved)).toBeNull();
    draft.document.pages[1].blocks[1].id = "incoming";
    expect(restoreReportRecoveryDraft(draft, saved)).toBeNull();
  });

  it("requires only a card-location choice for competing moves, never duplicate identities or accidental static copies", () => {
    const base = example(), mine = moveReportBlock(base, "card", "p2");
    const latest = { ...moveReportBlock(base, "card", "p3"), version: 2 };
    const pending = mergeReportDocuments(base, mine, latest);
    expect(pending.conflicts.map((conflict) => conflict.field)).toEqual(["blockPage"]);
    expect(pending.unresolved).toBe(1);
    for (const choice of ["mine", "latest"] as const) {
      const merged = mergeReportDocuments(base, mine, latest, { "block-page:card": choice });
      const cards = merged.report.pages.flatMap((page) => page.blocks).filter((block) => block.id === "card");
      expect(merged.unresolved).toBe(0); expect(cards).toHaveLength(1);
      expect(cards[0].source_kind).toBe("artifact");
      expect(merged.report.pages[choice === "mine" ? 1 : 2].blocks.at(-1)?.id).toBe("card");
    }
    const remoteOnly = mergeReportDocuments(base, { ...base, title: "Local title" }, latest);
    expect(remoteOnly.unresolved).toBe(0);
    expect(remoteOnly.report.title).toBe("Local title");
    expect(remoteOnly.report.pages[2].blocks.at(-1)?.id).toBe("card");
  });
});
