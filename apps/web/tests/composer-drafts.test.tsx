import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { composerDraftKey, createComposerDraftStore } from "@/lib/composer-drafts";
import { useComposerDraft } from "@/components/chat/useComposerDraft";
import { InputBar } from "@/components/chat/InputBar";
import { ComposerDraftGuard } from "@/components/providers/ComposerDraftGuard";
import { submitWithAnalysisReceipt } from "@/lib/chat-submission";
import type { ChatMessage } from "@/lib/types/chat";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

const scope = { projectId: "project-1", conversationId: "conversation-1" };
const nextScope = { projectId: "project-2", conversationId: "conversation-1" };
function storage() {
  const entries = new Map<string, string>();
  return { entries, getItem: vi.fn((key: string) => entries.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { entries.set(key, value); }), removeItem: vi.fn((key: string) => { entries.delete(key); }) };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
afterEach(cleanup);

describe("scoped composer drafts", () => {
  it("isolates project, conversation and new-analysis drafts and restores exact text after remount/reload", () => {
    const saved = storage(), store = createComposerDraftStore(() => saved);
    const hook = renderHook(({ projectId, conversationId }) => useComposerDraft(projectId, conversationId, store), { initialProps: scope });
    act(() => hook.result.current.setInput("  收入变化\n只看华东  "));
    const original = hook.result.current.onAccepted;
    hook.rerender(nextScope); expect(hook.result.current.input).toBe("");
    act(() => hook.result.current.setInput("采购计划"));
    hook.rerender({ ...scope, conversationId: "conversation-2" }); expect(hook.result.current.input).toBe("");
    hook.rerender(scope); expect(hook.result.current.input).toBe("  收入变化\n只看华东  ");
    act(() => hook.result.current.setInput("修改后的问题"));
    act(original); expect(hook.result.current.input).toBe("修改后的问题");
    const reloaded = createComposerDraftStore(() => saved);
    reloaded.hydrate(scope); reloaded.hydrate(nextScope); reloaded.hydrate({ ...scope, conversationId: null });
    expect(reloaded.get(scope).text).toBe("修改后的问题"); expect(reloaded.get(nextScope).text).toBe("采购计划");
    expect(reloaded.get({ ...scope, conversationId: null }).text).toBe("");
    expect(saved.entries.size).toBe(2);
  });

  it("clears only an unchanged submitted revision even after leaving, and never clears an edit-then-revert", () => {
    const saved = storage(), store = createComposerDraftStore(() => saved);
    const first = store.write(scope, "收入"), second = store.write(nextScope, "库存");
    store.write(scope, "成本"); store.write(scope, "收入");
    expect(store.clearIfUnchanged(scope, first)).toBe(false);
    expect(store.clearIfUnchanged(nextScope, second)).toBe(true);
    expect(saved.entries.has(composerDraftKey(nextScope))).toBe(false);
    expect(store.get(scope).text).toBe("收入");
  });

  it("keeps failed writes in memory, warns before refresh and retries failed clearing without reviving sent input", () => {
    const saved = storage(), store = createComposerDraftStore(() => saved);
    render(<ComposerDraftGuard store={store} />);
    const hook = renderHook(() => useComposerDraft(scope.projectId, scope.conversationId, store));
    saved.setItem.mockImplementationOnce(() => { throw new Error("quota"); });
    act(() => hook.result.current.setInput("不要丢失这段文字"));
    expect(hook.result.current.input).toBe("不要丢失这段文字"); expect(hook.result.current.unretained).toBe(true);
    const leaving = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(leaving); expect(leaving.defaultPrevented).toBe(true);
    const submittedBeforeRetry = hook.result.current.onAccepted;
    act(() => hook.result.current.retryRetention()); expect(hook.result.current.unretained).toBe(false);
    saved.removeItem.mockImplementationOnce(() => { throw new Error("blocked"); });
    act(submittedBeforeRetry); expect(hook.result.current.input).toBe(""); expect(hook.result.current.unretained).toBe(true);
    act(() => hook.result.current.retryRetention()); expect(saved.entries.size).toBe(0);
    const next = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(next); expect(next.defaultPrevented).toBe(false);
    saved.setItem.mockImplementationOnce(() => { throw new Error("quota"); });
    act(() => hook.result.current.setInput("离开分析后仍需保留")); hook.unmount();
    const outsideChat = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(outsideChat); expect(outsideChat.defaultPrevented).toBe(true);
  });

  it("does not erase unreadable or misidentified stored drafts when retrying a read", () => {
    const saved = storage(), key = composerDraftKey(scope);
    saved.entries.set(key, JSON.stringify({ scope: composerDraftKey(nextScope), text: "另一个项目" }));
    const store = createComposerDraftStore(() => saved); store.hydrate(scope);
    expect(store.get(scope).text).toBe(""); expect(store.hasUnreadable()).toBe(true);
    store.retryUnretained(); expect(saved.removeItem).not.toHaveBeenCalled(); expect(saved.setItem).not.toHaveBeenCalled();
    saved.entries.set(key, JSON.stringify({ scope: key, text: "恢复成功" }));
    store.retryUnretained(); expect(store.get(scope).text).toBe("恢复成功"); expect(store.hasUnreadable()).toBe(false);
    const denied = createComposerDraftStore(() => { throw new Error("getter blocked"); });
    denied.hydrate(scope); expect(denied.hasUnreadable()).toBe(true);
    denied.write(scope, "仍可输入"); expect(denied.get(scope).text).toBe("仍可输入"); expect(denied.hasUnretained()).toBe(true);
  });

  it("requires a receipt from the exact stream, not a settled request or another result", async () => {
    const request = deferred<void>();
    const state: { activeStreamId: string | null; messages: ChatMessage[] } = { activeStreamId: null, messages: [] };
    const submit = () => { state.activeStreamId = "submitted"; return request.promise; };
    const pending = submitWithAnalysisReceipt(submit, () => state);
    state.messages = [{ role: "assistant", content: "", streamId: "other", analysisRunId: "old" }];
    state.activeStreamId = null; request.resolve(); expect(await pending).toBe(false);
    state.messages.push({ role: "assistant", content: "", streamId: "submitted", analysisRunId: "acknowledged" });
    expect(await submitWithAnalysisReceipt(() => { state.activeStreamId = "submitted"; return Promise.resolve(); }, () => state)).toBe(true);
  });
});

function Composer({ submit, store, projectId = scope.projectId, conversationId = scope.conversationId, locale = "zh" }: {
  submit: (query: string) => Promise<boolean | void>; store: ReturnType<typeof createComposerDraftStore>;
  projectId?: string; conversationId?: string; locale?: string;
}) {
  const draft = useComposerDraft(projectId, conversationId, store);
  return <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh}><InputBar
    input={draft.input} onInputChange={draft.setInput} onAccepted={draft.onAccepted} draftUnretained={draft.unretained} draftUnreadable={draft.unreadable} onRetryDraftRetention={draft.retryRetention}
    onSubmit={submit} onStop={vi.fn()} onOpenData={vi.fn()} onUploadFile={vi.fn()} isLoading={false} isUploading={false} dataReady sourceCount={1} />
  </NextIntlClientProvider>;
}
describe("composer submission continuity", () => {
  it("locks duplicate sends, preserves subsequent typing and clears only the accepted old scope after unmount", async () => {
    const store = createComposerDraftStore(() => storage()), request = deferred<boolean>(), send = vi.fn(() => request.promise);
    const view = render(<Composer submit={send} store={store} />);
    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "  原问题  " } });
    const button = screen.getByTestId("chat-submit");
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(send).toHaveBeenCalledExactlyOnceWith("原问题"); expect(button).toBeDisabled();
    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "后来写的新问题" } });
    await act(async () => request.resolve(true)); expect(screen.getByTestId("chat-input")).toHaveValue("后来写的新问题");
    const next = deferred<boolean>(); send.mockImplementationOnce(() => next.promise);
    fireEvent.click(button); view.rerender(<Composer key="next-project" projectId="project-2" submit={send} store={store} />);
    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "另一项目的问题" } });
    await act(async () => next.resolve(true));
    expect(screen.getByTestId("chat-input")).toHaveValue("另一项目的问题"); expect(store.get(scope).text).toBe("");
  });

  it("keeps rejected questions, handles thrown failures, retains IME and changes warning language without replacing text", async () => {
    const saved = storage(), store = createComposerDraftStore(() => saved), send = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("offline"));
    const view = render(<Composer submit={send} store={store} />);
    const input = screen.getByTestId("chat-input"); fireEvent.change(input, { target: { value: "收入\n成本" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true }); fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("chat-submit")); await waitFor(() => expect(screen.getByTestId("chat-submit")).not.toBeDisabled());
    expect(input).toHaveValue("收入\n成本"); fireEvent.click(screen.getByTestId("chat-submit"));
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时未能发送"); expect(input).toHaveValue("收入\n成本");
    view.rerender(<Composer submit={send} store={store} locale="en" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not send"); expect(input).toHaveValue("收入\n成本");
  });

  it("does not clear a newer controlled value when used without a draft store", async () => {
    const request = deferred<boolean>();
    function Plain() {
      const [input, setInput] = useState("旧问题");
      return <NextIntlClientProvider locale="zh" messages={zh}><InputBar input={input} onInputChange={setInput} onSubmit={() => request.promise} onStop={vi.fn()} onOpenData={vi.fn()} onUploadFile={vi.fn()} isLoading={false} isUploading={false} dataReady sourceCount={1} /></NextIntlClientProvider>;
    }
    render(<Plain />); fireEvent.click(screen.getByTestId("chat-submit"));
    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "新问题" } });
    await act(async () => request.resolve(true)); expect(screen.getByTestId("chat-input")).toHaveValue("新问题");
  });
});
