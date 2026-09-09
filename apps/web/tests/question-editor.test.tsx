import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputBar } from "@/components/chat/InputBar";
import { useComposerDraft } from "@/components/chat/useComposerDraft";
import { createComposerDraftStore } from "@/lib/composer-drafts";
import { focusableElements } from "@/lib/use-modal-focus";
import { mockSemanticDialogs } from "./semantic-dialog-mock";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

function fixture() {
  const entries = new Map<string, string>();
  const storage = { getItem: (key: string) => entries.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { entries.set(key, value); }),
    removeItem: (key: string) => { entries.delete(key); } };
  return { storage, store: createComposerDraftStore(() => storage), submit: vi.fn().mockResolvedValue(false), upload: vi.fn(), reveal: vi.fn() };
}
type Fixture = ReturnType<typeof fixture>;
function Composer({ setup, project = "p1", conversation = "c1", locale = "zh", disabled = false }: {
  setup: Fixture; project?: string; conversation?: string; locale?: string; disabled?: boolean;
}) {
  const draft = useComposerDraft(project, conversation, setup.store);
  return <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh}><InputBar
    contextKey={JSON.stringify([project, conversation])} projectName={project} onRevealComposer={setup.reveal}
    input={draft.input} onInputChange={draft.setInput} onAccepted={draft.onAccepted} draftUnretained={draft.unretained}
    draftUnreadable={draft.unreadable} onRetryDraftRetention={draft.retryRetention} onSubmit={setup.submit}
    onUploadFile={setup.upload} onStop={vi.fn()} onOpenData={vi.fn()} isLoading={false} isUploading={false}
    disabled={disabled} dataReady sourceCount={1} /></NextIntlClientProvider>;
}
const compact = () => screen.getByTestId("chat-input") as HTMLTextAreaElement;
const dialog = () => screen.getByRole("dialog", { name: "编辑问题" });
const editor = () => within(dialog()).getByRole("textbox", { name: "问题内容" }) as HTMLTextAreaElement;
async function expand() {
  fireEvent.click(screen.getByRole("button", { name: "展开编辑问题" }));
  await waitFor(() => expect(editor()).toHaveFocus());
}
let restoreDialogs: () => void;
beforeEach(() => { restoreDialogs = mockSemanticDialogs(); });
afterEach(() => { cleanup(); restoreDialogs(); vi.restoreAllMocks(); });

