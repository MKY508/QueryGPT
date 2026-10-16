import { describe, expect, it } from "vitest";
import type { ReportBlock, ReportDocument } from "@/lib/reports";
import { connectedReportFilters, configureReportFilter, reportFiltersForPage } from "@/lib/report-filter-connections";
import { applyReportInteractions, pageReportFilters } from "@/lib/report-interactions";

function block(id: string, type: ReportBlock["block_type"], rows: Record<string, unknown>[] = []): ReportBlock {
  return { id, block_type: type, title: id, order_index: 0, source_kind: "manual",
    content: { rows }, config: {}, layout: { x: 0, y: 0, w: 6, h: 4 } };
}

function fixture() {
  const report: ReportDocument = { id: "report", project_id: "project", title: "Report", description: "",
    status: "draft", version: 1, created_at: "2026-09-06", updated_at: "2026-09-06", pages: [
      { id: "p1", title: "Overview", order_index: 0, config: {}, blocks: [
        { ...block("filter", "filter"), config: { field: "region", operator: "equals" } },
        block("chart", "chart", [{ region: "East" }, { region: "West" }]),
      ] },
      { id: "p2", title: "Details", order_index: 1, config: {}, blocks: [
        block("table", "table", [{ territory: "East", amount: "9007199254740993" },
          { territory: "West", amount: "9007199254740994" }, { territory: "East", amount: "9007199254740992" }]),
        block("unrelated", "table", [{ territory: "West" }]),
        { ...block("metric", "metric"), content: { value: "9007199254740993" } },
        { ...block("local", "filter"), config: { field: "amount", operator: "greater_than" } },
      ] },
    ] };
  let key = 0;
  let configured = configureReportFilter(report, "filter", { scope: "report" });
  configured = configureReportFilter(configured, "filter", { targetId: "chart", field: "region" }, () => `key-${++key}`);
  return configureReportFilter(configured, "filter", { targetId: "table", field: "territory" }, () => `key-${++key}`);
}

describe("connected report filters", () => {
  it("maps fields across pages, intersects local filters, and leaves unrelated cards and source rows alone", () => {
    const report = fixture();
    const before = structuredClone(report);
    const connected = connectedReportFilters(report);
    const values = { filter: "East", local: "9007199254740992" };
    const first = reportFiltersForPage(report.pages[0], values, connected);
    const second = reportFiltersForPage(report.pages[1], values, connected);
    expect(applyReportInteractions(report.pages[0].blocks[1], first, []).content.rows).toEqual([{ region: "East" }]);
    expect(applyReportInteractions(report.pages[1].blocks[0], second, []).content).toMatchObject({
      rows: [{ territory: "East", amount: "9007199254740993" }], _filter_source_rows: 3,
    });
    for (const index of [1, 2]) expect(applyReportInteractions(report.pages[1].blocks[index], second, [])).toBe(report.pages[1].blocks[index]);
    expect(reportFiltersForPage(report.pages[0], { filter: " " }, connected)).toEqual([]);
    expect(pageReportFilters(report.pages[0], values)).toEqual([]);
    expect(report).toEqual(before);
  });

  it("survives serialization and fresh entity IDs without changing target provenance or chart interaction keys", () => {
    const report = fixture();
    report.pages[1].blocks[0].source_kind = "artifact";
    report.pages[1].blocks[0].source_ref = { evidence: "original" };
    report.pages[1].blocks[0].config.interaction_key = "page-local-key";
    const original = structuredClone(report);
    const changed = configureReportFilter(report, "filter", { targetId: "table", field: "amount" });
    expect(changed.pages[1].blocks[0].source_ref).toEqual({ evidence: "original" });
    expect(changed.pages[1].blocks[0].config).toEqual(report.pages[1].blocks[0].config);
    const saved = JSON.parse(JSON.stringify(changed)) as ReportDocument;
    saved.pages.forEach((page, p) => { page.id = `saved-page-${p}`; page.blocks.forEach((item, i) => { item.id = `saved-${p}-${i}`; }); });
    const connected = connectedReportFilters(saved);
    expect(connected[0].targets.map((item) => item.block.id)).toEqual(["saved-0-1", "saved-1-0"]);
    const filters = reportFiltersForPage(saved.pages[1], { "saved-0-0": "9007199254740993" }, connected);
    expect(applyReportInteractions(saved.pages[1].blocks[0], filters, []).content.rows).toEqual([{ territory: "East", amount: "9007199254740993" }]);
    expect(report).toEqual(original);
  });

  it("ignores missing, ambiguous and unsupported connections without falling back to same-name filtering", () => {
    const report = fixture();
    const key = report.pages[1].blocks[0].config.filter_target_key;
    report.pages[0].blocks.push({ ...report.pages[1].blocks[0], id: "duplicate" });
    expect(connectedReportFilters(report)[0].targets.map((item) => item.block.id)).toEqual(["chart"]);
    expect(configureReportFilter(report, "filter", { targetId: "table", field: "territory" }, () => String(key))).toBe(report);
    report.pages[0].blocks.pop();
    report.pages[0].blocks[1].content.image_url = "chart.png";
    report.pages[1].blocks[0].content.rows = [{ missing: "East" }];
    expect(connectedReportFilters(report)[0].targets).toEqual([]);
    expect(reportFiltersForPage(report.pages[0], { filter: "East" }, connectedReportFilters(report))).toEqual([]);
    expect(configureReportFilter(report, "filter", { targetId: "metric", field: "value" })).toBe(report);
    report.pages[1].blocks[0].content.rows = [{ territory: "East" }];
    (report.pages[0].blocks[0].config.filter_targets as unknown[]).push({ key, field: "territory" }, null, { key: 5 });
    expect(connectedReportFilters(report)[0].targets).toEqual([]);
    report.pages[0].blocks = [];
    expect(connectedReportFilters(report)).toEqual([]);
  });

  it("requires explicit reconnection after changing scope and supports disconnecting one card", () => {
    let report = fixture();
    report = configureReportFilter(report, "filter", { targetId: "table", field: "" });
    expect(connectedReportFilters(report)[0].targets.map((item) => item.block.id)).toEqual(["chart"]);
    report = configureReportFilter(report, "filter", { scope: "page" });
    expect(connectedReportFilters(report)).toEqual([]);
    expect(pageReportFilters(report.pages[0], { filter: "East" })).toEqual([{ field: "region", operator: "equals", value: "East" }]);
    report = configureReportFilter(report, "filter", { scope: "report" });
    expect(connectedReportFilters(report)[0].targets).toEqual([]);
    expect(reportFiltersForPage(report.pages[0], { filter: "East" }, connectedReportFilters(report))).toEqual([]);
  });
});
