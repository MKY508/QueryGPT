import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectDataSource, VisualCleaningOperation, VisualCleaningPreview } from "@/lib/types/api";
import { VisualCleaningEditor } from "@/components/chat/VisualCleaningEditor";
import messages from "@/messages/zh.json";

const http = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ api: http }));
import { useProjectStore } from "@/lib/stores/project";

const source: ProjectDataSource = { id: "clean-source", project_id: "clean-project", kind: "file", name: "门店订单.csv", format: "csv", status: "ready", profile_data: { sample: [{ 渠道: " 直营 " }] }, created_at: "2026-09-06", updated_at: "2026-09-06" };
const operations: VisualCleaningOperation[] = [{ operation: "trim_text", column: "渠道" }];
const preview: VisualCleaningPreview = { source_id: source.id, operations_hash: "a".repeat(64), source_fingerprint: "b".repeat(64), preview_output_fingerprint: "c".repeat(64), before: { rows: 1, columns: 1, sample: [{ 渠道: " 直营 " }] }, after: { rows: 1, columns: 1, sample: [{ 渠道: "直营" }] }, changes: [{ column: "渠道", changed_count: 1 }], comparison_basis: "position", can_apply: true };
const original = useProjectStore.getState();
const response = (data: unknown) => ({ data: { data } });
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  http.post.mockReset();
  document.documentElement.lang = "zh";
  useProjectStore.setState({ currentProjectId: source.project_id, cleaningAction: null, cleaningPreviewBySource: {}, error: null, refreshCurrent: vi.fn().mockResolvedValue(undefined) });
});
afterEach(() => {
  cleanup();
  useProjectStore.setState({ currentProjectId: null, cleaningAction: null, cleaningPreviewBySource: {}, error: null, refreshCurrent: original.refreshCurrent });
});

