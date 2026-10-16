import { describe, expect, it } from "vitest";
import {
  chartNumber, chartNumberKey, chartSourceValue, compareNumericValues,
  formatNumericValue, isNumericCell, numericSortColumn, numericValue,
} from "@/lib/numeric-values";
import { normalizeChartSpec } from "@/lib/charts";
import { applyStaticReportFilters } from "@/lib/report-blocks";
import type { ReportBlock } from "@/lib/reports";

describe("exact numeric consumers", () => {
  it("compares decimal transport without narrowing or treating blanks as zero", () => {
    expect(compareNumericValues("9007199254740993", "9007199254740992")).toBe(1);
    expect(compareNumericValues("-0.10000000000000000002", "-0.10000000000000000001")).toBe(-1);
    expect(compareNumericValues("1e1000", "9e999")).toBe(1);
    expect(compareNumericValues("10.0", 10)).toBe(0);
    for (const value of [null, false, "", " ", "0x10", "Infinity", "1e1000000"]) {
      expect(numericValue(value)).toBeNull();
    }
    expect(numericSortColumn(["2.01", 10, null, "9007199254740993"])).toBe(true);
    expect(numericSortColumn(["001", "010"])).toBe(false);
    expect(isNumericCell("0001")).toBe(false);
  });

  it("formats exact strings with Intl instead of first converting to Number", () => {
    expect(formatNumericValue("9007199254740993.0123", "auto", "en"))
      .toBe("9,007,199,254,740,993.0123");
    expect(formatNumericValue("-9007199254740993.015", "currency", "en"))
      .toBe("-CN¥9,007,199,254,740,993.02");
    expect(formatNumericValue("0.125", "percent", "en")).toBe("12.5%");
    expect(formatNumericValue("0.0000000000000000001234", "auto", "en"))
      .toBe("0.0000000000000000001234");
    expect(formatNumericValue("1e1000", "currency", "en")).toBe("1e1000");
    expect(formatNumericValue("1e-1000", "percent", "en")).toBe("1e-1000");
  });

  it("keeps original chart rows while providing explicit geometry accessors", () => {
    const row = Object.freeze({ category: "001", revenue: "9007199254740993.0123" });
    const key = chartNumberKey("revenue");
    expect(typeof key(row)).toBe("number");
    expect(key.field).toBe("revenue");
    expect(chartSourceValue(row, "revenue", key(row))).toBe(row.revenue);
    expect(chartSourceValue({ payload: row }, "revenue", key(row))).toBe(row.revenue);
    expect(chartNumber("1e1000")).toBeNull();
    expect(chartNumber("1e-1000")).toBeNull();
    expect(chartNumber(null)).toBeNull();
    const spec = normalizeChartSpec({
      version: 1, type: "bar", encoding: { x: { field: "category" }, y: [{ field: "revenue" }] },
      data: [row],
    });
    expect(spec?.data).toEqual([row]);
  });

  it("filters exact report numbers without changing text equality or source content", () => {
    const block: ReportBlock = {
      id: "precision", title: "金额", block_type: "table", order_index: 0,
      source_kind: "manual", config: {}, layout: { x: 0, y: 0, w: 6, h: 4 },
      content: { rows: [
        { amount: "9007199254740992" }, { amount: "9007199254740993" },
        { amount: "" }, { amount: null }, { amount: false },
      ] },
    };
    expect(applyStaticReportFilters(block, [
      { field: "amount", operator: "greater_than", value: "9007199254740992" },
    ]).content.rows).toEqual([{ amount: "9007199254740993" }]);
    expect(applyStaticReportFilters(block, [
      { field: "amount", operator: "less_than", value: "0" },
    ]).content.rows).toEqual([]);
    expect(applyStaticReportFilters(block, [
      { field: "amount", operator: "equals", value: "09007199254740993" },
    ]).content.rows).toEqual([]);
    expect((block.content.rows as unknown[]).length).toBe(5);
  });
});
