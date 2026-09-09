import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import { UploadQueueView, type UploadQueueActions } from "@/components/uploads/UploadQueueView";
import type { UploadSnapshot } from "@/lib/upload-state";
import messages from "@/messages/zh.json";

afterEach(cleanup);
const commands = () => ({ resumeUploads: vi.fn(), pauseUploads: vi.fn(), retryUpload: vi.fn(), checkUpload: vi.fn(), reselectUpload: vi.fn(), cancelQueuedUpload: vi.fn(), cancelQueuedUploads: vi.fn(), clearUploads: vi.fn() });
const view = (queue: UploadSnapshot, actions: UploadQueueActions) => <NextIntlClientProvider locale="zh" messages={messages}><UploadQueueView queue={queue} actions={actions} /></NextIntlClientProvider>;
const pending: UploadSnapshot = { busy: true, notice: null, items: [
  { id: "active", name: "门店.csv", status: "saving", progress: 100, retryable: false },
  { id: "waiting", name: "下期.csv", status: "queued", progress: null, retryable: false },
] };

it("keeps saving distinct from success and pauses only the remaining files", () => {
  const actions = commands();
  const { rerender } = render(view(pending, actions));
  expect(screen.getByRole("status")).toHaveTextContent("已加入 0 / 2 份文件");
  expect(screen.getByRole("progressbar", { name: "门店.csv 的上传进度" })).toHaveAttribute("value", "100");
  expect(screen.queryByRole("button", { name: "取消上传 门店.csv" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "暂缓后续文件" }));
  expect(actions.pauseUploads).toHaveBeenCalledOnce();
  rerender(view({ ...pending, paused: true }, actions));
  expect(screen.getByText(messages.dataWorkspace.uploadQueue.pausePending)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "继续其余文件" })).toBeNull();
  rerender(view({ ...pending, busy: false, paused: true, items: [{ ...pending.items[0], status: "added" }, pending.items[1]] }, actions));
  fireEvent.click(screen.getByRole("button", { name: "继续其余文件" }));
  fireEvent.click(screen.getByRole("button", { name: "取消上传 下期.csv" }));
  expect(actions.resumeUploads).toHaveBeenCalledOnce();
  expect(actions.cancelQueuedUpload).toHaveBeenCalledWith("waiting");
});

it("keeps uncertain verification cancellable and reselects the original file through its owner", () => {
  const actions = commands();
  const queue: UploadSnapshot = { busy: true, notice: null, items: [{ id: "recover", name: "原文件.csv", status: "uncertain", progress: 42, retryable: false, recovered: true, reselectable: true, verifying: true }] };
  const { rerender, container } = render(view(queue, actions));
  expect(screen.getByRole("progressbar", { name: "原文件.csv 的读取进度" })).toHaveAttribute("value", "42");
  expect(screen.getByRole("button", { name: "检查 原文件.csv 的导入结果" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "取消读取 原文件.csv" }));
  expect(actions.cancelQueuedUpload).toHaveBeenCalledWith("recover");
  rerender(view({ ...queue, busy: false, paused: true, items: [{ ...queue.items[0], verifying: false }] }, actions));
  const file = new File(["门店\n直营店"], "原文件.csv");
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [file] } });
  expect(actions.reselectUpload).toHaveBeenCalledWith("recover", file);
  expect(input.value).toBe("");
  expect(screen.queryByRole("button", { name: /重试上传/ })).toBeNull();
});

it("does not reuse a clearing decision after unresolved records change and return", () => {
  const actions = commands();
  const queue: UploadSnapshot = { busy: false, notice: null, items: [{ id: "first", name: "原文件.csv", status: "uncertain", progress: null, retryable: false }] };
  const { rerender } = render(view(queue, actions));
  fireEvent.click(screen.getByRole("button", { name: "清除导入记录" }));
  expect(screen.getByRole("button", { name: "确认清除记录" })).toBeInTheDocument();
  rerender(view({ ...queue, items: [] }, actions));
  rerender(view(queue, actions));
  expect(screen.queryByRole("button", { name: "确认清除记录" })).toBeNull();
  expect(actions.clearUploads).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "清除导入记录" }));
  fireEvent.click(screen.getByRole("button", { name: "确认清除记录" }));
  expect(actions.clearUploads).toHaveBeenCalledOnce();
});
