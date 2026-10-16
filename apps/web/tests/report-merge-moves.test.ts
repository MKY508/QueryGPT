import { describe, expect, it } from "vitest";
import { mergeReportDocuments, type MergeChoice } from "@/components/reports/report-merge";
import { moveReportBlock } from "@/lib/report-page-editing";
import type { ReportBlock, ReportDocument } from "@/lib/reports";

function example(): ReportDocument {
  const block = (id: string): ReportBlock => ({ id, title: id, block_type: "text", source_kind: "manual",
    order_index: 0, content: { text: `${id} original` }, config: {}, layout: { x: 0, y: 0, w: 6, h: 3 } });
  return { id: "report", project_id: "project", title: "Report", description: "Original", status: "draft", version: 1,
    created_at: "old", updated_at: "old", pages: [
      { id: "p1", title: "Overview", order_index: 0, config: {}, blocks: [block("a"), { ...block("b"), order_index: 1 }] },
      { id: "p2", title: "Detail", order_index: 1, config: {}, blocks: [block("c")] },
      { id: "p3", title: "Notes", order_index: 2, config: {}, blocks: [block("d")] },
    ] };
}
const latestVersion = (report: ReportDocument): ReportDocument => ({ ...report, version: 2, updated_at: "new" });
const find = (report: ReportDocument, id: string) => report.pages.flatMap((page) => page.blocks).find((block) => block.id === id)!;
const pageOf = (report: ReportDocument, id: string) => report.pages.find((page) => page.blocks.some((block) => block.id === id))?.id;
function unique(report: ReportDocument) {
  const blocks = report.pages.flatMap((page) => page.blocks);
  expect(new Set(blocks.map((block) => block.id)).size).toBe(blocks.length);
  expect(new Set(report.pages.map((page) => page.id)).size).toBe(report.pages.length);
  report.pages.forEach((page, i) => {
    expect(page.order_index).toBe(i);
    expect(page.blocks.map((block) => block.order_index)).toEqual(page.blocks.map((_, j) => j));
  });
}

