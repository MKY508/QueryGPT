import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleaningEditHistoryReducer as reduce, createCleaningEditHistory as create, createCleaningHistoryReducer } from "@/lib/cleaning-edit-history";
import { VisualCleaningEditor } from "@/components/chat/VisualCleaningEditor";
import { useProjectStore } from "@/lib/stores/project";
import type { ProjectDataSource, VisualCleaningOperation, VisualCleaningPreview } from "@/lib/types/api";
import zh from "@/messages/zh.json";

const trim: VisualCleaningOperation = { operation: "trim_text", column: "渠道" };
const mapping = (value: string): VisualCleaningOperation => ({ operation: "replace_text_values", column: "渠道", replacements: [{ from_value: " A\n", to_value: value }] });
const source: ProjectDataSource = { id: "history-source", project_id: "history-project", kind: "file", name: "门店订单.csv", status: "ready", profile_data: {}, created_at: "2026-09-06", updated_at: "2026-09-06" };
const preview: VisualCleaningPreview = { source_id: source.id, operations_hash: "a".repeat(64), source_fingerprint: "b".repeat(64), preview_output_fingerprint: "c".repeat(64), can_apply: true, before: { rows: 1, columns: 1, sample: [] }, after: { rows: 1, columns: 1, sample: [] }, changes: [] };
const original = useProjectStore.getState();
const renderEditor = (value = source) => <NextIntlClientProvider locale="zh" messages={zh}><VisualCleaningEditor source={value} columns={["渠道"]} recipeOperations={[{ operation: "clean_column_names" }]} onClose={vi.fn()} /></NextIntlClientProvider>;
const undo = () => screen.getByRole("button", { name: "撤销步骤编辑" });
const redo = () => screen.getByRole("button", { name: "重做步骤编辑" });
const stepButtons = () => screen.queryAllByRole("button", { name: /移除整理步骤/ });

afterEach(() => {
  cleanup();
  useProjectStore.setState({ cleaningPreviewBySource: {}, cleaningAction: null, previewSourceCleaning: original.previewSourceCleaning, applySourceCleaning: original.applySourceCleaning });
});

