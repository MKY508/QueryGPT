import { describe, expect, it } from "vitest";
import type { ReportDocument } from "@/lib/reports";
import { reflowBlocks } from "@/lib/report-blocks";
import { editReportDocument, editReportPage, type ReportPageCommand } from "@/lib/report-editing";
import { configureCrossFilter, makeReportSelection, resolveSelections } from "@/lib/report-interactions";

function fixture(): ReportDocument {
  return { id: "report", project_id: "project", title: "月报", description: "", status: "draft", version: 1,
    created_at: "2026-09-09", updated_at: "2026-09-09", pages: [
      { id: "page", title: "经营", order_index: 0, config: {}, blocks: [
        { id: "source", title: "收入", block_type: "chart", order_index: 0, source_kind: "artifact",
          artifact_id: "artifact", analysis_run_id: "run", source_available: true, source_ref: { snapshot: { title: "Evidence" } },
          version: 2, created_at: "2026-09-01", updated_at: "2026-09-02",
          content: { rows: [{ region: "华东", amount: "9007199254740993" }] }, config: { manual_override: true },
          layout: { x: 0, y: 0, w: 6, h: 4 } },
        { id: "target", title: "明细", block_type: "table", order_index: 1, source_kind: "manual", config: {},
          content: { rows: [{ region: "华东", amount: "9007199254740993" }] }, layout: { x: 0, y: 4, w: 12, h: 6 } },
      ] },
      { id: "other-page", title: "说明", order_index: 1, config: {}, blocks: [] },
    ] };
}

describe("report editing commands", () => {
  it("keeps no-op identity, leaves other pages untouched, and lays out only changed blocks", () => {
    const report = fixture();
    const original = structuredClone(report);
    const page = report.pages[0];
    const noops: ReportPageCommand[] = [
      { type: "update-page", updates: { title: page.title } },
      { type: "update-block", blockId: "source", updates: { title: "收入", layout: { ...page.blocks[0].layout } } },
      { type: "move-block", blockId: "source", direction: -1 },
      { type: "resize-block", blockId: "target", direction: -1 },
      { type: "remove-block", blockId: "missing" },
      { type: "append-blocks", blocks: [] },
      { type: "append-blocks", blocks: [page.blocks[0]] },
    ];
    for (const command of noops) expect(editReportDocument(report, "page", command)).toBe(report);
    expect(editReportDocument(report, "missing", { type: "remove-block", blockId: "source" })).toBe(report);
    expect(reflowBlocks(page.blocks)).toBe(page.blocks);
    const updated = editReportDocument(report, "page", { type: "update-block", blockId: "source", updates: { title: "净收入" } });
    expect(updated.pages[1]).toBe(report.pages[1]);
    expect(updated.pages[0].blocks[1]).toBe(page.blocks[1]);
    expect(updated.pages[0].blocks[0]).toMatchObject({ title: "净收入", artifact_id: "artifact", source_ref: page.blocks[0].source_ref });
    expect(report).toEqual(original);
  });

  it("resizes toward the next actual width and treats both limits as no-ops", () => {
    const page = fixture().pages[0];
    page.blocks[0].layout.w = 7;
    const grown = editReportPage(page, { type: "resize-block", blockId: "source", direction: 1 });
    expect(grown.blocks[0].layout.w).toBe(8);
    expect(editReportPage(page, { type: "resize-block", blockId: "source", direction: -1 }).blocks[0].layout.w).toBe(6);
    for (const [width, direction] of [[12, 1], [3, -1]] as const) {
      const limited = { ...page, blocks: [{ ...page.blocks[0], layout: { ...page.blocks[0].layout, w: width } }] };
      expect(editReportPage(limited, { type: "resize-block", blockId: "source", direction })).toBe(limited);
    }
  });

  it("duplicates independent exact content while leaving original evidence and incoming links intact", () => {
    const initial = fixture().pages[0];
    let key = 0;
    const page = configureCrossFilter(initial, "source", "region", "target", "region", () => `key-${++key}`);
    page.blocks[0].config.filter_target_key = "source-target";
    const command: ReportPageCommand = { type: "duplicate-block", blockId: "source", newBlockId: "copy", title: "收入 副本",
      connectionKeys: { interaction_key: "copy-source", filter_target_key: "copy-target" } };
    const before = structuredClone(page);
    const next = editReportPage(page, command);
    expect(editReportPage(page, command)).toEqual(next);
    const copy = next.blocks[1];
    expect(copy).toMatchObject({ id: "copy", title: "收入 副本", source_kind: "manual", artifact_id: null, analysis_run_id: null,
      config: { interaction_key: "copy-source", filter_target_key: "copy-target", filter_action: page.blocks[0].config.filter_action } });
    for (const field of ["source_ref", "source_available", "version", "created_at", "updated_at"]) expect(copy).not.toHaveProperty(field);
    expect(copy.config).not.toHaveProperty("manual_override");
    expect(copy.content).toEqual(page.blocks[0].content);
    expect(copy.content).not.toBe(page.blocks[0].content);
    const selected = makeReportSelection(page, page.blocks[0], "华东")!;
    expect(resolveSelections(next, [selected])).toHaveLength(1);
    expect(editReportPage(next, command)).toBe(next);
    expect(page).toEqual(before);
  });

  it("composes move, removal and append as complete document changes without changing source rows", () => {
    const report = fixture();
    const moved = editReportDocument(report, "page", { type: "move-block", blockId: "source", direction: 1 });
    expect(moved.pages[0].blocks.map(block => block.id)).toEqual(["target", "source"]);
    const removed = editReportDocument(moved, "page", { type: "remove-block", blockId: "target" });
    expect(removed.pages[0].blocks[0].layout).toMatchObject({ x: 0, y: 0 });
    const appended = editReportDocument(removed, "other-page", { type: "append-blocks", blocks: [report.pages[0].blocks[1]] });
    expect(appended.pages[1].blocks[0].content).toBe(report.pages[0].blocks[1].content);
    expect(appended.pages[0]).toBe(removed.pages[0]);
    expect(report.pages[0].blocks.map(block => block.id)).toEqual(["source", "target"]);
  });
});
