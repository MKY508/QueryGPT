import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VisualCleaningEditor } from "@/components/chat/VisualCleaningEditor";
import { cleaningEditHistoryReducer as reduce, createCleaningEditHistory as create, hasCleaningEdits } from "@/lib/cleaning-edit-history";
import type { ProjectDataSource, VisualCleaningOperation, VisualCleaningPreview } from "@/lib/types/api";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

const http = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ api: http }));
import { useProjectStore } from "@/lib/stores/project";
const original = useProjectStore.getState();
const source: ProjectDataSource = { id: "exit-source", project_id: "exit-project", kind: "file", name: "门店订单.csv", status: "ready",
  profile_data: { sample: [{ 渠道: " 直营 " }] }, created_at: "2026-09-06", updated_at: "2026-09-06" };
const trim: VisualCleaningOperation = { operation: "trim_text", column: "渠道" };
const mapping: VisualCleaningOperation = { operation: "replace_text_values", column: "渠道", replacements: [{ from_value: " A\n", to_value: " B\t" }] };
const preview: VisualCleaningPreview = { source_id: source.id, operations_hash: "a".repeat(64), source_fingerprint: "b".repeat(64),
  preview_output_fingerprint: "c".repeat(64), can_apply: true, before: { rows: 1, columns: 1, sample: [{ 渠道: " 直营 " }] },
  after: { rows: 1, columns: 1, sample: [{ 渠道: "直营" }] }, changes: [{ column: "渠道", changed_count: 1 }], comparison_basis: "position" };
const saved = (operations: VisualCleaningOperation[]) => ({ ...source, profile_data: { ...source.profile_data, visual_cleaning: { operations } } });
const response = (data: unknown) => ({ data: { data } });
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
function Harness({ item = source, onClose = vi.fn(), english = false }: { item?: ProjectDataSource; onClose?: () => void; english?: boolean }) {
  const [open, setOpen] = useState(false);
  return <NextIntlClientProvider locale={english ? "en" : "zh"} messages={english ? en : zh}>
    <button onClick={() => setOpen(true)}>Open editor</button>
    {open && <VisualCleaningEditor source={item} columns={["渠道"]} onClose={() => { onClose(); setOpen(false); }} />}
  </NextIntlClientProvider>;
}
const launch = () => { const button = screen.getByRole("button", { name: "Open editor" }); button.focus(); fireEvent.click(button); };
const close = () => { const button = screen.getByRole("button", { name: zh.visualCleaning.closeEditorAria }); button.focus(); fireEvent.click(button); };
const add = () => fireEvent.click(screen.getByRole("button", { name: /^去除首尾空格/ }));
const prompt = () => screen.getByRole("alertdialog");
const cancel = (node: HTMLElement) => fireEvent(node, new Event("cancel", { bubbles: false, cancelable: true }));
beforeEach(() => {
  http.post.mockReset(); http.get.mockReset(); document.documentElement.lang = "zh";
  useProjectStore.setState({ currentProjectId: source.project_id, cleaningAction: null, cleaningPreviewBySource: {}, error: null,
    refreshCurrent: vi.fn().mockResolvedValue(undefined) });
});
afterEach(() => { cleanup(); useProjectStore.setState(original, true); vi.restoreAllMocks(); });

