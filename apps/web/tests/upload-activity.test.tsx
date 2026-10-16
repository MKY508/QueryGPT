import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  UploadActivity,
  uploadActivitySummary,
} from "@/components/providers/UploadActivity";
import { useProjectStore } from "@/lib/stores/project";
import { useUploadQueueStore } from "@/lib/stores/uploads";
import type { UploadSnapshot, UploadStatus } from "@/lib/upload-state";
import messages from "@/messages/zh.json";
vi.mock("@/lib/upload-journal", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/upload-journal")>(),
  listPendingUploads: vi.fn(async () => []),
  subscribeUploadJournal: vi.fn(() => () => {}),
}));

const original = useProjectStore.getState();
let restoreDialog: () => void;
function queue(...statuses: UploadStatus[]): UploadSnapshot {
  return {
    busy: statuses.some(
      (status) => status === "uploading" || status === "saving",
    ),
    notice: null,
    items: statuses.map((status, index) => ({
      id: `item-${index}`,
      name: `file-${index}.csv`,
      status,
      progress: null,
      retryable: status === "failed",
    })),
  };
}
const wrap = () => (
  <StrictMode>
    <NextIntlClientProvider locale="zh" messages={messages}>
      <UploadActivity />
    </NextIntlClientProvider>
  </StrictMode>
);

beforeEach(() => {
  const prototype = HTMLDialogElement.prototype;
  const show = Object.getOwnPropertyDescriptor(prototype, "showModal");
  const close = Object.getOwnPropertyDescriptor(prototype, "close");
  Object.defineProperties(prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
        queueMicrotask(() => this.dispatchEvent(new Event("close")));
      },
    },
  });
  restoreDialog = () => {
    if (show) Object.defineProperty(prototype, "showModal", show);
    else Reflect.deleteProperty(prototype, "showModal");
    if (close) Object.defineProperty(prototype, "close", close);
    else Reflect.deleteProperty(prototype, "close");
  };
  useProjectStore.setState({
    currentProjectId: "B",
    projects: ["A", "B"].map((id) => ({
      id,
      name: id === "A" ? "销售分析" : "门店分析",
      status: "active",
      extra_data: {},
      created_at: "",
      updated_at: "",
    })),
  });
});
afterEach(() => {
  cleanup();
  restoreDialog();
  useProjectStore.setState(original);
  useUploadQueueStore.setState({ byProject: {} });
});

describe("cross-page import activity", () => {
  it("counts waiting and saving files, preserves uncertain results, and ignores percentage-only changes", () => {
    const byProject = {
      A: queue("queued", "saving"),
      B: queue("failed", "uncertain", "added", "cancelled"),
    };
    const summary = uploadActivitySummary(byProject);
    expect(summary).toEqual({
      pending: 2,
      running: true,
      attention: true,
      visible: true,
    });
    byProject.A.items[1].progress = 100;
    expect(uploadActivitySummary(byProject)).toEqual(summary);
    expect(uploadActivitySummary({ A: queue("queued") }).running).toBe(false);
    expect(
      uploadActivitySummary({
        A: { ...queue(), notice: "fileUploadQueueLimit" },
      }).visible,
    ).toBe(true);
    expect(uploadActivitySummary({})).toEqual({
      pending: 0,
      running: false,
      attention: false,
      visible: false,
    });
  });

  it("handles hidden-project queues without switching projects and isolates report shortcuts", async () => {
    const actions = {
      resumeUploads: vi.fn(async () => {}),
      retryUpload: vi.fn(async () => {}),
      cancelQueuedUpload: vi.fn(),
      cancelQueuedUploads: vi.fn(),
      clearUploads: vi.fn(),
      selectProject: vi.fn(async () => {}),
    };
    useProjectStore.setState(actions);
    useUploadQueueStore.setState({
      byProject: { A: queue("failed", "queued"), B: queue("uncertain") },
    });
    render(wrap());
    fireEvent.click(screen.getByRole("button", { name: "查看文件导入" }));
    await act(async () => {}); // Deliver Strict Mode's stale close event.
    const dialog = screen.getByRole("dialog", { name: "文件导入" });
    const panel = within(dialog);
    expect(panel.getByRole("combobox", { name: "项目" })).toHaveValue("A");
    expect(
      panel.getByRole("region", { name: "销售分析的文件导入" }),
    ).toBeDefined();
    act(() => useProjectStore.setState({ currentProjectId: "C" }));
    fireEvent.click(panel.getByRole("button", { name: "继续其余文件" }));
    fireEvent.click(panel.getByRole("button", { name: "重试上传 file-0.csv" }));
    fireEvent.click(panel.getByRole("button", { name: "取消上传 file-1.csv" }));
    fireEvent.click(panel.getByRole("button", { name: "取消所有等待文件" }));
    expect(actions.resumeUploads).toHaveBeenCalledExactlyOnceWith("A");
    expect(actions.retryUpload).toHaveBeenCalledExactlyOnceWith("item-0", "A");
    expect(actions.cancelQueuedUpload).toHaveBeenCalledExactlyOnceWith(
      "item-1",
      "A",
    );
    expect(actions.cancelQueuedUploads).toHaveBeenCalledExactlyOnceWith("A");
    fireEvent.change(panel.getByRole("combobox"), { target: { value: "B" } });
    expect(panel.queryByRole("button", { name: /重试/ })).toBeNull();
    fireEvent.click(panel.getByRole("button", { name: "清除导入记录" }));
    expect(actions.clearUploads).not.toHaveBeenCalled();
    fireEvent.click(panel.getByRole("button", { name: "确认清除记录" }));
    expect(actions.clearUploads).toHaveBeenCalledExactlyOnceWith("B");
    expect(actions.selectProject).not.toHaveBeenCalled();
    expect(useProjectStore.getState().currentProjectId).toBe("C");
    const behindDialog = vi.fn();
    window.addEventListener("keydown", behindDialog);
    try {
      for (const key of ["s", "p", "z", "y"])
        fireEvent.keyDown(panel.getByRole("button", { name: "关闭文件导入" }), {
          key,
          metaKey: true,
        });
      expect(behindDialog).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", behindDialog);
    }
    fireEvent.click(panel.getByRole("button", { name: "关闭文件导入" }));
    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useUploadQueueStore.getState().byProject.A.items[1].status).toBe(
      "queued",
    );
  });

  it("keeps cleared panels stable until dismissed and makes a later import discoverable again", async () => {
    render(wrap());
    expect(screen.queryByRole("button", { name: "查看文件导入" })).toBeNull();
    act(() =>
      useUploadQueueStore.setState({
        byProject: { A: queue("added"), B: queue("cancelled") },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "查看文件导入" }));
    await act(async () => {});
    act(() =>
      useUploadQueueStore.setState({ byProject: { B: queue("cancelled") } }),
    );
    expect(
      screen.getByRole("region", { name: "门店分析的文件导入" }),
    ).toBeDefined();
    act(() => useUploadQueueStore.setState({ byProject: {} }));
    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByText("暂无导入记录")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "关闭文件导入" }));
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "查看文件导入" })).toBeNull();
    act(() =>
      useUploadQueueStore.setState({ byProject: { A: queue("saving") } }),
    );
    expect(screen.getByRole("button", { name: "查看文件导入" })).toBeDefined();
    expect(screen.getByText("还有 1 份文件待加入")).toBeDefined();
  });
});