describe("cleaning edit history", () => {
  it("owns immutable snapshots and restores exact mapping values and operation order", () => {
    const input = [mapping(" B\t")];
    const first = create(input);
    if (input[0].operation === "replace_text_values") input[0].replacements[0].to_value = "mutated";
    const second = reduce(first, { type: "record", operations: [...first.present.operations, trim] });
    expect(second.present.operations.map(step => step.operation)).toEqual(["trim_text", "replace_text_values"]);
    const back = reduce(second, { type: "undo" });
    expect(back.present.operations).toEqual([mapping(" B\t")]);
    expect(back.present).toBe(first.present);
    expect(Object.isFrozen(back.present.operations)).toBe(true);
    const rule = back.present.operations[0];
    expect(rule.operation === "replace_text_values" && Object.isFrozen(rule.replacements[0])).toBe(true);
    expect(reduce(back, { type: "redo" }).present).toBe(second.present);
    expect(first.past).toEqual([]);
    expect(first.future).toEqual([]);
  });

  it("preserves redo on a semantic no-op and abandons it only for a new branch", () => {
    const first = create([trim]);
    const added = reduce(first, { type: "record", operations: [trim, mapping("B")] });
    const undone = reduce(added, { type: "undo" });
    expect(reduce(undone, { type: "record", operations: [{ column: "渠道", operation: "trim_text" }] })).toBe(undone);
    const branch = reduce(undone, { type: "record", operations: [trim, mapping("B ")] });
    expect(branch.future).toHaveLength(0);
    expect(reduce(branch, { type: "redo" })).toBe(branch);
    expect(reduce(first, { type: "undo" })).toBe(first);
  });

  it("bounds both directions by depth and payload weight without losing the current edit", () => {
    let history = create([]);
    for (let index = 0; index < 70; index++) history = reduce(history, { type: "record", operations: [mapping(String(index))] });
    expect(history.past).toHaveLength(50);
    const limits = { depth: 3, weight: 500 };
    const reduceLimited = createCleaningHistoryReducer(limits);
    for (let index = 0; index < 20; index++) {
      history = reduceLimited(history, { type: index % 2 ? "redo" : "undo" });
      expect(history.past.length + history.future.length).toBeLessThanOrEqual(3);
      expect([...history.past, ...history.future].reduce((sum, item) => sum + item.weight, 0)).toBeLessThanOrEqual(500);
      expect(history.present.operations).toHaveLength(1);
    }
    const large = create([mapping("x".repeat(1000))]);
    const next = reduceLimited(large, { type: "record", operations: [trim] });
    expect(next.past).toHaveLength(0);
    expect(next.present.operations).toEqual([trim]);
  });

  it("supports button and keyboard history without modifying imported steps or submitting requests", () => {
    const previewSourceCleaning = vi.fn(); const applySourceCleaning = vi.fn();
    useProjectStore.setState({ cleaningPreviewBySource: {}, cleaningAction: null, previewSourceCleaning, applySourceCleaning });
    render(renderEditor());
    expect(undo()).toBeDisabled(); expect(redo()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^去除首尾空格/ }));
    fireEvent.click(screen.getByRole("button", { name: /^空值填 0/ }));
    fireEvent.click(stepButtons()[0]);
    expect(stepButtons()).toHaveLength(1);
    fireEvent.click(undo());
    expect(stepButtons()).toHaveLength(2);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "z", metaKey: true });
    expect(stepButtons()).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "y", ctrlKey: true });
    expect(stepButtons()).toHaveLength(2);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Z", metaKey: true, shiftKey: true });
    expect(stepButtons()).toHaveLength(1);
    expect(screen.getByText("导入时已整理")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "z", ctrlKey: true, isComposing: true });
    expect(stepButtons()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "移除完全重复行" }));
    expect(redo()).toBeDisabled();
    expect(previewSourceCleaning).not.toHaveBeenCalled();
    expect(applySourceCleaning).not.toHaveBeenCalled();
  });

  it("keeps native text undo in replacement drafts and records only confirmed mapping edits", () => {
    const saved = { ...source, profile_data: { visual_cleaning: { operations: [mapping("B")] } } };
    render(renderEditor(saved));
    fireEvent.click(stepButtons()[0]);
    fireEvent.click(undo());
    expect(redo()).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "编辑“渠道”的取值替换" }));
    expect(undo()).toBeDisabled(); expect(redo()).toBeDisabled();
    const field = screen.getByRole("textbox", { name: "第 1 项替换值" });
    fireEvent.change(field, { target: { value: "未保存的文字" } });
    const event = new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true, cancelable: true });
    fireEvent(field, event);
    expect(event.defaultPrevented).toBe(false);
    expect(stepButtons()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "取消编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(redo()).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "编辑“渠道”的取值替换" }));
    expect(screen.getByRole("textbox", { name: "第 1 项替换值" })).toHaveValue("B");
    fireEvent.click(screen.getByRole("button", { name: "保存这组替换" }));
    expect(redo()).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "编辑“渠道”的取值替换" }));
    fireEvent.change(screen.getByRole("textbox", { name: "第 1 项替换值" }), { target: { value: "新名称" } });
    fireEvent.click(screen.getByRole("button", { name: "保存这组替换" }));
    expect(redo()).toBeDisabled();
    fireEvent.click(undo());
    fireEvent.click(screen.getByRole("button", { name: "编辑“渠道”的取值替换" }));
    expect(screen.getByRole("textbox", { name: "第 1 项替换值" })).toHaveValue("B");
  });

  it("freezes history during preview, retains it after return, and clears it for a new source", async () => {
    let finish!: () => void;
    const previewSourceCleaning = vi.fn(async () => {
      useProjectStore.setState({ cleaningAction: { sourceId: source.id, kind: "preview" } });
      await new Promise<void>(resolve => { finish = resolve; });
      useProjectStore.setState({ cleaningAction: null, cleaningPreviewBySource: { [source.id]: preview } });
      return preview;
    });
    useProjectStore.setState({ cleaningPreviewBySource: {}, cleaningAction: null, previewSourceCleaning });
    const { rerender } = render(renderEditor());
    fireEvent.click(screen.getByRole("button", { name: /^去除首尾空格/ }));
    fireEvent.click(screen.getByRole("button", { name: /^空值填 0/ }));
    fireEvent.click(screen.getByRole("button", { name: "预览变化" }));
    expect(undo()).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "z", ctrlKey: true });
    expect(stepButtons()).toHaveLength(2);
    await act(async () => finish());
    await screen.findByRole("button", { name: "应用整理" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "z", ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: "返回修改" }));
    expect(stepButtons()).toHaveLength(2);
    fireEvent.click(undo());
    expect(stepButtons()).toHaveLength(1);
    expect(useProjectStore.getState().cleaningPreviewBySource[source.id]).toBeUndefined();
    rerender(renderEditor({ ...source, profile_data: {} }));
    expect(redo()).toBeEnabled();
    rerender(renderEditor({ ...source, profile_data: { visual_cleaning: { operations: [{ operation: "future_transform" }] } } }));
    expect(undo()).toBeDisabled(); expect(redo()).toBeDisabled();
    rerender(renderEditor({ ...source, id: "new-source" }));
    await waitFor(() => expect(undo()).toBeDisabled());
    expect(redo()).toBeDisabled();
    expect(stepButtons()).toHaveLength(0);
    expect(previewSourceCleaning).toHaveBeenCalledTimes(1);
  });
});
