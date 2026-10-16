import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportCopyDialog } from "@/components/reports/ReportCopyDialog";
import * as copy from "@/lib/report-copy";
import * as journal from "@/lib/report-copy-journal";
import messages from "@/messages/zh.json";

const intent = () => ({ request_id: crypto.randomUUID(), expected_version: 3, title: "下期报告" });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function mount(project: string, source: string, onCreated = vi.fn(), onClose = vi.fn(), version = 3) {
  return render(<NextIntlClientProvider locale="zh" messages={messages}>
    <ReportCopyDialog projectId={project} reportId={source} title="经营概览" version={version} onCreated={onCreated} onClose={onClose} onReload={vi.fn()} />
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

describe("copy interruption recovery", () => {
  it("persists before sending and reopens by checking the old intent without another write", async () => {
    const project = crypto.randomUUID(), source = crypto.randomUUID(), target = crypto.randomUUID();
    const late = deferred<copy.ReportCopyResult>();
    const create = vi.spyOn(copy, "copyReport").mockImplementation(async (_project, _source, request) => {
      expect((await journal.pendingCopyForSource(project, source))!.request).toEqual(request);
      return late.promise;
    });
    const view = mount(project, source);
    await waitFor(() => expect(screen.getByRole("button", { name: "创建副本" })).toBeEnabled());
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "下期报告" } });
    fireEvent.click(screen.getByRole("button", { name: "创建副本" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const pending = (await journal.pendingCopyForSource(project, source))!;
    view.unmount();
    const ack = { request_id: pending.id, project_id: project, source_report_id: source, source_version: 3, report_id: target };
    const resolve = vi.spyOn(copy, "resolveReportCopy").mockResolvedValue(ack);
    const onCreated = vi.fn();
    mount(project, source, onCreated, vi.fn(), 99);
    await screen.findByRole("button", { name: "打开副本" });
    expect(resolve.mock.calls[0][2]).toEqual(pending.request);
    expect(screen.getByRole("textbox")).toHaveValue("下期报告");
    expect(create).toHaveBeenCalledTimes(1);
    await act(async () => late.resolve(ack));
    expect(onCreated).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "打开副本" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledExactlyOnceWith(target));
    expect(await journal.pendingCopyForSource(project, source)).toBeNull();
  });

  it("preserves an unknown operation on close and dismisses only after separate confirmation", async () => {
    const project = crypto.randomUUID(), source = crypto.randomUUID();
    const pending = (await journal.preparePendingCopy(project, source, "经营概览", intent())).pending;
    const create = vi.spyOn(copy, "copyReport");
    vi.spyOn(copy, "resolveReportCopy").mockRejectedValue(new Error("offline"));
    const closed = vi.fn();
    const view = mount(project, source, vi.fn(), closed);
    await screen.findByText(messages.reportCopy.uncertain);
    fireEvent.click(screen.getAllByRole("button", { name: "关闭" })[0]);
    expect(closed).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(await journal.requirePendingCopy(pending)).toEqual(pending);
    mount(project, source, vi.fn(), closed);
    await screen.findByText(messages.reportCopy.uncertain);
    fireEvent.click(screen.getByRole("button", { name: "移除提醒" }));
    expect(screen.getByText(messages.reportCopy.dismissWarning)).toBeInTheDocument();
    expect(await journal.requirePendingCopy(pending)).toEqual(pending);
    fireEvent.click(screen.getByRole("button", { name: "确认移除" }));
    await waitFor(() => expect(closed).toHaveBeenCalledTimes(2));
    expect(await journal.pendingCopyForSource(project, source)).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("does not dispatch on storage failure or revive a reminder removed in another window", async () => {
    const project = crypto.randomUUID(), source = crypto.randomUUID();
    const create = vi.spyOn(copy, "copyReport");
    const prepare = vi.spyOn(journal, "preparePendingCopy").mockRejectedValueOnce(new Error("Full"));
    const view = mount(project, source);
    await waitFor(() => expect(screen.getByRole("button", { name: "创建副本" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "创建副本" }));
    await screen.findByText(messages.reportCopy.storageFailed);
    expect(create).not.toHaveBeenCalled(); view.unmount(); prepare.mockRestore();
    const pending = (await journal.preparePendingCopy(project, source, "经营概览", intent())).pending;
    vi.spyOn(copy, "resolveReportCopy").mockResolvedValue(null);
    mount(project, source);
    await screen.findByRole("button", { name: "重试创建" });
    await journal.removePendingCopy(pending);
    const replacement = (await journal.preparePendingCopy(project, source, "另一份操作", intent())).pending;
    fireEvent.click(screen.getByRole("button", { name: "重试创建" }));
    await screen.findByText(messages.reportCopy.gone);
    expect(create).not.toHaveBeenCalled();
    expect(await journal.requirePendingCopy(replacement)).toEqual(replacement);
  });
});