describe("cleaning review session", () => {
  it("keeps edits through refresh, reviews again after returning, and protects the final apply", async () => {
    const write = deferred();
    http.post.mockImplementation((url: string) => url.endsWith("/preview") ? Promise.resolve(response(preview)) : write.promise);
    const onClose = vi.fn();
    const view = (value: ProjectDataSource) => <NextIntlClientProvider locale="zh" messages={messages}><VisualCleaningEditor source={value} columns={["渠道"]} onClose={onClose} /></NextIntlClientProvider>;
    const { rerender } = render(view(source));
    expect(screen.getByRole("heading", { name: source.name })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: /^去除首尾空格/ }));
    rerender(view({ ...source, profile_data: { ...source.profile_data } }));
    expect(screen.getByRole("button", { name: /移除整理步骤/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "预览变化" }));
    await screen.findByRole("button", { name: "应用整理" });
    expect(screen.getByRole("heading", { name: "变化预览" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: /^去除首尾空格/ })).not.toBeInTheDocument();
    expect(http.post).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "返回修改" }));
    expect(screen.queryByRole("button", { name: "应用整理" })).not.toBeInTheDocument();
    expect(useProjectStore.getState().cleaningPreviewBySource[source.id]).toBeUndefined();
    expect(screen.getByRole("button", { name: /移除整理步骤/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "预览变化" }));
    fireEvent.click(await screen.findByRole("button", { name: "应用整理" }));
    expect(screen.getByRole("button", { name: "关闭数据整理编辑器" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "返回修改" })).toBeDisabled();
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { write.resolve(response({ recipe: {}, revision: {}, preflight: {} })); });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(http.post).toHaveBeenCalledTimes(3);
  });

  it("closes a pending preview and resets the session for a different source", async () => {
    const pending = deferred();
    http.post.mockReturnValue(pending.promise);
    const onClose = vi.fn();
    const view = (value: ProjectDataSource) => <NextIntlClientProvider locale="zh" messages={messages}><VisualCleaningEditor source={value} columns={["渠道"]} onClose={onClose} /></NextIntlClientProvider>;
    const { rerender } = render(view(source));
    fireEvent.click(screen.getByRole("button", { name: /^去除首尾空格/ }));
    fireEvent.click(screen.getByRole("button", { name: "预览变化" }));
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: messages.visualCleaning.discardAndClose }));
    expect(onClose).toHaveBeenCalledOnce();
    rerender(view({ ...source, id: "another-source" }));
    await act(async () => { pending.resolve(response(preview)); });
    expect(screen.queryByRole("button", { name: /移除整理步骤/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "应用整理" })).not.toBeInTheDocument();
    expect(useProjectStore.getState().cleaningPreviewBySource[source.id]).toBeUndefined();
  });

  it("never revives an invalidated preview or clears a newer request for the same source", async () => {
    const old = deferred(); const next = deferred();
    http.post.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const first = useProjectStore.getState().previewSourceCleaning(source.id, operations);
    useProjectStore.getState().clearSourceCleaningPreview(source.id);
    const second = useProjectStore.getState().previewSourceCleaning(source.id, operations);
    const owner = useProjectStore.getState().cleaningAction;
    old.resolve(response(preview)); await first;
    expect(useProjectStore.getState().cleaningPreviewBySource[source.id]).toBeUndefined();
    expect(useProjectStore.getState().cleaningAction).toBe(owner);
    const fresh = { ...preview, operations_hash: "d".repeat(64) };
    next.resolve(response(fresh)); await second;
    expect(useProjectStore.getState().cleaningPreviewBySource[source.id]).toEqual(fresh);
    expect(useProjectStore.getState().cleaningAction).toBeNull();
  });

  it("ignores a late failure after leaving and returning to the same project", async () => {
    const old = deferred(); http.post.mockReturnValueOnce(old.promise);
    const first = useProjectStore.getState().previewSourceCleaning(source.id, operations).catch(() => undefined);
    await useProjectStore.getState().selectProject("elsewhere");
    await useProjectStore.getState().selectProject(source.project_id);
    useProjectStore.setState({ error: "New session message" });
    old.reject(new Error("old failure")); await first;
    expect(useProjectStore.getState().error).toBe("New session message");
    expect(useProjectStore.getState().cleaningAction).toBeNull();
  });

  it("rejects duplicate applies across navigation without taking ownership of another operation", async () => {
    const write = deferred(); http.post.mockReturnValueOnce(write.promise);
    useProjectStore.setState({ cleaningPreviewBySource: { [source.id]: preview } });
    const first = useProjectStore.getState().applySourceCleaning(source.id, operations);
    await expect(useProjectStore.getState().applySourceCleaning(source.id, operations)).rejects.toThrow();
    await useProjectStore.getState().selectProject("elsewhere");
    await useProjectStore.getState().selectProject(source.project_id);
    useProjectStore.setState({ cleaningPreviewBySource: { [source.id]: preview } });
    await expect(useProjectStore.getState().applySourceCleaning(source.id, operations)).rejects.toThrow();
    await expect(useProjectStore.getState().previewSourceCleaning(source.id, operations)).rejects.toThrow();
    const newer = { sourceId: "another-source", kind: "preview" as const };
    useProjectStore.setState({ cleaningAction: newer, error: "New session message" });
    write.resolve(response({})); await first;
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(useProjectStore.getState().cleaningAction).toBe(newer);
    expect(useProjectStore.getState().error).toBe("New session message");
  });

  it("requires a new preview after a stale apply and refuses non-applicable previews", async () => {
    useProjectStore.setState({ cleaningPreviewBySource: { [source.id]: { ...preview, can_apply: false } } });
    await expect(useProjectStore.getState().applySourceCleaning(source.id, operations)).rejects.toThrow();
    expect(http.post).not.toHaveBeenCalled();
    useProjectStore.setState({ cleaningPreviewBySource: { [source.id]: preview } });
    http.post.mockRejectedValueOnce({ response: { status: 409 } });
    await expect(useProjectStore.getState().applySourceCleaning(source.id, operations)).rejects.toBeDefined();
    expect(useProjectStore.getState().cleaningPreviewBySource[source.id]).toBeUndefined();
    await expect(useProjectStore.getState().applySourceCleaning(source.id, operations)).rejects.toThrow();
    expect(http.post).toHaveBeenCalledTimes(1);
  });
});
