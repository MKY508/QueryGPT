import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportPropertyPanel } from "@/components/reports/ReportPropertyPanel";
import { supportsReportBlockRefresh } from "@/components/reports/ReportBlockCard";
import { applyReportBlockUpdates } from "@/lib/report-blocks";
import { metricColumnContent, metricResultColumns } from "@/lib/report-metrics";
import type { ReportBlock, ReportPage } from "@/lib/reports";
import messages from "@/messages/zh.json";

afterEach(cleanup);
const labels = messages.reportProperty;

function table(row: Record<string, unknown> = { region: "East", revenue: "9007199254740993.1200" }): ReportBlock {
  return {
    id: "block-1", block_type: "table", title: "收入", version: 1, order_index: 0,
    source_kind: "artifact", artifact_id: "artifact-1", analysis_run_id: "run-1", source_available: true,
    source_ref: { snapshot: { title: "历史收入" } },
    content: { rows: [row], rows_count: 1, sampled: false, columns: Object.keys(row) },
    config: {}, layout: { x: 0, y: 0, w: 6, h: 4 },
  };
}

function Editor({ initial }: { initial: ReportBlock }) {
  const [block, setBlock] = useState(initial);
  const page: ReportPage = { id: "page-1", title: "概览", order_index: 0, config: {}, blocks: [block] };
  return <NextIntlClientProvider locale="zh" messages={messages}>
    <ReportPropertyPanel page={page} block={block} onChangePage={vi.fn()}
      onChangeBlock={(updates) => setBlock((current) => applyReportBlockUpdates(current, updates))} />
    <button disabled={!supportsReportBlockRefresh(block)}>刷新指标</button>
  </NextIntlClientProvider>;
}

describe("source-backed scalar metrics", () => {
  it("converts a single numeric field without rounding or changing source evidence", () => {
    const source = table();
    const converted = applyReportBlockUpdates(source, { block_type: "metric" });
    expect(converted.content.value).toBe("9007199254740993.1200");
    expect(converted.source_ref).toBe(source.source_ref);
    expect(converted.artifact_id).toBe(source.artifact_id);
    expect(converted.config.metric_column).toBe("revenue");
    expect(supportsReportBlockRefresh(converted)).toBe(true);
    render(<Editor initial={source} />);
    fireEvent.change(screen.getByLabelText(labels.blockType), { target: { value: "metric" } });
    expect(screen.getByLabelText(labels.metricField)).toHaveValue("revenue");
    expect(screen.getByLabelText(labels.displayValue)).toHaveValue("9007199254740993.1200");
    expect(screen.getByLabelText(labels.displayValue)).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "刷新指标" })).toBeEnabled();
  });

  it("requires an explicit field for multiple measures and keeps manual entry static", () => {
    render(<Editor initial={table({ revenue: 120, count: 3 })} />);
    fireEvent.change(screen.getByLabelText(labels.blockType), { target: { value: "metric" } });
    const field = screen.getByLabelText(labels.metricField);
    expect(field).toHaveValue("");
    expect(screen.getByRole("button", { name: "刷新指标" })).toBeDisabled();
    fireEvent.change(field, { target: { value: "count" } });
    expect(screen.getByLabelText(labels.displayValue)).toHaveValue("3");
    expect(screen.getByRole("button", { name: "刷新指标" })).toBeEnabled();
    fireEvent.change(field, { target: { value: "" } });
    expect(screen.getByLabelText(labels.displayValue)).not.toHaveAttribute("readonly");
    expect(screen.getByLabelText(labels.displayValue)).toHaveValue("3");
    expect(screen.getByRole("button", { name: "刷新指标" })).toBeDisabled();
  });

  it("does not mistake sampled rows, identifiers, booleans or missing values for a metric", () => {
    const source = table({ code: "00123", flag: true, amount: 0, empty: null, invalid: Infinity });
    expect(metricResultColumns(source)).toEqual(["amount"]);
    for (const changes of [{ sampled: true }, { rows_count: 2 }, { rows: [{ amount: 1 }, { amount: 2 }] }]) {
      expect(metricResultColumns({ ...source, content: { ...source.content, ...changes } })).toEqual([]);
    }
    expect(metricResultColumns({ ...source, source_kind: "manual" })).toEqual([]);
    expect(metricResultColumns({ ...source, artifact_id: null,
      source_ref: { refresh_binding: { kind: "analysis_playbook" } } })).toEqual(["amount"]);
    const absent = { ...source, block_type: "metric" as const, config: { metric_column: "empty" } };
    expect(metricResultColumns(absent)).toEqual(["amount", "empty"]);
    expect(metricColumnContent(absent, "empty").value).toBeNull();
    expect(supportsReportBlockRefresh({ ...absent, config: {} })).toBe(false);
  });
});
