import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectCleaningColumns, cleaningColumnLabels } from "@/lib/cleaning-field-names";
import { VisualCleaningEditor, parseSavedVisualCleaningOperations } from "@/components/chat/VisualCleaningEditor";
import { DataWorkspacePanel } from "@/components/chat/DataWorkspacePanel";
import { CleaningSamples } from "@/components/chat/CleaningSamples";
import { CleaningImpactProfiles } from "@/components/chat/CleaningImpactProfiles";
import type { ProjectDataSource, VisualCleaningOperation, VisualCleaningPreview } from "@/lib/types/api";
import messages from "@/messages/zh.json";

const http = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ api: http }));
import { useProjectStore } from "@/lib/stores/project";

const source: ProjectDataSource = { id: "field-source", project_id: "field-project", name: "字段核对.csv", kind: "file", status: "ready", profile_data: { sample: [{ amount: "plain", " amount ": "padded" }] }, created_at: "2026-09-06", updated_at: "2026-09-06" };
const trim = (column: string): VisualCleaningOperation => ({ operation: "trim_text", column });
const preview: VisualCleaningPreview = { source_id: source.id, operations_hash: "a".repeat(64), source_fingerprint: "b".repeat(64), preview_output_fingerprint: "c".repeat(64), can_apply: true, before: { rows: 1, columns: 2, sample: [] }, after: { rows: 1, columns: 2, sample: [] }, changes: [] };
const original = useProjectStore.getState();
const wrap = (element: ReactNode) => <NextIntlClientProvider locale="zh" messages={messages}>{element}</NextIntlClientProvider>;
const response = (data: unknown) => ({ data: { data } });

beforeEach(() => {
  http.post.mockReset();
  useProjectStore.setState({ currentProjectId: source.project_id, sources: [], preflightReports: [], recipes: [], knowledge: [], cleaningAction: null, cleaningPreviewBySource: {}, sourceAction: null, error: null, refreshCurrent: vi.fn().mockResolvedValue(undefined) });
});
afterEach(() => { cleanup(); useProjectStore.setState({ currentProjectId: null, sources: [], preflightReports: [], recipes: [], cleaningAction: null, cleaningPreviewBySource: {}, refreshCurrent: original.refreshCurrent }); });

