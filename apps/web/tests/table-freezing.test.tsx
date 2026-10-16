import { StrictMode, useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataViewDialog, type DataViewSnapshot } from "@/components/data/DataViewDialog";
import { tableFrozenOffsets } from "@/lib/table-freezing";
import * as csv from "@/lib/csv";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

const observers: { notify: () => void; disconnect: ReturnType<typeof vi.fn<() => void>> }[] = [];
const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } },
  });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); observers.length = 0;
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});
const rows = [{ store: "East", amount: "9007199254740993.0123", note: "=1+2", channel: "online" },
  { store: "West", amount: "9007199254740993.0124", note: "keep", channel: "direct" }];
function Viewer({ snapshot = { title: "Stores", rows } }: { snapshot?: DataViewSnapshot }) {
  const [open, setOpen] = useState(true);
  return open ? <DataViewDialog snapshot={snapshot} onClose={() => setOpen(false)} /> : null;
}
const intl = (content: ReactNode, english = false) => <NextIntlClientProvider locale={english ? "en" : "zh"} messages={english ? en : zh}>{content}</NextIntlClientProvider>;
const menu = () => screen.getByText(/^显示列 /).closest("details")!;
const freeze = (count: number) => { menu().open = true; screen.getByText("阅读设置").closest("details")!.open = true; fireEvent.change(screen.getByRole("combobox", { name: "冻结列" }), { target: { value: String(count) } }); };
const header = (field: string) => screen.getByRole("columnheader", { name: field });
const frozen = () => screen.getByRole("table").querySelectorAll("thead [data-frozen]");

function layout(withObserver = true) {
  let viewport = 900;
  const widths: Record<string, number> = { store: 180, amount: 200, note: 200, channel: 480 };
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function(this: HTMLElement) {
    return this.classList.contains("overflow-auto") ? viewport : 0;
  });
  const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    const field = this.querySelector("button")?.firstChild?.textContent || "";
    const width = widths[field] || (this.querySelector('input[type="checkbox"]') ? 112 : 64);
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 40, width, height: 40, toJSON() {} };
  });
  vi.stubGlobal("ResizeObserver", withObserver ? class {
    entry: typeof observers[number];
    constructor(callback: ResizeObserverCallback) { this.entry = { notify: () => callback([], this as unknown as ResizeObserver), disconnect: vi.fn() }; observers.push(this.entry); }
    observe() {}
    disconnect() { this.entry.disconnect(); }
  } : undefined);
  return { measure, widths, resize: (width: number) => { viewport = width; act(() => withObserver ? observers.at(-1)!.notify() : window.dispatchEvent(new Event("resize"))); } };
}

