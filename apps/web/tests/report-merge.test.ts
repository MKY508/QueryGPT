import { describe, expect, it } from "vitest";
import { mergeReportDocuments } from "@/components/reports/report-merge";
import type { ReportBlock, ReportDocument } from "@/lib/reports";

function block(id: string): ReportBlock {
  return { id, title: id, block_type: "text", source_kind: "manual", order_index: 0,
    content: { text: "Original" }, config: {}, layout: { x: 0, y: 0, w: 6, h: 3 }, version: 1 };
}
function documents() {
  const base: ReportDocument = { id: "report", project_id: "project", title: "Report", description: "Original", status: "draft",
    version: 1, created_at: "old", updated_at: "old", pages: [{ id: "page", title: "Overview", order_index: 0, config: {}, version: 1,
      blocks: [block("a"), { ...block("b"), order_index: 1, layout: { x: 6, y: 0, w: 6, h: 3 } }] }] };
  const mine = structuredClone(base), latest = structuredClone(base);
  latest.version = 2;
  latest.updated_at = "new";
  return { base, mine, latest };
}

describe("three-way report merge", () => {
  it("combines non-overlapping metadata and block edits with latest canonical versions", () => {
    const { base, mine, latest } = documents();
    mine.title = "My title";
    mine.pages[0].blocks[0].content.text = "My block";
    latest.description = "Remote description";
    latest.pages[0].version = 9;
    latest.pages[0].blocks[0].version = 7; // Pure server bookkeeping is not a content conflict.
    latest.pages[0].blocks[1].content.text = "Remote block";
    const result = mergeReportDocuments(base, mine, latest);
    expect(result.conflicts).toEqual([]);
    expect(result.report).toMatchObject({ title: "My title", description: "Remote description", version: 2,
      pages: [{ version: 9, blocks: [{ version: 7, content: { text: "My block" } }, { content: { text: "Remote block" } }] }] });
    expect(base.title).toBe("Report");
    expect(latest.pages[0].blocks[0].content.text).toBe("Original");
  });

  it("requires an explicit choice for overlapping fields and keeps block data/config atomic", () => {
    const { base, mine, latest } = documents();
    mine.title = "Mine";
    latest.title = "Latest";
    mine.pages[0].blocks[0].config = { highlight: "Local caption" };
    latest.pages[0].blocks[0].content = { rows: [{ amount: "999999999999999999.99" }] };
    expect(mergeReportDocuments(base, mine, latest).unresolved).toBe(2);
    const result = mergeReportDocuments(base, mine, latest, { title: "mine", "block:a": "latest" });
    expect(result.unresolved).toBe(0);
    expect(result.report.title).toBe("Mine");
    expect(result.report.pages[0].blocks[0].content).toEqual(latest.pages[0].blocks[0].content);
    expect(result.report.pages[0].blocks[0].config).toEqual({});
  });

  it("turns explicitly retained remote-deleted content into a new static copy, not an obsolete source identity", () => {
    const { base, mine, latest } = documents();
    for (const doc of [base, mine]) Object.assign(doc.pages[0].blocks[0], {
      source_kind: "artifact", analysis_run_id: "run", artifact_id: "artifact", source_ref: { refresh_binding: {} }, config: { manual_override: true },
    });
    mine.pages[0].blocks[0].content.text = "Keep this";
    latest.pages[0].blocks.shift();
    const pending = mergeReportDocuments(base, mine, latest);
    expect(pending.conflicts.find((value) => value.id === "block:a")?.restoresCopy).toBe(true);
    const result = mergeReportDocuments(base, mine, latest, { "block:a": "mine" });
    expect(result.unresolved).toBe(0);
    expect(result.report.pages[0].blocks[0]).toMatchObject({ id: "local-block-merge-a", source_kind: "manual", artifact_id: null,
      analysis_run_id: null, content: { text: "Keep this" }, config: {} });
    expect(result.report.pages[0].blocks[0].source_ref).toBeUndefined();
    expect(result.report.pages[0].blocks[1].id).toBe("b");
    latest.pages = [];
    const page = mergeReportDocuments(base, mine, latest, { "page:page": "mine" });
    expect(page.report.pages[0].id).toBe("local-page-merge-page");
    expect(page.report.pages[0].blocks.every((value) => value.id.startsWith("local-"))).toBe(true);
  });

  it("keeps independent additions from both sides when choosing an order and reflows them", () => {
    const { base, mine, latest } = documents();
    mine.pages[0].blocks.push(block("local-block-c"));
    latest.pages[0].blocks.unshift(block("remote-d"));
    const pending = mergeReportDocuments(base, mine, latest);
    expect(pending.conflicts).toEqual([]);
    expect(pending.report.pages[0].blocks.map((value) => value.id)).toEqual(["remote-d", "a", "b", "local-block-c"]);
    mine.pages[0].blocks = [block("a"), block("local-block-c"), block("b")];
    latest.pages[0].blocks = [block("a"), block("remote-d"), block("b")];
    expect(mergeReportDocuments(base, mine, latest).conflicts.map((value) => value.id)).toEqual(["block-order:page"]);
    const result = mergeReportDocuments(base, mine, latest, { "block-order:page": "mine" });
    expect(result.report.pages[0].blocks.map((value) => value.id)).toEqual(["a", "local-block-c", "remote-d", "b"]);
    expect(result.report.pages[0].blocks.map((value) => [value.layout.x, value.layout.y])).toEqual([[0, 0], [6, 0], [0, 3], [6, 3]]);
    expect(result.unresolved).toBe(0);
    base.pages[0].blocks.push(block("c"));
    mine.pages[0].blocks = [block("b"), block("a"), block("c")];
    latest.pages[0].blocks = [block("a"), block("c"), block("b")];
    expect(mergeReportDocuments(base, mine, latest).conflicts.map((value) => value.id)).toEqual(["block-order:page"]);
    expect(mergeReportDocuments(base, mine, latest, { "block-order:page": "latest" }).report.pages[0].blocks.map((value) => value.id)).toEqual(["a", "c", "b"]);
  });

  it("requires a page choice when independent deletions would otherwise empty the report", () => {
    const { base, mine, latest } = documents();
    base.pages.push({ id: "page2", title: "Detail", order_index: 1, config: {}, blocks: [] });
    mine.pages = [structuredClone(base.pages[0])];
    latest.pages = [structuredClone(base.pages[1])];
    const pending = mergeReportDocuments(base, mine, latest);
    expect(pending.conflicts.map((value) => value.field)).toEqual(["pagesRequired"]);
    expect(pending.unresolved).toBe(1);
    const result = mergeReportDocuments(base, mine, latest, { "pages-required": "latest" });
    expect(result.unresolved).toBe(0);
    expect(result.report.pages.map((value) => value.id)).toEqual(["page2"]);
  });

  it("ignores object key order but rejects comparisons without a common report/version identity", () => {
    const { base, mine, latest } = documents();
    base.pages[0].config = { a: 1, b: 2 };
    mine.pages[0].config = { b: 2, a: 1 };
    latest.pages[0].config = { a: 3, b: 2 };
    expect(mergeReportDocuments(base, mine, latest).conflicts).toEqual([]);
    expect(() => mergeReportDocuments(base, mine, { ...latest, project_id: "different" })).toThrow();
    expect(() => mergeReportDocuments(base, mine, { ...latest, created_at: "recreated" })).toThrow();
    expect(() => mergeReportDocuments(base, { ...mine, version: 5 }, latest)).toThrow();
    latest.pages[0].blocks.push(latest.pages[0].blocks[0]);
    expect(() => mergeReportDocuments(base, mine, latest)).toThrow(/Duplicate/);
  });
});
