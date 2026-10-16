import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceDataPreview } from "@/components/chat/SourceDataPreview";
import { DataWorkspacePanel } from "@/components/chat/DataWorkspacePanel";
import { sourcePreview } from "@/lib/source-preview";
import { useProjectStore } from "@/lib/stores/project";
import * as csv from "@/lib/csv";
import type { ProjectDataSource } from "@/lib/types/api";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

const original = useProjectStore.getState();
afterEach(() => { cleanup(); useProjectStore.setState(original, true); vi.restoreAllMocks(); });
function source(profile: ProjectDataSource["profile_data"], extra: Partial<ProjectDataSource> = {}): ProjectDataSource {
  return { id: "preview-source", project_id: "preview-project", kind: "file", name: "销售.csv", format: "csv",
    status: "ready", profile_data: profile, created_at: "2026-09-06", updated_at: "2026-09-06", ...extra };
}
function view(item: ProjectDataSource, locale = "zh") {
  return <NextIntlClientProvider locale={locale} messages={locale === "zh" ? zh : en}><SourceDataPreview source={item} /></NextIntlClientProvider>;
}
const columns = Array.from({ length: 43 }, (_, index) => ({ name: `字段${index + 1}`, dtype: "str", missing: 0 }));
const wideProfile = () => ({ schema: { rows: 128, columns }, sample: [Object.fromEntries(columns.map((field, index) => [field.name, `值${index + 1}`]))] });

