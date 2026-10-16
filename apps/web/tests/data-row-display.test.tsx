import { StrictMode, useRef, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataViewDialog } from "@/components/data/DataViewDialog";
import { useDataRowDisplay, type DataRowDisplay } from "@/components/data/useDataRowDisplay";
import * as csv from "@/lib/csv";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } },
  });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard); else Reflect.deleteProperty(navigator, "clipboard");
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScroll); else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});
const intl = (content: ReactNode, english = false) => <NextIntlClientProvider locale={english ? "en" : "zh"} messages={english ? en : zh}>{content}</NextIntlClientProvider>;
const menu = (english = false) => screen.getByText(english ? /^Columns / : /^显示列 /).closest("details")!;
const display = (value: DataRowDisplay, english = false) => {
  menu(english).open = true;
  screen.getByText(english ? "Reading settings" : "阅读设置").closest("details")!.open = true;
  fireEvent.change(screen.getByRole("combobox", { name: english ? "Row height" : "行高" }), { target: { value } });
  fireEvent.click(within(menu(english)).getByRole("button", { name: english ? "Done" : "完成" }));
};

describe("data row display", () => {
  it("changes visual wrapping without truncating source values, exact record copy, TSV or CSV", async () => {
    const row = { note: `  First\r\n${"完整备注".repeat(40)}\nLast  `, amount: "9007199254740993.0123", blank: "", missing: null, active: false, formula: "=1+2" };
    const rows = [row], before = structuredClone(rows);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const download = vi.spyOn(csv, "downloadCsv").mockImplementation(() => {});
    render(intl(<DataViewDialog snapshot={{ title: "Review", rows }} onClose={() => {}} />));
    const table = screen.getByRole("table");
    const note = table.querySelector("tbody td > div")!;
    expect(table).toHaveAttribute("data-row-display", "compact");
    expect(note).toHaveClass("truncate");
    expect(note.textContent).toBe(row.note);
    expect(note).toHaveAttribute("title", row.note);
    for (const mode of ["comfortable", "wrap"] as const) {
      display(mode);
      expect(table).toHaveAttribute("data-row-display", mode);
      expect(note.textContent).toBe(row.note);
    }
    expect(note).toHaveClass("whitespace-pre-wrap");
    expect(note).not.toHaveAttribute("title");
    expect(within(table).getByRole("cell", { name: row.amount })).toHaveClass("text-right");
    expect(within(table).getByRole("cell", { name: "false" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看第 1 条记录" }));
    display("compact");
    expect(within(screen.getByRole("complementary")).getAllByRole("definition")[0].textContent).toBe(row.note);
    fireEvent.click(screen.getByRole("button", { name: "复制note的值" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(row.note));
    await waitFor(() => expect(screen.getByRole("button", { name: "复制记录" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "复制记录" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(csv.createTsv(rows, Object.keys(row))));
    fireEvent.click(screen.getByRole("button", { name: "导出当前结果 CSV" }));
    expect(download.mock.lastCall).toEqual([rows, "Review.csv", Object.keys(row)]);
    expect(rows).toEqual(before);
  });

  it("keeps paging, checked records and search through display changes and resets only for a new snapshot", () => {
    const rows = Array.from({ length: 55 }, (_, index) => ({ name: `Store ${index}`, note: "Long note\nSecond line" }));
    const viewer = (title: string, data = rows) => <StrictMode>{intl(<DataViewDialog snapshot={{ title, rows: data }} onClose={() => {}} />, true)}</StrictMode>;
    const view = render(viewer("Stores"));
    fireEvent.click(screen.getByRole("button", { name: "Select records" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select record 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    display("comfortable", true);
    expect(screen.getByRole("button", { name: "View record 51" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select record 51" }));
    display("wrap", true);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search table" }), { target: { value: "Store 50" } });
    display("compact", true);
    expect(screen.getByRole("table").querySelectorAll("tbody tr[data-data-row]")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Export 2 selected as CSV" })).toBeEnabled();
    display("wrap", true);
    view.rerender(viewer("Renamed"));
    expect(screen.getByRole("table")).toHaveAttribute("data-row-display", "wrap");
    expect(screen.getByRole("searchbox", { name: "Search table" })).toHaveValue("Store 50");
    view.rerender(viewer("New", [{ name: "New", note: "New" }]));
    expect(screen.getByRole("table")).toHaveAttribute("data-row-display", "compact");
    expect(screen.getByRole("searchbox", { name: "Search table" })).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Export 2 selected as CSV" })).not.toBeInTheDocument();
  });

  it("anchors the first visible source row before paint and ignores hidden or empty tables in Strict Mode", () => {
    function Harness({ empty = false }: { empty?: boolean }) {
      const ref = useRef<HTMLDivElement>(null);
      const { rowDisplay, changeRowDisplay } = useDataRowDisplay(ref);
      return <><button onClick={() => changeRowDisplay("wrap")}>Wrap</button><button onClick={() => changeRowDisplay("compact")}>Compact</button>
        <div ref={ref} data-testid="viewport"><table data-row-display={rowDisplay}><thead><tr><th>Header</th></tr></thead>
          <tbody>{!empty && [0, 1, 2, 3].map((index) => <tr key={index} data-data-row={index}><td>Row {index}</td></tr>)}</tbody></table></div></>;
    }
    let hidden = false;
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: function(this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = options.top ?? this.scrollTop;
    } });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => hidden ? 0 : 160);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      const viewport = this.closest('[data-testid="viewport"]')!;
      const height = viewport.querySelector("table")?.getAttribute("data-row-display") === "wrap" ? 80 : 40;
      const top = this.hasAttribute("data-data-row") ? 20 + Number(this.dataset.dataRow) * height - viewport.scrollTop : 0;
      const size = this.tagName === "THEAD" ? 20 : this.hasAttribute("data-data-row") ? height : 160;
      return { x: 0, y: top, left: 0, right: 400, top, bottom: top + size, width: 400, height: size, toJSON() {} };
    });
    const view = render(<StrictMode><Harness /></StrictMode>);
    const viewport = screen.getByTestId("viewport");
    viewport.scrollTop = 80;
    fireEvent.click(screen.getByText("Wrap"));
    expect(viewport.scrollTop).toBe(160);
    fireEvent.click(screen.getByText("Compact"));
    expect(viewport.scrollTop).toBe(80);
    fireEvent.click(screen.getByText("Wrap"));
    viewport.scrollTop = 220; // Deep within source row 2, taller than a compact row.
    fireEvent.click(screen.getByText("Compact"));
    expect(viewport.scrollTop).toBe(80);
    hidden = true;
    fireEvent.click(screen.getByText("Wrap"));
    expect(viewport.scrollTop).toBe(80);
    hidden = false;
    view.rerender(<StrictMode><Harness empty /></StrictMode>);
    fireEvent.click(screen.getByText("Compact"));
    expect(viewport.scrollTop).toBe(80);
    view.unmount();
  });

  it("remeasures frozen column offsets on density changes without ResizeObserver", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      const wrap = this.closest("table")?.getAttribute("data-row-display") === "wrap";
      const width = !(this instanceof HTMLTableCellElement) || this.cellIndex === 0 ? 64 : wrap ? 240 : 180;
      return { x: 0, y: 0, left: 0, right: width, top: 0, bottom: 40, width, height: 40, toJSON() {} };
    });
    render(intl(<DataViewDialog snapshot={{ title: "Stores", rows: [{ store: "East", amount: "123", note: "Long text" }] }} onClose={() => {}} />));
    menu().open = true;
    screen.getByText("阅读设置").closest("details")!.open = true;
    fireEvent.change(screen.getByRole("combobox", { name: "冻结列" }), { target: { value: "2" } });
    expect(screen.getByRole("columnheader", { name: "amount" })).toHaveStyle({ left: "244px" });
    display("wrap");
    expect(screen.getByRole("columnheader", { name: "amount" })).toHaveStyle({ left: "304px" });
    expect(screen.getByRole("cell", { name: "123" })).toHaveStyle({ left: "304px" });
  });
});