describe("location-aware report merging", () => {
  it("combines a chart move, cleanup of local links and remote data edits without a whole-report choice", () => {
    const base = example();
    Object.assign(find(base, "a"), { block_type: "chart", source_kind: "artifact", artifact_id: "source",
      analysis_run_id: "run", source_ref: { title: "Trusted" }, config: { interaction_key: "chart", filter_action: { field: "region", targets: [{ key: "table", field: "region" }] } } });
    find(base, "b").config = { interaction_key: "table", filter_action: { field: "region", targets: [{ key: "chart", field: "region" }] } };
    const mine = moveReportBlock(base, "a", "p2");
    mine.title = "My report";
    const latest = latestVersion(structuredClone(base));
    find(latest, "a").content = { rows: [{ region: "East", revenue: "12345678901234567890.12" }] };
    find(latest, "a").source_ref = { title: "Canonical receipt" };
    find(latest, "b").content.text = "New remote finding";
    latest.pages[2].title = "Updated notes";
    const before = [structuredClone(base), structuredClone(mine), structuredClone(latest)];
    const result = mergeReportDocuments(base, mine, latest);
    expect(result.conflicts).toEqual([]); expect(result.unresolved).toBe(0);
    expect(result.report.title).toBe("My report");
    expect(pageOf(result.report, "a")).toBe("p2");
    expect(find(result.report, "a")).toMatchObject({ source_kind: "artifact", artifact_id: "source",
      content: find(latest, "a").content, source_ref: { title: "Canonical receipt" } });
    expect(find(result.report, "a").config.filter_action).toBeUndefined();
    expect(find(result.report, "b").config.filter_action).toEqual({ field: "region", targets: [] });
    expect(find(result.report, "b").content.text).toBe("New remote finding");
    expect(result.report.pages[2].title).toBe("Updated notes");
    expect([base, mine, latest]).toEqual(before); unique(result.report);
  });

  it("merges independent moves, including cards crossing in opposite directions", () => {
    const base = example();
    const mine = moveReportBlock(base, "a", "p2");
    const latest = latestVersion(moveReportBlock(base, "c", "p1"));
    const result = mergeReportDocuments(base, mine, latest);
    expect(result.unresolved).toBe(0);
    expect(pageOf(result.report, "a")).toBe("p2"); expect(pageOf(result.report, "c")).toBe("p1");
    expect(result.report.pages.flatMap((page) => page.blocks)).toHaveLength(4); unique(result.report);
  });

  it("lets each card choose its destination and content independently while preserving unrelated changes", () => {
    const base = example();
    const mine = moveReportBlock(structuredClone(base), "a", "p2"), latest = latestVersion(moveReportBlock(structuredClone(base), "a", "p3"));
    find(mine, "a").content.text = "My finding";
    find(latest, "a").content.text = "Latest finding";
    find(mine, "b").title = "My other title"; find(latest, "c").title = "Latest other title";
    const pending = mergeReportDocuments(base, mine, latest);
    expect(pending.conflicts.map((conflict) => conflict.field)).toEqual(["block", "blockPage"]);
    expect(pending.conflicts[1]).toMatchObject({ mine: "Detail", latest: "Notes", restoresCopy: false });
    for (const location of ["mine", "latest"] as const) for (const content of ["mine", "latest"] as const) {
      const result = mergeReportDocuments(base, mine, latest, { "block-page:a": location, "block:a": content });
      expect(result.unresolved).toBe(0);
      expect(pageOf(result.report, "a")).toBe(location === "mine" ? "p2" : "p3");
      expect(find(result.report, "a").content.text).toBe(content === "mine" ? "My finding" : "Latest finding");
      expect(find(result.report, "b").title).toBe("My other title");
      expect(find(result.report, "c").title).toBe("Latest other title"); unique(result.report);
    }
  });

  it("keeps the insertion point explicit when both versions move the same card to one page", () => {
    const base = example();
    const mine = moveReportBlock(base, "a", "p2");
    mine.pages[1].blocks.reverse();
    const latest = latestVersion(moveReportBlock(base, "a", "p2"));
    const pending = mergeReportDocuments(base, mine, latest);
    expect(pending.conflicts.map((conflict) => conflict.id)).toEqual(["block-order:p2"]);
    for (const choice of ["mine", "latest"] as const) {
      const result = mergeReportDocuments(base, mine, latest, { "block-order:p2": choice });
      expect(result.report.pages[1].blocks.map((block) => block.id)).toEqual(choice === "mine" ? ["a", "c"] : ["c", "a"]);
      expect(result.unresolved).toBe(0); unique(result.report);
    }
    const empty = example(); empty.pages[1].blocks = [];
    const first = moveReportBlock(moveReportBlock(empty, "a", "p2"), "b", "p2");
    const second = latestVersion(moveReportBlock(moveReportBlock(empty, "b", "p2"), "a", "p2"));
    expect(mergeReportDocuments(empty, first, second).conflicts.map((conflict) => conflict.id)).toEqual(["block-order:p2"]);
    expect(mergeReportDocuments(empty, first, second, { "block-order:p2": "latest" }).report.pages[1].blocks.map((block) => block.id)).toEqual(["b", "a"]);
  });

  it.each(["mine", "latest"] as const)("carries content edits to a moved card after %s removes its original page", (side) => {
    const base = example();
    const moved = moveReportBlock(base, "a", "p2"); moved.pages = moved.pages.filter((page) => page.id !== "p1");
    const edited = structuredClone(base); find(edited, "a").content.text = "Updated finding";
    const result = mergeReportDocuments(base, side === "mine" ? moved : edited, latestVersion(side === "mine" ? edited : moved));
    expect(result.conflicts).toEqual([]);
    expect(result.report.pages.map((page) => page.id)).toEqual(["p2", "p3"]);
    expect(pageOf(result.report, "a")).toBe("p2"); expect(find(result.report, "a").content.text).toBe("Updated finding");
    expect(find(result.report, "b")).toBeUndefined(); unique(result.report);
  });

  it("does not silently accept moving versus deleting a card, and only an explicit restore becomes a static copy", () => {
    const base = example();
    Object.assign(find(base, "a"), { source_kind: "artifact", artifact_id: "source", source_ref: { title: "Original" } });
    const mine = moveReportBlock(base, "a", "p2");
    const latest = latestVersion(structuredClone(base)); latest.pages[0].blocks.shift();
    find(latest, "d").content.text = "Unrelated latest";
    const pending = mergeReportDocuments(base, mine, latest);
    expect(pending.conflicts).toMatchObject([{ id: "block:a", restoresCopy: true }]);
    const kept = mergeReportDocuments(base, mine, latest, { "block:a": "mine" });
    expect(find(kept.report, "local-block-merge-a")).toMatchObject({ source_kind: "manual", artifact_id: null, source_ref: undefined });
    expect(pageOf(kept.report, "local-block-merge-a")).toBe("p2");
    const deleted = mergeReportDocuments(base, mine, latest, { "block:a": "latest" });
    expect(find(deleted.report, "a")).toBeUndefined();
    for (const result of [kept, deleted]) { expect(result.unresolved).toBe(0); expect(find(result.report, "d").content.text).toBe("Unrelated latest"); unique(result.report); }
  });

  it("resolves a deleted destination page without deleting or duplicating a card that still exists elsewhere", () => {
    const base = example();
    Object.assign(find(base, "a"), { source_kind: "artifact", artifact_id: "source", source_ref: { title: "Saved source" } });
    const mine = moveReportBlock(base, "a", "p2");
    const latest = latestVersion(structuredClone(base)); latest.pages = latest.pages.filter((page) => page.id !== "p2");
    find(latest, "a").content.text = "Updated from source";
    const pending = mergeReportDocuments(base, mine, latest);
    expect(pending.conflicts.map((conflict) => conflict.id)).toEqual(["page:p2"]);
    for (const choice of ["mine", "latest"] as const) {
      const result = mergeReportDocuments(base, mine, latest, { "page:p2": choice });
      expect(result.unresolved).toBe(0);
      expect(pageOf(result.report, "a")).toBe(choice === "mine" ? "local-page-merge-p2" : "p1");
      expect(find(result.report, "a")).toMatchObject({ source_kind: "artifact", artifact_id: "source", content: { text: "Updated from source" } });
      if (choice === "mine") expect(find(result.report, "local-block-merge-c").source_kind).toBe("manual");
      else expect(find(result.report, "c")).toBeUndefined();
      unique(result.report);
    }
  });

  it("merges into a newly created page and keeps restored page contents behind the page choice", () => {
    const base = example(), mine = structuredClone(base);
    mine.pages.push({ id: "local-new-page", title: "New page", config: {}, order_index: 3, blocks: [] });
    const moved = moveReportBlock(mine, "a", "local-new-page");
    const latest = latestVersion(structuredClone(base)); find(latest, "a").title = "Latest title";
    const result = mergeReportDocuments(base, moved, latest);
    expect(result.unresolved).toBe(0); expect(pageOf(result.report, "a")).toBe("local-new-page");
    expect(find(result.report, "a").title).toBe("Latest title"); unique(result.report);
    const local = structuredClone(base); find(local, "a").content.text = "Keep edited page";
    latest.pages = latest.pages.filter((page) => page.id !== "p1");
    const kept = mergeReportDocuments(base, local, latest, { "page:p1": "mine" });
    expect(kept.unresolved).toBe(0);
    expect(kept.report.pages[0].blocks.map((block) => block.id)).toEqual(["local-block-merge-a", "local-block-merge-b"]);
  });

  it("keeps identities unique across every choice when both versions move cards and delete opposite pages", () => {
    const base = example();
    const mine = moveReportBlock(base, "a", "p2"); mine.pages = mine.pages.filter((page) => page.id !== "p1");
    const latest = latestVersion(moveReportBlock(base, "c", "p1")); latest.pages = latest.pages.filter((page) => page.id !== "p2");
    expect(mergeReportDocuments(base, mine, latest).conflicts.map((conflict) => conflict.id)).toEqual(["page:p1", "page:p2"]);
    for (const p1 of ["mine", "latest"] as const) for (const p2 of ["mine", "latest"] as const) {
      const result = mergeReportDocuments(base, mine, latest, { "page:p1": p1, "page:p2": p2 });
      expect(result.unresolved).toBe(0); unique(result.report);
      expect(result.report.pages.map((page) => page.id)).toEqual([
        ...(p1 === "latest" ? ["p1"] : []), ...(p2 === "mine" ? ["local-page-merge-p2"] : []), "p3",
      ]);
      const bothDeleted = p1 === "mine" && p2 === "latest";
      expect(pageOf(result.report, "a")).toBe(bothDeleted ? undefined : p2 === "mine" ? "local-page-merge-p2" : "p1");
      expect(pageOf(result.report, "c")).toBe(bothDeleted ? undefined : p1 === "latest" ? "p1" : "local-page-merge-p2");
      expect(pageOf(result.report, "d")).toBe("p3");
    }
  });

  it("presents conflicting page-local links separately from content with names instead of keys", () => {
    const base = example();
    find(base, "a").block_type = "chart"; find(base, "a").config.interaction_key = "private-source-key";
    find(base, "b").config.interaction_key = "private-target-key";
    const mine = structuredClone(base), latest = latestVersion(structuredClone(base));
    find(mine, "a").config.filter_action = { field: "channel", targets: [{ key: "private-target-key", field: "channel" }] };
    find(latest, "a").config.filter_action = { field: "region", targets: [{ key: "private-target-key", field: "region" }] };
    find(latest, "a").content.text = "Latest data";
    const pending = mergeReportDocuments(base, mine, latest);
    expect(pending.conflicts).toMatchObject([{ field: "blockLinks", mine: "a · channel → b · channel", latest: "a · region → b · region" }]);
    expect(JSON.stringify(pending.conflicts)).not.toContain("private-");
    const result = mergeReportDocuments(base, mine, latest, { "block-page:a": "mine" satisfies MergeChoice });
    expect(result.unresolved).toBe(0); expect(find(result.report, "a").content.text).toBe("Latest data");
    expect(find(result.report, "a").config.filter_action).toEqual(find(mine, "a").config.filter_action);
  });
});
