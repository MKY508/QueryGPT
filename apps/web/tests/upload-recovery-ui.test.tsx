import "fake-indexeddb/auto";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploadActivity } from "@/components/providers/UploadActivity";
import { refreshUploadRecovery, useProjectStore } from "@/lib/stores/project";
import { useUploadQueueStore } from "@/lib/stores/uploads";
import * as journal from "@/lib/upload-journal";
import { fileContentDigest } from "@/lib/file-content-digest";
import messages from "@/messages/zh.json";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ api }));
const original = useProjectStore.getState();
const project = crypto.randomUUID();
let restoreDialog = () => {};
const view = () => render(<StrictMode><NextIntlClientProvider locale="zh" messages={messages}><UploadActivity /></NextIntlClientProvider></StrictMode>);
beforeEach(() => {
  api.get.mockReset(); api.post.mockReset();
  const prototype = HTMLDialogElement.prototype;
  const show = Object.getOwnPropertyDescriptor(prototype, "showModal");
  const close = Object.getOwnPropertyDescriptor(prototype, "close");
  Object.defineProperties(prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
  });
  restoreDialog = () => {
    if (show) Object.defineProperty(prototype, "showModal", show); else Reflect.deleteProperty(prototype, "showModal");
    if (close) Object.defineProperty(prototype, "close", close); else Reflect.deleteProperty(prototype, "close");
  };
  useProjectStore.setState({ currentProjectId: crypto.randomUUID(), projects: [{ id: project, name: "经营项目" }] as typeof original.projects });
  useUploadQueueStore.setState({ byProject: {}, recovery: "idle" });
});
afterEach(async () => {
  cleanup();
  await refreshUploadRecovery();
  useProjectStore.getState().clearUploads(project);
  await waitFor(() => expect(useUploadQueueStore.getState().byProject[project]).toBeUndefined());
  useProjectStore.setState(original);
  useUploadQueueStore.setState({ byProject: {}, recovery: "idle" });
  vi.restoreAllMocks();
  restoreDialog();
});

describe("recovered upload interface", () => {
  it("reselects original bytes through the real project action using the retained key and digest", async () => {
    const file = new File(["id,amount\n1,10\n"], "orders.csv");
    const hash = await fileContentDigest(file);
    const pending = await journal.uploadJournal.prepare(project, crypto.randomUUID(), file, hash);
    const selected = useProjectStore.getState().currentProjectId;
    api.get.mockResolvedValue({ data: { data: null } });
    api.post.mockResolvedValue({ data: { data: { id: crypto.randomUUID(), kind: "file", project_id: project, fingerprint: hash } } });
    view();
    fireEvent.click(await screen.findByRole("button", { name: "查看文件导入" }));
    expect(await screen.findByRole("button", { name: "重新选择 orders.csv 并继续导入" })).toBeEnabled();
    const input = screen.getByLabelText("重新选择 orders.csv 并继续导入", { selector: "input" }) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(useUploadQueueStore.getState().byProject[project].items[0].status).toBe("added"));
    expect(api.post).toHaveBeenCalledOnce();
    const [url, form, options] = api.post.mock.calls[0];
    expect(url).toBe(`/api/v1/projects/${project}/sources/files`);
    expect(form.get("file")).toBe(file);
    expect(options.headers).toMatchObject({ "Idempotency-Key": pending.id, "X-File-SHA256": hash });
    expect(input.value).toBe("");
    expect(useProjectStore.getState().currentProjectId).toBe(selected);
    expect(await journal.listPendingUploads()).toEqual([]);
  });

  it("finds previous uploads on startup and resolves one without changing projects or sending files", async () => {
    const pending = await journal.uploadJournal.prepare(project, crypto.randomUUID(), { name: "orders.csv", size: 12 });
    const selected = useProjectStore.getState().currentProjectId;
    view();
    fireEvent.click(await screen.findByRole("button", { name: "查看文件导入" }));
    expect((await screen.findAllByText("经营项目")).length).toBeGreaterThan(0);
    expect(screen.getByText(messages.dataWorkspace.uploadQueue.recoveredHint)).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    api.get.mockResolvedValueOnce({ data: { data: { project_id: project, request_id: pending.id,
      source_id: crypto.randomUUID(), status: "added", filename: pending.name, byte_size: 12, fingerprint: "a".repeat(64) } } });
    fireEvent.click(screen.getByRole("button", { name: "检查 orders.csv 的导入结果" }));
    await waitFor(() => expect(useUploadQueueStore.getState().byProject[project].items[0].status).toBe("added"));
    await act(async () => { await refreshUploadRecovery(); });
    expect(await journal.listPendingUploads()).toEqual([]);
    expect(api.get).toHaveBeenCalledExactlyOnceWith(`/api/v1/projects/${project}/source-uploads/${pending.id}`, { timeout: 20000 });
    expect(api.post).not.toHaveBeenCalled();
    expect(useProjectStore.getState().currentProjectId).toBe(selected);
  });

  it("shows a retryable read failure instead of an empty-history claim", async () => {
    const read = vi.spyOn(journal, "listPendingUploads").mockRejectedValue(new Error("private storage failure"));
    view();
    fireEvent.click(await screen.findByRole("button", { name: "查看文件导入" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法读取上次的上传记录");
    expect(screen.queryByText("暂无导入记录")).not.toBeInTheDocument();
    read.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "重新读取记录" }));
    expect(await screen.findByText("暂无导入记录")).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });
});
