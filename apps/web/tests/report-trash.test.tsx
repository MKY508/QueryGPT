import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportTrashDialog } from "@/components/reports/ReportTrashDialog";
import * as trash from "@/lib/report-trash";
import * as recovery from "@/lib/report-recovery";
import { api } from "@/lib/api/client";
import { deleteReport, type ReportDocument, type ReportLibraryPage } from "@/lib/reports";
import messages from "@/messages/zh.json";

const copy = { unnamedBlock: "区块", textBlock: "文字", unnamedPage: "页面", unnamedReport: "报告" };
const document: ReportDocument = { id: "report", project_id: "project", title: "保留报告", description: "", status: "draft", version: 2,
  deleted_at: "2026-09-06T00:00:00Z", created_at: "2026-09-06T00:00:00Z", updated_at: "2026-09-06T00:00:00Z",
  pages: [{ id: "page", title: "概览", order_index: 0, config: {}, blocks: [] }] };
const directory: ReportLibraryPage = { items: [{ ...document, page_count: 1, block_count: 0 }], total: 1, count: 1, page: 1, page_count: 1, page_size: 24 };
const empty = { ...directory, items: [], count: 0, total: 0 };
const envelope = (value: unknown) => ({ data: { data: value } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function mount(onChanged = vi.fn(), onClose = vi.fn()) {
  return render(<NextIntlClientProvider locale="zh" messages={messages}>
    <ReportTrashDialog projectId="project" copy={copy} onChanged={onChanged} onClose={onClose} />
  </NextIntlClientProvider>);
}
const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } },
  });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

