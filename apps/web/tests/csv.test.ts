import { afterEach, describe, expect, it, vi } from "vitest";
import Papa from "papaparse";
import { createCsv, createTsv, downloadCsv } from "@/lib/csv";
import { tableViewRecords, type TabularRow } from "@/lib/tabular-data";

describe("CSV export", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("escapes localized formula prefixes in headers and values in CSV and clipboard", () => {
    const values = ["＝1+2", " ＋1", "－1", "＠SUM(A1)", "  \ttext", " \rtext", " \ntext"];
    const rows = [Object.fromEntries(values.map((value) => [value, value]))];
    for (const [text, delimiter] of [[createCsv(rows), ","], [createTsv(rows), "\t"]]) {
      expect(Papa.parse(text, { delimiter }).data).toEqual([values.map((v) => "'" + v), values.map((v) => "'" + v)]);
    }
    const decimals = ["-12.40", "-9007199254740993.0123", "-1.20e-3"];
    expect(Papa.parse(createCsv(decimals.map((value) => ({ amount: value })))).data).toEqual([["amount"], ...decimals.map((v) => [v])]);
  });

  it.each([false, true])("cleans up download resources even when click fails: %s", (fails) => {
    vi.useFakeTimers();
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:result"), revokeObjectURL });
    let anchor: HTMLAnchorElement | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      anchor = document.querySelector<HTMLAnchorElement>('a[download="result.csv"]') ?? undefined;
      expect(this.isConnected).toBe(true);
      expect(this.download).toBe("result.csv");
      if (fails) throw new Error("download unavailable");
    });
    const download = () => downloadCsv([{ amount: 1 }], "result.csv");
    if (fails) expect(download).toThrow("download unavailable");
    else download();
    expect(anchor?.isConnected).toBe(false);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:result");
  });

  it("keeps inherited names missing in value search, CSV and clipboard tables", () => {
    const rows: TabularRow[] = [JSON.parse('{"toString":"own","__proto__":"literal"}'), {}];
    const columns = ["toString", "__proto__"];
    expect(Papa.parse(createCsv(rows, columns)).data).toEqual([columns, ["own", "literal"], ["", ""]]);
    expect(Papa.parse(createTsv(rows, columns), { delimiter: "\t" }).data).toEqual([columns, ["own", "literal"], ["", ""]]);
    expect(tableViewRecords(rows, null, columns, "function", "en")).toEqual([]);
    expect(tableViewRecords(rows, null, columns, "own", "en").map(({ index }) => index)).toEqual([0]);
    expect(Object.keys(rows[1])).toEqual([]);
  });

  it("round-trips Chinese, quoted headers, commas, newlines and sparse columns", () => {
    const csv = createCsv([
      { '门店,"名称"': '杭州\n"西湖",店', amount: 12 },
      { '门店,"名称"': "上海", amount: null, note: "补充" },
    ]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const parsed = Papa.parse(csv, { header: true });
    expect(parsed.errors).toEqual([]);
    expect(parsed.data).toEqual([
      { '门店,"名称"': '杭州\n"西湖",店', amount: "12", note: "" },
      { '门店,"名称"': "上海", amount: "", note: "补充" },
    ]);
  });

  it("exports formula-like text as text without changing negative numeric amounts", () => {
    const parsed = Papa.parse(createCsv([{
      name: '=HYPERLINK("https://example.com")', amount: -12, phone: "+861234",
      refund: "-9007199254740993.0123", expression: "-1+2", spaced: "  =1+2",
    }]), { header: true });
    expect(parsed.data).toEqual([{
      name: '\'=HYPERLINK("https://example.com")', amount: "-12", phone: "'+861234",
      refund: "-9007199254740993.0123", expression: "'-1+2", spaced: "'  =1+2",
    }]);
  });
});