describe("source data preview", () => {
  it("expands and exports only labelled sample rows, then closes the view when the preparation snapshot changes", () => {
    const show = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
    const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } },
      close: { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } },
    });
    try {
      const download = vi.spyOn(csv, "downloadCsv").mockImplementation(() => {});
      const item = source({ schema: { rows: 128, columns: [{ name: "id", dtype: "str" }, { name: "amount", dtype: "decimal128(38, 2)" }] },
        sample: Array.from({ length: 12 }, (_, index) => ({ id: String(index).padStart(18, "0"), amount: "9007199254740993.01" })) });
      const { rerender } = render(view(item));
      fireEvent.click(screen.getByRole("button", { name: zh.sourcePreview.expandSample }));
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent("销售.csv · 数据样例");
      expect(dialog).toHaveTextContent("仅包含 8 行样例。");
      expect(within(dialog).getAllByRole("row")).toHaveLength(9);
      fireEvent.click(within(dialog).getByRole("button", { name: zh.dataView.exportCsv }));
      expect(download).toHaveBeenCalledTimes(1);
      expect(download.mock.calls[0][0]).toHaveLength(8);
      expect(download.mock.calls[0][0][0]).toEqual({ id: "000000000000000000", amount: "9007199254740993.01" });
      expect(download.mock.calls[0][1]).toContain("数据样例");
      rerender(view(source({ ...item.profile_data, issues: [{ code: "recipe_input_changed" }] })));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: zh.sourcePreview.expandSample }));
      expect(screen.getByRole("dialog")).toHaveTextContent(zh.sourcePreview.changedSample);
      expect(screen.getByRole("dialog")).toHaveTextContent("仅包含 8 行样例。");
      rerender(view(source({ schema: { rows: 1, columns: [{ name: "new" }] }, sample: [{ new: "latest" }] })));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: zh.sourcePreview.expandSample }));
      expect(screen.getByRole("dialog")).toHaveTextContent("仅包含 1 行样例。");
      expect(within(screen.getByRole("dialog")).getByRole("cell", { name: "latest" })).toBeInTheDocument();
      expect(download).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
      if (show) Object.defineProperty(HTMLDialogElement.prototype, "showModal", show); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
      if (close) Object.defineProperty(HTMLDialogElement.prototype, "close", close); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
    }
  });

  it("uses only source-owned rows, preserving field identity, exact values and absent cells", () => {
    const row = JSON.parse('{"amount":"9007199254740993.01"," amount ":"0012","constructor":false,"__proto__":"literal","empty":"","zero":0,"missing":null}');
    const profile = { schema: { rows: 100, columns: [
      { name: "unseen", dtype: "str", missing: 4, examples: ["never synthesize this"] },
      { name: "amount", dtype: "decimal128(38, 8)", missing: 0 },
      { name: " amount ", dtype: "str", missing: 0 },
      { name: "date", dtype: "timestamp[us]", missing: 5 },
      { name: "bool", dtype: "bool", missing: 6 },
    ] }, sample: [row] };
    const before = structuredClone(profile), data = sourcePreview(profile);
    expect(data.totalRows).toBe(100);
    expect(data.fields.slice(0, 5).map((field) => [field.name, field.kind])).toEqual([
      ["unseen", "text"], ["amount", "number"], [" amount ", "text"], ["date", "date"], ["bool", "boolean"],
    ]);
    expect(data.rows[0]).toEqual(row);
    expect(Object.hasOwn(data.rows[0], "unseen")).toBe(false);
    expect(Object.hasOwn(data.rows[0], "__proto__")).toBe(true);
    expect(data.rows[0].__proto__).toBe("literal");
    expect(profile).toEqual(before);
    expect(sourcePreview({ schema: profile.schema }).rows).toEqual([]);
  });

  it("bounds legacy samples and fields without reading omitted cell values", () => {
    const fields = Array.from({ length: 501 }, (_, index) => ({ name: `field${index}`, dtype: "int64", missing: 0 }));
    const row = Object.fromEntries(fields.slice(0, 500).map((field) => [field.name, "9007199254740993"]));
    Object.defineProperty(row, "field500", { enumerable: true, get: () => { throw new Error("Omitted value must not be read"); } });
    const sample = Array.from({ length: 12 }, () => row);
    Object.defineProperty(sample, 9, { get: () => { throw new Error("Omitted record must not be read"); } });
    const data = sourcePreview({ schema: { rows: 1000, columns: fields }, sample });
    expect(data.rows).toHaveLength(8); expect(data.fields).toHaveLength(500);
    expect(Object.keys(data.rows[0])).toHaveLength(500);
    expect(data.limitedRows).toBe(true); expect(data.limitedFields).toBe(true);
    expect(data.rows[0].field499).toBe("9007199254740993");
  });

  it("does not infer types or full-file counts from malformed or sparse samples", () => {
    for (const value of [null, [], "invalid", { sample: {} }]) expect(sourcePreview(value).rows).toEqual([]);
    const data = sourcePreview({ schema: { rows: 2, columns: [
      null, { name: 4 }, { name: "a", dtype: "not a type", missing: 4 }, { name: "a", dtype: "str", missing: 0 },
      { name: "b", missing: -1 }, { name: "c", missing: "2" }, { name: "d", missing: Number.MAX_SAFE_INTEGER + 1 },
    ] }, sample: [null, { a: "0012" }] });
    expect(data.fields.map((field) => [field.kind, field.missing])).toEqual([["other", null], ["other", null], ["other", null], ["other", null]]);
    expect(data.rows).toEqual([{ a: "0012" }]);
    expect(sourcePreview({ schema: { rows: 0 }, sample: [{ a: 1 }] }).totalRows).toBeNull();
    expect(sourcePreview({ schema: { rows: "200" }, sample: [{ a: 1 }] }).totalRows).toBeNull();
  });

  it("opens source samples in the actual inspector, searches fields and locates a distant column without preparing data", () => {
    const profileSource = vi.fn(), reorganizeSource = vi.fn(), acceptReplacement = vi.fn();
    useProjectStore.setState({ currentProjectId: "preview-project", sources: [source(wideProfile())],
      preflightReports: [], recipes: [], recipeTemplates: [], knowledge: [], error: null, sourceAction: null,
      profileSource, reorganizeSource, acceptReplacement });
    render(<NextIntlClientProvider locale="zh" messages={zh}><DataWorkspacePanel open embedded connections={[]} onClose={vi.fn()} onConfigureConnection={vi.fn()} /></NextIntlClientProvider>);
    const preview = screen.getByRole("region", { name: zh.sourcePreview.title });
    expect(within(preview).getByText("128 行数据")).toBeInTheDocument();
    expect(within(preview).getByRole("table")).toHaveAccessibleName(zh.sourcePreview.sampleTitle);
    expect(within(preview).getAllByRole("columnheader")).toHaveLength(9);
    fireEvent.keyDown(within(preview).getByRole("tab", { name: "样例1" }), { key: "ArrowRight" });
    expect(within(preview).getByRole("tab", { name: "字段43" })).toHaveFocus();
    expect(within(preview).getByRole("status")).toHaveTextContent("显示 20 / 43 个字段");
    fireEvent.click(within(preview).getByRole("button", { name: "再显示 20 个字段" }));
    expect(within(preview).getByRole("button", { name: "查看字段样例：字段21" }).closest("tr")).toHaveFocus();
    const search = within(preview).getByRole("searchbox", { name: zh.sourcePreview.searchFields });
    fireEvent.change(search, { target: { value: "字段37" } });
    fireEvent.keyDown(search, { key: "Escape", isComposing: true, keyCode: 229 });
    expect(search).toHaveValue("字段37");
    fireEvent.click(within(preview).getByRole("button", { name: "查看字段样例：字段37" }));
    expect(within(preview).getByRole("tab", { name: "样例1" })).toHaveFocus();
    expect(within(preview).getByRole("columnheader", { name: "字段37" })).toBeInTheDocument();
    expect(within(preview).getByText("值37")).toBeInTheDocument();
    expect(profileSource).not.toHaveBeenCalled(); expect(reorganizeSource).not.toHaveBeenCalled(); expect(acceptReplacement).not.toHaveBeenCalled();
  });

  it("shows schema-only fields honestly and never pairs independent examples into fake records", () => {
    const item = source({ schema: { rows: 0, columns: [{ name: "amount", dtype: "float64", missing: 0, examples: [10, 20] }] } });
    const { rerender } = render(view(item));
    expect(screen.getByRole("tab", { name: "字段1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("cell", { name: "数值" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /查看字段样例/ })).not.toBeInTheDocument();
    expect(screen.queryByText("10")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "样例0" }));
    expect(screen.getByText(zh.sourcePreview.emptyData)).toBeInTheDocument();
    rerender(view(source({ schema: { columns: [{ name: "unseen" }] }, sample: [{ other: null }] })));
    expect(screen.getByRole("columnheader", { name: "unseen" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: zh.visualCleaning.sampleFieldAbsent })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: zh.visualCleaning.sampleMissingValue })).toBeInTheDocument();
  });

  it("labels stale samples, preserves locale browsing and discards old selections when the source snapshot changes", () => {
    const item = source({ ...wideProfile(), issues: [{ code: "recipe_input_changed" }] });
    const { rerender } = render(view(item));
    expect(screen.getByText(zh.sourcePreview.changedSample)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "字段43" }));
    fireEvent.change(screen.getByRole("searchbox", { name: zh.sourcePreview.searchFields }), { target: { value: "字段43" } });
    rerender(view(item, "en"));
    expect(screen.getByRole("searchbox", { name: en.sourcePreview.searchFields })).toHaveValue("字段43");
    expect(screen.getByText(en.sourcePreview.changedSample)).toBeInTheDocument();
    rerender(view(source({ schema: { rows: 1, columns: [{ name: "new_field" }] }, sample: [{ new_field: "fresh" }] }), "en"));
    expect(screen.getByRole("tab", { name: "Sample1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("fresh")).toBeInTheDocument();
    expect(screen.queryByText("字段43")).not.toBeInTheDocument();
    rerender(view(item));
    fireEvent.click(screen.getByRole("tab", { name: "字段43" }));
    expect(screen.getByRole("searchbox", { name: zh.sourcePreview.searchFields })).toHaveValue("");
    rerender(view(source({ sample: [{ a: "old" }] }, { status: "error" })));
    expect(screen.getByText(zh.sourcePreview.previousSample)).toBeInTheDocument();
    rerender(view(source({ sample: [{ a: "unused" }] }, { status: "attached" })));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    rerender(view(source({ sample: [{ a: "unused" }] }, { kind: "connection" })));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("keeps source preview state isolated when switching actual directory selections", () => {
    useProjectStore.setState({ currentProjectId: "preview-project", sources: [
      source(wideProfile()), source({ sample: [{ fresh: "B" }] }, { id: "other", name: "另一份.csv" }),
    ], preflightReports: [], recipes: [], recipeTemplates: [], knowledge: [], sourceAction: null, error: null });
    render(<NextIntlClientProvider locale="zh" messages={zh}><DataWorkspacePanel open embedded connections={[]} onClose={vi.fn()} onConfigureConnection={vi.fn()} /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "查看数据：销售.csv" }));
    fireEvent.click(screen.getByRole("tab", { name: "字段43" }));
    fireEvent.change(screen.getByRole("searchbox", { name: zh.sourcePreview.searchFields }), { target: { value: "字段43" } });
    fireEvent.click(screen.getByRole("button", { name: zh.sourceDirectory.nextSource }));
    expect(screen.getByRole("cell", { name: "B" })).toBeInTheDocument();
    expect(screen.queryByText("字段43")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: zh.sourceDirectory.previousSource }));
    fireEvent.click(screen.getByRole("tab", { name: "字段43" }));
    expect(screen.getByRole("searchbox", { name: zh.sourcePreview.searchFields })).toHaveValue("");
    act(() => useProjectStore.setState({ sources: [] }));
    expect(screen.queryByRole("region", { name: zh.sourcePreview.title })).not.toBeInTheDocument();
  });
});