describe("report trash", () => {
  it("searches explicitly, protects composition and replaces a pending read when cleared", async () => {
    const pending = deferred<ReportLibraryPage>();
    const list = vi.spyOn(trash, "listReportTrash").mockResolvedValueOnce(directory).mockReturnValueOnce(pending.promise).mockResolvedValue(directory);
    const view = mount();
    const search = screen.getByRole("searchbox");
    await waitFor(() => expect(search).toHaveFocus());
    fireEvent.change(search, { target: { value: "保留" } });
    expect(list).toHaveBeenCalledOnce();
    expect(fireEvent.keyDown(search, { key: "Enter", isComposing: true })).toBe(false);
    expect(fireEvent.keyDown(search, { key: "Escape", isComposing: true })).toBe(false);
    expect(search).toHaveValue("保留");
    fireEvent.submit(screen.getByRole("search"));
    expect(list.mock.calls[1][2]).toBe("保留");
    expect(search).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: messages.reportIndex.clearSearch }));
    expect(list.mock.calls[2][2]).toBe("");
    expect(list.mock.calls[1][3]?.aborted).toBe(true);
    await screen.findByRole("button", { name: /保留报告/ });
    await act(async () => pending.resolve(empty));
    expect(screen.getByRole("button", { name: /保留报告/ })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "最新" } });
    fireEvent.submit(screen.getByRole("search"));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(4));
    expect(list.mock.calls[3][2]).toBe("最新"); expect(search).toHaveFocus();
    view.unmount(); expect(list.mock.calls[3][3]?.aborted).toBe(true);
  });

  it("requires preview and separate permanent confirmation, then removes the acknowledged item", async () => {
    vi.spyOn(trash, "listReportTrash").mockResolvedValueOnce(directory).mockResolvedValue(empty);
    const preview = vi.spyOn(trash, "previewTrashedReport").mockResolvedValue(document);
    const deletion = deferred<void>();
    const purge = vi.spyOn(trash, "permanentlyDeleteReport").mockReturnValue(deletion.promise);
    const onChanged = vi.fn();
    mount(onChanged);
    await screen.findByRole("button", { name: /保留报告/ });
    expect(preview).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "彻底删除" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /保留报告/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "彻底删除" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "彻底删除" }));
    expect(purge).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("历史版本及此设备上的恢复草稿");
    const confirm = screen.getByRole("button", { name: "确认彻底删除" });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(purge).toHaveBeenCalledExactlyOnceWith("project", "report", 2);
    expect(screen.getByRole("button", { name: "关闭回收站" })).toBeDisabled();
    await act(async () => deletion.resolve());
    expect(await screen.findByText("回收站是空的。")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("报告已彻底删除");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("keeps an uncertain restore reconciliation-only even when its reload fails", async () => {
    const listing = vi.spyOn(trash, "listReportTrash").mockResolvedValueOnce(directory).mockRejectedValue(new Error("offline"));
    vi.spyOn(trash, "previewTrashedReport").mockResolvedValue(document);
    const restore = vi.spyOn(trash, "restoreTrashedReport").mockRejectedValue(new Error("response lost"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /保留报告/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "恢复报告" })).toBeEnabled());
    const button = screen.getByRole("button", { name: "恢复报告" });
    fireEvent.click(button); fireEvent.click(button);
    await screen.findByText(messages.reportTrash.uncertain);
    fireEvent.click(screen.getByRole("button", { name: "刷新回收站" }));
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(messages.reportTrash.uncertain)).toBeInTheDocument();
    expect(button).toBeDisabled();
    expect(restore).toHaveBeenCalledExactlyOnceWith("project", "report", 2, copy);
  });

  it("ignores late previews after a selection change and aborts reads on unmount", async () => {
    vi.spyOn(trash, "listReportTrash").mockResolvedValue({ ...directory, total: 2, count: 2,
      items: [directory.items[0], { ...directory.items[0], id: "other", title: "第二份报告" }] });
    const late = deferred<ReportDocument>();
    const signals: AbortSignal[] = [];
    vi.spyOn(trash, "previewTrashedReport").mockImplementation((_project, report, _version, _copy, signal) => {
      signals.push(signal!); return report === "report" ? late.promise : Promise.resolve({ ...document, id: "other", title: "第二份报告" });
    });
    const purge = vi.spyOn(trash, "permanentlyDeleteReport").mockResolvedValue();
    const view = mount();
    fireEvent.click(await screen.findByRole("button", { name: /保留报告/ }));
    fireEvent.click(screen.getByRole("button", { name: /第二份报告/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "彻底删除" })).toBeEnabled());
    await act(async () => late.resolve(document));
    fireEvent.click(screen.getByRole("button", { name: "彻底删除" }));
    expect(screen.getByRole("alert")).toHaveTextContent("第二份报告");
    expect(purge).not.toHaveBeenCalled();
    expect(signals[0].aborted).toBe(true);
    view.unmount(); expect(signals[1].aborted).toBe(true);
  });

  it("validates scope and acknowledgements; only confirmed permanent deletion clears drafts", async () => {
    const clear = vi.spyOn(recovery, "removeRecoveryDraftsForReport").mockResolvedValue();
    const get = vi.spyOn(api, "get").mockResolvedValue(envelope({ ...directory, items: [{ ...directory.items[0], project_id: "foreign" }] }));
    await expect(trash.listReportTrash("project")).rejects.toThrow();
    get.mockResolvedValue(envelope(directory));
    await expect(trash.listReportTrash("project")).resolves.toEqual(directory);
    expect(get.mock.lastCall?.[0]).toBe("/api/v1/projects/project/report-trash");
    get.mockResolvedValueOnce(envelope(document));
    await expect(trash.previewTrashedReport("project", "report", 2, copy)).resolves.toEqual(document);
    expect(get.mock.lastCall?.[0]).toBe("/api/v1/projects/project/report-trash/report");
    const del = vi.spyOn(api, "delete").mockResolvedValue(envelope({ id: "report", deleted: true }));
    await deleteReport("project", "report", 1);
    expect(del.mock.calls[0][1]).toEqual({ params: { expected_version: 1 } });
    expect(clear).not.toHaveBeenCalled();
    del.mockRejectedValueOnce(new Error("response lost"));
    await expect(trash.permanentlyDeleteReport("project", "report", 2)).rejects.toThrow();
    del.mockResolvedValueOnce(envelope({ id: "foreign", deleted: true }));
    await expect(trash.permanentlyDeleteReport("project", "report", 2)).rejects.toThrow();
    expect(clear).not.toHaveBeenCalled();
    await trash.permanentlyDeleteReport("project", "report", 2);
    expect(del.mock.lastCall?.[0]).toBe("/api/v1/projects/project/report-trash/report");
    expect(clear).toHaveBeenCalledExactlyOnceWith("project", "report");
    const post = vi.spyOn(api, "post").mockResolvedValue(envelope({ ...document, version: 3, deleted_at: null, project_id: "foreign" }));
    await expect(trash.restoreTrashedReport("project", "report", 2, copy)).rejects.toThrow();
    expect(post.mock.lastCall?.[0]).toBe("/api/v1/projects/project/report-trash/report/restore");
  });
});
