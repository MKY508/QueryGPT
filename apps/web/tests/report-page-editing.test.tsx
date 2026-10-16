import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { duplicateReportPage, reorderReportPage } from "@/lib/report-page-editing";
import { ReportOutline } from "@/components/reports/ReportOutline";
import { configureCrossFilter, crossFilterRule } from "@/lib/report-interactions";
import { configureReportFilter, connectedReportFilters } from "@/lib/report-filter-connections";
import { historyNeedsSourceCopy, reconcileReportAfterSave } from "@/lib/report-edit-history";
import { restoreReportRecoveryDraft, type ReportRecoveryDraft } from "@/lib/report-recovery";
import { updateReport, type ReportDocument } from "@/lib/reports";
import { api } from "@/lib/api/client";
import messages from "@/messages/zh.json";

function example(): ReportDocument {
  const chart = { id: "chart", title: "营收", block_type: "chart" as const, source_kind: "artifact" as const,
    artifact_id: null, analysis_run_id: null, source_ref: { snapshot: { artifact_id: "historical" } }, source_available: false,
    order_index: 0, content: { rows: [{ 渠道: "线上", 营收: 42 }] }, config: {}, layout: { x: 0, y: 0, w: 12, h: 5 } };
  const table = { ...chart, id: "table", block_type: "table" as const, title: "明细", order_index: 1 };
  const filter = { ...chart, id: "filter", source_kind: "manual" as const, block_type: "filter" as const, title: "渠道筛选", order_index: 2 };
  let report: ReportDocument = { id: "report", project_id: "project", version: 1, title: "经营报告", description: "", status: "draft", created_at: "2026-09-06", updated_at: "2026-09-06",
    pages: [{ id: "p1", title: "概览", order_index: 0, config: { narrative: "Keep narrative" }, blocks: [chart, table, filter] },
      { id: "p2", title: "说明", order_index: 1, config: {}, blocks: [] }] };
  report.pages[0] = configureCrossFilter(report.pages[0], "chart", "渠道", "table", "渠道");
  report = configureReportFilter(report, "filter", { scope: "report" });
  return configureReportFilter(report, "filter", { targetId: "table", field: "渠道" });
}

