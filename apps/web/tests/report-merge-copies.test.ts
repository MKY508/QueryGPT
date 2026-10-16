import { describe, expect, it, vi } from "vitest";
import { mergeReportDocuments, type MergeChoice } from "@/components/reports/report-merge";
import { duplicateReportPage, moveReportBlock } from "@/lib/report-page-editing";
import { ReportEditHistory } from "@/lib/report-edit-history";
import { restoreReportRecoveryDraft, type ReportRecoveryDraft } from "@/lib/report-recovery";
import { api } from "@/lib/api/client";
import { updateReport, type ReportDocument } from "@/lib/reports";

function example() {
  const base: ReportDocument = { id: "report", project_id: "project", title: "经营报告", description: "", status: "draft",
    version: 1, created_at: "old", updated_at: "old", pages: [
      { id: "p1", title: "概览", order_index: 0, config: {}, blocks: [{ id: "origin", title: "营收明细", block_type: "table",
        source_kind: "artifact", analysis_run_id: "run", artifact_id: "artifact", source_available: true,
        source_ref: { analysis_run_id: "run", artifact_id: "artifact", snapshot: { title: "原始调查" } },
        content: { rows: [{ 营收: "99999999999999999.99" }] }, config: { columns: ["营收"] }, order_index: 0,
        layout: { x: 0, y: 0, w: 12, h: 5 } }] },
      { id: "p2", title: "后续安排", order_index: 1, config: {}, blocks: [] },
    ] };
  let sequence = 0;
  const duplicate = duplicateReportPage(base, "p1", "概览副本", (kind) => `local-${kind}-${++sequence}`)!;
  const mine = duplicate.document, copyId = duplicate.page.blocks[0].id;
  const latest = { ...structuredClone(base), version: 2, description: "另一版本的说明" };
  const choices = (choice: MergeChoice) => ({ [`copy-source:${copyId}`]: choice });
  const all = (document: ReportDocument) => document.pages.flatMap((page) => page.blocks);
  const copied = (document: ReportDocument) => all(document).find((block) => block.id === copyId);
  return { base, mine, latest, copyId, choices, all, copied };
}

