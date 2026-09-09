import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import { ReportMoveBlockDialog } from "@/components/reports/ReportMoveBlockDialog";
import { duplicateReportPage, moveReportBlock, reorderReportPage } from "@/lib/report-page-editing";
import type { ReportDocument } from "@/lib/reports";
import { mockSemanticDialogs } from "./semantic-dialog-mock";
import messages from "@/messages/zh.json";

afterEach(cleanup);
function example(): ReportDocument {
  return { id: "report", project_id: "project", title: "Report", description: "", status: "draft", version: 1, created_at: "2026-09-01", updated_at: "2026-09-01", pages: [
    { id: "source", title: "概览", order_index: 0, config: {}, blocks: [{ id: "card", title: "收入", block_type: "text", source_kind: "manual", order_index: 0, content: { text: "收入增长" }, config: { interaction_key: "local-card", filter_target_key: "report-card" }, layout: { x: 0, y: 0, w: 6, h: 3 } }] },
    { id: "target", title: "门店", order_index: 1, config: {}, blocks: [] },
  ] };
}

it("moves the existing card and leaves the input and report-wide identity unchanged", () => {
  const document = example(), before = structuredClone(document);
  const moved = moveReportBlock(document, "card", "target");
  expect(document).toEqual(before);
  expect(moved.pages[0].blocks).toEqual([]);
  expect(moved.pages[1].blocks[0]).toMatchObject({ id: "card", content: before.pages[0].blocks[0].content, config: { filter_target_key: "report-card" } });
  expect(moved.pages[1].blocks[0].config.interaction_key).toBeUndefined();
  expect(moveReportBlock(document, "card", "missing")).toBe(document);
});

it("duplicates local relationships without reusing identities and reorders by destination", () => {
  const document = example(); let id = 0;
  const copy = duplicateReportPage(document, "source", "概览副本", prefix => `local-${prefix}-${++id}`, () => `key-${++id}`)!;
  expect(copy.document.pages).toHaveLength(3);
  expect(copy.page.blocks[0].id).not.toBe("card");
  expect(copy.page.blocks[0].config.interaction_key).not.toBe("local-card");
  expect(document.pages).toHaveLength(2);
  expect(reorderReportPage(copy.document.pages, "target", "source", "before").map(page => page.id)).toEqual(["target", "source", copy.page.id]);
});

it("keeps destination filtering local and resets it for a different report", () => {
  const restore = mockSemanticDialogs(), move = vi.fn();
  const view = (report: ReportDocument, disabled = false) => <NextIntlClientProvider locale="zh" messages={messages}>
    <ReportMoveBlockDialog report={report} blockId="card" disabled={disabled} onMove={move} onClose={vi.fn()} />
  </NextIntlClientProvider>;
  try {
    const { rerender } = render(view(example()));
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "不存在" } }); expect(move).not.toHaveBeenCalled();
    rerender(view({ ...example(), id: "another" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    const destination = screen.getByRole("button", { name: /门店/ });
    fireEvent.click(destination); expect(move).toHaveBeenCalledExactlyOnceWith("target");
    rerender(view({ ...example(), id: "another" }, true));
    expect(destination).toBeDisabled(); fireEvent.click(destination); expect(move).toHaveBeenCalledOnce();
  } finally { cleanup(); restore(); }
});
