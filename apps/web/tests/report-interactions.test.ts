import { describe, expect, it } from "vitest";
import type { ReportBlock, ReportPage } from "@/lib/reports";
import {
  applyReportInteractions, configureCrossFilter, crossFilterRule, interactionFields,
  makeReportSelection, pageReportFilters, resolveSelections, selectionValueKey, selectionValues,
} from "@/lib/report-interactions";

function block(id: string, type: ReportBlock["block_type"], rows: Record<string, unknown>[]): ReportBlock {
  return { id, block_type: type, title: id, order_index: 0, source_kind: "manual",
    content: { rows }, config: {}, layout: { x: 0, y: 0, w: 6, h: 4 } };
}

function fixture() {
  const page: ReportPage = { id: "page-1", title: "Page", order_index: 0, config: {}, blocks: [
    block("source", "chart", [{ region: "East", amount: 10 }, { region: "West", amount: 20 }]),
    block("target", "table", [{ territory: "East", amount: 10 }, { territory: "West", amount: 20 }]),
    block("unrelated", "table", [{ region: "East" }, { region: "West" }]),
  ] };
  let key = 0;
  return configureCrossFilter(page, "source", "region", "target", "territory", () => `key-${++key}`);
}

describe("report cross-filter rules", () => {
  it("filters only the explicit target field, retaining source marks and unrelated same-name fields", () => {
    const page = fixture();
    const before = structuredClone(page);
    const selection = makeReportSelection(page, page.blocks[0], "East")!;
    const active = resolveSelections(page, [selection]);
    expect(applyReportInteractions(page.blocks[0], [], active)).toBe(page.blocks[0]);
    expect(applyReportInteractions(page.blocks[2], [], active)).toBe(page.blocks[2]);
    expect(applyReportInteractions(page.blocks[1], [], active).content).toEqual({
      rows: [{ territory: "East", amount: 10 }], _filter_applied: true, _filter_source_rows: 2,
    });
    expect(page).toEqual(before);
  });

  it("keeps exact scalar identity including null, blank text, booleans and long number strings", () => {
    const values = ["9007199254740993", "9007199254740992", "East", "east", " East ", "", null, false, "false", 1, "1"];
    const page = fixture();
    page.blocks[0].content.rows = values.map((region) => ({ region }));
    page.blocks[1].content.rows = [...values.map((territory) => ({ territory })), { missing: true }];
    expect(selectionValues(page.blocks[0], "region")).toEqual(values);
    expect(new Set(values.map(selectionValueKey)).size).toBe(values.length);
    for (const value of values) {
      const active = resolveSelections(page, [makeReportSelection(page, page.blocks[0], value)!]);
      expect(applyReportInteractions(page.blocks[1], [], active).content.rows).toEqual([{ territory: value }]);
    }
  });

  it("intersects multiple actions with manual filters without changing the original row count", () => {
    let page = fixture();
    page.blocks.push(block("channel", "chart", [{ channel: "Shop" }, { channel: "Online" }]));
    page.blocks.push({ ...block("filter", "filter", []), config: { field: "amount", operator: "greater_than" } });
    page.blocks[1].content.rows = [
      { territory: "East", channel: "Shop", amount: "9007199254740993" },
      { territory: "East", channel: "Online", amount: "9007199254740994" },
      { territory: "West", channel: "Shop", amount: "9007199254740995" },
      { territory: "East", channel: "Shop", amount: "9007199254740992" },
    ];
    page = configureCrossFilter(page, "channel", "channel", "target", "channel");
    const active = resolveSelections(page, [
      makeReportSelection(page, page.blocks[0], "East")!,
      makeReportSelection(page, page.blocks[3], "Shop")!,
    ]);
    const result = applyReportInteractions(page.blocks[1], pageReportFilters(page, { filter: "9007199254740992" }), active);
    expect(result.content.rows).toEqual([{ territory: "East", channel: "Shop", amount: "9007199254740993" }]);
    expect(result.content._filter_source_rows).toBe(4);
    expect(pageReportFilters(page, { filter: "  " })).toEqual([]);
  });

  it("preserves configured links after serialization and server ID assignment without altering provenance", () => {
    const original = fixture();
    const source = original.blocks[0];
    source.source_kind = "artifact";
    source.artifact_id = "evidence";
    source.source_ref = { snapshot: { receipt: "original" } };
    const before = structuredClone(original);
    const configured = configureCrossFilter(original, source.id, "region", "target", "territory");
    expect(original).toEqual(before);
    expect(configured.blocks[0]).toMatchObject({ artifact_id: "evidence", source_ref: source.source_ref, config: { manual_override: true } });
    expect(configured.blocks[1].config.manual_override).toBeUndefined();
    const selection = makeReportSelection(configured, configured.blocks[0], "East")!;
    const saved = JSON.parse(JSON.stringify(configured)) as ReportPage;
    saved.blocks.forEach((item, index) => { item.id = `server-${index}`; });
    const resolved = resolveSelections(saved, [selection]);
    expect(resolved).toHaveLength(1);
    expect(applyReportInteractions(saved.blocks[1], [], resolved).content.rows).toEqual([{ territory: "East", amount: 10 }]);
    const disabled = configureCrossFilter(configured, source.id, "");
    expect(disabled.blocks[0].config.filter_action).toBeUndefined();
    expect(resolveSelections(disabled, [selection])).toEqual([]);
  });

  it("rejects stale selections, self-links, absent fields, key collisions and other pages", () => {
    const page = fixture();
    const selection = makeReportSelection(page, page.blocks[0], "East")!;
    expect(makeReportSelection(page, page.blocks[0], "Unknown")).toBeNull();
    expect(resolveSelections({ ...page, id: "another-page" }, [selection])).toEqual([]);
    const missingValue = structuredClone(page);
    missingValue.blocks[0].content.rows = [{ region: "West" }];
    expect(resolveSelections(missingValue, [selection])).toEqual([]);
    const duplicate = structuredClone(page);
    duplicate.blocks.push({ ...duplicate.blocks[1], id: "duplicate-target" });
    expect(resolveSelections(duplicate, [selection])).toEqual([]);
    const invalid = structuredClone(page);
    invalid.blocks[0].config.filter_action = { field: "region", targets: [
      { key: invalid.blocks[0].config.interaction_key, field: "region" },
      { key: invalid.blocks[1].config.interaction_key, field: "nonexistent" },
    ] };
    expect(crossFilterRule(invalid, invalid.blocks[0])?.targets).toEqual([]);
    expect(resolveSelections(invalid, [selection])).toEqual([]);
    expect(configureCrossFilter(page, "source", "region", "source", "region")).toBe(page);
  });

  it("offers row-backed chart/table fields only and excludes unsupported selection values", () => {
    const source = block("data", "chart", []);
    source.content = { data: [{ key: null }, { key: false }, { key: false }, { key: [] }, { key: {} },
      { key: Infinity }, { key: "x".repeat(4097) }, { absent: "field" }] };
    expect(interactionFields(source)).toEqual(["key", "absent"]);
    expect(selectionValues(source, "key")).toEqual([null, false]);
    expect(interactionFields({ ...source, block_type: "metric" })).toEqual([]);
    expect(interactionFields({ ...source, content: { ...source.content, image_url: "image.png" } })).toEqual([]);
  });
});
