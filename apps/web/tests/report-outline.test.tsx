import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { filterReportOutline, moveReportPage, ReportOutline } from "@/components/reports/ReportOutline";
import { ReportPropertyPanel } from "@/components/reports/ReportPropertyPanel";
import type { ReportPage } from "@/lib/reports";
import messages from "@/messages/zh.json";

const pages: ReportPage[] = [
  { id: "p1", title: "经营概览", order_index: 0, config: {}, blocks: [{ id: "b1", title: "营收", block_type: "text", source_kind: "manual", order_index: 0, content: { text: "保留的内容" }, config: {}, layout: { x: 0, y: 0, w: 12, h: 3 } }] },
  { id: "p2", title: "门店表现", order_index: 1, config: {}, blocks: [{ id: "b2", title: "旗舰店毛利", block_type: "metric", source_kind: "manual", order_index: 0, content: { value: "30%" }, config: {}, layout: { x: 0, y: 0, w: 6, h: 2 } }] },
];

describe("report outline", () => {
  it("navigates visible outline targets without selecting, reordering, or consuming text editing keys", () => {
    const select = vi.fn(), move = vi.fn();
    render(<NextIntlClientProvider locale="zh" messages={messages}><ReportOutline pages={pages} activePageId="p1" selectedBlockId={null}
      disabled={false} blockLabel={() => "内容"} onSelectPage={select} onSelectBlock={select} onAddPage={vi.fn()}
      onMovePage={move} onReorderPage={vi.fn()} onDuplicatePage={vi.fn()} onDeletePage={vi.fn()} onClose={vi.fn()} /></NextIntlClientProvider>);
    const input = screen.getByRole("searchbox"); input.focus();
    fireEvent.keyDown(input, { key: "Home" }); expect(input).toHaveFocus();
    fireEvent.compositionStart(input); fireEvent.keyDown(input, { key: "ArrowDown" }); expect(input).toHaveFocus();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "ArrowDown", keyCode: 229 }); expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const overview = screen.getByRole("button", { name: /01.*经营概览/ });
    const stores = screen.getByRole("button", { name: /02.*门店表现/ });
    expect(overview).toHaveFocus();
    fireEvent.keyDown(overview, { key: "ArrowDown" });
    const revenue = screen.getByRole("button", { name: "营收" }); expect(revenue).toHaveFocus();
    fireEvent.keyDown(revenue, { key: "End" }); expect(stores).toHaveFocus();
    expect(screen.queryByRole("button", { name: "旗舰店毛利" })).not.toBeInTheDocument();
    fireEvent.keyDown(stores, { key: "ArrowDown" }); expect(stores).toHaveFocus();
    fireEvent.keyDown(stores, { key: "Home" }); expect(overview).toHaveFocus();
    fireEvent.keyDown(overview, { key: "ArrowUp" }); expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "旗舰店" } });
    fireEvent.keyDown(input, { key: "ArrowDown" }); expect(stores).toHaveFocus();
    fireEvent.keyDown(stores, { key: "End" });
    const block = screen.getByRole("button", { name: "旗舰店毛利" }); expect(block).toHaveFocus();
    fireEvent.keyDown(block, { key: "ArrowUp", altKey: true }); expect(block).toHaveFocus();
    expect(select).not.toHaveBeenCalled(); expect(move).not.toHaveBeenCalled();
    fireEvent.click(block); expect(select).toHaveBeenCalledWith("p2", "b2");
    fireEvent.change(input, { target: { value: "无结果" } }); input.focus();
    fireEvent.keyDown(input, { key: "ArrowDown" }); expect(input).toHaveFocus();
  });
  it("clears outline search with focus return while keeping page actions ahead of query dismissal", () => {
    const close = vi.fn(), select = vi.fn();
    render(<NextIntlClientProvider locale="zh" messages={messages}><ReportOutline pages={pages} activePageId="p1" selectedBlockId={null}
      disabled={false} blockLabel={() => "内容"} onSelectPage={select} onSelectBlock={select} onAddPage={vi.fn()}
      onMovePage={vi.fn()} onReorderPage={vi.fn()} onDuplicatePage={vi.fn()} onDeletePage={vi.fn()} onClose={close} /></NextIntlClientProvider>);
    const input = screen.getByRole("searchbox");
    expect(screen.getByText("2 页 · 2 项内容")).toHaveAttribute("role", "status");
    fireEvent.change(input, { target: { value: "旗舰店" } });
    expect(screen.getByText("1 / 2 页 · 1 / 2 项内容")).toBeInTheDocument();
    const actions = screen.getByRole("button", { name: "页面操作：门店表现" });
    fireEvent.click(actions);
    input.focus();
    fireEvent.compositionStart(input); fireEvent.keyDown(input, { key: "Escape" });
    expect(actions).toHaveAttribute("aria-expanded", "true"); expect(input).toHaveValue("旗舰店");
    fireEvent.compositionEnd(input); fireEvent.keyDown(input, { key: "Escape" });
    expect(actions).toHaveAttribute("aria-expanded", "false"); expect(input).toHaveValue("旗舰店");
    expect(input).toHaveFocus();
    fireEvent.click(actions);
    const copy = screen.getByRole("button", { name: "复制页面：门店表现" }); copy.focus();
    fireEvent.keyDown(copy, { key: "Escape" });
    expect(actions).toHaveFocus(); expect(actions).toHaveAttribute("aria-expanded", "false");
    expect(copy).not.toBeInTheDocument(); expect(input).toHaveValue("旗舰店");
    const block = screen.getByRole("button", { name: "旗舰店毛利" }); block.focus();
    fireEvent.keyDown(block, { key: "Escape" });
    expect(input).toHaveValue(""); expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "无匹配" } });
    expect(screen.getByText("0 / 2 页 · 0 / 2 项内容")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除目录搜索" }));
    expect(input).toHaveValue(""); expect(input).toHaveFocus();
    expect(screen.getByText("2 页 · 2 项内容")).toBeInTheDocument();
    expect(select).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" }); expect(close).toHaveBeenCalledOnce();
  });
  it("matches Unicode titles using the view locale while preserving literal titles and page identities", () => {
    const overview = { ...pages[0], title: "Ｃａｆｅ́ 总览" };
    const stores = { ...pages[1], blocks: [{ ...pages[1].blocks[0], title: "Ｏｆｆｉｃｅ ﬃ 分析" }] };
    const input = [stores, overview];
    const pageMatch = filterReportOutline(input, "café", "zh")[0];
    expect(pageMatch.page).toBe(overview); expect(pageMatch.index).toBe(0);
    expect(pageMatch.blocks).toBe(overview.blocks);
    const blockMatch = filterReportOutline(input, "office ffi", "en")[0];
    expect(blockMatch.page).toBe(stores); expect(blockMatch.index).toBe(1);
    expect(blockMatch.blocks[0]).toBe(stores.blocks[0]);
    expect(blockMatch.blocks[0].title).toBe("Ｏｆｆｉｃｅ ﬃ 分析");
    expect(filterReportOutline([{ ...overview, title: "IĞDIR" }], "ığdır", "tr")).toHaveLength(1);
    expect(filterReportOutline(input, "保留的内容", "zh")).toEqual([]);
    expect(input).toEqual([stores, overview]);
  });
  it("searches page and block names without changing report order or selection", () => {
    expect(filterReportOutline(pages, "旗舰店").map(({ page, blocks, index }) => [page.id, blocks[0].id, index])).toEqual([["p2", "b2", 1]]);
    expect(filterReportOutline(pages, " 经营概览 ")[0].blocks).toBe(pages[0].blocks);
    const select = vi.fn();
    render(<NextIntlClientProvider locale="zh" messages={messages}><ReportOutline pages={pages} activePageId="p1" selectedBlockId={null}
      disabled={false} blockLabel={() => "内容"} onSelectPage={vi.fn()} onSelectBlock={select} onAddPage={vi.fn()}
      onMovePage={vi.fn()} onReorderPage={vi.fn()} onDuplicatePage={vi.fn()} onDeletePage={vi.fn()} onClose={vi.fn()} /></NextIntlClientProvider>);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "旗舰店" } });
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "旗舰店毛利" }));
    expect(select).toHaveBeenCalledWith("p2", "b2");
    expect(pages.map((page) => page.id)).toEqual(["p1", "p2"]);
  });
  it("moves pages with stable identities and contents and rejects boundary/missing moves", () => {
    const moved = moveReportPage(pages, "p2", -1);
    expect(moved.map((page) => [page.id, page.order_index])).toEqual([["p2", 0], ["p1", 1]]);
    expect(moved[0].blocks).toBe(pages[1].blocks);
    expect(moveReportPage(pages, "p1", -1)).toBe(pages);
    expect(moveReportPage(pages, "missing", 1)).toBe(pages);
    expect(pages[1].order_index).toBe(1);
  });
  it("switches inspector scope without mutating content and follows a newly selected block", () => {
    const changePage = vi.fn(); const changeBlock = vi.fn(); const close = vi.fn();
    const panel = (page: ReportPage) => <NextIntlClientProvider locale="zh" messages={messages}><ReportPropertyPanel
      page={page} block={page.blocks[0]} onChangePage={changePage} onChangeBlock={changeBlock} onClose={close} /></NextIntlClientProvider>;
    const { rerender } = render(panel(pages[0]));
    fireEvent.click(screen.getByRole("tab", { name: "页面" }));
    expect(screen.getByRole("heading", { name: "页面设置" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "页面名称" }), { target: { value: "更新页面名" } });
    expect(changePage).toHaveBeenCalledWith({ title: "更新页面名" });
    expect(changeBlock).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("tab", { name: "页面" }), { key: "ArrowRight", isComposing: true });
    expect(screen.getByRole("tab", { name: "页面" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "页面" }), { key: "ArrowRight" });
    expect(screen.getByRole("textbox", { name: "区块标题" })).toHaveValue("营收");
    fireEvent.click(screen.getByRole("tab", { name: "页面" }));
    rerender(panel(pages[1]));
    expect(screen.getByRole("tab", { name: "内容" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("textbox", { name: "区块标题" })).toHaveValue("旗舰店毛利");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "区块标题" }), { key: "Escape", keyCode: 229 });
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "区块标题" }), { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
  });
});
