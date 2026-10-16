import { describe, expect, it } from "vitest";
import { tableTextMatcher } from "@/lib/table-text-search";
import { searchTableRows, tableViewRecords } from "@/lib/tabular-data";
import { tableFieldKinds, tableFilterMatcher } from "@/lib/tabular-filters";

describe("table text search", () => {
  it("matches width and canonical variants without treating input as a pattern", () => {
    expect(tableTextMatcher(" Ｃａｆé ", "zh")("CAFE\u0301")).toBe(true);
    expect(tableTextMatcher("ｵﾝﾗｲﾝ", "ja")("オンライン")).toBe(true);
    expect(tableTextMatcher("ı", "tr")("Ｉ")).toBe(true);
    expect(tableTextMatcher("[.*]", "en")("anything")).toBe(false);
    expect(tableTextMatcher("[.*]", "en")("literal [.*] text")).toBe(true);
    expect(tableTextMatcher("east west", "en")("west east")).toBe(false);
  });

  it("retains original records and column scope while exact filters remain literal", () => {
    const rows = [{ name: "ＡＢＣ", hidden: "secret" }, { name: "ABC", hidden: "other" }];
    expect(searchTableRows(rows, ["name"], "abc", "en")).toEqual(rows);
    const results = tableViewRecords(rows, null, ["name"], "ａｂｃ", "en");
    expect(results.map(({index}) => index)).toEqual([0, 1]);
    expect(results[0].row).toBe(rows[0]);
    expect(results[0].row.name).toBe("ＡＢＣ");
    expect(searchTableRows(rows, ["name"], "secret", "en")).toEqual([]);
    const exact = tableFilterMatcher({mode: "all", rules: [{id: "1", field: "name", operator: "equals", value: "ABC", upper: ""}]}, tableFieldKinds(rows, ["name"]), "en");
    expect(rows.filter(exact)).toEqual([rows[1]]);
  });
});
