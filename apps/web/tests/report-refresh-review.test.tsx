import { StrictMode, type ComponentProps } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportRefreshDialog } from "@/components/reports/ReportRefreshDialog";
import { groupReportRefreshSources } from "@/lib/report-refresh-review";
import * as reports from "@/lib/reports";
import type { ReportRefreshPlan, ReportRefreshSourceLabel } from "@/lib/reports";
import messages from "@/messages/zh.json";

const source = (source_id: string, data_version = 1): ReportRefreshSourceLabel => ({ source_id, name: "订单.csv", data_version, kind: "file" });
const block = (id: string, previous = source("old"), next = source("new", 2)): ReportRefreshPlan["blocks"][number] => ({
  block_id: id, title: `内容 ${id}`, previous_source: previous, next_source: next, refreshed_at: "2026-09-01T04:00:00Z",
});
const example = (blocks = [block("one")]): ReportRefreshPlan => ({ project_id: "project", report_id: "report", page_id: "page", block_id: null,
  expected_version: 1, source_plan: "a".repeat(64), blocks });
const props = (): ComponentProps<typeof ReportRefreshDialog> => ({ projectId: "project", reportId: "report", pageId: "page", expectedVersion: 1,
  onConfirm: vi.fn().mockResolvedValue(undefined), onReload: vi.fn().mockResolvedValue(undefined), onClose: vi.fn() });
const viewer = (value: ComponentProps<typeof ReportRefreshDialog>) => <StrictMode><NextIntlClientProvider locale="zh" messages={messages}><ReportRefreshDialog {...value} /></NextIntlClientProvider></StrictMode>;
const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
beforeEach(() => Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } },
  close: { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; queueMicrotask(() => this.dispatchEvent(new Event("close"))); } },
}));
afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

describe("grouped report refresh review", () => {
  it("groups exact source transitions, prioritizes changes and preserves every original block and execution order", () => {
    const database = { ...source("db"), kind: "connection" as const, data_version: null };
    const plan = example([
      block("current", database, database),
      { ...block("unknown"), previous_source: null },
      block("first"), block("second"),
      block("different previous", source("another-old")),
      block("different version", source("old", 3)),
      block("same name different source", source("old"), source("another-new", 2)),
      block("same identity different kind", source("old"), { ...source("new", 2), kind: "connection" }),
      block("same identity different label", source("old"), { ...source("new", 2), name: "新名称.csv" }),
    ]);
    const before = structuredClone(plan), groups = groupReportRefreshSources(plan);
    expect(groups).toHaveLength(8);
    expect(groups.map((group) => group.state)).toEqual(["changed", "changed", "changed", "changed", "changed", "changed", "unrecorded", "current"]);
    expect(groups[0].blocks.map((item) => item.block_id)).toEqual(["first", "second"]);
    expect(groups[0].blocks[0]).toBe(plan.blocks[2]);
    expect(new Set(groups.flatMap((group) => group.blocks))).toEqual(new Set(plan.blocks));
    expect(plan).toEqual(before);
  });

  it("expands all affected titles and confirms the untouched full plan once, irrespective of collapsed groups", async () => {
    const plan = example(Array.from({ length: 5 }, (_, index) => block(`repeated-${index}`)));
    plan.blocks.push({ ...block("unrecorded"), previous_source: null });
    vi.spyOn(reports, "inspectReportRefreshSources").mockResolvedValue(plan);
    const value = props();
    let finish!: () => void;
    const confirming = new Promise<void>((resolve) => { finish = resolve; });
    value.onConfirm = vi.fn(() => confirming);
    render(viewer(value));
    const review = await screen.findByRole("region", { name: "本次刷新内容" });
    expect(within(review).getByText("共 6 项内容 · 2 组来源")).toBeInTheDocument();
    expect(screen.getByText("5 项来源有变化")).toBeInTheDocument();
    const disclosure = within(review).getByText("涉及的 5 项内容").closest("details")!;
    expect(disclosure.open).toBe(false);
    fireEvent.click(disclosure.querySelector("summary")!);
    expect(disclosure.open).toBe(true);
    for (const item of plan.blocks.slice(0, 5)) expect(within(disclosure).getByText(item.title)).toBeVisible();
    expect(disclosure.querySelectorAll("time")).toHaveLength(5);
    expect(review.textContent).not.toContain("old"); expect(review.textContent).not.toContain(plan.source_plan);
    fireEvent.click(disclosure.querySelector("summary")!);
    expect(screen.getByText("刷新全部 6 项")).toBeInTheDocument();
    expect(value.onConfirm).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", { name: "确认刷新" });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(value.onConfirm).toHaveBeenCalledExactlyOnceWith(plan);
    expect(vi.mocked(value.onConfirm).mock.calls[0][0]).toBe(plan);
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    const cancel = new Event("cancel", { cancelable: true });
    fireEvent(screen.getByRole("dialog"), cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(value.onClose).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(value.onClose).toHaveBeenCalledOnce();
  });

  it("starts a new review for a new expected version and ignores old reads, writes and queued close events", async () => {
    const pending: { version: number; signal?: AbortSignal; resolve: (plan: ReportRefreshPlan) => void }[] = [];
    vi.spyOn(reports, "inspectReportRefreshSources").mockImplementation((_p, _r, _page, version, _b, signal) => new Promise((resolve) => pending.push({ version, signal, resolve })));
    const value = props();
    let finish!: () => void;
    value.onConfirm = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const view = render(viewer(value));
    await act(async () => { for (const read of pending.filter((entry) => entry.version === 1)) read.resolve(example()); });
    fireEvent.click(screen.getByRole("button", { name: "确认刷新" }));
    expect(value.onConfirm).toHaveBeenCalledOnce();
    view.rerender(viewer({ ...value, expectedVersion: 2 }));
    await act(async () => finish());
    expect(value.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "确认刷新" })).toBeDisabled();
    expect(screen.queryByText("共 1 项内容 · 1 组来源")).not.toBeInTheDocument();
    const oldReads = pending.filter((entry) => entry.version === 2);
    view.rerender(viewer({ ...value, expectedVersion: 3 }));
    expect(oldReads.every((entry) => entry.signal?.aborted)).toBe(true);
    await act(async () => { for (const read of oldReads) read.resolve({ ...example(), expected_version: 2 }); });
    expect(screen.getByRole("button", { name: "确认刷新" })).toBeDisabled();
    await act(async () => { for (const read of pending.filter((entry) => entry.version === 3)) read.resolve({ ...example([block("latest")]), expected_version: 3 }); });
    await waitFor(() => expect(screen.getByRole("button", { name: "确认刷新" })).toBeEnabled());
    expect(screen.getByText("内容 latest")).toBeInTheDocument();
    expect(value.onClose).not.toHaveBeenCalled();
    expect(value.onConfirm).toHaveBeenCalledOnce();
  });
});