describe("pending page copies during report merging", () => {
  it("requires a keep-or-remove decision if the saved origin was deleted, without dropping other work", () => {
    const { base, mine, latest, copyId, copied, choices } = example();
    latest.pages[0].blocks = [];
    const before = structuredClone([base, mine, latest]);
    const pending = mergeReportDocuments(base, mine, latest);
    expect(pending.conflicts).toEqual([{ id: `copy-source:${copyId}`, field: "copySource", label: "概览副本 / 营收明细",
      mine: "营收明细", latest: null, restoresCopy: true }]);
    expect(pending.unresolved).toBe(1);
    const kept = mergeReportDocuments(base, mine, latest, choices("mine"));
    expect(kept.unresolved).toBe(0);
    expect(copied(kept.report)).toMatchObject({ id: copyId, source_kind: "manual", artifact_id: null, analysis_run_id: null,
      copy_source_block_id: undefined, source_ref: undefined, source_available: true,
      content: { rows: [{ 营收: "99999999999999999.99" }] }, config: { columns: ["营收"] } });
    const removed = mergeReportDocuments(base, mine, latest, choices("latest"));
    expect(removed.unresolved).toBe(0); expect(copied(removed.report)).toBeUndefined();
    for (const result of [kept, removed]) {
      expect(result.report.description).toBe("另一版本的说明");
      expect(result.report.pages.map((page) => page.title)).toEqual(["概览", "概览副本", "后续安排"]);
    }
    expect([base, mine, latest]).toEqual(before);
  });

  it.each(["binding", "kind", "unidentified receipt"])("does not silently adopt a replacement %s from the same saved card ID", (change) => {
    const { base, mine, latest, copied, choices } = example();
    const source = latest.pages[0].blocks[0];
    if (change === "binding") { source.artifact_id = "other-artifact"; source.analysis_run_id = "other-run"; }
    else if (change === "kind") source.source_kind = "manual";
    else {
      for (const doc of [base, mine, latest]) for (const block of doc.pages.flatMap((page) => page.blocks)) {
        block.artifact_id = null; block.analysis_run_id = null;
        block.source_ref = { snapshot: { title: "旧资料" } };
      }
      source.source_ref = { snapshot: { title: "另一份资料" } };
    }
    expect(mergeReportDocuments(base, mine, latest).conflicts.map((conflict) => conflict.field)).toEqual(["copySource"]);
    const result = mergeReportDocuments(base, mine, latest, choices("mine"));
    expect(copied(result.report)?.source_kind).toBe("manual");
    expect(copied(result.report)?.copy_source_block_id).toBeUndefined();
    expect(result.report.pages[0].blocks[0].source_ref).toEqual(source.source_ref);
  });

  it("keeps current canonical provenance for an origin moved elsewhere, while retaining the copy's own contents", () => {
    const { base, mine, latest, copied } = example();
    const source = latest.pages[0].blocks[0];
    source.content = { rows: [{ 营收: "125" }] };
    source.source_ref = { ...source.source_ref, snapshot: { title: "来源的最新描述" } };
    const moved = moveReportBlock(latest, "origin", "p2");
    const result = mergeReportDocuments(base, mine, moved);
    expect(result.unresolved).toBe(0);
    expect(copied(result.report)).toMatchObject({ copy_source_block_id: "origin", artifact_id: "artifact", analysis_run_id: "run",
      source_ref: source.source_ref, content: mine.pages[1].blocks[0].content, config: { manual_override: true } });
    expect(result.report.pages.find((page) => page.id === "p2")?.blocks[0].content).toEqual(source.content);
  });

  it.each(["root", "snapshot"])("recognizes a now-detached source by its saved %s identity and permits recovery", (location) => {
    const { base, mine, latest, copied } = example();
    const source = latest.pages[0].blocks[0];
    source.analysis_run_id = null; source.artifact_id = null; source.source_available = false;
    if (location === "snapshot") source.source_ref = { snapshot: { analysis_run_id: "run", artifact_id: "artifact" } };
    const result = mergeReportDocuments(base, mine, latest);
    expect(result.unresolved).toBe(0);
    expect(copied(result.report)).toMatchObject({ copy_source_block_id: "origin", source_kind: "artifact", source_available: false,
      source_ref: source.source_ref, analysis_run_id: null, artifact_id: null });
    const draft: ReportRecoveryDraft = { schema: 1, id: "draft", revision: "r1", projectId: "project", reportId: "report",
      baseVersion: 2, document: result.report, updatedAt: Date.now() };
    expect(copied(restoreReportRecoveryDraft(draft, latest)!)).toMatchObject({ source_ref: source.source_ref, source_available: false });
  });

  it("uses the saved tree for copy eligibility even when the merge deletes the original page", () => {
    const { base, mine, latest, copied } = example();
    mine.pages = mine.pages.filter((page) => page.id !== "p1");
    const result = mergeReportDocuments(base, mine, latest);
    expect(result.unresolved).toBe(0);
    expect(result.report.pages.some((page) => page.id === "p1")).toBe(false);
    expect(copied(result.report)?.copy_source_block_id).toBe("origin");
  });

  it("rechecks a pending copy when the user retains its remotely deleted destination page", () => {
    const { base, mine, latest, copyId, choices, copied } = example();
    const moved = moveReportBlock(mine, copyId, "p2");
    moved.pages = moved.pages.filter((page) => !page.id.startsWith("local-"));
    latest.pages = [latest.pages[0]]; latest.pages[0].blocks = [];
    expect(mergeReportDocuments(base, moved, latest).conflicts.map((conflict) => conflict.id)).toEqual(["page:p2"]);
    const retainPage = { "page:p2": "mine" as const };
    const pending = mergeReportDocuments(base, moved, latest, retainPage);
    expect(pending.unresolved).toBe(1);
    expect(pending.conflicts.map((conflict) => conflict.id)).toEqual(["page:p2", `copy-source:${copyId}`]);
    const result = mergeReportDocuments(base, moved, latest, { ...retainPage, ...choices("mine") });
    expect(result.unresolved).toBe(0);
    expect(copied(result.report)?.source_kind).toBe("manual");
    expect(result.report.pages[1].id).toBe("local-page-merge-p2");
  });

  it("keeps both copies explicit after copying a copy, and does not flag a manually detached copy", () => {
    const { base, mine, latest, copyId, choices, copied } = example();
    const second = duplicateReportPage(mine, mine.pages[1].id, "第二副本", (kind) => `local-second-${kind}`)!;
    latest.pages[0].blocks = [];
    expect(mergeReportDocuments(base, second.document, latest).unresolved).toBe(2);
    const result = mergeReportDocuments(base, second.document, latest, { ...choices("mine"), "copy-source:local-second-block": "latest" });
    expect(result.unresolved).toBe(0);
    expect(result.report.pages.flatMap((page) => page.blocks).map((block) => block.id)).toEqual([copyId]);
    copied(mine)!.source_kind = "manual";
    expect(mergeReportDocuments(base, mine, latest).unresolved).toBe(0);
  });

  it("keeps the accepted static copy through undo, redo, recovery and save serialization without an invalid reference", async () => {
    const { base, mine, latest, copied, choices } = example();
    latest.pages[0].blocks = [];
    const merged = mergeReportDocuments(base, mine, latest, choices("mine")).report;
    const history = new ReportEditHistory((kind) => `local-${kind}`);
    history.reset(latest); history.record(merged);
    expect(history.move("undo")).toBe(latest);
    expect(history.move("redo")).toBe(merged);
    const draft: ReportRecoveryDraft = { schema: 1, id: "draft", revision: "r1", projectId: "project", reportId: "report",
      baseVersion: 2, document: merged, updatedAt: Date.now() };
    const restored = restoreReportRecoveryDraft(draft, latest)!;
    expect(copied(restored)).toEqual(copied(merged));
    const patch = vi.spyOn(api, "patch").mockResolvedValue({ data: { data: merged } });
    try {
      await updateReport("project", "report", { ...restored, expected_version: restored.version },
        { unnamedBlock: "Block", textBlock: "Text", unnamedPage: "Page", unnamedReport: "Report" });
      const payload = patch.mock.calls[0][1] as { expected_version: number; pages: { blocks: Record<string, unknown>[] }[] };
      expect(payload.expected_version).toBe(2);
      const block = payload.pages.flatMap((page) => page.blocks)[0];
      expect(block).toMatchObject({ source_kind: "manual", artifact_id: null, analysis_run_id: null, content: copied(merged)!.content });
      expect(block).not.toHaveProperty("id"); expect(block).not.toHaveProperty("copy_source_block_id"); expect(block).not.toHaveProperty("source_ref");
    } finally { patch.mockRestore(); }
  });
});
