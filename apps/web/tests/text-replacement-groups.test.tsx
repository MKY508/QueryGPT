import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TextValueReplacementEditor } from "@/components/chat/TextValueReplacementEditor";
import { VisualCleaningEditor } from "@/components/chat/VisualCleaningEditor";
import { isTextReplacementValue, sampleTextReplacementValues, textReplacementGroup } from "@/lib/text-value-replacements";
import type { ProjectDataSource, TextValueReplacement, VisualCleaningPreview } from "@/lib/types/api";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

const http = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ api: http }));
import { useProjectStore } from "@/lib/stores/project";
const original = useProjectStore.getState();
const source: ProjectDataSource = { id: "group-source", project_id: "group-project", kind: "file", name: "订单.csv", status: "ready",
  profile_data: { sample: ["A", " A ", "A\t", "B"].map(value => ({ " 渠道 ": value })) }, created_at: "2026-09-06", updated_at: "2026-09-06" };
const preview: VisualCleaningPreview = { source_id: source.id, operations_hash: "a".repeat(64), source_fingerprint: "b".repeat(64),
  preview_output_fingerprint: "c".repeat(64), before: { rows: 4, columns: 1, sample: source.profile_data.sample! }, after: { rows: 4, columns: 1, sample: [{ " 渠道 ": "A" }] },
  changes: [{ column: " 渠道 ", changed_count: 2 }], comparison_basis: "position", can_apply: true };
const response = (data: unknown) => ({ data: { data } });
const select = (number: number) => fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(`^选择第 ${number} 项样例：`) }));
const sampleTab = () => screen.getByRole("tab", { name: zh.visualCleaning.replacementSampleMode });
const manualTab = () => screen.getByRole("tab", { name: zh.visualCleaning.replacementManualMode });
const add = () => fireEvent.click(screen.getByRole("button", { name: zh.visualCleaning.groupAdd }));
const target = (value: string) => fireEvent.change(screen.getByRole("textbox", { name: zh.visualCleaning.groupTarget }), { target: { value } });
const view = (onSave = vi.fn(), initial: TextValueReplacement[] = [], values = ["A", " A ", "A\t", "B"], available = 100, disabled = false) =>
  <NextIntlClientProvider locale="zh" messages={zh}><TextValueReplacementEditor column=" 渠道 " initial={initial} suggestions={values} available={available}
    disabled={disabled} onSave={onSave} onCancel={vi.fn()} /></NextIntlClientProvider>;
beforeEach(() => {
  http.post.mockReset(); http.get.mockReset(); document.documentElement.lang = "zh";
  useProjectStore.setState({ currentProjectId: source.project_id, cleaningAction: null, cleaningPreviewBySource: {}, error: null, refreshCurrent: vi.fn().mockResolvedValue(undefined) });
});
afterEach(() => { cleanup(); useProjectStore.setState(original, true); vi.restoreAllMocks(); });

