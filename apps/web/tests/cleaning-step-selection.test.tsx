import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VisualCleaningEditor } from "@/components/chat/VisualCleaningEditor";
import { activeCleaningOperations as active, cleaningOperationKey as key, createCleaningEditHistory as create, cleaningEditHistoryReducer as reduce } from "@/lib/cleaning-edit-history";
import type { ProjectDataSource, VisualCleaningOperation, VisualCleaningPreview } from "@/lib/types/api";
import messages from "@/messages/zh.json";

const http = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ api: http }));
import { useProjectStore } from "@/lib/stores/project";

const trim: VisualCleaningOperation = { operation: "trim_text", column: "渠道" };
const fill: VisualCleaningOperation = { operation: "fill_missing", column: "金额", value: 0 };
const mapping = (value = " B\t"): VisualCleaningOperation => ({ operation: "replace_text_values", column: "渠道", replacements: [{ from_value: " A\n", to_value: value }] });
const source: ProjectDataSource = { id: "selection-source", project_id: "selection-project", kind: "file", name: "门店订单.csv", status: "ready", profile_data: {}, created_at: "2026-09-06", updated_at: "2026-09-06" };
const preview: VisualCleaningPreview = { source_id: source.id, operations_hash: "a".repeat(64), source_fingerprint: "b".repeat(64), preview_output_fingerprint: "c".repeat(64), before: { rows: 1, columns: 2, sample: [] }, after: { rows: 1, columns: 2, sample: [] }, changes: [], can_apply: true };
const original = useProjectStore.getState();
const response = (data: unknown) => ({ data: { data } });
const saved = (operations: VisualCleaningOperation[]) => ({ ...source, profile_data: { visual_cleaning: { operations } } });
const onClose = vi.fn();
const view = (value = source) => <NextIntlClientProvider locale="zh" messages={messages}><VisualCleaningEditor source={value} columns={["渠道", "金额"]} recipeOperations={[{ operation: "drop_empty_rows" }]} onClose={onClose} /></NextIntlClientProvider>;
const included = () => screen.getAllByRole("checkbox", { name: /^本次使用步骤：/ });

beforeEach(() => {
  http.post.mockReset(); onClose.mockReset();
  useProjectStore.setState({ currentProjectId: source.project_id, cleaningAction: null, cleaningPreviewBySource: {}, error: null, refreshCurrent: vi.fn().mockResolvedValue(undefined) });
});
afterEach(() => { cleanup(); useProjectStore.setState({ cleaningAction: null, cleaningPreviewBySource: {}, refreshCurrent: original.refreshCurrent }); });

