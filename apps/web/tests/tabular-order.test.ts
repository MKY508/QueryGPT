import { describe, expect, it } from "vitest";
import { cycleTableSort, filterTableRecords, moveTableItem, sortTableRows, tableSortRules, tableViewRecords, type TableSortRule } from "@/lib/tabular-data";

describe("table view ordering", () => {
  it("filters the cached order with the same full-population types and duplicate identities", () => {
    const repeated = { amount: "2", name: "Ｋｅｅｐ" };
    const rows = [repeated, { amount: "10", name: "Keep" }, { amount: "text", name: "omit" }, repeated];
    const sort = { column: "amount", direction: "asc" } as const;
    const ordered = tableViewRecords(rows, sort, [], "", "en");
    const accepts = (row: Record<string, unknown>) => row.name !== "omit";
    const filtered = filterTableRecords(ordered, ["name"], "keep", "en", accepts);
    expect(filtered).toEqual(tableViewRecords(rows, sort, ["name"], "keep", "en", accepts));
    expect(filtered.map(({ index }) => index)).toEqual([1, 0, 3]);
    expect(filtered[1]).toBe(ordered[1]);
    expect(filtered[2].row).toBe(repeated);
    expect(filterTableRecords(ordered, [], " ", "en")).toBe(ordered);
    expect(filterTableRecords(ordered, [], "keep", "en")).toEqual([]);
  });
  it("uses ordered tie breakers, exact numbers and null-last ordering without losing duplicate identities", () => {
    const repeated = { group: "A", amount: "9007199254740993.0123", name: "keep" };
    const rows = [{ group: "B", amount: "2", name: "keep" }, repeated,
      { group: "A", amount: "9007199254740993.0124", name: "keep" },
      { group: "A", amount: null, name: "keep" }, repeated, { group: null, amount: "1e30", name: "keep" }];
    const before = structuredClone(rows);
    const order: TableSortRule[] = [{ column: "group", direction: "asc" }, { column: "amount", direction: "desc" }];
    const records = tableViewRecords(rows, order, ["name"], "keep", "en");
    expect(records.map(({ index }) => index)).toEqual([2, 1, 4, 3, 0, 5]);
    expect(records[1].row).toBe(repeated);
    expect(records[2].row).toBe(repeated);
    expect(sortTableRows(rows, order, "en")).toEqual(records.map(({ row }) => row));
    expect(tableViewRecords(rows, [], ["name"], "", "en").map(({ index }) => index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(sortTableRows(rows, null, "en")).toBe(rows);
    expect(rows).toEqual(before);
  });

  it("infers every level from the complete column and never sorts inherited object fields", () => {
    const rows = [{ group: "A", amount: "2", name: "keep" }, { group: "A", amount: "10", name: "keep" },
      { group: "B", amount: "text", name: "omit" }];
    expect(tableViewRecords(rows, [{ column: "group", direction: "asc" }, { column: "amount", direction: "asc" }], ["name"], "keep", "en")
      .map(({ index }) => index)).toEqual([1, 0]);
    expect(sortTableRows([{ code: "002" }, { code: "01" }, { code: "2" }], { column: "code", direction: "asc" }, "en").map((row) => row.code)).toEqual(["002", "01", "2"]);
    const ownFields: Record<string, unknown>[] = [{}, { toString: "10" }, { toString: "2" }];
    expect(sortTableRows(ownFields, { column: "toString", direction: "asc" }, "en")).toEqual([ownFields[2], ownFields[1], ownFields[0]]);
  });

  it("cycles one sorting level with Shift, replaces with plain clicks and reorders without mutation", () => {
    const first: TableSortRule[] = [{ column: "group", direction: "asc" }];
    const second = cycleTableSort(first, "amount", true);
    expect(second).toEqual([...first, { column: "amount", direction: "asc" }]);
    expect(cycleTableSort(second, "group", true)[0].direction).toBe("desc");
    expect(cycleTableSort(cycleTableSort(second, "group", true), "group", true)).toEqual([second[1]]);
    expect(cycleTableSort(second, "amount", false)).toEqual([{ column: "amount", direction: "desc" }]);
    expect(moveTableItem(second, 1, -1)).toEqual([second[1], second[0]]);
    expect(moveTableItem(second, 0, -1)).toEqual(second);
    expect(moveTableItem(second, 9, -1)).toEqual(second);
    expect(tableSortRules([...second, { column: "group", direction: "desc" }])).toEqual(second);
    expect(first).toEqual([{ column: "group", direction: "asc" }]);
  });
});