describe("sample-driven text replacement groups", () => {
  it("takes bounded exact string samples without normalizing empties, whitespace, case or long Unicode", () => {
    const values: unknown[] = ["", " A ", "A", "a", "A\t", null, "bad\0", "😺".repeat(1000)];
    Object.defineProperty(values, 8, { get: () => { throw new Error("Do not read beyond the sample window"); } });
    expect(sampleTextReplacementValues(values)).toEqual(["", " A ", "A", "a", "A\t", "😺".repeat(1000)]);
    expect(sampleTextReplacementValues(["A", "A", 0, false, "B"])).toEqual(["A", "B"]);
    expect(isTextReplacementValue("😺".repeat(1001))).toBe(false);
    expect(isTextReplacementValue("bad\0")).toBe(false);
  });

  it("builds atomic, non-overwriting groups within both limits, skips identity pairs and supports explicit empty targets", () => {
    const existing = [{ from_value: "OLD", to_value: "kept" }], before = structuredClone(existing);
    expect(textReplacementGroup(existing, [" A ", "A", "A\t", " A "], "A", 3)).toEqual({ additions: [{ from_value: " A ", to_value: "A" }, { from_value: "A\t", to_value: "A" }], error: null });
    expect(textReplacementGroup(existing, ["B", "OLD"], "X", 100)).toEqual({ additions: [], error: "conflict" });
    expect(textReplacementGroup(existing, ["B", "C"], "X", 2)).toEqual({ additions: [], error: "limit" });
    expect(textReplacementGroup([], ["A"], "A", 100).error).toBe("same");
    expect(textReplacementGroup([], ["A", ""], "", 100)).toEqual({ additions: [{ from_value: "A", to_value: "" }], error: null });
    expect(textReplacementGroup([], [""], "A", 100).additions).toEqual([{ from_value: "", to_value: "A" }]);
    expect(textReplacementGroup([], ["A"], "\0", 100).error).toBe("invalid");
    expect(textReplacementGroup([], ["A"], "B", NaN).error).toBe("limit");
    expect(textReplacementGroup(Array.from({ length: 100 }, (_, i) => ({ from_value: String(i), to_value: "X" })), ["A"], "B", 1000).error).toBe("limit");
    expect(existing).toEqual(before);
  });

  it("turns chosen variants into editable rows, focuses the first new value and only saves on explicit confirmation", () => {
    const onSave = vi.fn(); render(view(onSave));
    expect(sampleTab()).toHaveAttribute("aria-selected", "true"); select(2); select(3);
    fireEvent.click(screen.getByRole("button", { name: "使用第 1 项样例作为统一值" })); add();
    expect(manualTab()).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("textbox", { name: "第 1 项原值" })).toHaveValue(" A ");
    expect(screen.getByRole("textbox", { name: "第 2 项原值" })).toHaveValue("A\t");
    expect(screen.getByRole("textbox", { name: "第 1 项替换值" })).toHaveFocus();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.keyDown(manualTab(), { key: "ArrowLeft" }); expect(sampleTab()).toHaveFocus();
    expect(screen.getByRole("checkbox", { name: /^选择第 2 项样例：/ })).toBeDisabled();
    fireEvent.keyDown(sampleTab(), { key: "ArrowRight" }); expect(manualTab()).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: zh.visualCleaning.replacementSave }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith([{ from_value: " A ", to_value: "A" }, { from_value: "A\t", to_value: "A" }]);
  });

  it("requires explicit empty-text intent and does not partially add an over-limit selection", () => {
    const onSave = vi.fn(); const { rerender } = render(view(onSave, [], ["A", "B", ""], 1));
    select(1); select(2);
    expect(screen.getByRole("button", { name: zh.visualCleaning.groupAdd })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: zh.visualCleaning.groupEmptyTarget })); add();
    expect(screen.getByRole("alert")).toHaveTextContent(zh.visualCleaning.groupError.limit);
    expect(sampleTab()).toHaveAttribute("aria-selected", "true"); select(2); add();
    expect(screen.getByRole("textbox", { name: "第 1 项替换值" })).toHaveValue("");
    expect(screen.queryByRole("textbox", { name: "第 2 项原值" })).not.toBeInTheDocument();
    fireEvent.click(sampleTab()); rerender(view(onSave, [], ["A", "B", ""], 1, true));
    expect(screen.getByRole("checkbox", { name: /^选择第 2 项样例：/ })).toBeDisabled(); expect(manualTab()).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("preserves manual drafts and refuses conflicts if a selected original is later used in the list", () => {
    const onSave = vi.fn(); render(view(onSave, [{ from_value: "OLD", to_value: "kept" }], ["A", "B", "OLD"]));
    expect(manualTab()).toHaveAttribute("aria-selected", "true"); fireEvent.click(sampleTab()); select(1); target("new");
    fireEvent.click(manualTab()); expect(screen.getByRole("button", { name: zh.visualCleaning.replacementSave })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "第 1 项原值" }), { target: { value: "A" } });
    fireEvent.click(sampleTab()); add();
    expect(screen.getByRole("alert")).toHaveTextContent(zh.visualCleaning.groupError.conflict);
    select(1); select(2); add();
    expect(screen.getByRole("textbox", { name: "第 1 项原值" })).toHaveValue("A");
    expect(screen.getByRole("textbox", { name: "第 1 项替换值" })).toHaveValue("kept");
    fireEvent.click(screen.getByRole("button", { name: zh.visualCleaning.replacementSave }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith([{ from_value: "A", to_value: "kept" }, { from_value: "B", to_value: "new" }]);
  });

  it("protects unadded sample choices on exit and preserves them across locale and routine source refresh", () => {
    const close = vi.fn(); const editor = (english = false) => <NextIntlClientProvider locale={english ? "en" : "zh"} messages={english ? en : zh}>
      <VisualCleaningEditor source={source} columns={[" 渠道 "]} onClose={close} />
    </NextIntlClientProvider>;
    const { rerender } = render(editor()); fireEvent.click(screen.getByRole("button", { name: zh.visualCleaning.replaceTextButton }));
    select(2); target(" A\t");
    fireEvent.click(screen.getByRole("button", { name: zh.visualCleaning.closeEditorAria }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: zh.visualCleaning.continueEditing }));
    rerender(editor(true));
    expect(screen.getByRole("textbox", { name: en.visualCleaning.groupTarget })).toHaveValue(" A\t");
    expect(screen.getByRole("checkbox", { name: /^Select sample value 2:/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: en.visualCleaning.groupClear }));
    fireEvent.click(screen.getByRole("button", { name: en.visualCleaning.replacementCancel }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(); expect(close).not.toHaveBeenCalled(); expect(http.post).not.toHaveBeenCalled();
  });

  it("keeps group creation in draft history and submits exact mappings only through preview then apply", async () => {
    http.post.mockResolvedValueOnce(response(preview)).mockResolvedValueOnce(response({ recipe: {}, revision: {}, preflight: {} }));
    const close = vi.fn(); render(<NextIntlClientProvider locale="zh" messages={zh}><VisualCleaningEditor source={source} columns={[" 渠道 "]} onClose={close} /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: zh.visualCleaning.replaceTextButton })); select(2); select(3); target("A"); add();
    fireEvent.click(screen.getByRole("button", { name: zh.visualCleaning.replacementSave }));
    expect(http.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: zh.visualCleaning.undoStepEdit })); expect(screen.queryByRole("checkbox", { name: /本次使用步骤/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: zh.visualCleaning.redoStepEdit }));
    fireEvent.click(screen.getByRole("button", { name: zh.visualCleaning.previewChanges }));
    fireEvent.click(await screen.findByRole("button", { name: zh.visualCleaning.applyButton }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    const operations = [{ operation: "replace_text_values", column: " 渠道 ", replacements: [{ from_value: " A ", to_value: "A" }, { from_value: "A\t", to_value: "A" }] }];
    expect(http.post.mock.calls[0][1]).toEqual({ operations });
    expect(http.post.mock.calls[1][1]).toEqual({ operations, expected_operations_hash: preview.operations_hash, expected_source_fingerprint: preview.source_fingerprint,
      expected_preview_output_fingerprint: preview.preview_output_fingerprint, expected_current_working_fingerprint: null, expected_current_recipe_active_revision_id: null });
    expect(http.post).toHaveBeenCalledTimes(2); expect(http.get).not.toHaveBeenCalled();
  });
});