describe("data column freezing", () => {
  it("computes measured leading offsets while reserving a usable moving area and rejects incomplete measurements", () => {
    expect(tableFrozenOffsets(2, 900, 64, [180, 200, 480])).toEqual([64, 244]);
    expect(tableFrozenOffsets(3, 500, 112, [180, 200, 480])).toEqual([112]);
    expect(tableFrozenOffsets(3, 300, 112, [180, 200, 480])).toEqual([]);
    expect(tableFrozenOffsets(2, 400, 64, [120, 160])).toEqual([64, 184]); // All columns fit; no moving area is needed.
    expect(tableFrozenOffsets(20, 900, 64, [180, 200, 0, 100])).toEqual([64, 244]);
    for (const value of [0, -1, NaN, Infinity]) {
      expect(tableFrozenOffsets(value, 900, 64, [180])).toEqual([]);
      expect(tableFrozenOffsets(1, value, 64, [180])).toEqual([]);
      expect(tableFrozenOffsets(1, 900, value, [180])).toEqual([]);
      expect(tableFrozenOffsets(1, 900, 64, [value])).toEqual([]);
    }
  });

  it("aligns header and body offsets with selection gutters and temporarily reduces freezing on narrow layouts", () => {
    const dimensions = layout();
    render(intl(<Viewer />));
    expect(frozen()).toHaveLength(0);
    freeze(2);
    expect(header("store")).toHaveStyle({ left: "64px" });
    expect(header("amount")).toHaveStyle({ left: "244px" });
    expect(screen.getByRole("cell", { name: "East" })).toHaveStyle({ left: "64px" });
    expect(header("amount").style.boxShadow).not.toBe("");
    fireEvent.click(within(menu()).getByRole("button", { name: "完成" }));
    fireEvent.click(screen.getByRole("button", { name: "选择记录" }));
    expect(header("store")).toHaveStyle({ left: "112px" });
    expect(header("amount")).toHaveStyle({ left: "292px" });
    dimensions.resize(500);
    expect(frozen()).toHaveLength(1);
    menu().open = true;
    expect(screen.getByText("窗口较窄，当前固定前 1 列。")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "冻结列" })).toHaveValue("2");
    dimensions.resize(300); expect(frozen()).toHaveLength(0);
    expect(screen.getByText("空间不足，冻结列暂时随表格滚动。")).toBeInTheDocument();
    dimensions.resize(0); expect(frozen()).toHaveLength(0);
    dimensions.resize(900); expect(frozen()).toHaveLength(2);
    dimensions.widths.store = 300; dimensions.resize(1000);
    expect(header("amount")).toHaveStyle({ left: "412px" });
    dimensions.resize(900);
    expect(frozen()).toHaveLength(1); // The second column no longer fits.
    expect(header("amount").style.left).toBe("");
  });

  it("freezes the current visible prefix without changing order, selection, exact CSV values or record inspection", () => {
    layout();
    const download = vi.spyOn(csv, "downloadCsv").mockImplementation(() => {});
    const before = structuredClone(rows);
    render(intl(<Viewer />));
    freeze(1);
    fireEvent.click(within(menu()).getByRole("button", { name: "将amount列前移" }));
    expect(header("amount")).toHaveAttribute("data-frozen", "true");
    expect(header("store")).not.toHaveAttribute("data-frozen");
    fireEvent.click(within(menu()).getByRole("checkbox", { name: "amount" }));
    expect(header("store")).toHaveAttribute("data-frozen", "true");
    fireEvent.click(within(menu()).getByRole("button", { name: "显示全部列" }));
    fireEvent.click(within(menu()).getByRole("button", { name: "完成" }));
    fireEvent.click(screen.getByRole("button", { name: "选择记录" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择第 2 条记录" }));
    fireEvent.click(screen.getByRole("button", { name: "查看第 2 条记录" }));
    expect(within(screen.getByRole("complementary")).getAllByRole("term").map((node) => node.textContent)).toEqual(["amount", "store", "note", "channel"]);
    fireEvent.click(screen.getByRole("button", { name: "导出所选 1 条 CSV" }));
    expect(download.mock.lastCall).toEqual([[rows[1]], "Stores-所选记录.csv", ["amount", "store", "note", "channel"]]);
    freeze(0);
    expect(frozen()).toHaveLength(0);
    expect(screen.getByText("已选 1 条")).toBeInTheDocument();
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    expect(rows).toEqual(before);
  });

  it("resets the preference on new snapshots, preserves it for titles, and ignores old observer callbacks in Strict Mode", () => {
    const dimensions = layout();
    const view = render(<StrictMode>{intl(<Viewer />)}</StrictMode>);
    expect(observers).toHaveLength(0); // Ordinary browsing does not measure frozen columns.
    freeze(2);
    view.rerender(<StrictMode>{intl(<Viewer snapshot={{ title: "Renamed", rows }} />)}</StrictMode>);
    expect(frozen()).toHaveLength(2);
    const obsolete = observers.at(-1)!;
    view.rerender(<StrictMode>{intl(<Viewer snapshot={{ title: "New", rows: [{ store: "New" }] }} />)}</StrictMode>);
    expect(frozen()).toHaveLength(0);
    menu().open = true;
    screen.getByText("阅读设置").closest("details")!.open = true;
    expect(screen.getByRole("combobox", { name: "冻结列" })).toHaveValue("0");
    expect(obsolete.disconnect).toHaveBeenCalled();
    const count = dimensions.measure.mock.calls.length;
    act(() => obsolete.notify());
    expect(dimensions.measure).toHaveBeenCalledTimes(count);
    const latest = observers.at(-1)!;
    view.unmount();
    act(() => latest.notify());
    expect(dimensions.measure).toHaveBeenCalledTimes(count);
  });

  it("provides English controls and a window-resize fallback when ResizeObserver is unavailable", () => {
    const dimensions = layout(false);
    render(intl(<Viewer />, true));
    screen.getByText(/^Columns /).closest("details")!.open = true;
    fireEvent.change(screen.getByRole("combobox", { name: "Freeze columns" }), { target: { value: "2" } });
    expect(frozen()).toHaveLength(2);
    dimensions.resize(300);
    expect(frozen()).toHaveLength(0);
    expect(screen.getByText("Not enough room to freeze columns at this width.")).toBeInTheDocument();
    dimensions.resize(900); expect(frozen()).toHaveLength(2);
  });
});