describe("report page editing", () => {
  it("duplicates the page subgraph without mutating source data, layout or filter targets", () => {
    const original = example(); const before = structuredClone(original);
    const result = duplicateReportPage(original, "p1", "概览（副本）")!;
    expect(original).toEqual(before);
    expect(result.document.pages.map((page) => page.title)).toEqual(["概览", "概览（副本）", "说明"]);
    expect(result.page.blocks.map((block) => block.id)).not.toEqual(original.pages[0].blocks.map((block) => block.id));
    expect(result.page.config).toEqual(original.pages[0].config);
    expect(result.page.blocks[0]).toMatchObject({ source_kind: "artifact", copy_source_block_id: "chart", source_ref: original.pages[0].blocks[0].source_ref });
    expect(result.page.blocks[0].content).not.toBe(original.pages[0].blocks[0].content);
    expect(result.page.blocks[0].layout).toEqual(original.pages[0].blocks[0].layout);
    expect(crossFilterRule(result.page, result.page.blocks[0])?.targets[0].key).toBe(result.page.blocks[1].config.interaction_key);
    const filters = connectedReportFilters(result.document);
    expect(filters.map((filter) => filter.targets[0].block.id)).toEqual(["table", result.page.blocks[1].id]);
    expect(historyNeedsSourceCopy(result.document)).toBe(false);
  });

  it("preserves pending copy origins across copies, recovery and save acknowledgements", () => {
    const source = example();
    const first = duplicateReportPage(source, "p1", "Copy")!;
    const second = duplicateReportPage(first.document, first.page.id, "Second copy")!;
    expect(second.page.blocks[0].copy_source_block_id).toBe("chart");
    const draft: ReportRecoveryDraft = { schema: 1, id: "draft", revision: "r1", projectId: "project", reportId: "report", updatedAt: 1, baseVersion: 1, document: second.document };
    expect(restoreReportRecoveryDraft(draft, source)?.pages[2].blocks[0]).toMatchObject({ copy_source_block_id: "chart", source_available: false });
    const sent = { ...first.document, pages: [first.page] };
    const saved = structuredClone(sent);
    saved.version = 2; saved.pages[0].id = "saved-page";
    saved.pages[0].blocks.forEach((block, i) => { block.id = `saved-${i}`; delete block.copy_source_block_id; });
    const current = { ...second.document, pages: [first.page, second.page] };
    const reconciled = reconcileReportAfterSave(current, sent, saved).report;
    expect(reconciled.pages[0].blocks[0].copy_source_block_id).toBeUndefined();
    expect(reconciled.pages[1].blocks[0].copy_source_block_id).toBe("saved-0");
    expect(restoreReportRecoveryDraft({ ...draft, document: { ...second.document, pages: [{ ...second.page, blocks: [{ ...second.page.blocks[0], copy_source_block_id: "foreign" }] }] } }, source)).toBeNull();
  });

  it("serializes only pending copy references, never a canonical block's stale origin", async () => {
    const duplicated = duplicateReportPage(example(), "p1", "Copy")!;
    const patch = vi.spyOn(api, "patch").mockResolvedValue({ data: { data: duplicated.document } });
    try {
      await updateReport("project", "report", { ...duplicated.document, expected_version: 1 }, { unnamedBlock: "Block", textBlock: "Text", unnamedPage: "Page", unnamedReport: "Report" });
      const payload = patch.mock.calls[0][1] as { pages: { blocks: { id?: string; copy_source_block_id?: string }[] }[] };
      expect(payload.pages[1].blocks[0]).toMatchObject({ copy_source_block_id: "chart", analysis_run_id: null, artifact_id: null });
      expect(payload.pages[1].blocks[0].id).toBeUndefined();
      expect(payload.pages[0].blocks[0].copy_source_block_id).toBeUndefined();
    } finally { patch.mockRestore(); }
  });

  it("does not turn ambiguous existing filter references into valid connections", () => {
    const original = example();
    original.pages[1].blocks.push({ ...structuredClone(original.pages[0].blocks[1]), id: "ambiguous-target" });
    expect(connectedReportFilters(original)[0].targets).toEqual([]);
    const copied = duplicateReportPage(original, "p1", "Copy")!;
    expect(connectedReportFilters(copied.document).every((filter) => filter.targets.length === 0)).toBe(true);
  });

  it("moves to either side of a target and ignores missing, same or unchanged destinations", () => {
    const pages = example().pages;
    expect(reorderReportPage(pages, "p2", "p1", "before").map((page) => page.id)).toEqual(["p2", "p1"]);
    expect(reorderReportPage(pages, "p1", "p2", "after").map((page) => page.order_index)).toEqual([0, 1]);
    expect(reorderReportPage(pages, "p1", "p2", "before")).toBe(pages);
    expect(reorderReportPage(pages, "p1", "p1", "after")).toBe(pages);
    expect(reorderReportPage(pages, "missing", "p1", "before")).toBe(pages);
  });

  it("supports keyboard and drag reordering but rejects external or filtered drags", () => {
    const move = vi.fn(); const reorder = vi.fn(); const duplicate = vi.fn();
    const { container } = render(<NextIntlClientProvider locale="zh" messages={messages}>
      <ReportOutline pages={example().pages} activePageId="p1" selectedBlockId={null} disabled={false} blockLabel={() => "内容"}
        onSelectPage={vi.fn()} onSelectBlock={vi.fn()} onAddPage={vi.fn()} onMovePage={move} onReorderPage={reorder}
        onDuplicatePage={duplicate} onDeletePage={vi.fn()} onClose={vi.fn()} />
    </NextIntlClientProvider>);
    const handle = screen.getByRole("button", { name: "移动页面：说明" });
    handle.focus(); fireEvent.keyDown(handle, { key: "ArrowUp", altKey: true });
    expect(move).toHaveBeenCalledWith("p2", -1); expect(handle).toHaveFocus();
    const transfer = { effectAllowed: "", dropEffect: "", setData: vi.fn(), getData: () => "p2", setDragImage: vi.fn() };
    const row = container.querySelector('[data-report-page-row="p1"]')!;
    fireEvent.drop(row, { dataTransfer: transfer, clientY: -1 });
    expect(reorder).not.toHaveBeenCalled();
    fireEvent.dragStart(handle, { dataTransfer: transfer });
    const drop = createEvent.drop(row, { dataTransfer: transfer });
    Object.defineProperty(drop, "clientY", { value: -1 });
    fireEvent(row, drop);
    expect(reorder).toHaveBeenCalledWith("p2", "p1", "before");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "说明" } });
    expect(handle).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "页面操作：说明" }));
    fireEvent.click(screen.getByRole("button", { name: "复制页面：说明" }));
    expect(duplicate).toHaveBeenCalledWith("p2");
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });
});
