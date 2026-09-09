import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportVersionsDialog } from "@/components/reports/ReportVersionsDialog";
import * as versions from "@/lib/report-versions";
import { api } from "@/lib/api/client";
import type { ReportDocument } from "@/lib/reports";
import messages from "@/messages/zh.json";

const copy = { unnamedBlock: "区块", textBlock: "文字", unnamedPage: "页面", unnamedReport: "报表" };
const document: ReportDocument = { id: "report", project_id: "project", title: "历史报告", description: "", status: "draft", version: 1,
  created_at: "2026-09-06T00:00:00Z", updated_at: "2026-09-06T00:00:00Z",
  pages: [{ id: "page", title: "概览", order_index: 0, config: {}, blocks: [] }] };
const item = (version: number) => ({ version, title: `保存${version}`, saved_at: "2026-09-06T00:00:00Z", reason: "saved", page_count: 1, block_count: 0 });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function mount(onRestore = vi.fn(), onReload = vi.fn(), onClose = vi.fn()) {
  return render(<NextIntlClientProvider locale="zh" messages={messages}>
    <ReportVersionsDialog projectId="project" reportId="report" currentVersion={3} copy={copy} onRestore={onRestore} onReload={onReload} onClose={onClose} />
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

describe("saved report version review", () => {
  it("previews explicitly and keeps an uncertain restore reload-only after failed reconciliation", async () => {
    vi.spyOn(versions, "listReportVersions").mockResolvedValue({ report_id: "report", current_version: 3, items: [item(3), item(1)], next_before: null });
    const preview = vi.spyOn(versions, "getReportVersion").mockResolvedValue(document);
    const onRestore = vi.fn().mockRejectedValue(new Error("acknowledgement lost"));
    const onReload = vi.fn().mockRejectedValue(new Error("offline"));
    const onClose = vi.fn();
    mount(onRestore, onReload, onClose);
    await screen.findByRole("button", { name: /第 1 版/ });
    expect(preview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /第 1 版/ }));
    await screen.findByText("历史报告");
    expect(onRestore).not.toHaveBeenCalled();
    const restore = screen.getByRole("button", { name: messages.reportVersions.restore });
    fireEvent.click(restore); fireEvent.click(restore);
    await screen.findByText(messages.reportVersions.uncertain);
    expect(onRestore).toHaveBeenCalledExactlyOnceWith(1);
    fireEvent.click(screen.getByRole("button", { name: messages.reportVersions.reload }));
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: messages.reportVersions.restore })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores superseded preview reads and aborts outstanding work on close", async () => {
    vi.spyOn(versions, "listReportVersions").mockResolvedValue({ report_id: "report", current_version: 3, items: [item(2), item(1)], next_before: null });
    const older = deferred<ReportDocument>();
    const preview = vi.spyOn(versions, "getReportVersion").mockReturnValueOnce(older.promise).mockResolvedValueOnce({ ...document, version: 2, title: "较新历史" });
    const view = mount();
    fireEvent.click(await screen.findByRole("button", { name: /第 1 版/ }));
    const firstSignal = preview.mock.calls[0][4]!;
    fireEvent.click(screen.getByRole("button", { name: /第 2 版/ }));
    await screen.findByText("较新历史");
    await act(async () => { older.resolve(document); });
    expect(firstSignal.aborted).toBe(true);
    expect(screen.queryByText("历史报告")).not.toBeInTheDocument();
    const finalSignal = preview.mock.calls[1][4]!;
    view.unmount();
    expect(finalSignal.aborted).toBe(true);
  });

  it("replaces the review session when the current report version changes", async () => {
    const listing = vi.spyOn(versions, "listReportVersions").mockResolvedValue({ report_id: "report", current_version: 3, items: [item(1)], next_before: null });
    vi.spyOn(versions, "getReportVersion").mockResolvedValue(document);
    const view = mount();
    fireEvent.click(await screen.findByRole("button", { name: /第 1 版/ }));
    await screen.findByText("历史报告");
    listing.mockResolvedValue({ report_id: "report", current_version: 4, items: [item(4)], next_before: null });
    view.rerender(<NextIntlClientProvider locale="zh" messages={messages}>
      <ReportVersionsDialog projectId="project" reportId="report" currentVersion={4} copy={copy} onRestore={vi.fn()} onReload={vi.fn()} onClose={vi.fn()} />
    </NextIntlClientProvider>);
    await screen.findByRole("button", { name: /第 4 版/ });
    expect(screen.queryByText("历史报告")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: messages.reportVersions.restore })).toBeDisabled();
  });

  it("validates history scope, cursor ordering and restored acknowledgement versions", async () => {
    const get = vi.spyOn(api, "get");
    get.mockResolvedValueOnce({ data: { data: { report_id: "other", current_version: 3, items: [], next_before: null } } });
    await expect(versions.listReportVersions("project", "report")).rejects.toThrow();
    expect(get.mock.calls[0][0]).toBe("/api/v1/projects/project/reports/report/revisions");
    get.mockResolvedValueOnce({ data: { data: { report_id: "report", current_version: 3, items: [item(1), item(2)], next_before: null } } });
    await expect(versions.listReportVersions("project", "report")).rejects.toThrow();
    get.mockResolvedValueOnce({ data: { data: { ...document, project_id: "other" } } });
    await expect(versions.getReportVersion("project", "report", 1, copy)).rejects.toThrow();
    get.mockResolvedValueOnce({ data: { data: document } });
    await expect(versions.getReportVersion("project", "report", 1, copy)).resolves.toEqual(document);
    expect(get.mock.lastCall?.[0]).toBe("/api/v1/projects/project/reports/report/revisions/1");
    const post = vi.spyOn(api, "post").mockResolvedValueOnce({ data: { data: { ...document, version: 3 } } });
    await expect(versions.restoreReportVersion("project", "report", 1, 3, copy)).rejects.toThrow();
    expect(post.mock.calls[0][1]).toEqual({ expected_version: 3 });
    expect(post.mock.calls[0][0]).toBe("/api/v1/projects/project/reports/report/revisions/1/restore");
  });
});