describe("cleaning field identities", () => {
  it("collects exact schema and sample names without coercing or merging lookalikes", () => {
    const row = Object.fromEntries([["amount", 1], [" amount ", 2], ["__proto__", 3], ["", 4]]);
    const columns = collectCleaningColumns([null, [], row], { columns: [null, { name: " amount " }, { name: "amount\u00a0" }, { name: " tax " }, { name: 42 }, { name: {} }, { name: "\t" }] });
    expect(columns).toEqual(["amount", " amount ", "__proto__", "amount\u00a0", " tax "]);
    expect(collectCleaningColumns("wrong shape", { columns: {} })).toEqual([]);
    const names = ["amount", " amount ", "·amount·", "amount\u00a0", 'a\t"b"', "total  cost"];
    const labels = cleaningColumnLabels(names);
    expect([...labels.values()]).toEqual(["1 · amount", "2 · ·amount·", "3 · ·amount·", "4 · amount⍽", '5 · a⇥"b"', "6 · total··cost"]);
    expect(new Set(labels.values()).size).toBe(names.length);
    expect([...labels.keys()]).toEqual(names);
    expect([...cleaningColumnLabels(["Order amount", "total"]).values()]).toEqual(["Order amount", "total"]);
  });

  it("parses saved operations without trimming names or turning distinct rules into duplicates", () => {
    const operations: VisualCleaningOperation[] = [trim("amount"), trim(" amount "), trim("amount\u00a0"), { operation: "replace_text_values", column: " amount ", replacements: [{ from_value: " A ", to_value: "B\n" }] }];
    expect(parseSavedVisualCleaningOperations({ operations })).toEqual(operations);
    render(wrap(<VisualCleaningEditor source={{ ...source, profile_data: { visual_cleaning: { operations } } }} columns={["amount", " amount ", "amount\u00a0"]} onClose={vi.fn()} />));
    expect(screen.getAllByRole("checkbox", { name: /^本次使用步骤/ })).toHaveLength(4);
    expect(screen.getByRole("button", { name: "预览变化" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("carries exact inferred names from the data panel through preview and apply while retaining imported lookalikes", async () => {
    const saved = { ...source, profile_data: { ...source.profile_data, visual_cleaning: { operations: [trim(" amount ")] } } };
    useProjectStore.setState({ sources: [saved], preflightReports: [{ id: "fields", project_id: source.project_id, data_source_id: source.id, status: "ready", summary: "", issues: [], ambiguities: [], inferred_schema: { columns: [{ name: " amount " }, { name: " tax " }] }, created_at: "2026-09-06" }], recipes: [{ id: "recipe-fields", project_id: source.project_id, data_source_id: source.id, name: "整理方法", status: "ready", operations: [trim("amount"), trim(" amount ")], created_at: "2026-09-06", updated_at: "2026-09-06" }] });
    http.post.mockResolvedValueOnce(response(preview)).mockResolvedValueOnce(response({ recipe: {}, revision: {}, preflight: {} }));
    render(wrap(<DataWorkspacePanel open onClose={vi.fn()} onConfigureConnection={vi.fn()} />));
    fireEvent.click(screen.getByRole("button", { name: "整理数据" }));
    const picker = screen.getByRole("combobox", { name: "选择要整理的列" });
    expect(within(picker).getAllByRole("option").map(option => (option as HTMLOptionElement).value)).toEqual(["amount", " amount ", " tax "]);
    expect(screen.getByText("导入时已整理")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "本次使用步骤：“2 · ·amount·” 去除首尾空格" })).toBeEnabled();
    fireEvent.change(picker, { target: { value: " tax " } });
    fireEvent.click(screen.getByRole("button", { name: /^空值填 0/ }));
    fireEvent.click(screen.getByRole("button", { name: "预览变化" }));
    fireEvent.click(await screen.findByRole("button", { name: "应用整理" }));
    await waitFor(() => expect(http.post).toHaveBeenCalledTimes(2));
    const expected = [trim(" amount "), { operation: "fill_missing", column: " tax ", value: 0 }];
    expect(http.post.mock.calls[0][1]).toEqual({ operations: expected });
    expect(http.post.mock.calls[1][1].operations).toEqual(expected);
    expect(http.post.mock.calls[1][1].expected_operations_hash).toBe(preview.operations_hash);
  });

  it("keeps replacement suggestions, editing and history attached to the selected raw name", async () => {
    const name = ' 商品\t"名称" ';
    const values = { 商品名称: "wrong", [name]: "right" };
    http.post.mockResolvedValue(response(preview));
    render(wrap(<VisualCleaningEditor source={{ ...source, profile_data: { sample: [values] } }} columns={Object.keys(values)} onClose={vi.fn()} />));
    fireEvent.change(screen.getByRole("combobox", { name: "选择要整理的列" }), { target: { value: name } });
    fireEvent.click(screen.getByRole("button", { name: "统一取值" }));
    const editor = screen.getByRole("region", { name: '统一“2 · ·商品⇥"名称"·”的文本取值' });
    expect(within(editor).queryByText("wrong")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "第 1 项原值" }), { target: { value: "right" } });
    fireEvent.change(screen.getByRole("textbox", { name: "第 1 项替换值" }), { target: { value: "新名称" } });
    fireEvent.click(screen.getByRole("button", { name: "保存这组替换" }));
    fireEvent.click(screen.getByRole("button", { name: "撤销步骤编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "重做步骤编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "预览变化" }));
    await waitFor(() => expect(http.post).toHaveBeenCalledOnce());
    expect(http.post.mock.calls[0][1]).toEqual({ operations: [{ operation: "replace_text_values", column: name, replacements: [{ from_value: "right", to_value: "新名称" }] }] });
  });

  it("uses the same distinguishable labels in samples without changing which cell expands", () => {
    const row = { " amount ": "padded-".repeat(20), "·amount·": "literal-".repeat(20) };
    const columnNames = ["amount", " amount ", "·amount·"];
    const before = { rows: 1, columns: 2, sample: [row] };
    const view = (preferredColumns: string[] = []) => wrap(<><CleaningSamples before={before} columnNames={columnNames} preferredColumns={preferredColumns} />
      <CleaningImpactProfiles preview={{ ...preview, profiles: Object.keys(row).map(column => ({ column, before: null, after: null })) }} columnNames={columnNames} /></>);
    const { rerender } = render(view());
    expect(screen.getByRole("columnheader", { name: "2 · ·amount·" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "3 · ·amount·" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开数据样本第 1 条的“3 · ·amount·”完整值" }));
    expect(screen.getByRole("heading", { name: "3 · ·amount· · 完整值" })).toHaveFocus();
    expect(screen.getByText(row["·amount·"])).toBeVisible();
    const impact = screen.getByRole("combobox", { name: messages.visualCleaning.impactTitle });
    expect(within(impact).getAllByRole("option").map(option => option.textContent)).toEqual(["2 · ·amount·", "3 · ·amount·"]);
    fireEvent.change(impact, { target: { value: "·amount·" } });
    expect(impact).toHaveValue("·amount·");
    rerender(view(["·amount·"]));
    expect(screen.queryByRole("heading", { name: /完整值/ })).not.toBeInTheDocument();
    const locator = screen.getByRole("combobox", { name: "定位字段" });
    expect(locator).toHaveValue("·amount·");
    fireEvent.change(locator, { target: { value: " amount " } });
    rerender(view(["·amount·"]));
    expect(locator).toHaveValue(" amount ");
  });
});
