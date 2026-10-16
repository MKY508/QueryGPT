import { describe, expect, it } from "vitest";
import { dataColumns, tableViewRecords, type TabularRow } from "@/lib/tabular-data";
import { tableFieldKinds, tableFilterError, tableFilterFromValue, tableFilterMatcher, tableFilterOperators,
  type TableFilter, type TableFilters } from "@/lib/tabular-filters";

const rule = (field: string, operator: TableFilter["operator"], value = "", upper = ""): TableFilter => ({ id: `${field}-${operator}`, field, operator, value, upper });
function matching(rows: TabularRow[], rules: TableFilter[], mode: TableFilters["mode"] = "all") {
  return rows.filter(tableFilterMatcher({ rules, mode }, tableFieldKinds(rows, dataColumns(rows)), "en"));
}

describe("table field filters", () => {
  it("seeds value filters from exact scalar identities, including missing, blank and multiline cells", () => {
    const row = { amount: "9007199254740993.0123", code: "002", note: "  First\r\nSecond \n", active: false, missing: null, empty: "", zero: 0 };
    const kinds = tableFieldKinds([row], dataColumns([row]));
    for (const [field, value] of Object.entries(row)) {
      const seed = tableFilterFromValue(field, value, kinds)!;
      expect(seed).toEqual({ field, value: value == null ? "" : String(value), upper: "",
        operator: value == null ? "is_missing" : value === "" ? "is_empty_text" : "equals" });
      const matches = tableFilterMatcher({ rules: [{ ...seed, id: "seed" }], mode: "all" }, kinds, "en");
      expect(matches(row)).toBe(true);
      if (field !== "missing") expect(matches({})).toBe(false);
    }
    const amount = tableFilterFromValue("amount", row.amount, kinds)!;
    expect(tableFilterMatcher({ rules: [{ ...amount, id: "seed" }], mode: "all" }, kinds, "en")({ amount: "9007199254740993.0124" })).toBe(false);
    expect(tableFilterFromValue("missing", undefined, kinds)?.operator).toBe("is_missing");
  });

  it("does not offer scalar value filters for structured, unsupported or truncated identities", () => {
    const kinds = tableFieldKinds([{ object: {}, mixed: "text", long: "x".repeat(4097) }, { mixed: {} }], ["object", "mixed", "long"]);
    expect(tableFilterFromValue("object", {}, kinds)).toBeNull();
    expect(tableFilterFromValue("mixed", [], kinds)).toBeNull();
    expect(tableFilterFromValue("mixed", Infinity, kinds)).toBeNull();
    expect(tableFilterFromValue("mixed", () => "text", kinds)).toBeNull();
    expect(tableFilterFromValue("long", "x".repeat(4097), kinds)).toBeNull();
    expect(tableFilterFromValue("mixed", "x".repeat(4096), kinds)?.value).toHaveLength(4096);
    expect(tableFilterFromValue("gone", "value", kinds)).toBeNull();
    expect(tableFilterFromValue("object", null, kinds)?.operator).toBe("is_missing");
  });

  it("uses complete columns without converting padded codes or mixed values into numbers", () => {
    const rows = [{ code: "002", amount: "9007199254740993.0123", active: false, mixed: "2", object: {} },
      { code: "2", amount: 0, active: true, mixed: "text", object: [] }, { code: "", amount: null }];
    const kinds = tableFieldKinds(rows, dataColumns(rows));
    expect([...kinds]).toEqual([["code", "text"], ["amount", "number"], ["active", "boolean"], ["mixed", "text"], ["object", "structured"]]);
    expect(tableFilterOperators(kinds.get("code")!)).not.toContain("gt");
    expect(matching(rows, [rule("code", "equals", "2")])).toEqual([rows[1]]);
    expect(matching(rows, [rule("active", "equals", "false")])).toEqual([rows[0]]);
    expect(matching(rows, [rule("object", "has_value")])).toEqual(rows.slice(0, 2));
    expect(tableFieldKinds([{ toString: 1 }, {}], ["toString"]).get("toString")).toBe("number");
  });

  it("compares exact inclusive ranges and scientific notation without rounding source text", () => {
    const rows = ["9007199254740993.0122", "9007199254740993.0123", "9007199254740993.0124", "1e30", "-1e-300", "0", ""].map((amount) => ({ amount }));
    const before = structuredClone(rows);
    expect(matching(rows, [rule("amount", "between", rows[1].amount, rows[2].amount)])).toEqual(rows.slice(1, 3));
    expect(matching(rows, [rule("amount", "gt", rows[1].amount), rule("amount", "lte", "1e30")])).toEqual(rows.slice(2, 4));
    expect(matching(rows, [rule("amount", "lt", "0")])).toEqual([rows[4]]);
    expect(matching(rows, [rule("amount", "equals", "1000000000000000000000000000000")])).toEqual([rows[3]]);
    expect(rows).toEqual(before);
  });

  it("keeps null/missing, empty text, whitespace, zero and false separate", () => {
    const rows: TabularRow[] = [{ v: null }, {}, { v: "" }, { v: " " }, { v: 0 }, { v: false }, { v: {} }];
    expect(matching(rows, [rule("v", "is_missing")])).toEqual(rows.slice(0, 2));
    expect(matching(rows, [rule("v", "is_empty_text")])).toEqual([rows[2]]);
    expect(matching(rows, [rule("v", "has_value")])).toEqual(rows.slice(3));
    expect(matching(rows, [rule("v", "not_equals", "0")])).toEqual([rows[2], rows[3], rows[5]]);
    expect(matching(rows, [rule("v", "equals", " ")])).toEqual([rows[3]]);
  });

  it("combines literal conditions with all/any, search and exact full-column sorting", () => {
    const repeated = { region: "East", amount: "2" };
    const rows = [repeated, { region: "west%_", amount: "10" }, repeated, { region: "East", amount: "text" }];
    const rules = [rule("region", "starts_with", "WE"), rule("amount", "equals", "2")];
    expect(matching(rows, rules)).toEqual([]);
    expect(matching(rows, rules, "any")).toEqual(rows.slice(0, 3));
    expect(matching(rows, [rule("region", "contains", "%_")])).toEqual([rows[1]]);
    expect(matching(rows, [rule("region", "equals", "east")])).toEqual([]);
    const match = tableFilterMatcher({ rules: [rule("amount", "not_equals", "text")], mode: "all" }, tableFieldKinds(rows, dataColumns(rows)), "en");
    const records = tableViewRecords(rows, { column: "amount", direction: "asc" }, ["region"], "", "en", match);
    expect(records.map(({ index }) => index)).toEqual([1, 0, 2]);
    expect(records[1].row).toBe(repeated);
  });

  it("rejects incomplete, inverted, unsupported and invalid filters without broadening any-match exports", () => {
    const kinds = tableFieldKinds([{ amount: "1", label: "East" }], ["amount", "label"]);
    for (const [condition, error] of [
      [rule("amount", "between", "1", ""), "required"], [rule("amount", "gt", "Infinity"), "number"],
      [rule("amount", "gt", "1e1001"), "number"], [rule("amount", "between", "2", "1"), "range"],
      [rule("gone", "has_value"), "field"], [rule("label", "gt", "1"), "field"],
    ] as const) {
      expect(tableFilterError(condition, kinds)).toBe(error);
      expect(tableFilterMatcher({ rules: [rule("label", "equals", "East"), condition], mode: "any" }, kinds, "en")({ amount: "1", label: "East" })).toBe(false);
    }
    expect(tableFilterMatcher({ rules: [], mode: "any" }, kinds, "en")({})).toBe(true);
  });
});
