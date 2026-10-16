import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ api: mocks }));
vi.mock("@/lib/upload-journal", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/upload-journal")>(),
  uploadJournal: {
    prepare: vi.fn(async (projectId, id, file) => ({ schema: 1, projectId, id, name: file.name, size: file.size, createdAt: 1 })),
    require: vi.fn(async () => {}), remove: vi.fn(async () => {}),
  },
}));

import { useProjectStore } from "@/lib/stores/project";
import { fileUploadErrorMessage, resolveFileUpload } from "@/lib/file-upload";
import { useUploadQueueStore } from "@/lib/stores/uploads";

function deferred() {
  let resolve!: (value?: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise((done, failed) => { resolve = done; reject = failed; });
  return { promise, resolve, reject };
}

const file = () => new File(["id,amount\n1,10\n"], "orders.csv");
const refresh = vi.fn(async () => {});
const refreshCurrent = useProjectStore.getState().refreshCurrent;
const acknowledged = { data: { data: { id: "source-A", project_id: "A", kind: "file" } } };

describe("project-owned source uploads", () => {
  beforeEach(() => {
    document.documentElement.lang = "zh-CN";
    mocks.post.mockReset();
    refresh.mockClear();
    useProjectStore.setState({ currentProjectId: "A", isUploading: false, error: null, refreshCurrent: refresh });
    useProjectStore.getState().clearUploads();
  });

  it("upload reconciliation sends a stable identity and validates a project-scoped result without another upload", async () => {
    mocks.get.mockReset();
    mocks.post.mockRejectedValueOnce(new Error("lost response"));
    await useProjectStore.getState().uploadFiles([file()]);
    const id = useUploadQueueStore.getState().byProject.A.items[0].id;
    expect(mocks.post.mock.calls[0][2].headers["Idempotency-Key"]).toBe(id);
    const receipt = { project_id: "A", request_id: id, source_id: "695e1a79-0b49-4d30-a79a-a5812277f8cb",
      status: "added", fingerprint: "a".repeat(64), byte_size: file().size, filename: "orders.csv" };
    for (const invalid of [undefined, { ...receipt, project_id: "B" }, { ...receipt, request_id: "another" }, { ...receipt, status: "pending" }]) {
      mocks.get.mockResolvedValueOnce({ data: { data: invalid } });
      await expect(resolveFileUpload("A", id)).rejects.toThrow();
    }
    mocks.get.mockResolvedValueOnce({ data: { data: receipt } });
    await expect(resolveFileUpload("A", id, "b".repeat(64))).rejects.toThrow();
    mocks.get.mockResolvedValueOnce({ data: { data: receipt } });
    await expect(resolveFileUpload("A", id, "a".repeat(64))).resolves.toBe("added");
    const pending = deferred();
    mocks.get.mockReturnValueOnce(pending.promise);
    const check = useProjectStore.getState().checkUpload(id, "A");
    useProjectStore.setState({ currentProjectId: "B", isUploading: false });
    pending.resolve({ data: { data: receipt } });
    refresh.mockClear();
    await check;
    expect(useUploadQueueStore.getState().byProject.A.items[0].status).toBe("added");
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(useProjectStore.getState().currentProjectId).toBe("B");
    expect(useProjectStore.getState().isUploading).toBe(false);
    expect(mocks.get).toHaveBeenLastCalledWith(`/api/v1/projects/A/source-uploads/${id}`, { timeout: 20000 });
    useProjectStore.getState().clearUploads("A");
  });

  it("holds and continues the owning project queue without changing a different current workspace", async () => {
    const pending = deferred();
    mocks.post.mockReturnValueOnce(pending.promise).mockResolvedValue(acknowledged);
    const running = useProjectStore.getState().uploadFiles([file(), new File(["id\n2"], "later.csv")]);
    await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());
    useProjectStore.getState().pauseUploads("A");
    useProjectStore.setState({ currentProjectId: "B", isUploading: false });
    pending.resolve(acknowledged); await running;
    expect(useUploadQueueStore.getState().byProject.A).toMatchObject({ paused: true, busy: false });
    expect(mocks.post).toHaveBeenCalledOnce();
    expect(useProjectStore.getState()).toMatchObject({ currentProjectId: "B", isUploading: false });
    expect(refresh).not.toHaveBeenCalled();
    await useProjectStore.getState().resumeUploads("A");
    expect(mocks.post.mock.calls.map(call => call[0])).toEqual(["/api/v1/projects/A/sources/files", "/api/v1/projects/A/sources/files"]);
    expect(useUploadQueueStore.getState().byProject.A.items.every(item => item.status === "added")).toBe(true);
    expect(useProjectStore.getState()).toMatchObject({ currentProjectId: "B", isUploading: false });
    useProjectStore.getState().clearUploads("A");
  });

  it("targets explicit project controls while another project's queue is selected", async () => {
    const busy = { response: { status: 429, data: { detail: { code: "file_upload_busy" } } } };
    mocks.post.mockRejectedValueOnce(busy).mockRejectedValueOnce(busy);
    await useProjectStore.getState().uploadFiles([file(), file(), file()]);
    await useProjectStore.getState().selectProject("B");
    useProjectStore.getState().clearUploads();
    await useProjectStore.getState().uploadFiles([file(), file()]);
    const [failed, , cancelled] = useUploadQueueStore.getState().byProject.A.items;
    const other = useUploadQueueStore.getState().byProject.B;
    refresh.mockClear();
    mocks.post.mockResolvedValue(acknowledged);
    useProjectStore.getState().cancelQueuedUpload(cancelled.id, "A");
    await useProjectStore.getState().resumeUploads("A");
    await useProjectStore.getState().retryUpload(failed.id, "A");
    expect(mocks.post.mock.calls.slice(2).map(([url]) => url)).toEqual([
      "/api/v1/projects/A/sources/files", "/api/v1/projects/A/sources/files",
    ]);
    expect(useUploadQueueStore.getState().byProject.B).toBe(other);
    expect(useUploadQueueStore.getState().byProject.A.items.map((item) => item.status)).toEqual(["added", "added", "cancelled"]);
    expect(refresh).not.toHaveBeenCalled();
    expect(useProjectStore.getState().currentProjectId).toBe("B");
    expect(useProjectStore.getState().isUploading).toBe(false);
    useProjectStore.getState().clearUploads("A");
    expect(useUploadQueueStore.getState().byProject.A).toBeUndefined();
    useProjectStore.getState().cancelQueuedUploads("B");
    expect(useUploadQueueStore.getState().byProject.B.items[1].status).toBe("cancelled");
    useProjectStore.getState().clearUploads("B");
  });

  it("keeps a confirmed import successful while exposing a failed list refresh", async () => {
    mocks.get.mockReset();
    mocks.get.mockRejectedValue(new Error("private refresh failure"));
    mocks.post.mockResolvedValue(acknowledged);
    useProjectStore.setState({ refreshCurrent });
    await useProjectStore.getState().uploadFiles([file()]);
    const snapshot = useUploadQueueStore.getState().byProject.A;
    expect(snapshot.items[0].status).toBe("added");
    expect(snapshot.items[0].retryable).toBe(false);
    expect(snapshot.notice).toBe("fileUploadListRefreshFailed");
    expect(snapshot.busy).toBe(false);
    expect(useProjectStore.getState().isUploading).toBe(false);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    // Ordinary refresh callers still receive their existing non-throwing behavior.
    await expect(refreshCurrent()).resolves.toBeUndefined();
    mocks.get.mockReset();
    useProjectStore.setState({ refreshCurrent: refresh });
  });

  it("deduplicates overlapping drops and restores busy state after switching back", async () => {
    const pending = deferred();
    mocks.post.mockReturnValue(pending.promise);
    const upload = useProjectStore.getState().uploadFile(file());
    await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());
    await useProjectStore.getState().uploadFile(file());
    await useProjectStore.getState().attachConnection("db-1");
    expect(mocks.post).toHaveBeenCalledTimes(1);
    await useProjectStore.getState().selectProject("B");
    expect(useProjectStore.getState().isUploading).toBe(false);
    await useProjectStore.getState().selectProject("A");
    expect(useProjectStore.getState().isUploading).toBe(true);
    pending.resolve(acknowledged);
    await upload;
    expect(useProjectStore.getState().isUploading).toBe(false);
  });

  it("does not refresh or clear another project's in-flight connection addition", async () => {
    const previous = deferred();
    const current = deferred();
    mocks.post.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
    const upload = useProjectStore.getState().uploadFile(file());
    await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());
    await useProjectStore.getState().selectProject("B");
    const attach = useProjectStore.getState().attachConnection("db-1");
    refresh.mockClear();
    previous.resolve(acknowledged);
    await upload;
    expect(refresh).not.toHaveBeenCalled();
    expect(useProjectStore.getState().isUploading).toBe(true);
    current.resolve();
    await attach;
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(useProjectStore.getState().isUploading).toBe(false);
  });

  it("does not leak a failed previous upload into the selected project", async () => {
    const pending = deferred();
    mocks.post.mockReturnValue(pending.promise);
    const upload = useProjectStore.getState().uploadFile(file());
    await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());
    await useProjectStore.getState().selectProject("B");
    refresh.mockClear();
    pending.reject(new Error("private transport details"));
    await upload;
    expect(refresh).not.toHaveBeenCalled();
    expect(useProjectStore.getState().error).toBeNull();
  });

  it("rejects empty files locally and releases the slot after a failed upload", async () => {
    await useProjectStore.getState().uploadFile(new File([], "empty.csv"));
    expect(mocks.post).not.toHaveBeenCalled();
    expect(useProjectStore.getState().error).toContain("空的");
    mocks.post.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(acknowledged);
    await useProjectStore.getState().uploadFile(file());
    expect(useProjectStore.getState().error).toContain("避免重复上传");
    expect(useProjectStore.getState().isUploading).toBe(false);
    await useProjectStore.getState().uploadFile(file());
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(useProjectStore.getState().error).toBeNull();
  });

  it("translates known error codes without trusting remote messages", () => {
    const error = { response: { status: 400, data: { detail: { code: "file_upload_empty", message: "private /disk/path" } } } };
    document.documentElement.lang = "en";
    expect(fileUploadErrorMessage(error)).toBe("This file is empty. Choose a file with data.");
    error.response.data.detail.code = "toString";
    expect(fileUploadErrorMessage(error)).toBe("The request could not be completed. Please retry.");
    expect(fileUploadErrorMessage({ response: { status: 413 } })).toContain("too large");
    expect(fileUploadErrorMessage(new Error("private"))).toContain("Check the source list");
    for (const [code, expected] of [
      ["file_upload_invalid", "incomplete or invalid"],
      ["file_upload_timeout", "too long"],
      ["file_upload_busy", "still being added"],
    ]) {
      error.response.data.detail.code = code;
      expect(fileUploadErrorMessage(error)).toContain(expected);
      expect(fileUploadErrorMessage(error)).not.toContain("private");
    }
    document.documentElement.lang = "zh-CN";
    expect(fileUploadErrorMessage(error)).toBe("还有文件正在加入，请稍后再上传。");
  });
});
