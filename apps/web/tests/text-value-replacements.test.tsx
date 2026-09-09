import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VisualCleaningEditor, parseSavedVisualCleaningOperations } from "@/components/chat/VisualCleaningEditor";
import { copyTextReplacements, textReplacementError } from "@/lib/text-value-replacements";
import { useProjectStore } from "@/lib/stores/project";
import type { ProjectDataSource, VisualCleaningOperation, VisualCleaningPreview } from "@/lib/types/api";
import messages from "@/messages/zh.json";
import enMessages from "@/messages/en.json";

const rule = { operation: "replace_text_values", column: "channel", replacements: [{ from_value: "A", to_value: "B" }, { from_value: "B", to_value: "C" }] } as const;
const mutableRule = () => ({ ...rule, replacements: rule.replacements.map((item) => ({ ...item })) });
const source: ProjectDataSource = { id: "replace-source", project_id: "replace-project", kind: "file", name: "orders.csv", format: "csv", status: "ready", profile_data: { sample: [{ channel: "A", id: 1 }] }, created_at: "2026-09-06", updated_at: "2026-09-06" };
const preview: VisualCleaningPreview = { source_id: source.id, operations_hash: "a".repeat(64), source_fingerprint: "b".repeat(64), preview_output_fingerprint: "c".repeat(64), before: { rows: 3, columns: 1, sample: [{ channel: "A" }] }, after: { rows: 3, columns: 1, sample: [{ channel: "B" }] }, changes: [{ column: "channel", changed_count: 2 }], comparison_basis: "position", can_apply: true };
const original = useProjectStore.getState();

afterEach(() => {
  cleanup();
  useProjectStore.setState({ previewSourceCleaning: original.previewSourceCleaning, applySourceCleaning: original.applySourceCleaning, clearSourceCleaningPreview: original.clearSourceCleaningPreview, cleaningPreviewBySource: {}, cleaningAction: null });
});