describe("cleaning exit protection", () => {
  it("compares current edits including skipped steps and exact values, not undo depth", () => {
    const baseline = [trim, mapping], initial = create(baseline);
    expect(hasCleaningEdits(initial.present, baseline)).toBe(false);
    const skipped = reduce(initial, { type: "toggle", key: "trim_text:渠道" });
    expect(hasCleaningEdits(skipped.present, baseline)).toBe(true);
    const undone = reduce(skipped, { type: "undo" });
    expect(undone.future).toHaveLength(1); expect(hasCleaningEdits(undone.present, baseline)).toBe(false);
    const changed = reduce(initial, { type: "record", operations: [trim, { operation: "replace_text_values", column: "渠道", replacements: [{ from_value: " A\n", to_value: " B" }] }] });
    expect(hasCleaningEdits(changed.present, baseline)).toBe(true);
    expect(hasCleaningEdits(reduce(changed, { type: "record", operations: baseline }).present, baseline)).toBe(false);
    const added = reduce(create([]), { type: "record", operations: [trim] });
    expect(hasCleaningEdits(reduce(added, { type: "toggle", key: "trim_text:渠道" }).present, [])).toBe(true);
  });

  it("closes unchanged or fully undone drafts without a prompt, but protects skipped steps", () => {
    const onClose = vi.fn(); render(<Harness item={saved([trim])} onClose={onClose} />); launch(); close();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(); expect(onClose).toHaveBeenCalledTimes(1);
    launch(); fireEvent.click(screen.getByRole("checkbox", { name: /本次使用步骤/ })); close();
    expect(prompt()).toHaveAccessibleName(zh.visualCleaning.discardEditorTitle);
    fireEvent.click(within(prompt()).getByRole("button", { name: zh.visualCleaning.continueEditing }));
    expect(screen.getByRole("checkbox", { name: /本次使用步骤/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: zh.visualCleaning.undoStepEdit })); close();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(onClose).toHaveBeenCalledTimes(2);
    expect(http.post).not.toHaveBeenCalled();
  });

  it("keeps Escape and keyboard history inside the confirmation, then discards only on explicit choice", () => {
    const onClose = vi.fn(); render(<Harness onClose={onClose} />); launch(); add(); close();
    const keep = within(prompt()).getByRole("button", { name: zh.visualCleaning.continueEditing });
    expect(keep).toHaveFocus(); expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(keep, { key: "z", ctrlKey: true });
    cancel(prompt());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: zh.visualCleaning.closeEditorAria })).toHaveFocus();
    expect(screen.getByRole("checkbox", { name: /本次使用步骤/ })).toBeChecked();
    const ime = new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true });
    fireEvent(screen.getByRole("dialog"), ime); expect(ime.defaultPrevented).toBe(true);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    close(); fireEvent.click(within(prompt()).getByRole("button", { name: zh.visualCleaning.discardAndClose }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(onClose).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Open editor" })).toHaveFocus(); expect(http.post).not.toHaveBeenCalled();
  });

  it("protects unfinished replacement text separately and keeps saved steps when only those edits are discarded", () => {
    render(<Harness item={saved([trim, mapping])} />); launch();
    fireEvent.click(screen.getByRole("button", { name: "编辑“渠道”的取值替换" }));
    fireEvent.click(screen.getByRole("button", { name: zh.visualCleaning.replacementCancel }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑“渠道”的取值替换" }));
    const field = screen.getByRole("textbox", { name: "第 1 项替换值" });
    fireEvent.change(field, { target: { value: "  未保存\t\n" } }); field.focus();
    cancel(screen.getByRole("dialog"));
    expect(prompt()).toHaveAccessibleName(zh.visualCleaning.discardEditorTitle);
    cancel(prompt()); expect(field).toHaveFocus(); expect(field).toHaveValue("  未保存\t\n");
    fireEvent.click(screen.getByRole("button", { name: zh.visualCleaning.replacementCancel }));
    expect(prompt()).toHaveAccessibleName(zh.visualCleaning.discardReplacementTitle);
    fireEvent.click(within(prompt()).getByRole("button", { name: zh.visualCleaning.discardReplacement }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getAllByRole("checkbox", { name: /本次使用步骤/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "编辑“渠道”的取值替换" }));
    const restored = screen.getByRole("textbox", { name: "第 1 项替换值" }); expect(restored).toHaveValue(" B\t");
    fireEvent.change(restored, { target: { value: "changed" } }); fireEvent.change(restored, { target: { value: " B\t" } });
    fireEvent.click(screen.getByRole("button", { name: zh.visualCleaning.replacementCancel }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(); close();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(http.post).not.toHaveBeenCalled();
  });

  it("treats an untouched new replacement form as clean, but protects added or invalid rows before they become steps", () => {
    render(<Harness />); launch();
    fireEvent.click(screen.getByRole("button", { name: zh.visualCleaning.replaceTextButton })); close();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    launch(); fireEvent.click(screen.getByRole("button", { name: zh.visualCleaning.replaceTextButton }));
    fireEvent.click(screen.getByRole("button", { name: zh.visualCleaning.replacementAddRow })); close();
    expect(prompt()).toBeInTheDocument(); cancel(prompt());
    fireEvent.change(screen.getByRole("textbox", { name: "第 1 项原值" }), { target: { value: "A" } });
    fireEvent.change(screen.getByRole("textbox", { name: "第 2 项原值" }), { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: zh.visualCleaning.replacementSave }));
    expect(screen.getByRole("alert")).toBeInTheDocument(); close();
    fireEvent.click(within(prompt()).getByRole("button", { name: zh.visualCleaning.continueEditing }));
    expect(screen.getByRole("textbox", { name: "第 2 项原值" })).toHaveValue("A");
    expect(http.post).not.toHaveBeenCalled();
  });

  it("keeps a pending preview while the user decides and does not steal focus when it finishes", async () => {
    const pending = deferred(); http.post.mockReturnValue(pending.promise);
    const onClose = vi.fn(); const { rerender } = render(<Harness onClose={onClose} />); launch(); add();
    fireEvent.click(screen.getByRole("button", { name: zh.visualCleaning.previewChanges })); close();
    expect(useProjectStore.getState().cleaningAction?.kind).toBe("preview");
    await act(async () => pending.resolve(response(preview)));
    expect(within(prompt()).getByRole("button", { name: zh.visualCleaning.continueEditing })).toHaveFocus();
    expect(useProjectStore.getState().cleaningPreviewBySource[source.id]).toEqual(preview);
    rerender(<Harness onClose={onClose} english />);
    expect(prompt()).toHaveAccessibleName(en.visualCleaning.discardEditorTitle);
    fireEvent.click(within(prompt()).getByRole("button", { name: en.visualCleaning.continueEditing }));
    expect(screen.getByRole("button", { name: en.visualCleaning.applyButton })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled(); expect(http.post).toHaveBeenCalledTimes(1);
  });

  it("never interrupts an apply and bypasses the prompt after successful application", async () => {
    const write = deferred(); http.post.mockResolvedValueOnce(response(preview)).mockReturnValueOnce(write.promise);
    const onClose = vi.fn(); render(<Harness onClose={onClose} />); launch(); add();
    fireEvent.click(screen.getByRole("button", { name: zh.visualCleaning.previewChanges }));
    fireEvent.click(await screen.findByRole("button", { name: zh.visualCleaning.applyButton }));
    expect(screen.getByRole("button", { name: zh.visualCleaning.closeEditorAria })).toBeDisabled();
    cancel(screen.getByRole("dialog")); expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => write.resolve(response({ recipe: {}, revision: {}, preflight: {} })));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(); expect(onClose).toHaveBeenCalledOnce();
    expect(http.post).toHaveBeenCalledTimes(2);
  });
});
