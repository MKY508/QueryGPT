import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { StrictMode, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Papa from "papaparse";
import { DataViewDialog, type DataViewSnapshot } from "@/components/data/DataViewDialog";
import { DataRecordDetails } from "@/components/data/DataRecordDetails";
import * as csv from "@/lib/csv";
import { tableViewRecords } from "@/lib/tabular-data";
import * as tabular from "@/lib/tabular-data";
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

function Viewer({ snapshot }: { snapshot: DataViewSnapshot }) {
  const [open, setOpen] = useState(true);
  return open ? <DataViewDialog snapshot={snapshot} onClose={() => setOpen(false)} /> : null;
}

describe("data view", () => {
  it("retains record navigation focus at boundaries and blocks unavailable actions", () => {
    const navigate = vi.fn();
    const record = { index: 0, row: { name: "East" } };
    const view = (position: number) => intl(<DataRecordDetails record={record} position={position} total={2} columns={["name"]}
      kinds={new Map()} filterEditing={false} onFilter={vi.fn()} onNavigate={navigate} onClose={vi.fn()} />);
    const { rerender } = render(view(0));
    const previous = screen.getByRole("button", { name: "上一条记录" });
    const next = screen.getByRole("button", { name: "下一条记录" });
    previous.focus(); fireEvent.click(previous); expect(previous).toHaveFocus(); expect(navigate).not.toHaveBeenCalled();
    next.focus(); fireEvent.click(next); expect(navigate).toHaveBeenLastCalledWith(1);
    rerender(view(1)); expect(next).toHaveFocus(); expect(next).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(next); expect(navigate).toHaveBeenCalledTimes(1);
    previous.focus(); fireEvent.click(previous); expect(navigate).toHaveBeenLastCalledWith(-1);
    rerender(view(0)); expect(previous).toHaveFocus();
    fireEvent.click(previous); expect(navigate).toHaveBeenCalledTimes(2);
  });
  it("keeps the table, search and pagination visible while inspecting a record", () => {
    const { container } = render(intl(<Viewer snapshot={{ title: "Orders", rows: [{ name: "East", amount: 1 }] }} />));
    const search = screen.getByRole("searchbox", { name: "搜索表格" });
    fireEvent.change(search, { target: { value: "East" } });
    fireEvent.click(screen.getByRole("button", { name: "查看第 1 条记录" }));
    expect(screen.getByRole("table", { name: "Orders" })).toBeVisible();
    expect(search).toBeVisible();
    expect(screen.getByRole("navigation", { name: messages.dataView.pagination })).toBeVisible();
    expect(container.querySelector("[data-compact-table-region]")).toBeNull();
    search.focus();
    fireEvent.change(search, { target: { value: "" } });
    expect(search).toHaveFocus();
    expect(screen.getByRole("complementary", { name: messages.dataView.recordDetails })).toBeVisible();
  });
  it("clears column search before dismissing the picker without changing hidden columns", () => {
    render(intl(<Viewer snapshot={{ title: "Orders", rows: [{ name: "East", amount: 1 }] }} />));
    const picker = screen.getByText("显示列 2/2").closest("details")!;
    picker.open = true;
    const input = within(picker).getByRole("searchbox", { name: "查找列" });
    fireEvent.change(input, { target: { value: "amount" } });
    fireEvent.click(within(picker).getByRole("checkbox", { name: "amount" }));
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("amount"); expect(picker.open).toBe(true);
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue(""); expect(input).toHaveFocus(); expect(picker.open).toBe(true);
    expect(within(picker).getByRole("checkbox", { name: "amount" })).not.toBeChecked();
    fireEvent.change(input, { target: { value: "missing" } });
    fireEvent.click(within(picker).getByRole("button", { name: "清除列搜索" }));
    expect(input).toHaveFocus(); expect(input).toHaveValue("");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(picker.open).toBe(false); expect(picker.querySelector("summary")).toHaveFocus();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "amount" })).not.toBeInTheDocument();
  });
  it("distinguishes field search misses from no visible fields and announces the matching count", () => {
    const record = { index: 0, row: { name: "East", amount: 1 } };
    const details = (columns: string[]) => intl(<DataRecordDetails record={record} position={0} total={1} columns={columns}
      kinds={new Map()} filterEditing={false} onFilter={() => {}} onNavigate={() => {}} onClose={() => {}} />);
    const { rerender } = render(details(["name", "amount"]));
    const search = screen.getByRole("searchbox", { name: "查找字段…" });
    fireEvent.change(search, { target: { value: "amount" } });
    expect(screen.getByRole("status")).toHaveTextContent("1 / 2 个字段");
    expect(search).toHaveAccessibleDescription("1 / 2 个字段");
    const query = "<script>missing</script>";
    fireEvent.change(search, { target: { value: query } });
    expect(search).toHaveAccessibleDescription(`没有与“${query}”匹配的字段`);
    expect(screen.getByRole("status")).toHaveTextContent("0 / 2 个字段");
    expect(document.querySelector("aside script")).toBeNull();
    expect(screen.getByRole("button", { name: "复制记录" })).toBeEnabled();
    rerender(details([]));
    expect(search).toHaveAccessibleDescription("当前没有显示的字段");
    expect(screen.getByRole("button", { name: "复制记录" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "清除字段搜索" }));
    expect(search).toHaveFocus();
    expect(search).toHaveAccessibleDescription("当前没有显示的字段");
  });
  it("clears each search locally before Escape closes record details and keeps composition intact", () => {
    render(intl(<Viewer snapshot={{ title: "Orders", rows: [{ name: "East", amount: 1 }, { name: "West", amount: 2 }] }} />));
    const search = screen.getByRole("searchbox", { name: "搜索表格" });
    fireEvent.change(search, { target: { value: "East" } });
    fireEvent.compositionStart(search);
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("East");
    fireEvent.compositionEnd(search);
    fireEvent.click(screen.getByRole("button", { name: "清除表格搜索" }));
    expect(search).toHaveValue(""); expect(search).toHaveFocus();
    expect(screen.queryByRole("button", { name: "清除表格搜索" })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "East" } });
    fireEvent.click(screen.getByRole("button", { name: "查看第 1 条记录" }));
    const field = screen.getByRole("searchbox", { name: "查找字段…" });
    fireEvent.change(field, { target: { value: "amount" } });
    fireEvent.keyDown(field, { key: "Escape", isComposing: true });
    expect(field).toHaveValue("amount");
    fireEvent.keyDown(field, { key: "Escape" });
    expect(field).toHaveValue(""); expect(field).toHaveFocus();
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    expect(search).toHaveValue("East");
    fireEvent.change(field, { target: { value: "name" } });
    fireEvent.click(screen.getByRole("button", { name: "清除字段搜索" }));
    expect(field).toHaveValue(""); expect(field).toHaveFocus();
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2 / 2 行");
  });
  it("reuses the sorted model while searching and selecting, and refreshes it for a new order", () => {
    const model = vi.spyOn(tabular, "tableViewRecords");
    const download = vi.spyOn(csv, "downloadCsv").mockImplementation(() => {});
    const rows = [{ name: "West", amount: 3 }, { name: "East", amount: 1 }, { name: "North", amount: 2 }];
    render(intl(<Viewer snapshot={{ title: "Orders", rows, sort: { column: "amount", direction: "asc" } }} />));
    const initialCalls = model.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "选择记录" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择第 1 条记录" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择第 2 条记录" }));
    const search = screen.getByRole("searchbox", { name: "搜索表格" });
    fireEvent.change(search, { target: { value: "West" } });
    expect(model).toHaveBeenCalledTimes(initialCalls);
    fireEvent.click(screen.getByRole("button", { name: /导出所选/ }));
    expect(download.mock.calls.at(-1)?.[0]).toEqual([rows[1], rows[2]]);
    fireEvent.change(search, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "amount" }));
    expect(model).toHaveBeenCalledTimes(initialCalls + 1);
    fireEvent.click(screen.getByRole("button", { name: /导出所选/ }));
    expect(download.mock.calls.at(-1)?.[0]).toEqual([rows[2], rows[1]]);
  });
  it("uses width-insensitive search for rows, column choices and record fields without renaming them", () => {
    render(intl(<Viewer snapshot={{ title: "Orders", rows: [{ "Ａｍｏｕｎｔ": "Ｅａｓｔ", note: "original" }] }} />));
    fireEvent.change(screen.getByRole("searchbox", {name: "搜索表格"}), {target: {value: "east"}});
    expect(screen.getByRole("cell", {name: "Ｅａｓｔ"})).toBeInTheDocument();
    const chooser = screen.getByText("显示列 2/2").closest("details")!;
    chooser.open = true;
    fireEvent.change(within(chooser).getByRole("searchbox", {name: "查找列"}), {target: {value: "amount"}});
    expect(within(chooser).getByRole("checkbox", {name: "Ａｍｏｕｎｔ"})).toBeInTheDocument();
    expect(within(chooser).queryByRole("checkbox", {name: "note"})).not.toBeInTheDocument();
    fireEvent.click(within(chooser).getByRole("button", {name: "完成"}));
    fireEvent.click(screen.getByRole("button", {name: "查看第 1 条记录"}));
    const details = screen.getByRole("complementary");
    fireEvent.change(within(details).getByRole("searchbox", {name: "查找字段…"}), {target: {value: "amount"}});
    expect(within(details).getByText("Ｅａｓｔ", {exact: true})).toBeInTheDocument();
    expect(within(details).queryByText("original", {exact: true})).not.toBeInTheDocument();
  });

  it("protects filter drafts from chip edits, removal and clearing until explicitly finished", () => {
    render(intl(<Viewer snapshot={{ title: "Orders", rows: [{ name: "East" }, { name: "West" }] }} />));
    const add = () => fireEvent.click(screen.getByRole("button", { name: "添加筛选" }));
    const value = () => screen.getByLabelText("值", { exact: true });
    add(); fireEvent.change(value(), { target: { value: "East" } });
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    add(); fireEvent.change(value(), { target: { value: "unfinished" } });
    for (const name of ["修改筛选：name 包含 East", "移除筛选：name 包含 East", "清除筛选"]) {
      const action = screen.getByRole("button", { name });
      expect(action).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(action);
      expect(value()).toHaveValue("unfinished");
      expect(screen.getByRole("status")).toHaveTextContent("1 / 2 行");
    }
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    const edit = screen.getByRole("button", { name: "修改筛选：name 包含 East" });
    expect(edit).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(edit);
    expect(value()).toHaveValue("East");
    fireEvent.change(value(), { target: { value: "West" } });
    // Re-selecting the same chip must not restore its old saved value either.
    fireEvent.click(edit); expect(value()).toHaveValue("West");
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    expect(screen.getByRole("cell", { name: "West" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "移除筛选：name 包含 West" }));
    expect(screen.getByRole("status")).toHaveTextContent("2 / 2 行");
    expect(screen.getByRole("button", { name: "添加筛选" })).toHaveFocus();
  });

  it("recovers empty filtered results without losing selected rows or sort order", () => {
    const download = vi.spyOn(csv, "downloadCsv").mockImplementation(() => {});
    const rows = [{ name: "West", amount: 3 }, { name: "East", amount: 1 }];
    render(intl(<Viewer snapshot={{ title: "Orders", rows }} />));
    fireEvent.click(screen.getByRole("button", { name: "amount" }));
    fireEvent.click(screen.getByRole("button", { name: "选择记录" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择第 2 条记录" }));
    fireEvent.click(screen.getByRole("button", { name: "只看已选" }));
    const search = screen.getByRole("searchbox", { name: "搜索表格" });
    fireEvent.change(search, { target: { value: "nowhere" } });
    expect(screen.queryByRole("navigation", { name: messages.dataView.pagination })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "恢复全部记录" }));
    expect(screen.getByRole("navigation", { name: messages.dataView.pagination })).toBeInTheDocument();
    expect(search).toHaveValue(""); expect(search).toHaveFocus();
    expect(screen.getByRole("button", { name: "只看已选" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("checkbox", { name: "选择第 2 条记录" })).toBeChecked();
    expect(screen.getByRole("columnheader", { name: "amount" })).toHaveAttribute("aria-sort", "ascending");
    expect(screen.queryByRole("button", { name: "恢复全部记录" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "导出当前结果 CSV" }));
    expect(download.mock.lastCall?.[0]).toEqual([rows[1], rows[0]]);
  });

  it("preserves an unfinished filter before allowing empty-result recovery", () => {
    render(intl(<Viewer snapshot={{ title: "Orders", rows: [{ name: "East" }] }} />));
    fireEvent.click(screen.getByRole("button", { name: "添加筛选" }));
    fireEvent.change(screen.getByLabelText("值", { exact: true }), { target: { value: "West" } });
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    expect(screen.getByText("没有匹配的记录")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "添加筛选" }));
    fireEvent.change(screen.getByLabelText("值", { exact: true }), { target: { value: "Draft" } });
    const restore = screen.getByRole("button", { name: "恢复全部记录" });
    expect(restore).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(restore);
    expect(screen.getByLabelText("值", { exact: true })).toHaveValue("Draft");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(restore);
    expect(screen.getByRole("cell", { name: "East" })).toBeInTheDocument();
    expect(screen.queryByText("没有匹配的记录")).not.toBeInTheDocument();
  });

  it("does not offer recovery when the source itself has no records", () => {
    render(intl(<Viewer snapshot={{ title: "Empty", rows: [] }} />));
    expect(screen.getByText("暂无数据")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "恢复全部记录" })).not.toBeInTheDocument();
  });

  it("keeps record and bulk copies mutually exclusive after details are reopened", async () => {
    let finish!: () => void;
    const writeText = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(intl(<Viewer snapshot={{ title: "Orders", rows: [{ name: "East" }, { name: "West" }] }} />));
    fireEvent.click(screen.getByRole("button", { name: "选择记录" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择第 2 条记录" }));
    fireEvent.click(screen.getByRole("button", { name: "查看第 1 条记录" }));
    fireEvent.click(screen.getByRole("button", { name: "复制name的值" }));
    fireEvent.click(screen.getByRole("button", { name: messages.dataView.backToTable }));
    fireEvent.click(screen.getByRole("button", { name: "查看第 2 条记录" }));
    expect(screen.getByRole("button", { name: "复制记录" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "复制所选 1 条" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "复制所选 1 条" }));
    expect(writeText).toHaveBeenCalledExactlyOnceWith("East");
    await act(async () => { finish(); });
    expect(screen.queryByText("已复制", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制记录" })).toBeEnabled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "复制所选 1 条" })); });
    expect(writeText).toHaveBeenLastCalledWith("name\r\nWest");
  });

  it("seeds exact record-value filters without applying or replacing drafts and restores safe focus", () => {
    const rows = [{ region: "East", amount: "9007199254740993.0123" }, { region: "East", amount: "9007199254740993.0124" },
      { region: "West", amount: "9007199254740993.0125" }];
    const before = structuredClone(rows);
    const download = vi.spyOn(csv, "downloadCsv").mockImplementation(() => {});
    render(intl(<Viewer snapshot={{ title: "Orders", rows }} />));
    fireEvent.click(screen.getByRole("button", { name: "查看第 1 条记录" }));
    const origin = screen.getByRole("button", { name: "用amount的值筛选" });
    fireEvent.click(origin);
    const editor = screen.getByRole("form", { name: "编辑筛选条件" });
    expect(within(editor).getByLabelText("字段")).toHaveValue("amount");
    expect(within(editor).getByLabelText("字段")).toHaveFocus();
    expect(within(editor).getByLabelText("条件", { exact: true })).toHaveValue("equals");
    expect(within(editor).getByLabelText("值", { exact: true })).toHaveValue(rows[0].amount);
    fireEvent.change(within(editor).getByLabelText("条件", { exact: true }), { target: { value: "gt" } });
    expect(screen.getByRole("button", { name: "用region的值筛选" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "用region的值筛选" }));
    expect(within(editor).getByLabelText("字段")).toHaveValue("amount");
    fireEvent.click(screen.getByRole("button", { name: "导出当前结果 CSV" }));
    expect(download.mock.lastCall?.[0]).toEqual(rows);
    fireEvent.keyDown(within(editor).getByRole("button", { name: "取消" }), { key: "Escape" });
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(origin).toHaveFocus();
    expect(origin).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(origin);
    fireEvent.change(screen.getByLabelText("条件", { exact: true }), { target: { value: "gt" } });
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加筛选" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("2 / 3 行");
    fireEvent.click(screen.getByRole("button", { name: "导出当前结果 CSV" }));
    expect(download.mock.lastCall?.[0]).toEqual(rows.slice(1));
    expect(rows).toEqual(before);
  });

  it("stages any/all together with record-value conditions and edits identical seeds without duplication", () => {
    const rows = [{ region: "East", amount: 1 }, { region: "East", amount: 2 }, { region: "West", amount: 2 }];
    const download = vi.spyOn(csv, "downloadCsv").mockImplementation(() => {});
    render(intl(<Viewer snapshot={{ title: "Orders", rows }} />));
    fireEvent.click(screen.getByRole("button", { name: "查看第 2 条记录" }));
    fireEvent.click(screen.getByRole("button", { name: "用region的值筛选" }));
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    fireEvent.click(screen.getByRole("button", { name: "用amount的值筛选" }));
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    fireEvent.change(screen.getByRole("combobox", { name: "条件组合" }), { target: { value: "any" } });
    expect(screen.getByRole("status")).toHaveTextContent("3 / 3 行");
    fireEvent.click(screen.getByRole("button", { name: "移除筛选：amount 等于 2" }));
    expect(screen.getByRole("status")).toHaveTextContent("2 / 3 行");
    fireEvent.click(screen.getByRole("button", { name: "用amount的值筛选" }));
    expect(screen.getByRole("combobox", { name: "条件组合" })).toHaveValue("any");
    fireEvent.change(screen.getByRole("combobox", { name: "条件组合" }), { target: { value: "all" } });
    fireEvent.click(screen.getByRole("button", { name: "导出当前结果 CSV" }));
    expect(download.mock.lastCall?.[0]).toEqual(rows.slice(0, 2));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "用amount的值筛选" }));
    expect(screen.getByRole("combobox", { name: "条件组合" })).toHaveValue("any");
    fireEvent.change(screen.getByRole("combobox", { name: "条件组合" }), { target: { value: "all" } });
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    expect(screen.getByRole("status")).toHaveTextContent("1 / 3 行");
    fireEvent.click(screen.getByRole("button", { name: "用amount的值筛选" }));
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    expect(screen.getAllByRole("button", { name: /^修改筛选/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "导出当前结果 CSV" }));
    expect(download.mock.lastCall?.[0]).toEqual([rows[1]]);
  });

  it("keeps multiline, false, missing and empty record-value conditions distinct and drops them on a new snapshot", () => {
    const rows: Record<string, unknown>[] = [{ note: "  First\r\nSecond \n", active: false, blank: "", toString: null, object: { text: "hidden" } },
      { note: "FirstSecond", active: true, blank: null, toString: "own", object: [] }, {}];
    const view = render(intl(<Viewer snapshot={{ title: "Review", rows }} />));
    fireEvent.click(screen.getByRole("button", { name: "查看第 1 条记录" }));
    expect(screen.queryByRole("button", { name: "用object的值筛选" })).not.toBeInTheDocument();
    for (const [field, operator, count] of [["note", "equals", 1], ["active", "equals", 1], ["blank", "is_empty_text", 1], ["toString", "is_missing", 2]] as const) {
      fireEvent.click(screen.getByRole("button", { name: `用${field}的值筛选` }));
      expect(screen.getByLabelText("条件", { exact: true })).toHaveValue(operator);
      if (field === "note") {
        expect(screen.getByLabelText("值", { exact: true }).tagName).toBe("TEXTAREA");
        expect(screen.getByLabelText("值", { exact: true })).toHaveValue("  First\nSecond \n");
      }
      if (field === "active") expect(screen.getByLabelText("值", { exact: true })).toHaveValue("false");
      fireEvent.click(screen.getByRole("button", { name: "应用" }));
      expect(screen.getByRole("status")).toHaveTextContent(`${count} / 3 行`);
      fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "下一条记录" }));
    fireEvent.click(screen.getByRole("button", { name: "下一条记录" }));
    const details = screen.getByRole("complementary");
    expect(within(details).getAllByRole("definition").every((cell) => cell.textContent === "无数据")).toBe(true);
    fireEvent.click(within(details).getByRole("button", { name: "用toString的值筛选" }));
    expect(screen.getByLabelText("条件", { exact: true })).toHaveValue("is_missing");
    view.rerender(intl(<Viewer snapshot={{ title: "New", rows: [{ name: "Next" }] }} />));
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看第 1 条记录" }));
    expect(screen.getByRole("button", { name: "用name的值筛选" })).toHaveAttribute("aria-disabled", "false");
  });

  it("keeps multi-column priority, hidden sorts and selected records aligned with the exported order", async () => {
    const rows = [{ group: "B", amount: "2" }, { group: "A", amount: "3" }, { group: "A", amount: "2" }];
    const download = vi.spyOn(csv, "downloadCsv").mockImplementation(() => {});
    render(intl(<Viewer snapshot={{ title: "Orders", rows }} />));
    fireEvent.click(screen.getByRole("button", { name: "查看第 1 条记录" }));
    fireEvent.click(screen.getByRole("button", { name: "group" }));
    fireEvent.click(screen.getByRole("button", { name: "amount" }), { shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "amount" }), { shiftKey: true });
    expect(screen.getByRole("columnheader", { name: "group" })).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByRole("columnheader", { name: "amount" })).not.toHaveAttribute("aria-sort");
    expect(within(screen.getByRole("complementary")).getByText("3 / 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "导出当前结果 CSV" }));
    expect(download.mock.lastCall?.[0]).toEqual([rows[1], rows[2], rows[0]]);
    const sorter = screen.getByText("排序", { exact: true }).closest("details")!;
    sorter.open = true;
    fireEvent.click(within(sorter).getByRole("button", { name: "优先按amount排序" }));
    expect(screen.getByRole("columnheader", { name: "amount" })).toHaveAttribute("aria-sort", "descending");
    fireEvent.change(within(sorter).getByRole("combobox", { name: "amount的排序方向" }), { target: { value: "asc" } });
    expect(within(screen.getByRole("complementary")).getByText("2 / 3")).toBeInTheDocument();
    const columns = screen.getByText("显示列 2/2").closest("details")!;
    fireEvent.click(columns.querySelector("summary")!);
    await waitFor(() => expect(sorter.open).toBe(false));
    fireEvent.click(within(columns).getByRole("checkbox", { name: "amount" }));
    fireEvent.click(within(columns).getByRole("button", { name: "完成" }));
    expect(screen.getByRole("columnheader", { name: "group" })).not.toHaveAttribute("aria-sort");
    fireEvent.click(screen.getByRole("button", { name: "导出当前结果 CSV" }));
    expect(download.mock.lastCall?.[0]).toEqual([rows[2], rows[0], rows[1]]);
    expect(download.mock.lastCall?.[2]).toEqual(["group"]);
    sorter.open = true;
    fireEvent.click(within(sorter).getByRole("button", { name: "清除排序" }));
    expect(within(screen.getByRole("complementary")).getByText("1 / 3")).toBeInTheDocument();
    expect(sorter.querySelector("summary")).toHaveFocus();
    fireEvent.change(within(sorter).getByRole("combobox", { name: "添加排序字段" }), { target: { value: "amount" } });
    expect(within(sorter).getByRole("combobox", { name: "amount的排序方向" })).toHaveValue("asc");
    fireEvent.keyDown(within(sorter).getByRole("button", { name: "完成" }), { key: "Escape" });
    expect(sorter.open).toBe(false);
    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });

  it("reorders columns consistently in the table, record details, copy and export while retaining arrow focus", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const download = vi.spyOn(csv, "downloadCsv").mockImplementation(() => {});
    const row = { name: "East", amount: "9007199254740993.0123", note: "=1+2" };
    render(intl(<Viewer snapshot={{ title: "Order", rows: [row] }} />));
    const chooser = screen.getByText("显示列 3/3").closest("details")!;
    chooser.open = true;
    const earlier = within(chooser).getByRole("button", { name: "将note列前移" });
    earlier.focus();
    fireEvent.click(earlier); fireEvent.click(earlier);
    expect(earlier).toHaveFocus();
    expect(earlier).toHaveAttribute("aria-disabled", "true");
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["行", "note", "name", "amount"]);
    fireEvent.change(within(chooser).getByRole("searchbox", { name: "查找列" }), { target: { value: "note" } });
    expect(within(chooser).queryByRole("button", { name: "将note列前移" })).not.toBeInTheDocument();
    fireEvent.click(within(chooser).getByRole("button", { name: "完成" }));
    fireEvent.click(screen.getByRole("button", { name: "查看第 1 条记录" }));
    const details = screen.getByRole("complementary");
    expect(within(details).getAllByRole("term").map((field) => field.textContent)).toEqual(["note", "name", "amount"]);
    await act(async () => { fireEvent.click(within(details).getByRole("button", { name: "复制记录" })); });
    const copied = Papa.parse(writeText.mock.calls[0][0], { delimiter: "\t", header: true });
    expect(copied.meta.fields).toEqual(["note", "name", "amount"]);
    fireEvent.click(screen.getByRole("button", { name: "导出当前结果 CSV" }));
    expect(download.mock.lastCall?.[2]).toEqual(["note", "name", "amount"]);
    chooser.open = true;
    fireEvent.click(within(chooser).getByRole("button", { name: "恢复列顺序" }));
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["行", "name", "amount", "note"]);
    expect(row).toEqual({ name: "East", amount: "9007199254740993.0123", note: "=1+2" });
  });

  it("starts a clean view on snapshot replacement without a stale close event dismissing the new dialog", async () => {
    const rows = Array.from({ length: 60 }, (_, index) => ({ name: `old-${index}`, amount: index }));
    const view = render(intl(<StrictMode><Viewer snapshot={{ title: "Old", rows }} /></StrictMode>));
    fireEvent.click(screen.getByRole("button", { name: "amount" }));
    fireEvent.change(screen.getByRole("combobox", { name: "每页行数" }), { target: { value: "25" } });
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索表格" }), { target: { value: "old" } });
    const chooser = screen.getByText("显示列 2/2").closest("details")!;
    chooser.open = true;
    fireEvent.click(within(chooser).getByRole("button", { name: "将amount列前移" }));
    fireEvent.click(within(chooser).getByRole("checkbox", { name: "name" }));
    fireEvent.click(within(chooser).getByRole("button", { name: "完成" }));
    fireEvent.click(screen.getByRole("button", { name: "添加筛选" }));
    view.rerender(intl(<StrictMode><Viewer snapshot={{ title: "New", rows: [{ name: "A", amount: 2 }, { name: "B", amount: 1 }], sort: { column: "name", direction: "desc" } }} /></StrictMode>));
    await act(async () => {});
    expect(screen.getByRole("dialog", { name: "New · 数据" })).toHaveAttribute("open");
    expect(screen.getByRole("searchbox", { name: "搜索表格" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "每页行数" })).toHaveValue("50");
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["行", "name", "amount"]);
    expect(screen.getByRole("columnheader", { name: "name" })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getAllByRole("cell")[0]).toHaveTextContent("B");
  });

  it("applies and edits field filters explicitly, retains hidden-field conditions and exports the same full matches", () => {
    const rows = Array.from({ length: 110 }, (_, index) => ({ region: index % 2 ? "West" : "East", amount: String(9007199254740993n + BigInt(index)) }));
    const download = vi.spyOn(csv, "downloadCsv").mockImplementation(() => {});
    const view = render(intl(<Viewer snapshot={{ title: "Orders", rows }} />));
    fireEvent.click(screen.getByRole("button", { name: "查看第 1 条记录" }));
    fireEvent.click(screen.getByRole("button", { name: "添加筛选" }));
    let editor = screen.getByRole("form", { name: "编辑筛选条件" });
    fireEvent.change(within(editor).getByLabelText("字段"), { target: { value: "amount" } });
    fireEvent.change(within(editor).getByLabelText("条件", { exact: true }), { target: { value: "gte" } });
    fireEvent.change(within(editor).getByLabelText("值", { exact: true }), { target: { value: "9007199254740994" } });
    // Drafts cannot change the table, details or export yet.
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "导出当前结果 CSV" }));
    expect(download.mock.calls[0][0]).toHaveLength(110);
    fireEvent.click(within(editor).getByRole("button", { name: "应用" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("109 / 110 行");
    fireEvent.click(screen.getByRole("button", { name: "添加筛选" }));
    editor = screen.getByRole("form");
    fireEvent.change(within(editor).getByLabelText("值", { exact: true }), { target: { value: "West" } });
    fireEvent.click(within(editor).getByRole("button", { name: "应用" }));
    expect(screen.getByRole("status")).toHaveTextContent("55 / 110 行");
    const chooser = screen.getByText("显示列 2/2").closest("details")!;
    chooser.open = true;
    fireEvent.click(within(chooser).getByRole("checkbox", { name: "region" }));
    fireEvent.click(within(chooser).getByRole("button", { name: "完成" }));
    fireEvent.click(screen.getByRole("button", { name: "导出当前结果 CSV" }));
    expect(download.mock.lastCall?.[0]).toEqual(rows.filter((row) => row.region === "West"));
    expect(download.mock.lastCall?.[2]).toEqual(["amount"]);
    fireEvent.click(screen.getByRole("button", { name: "修改筛选：region 包含 West" }));
    editor = screen.getByRole("form");
    fireEvent.change(within(editor).getByLabelText("值", { exact: true }), { target: { value: "East" } });
    fireEvent.click(within(editor).getByRole("button", { name: "应用" }));
    expect(screen.getByRole("status")).toHaveTextContent("54 / 110 行");
    fireEvent.change(screen.getByRole("combobox", { name: "条件组合" }), { target: { value: "any" } });
    expect(screen.getByRole("status")).toHaveTextContent("110 / 110 行");
    fireEvent.click(screen.getByRole("button", { name: "移除筛选：region 包含 East" }));
    expect(screen.getByRole("status")).toHaveTextContent("109 / 110 行");
    // A different source cannot inherit filters or an unfinished editor.
    fireEvent.click(screen.getByRole("button", { name: "添加筛选" }));
    view.rerender(intl(<Viewer snapshot={{ title: "Replacement", rows: [{ name: "New" }] }} />));
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /修改筛选/ })).not.toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "New" })).toBeInTheDocument();
  });

  it("rejects invalid ranges and lets Escape/IME cancel only the unfinished filter before record details", () => {
    render(intl(<StrictMode><Viewer snapshot={{ title: "Review", rows: [{ amount: "2" }, { amount: "10" }] }} /></StrictMode>));
    fireEvent.click(screen.getByRole("button", { name: "查看第 1 条记录" }));
    fireEvent.click(screen.getByRole("button", { name: "添加筛选" }));
    const editor = screen.getByRole("form");
    fireEvent.change(within(editor).getByLabelText("条件", { exact: true }), { target: { value: "between" } });
    const lower = within(editor).getByLabelText("最小值（含）");
    const upper = within(editor).getByLabelText("最大值（含）");
    fireEvent.change(lower, { target: { value: "10" } });
    fireEvent.change(upper, { target: { value: "2" } });
    fireEvent.click(within(editor).getByRole("button", { name: "应用" }));
    expect(screen.getByRole("alert")).toHaveTextContent("最大值不能小于最小值");
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    fireEvent.change(lower, { target: { value: "2" } });
    fireEvent.change(upper, { target: { value: "10" } });
    fireEvent.compositionStart(upper);
    fireEvent.keyDown(upper, { key: "Enter", isComposing: true });
    fireEvent.submit(editor);
    fireEvent.keyDown(upper, { key: "Escape", isComposing: true });
    expect(screen.getByRole("form")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /修改筛选/ })).not.toBeInTheDocument();
    fireEvent.compositionEnd(upper);
    fireEvent.keyDown(upper, { key: "Escape" });
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加筛选" })).toHaveFocus();
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button", { name: "添加筛选" }), { key: "Escape" });
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
  });

  it("cancels edits without changing applied filters and keeps missing values distinct from empty text", () => {
    render(intl(<Viewer snapshot={{ title: "Review", rows: [{ note: null }, {}, { note: "" }, { note: false }, { note: "text" }] }} />));
    fireEvent.click(screen.getByRole("button", { name: "添加筛选" }));
    fireEvent.change(screen.getByLabelText("条件", { exact: true }), { target: { value: "is_missing" } });
    expect(within(screen.getByRole("form")).queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    expect(screen.getByRole("status")).toHaveTextContent("2 / 5 行");
    fireEvent.click(screen.getByRole("button", { name: "修改筛选：note 无数据" }));
    fireEvent.change(screen.getByLabelText("条件", { exact: true }), { target: { value: "is_empty_text" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("status")).toHaveTextContent("2 / 5 行");
    fireEvent.click(screen.getByRole("button", { name: "修改筛选：note 无数据" }));
    fireEvent.change(screen.getByLabelText("条件", { exact: true }), { target: { value: "is_empty_text" } });
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    expect(screen.getByRole("status")).toHaveTextContent("1 / 5 行");
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索表格" }), { target: { value: "text" } });
    expect(screen.getByText("没有匹配的记录")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出当前结果 CSV" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByRole("cell", { name: "text" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "搜索表格" })).toHaveValue("text");
  });

  it("keeps snapshot record identity through sorting, including repeated object references", () => {
    const repeated = { amount: "9007199254740993", name: "match" };
    const rows = [repeated, { amount: "2", name: "match" }, repeated, { amount: null, name: "empty" }];
    const result = tableViewRecords(rows, { column: "amount", direction: "desc" }, ["name"], "match", "zh");
    expect(result.map(({ index }) => index)).toEqual([0, 2, 1]);
    expect(result[0].row).toBe(repeated);
    expect(result[1].row).toBe(repeated);
    expect(rows[1].amount).toBe("2");
    expect(Object.keys(repeated)).toEqual(["amount", "name"]);
    // Filtering must not turn the remaining cells of a mixed column numeric.
    const mixed = [{ amount: "2", name: "match" }, { amount: "10", name: "match" }, { amount: "text", name: "other" }];
    expect(tableViewRecords(mixed, { column: "amount", direction: "asc" }, ["name"], "match", "en").map(({ index }) => index)).toEqual([1, 0]);
  });

  it("browses records across page boundaries and follows the selected record when sorting or resizing pages", () => {
    const rows = Array.from({ length: 52 }, (_, index) => ({ name: `order-${index + 1}`, amount: String(52 - index) }));
    render(intl(<Viewer snapshot={{ title: "Orders", rows }} />));
    fireEvent.click(screen.getByRole("button", { name: "查看第 50 条记录" }));
    const details = screen.getByRole("complementary", { name: "记录详情" });
    expect(within(details).getByText("order-50")).toBeInTheDocument();
    fireEvent.click(within(details).getByRole("button", { name: "下一条记录" }));
    expect(within(details).getByText("order-51")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "数据分页" })).toHaveTextContent("2 / 2");
    fireEvent.click(screen.getByRole("button", { name: "amount" }));
    expect(within(details).getByText("order-51")).toBeInTheDocument();
    expect(within(details).getByText("2 / 52")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看第 2 条记录" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByRole("combobox", { name: "每页行数" }), { target: { value: "25" } });
    expect(within(details).getByText("order-51")).toBeInTheDocument();
    fireEvent.click(within(details).getByRole("button", { name: "上一条记录" }));
    expect(within(details).getByRole("button", { name: "上一条记录" })).toHaveAttribute("aria-disabled", "true");
    expect(within(details).getByText("order-52")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看第 26 条记录" })).toBeInTheDocument();
    expect(rows[0]).toEqual({ name: "order-1", amount: "52" });
  });

  it("drops unavailable selections without reopening them after clearing a filter or replacing a snapshot", () => {
    const snapshot = { title: "Orders", rows: [{ name: "East", secret: "needle" }, { name: "West", secret: "" }] };
    const view = render(intl(<Viewer snapshot={snapshot} />));
    fireEvent.click(screen.getByRole("button", { name: "查看第 1 条记录" }));
    const search = screen.getByRole("searchbox", { name: "搜索表格" });
    fireEvent.change(search, { target: { value: "West" } });
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "" } });
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看第 1 条记录" }));
    fireEvent.change(search, { target: { value: "needle" } });
    const chooser = screen.getByText("显示列 2/2").closest("details")!;
    chooser.open = true;
    fireEvent.click(within(chooser).getByRole("checkbox", { name: "secret" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "" } });
    fireEvent.click(within(chooser).getByRole("button", { name: "完成" }));
    fireEvent.click(screen.getByRole("button", { name: "查看第 1 条记录" }));
    view.rerender(intl(<Viewer snapshot={{ title: "Replacement", rows: [{ name: "New" }] }} />));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "New" })).toBeInTheDocument();
  });

  it("gives Escape to IME, column picker and record details in that order and returns focus to the row", async () => {
    render(intl(<StrictMode><Viewer snapshot={{ title: "Orders", rows: [{ name: "East" }, { name: "West" }] }} /></StrictMode>));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "查看第 1 条记录" }));
    expect(screen.getByRole("button", { name: "返回表格" })).toHaveFocus();
    const chooser = screen.getByText("显示列 1/1").closest("details")!;
    chooser.open = true;
    const search = screen.getByRole("searchbox", { name: "查找列" });
    fireEvent.keyDown(search, { key: "Escape", isComposing: true });
    expect(chooser.open).toBe(true);
    fireEvent.keyDown(search, { key: "Escape" });
    expect(chooser.open).toBe(false);
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button", { name: "返回表格" }), { key: "Escape" });
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    await waitFor(() => expect(screen.getByRole("button", { name: "查看第 1 条记录" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "查看第 1 条记录" }));
    fireEvent.click(screen.getByRole("button", { name: "返回表格" }));
    fireEvent.click(screen.getByRole("button", { name: "查看第 2 条记录" }));
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
    expect(screen.getByRole("button", { name: "返回表格" })).toHaveFocus();
    expect(within(screen.getByRole("complementary")).getByRole("button", { name: "下一条记录" })).toHaveAttribute("aria-disabled", "true");
  });

  it("shows exact values, searches fields and copies only visible fields with a separate literal-value action", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const row = { name: '西湖\t"门店"\n一层', refund: "-9007199254740993.0123", note: "=1+2", zero: 0, active: false,
      blank: "", missing: null, object: { count: 1 }, hidden: "not copied" };
    render(intl(<Viewer snapshot={{ title: "Orders", rows: [row] }} />));
    const chooser = screen.getByText("显示列 9/9").closest("details")!;
    chooser.open = true;
    fireEvent.click(within(chooser).getByRole("checkbox", { name: "hidden" }));
    fireEvent.click(within(chooser).getByRole("button", { name: "完成" }));
    fireEvent.click(screen.getByRole("button", { name: "查看第 1 条记录" }));
    const details = screen.getByRole("complementary");
    for (const text of ["-9007199254740993.0123", "0", "false", "空文本", "无数据", '{"count":1}']) {
      expect(within(details).getByText(text, { exact: true })).toBeInTheDocument();
    }
    expect(within(details).queryByText("not copied")).not.toBeInTheDocument();
    const search = within(details).getByRole("searchbox", { name: "查找字段…" });
    fireEvent.change(search, { target: { value: "refund" } });
    expect(within(details).queryByText("=1+2")).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(within(details).getByRole("button", { name: "复制记录" })); });
    const parsed = Papa.parse<Record<string, string>>(writeText.mock.calls[0][0], { delimiter: "\t", header: true });
    expect(parsed.errors).toEqual([]);
    expect(parsed.data).toEqual([{ name: row.name, refund: row.refund, note: "'=1+2", zero: "0", active: "false", blank: "", missing: "", object: '{"count":1}' }]);
    expect(writeText.mock.calls[0][0].startsWith("\uFEFF")).toBe(false);
    fireEvent.change(search, { target: { value: "" } });
    await act(async () => { fireEvent.click(within(details).getByRole("button", { name: "复制note的值" })); });
    expect(writeText).toHaveBeenLastCalledWith("=1+2");
    writeText.mockRejectedValueOnce(new Error("Clipboard unavailable"));
    await act(async () => { fireEvent.click(within(details).getByRole("button", { name: "复制记录" })); });
    expect(within(details).getByRole("alert")).toHaveTextContent("未能复制");
    expect(within(details).queryByText("已复制")).not.toBeInTheDocument();
    expect(row.note).toBe("=1+2");
  });

  it("serializes pending copies and does not show a late success on the next record", async () => {
    let resolveCopy!: () => void;
    const writeText = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { resolveCopy = resolve; })).mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(intl(<Viewer snapshot={{ title: "Orders", rows: [{ name: "East" }, { name: "West" }] }} />));
    fireEvent.click(screen.getByRole("button", { name: "查看第 1 条记录" }));
    fireEvent.click(screen.getByRole("button", { name: "复制name的值" }));
    fireEvent.click(screen.getByRole("button", { name: "下一条记录" }));
    expect(screen.getByRole("button", { name: "复制记录" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "复制name的值" }));
    expect(writeText).toHaveBeenCalledExactlyOnceWith("East");
    await act(async () => { resolveCopy(); });
    expect(within(screen.getByRole("complementary")).queryByText(messages.dataView.copied)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制记录" })).toBeEnabled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "复制name的值" })); });
    expect(writeText).toHaveBeenLastCalledWith("West");
    expect(within(screen.getByRole("complementary")).getByText(messages.dataView.copied)).toHaveAttribute("role", "status");
  });

  it("searches and sorts all retained rows, then exports every match with only visible columns", () => {
    const rows = Array.from({ length: 120 }, (_, index) => ({
      region: index % 2 ? "West" : "East", amount: String(9007199254740993n + BigInt(index)),
      note: "=1+2", refund: "-9007199254740993.0123", hidden: `private-${index}`,
    }));
    const before = structuredClone(rows);
    const download = vi.spyOn(csv, "downloadCsv").mockImplementation(() => {});
    render(intl(<Viewer snapshot={{ title: "Orders/September", rows }} />));
    fireEvent.click(screen.getByRole("button", { name: "amount" }));
    fireEvent.click(screen.getByRole("button", { name: "amount" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索表格" }), { target: { value: "West" } });
    expect(screen.getByRole("status")).toHaveTextContent("60 / 120 行");
    expect(screen.getAllByRole("row")).toHaveLength(51);
    expect(within(screen.getAllByRole("row")[1]).getByRole("cell", { name: "9007199254741112" })).toBeInTheDocument();
    const chooser = screen.getByText("显示列 5/5").closest("details")!;
    chooser.open = true;
    fireEvent.click(within(chooser).getByRole("checkbox", { name: "hidden" }));
    fireEvent.click(screen.getByRole("button", { name: "导出当前结果 CSV" }));
    expect(download).toHaveBeenCalledOnce();
    const [exportedRows, filename, columns] = download.mock.calls[0];
    expect(exportedRows).toHaveLength(60);
    expect(filename).toBe("Orders-September.csv");
    expect(columns).toEqual(["region", "amount", "note", "refund"]);
    const parsed = Papa.parse<Record<string, string>>(csv.createCsv(exportedRows, columns), { header: true });
    expect(parsed.errors).toEqual([]);
    expect(parsed.data[0]).toEqual({ region: "West", amount: "9007199254741112", note: "'=1+2", refund: "-9007199254740993.0123" });
    expect(rows).toEqual(before);
  });

  it("keeps a visible field, searches visible cells only, and isolates dialog shortcuts in Strict Mode", async () => {
    const keydown = vi.fn();
    window.addEventListener("keydown", keydown);
    try {
      render(intl(<StrictMode><Viewer snapshot={{ title: "Review", rows: [{ status: false, note: "secret" }, { status: null, note: "" }] }} /></StrictMode>));
      await act(async () => {});
      const dialog = screen.getByRole("dialog", { name: "Review · 数据" });
      const chooser = within(dialog).getByText("显示列 2/2").closest("details")!;
      chooser.open = true;
      fireEvent.click(within(chooser).getByRole("checkbox", { name: "note" }));
      expect(within(chooser).getByRole("checkbox", { name: "status" })).toBeDisabled();
      const search = within(dialog).getByRole("searchbox", { name: "搜索表格" });
      fireEvent.change(search, { target: { value: "secret" } });
      expect(screen.getByText("没有匹配的记录")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "导出当前结果 CSV" })).toBeDisabled();
      fireEvent.change(search, { target: { value: "false" } });
      expect(screen.getByRole("cell", { name: "false" })).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("1 / 2 行");
      fireEvent.keyDown(search, { key: "s", ctrlKey: true });
      fireEvent.keyDown(search, { key: "z", metaKey: true });
      expect(keydown).not.toHaveBeenCalled();
      fireEvent.keyDown(search, { key: "Escape" });
      expect(chooser.open).toBe(false);
      expect(dialog).toHaveAttribute("open");
      fireEvent.click(screen.getByRole("button", { name: "关闭数据窗口" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    } finally { window.removeEventListener("keydown", keydown); }
  });

});
