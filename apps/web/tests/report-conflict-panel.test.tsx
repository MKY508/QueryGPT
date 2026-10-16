import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ReportConflictPanel } from "@/components/reports/ReportConflictPanel";
import { duplicateReportPage, moveReportBlock } from "@/lib/report-page-editing";
import type { ReportDocument } from "@/lib/reports";
import messages from "@/messages/zh.json";

const show = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
beforeAll(() => Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } },
  close: { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } },
}));
afterEach(cleanup);
afterAll(() => {
  if (show) Object.defineProperty(HTMLDialogElement.prototype, "showModal", show); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (close) Object.defineProperty(HTMLDialogElement.prototype, "close", close); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

function example(): ReportDocument {
  return { id: "report", project_id: "project", title: "经营报告", description: "", status: "draft", version: 1,
    created_at: "old", updated_at: "old", pages: [
      { id: "p1", title: "概览", order_index: 0, config: {}, blocks: [{
        id: "card", title: "本月观察", block_type: "text", source_kind: "manual", order_index: 0,
        content: { text: "收入增长" }, config: {}, layout: { x: 0, y: 0, w: 12, h: 3 },
      }] },
      { id: "p2", title: "门店表现", order_index: 1, config: {}, blocks: [] },
      { id: "p3", title: "后续安排", order_index: 2, config: {}, blocks: [] },
    ] };
}

describe("report conflict choices", () => {
  it("explains an unavailable copy origin and requires an explicit keep or remove choice", () => {
    const base = example();
    Object.assign(base.pages[0].blocks[0], { source_kind: "artifact", artifact_id: "artifact", analysis_run_id: "run" });
    const mine = duplicateReportPage(base, "p1", "概览副本", (kind) => `local-${kind}`)!.document;
    const latest = { ...structuredClone(base), version: 2 };
    latest.pages[0].blocks = [];
    const onApply = vi.fn();
    render(<NextIntlClientProvider locale="zh" messages={messages}>
      <ReportConflictPanel base={base} mine={mine} latest={latest} loading={false} applying={false} failed={false} applyFailed={false}
        onRetry={vi.fn()} onClose={vi.fn()} onApply={onApply} />
    </NextIntlClientProvider>);
    const group = screen.getByRole("group", { name: "副本来源已变化 · 概览副本 / 本月观察" });
    const apply = screen.getByRole("button", { name: "应用并继续编辑" });
    expect(apply).toBeDisabled();
    expect(within(group).getByText(messages.reportConflict.copySourceHint)).toBeInTheDocument();
    expect(within(group).queryByText("已删除")).not.toBeInTheDocument();
    fireEvent.click(within(group).getByRole("radio", { name: /保留本地副本/ }));
    expect(apply).toBeEnabled(); expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(apply);
    expect((onApply.mock.calls[0][0] as ReportDocument).pages[1].blocks[0]).toMatchObject({ source_kind: "manual", content: { text: "收入增长" } });
    fireEvent.click(within(group).getByRole("radio", { name: /移除这个副本/ }));
    fireEvent.click(apply);
    expect((onApply.mock.calls[1][0] as ReportDocument).pages[1].blocks).toEqual([]);
  });

  it("asks only for a card destination, previews merged data, and invalidates choices after either snapshot changes", () => {
    const base = example(), mine = moveReportBlock(structuredClone(base), "card", "p2");
    const latest = { ...moveReportBlock(structuredClone(base), "card", "p3"), version: 2, description: "更新后的说明" };
    latest.pages[2].blocks[0].content.text = "收入与毛利均增长";
    const onApply = vi.fn();
    const renderPanel = (local: ReportDocument, remote: ReportDocument) => <NextIntlClientProvider locale="zh" messages={messages}>
      <ReportConflictPanel base={base} mine={local} latest={remote} loading={false} applying={false} failed={false} applyFailed={false}
        onRetry={vi.fn()} onClose={vi.fn()} onApply={onApply} />
    </NextIntlClientProvider>;
    const view = render(renderPanel(mine, latest));
    let group = screen.getByRole("group", { name: "内容所在页面 · 本月观察" });
    const apply = screen.getByRole("button", { name: "应用并继续编辑" });
    expect(apply).toBeDisabled();
    expect(screen.getByText("收入与毛利均增长")).toBeInTheDocument();
    expect(screen.queryByText(/整份|全部页面/)).not.toBeInTheDocument();
    fireEvent.click(within(group).getByRole("radio", { name: /保留我的修改.*门店表现/ }));
    expect(apply).toBeEnabled(); expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledOnce();
    const accepted = onApply.mock.calls[0][0] as ReportDocument;
    expect(accepted.description).toBe("更新后的说明");
    expect(accepted.pages[1].blocks[0]).toMatchObject({ id: "card", content: { text: "收入与毛利均增长" } });
    expect(accepted.pages[2].blocks).toHaveLength(0);

    const newer = structuredClone(latest); newer.version = 3; newer.pages[2].blocks[0].content.text = "重新读取的结论";
    view.rerender(renderPanel(mine, newer));
    expect(apply).toBeDisabled(); expect(screen.getAllByRole("radio").every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    group = screen.getByRole("group", { name: "内容所在页面 · 本月观察" });
    fireEvent.click(within(group).getByRole("radio", { name: /采用最新内容.*后续安排/ }));
    expect(apply).toBeEnabled();
    view.rerender(renderPanel(structuredClone(mine), newer));
    expect(apply).toBeDisabled();
  });

  it("explains mixed source preservation when restoring a deleted destination page", () => {
    const base = example(), mine = moveReportBlock(structuredClone(base), "card", "p2");
    const latest = { ...structuredClone(base), version: 2 };
    latest.pages = latest.pages.filter((page) => page.id !== "p2");
    render(<NextIntlClientProvider locale="zh" messages={messages}>
      <ReportConflictPanel base={base} mine={mine} latest={latest} loading={false} applying={false} failed={false} applyFailed={false}
        onRetry={vi.fn()} onClose={vi.fn()} onApply={vi.fn()} />
    </NextIntlClientProvider>);
    expect(screen.getByText(messages.reportConflict.copyPageHint)).toBeInTheDocument();
    expect(screen.queryByText(messages.reportConflict.copyHint)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "应用并继续编辑" })).toBeDisabled();
  });
});
