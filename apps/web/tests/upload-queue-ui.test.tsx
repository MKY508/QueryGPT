import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InputBar } from "@/components/chat/InputBar";
import { DataWorkspacePanel } from "@/components/chat/DataWorkspacePanel";
import { ProjectUploadQueue, SourceUploadQueue } from "@/components/chat/SourceUploadQueue";
import { useProjectStore } from "@/lib/stores/project";
import { useUploadQueueStore } from "@/lib/stores/uploads";
import { FILE_UPLOAD_ACCEPT } from "@/lib/file-formats";
import messages from "@/messages/zh.json";

const original = useProjectStore.getState();
const wrap = (content: React.ReactNode) => (
  <NextIntlClientProvider locale="zh" messages={messages}>
    {content}
  </NextIntlClientProvider>
);

afterEach(() => {
  cleanup();
  useProjectStore.setState(original);
  useUploadQueueStore.setState({ byProject: {} });
});

describe("multi-file upload controls", () => {
  it("shows project-bound hold and continue actions while distinguishing active work and verified reselection", () => {
    const pauseUploads = vi.fn(), resumeUploads = vi.fn(async () => {}), reselectUpload = vi.fn(async () => {});
    useProjectStore.setState({ currentProjectId: "B", pauseUploads, resumeUploads, reselectUpload });
    const items = [
      { id: "active", name: "current.csv", status: "saving" as const, progress: 100, retryable: false },
      { id: "waiting", name: "later.csv", status: "queued" as const, progress: null, retryable: false },
      { id: "recovered", name: "original.csv", status: "uncertain" as const, progress: null, retryable: false, reselectable: true },
    ];
    useUploadQueueStore.setState({ byProject: { A: { busy: true, notice: null, items } } });
    const view = render(wrap(<ProjectUploadQueue projectId="A" />));
    fireEvent.click(screen.getByRole("button", { name: "暂缓后续文件" }));
    expect(pauseUploads).toHaveBeenCalledExactlyOnceWith("A");
    act(() => useUploadQueueStore.setState({ byProject: { A: { busy: true, paused: true, notice: null, items } } }));
    expect(screen.getByText("当前文件继续处理，后续文件将暂缓。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "继续其余文件" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "清除导入记录" })).not.toBeInTheDocument();
    act(() => useUploadQueueStore.setState({ byProject: { A: { busy: false, paused: true, notice: null,
      items: [{ ...items[0], status: "added" }, ...items.slice(1)] } } }));
    expect(screen.getByText("后续文件已暂缓，可以继续或取消等待。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新选择并核对 original.csv" })).toBeEnabled();
    const originalFile = new File(["id\n1"], "original.csv");
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [originalFile] } });
    expect(reselectUpload).toHaveBeenCalledExactlyOnceWith("recovered", originalFile, "A");
    fireEvent.click(screen.getByRole("button", { name: "继续其余文件" }));
    expect(resumeUploads).toHaveBeenCalledExactlyOnceWith("A");
  });

  it("shows cancellable file verification separately from upload progress", () => {
    const cancelQueuedUpload = vi.fn();
    useProjectStore.setState({ currentProjectId: "A", cancelQueuedUpload });
    useUploadQueueStore.setState({ byProject: { A: { busy: true, notice: null, items: [
      { id: "pending", name: "orders.csv", status: "uncertain", progress: 42, retryable: false, recovered: true, reselectable: true, verifying: true },
    ] } } });
    render(wrap(<SourceUploadQueue />));
    expect(screen.getByText("正在核对文件")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "orders.csv 的读取进度" })).toHaveAttribute("value", "42");
    expect(screen.queryByRole("button", { name: "重新选择 orders.csv 并继续导入" })).toBeNull();
    expect(screen.getByRole("button", { name: "检查 orders.csv 的导入结果" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "取消读取 orders.csv" }));
    expect(cancelQueuedUpload).toHaveBeenCalledExactlyOnceWith("pending", "A");
  });

  it("upload reconciliation offers a scoped check and confirms clearing unresolved records", () => {
    const checkUpload = vi.fn(async () => {});
    const clearUploads = vi.fn();
    useProjectStore.setState({ currentProjectId: "A", checkUpload, clearUploads });
    useUploadQueueStore.setState({ byProject: { A: { busy: false, notice: null, items: [
      { id: "pending", name: "orders.csv", status: "uncertain", progress: 100, retryable: false },
    ] } } });
    render(wrap(<SourceUploadQueue />));
    fireEvent.click(screen.getByRole("button", { name: "检查 orders.csv 的导入结果" }));
    expect(checkUpload).toHaveBeenCalledExactlyOnceWith("pending", "A");
    expect(screen.queryByRole("button", { name: /重试/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "清除导入记录" }));
    expect(clearUploads).not.toHaveBeenCalled();
    expect(screen.getByText(/已加入的文件不会被移除/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认清除记录" }));
    expect(clearUploads).toHaveBeenCalledExactlyOnceWith("A");
  });

  it("passes all selected and dropped files from both actual entry points", () => {
    const uploadFiles = vi.fn(async () => {});
    useProjectStore.setState({
      currentProjectId: "A",
      uploadFiles,
      isUploading: false,
    });
    const files = [
      new File(["id\n1"], "first.csv"),
      new File(['{"id":2}\n'], "second.jsonl"),
      new File(['{"id":3}\n'], "third.NDJSON"),
    ];
    const views = [
      <InputBar
        key="composer"
        onSubmit={vi.fn()}
        onStop={vi.fn()}
        onOpenData={vi.fn()}
        onUploadFile={vi.fn()}
        onUploadFiles={uploadFiles}
        isLoading={false}
        isUploading={false}
        dataReady={false}
        sourceCount={0}
        input=""
        onInputChange={vi.fn()}
      />,
      <DataWorkspacePanel
        key="panel"
        open
        onClose={vi.fn()}
        onConfigureConnection={vi.fn()}
        connections={[]}
      />,
    ];
    views.forEach((view, index) => {
      const { container } = render(wrap(view));
      const input =
        container.querySelector<HTMLInputElement>('input[type="file"]')!;
      expect(input.multiple).toBe(true);
      expect(input.accept).toBe(FILE_UPLOAD_ACCEPT);
      expect(input.accept.split(",")).toEqual(expect.arrayContaining([".jsonl", ".ndjson"]));
      fireEvent.change(input, { target: { files } });
      expect(uploadFiles).toHaveBeenLastCalledWith(files);
      expect(input.value).toBe("");
      const dropTarget =
        index === 0
          ? screen.getByTestId("chat-input").parentElement!
          : screen.getByRole("button", { name: /加入文件/ });
      fireEvent.drop(dropTarget, { dataTransfer: { files } });
      expect(uploadFiles).toHaveBeenLastCalledWith(files);
      cleanup();
    });
    expect(uploadFiles).toHaveBeenCalledTimes(4);
  });

  it("shows saving separately from success and limits cancellation to waiting files", () => {
    document.documentElement.lang = "zh-CN";
    const cancelQueuedUploads = vi.fn();
    useProjectStore.setState({ currentProjectId: "A", cancelQueuedUploads });
    useUploadQueueStore.setState({
      byProject: {
        A: {
          busy: true,
          notice: null,
          items: [
            {
              id: "one",
              name: "first.csv",
              status: "saving",
              progress: 100,
              retryable: false,
            },
            {
              id: "two",
              name: "second.csv",
              status: "queued",
              progress: null,
              retryable: false,
            },
            {
              id: "three",
              name: "third.csv",
              status: "uncertain",
              progress: 80,
              retryable: false,
              errorKey: "fileUploadOutcomeUnknown",
            },
          ],
        },
      },
    });
    render(wrap(<SourceUploadQueue />));
    expect(screen.getByRole("status").textContent).toBe("已加入 0 / 3 份文件");
    expect(screen.getByText("正在保存")).toBeDefined();
    expect(
      screen
        .getByRole("progressbar", { name: "first.csv 的上传进度" })
        .getAttribute("value"),
    ).toBe("100");
    expect(
      screen.queryByRole("button", { name: "取消上传 first.csv" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /重试/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "取消所有等待文件" }));
    expect(cancelQueuedUploads).toHaveBeenCalledExactlyOnceWith("A");
    act(() => useProjectStore.setState({ currentProjectId: "B" }));
    expect(screen.queryByRole("region", { name: "文件导入" })).toBeNull();
  });
});
