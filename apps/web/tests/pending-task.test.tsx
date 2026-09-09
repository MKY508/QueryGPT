import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createPendingTaskStore, parsePendingTask, type PendingTask } from "@/lib/pending-task";
import { usePendingTask } from "@/components/chat/usePendingTask";
import { submitWithAnalysisReceipt } from "@/lib/chat-submission";
import type { ChatMessage } from "@/lib/types/chat";
import { PENDING_TASK_STORAGE_KEY } from "@/lib/storage/legacy";

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
