import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { MetricFormatSettings } from "@/components/reports/MetricFormatSettings";
import { ReportPrintView } from "@/components/reports/ReportPrintView";
import { applyReportBlockUpdates } from "@/lib/report-blocks";
import { metricDisplay, metricDisplayText, metricValue } from "@/lib/metric-display";
import type { ReportBlock, ReportDocument } from "@/lib/reports";
import messages from "@/messages/zh.json";

afterEach(cleanup);
const labels = messages.metricDisplay;
function block(value: unknown, display: Record<string, unknown> = {}): ReportBlock {
  return { id: "m1", title: "收入", block_type: "metric", order_index: 0, version: 1,
    source_kind: "artifact", source_available: true, artifact_id: "a1", analysis_run_id: "r1",
    source_ref: { refresh_receipt: { content_hash: "retained-evidence" } },
    content: { value }, config: { metric_column: "revenue", metric_display: display },
    layout: { x: 0, y: 0, w: 6, h: 4 } };
}

describe("metric display without changing data", () => {
  it("keeps exact currency rounding, percent semantics, grouping and explicit precision", () => {
    const source = block("9007199254740993.015", { style: "currency", currency: "USD", decimals: 2 });
    expect(metricDisplayText(source, "en")).toBe("$9,007,199,254,740,993.02");
    expect(source.content.value).toBe("9007199254740993.015");
    expect(metricDisplayText(block("0.125", { style: "percent", decimals: 2 }), "en")).toBe("12.50%");
    expect(metricDisplayText(block("1234.500", { style: "number", grouping: false, decimals: 3, suffix: "件" }), "zh")).toBe("1234.500 件");
    expect(metricDisplayText(block(1234.5, { style: "currency", currency: "JPY" }), "en")).toBe("¥1,235");
    expect(metricDisplayText(block("0.0000000000000000001234", { style: "number" }), "en")).toBe("0.0000000000000000001234");
  });

  it("preserves legacy prose, absent values and defaults instead of guessing units", () => {
    for (const value of ["128万元", "12%", "00123", "9007199254740993.1200"]) {
      expect(metricDisplayText(block(value), "en")).toBe(value);
    }
    expect(metricDisplayText(block("128万元", { style: "percent", suffix: "元" }), "zh")).toBe("128万元");
    expect(metricDisplayText(block(null, { style: "currency", suffix: "元" }), "zh")).toBe("—");
    expect(metricValue({ value: null, amount: 999 })).toBeNull();
    expect(metricDisplayText(block(Infinity), "en")).toBe("—");
    expect(metricDisplay({ metric_display: { style: "unknown", decimals: 1000, currency: [], grouping: "false", suffix: 1 } }))
      .toEqual({ style: "raw", decimals: null, currency: "CNY", grouping: true, suffix: "" });
  });

  it("previews config-only edits and uses the same formatted value in print/image rendering", () => {
    const initial = block("0.125");
    let current = initial;
    function Editor() {
      const [metric, setMetric] = useState(initial);
      current = metric;
      const report = { id: "report-1", project_id: "project-1", title: "经营报告", description: "", status: "draft", version: 1,
        created_at: "2026-09-06", updated_at: "2026-09-06",
        pages: [{ id: "page-1", title: "概览", order_index: 0, config: {}, blocks: [metric] }] } satisfies ReportDocument;
      return <NextIntlClientProvider locale="zh" messages={messages}>
        <MetricFormatSettings block={metric} onChange={(updates) => setMetric((previous) => applyReportBlockUpdates(previous, updates))} />
        <ReportPrintView report={report} filterValues={{}} imagePageId="page-1" />
      </NextIntlClientProvider>;
    }
    render(<Editor />);
    fireEvent.change(screen.getByLabelText(labels.format), { target: { value: "percent" } });
    fireEvent.change(screen.getByLabelText(labels.decimals), { target: { value: "2" } });
    expect(screen.getByLabelText(labels.preview)).toHaveTextContent("12.50%");
    expect(within(screen.getByTestId("report-print-view")).getByText("12.50%")).toHaveAttribute("title", "0.125");
    expect(current.content).toBe(initial.content);
    expect(current.source_ref).toBe(initial.source_ref);
    expect(current.config.metric_column).toBe("revenue");
    expect(current.config.metric_display).toMatchObject({ style: "percent", decimals: 2 });
  });
});
