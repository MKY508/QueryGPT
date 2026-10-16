import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportCopyDialog } from "@/components/reports/ReportCopyDialog";
import * as copy from "@/lib/report-copy";
import * as journal from "@/lib/report-copy-journal";
import { api } from "@/lib/api/client";
import messages from "@/messages/zh.json";

const targetId = "00000000-0000-4000-8000-000000000005";
const acknowledgement = (request: copy.ReportCopyRequest): copy.ReportCopyResult => ({ request_id: request.request_id,
  project_id: "project", source_report_id: "report", source_version: 3, report_id: targetId });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function mount(onCreated = vi.fn(), onClose = vi.fn()) {
  return render(<NextIntlClientProvider locale="zh" messages={messages}>
    <ReportCopyDialog projectId="project" reportId="report" title="经营概览" version={3} onCreated={onCreated} onClose={onClose} onReload={vi.fn()} />
  </NextIntlClientProvider>);
}
const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
beforeEach(() => {
  vi.spyOn(journal, "pendingCopyForSource").mockResolvedValue(null);
  vi.spyOn(journal, "preparePendingCopy").mockImplementation(async (projectId, sourceReportId, sourceTitle, request) => ({ created: true,
    pending: { schema: 1, id: request.request_id, projectId, sourceReportId, sourceTitle, createdAt: 1, request } }));
  vi.spyOn(journal, "requirePendingCopy").mockImplementation(async (pending) => pending);
  vi.spyOn(journal, "removePendingCopy").mockResolvedValue(true);
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

describe("report copying", () => {
  it("contains keyboard focus, ignores composing Escape and returns to the opener", async () => {
    render(<button>Copy report</button>);
    const opener = screen.getByRole("button", { name: "Copy report" }); opener.focus();
    const onClose = vi.fn(), view = mount(vi.fn(), onClose);
    const create = screen.getByRole("button", { name: "创建副本" });
    await waitFor(() => expect(create).toBeEnabled());
    const name = screen.getByRole("textbox", { name: "新报告名称" }); expect(name).toHaveFocus();
    create.focus(); fireEvent.keyDown(create, { key: "Tab" });
    const close = screen.getAllByRole("button", { name: "关闭" })[0]; expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true }); expect(create).toHaveFocus();
    fireEvent.keyDown(create, { key: "Escape", isComposing: true }); expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(create, { key: "Escape" }); await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    view.unmount(); expect(opener).toHaveFocus();
  });

  it("creates only after naming/confirmation and opens only the acknowledged copy", async () => {
    const pending = deferred<copy.ReportCopyResult>();
    const create = vi.spyOn(copy, "copyReport").mockReturnValue(pending.promise);
    const onCreated = vi.fn(); mount(onCreated);
    await waitFor(() => expect(screen.getByRole("button", { name: "创建副本" })).toBeEnabled());
    const name = screen.getByRole("textbox", { name: "新报告名称" });
    expect(name).toHaveValue("经营概览（副本）");
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: "九月经营" } });
    const button = screen.getByRole("button", { name: "创建副本" });
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const request = create.mock.calls[0][2];
    expect(request).toEqual({ title: "九月经营", expected_version: 3, request_id: expect.any(String) });
    expect(name).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "关闭" }).every((element) => element.hasAttribute("disabled"))).toBe(true);
    expect(onCreated).not.toHaveBeenCalled();
    await act(async () => pending.resolve(acknowledgement(request)));
    fireEvent.click(await screen.findByRole("button", { name: "打开副本" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledExactlyOnceWith(targetId));
  });

  it("resolves an uncertain result without writing and retries with exactly the original intent", async () => {
    const create = vi.spyOn(copy, "copyReport").mockRejectedValueOnce(new Error("response lost"))
      .mockImplementation(async (_project, _report, request) => acknowledgement(request));
    const resolve = vi.spyOn(copy, "resolveReportCopy").mockRejectedValueOnce(new Error("offline")).mockResolvedValue(null);
    mount();
    await waitFor(() => expect(screen.getByRole("button", { name: "创建副本" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "创建副本" }));
    fireEvent.click(await screen.findByRole("button", { name: "查看创建结果" }));
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(messages.reportCopy.uncertain)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试创建" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "查看创建结果" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "查看创建结果" }));
    const retry = await screen.findByRole("button", { name: "重试创建" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox", { name: "新报告名称" })).toBeDisabled();
    fireEvent.click(retry);
    await screen.findByRole("button", { name: "打开副本" });
    expect(create.mock.calls[1][2]).toBe(create.mock.calls[0][2]);
    expect(resolve.mock.calls[0][2]).toBe(create.mock.calls[0][2]);
  });

  it("aborts departed result checks and ignores their late acknowledgements", async () => {
    const create = vi.spyOn(copy, "copyReport").mockRejectedValue(new Error("response lost"));
    const late = deferred<copy.ReportCopyResult>();
    const resolve = vi.spyOn(copy, "resolveReportCopy").mockReturnValue(late.promise);
    const onCreated = vi.fn();
    const view = mount(onCreated);
    await waitFor(() => expect(screen.getByRole("button", { name: "创建副本" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "创建副本" }));
    fireEvent.click(await screen.findByRole("button", { name: "查看创建结果" }));
    await waitFor(() => expect(resolve).toHaveBeenCalledOnce());
    expect(resolve.mock.calls[0][3]?.aborted).toBe(false);
    view.unmount(); expect(resolve.mock.calls[0][3]?.aborted).toBe(true);
    await act(async () => late.resolve(acknowledgement(create.mock.calls[0][2])));
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("validates scope, request identity and target and preserves Unicode title limits", async () => {
    const request = { request_id: "00000000-0000-4000-8000-000000000003", expected_version: 3, title: "Copy" };
    const good = acknowledgement(request);
    const envelope = (value: unknown) => ({ data: { data: value } });
    const post = vi.spyOn(api, "post").mockResolvedValue(envelope(good));
    await expect(copy.copyReport("project", "report", request)).resolves.toEqual(good);
    expect(post.mock.calls[0][1]).toBe(request);
    expect(post.mock.calls[0][0]).toBe("/api/v1/projects/project/reports/report/copies");
    for (const field of ["project_id", "source_report_id", "request_id", "source_version", "report_id"] as const) {
      post.mockResolvedValueOnce(envelope({ ...good, [field]: "wrong" }));
      await expect(copy.copyReport("project", "report", request)).rejects.toThrow();
    }
    post.mockResolvedValueOnce(envelope(null));
    await expect(copy.resolveReportCopy("project", "report", request)).resolves.toBeNull();
    expect(post.mock.lastCall?.[0]).toBe("/api/v1/projects/project/reports/report/copies/resolve");
    post.mockResolvedValueOnce(envelope(null));
    await expect(copy.copyReport("project", "report", request)).rejects.toThrow();
    const deniedRead = { response: { status: 403 } };
    post.mockRejectedValueOnce(deniedRead);
    await expect(copy.resolveReportCopy("project", "report", request)).rejects.toBe(deniedRead);
    post.mockRejectedValueOnce({ response: { status: 409, data: { detail: { code: "report_copy_unavailable" } } } });
    await expect(copy.copyReport("project", "report", request)).rejects.toMatchObject({ kind: "unavailable" });
    const title = copy.reportCopyTitle("😀".repeat(200), "（副本）");
    expect([...title]).toHaveLength(200); expect(title.endsWith("（副本）")).toBe(true);
    expect(title).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
  });
});
