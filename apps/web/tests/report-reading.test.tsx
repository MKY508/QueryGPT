import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReportBlock, ReportDocument, ReportPage } from "@/lib/reports";
import { configureCrossFilter } from "@/lib/report-interactions";
import { configureReportFilter, connectedReportFilters } from "@/lib/report-filter-connections";
import { readReportPage } from "@/lib/report-reading";
import { useReportReading } from "@/components/reports/useReportReading";
import { chartMarkSelection, renderReportSelectionDot } from "@/components/reports/report-chart-interactions";

afterEach(cleanup);

function fixture(): ReportDocument {
  const block = (id: string, block_type: ReportBlock["block_type"], content = {}): ReportBlock => ({
    id, title: id, block_type, content, config: {}, order_index: 0, source_kind: "manual",
    layout: { x: 0, y: 0, w: 6, h: 4 },
  });
  const rows = [false, null, "", "9007199254740993", "East"].map(region => ({ region, amount: 10 }));
  const makePage = (id: string): ReportPage => {
    const source = block(`${id}-chart`, "chart", { rows });
    const target = block(`${id}-table`, "table", { rows });
    const filter = { ...block(`${id}-filter`, "filter"), config: { field: "region", operator: "equals" } };
    let key = 0;
    return configureCrossFilter({ id, title: id, order_index: 0, config: {}, blocks: [source, target, filter] },
      source.id, "region", target.id, "region", () => `key-${++key}`);
  };
  return { id: "report", project_id: "project", title: "月报", description: "", status: "draft", version: 1,
    created_at: "2026-09-09", updated_at: "2026-09-09", pages: [makePage("first"), makePage("second")] };
}

describe("report reading session", () => {
  it("keeps page-local choices independent, toggles exact scalars, and never edits the document", () => {
    const document = fixture();
    const original = structuredClone(document);
    const { result, rerender } = renderHook(({ index, editing }) => useReportReading(document, document.pages[index], editing),
      { initialProps: { index: 0, editing: false } });
    const reset = result.current.reset;
    act(() => result.current.select("first-chart", false));
    expect(result.current.page?.blocks[1].block.content.rows).toEqual([{ region: false, amount: 10 }]);
    rerender({ index: 1, editing: false });
    expect(result.current.page?.selections).toEqual([]);
    act(() => result.current.select("second-chart", null));
    expect(result.current.page?.blocks[1].block.content.rows).toEqual([{ region: null, amount: 10 }]);
    act(() => result.current.select("second-chart", null));
    expect(result.current.state.selections).toHaveLength(1);
    rerender({ index: 0, editing: false });
    expect(result.current.page?.selections[0].value).toBe(false);
    act(() => result.current.select("first-chart", "9007199254740993"));
    act(() => result.current.select("first-chart", "not present"));
    expect(result.current.page?.selections[0].value).toBe("9007199254740993");
    act(() => result.current.clearSelections("second"));
    expect(result.current.state.selections).toHaveLength(1);
    act(() => result.current.clearSelections());
    rerender({ index: 0, editing: true });
    act(() => result.current.select("first-chart", "East"));
    expect(result.current.page?.blocks[0].selection).toBeUndefined();
    expect(result.current.state.selections).toEqual([]);
    expect(result.current.reset).toBe(reset);
    expect(document).toEqual(original);
  });

  it("reconnects both filter and page identities after save without changing a captured reading snapshot", () => {
    const document = fixture();
    const { result, rerender } = renderHook(({ report }) => useReportReading(report, report.pages[0], false),
      { initialProps: { report: document } });
    act(() => {
      result.current.setFilter("first-filter", "East");
      result.current.select("first-chart", "East");
    });
    const snapshot = structuredClone(result.current.state);
    const saved = structuredClone(document);
    saved.pages[0].id = "saved-page";
    for (const block of saved.pages[0].blocks) block.id = `saved-${block.id}`;
    act(() => result.current.remap(new Map([["first", "saved-page"]]),
      new Map([["first-filter", "saved-first-filter"]])));
    rerender({ report: saved });
    expect(result.current.state.filters).toEqual({ "saved-first-filter": "East" });
    expect(result.current.page?.selections[0].pageId).toBe("saved-page");
    expect(result.current.page?.blocks[1].block.content.rows).toEqual([{ region: "East", amount: 10 }]);
    act(() => result.current.reset());
    expect(result.current.state).toEqual({ filters: {}, selections: [] });
    expect(snapshot.filters).toEqual({ "first-filter": "East" });
    expect(snapshot.selections[0].pageId).toBe("first");
    expect(readReportPage(document.pages[0], snapshot, connectedReportFilters(document)).blocks[1].block.content.rows)
      .toEqual([{ region: "East", amount: 10 }]);
  });

  it("uses explicit cross-page connections and refuses ambiguous sources or values hidden by other filters", () => {
    let document = configureReportFilter(fixture(), "first-filter", { scope: "report" });
    document = configureReportFilter(document, "first-filter", { targetId: "second-chart", field: "region" }, () => "cross-page");
    const { result, rerender } = renderHook(({ report }) => useReportReading(report, report.pages[1], false),
      { initialProps: { report: document } });
    act(() => result.current.setFilter("first-filter", "East"));
    expect(result.current.page?.inheritedFilters.map(item => item.block.id)).toEqual(["first-filter"]);
    expect(result.current.page?.blocks[0].selection?.values).toEqual(["East"]);
    expect(result.current.page?.blocks[1].block.content.rows).toHaveLength(5);
    act(() => result.current.select("second-chart", false));
    expect(result.current.state.selections).toEqual([]);
    act(() => result.current.select("second-chart", "East"));
    expect(result.current.page?.blocks[1].block.content.rows).toEqual([{ region: "East", amount: 10 }]);
    const collision = structuredClone(document);
    collision.pages[1].blocks.push({ ...collision.pages[1].blocks[0], id: "ambiguous" });
    rerender({ report: collision });
    expect(result.current.page?.selections).toEqual([]);
    expect(result.current.page?.blocks[0].selection).toBeUndefined();
    expect(result.current.page?.blocks[1].block.content.rows).toHaveLength(5);
  });

  it("adapts Recharts point envelopes without substituting geometry, labels or missing values", () => {
    for (const value of [false, null, "", "9007199254740993"]) {
      expect(chartMarkSelection({ value: 9007199254740992, payload: { payload: { region: value } } }, "region")).toBe(value);
    }
    expect(chartMarkSelection({ value: 12, payload: { label: "East" } }, "region")).toBeUndefined();
    expect(chartMarkSelection({ payload: { region: Infinity } }, "region")).toBeUndefined();
    const point = { key: "point", cx: 10, cy: 20, stroke: "green", payload: { region: null } };
    const select = vi.fn();
    const outer = vi.fn();
    const view = render(<svg onClick={outer}>{renderReportSelectionDot(point, select, "blue")}</svg>);
    fireEvent.click(view.container.querySelector("circle")!);
    expect(select).toHaveBeenCalledExactlyOnceWith(point);
    expect(outer).not.toHaveBeenCalled();
    view.rerender(<svg>{renderReportSelectionDot({ cx: "10", cy: NaN }, select, "blue")}</svg>);
    expect(view.container.querySelector("circle")).toBeNull();
  });
});
