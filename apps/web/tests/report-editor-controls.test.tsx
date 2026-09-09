import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { ReportPropertyPanel } from "@/components/reports/ReportPropertyPanel";
import { ChartPropertySettings } from "@/components/reports/ChartPropertySettings";
import type { ReportBlock, ReportPage } from "@/lib/reports";
import messages from "@/messages/zh.json";

describe("report editor controls", () => {

  it("offers fields from later rows and never edits generated chart images", () => {
    const block: ReportBlock = { id: "sparse", title: "", block_type: "chart", source_kind: "manual", order_index: 0,
      content: { rows: [{ 类别: "A" }, { 类别: "B", 营收: 42, 成本: 12 }] },
      config: { chart_type: "bar", y_keys: ["营收"], custom_option: "retain" }, layout: { x: 0, y: 0, w: 6, h: 4 } };
    const change = vi.fn();
    const tree = (selected: ReportBlock) => <NextIntlClientProvider locale="zh" messages={messages}>
      <ChartPropertySettings block={selected} onChangeBlock={change} />
    </NextIntlClientProvider>;
    const view = render(tree(block));
    fireEvent.click(screen.getByRole("checkbox", { name: "成本" }));
    expect(change).toHaveBeenCalledWith({ config: { ...block.config, y_key: "营收", y_keys: ["营收", "成本"], stack: "none" } });
    view.rerender(tree({ ...block, content: { ...block.content, image_url: "/chart.png" } }));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(change).toHaveBeenCalledOnce();
  });

  it("collapses chart settings without editing data and retains edited values when reopened", () => {
    const block: ReportBlock = { id: "chart-1", title: "营收", block_type: "chart", source_kind: "manual", order_index: 0,
      content: { rows: [{ 渠道: "线上", 营收: 42 }] },
      config: { chart_type: "bar", x_key: "渠道", y_key: "营收", y_keys: ["营收"], palette: "receiptbi", custom_option: "retain" },
      layout: { x: 0, y: 0, w: 12, h: 5 } };
    const change = vi.fn(); const changePage = vi.fn();
    const page: ReportPage = { id: "page-1", title: "概览", order_index: 0, config: {}, blocks: [block] };
    const panel = (selected: ReportBlock) => <NextIntlClientProvider locale="zh" messages={messages}>
      <ReportPropertyPanel page={page} block={selected} onChangeBlock={change} onChangePage={changePage} />
    </NextIntlClientProvider>;
    const { rerender } = render(panel(block));
    expect(screen.getByRole("button", { name: "图表结构" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("combobox", { name: "图表配色方案" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "图表联动" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "显示与格式" }));
    expect(change).not.toHaveBeenCalled();
    expect(changePage).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("combobox", { name: "图表配色方案" }), { target: { value: "categorical" } });
    expect(change).toHaveBeenCalledExactlyOnceWith({ config: { ...block.config, palette: "categorical" } });
    rerender(panel({ ...block, config: { ...block.config, palette: "categorical" } }));
    fireEvent.click(screen.getByRole("button", { name: "显示与格式" }));
    fireEvent.click(screen.getByRole("button", { name: "显示与格式" }));
    expect(screen.getByRole("combobox", { name: "图表配色方案" })).toHaveValue("categorical");
    expect(change).toHaveBeenCalledOnce();
    rerender(panel({ ...block, id: "chart-2" }));
    expect(screen.getByRole("button", { name: "显示与格式" })).toHaveAttribute("aria-expanded", "false");
  });
});
