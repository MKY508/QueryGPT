import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataTable } from "@/components/chat/DataTable";
import { ReportBlockCard } from "@/components/reports/ReportBlockCard";
import type { ReportBlock } from "@/lib/reports";
import messages from "@/messages/zh.json";

const intl = (children: ReactNode) => <NextIntlClientProvider locale="zh" messages={messages}>{children}</NextIntlClientProvider>;
const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function(this: HTMLDialogElement) {
      this.open = false;
      queueMicrotask(() => this.dispatchEvent(new Event("close")));
    } },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard); else Reflect.deleteProperty(navigator, "clipboard");
});

describe("data view integration", () => {
  it("opens a report snapshot with sparse and off-canvas columns, without selecting or changing the block", async () => {
    const row = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`field${index}`, index]));
    const block: ReportBlock = { id: "orders", block_type: "table", title: "订单", order_index: 0,
      source_kind: "manual", content: { rows: [row, { ...row, lateField: "later value" }], rows_count: 12 },
      config: {}, layout: { x: 0, y: 0, w: 12, h: 6 } };
    const select = vi.fn();
    const card = (current: ReportBlock, staticRendering = false) => intl(<ReportBlockCard block={current}
      selected={false} editing={!staticRendering} staticRendering={staticRendering} onSelect={select}
      onMove={vi.fn()} onResize={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} />);
    const view = render(card(block));
    expect(screen.getByText("显示 8 / 9 列")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "lateField" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看订单的数据" }));
    const dialog = screen.getByRole("dialog", { name: "订单 · 数据" });
    expect(within(dialog).getByRole("columnheader", { name: "lateField" })).toBeInTheDocument();
    expect(within(dialog).getByRole("cell", { name: "later value" })).toBeInTheDocument();
    expect(within(dialog).getByText("报告保留前 2 / 共 12 行")).toBeInTheDocument();
    expect(select).not.toHaveBeenCalled();
    view.rerender(card({ ...block, content: { rows: [{ changed: "new result" }] } }));
    expect(within(dialog).getByRole("cell", { name: "later value" })).toBeInTheDocument();
    expect(within(dialog).queryByText("new result")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭数据窗口" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    view.rerender(card(block, true));
    expect(screen.queryByRole("button", { name: "查看订单的数据" })).not.toBeInTheDocument();
  });

  it("opens rows beyond the chat preview cap and keeps numeric formatting in the source unchanged", () => {
    const data = Array.from({ length: 101 }, (_, index) => ({ order: `order-${index + 1}`, amount: "-9007199254740993.0123" }));
    render(intl(<DataTable title="Query" data={data} />));
    expect(screen.getByText("预览 100 / 101 行")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看Query的数据" }));
    const dialog = screen.getByRole("dialog", { name: "Query · 数据" });
    fireEvent.change(within(dialog).getByRole("searchbox", { name: "搜索表格" }), { target: { value: "order-101" } });
    expect(within(dialog).getByRole("cell", { name: "order-101" })).toBeInTheDocument();
    expect(within(dialog).getByRole("cell", { name: "-9007199254740993.0123" })).toHaveClass("text-destructive");
    expect(data[100].amount).toBe("-9007199254740993.0123");
  });
});