describe("text value replacements", () => {
  it("preserves exact text and rejects lossy or ambiguous saved mappings", () => {
    const pairs = [{ from_value: "  A\n", to_value: "" }, { from_value: "", to_value: "😺".repeat(1000) }];
    expect(textReplacementError(pairs)).toBeNull();
    expect(copyTextReplacements(pairs)).toEqual(pairs);
    expect(copyTextReplacements(pairs)?.[0]).not.toBe(pairs[0]);
    expect(textReplacementError([...pairs, pairs[0]])).toBe("duplicate");
    expect(textReplacementError([{ from_value: "A", to_value: "A" }])).toBe("same");
    expect(textReplacementError([{ from_value: "A", to_value: "B", regex: true }])).toBe("invalid");
    expect(textReplacementError([{ from_value: "A", to_value: "\0" }])).toBe("invalid");
    expect(textReplacementError(Array.from({ length: 101 }, (_, index) => ({ from_value: String(index), to_value: "x" })))).toBe("limit");
    expect(parseSavedVisualCleaningOperations({ operations: [mutableRule()] })).toEqual([mutableRule()]);
    expect(parseSavedVisualCleaningOperations({ operations: [{ ...mutableRule(), case_sensitive: false }] })).toEqual([]);
    expect(parseSavedVisualCleaningOperations({ operations: [{ ...mutableRule(), contract_version: 2 }] })).toEqual([]);
  });

  it("creates and edits a mapping without sending until preview and explicit apply", async () => {
    const previewSourceCleaning = vi.fn(async (_id: string, _operations: VisualCleaningOperation[]) => {
      act(() => useProjectStore.setState({ cleaningPreviewBySource: { [source.id]: preview } }));
      return preview;
    });
    const applySourceCleaning = vi.fn().mockResolvedValue({});
    useProjectStore.setState({ previewSourceCleaning, applySourceCleaning, cleaningPreviewBySource: {} });
    const onClose = vi.fn();
    render(<NextIntlClientProvider locale="zh" messages={messages}><VisualCleaningEditor source={source} columns={["channel"]} onClose={onClose} /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "统一取值" }));
    fireEvent.change(screen.getByRole("textbox", { name: "第 1 项原值" }), { target: { value: "A" } });
    fireEvent.change(screen.getByRole("textbox", { name: "第 1 项替换值" }), { target: { value: "B" } });
    fireEvent.click(screen.getByRole("button", { name: "添加一项" }));
    fireEvent.change(screen.getByRole("textbox", { name: "第 2 项原值" }), { target: { value: "A" } });
    fireEvent.change(screen.getByRole("textbox", { name: "第 2 项替换值" }), { target: { value: "C" } });
    fireEvent.click(screen.getByRole("button", { name: "保存这组替换" }));
    expect(screen.getByRole("alert")).toHaveTextContent(messages.visualCleaning.replacementError.duplicate);
    fireEvent.change(screen.getByRole("textbox", { name: "第 2 项原值" }), { target: { value: "B" } });
    fireEvent.click(screen.getByRole("button", { name: "保存这组替换" }));
    expect(previewSourceCleaning).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "预览变化" }));
    await waitFor(() => expect(previewSourceCleaning).toHaveBeenCalledWith(source.id, [mutableRule()]));
    expect(applySourceCleaning).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "返回修改" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑“channel”的取值替换" }));
    expect(screen.queryByRole("button", { name: "应用整理" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "第 1 项替换值" })).toHaveValue("B");
    fireEvent.change(screen.getByRole("textbox", { name: "第 1 项替换值" }), { target: { value: "new\nname" } });
    fireEvent.click(screen.getByRole("button", { name: "取消编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑“channel”的取值替换" }));
    expect(screen.getByRole("textbox", { name: "第 1 项替换值" })).toHaveValue("B");
    fireEvent.change(screen.getByRole("textbox", { name: "第 1 项替换值" }), { target: { value: "new\nname" } });
    fireEvent.click(screen.getByRole("button", { name: "保存这组替换" }));
    fireEvent.click(screen.getByRole("button", { name: "预览变化" }));
    await screen.findByRole("button", { name: "应用整理" });
    fireEvent.click(screen.getByRole("button", { name: "应用整理" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(applySourceCleaning).toHaveBeenCalledWith(source.id, [{ ...mutableRule(), replacements: [{ from_value: "A", to_value: "new\nname" }, { from_value: "B", to_value: "C" }] }]);
  });

  it("can remove a saved mapping while preserving unrelated imported steps", async () => {
    const saved = { ...source, profile_data: { ...source.profile_data, visual_cleaning: { operations: [mutableRule()] } } };
    const previewSourceCleaning = vi.fn().mockResolvedValue(preview);
    useProjectStore.setState({ previewSourceCleaning, cleaningPreviewBySource: {} });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><VisualCleaningEditor source={saved} columns={["channel"]} recipeOperations={[{ operation: "trim_text", column: "channel" }, mutableRule()]} onClose={vi.fn()} /></NextIntlClientProvider>);
    expect(screen.getByRole("button", { name: "Edit replacements in “channel”" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Remove cleaning step:.*replace text values/ }));
    expect(screen.getByText(/trim/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: enMessages.visualCleaning.previewChanges }));
    await waitFor(() => expect(previewSourceCleaning).toHaveBeenCalledWith(source.id, []));
  });

  it("keeps future mapping semantics locked instead of silently discarding them", () => {
    const saved = { ...source, profile_data: { visual_cleaning: { operations: [{ ...mutableRule(), case_sensitive: false }] } } };
    render(<NextIntlClientProvider locale="zh" messages={messages}><VisualCleaningEditor source={saved} columns={["channel"]} onClose={vi.fn()} /></NextIntlClientProvider>);
    expect(screen.getByRole("alert")).toHaveTextContent(messages.visualCleaning.readonlyNotice);
    expect(screen.getByRole("button", { name: "统一取值" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "预览变化" })).not.toBeInTheDocument();
  });
});