describe("cleaning step selection", () => {
  it("owns reversible skip state, retains exact edits, and forgets removed keys only on the new branch", () => {
    const initial = create([trim, mapping()]);
    const skipped = reduce(initial, { type: "toggle", key: key(mapping()) });
    expect(active(skipped.present)).toEqual([trim]);
    expect(skipped.present.operations).toEqual(initial.present.operations);
    expect(Object.isFrozen(skipped.present.skippedKeys)).toBe(true);
    expect(skipped.present.weight).toBeGreaterThan(initial.present.weight);
    expect(reduce(skipped, { type: "toggle", key: "missing" })).toBe(skipped);
    const undone = reduce(skipped, { type: "undo" });
    expect(active(undone.present)).toEqual([trim, mapping()]);
    expect(reduce(undone, { type: "record", operations: [trim, mapping()] })).toBe(undone);
    expect(reduce(undone, { type: "redo" }).present).toBe(skipped.present);
    const edited = reduce(skipped, { type: "record", operations: [trim, mapping("新名称\n")] });
    expect(active(edited.present)).toEqual([trim]);
    expect(edited.present.operations[1]).toEqual(mapping("新名称\n"));
    const removed = reduce(edited, { type: "record", operations: [trim] });
    expect(removed.present.skippedKeys).toEqual([]);
    expect(reduce(removed, { type: "undo" }).present).toBe(edited.present);
    const readded = reduce(removed, { type: "record", operations: [trim, mapping()] });
    expect(active(readded.present)).toEqual([trim, mapping()]);
    expect(reduce(undone, { type: "toggle", key: key(trim) }).future).toEqual([]);
  });

  it("keeps unchecked drafts visible, supports checkbox keyboard undo, and locks or resets in the right session", () => {
    const { rerender } = render(view());
    fireEvent.click(screen.getByRole("button", { name: /^去除首尾空格/ }));
    fireEvent.click(included()[0]);
    expect(included()[0]).not.toBeChecked();
    expect(screen.getByRole("button", { name: /移除整理步骤/ })).toBeInTheDocument();
    expect(screen.getByText("勾选需要使用的步骤后预览。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "预览变化" })).not.toBeInTheDocument();
    fireEvent.keyDown(included()[0], { key: "z", metaKey: true });
    expect(included()[0]).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "重做步骤编辑" }));
    expect(included()[0]).not.toBeChecked();
    expect(screen.getByText("导入时已整理")).toBeInTheDocument();
    rerender(view({ ...source, profile_data: {} }));
    expect(included()[0]).not.toBeChecked();
    act(() => useProjectStore.setState({ cleaningAction: { sourceId: source.id, kind: "preview" } }));
    expect(included()[0]).toBeDisabled();
    fireEvent.click(included()[0]);
    expect(included()[0]).not.toBeChecked();
    act(() => useProjectStore.setState({ cleaningAction: null }));
    rerender(view({ ...source, profile_data: { visual_cleaning: { operations: [{ operation: "future_transform" }] } } }));
    expect(included()[0]).toBeDisabled();
    rerender(view({ ...saved([trim]), id: "new-source" }));
    expect(included()[0]).toBeChecked();
    expect(screen.getByRole("button", { name: "撤销步骤编辑" })).toBeDisabled();
    expect(http.post).not.toHaveBeenCalled();
  });

  it("previews and applies only included operations with the original receipts after returning to edit", async () => {
    let finish!: (value: unknown) => void;
    http.post.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    http.post.mockResolvedValueOnce(response(preview)).mockResolvedValueOnce(response({ recipe: {}, revision: {}, preflight: {} }));
    render(view(saved([trim, fill, mapping()])));
    fireEvent.click(included()[2]);
    fireEvent.click(screen.getByRole("button", { name: "预览变化" }));
    expect(included().every(checkbox => checkbox.hasAttribute("disabled"))).toBe(true);
    expect(http.post.mock.calls[0][1]).toEqual({ operations: [trim, fill] });
    await act(async () => finish(response(preview)));
    expect(screen.getByText("跳过的 1 步不会应用或保存。")).toBeInTheDocument();
    fireEvent.click(screen.getByText("本次保留的整理 · 3 步", { selector: "summary" }));
    const kept = screen.getByText("本次保留的整理 · 3 步", { selector: "summary" }).closest("details")!;
    expect(within(kept).getByText("“金额” 空值填 0")).toBeVisible();
    expect(within(kept).queryByText(/统一文本取值/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回修改" }));
    expect(included()[2]).not.toBeChecked();
    expect(useProjectStore.getState().cleaningPreviewBySource[source.id]).toBeUndefined();
    fireEvent.click(included()[0]);
    fireEvent.click(screen.getByRole("button", { name: "预览变化" }));
    fireEvent.click(await screen.findByRole("button", { name: "应用整理" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(http.post.mock.calls[1][1]).toEqual({ operations: [fill] });
    expect(http.post.mock.calls[2][1]).toEqual({ operations: [fill], expected_operations_hash: preview.operations_hash, expected_source_fingerprint: preview.source_fingerprint, expected_preview_output_fingerprint: preview.preview_output_fingerprint, expected_current_working_fingerprint: null, expected_current_recipe_active_revision_id: null });
  });

  it("requires review before removing all saved manual steps and preserves imported preparation", async () => {
    http.post.mockResolvedValueOnce(response(preview)).mockResolvedValueOnce(response({ recipe: {}, revision: {}, preflight: {} }));
    render(view(saved([trim])));
    fireEvent.click(included()[0]);
    fireEvent.click(screen.getByRole("button", { name: "预览变化" }));
    const apply = await screen.findByRole("button", { name: "应用整理" });
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post.mock.calls[0][1]).toEqual({ operations: [] });
    fireEvent.click(screen.getByText("本次保留的整理 · 1 步", { selector: "summary" }));
    expect(screen.getByText("本次不保留手动整理步骤，导入时的整理不受影响。")).toBeVisible();
    expect(screen.getByText("导入时已整理")).toBeVisible();
    fireEvent.click(apply);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(http.post.mock.calls[1][1].operations).toEqual([]);
  });

  it("keeps a skipped mapping excluded while editing and restores its exact saved text", () => {
    render(view(saved([trim, mapping()])));
    fireEvent.click(included()[1]);
    fireEvent.click(screen.getByRole("button", { name: "编辑“渠道”的取值替换" }));
    expect(included().every(checkbox => checkbox.hasAttribute("disabled"))).toBe(true);
    expect(screen.getByRole("textbox", { name: "第 1 项原值" })).toHaveValue(" A\n");
    fireEvent.change(screen.getByRole("textbox", { name: "第 1 项替换值" }), { target: { value: "C\n" } });
    fireEvent.click(screen.getByRole("button", { name: "保存这组替换" }));
    expect(included()[1]).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "撤销步骤编辑" }));
    expect(included()[1]).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "编辑“渠道”的取值替换" }));
    expect(screen.getByRole("textbox", { name: "第 1 项替换值" })).toHaveValue(" B\t");
    fireEvent.click(screen.getByRole("button", { name: "取消编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "撤销步骤编辑" }));
    expect(included()[1]).toBeChecked();
    expect(http.post).not.toHaveBeenCalled();
  });
});