describe("expanded question editor", () => {
  it("starts a fresh composer session when leaving a pending send and ignores its late failure", async () => {
    const setup = fixture();
    let reject!: (error: Error) => void;
    setup.submit.mockReturnValueOnce(new Promise<boolean>((_resolve, fail) => { reject = fail; }));
    const view = render(<Composer setup={setup} />);
    fireEvent.change(compact(), { target: { value: "项目一的问题" } });
    fireEvent.click(screen.getByTestId("chat-submit"));
    expect(screen.getByTestId("chat-submit")).toBeDisabled();
    view.rerender(<Composer setup={setup} project="p2" />);
    fireEvent.change(compact(), { target: { value: "项目二的问题" } });
    expect(screen.getByTestId("chat-submit")).not.toBeDisabled();
    await act(async () => { reject(new Error("Old request failed")); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(compact()).toHaveValue("项目二的问题");
    expect(setup.store.get({ projectId: "p1", conversationId: "c1" }).text).toBe("项目一的问题");
  });

  it("edits the same exact multiline draft and restores selection when returning and reopening", async () => {
    const setup = fixture(); render(<Composer setup={setup} />);
    const text = "  八月经营复盘\n\n只比较直营渠道。  ";
    fireEvent.change(compact(), { target: { value: text } });
    compact().setSelectionRange(2, 8, "backward");
    vi.spyOn(compact(), "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
    await expand(); expect(editor()).toHaveValue(text); expect(editor().selectionStart).toBe(2); expect(editor().selectionEnd).toBe(8);
    expect(dialog().parentElement).toBe(document.body);
    const changed = text + "\n列出毛利下降的三个原因。";
    fireEvent.change(editor(), { target: { value: changed } }); editor().setSelectionRange(10, 17, "forward");
    expect(compact()).toHaveValue(changed);
    fireEvent.click(within(dialog()).getByRole("button", { name: "完成编辑" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(compact()).toHaveFocus();
    expect(compact().selectionStart).toBe(10); expect(compact().selectionEnd).toBe(17); expect(setup.reveal).toHaveBeenCalledOnce();
    await expand(); expect(editor()).toHaveValue(changed); expect(editor().selectionEnd).toBe(17); expect(setup.submit).not.toHaveBeenCalled();
  });

  it("keeps Enter, covered shortcuts and file drops from sending, navigating or uploading", async () => {
    const setup = fixture(); render(<Composer setup={setup} />); await expand();
    const backgroundKey = vi.fn(); window.addEventListener("keydown", backgroundKey);
    try {
      for (const modifiers of [{}, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) fireEvent.keyDown(editor(), { key: "Enter", ...modifiers });
      fireEvent.keyDown(editor(), { key: "k", metaKey: true });
      expect(backgroundKey).not.toHaveBeenCalled(); expect(setup.submit).not.toHaveBeenCalled();
      const transfer = { types: ["Files"], files: [new File(["demo"], "fictional.csv")] };
      expect(fireEvent.dragOver(editor(), { dataTransfer: transfer })).toBe(false);
      expect(fireEvent.drop(editor(), { dataTransfer: transfer })).toBe(false); expect(setup.upload).not.toHaveBeenCalled();
      fireEvent.click(within(dialog()).getByRole("button", { name: "关闭问题编辑器" }));
      fireEvent.keyDown(compact(), { key: "k", metaKey: true }); expect(backgroundKey).toHaveBeenCalledOnce();
    } finally { window.removeEventListener("keydown", backgroundKey); }
  });

  it("traps Tab, respects composition Escape and remains closable when editing becomes unavailable", async () => {
    const setup = fixture(), view = render(<Composer setup={setup} />); await expand();
    fireEvent.keyDown(editor(), { key: "Escape", isComposing: true }); expect(dialog()).toBeInTheDocument();
    fireEvent.keyDown(editor(), { key: "Escape", keyCode: 229 }); expect(dialog()).toBeInTheDocument();
    // jsdom can return selector unions in selector rather than document order.
    // Exercise the trap's boundaries here; Chromium verifies actual Tab order.
    const controls = focusableElements(dialog()), first = controls[0], last = controls.at(-1)!;
    last.focus(); fireEvent.keyDown(last, { key: "Tab" }); expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true }); expect(last).toHaveFocus();
    view.rerender(<Composer setup={setup} disabled />); expect(editor()).toBeDisabled();
    fireEvent.keyDown(within(dialog()).getByRole("button", { name: "完成编辑" }), { key: "Escape" }); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开编辑问题" })).toBeDisabled();
  });

  it("closes on a project or conversation change without replacing either draft or reopening later", async () => {
    const setup = fixture(), view = render(<Composer setup={setup} />); await expand();
    fireEvent.change(editor(), { target: { value: "项目一的条件" } }); editor().setSelectionRange(2, 5);
    view.rerender(<Composer setup={setup} project="p2" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(compact()).toHaveValue("");
    fireEvent.change(compact(), { target: { value: "项目二的问题" } });
    view.rerender(<Composer setup={setup} />); expect(compact()).toHaveValue("项目一的条件"); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await expand(); view.rerender(<Composer setup={setup} conversation="c2" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(compact()).toHaveValue("");
    expect(setup.store.get({ projectId: "p2", conversationId: "c1" }).text).toBe("项目二的问题"); expect(setup.reveal).not.toHaveBeenCalled();
  });

  it("retains edits through locale and retention retries, and an older acknowledgment cannot clear them", async () => {
    const setup = fixture(), scope = { projectId: "p1", conversationId: "c1" };
    const old = setup.store.write(scope, "原问题");
    const view = render(<Composer setup={setup} />); await expand();
    setup.storage.setItem.mockImplementationOnce(() => { throw new Error("quota"); });
    fireEvent.change(editor(), { target: { value: "新增条件\n只看直营门店" } });
    expect(within(dialog()).getByRole("alert")).toHaveTextContent("草稿暂未保留");
    view.rerender(<Composer setup={setup} locale="en" />);
    const english = screen.getByRole("dialog", { name: "Edit question" });
    expect(within(english).getByRole("textbox", { name: "Question text" })).toHaveValue("新增条件\n只看直营门店");
    fireEvent.click(within(english).getByRole("alert").querySelector("button")!);
    expect(within(english).queryByRole("alert")).not.toBeInTheDocument();
    act(() => { expect(setup.store.clearIfUnchanged(scope, old)).toBe(false); });
    fireEvent.click(within(english).getByRole("button", { name: "Finish editing" }));
    expect(compact()).toHaveValue("新增条件\n只看直营门店"); expect(setup.submit).not.toHaveBeenCalled();
  });
});
