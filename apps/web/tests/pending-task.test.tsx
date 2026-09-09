import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { createPendingTaskStore, parsePendingTask, type PendingTask } from "@/lib/pending-task";
import { usePendingTask } from "@/components/chat/usePendingTask";
import { submitWithAnalysisReceipt } from "@/lib/chat-submission";
import type { ChatMessage } from "@/lib/types/chat";
import { PENDING_TASK_STORAGE_KEY } from "@/lib/storage/legacy";
import { PendingTaskSaveNotice } from "@/components/chat/PendingTaskSaveNotice";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";

function setup() {
  const values = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
  return { values, storage, store: createPendingTaskStore(() => storage) };
}
const task: PendingTask = { query: "  核对收入\n保留原问题  ", projectId: "project-1",
  validationSelection: [{ entry_id: "definition-1", expected_active_revision_id: "revision-1" }] };

describe("parked investigation tasks", () => {
  it.each(["zh", "en"] as const)("keeps navigation blocked on failure and retries explicitly in %s", locale => {
    const { store, storage } = setup(); store.write(task);
    const before = store.getSnapshot(), navigate = vi.fn();
    const messages = locale === "zh" ? zh : en;
    function Harness() {
      const pending = usePendingTask(task.projectId, store);
      return <NextIntlClientProvider locale={locale} messages={messages}>
        <button onClick={() => { if (pending.write({ ...task, query: "New question" })) navigate(); }}>Manage service</button>
        {pending.failedTask && <PendingTaskSaveNotice onRetry={() => { if (pending.retryWrite()) navigate(); }} onDismiss={pending.dismissFailure} />}
      </NextIntlClientProvider>;
    }
    render(<Harness />);
    storage.setItem.mockImplementationOnce(() => { throw new Error("quota"); });
    fireEvent.click(screen.getByRole("button", { name: "Manage service" }));
    expect(screen.getByRole("alert")).toHaveTextContent(messages.messageList.taskSaveFailed);
    expect(navigate).not.toHaveBeenCalled(); expect(store.getSnapshot()).toBe(before);
    fireEvent.click(screen.getByRole("button", { name: messages.messageList.stayWithTask }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); expect(navigate).not.toHaveBeenCalled();
    storage.setItem.mockImplementationOnce(() => { throw new Error("quota"); });
    fireEvent.click(screen.getByRole("button", { name: "Manage service" }));
    fireEvent.click(screen.getByRole("button", { name: messages.messageList.retryTaskSave }));
    expect(navigate).toHaveBeenCalledOnce(); expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(JSON.parse(store.getSnapshot()!).query).toBe("New question");
  });

  it("invalidates an old failed-write retry when another task replaces its baseline", () => {
    const { store, storage } = setup(); store.write(task);
    const view = renderHook(() => usePendingTask(task.projectId, store));
    storage.setItem.mockImplementationOnce(() => { throw new Error("quota"); });
    act(() => { expect(view.result.current.write({ ...task, query: "Unretained question" })).toBe(false); });
    const retry = view.result.current.retryWrite;
    expect(view.result.current.failedTask?.query).toBe("Unretained question");
    act(() => store.write({ ...task, query: "Later question" }));
    const later = store.getSnapshot();
    expect(view.result.current.failedTask).toBeNull(); expect(retry()).toBe(false);
    expect(store.getSnapshot()).toBe(later);
  });

  it("isolates the project immediately and restores the exact question and validation context after remount", () => {
    const { store } = setup(); store.write(task);
    const view = renderHook(({ projectId }) => usePendingTask(projectId, store), { initialProps: { projectId: "project-1" as string | null } });
    expect(view.result.current.task).toEqual(task);
    view.rerender({ projectId: "project-2" }); expect(view.result.current.task).toBeNull();
    expect(view.result.current.clear()).toBe(false);
    view.rerender({ projectId: null }); expect(view.result.current.task).toBeNull();
    view.unmount();
    const restored = renderHook(() => usePendingTask("project-1", store));
    expect(restored.result.current.task).toEqual(task);
  });

  it("does not let an old action clear a newly retained task with identical text and context", () => {
    const { store } = setup(); store.write(task);
    const view = renderHook(() => usePendingTask("project-1", store));
    const oldClear = view.result.current.clear, oldSnapshot = store.getSnapshot();
    act(() => store.write(task));
    expect(store.getSnapshot()).not.toBe(oldSnapshot);
    expect(oldClear()).toBe(false);
    expect(view.result.current.task).toEqual(task);
    act(() => { expect(view.result.current.clear()).toBe(true); });
    expect(view.result.current.task).toBeNull();
  });

  it("retains an unaccepted submission and protects a newer task when the earlier stream eventually receives a run", async () => {
    const { store } = setup(); store.write(task);
    const original = store.getSnapshot();
    const state = { activeStreamId: null as string | null, messages: [] as ChatMessage[] };
    expect(await submitWithAnalysisReceipt(async () => {}, () => state)).toBe(false);
    expect(store.getSnapshot()).toBe(original);
    let finish!: () => void;
    const submitted = submitWithAnalysisReceipt(() => {
      state.activeStreamId = "submitted";
      return new Promise<void>(resolve => { finish = resolve; });
    }, () => state);
    store.write({ ...task, projectId: "project-2" });
    const newer = store.getSnapshot();
    state.messages.push({ role: "assistant", content: "", streamId: "submitted", analysisRunId: "run-1" });
    finish(); expect(await submitted).toBe(true);
    expect(store.clearIfUnchanged(original)).toBe(false); expect(store.getSnapshot()).toBe(newer);
  });

  it("does not discard the previous snapshot when storage writes or removal fail", () => {
    const { store, storage } = setup(); store.write(task);
    const original = store.getSnapshot();
    storage.setItem.mockImplementationOnce(() => { throw new Error("quota"); });
    expect(() => store.write({ ...task, query: "Another question" })).toThrow("quota");
    expect(store.getSnapshot()).toBe(original);
    storage.removeItem.mockImplementationOnce(() => { throw new Error("denied"); });
    expect(store.clearIfUnchanged(original)).toBe(false); expect(store.getSnapshot()).toBe(original);
  });

  it("rejects malformed validation context without deleting unreadable task data", () => {
    const { store, values, storage } = setup();
    values.set(PENDING_TASK_STORAGE_KEY, "{broken");
    const view = renderHook(() => usePendingTask("project-1", store));
    expect(view.result.current.task).toBeNull();
    expect(storage.removeItem).not.toHaveBeenCalledWith(PENDING_TASK_STORAGE_KEY);
    expect(values.get(PENDING_TASK_STORAGE_KEY)).toBe("{broken");
    expect(parsePendingTask({ ...task, validationSelection: [{ entry_id: "definition-1" }] })).toBeNull();
    expect(parsePendingTask({ ...task, query: "   " })).toBeNull();
  });
});
