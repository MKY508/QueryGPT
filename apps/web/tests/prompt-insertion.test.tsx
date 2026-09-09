import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createComposerDraftStore, type ComposerDraftScope } from "@/lib/composer-drafts";
import { useComposerDraft } from "@/components/chat/useComposerDraft";
import { appendPrompt, usePromptInsertion } from "@/components/chat/usePromptInsertion";
import { mockSemanticDialogs } from "./semantic-dialog-mock";
import { focusableElements } from "@/lib/use-modal-focus";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

const first: ComposerDraftScope = { projectId: "first", conversationId: "one" };
const second: ComposerDraftScope = { projectId: "second", conversationId: null };
let store: ReturnType<typeof createComposerDraftStore>, restoreDialogs: () => void, allowed: boolean;
const applied = vi.fn(), focus = vi.fn();
const prompt = "比较各门店毛利\n保留退款口径";
function Harness({ scope = first, blocked = false, locale = "zh", incoming = prompt }: { scope?: ComposerDraftScope; blocked?: boolean; locale?: "zh" | "en"; incoming?: string }) {
  const draft = useComposerDraft(scope.projectId, scope.conversationId, store);
  const insertion = usePromptInsertion({ scope: JSON.stringify(scope), draft: draft.draft, replaceInput: draft.replaceInput,
    blocked, canApply: () => allowed, onFocusComposer: focus });
  return <NextIntlClientProvider locale={locale} messages={locale === "zh" ? zh : en}>
    <textarea aria-label="Draft" value={draft.input} onChange={event => draft.setInput(event.target.value)} />
    <button onClick={() => insertion.request(incoming, applied)}>Use question</button>
    {insertion.dialog}
  </NextIntlClientProvider>;
}
const open = () => { const button = screen.getByRole("button", { name: "Use question" }); button.focus(); fireEvent.click(button); return button; };

describe("safe question reuse", () => {
  beforeEach(() => { store = createComposerDraftStore(() => null); restoreDialogs = mockSemanticDialogs(); allowed = true; applied.mockClear(); focus.mockClear(); });
  afterEach(() => { cleanup(); restoreDialogs(); });

  it("compares exact draft revisions at write time, including edits followed by reversions and failed retention", () => {
    const original = store.write(first, "原来的问题");
    store.write(first, "后来写的"); store.write(first, "原来的问题");
    expect(store.writeIfUnchanged(first, original, prompt)).toBe(false);
    expect(store.get(first).text).toBe("原来的问题");
    const current = store.get(first);
    expect(store.writeIfUnchanged(first, current, prompt)).toBe(true);
    expect(store.get(first)).toMatchObject({ text: prompt, retained: false });
    expect(store.hasUnretained()).toBe(true); expect(store.get(second).text).toBe("");
    expect(appendPrompt("  当前问题  ", prompt)).toBe("  当前问题  \n\n" + prompt);
    expect(appendPrompt("当前问题\n", prompt)).toBe("当前问题\n\n" + prompt);
    expect(appendPrompt("当前问题\n\n", prompt)).toBe("当前问题\n\n" + prompt);
  });

  it("fills empty or identical questions directly, but ignores blank prompts and blocked actions", () => {
    const { rerender } = render(<Harness />); open();
    expect(screen.getByLabelText("Draft")).toHaveValue(prompt); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(applied).toHaveBeenCalledTimes(1); expect(focus).toHaveBeenCalledTimes(1);
    open(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<Harness incoming=" " />); open(); expect(applied).toHaveBeenCalledTimes(2);
    rerender(<Harness blocked incoming="另一个问题" />); open(); expect(applied).toHaveBeenCalledTimes(2);
    expect(store.get(first).text).toBe(prompt);
  });

  it("previews exact plain text, cancels with focus return and applies append or replacement only after choosing", () => {
    const original = "  上半年收入\n<script>不是脚本</script>  "; store.write(first, original);
    render(<Harness />); const origin = open();
    expect(screen.getByTestId("prompt-current-preview").textContent).toBe(original);
    expect(screen.getByTestId("prompt-incoming-preview").textContent).toBe(prompt);
    expect(document.querySelector("script")).toBeNull(); expect(store.get(first).text).toBe(original);
    expect(screen.getByRole("button", { name: zh.promptInsertion.cancel })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: zh.promptInsertion.cancel }));
    expect(origin).toHaveFocus(); expect(applied).not.toHaveBeenCalled();
    open(); fireEvent.click(screen.getByRole("button", { name: zh.promptInsertion.append }));
    expect(store.get(first).text).toBe(original + "\n\n" + prompt); expect(applied).toHaveBeenCalledTimes(1);
    open(); fireEvent.click(screen.getByRole("button", { name: zh.promptInsertion.replace }));
    expect(store.get(first).text).toBe(prompt); expect(applied).toHaveBeenCalledTimes(2); expect(focus).toHaveBeenCalledTimes(2);
  });

  it("abandons old choices when the draft, project, conversation or running state changes", () => {
    store.write(first, "当前内容"); store.write(second, "另一个项目");
    const { rerender } = render(<Harness />); open();
    const replace = screen.getByRole("button", { name: zh.promptInsertion.replace });
    act(() => { store.write(first, "新增内容"); store.write(first, "当前内容"); fireEvent.click(replace); });
    expect(store.get(first).text).toBe("当前内容"); expect(applied).not.toHaveBeenCalled(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    open(); rerender(<Harness scope={second} />); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(store.get(second).text).toBe("另一个项目");
    open(); rerender(<Harness scope={{ ...second, conversationId: "new" }} />); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<Harness />); open(); rerender(<Harness blocked />); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<Harness />); open(); allowed = false; fireEvent.click(screen.getByRole("button", { name: zh.promptInsertion.replace }));
    expect(store.get(first).text).toBe("当前内容"); expect(applied).not.toHaveBeenCalled();
    const hook = renderHook(() => usePromptInsertion({ scope: "first", draft: store.get(first), blocked: false, canApply: () => true,
      replaceInput: (expected, text) => store.writeIfUnchanged(first, expected, text), onFocusComposer: focus }));
    const request = hook.result.current.request; hook.unmount(); act(() => request("stale", applied)); expect(applied).not.toHaveBeenCalled();
  });

  it("keeps bilingual modal keyboard and file-drop handling local without triggering editing actions", () => {
    store.write(first, "Existing question"); render(<Harness locale="en" />); open();
    const dialog = screen.getByRole("dialog", { name: en.promptInsertion.title });
    // Assert containment using this DOM's selector ordering; real browser checks
    // also verify the preview-to-actions document order.
    const controls = focusableElements(dialog), firstControl = controls[0], lastControl = controls.at(-1)!;
    lastControl.focus(); fireEvent.keyDown(lastControl, { key: "Tab" }); expect(firstControl).toHaveFocus();
    fireEvent.keyDown(firstControl, { key: "Tab", shiftKey: true }); expect(lastControl).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape", isComposing: true }); expect(dialog).toHaveAttribute("open");
    expect(fireEvent.drop(dialog, { dataTransfer: { files: [new File(["data"], "fixture.csv")], types: ["Files"] } })).toBe(false);
    fireEvent(dialog, new Event("cancel", { cancelable: true })); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(applied).not.toHaveBeenCalled(); expect(store.get(first).text).toBe("Existing question");
  });
});
