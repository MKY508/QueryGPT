import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { StrictMode, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataViewDialog, type DataViewSnapshot } from "@/components/data/DataViewDialog";
import { tableSelectionRange, updateTableSelection } from "@/lib/tabular-selection";
import * as csv from "@/lib/csv";
import messages from "@/messages/zh.json";
import english from "@/messages/en.json";
import Papa from "papaparse";

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
  cleanup(); vi.restoreAllMocks();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard); else Reflect.deleteProperty(navigator, "clipboard");
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});
function Viewer({ snapshot }: { snapshot: DataViewSnapshot }) {
  const [open, setOpen] = useState(true);
  return open ? <DataViewDialog snapshot={snapshot} onClose={() => setOpen(false)} /> : null;
}
const button = (name: string) => screen.getByRole("button", { name });
const checkbox = (number: number) => screen.getByRole("checkbox", { name: `选择第 ${number} 条记录` });
const search = (value: string) => fireEvent.change(screen.getByRole("searchbox", { name: "搜索表格" }), { target: { value } });
const count = (value: number) => expect(screen.getByText(`已选 ${value} 条`, { exact: true })).toBeInTheDocument();
const frame = () => act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });

describe("data record selection", () => {
  it("copies the complete sorted selection with headers, including filtered-out duplicates", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const shared = { name: "West", amount: "-12.40", note: "＝1+2" };
    render(intl(<Viewer snapshot={{ title: "Orders", rows: [shared, { name: "East", amount: "2", note: "ok" }, shared] }} />));
    fireEvent.click(button("选择记录"));
    expect(button("复制所选 0 条")).toBeDisabled();
    fireEvent.click(button("选择全部 3 条结果"));
    fireEvent.click(button("amount"));
    search("East");
    await act(async () => { fireEvent.click(button("复制所选 3 条")); });
    expect(Papa.parse(writeText.mock.calls[0][0], { delimiter: "\t" }).data).toEqual([
      ["name", "amount", "note"], ["West", "-12.40", "'＝1+2"], ["West", "-12.40", "'＝1+2"], ["East", "2", "ok"],
    ]);
    expect(screen.getByText("已复制", { exact: true })).toBeInTheDocument();
    fireEvent.click(button("清空选择"));
    expect(screen.queryByText("已复制", { exact: true })).not.toBeInTheDocument();
    expect(button("复制所选 0 条")).toBeDisabled();
  });

  it("guards duplicate bulk copies, suppresses stale feedback, and allows retry after rejection", async () => {
    let finish!: () => void;
    const writeText = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }))
      .mockRejectedValueOnce(new Error("denied")).mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(intl(<Viewer snapshot={{ title: "Orders", rows: [{ name: "East" }, { name: "West" }] }} />));
    fireEvent.click(button("选择记录"));
    fireEvent.click(checkbox(1));
    fireEvent.click(button("复制所选 1 条"));
    fireEvent.click(button("复制所选 1 条"));
    expect(writeText).toHaveBeenCalledTimes(1);
    fireEvent.click(checkbox(2));
    expect(button("复制所选 2 条")).toBeDisabled();
    await act(async () => { finish(); });
    expect(screen.queryByText("已复制", { exact: true })).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(button("复制所选 2 条")); });
    expect(screen.getByRole("alert")).toHaveTextContent(messages.dataView.copyError);
    expect(button("复制所选 2 条")).toBeEnabled();
    await act(async () => { fireEvent.click(button("复制所选 2 条")); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("已复制", { exact: true })).toBeInTheDocument();
  });

  it("builds ranges from current record identity and preserves selections outside the changed scope", () => {
    const shared = { name: "same" };
    const records = [8, 1, 6, 3].map((index) => ({ index, row: shared }));
    expect(tableSelectionRange(records, 3, 1)).toEqual([1, 6, 3]);
    expect(tableSelectionRange(records, 99, 6)).toEqual([6]);
    expect(tableSelectionRange(records, null, 6)).toEqual([6]);
    expect(tableSelectionRange(records, 8, 99)).toEqual([]);
    const previous = new Set([8, 99]);
    const added = updateTableSelection(previous, tableSelectionRange(records, 1, 3), true);
    expect([...added]).toEqual([8, 99, 1, 6, 3]);
    expect([...updateTableSelection(added, [8, 6], false)]).toEqual([99, 1, 3]);
    expect([...previous]).toEqual([8, 99]);
    expect([...added]).toEqual([8, 99, 1, 6, 3]);
  });

  it("selects across pages and Shift ranges without conflating duplicate rows or opening their details", () => {
    const shared = { name: "Repeated" };
    const rows = Array.from({ length: 60 }, (_, index) => index === 0 || index === 50 ? shared : { name: `Row ${index}` });
    const download = vi.spyOn(csv, "downloadCsv").mockImplementation(() => {});
    render(intl(<Viewer snapshot={{ title: "Orders", rows }} />));
    expect(screen.queryByRole("checkbox", { name: "选择本页记录" })).not.toBeInTheDocument();
    fireEvent.click(button("选择记录"));
    expect(button("导出所选 0 条 CSV")).toBeDisabled();
    fireEvent.click(checkbox(1));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "选择本页记录" })).toBePartiallyChecked();
    fireEvent.click(button("下一页"));
    expect(checkbox(51)).not.toBeChecked();
    fireEvent.click(checkbox(51)); count(2);
    fireEvent.click(button("导出所选 2 条 CSV"));
    expect(download.mock.lastCall?.[0]).toEqual([shared, shared]);
    fireEvent.click(screen.getByRole("checkbox", { name: "选择本页记录" })); count(11);
    fireEvent.click(screen.getByRole("checkbox", { name: "选择本页记录" })); count(1);
    fireEvent.click(button("上一页"));
    fireEvent.click(checkbox(49)); count(2);
    fireEvent.click(button("下一页"));
    fireEvent.click(checkbox(55), { shiftKey: true }); count(8);
    fireEvent.click(button("导出所选 8 条 CSV"));
    expect(download.mock.lastCall?.[0]).toEqual([rows[0], ...rows.slice(48, 55)]);
    fireEvent.click(button("选择全部 60 条结果")); count(60);
    expect(button("选择全部 60 条结果")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "选择本页记录" })).toBeChecked();
    fireEvent.click(button("清空选择")); count(0);
  }, 15000);

  it("retains hidden selections and exports their full sorted scope while current-result export remains filtered", () => {
    const rows = [{ name: "West", amount: "9007199254740993.0123", note: "=1+2" },
      { name: "East", amount: "9007199254740993.0124", note: "literal" },
      { name: "East", amount: "9007199254740993.0122", note: "first" }];
    const before = structuredClone(rows);
    const download = vi.spyOn(csv, "downloadCsv").mockImplementation(() => {});
    render(intl(<Viewer snapshot={{ title: "A/B", rows }} />));
    fireEvent.click(button("选择记录"));
    fireEvent.click(checkbox(1));
    search("East");
    expect(screen.getByText("其中 1 条不在当前筛选结果中")).toBeInTheDocument();
    fireEvent.click(button("选择全部 2 条结果")); count(3);
    fireEvent.click(button("amount"));
    const chooser = screen.getByText("显示列 3/3").closest("details")!;
    chooser.open = true;
    fireEvent.click(within(chooser).getByRole("button", { name: "将amount列前移" }));
    fireEvent.click(within(chooser).getByRole("checkbox", { name: "note" }));
    fireEvent.click(within(chooser).getByRole("button", { name: "完成" }));
    fireEvent.click(button("导出所选 3 条 CSV"));
    expect(download.mock.lastCall).toEqual([[rows[2], rows[0], rows[1]], "A-B-所选记录.csv", ["amount", "name"]]);
    fireEvent.click(button("导出当前结果 CSV"));
    expect(download.mock.lastCall?.[0]).toEqual([rows[2], rows[1]]);
    search("absent"); count(3);
    expect(screen.getByText("其中 3 条不在当前筛选结果中")).toBeInTheDocument();
    expect(button("导出当前结果 CSV")).toBeDisabled();
    fireEvent.click(button("导出所选 3 条 CSV"));
    expect(download.mock.lastCall?.[0]).toEqual([rows[2], rows[0], rows[1]]);
    expect(rows).toEqual(before);
  });

  it("reviews selected records within applied filters without replacing an unfinished filter or selecting an invisible range", async () => {
    const rows = [{ name: "East", amount: 1 }, { name: "East", amount: 2 }, { name: "West", amount: 3 }];
    const download = vi.spyOn(csv, "downloadCsv").mockImplementation(() => {});
    render(intl(<Viewer snapshot={{ title: "Orders", rows }} />));
    fireEvent.click(button("选择记录"));
    fireEvent.click(checkbox(3));
    fireEvent.click(button("查看第 1 条记录"));
    fireEvent.click(button("用name的值筛选"));
    // Selection does not apply or discard a staged field condition.
    fireEvent.click(button("只看已选"));
    expect(screen.getByRole("form", { name: "编辑筛选条件" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 / 3 行");
    fireEvent.click(button("只看已选"));
    fireEvent.click(button("应用"));
    expect(screen.getByRole("status")).toHaveTextContent("2 / 3 行");
    expect(screen.getByText("其中 1 条不在当前筛选结果中")).toBeInTheDocument();
    fireEvent.click(checkbox(2), { shiftKey: true }); count(2);
    expect(checkbox(1)).not.toBeChecked();
    fireEvent.click(button("只看已选"));
    expect(screen.getByRole("status")).toHaveTextContent("1 / 3 行");
    fireEvent.click(button("导出当前结果 CSV"));
    expect(download.mock.lastCall?.[0]).toEqual([rows[1]]);
    checkbox(1).focus(); fireEvent.click(checkbox(1)); count(1);
    expect(screen.getByText("当前结果中没有已选记录")).toBeInTheDocument();
    await frame();
    expect(button("选择记录")).toHaveFocus();
    fireEvent.click(button("清除筛选"));
    expect(screen.getByRole("status")).toHaveTextContent("1 / 3 行");
    fireEvent.click(button("查看第 1 条记录"));
    expect(within(screen.getByRole("complementary")).getByText("West")).toBeInTheDocument();
    fireEvent.click(button("取消选择记录"));
    expect(button("选择记录")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("3 / 3 行");
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    fireEvent.click(button("选择记录")); count(0);
    fireEvent.click(button("选择全部 3 条结果"));
    fireEvent.click(button("返回表格"));
    fireEvent.click(button("只看已选"));
    checkbox(2).focus(); fireEvent.click(checkbox(2));
    await frame();
    expect(checkbox(2)).toHaveFocus();
    expect(checkbox(2).closest("tr")).toHaveTextContent("West");
  });

  it("keeps selection after export failure, uses full-column sort inference, and resets only for new snapshots", async () => {
    const rows = [{ name: "keep", amount: "2" }, { name: "keep", amount: "10" }, { name: "omit", amount: "text" }];
    const download = vi.spyOn(csv, "downloadCsv").mockImplementationOnce(() => { throw new Error("blocked"); }).mockImplementation(() => {});
    const view = render(intl(<StrictMode><Viewer snapshot={{ title: "Old", rows }} /></StrictMode>));
    fireEvent.click(button("选择记录"));
    search("keep");
    fireEvent.click(button("选择全部 2 条结果"));
    fireEvent.click(button("amount"));
    fireEvent.click(button("导出所选 2 条 CSV"));
    expect(screen.getByRole("alert")).toHaveTextContent("未能导出"); count(2);
    fireEvent.click(button("导出所选 2 条 CSV"));
    expect(download.mock.lastCall?.[0]).toEqual([rows[1], rows[0]]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    view.rerender(intl(<StrictMode><Viewer snapshot={{ title: "Renamed", rows }} /></StrictMode>)); count(2);
    fireEvent.click(button("只看已选"));
    await act(async () => {
      view.rerender(intl(<StrictMode><Viewer snapshot={{ title: "Next", rows: [{ name: "new" }] }} /></StrictMode>));
    });
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    expect(button("选择记录")).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "只看已选" })).not.toBeInTheDocument();
    fireEvent.click(button("选择记录")); count(0);
    expect(checkbox(1)).not.toBeChecked();
  });

  it("provides English selection labels and keeps modal shortcuts isolated from the editor", () => {
    const outer = vi.fn();
    render(<NextIntlClientProvider locale="en" messages={english}><div onKeyDown={outer}>
      <Viewer snapshot={{ title: "Orders", rows: [{ amount: 1 }] }} />
    </div></NextIntlClientProvider>);
    fireEvent.click(button("Select records"));
    const check = screen.getByRole("checkbox", { name: "Select record 1" });
    check.focus(); fireEvent.click(check);
    expect(button("Export 1 selected as CSV")).toBeEnabled();
    const save = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "s", ctrlKey: true });
    fireEvent(check, save); expect(save.defaultPrevented).toBe(true);
    fireEvent.keyDown(check, { key: "Escape", isComposing: true, keyCode: 229 });
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    expect(outer).not.toHaveBeenCalled();
    fireEvent.click(button("Cancel record selection"));
    expect(button("Select records")).toHaveFocus();
    expect(button("Select records")).toHaveAttribute("aria-pressed", "false");
  });
});
