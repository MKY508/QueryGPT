import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CleaningImpactProfiles, cleaningChangedCells } from "@/components/chat/CleaningImpactProfiles";
import { VisualCleaningEditor } from "@/components/chat/VisualCleaningEditor";
import { useProjectStore } from "@/lib/stores/project";
import type { ProjectDataSource, VisualCleaningColumnProfile, VisualCleaningPreview } from "@/lib/types/api";
import messages from "@/messages/zh.json";
import enMessages from "@/messages/en.json";

const numeric: VisualCleaningColumnProfile = {
  kind: "number", rows: 2000, null_count: 500, zero_count: 0, blank_count: null,
  non_finite_count: null, minimum: "9007199254740993.01", maximum: "9007199254740994.02",
  sample_rows: 1000, omitted_long_values: 0,
  top_values: [{ value: "9007199254740993.01", count: 500 }],
};
const preview: VisualCleaningPreview = {
  source_id: "source-impact", operations_hash: "a".repeat(64), source_fingerprint: "b".repeat(64),
  preview_output_fingerprint: "c".repeat(64), can_apply: true,
  before: { rows: 2000, columns: 3, sample: [] }, after: { rows: 2000, columns: 3, sample: [] },
  changes: [{ column: "amount", changed_count: 500 }], comparison_basis: "position",
  profiles: [
    { column: "amount", before: numeric, after: { ...numeric, null_count: 0, zero_count: 500, minimum: "0.00" } },
    { column: "name", before: { ...numeric, kind: "text", zero_count: null, blank_count: 12, minimum: null, maximum: null, omitted_long_values: 4, top_values: [{ value: " ", count: 12 }] }, after: null },
  ],
  profiles_omitted: 1,
};

afterEach(() => {
  cleanup();
  useProjectStore.setState({ cleaningPreviewBySource: {}, cleaningAction: null });
});

describe("cleaning column impact", () => {
  it("does not mistake omitted comparisons for measured zero, including older responses", () => {
    expect(cleaningChangedCells(preview)).toBe(500);
    expect(cleaningChangedCells({ ...preview, changes: [{ column: "amount", changed_count: 0 }] })).toBe(0);
    expect(cleaningChangedCells({ ...preview, changes: [], comparison_basis: undefined })).toBeNull();
    expect(cleaningChangedCells({ ...preview, comparison_basis: "unavailable" })).toBeNull();
    expect(cleaningChangedCells({ ...preview, after: { ...preview.after, rows: 1000 } })).toBeNull();
  });

  it("shows exact ranges, separate counters and explicitly scoped frequencies, with column switching", () => {
    render(<NextIntlClientProvider locale="zh" messages={messages}><CleaningImpactProfiles preview={preview} /></NextIntlClientProvider>);
    const table = screen.getByRole("table", { name: "字段整理前后对照" });
    expect(within(table).getByRole("row", { name: /^缺失值/ })).toHaveTextContent("500");
    expect(within(table).getByRole("row", { name: /零值/ })).toHaveTextContent("500");
    expect(within(table).getByRole("row", { name: /取值范围/ })).toHaveTextContent("9007199254740993.01");
    expect(within(table).getByRole("row", { name: /取值范围/ })).toHaveTextContent("0.00");
    expect(screen.getAllByText(/仅统计前 1,000 行/)).toHaveLength(2);
    expect(screen.getByText(/另有 1 列未展示字段统计/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "字段影响" }), { target: { value: "name" } });
    expect(screen.getByRole("row", { name: /空白文本/ })).toHaveTextContent("12");
    expect(screen.getByText("无此字段")).toBeInTheDocument();
    expect(screen.getByText(/另有 4 项长文本/)).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /取值范围/ })).not.toBeInTheDocument();
    expect(screen.queryByText(preview.operations_hash)).not.toBeInTheDocument();
  });

  it("falls back to an available column on a new preview and tolerates older previews", () => {
    const view = (value: VisualCleaningPreview) => <NextIntlClientProvider locale="en" messages={enMessages}><CleaningImpactProfiles preview={value} /></NextIntlClientProvider>;
    const { rerender } = render(view(preview));
    fireEvent.change(screen.getByRole("combobox", { name: "Column impact" }), { target: { value: "name" } });
    rerender(view({ ...preview, profiles: [preview.profiles![0]] }));
    expect(screen.getByRole("combobox", { name: "Column impact" })).toHaveValue("amount");
    expect(screen.getAllByText(/First 1,000 rows only/)).toHaveLength(2);
    rerender(view(preview));
    expect(screen.getByRole("combobox", { name: "Column impact" })).toHaveValue("amount");
    fireEvent.change(screen.getByRole("combobox", { name: "Column impact" }), { target: { value: "name" } });
    rerender(view({ ...preview, source_id: "another-source" }));
    expect(screen.getByRole("combobox", { name: "Column impact" })).toHaveValue("amount");
    rerender(view({ ...preview, profiles: undefined }));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders an unavailable positional comparison without a zero-change claim in the editor", () => {
    const source: ProjectDataSource = {
      id: preview.source_id, project_id: "project-impact", kind: "file", name: "orders.csv",
      format: "csv", status: "ready", profile_data: {}, created_at: "2026-09-06", updated_at: "2026-09-06",
    };
    render(<NextIntlClientProvider locale="zh" messages={messages}><VisualCleaningEditor source={source} columns={["amount"]} onClose={vi.fn()} /></NextIntlClientProvider>);
    act(() => useProjectStore.setState({ cleaningPreviewBySource: {
      [source.id]: { ...preview, changes: [], comparison_basis: "unavailable", after: { ...preview.after, rows: 1000 } },
    } }));
    const region = screen.getByRole("region", { name: messages.visualCleaning.previewAria });
    expect(region).toHaveTextContent(messages.visualCleaning.previewCellCountUnavailable);
    expect(region).not.toHaveTextContent("0 个单元格会变化");
    expect(within(region).getByRole("table", { name: "字段整理前后对照" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "应用整理" })).toBeInTheDocument();
  });
});
