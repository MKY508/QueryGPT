import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SourceReplacementDialog } from "@/components/chat/SourceReplacementDialog";
import { DataWorkspacePanel } from "@/components/chat/DataWorkspacePanel";
import { api } from "@/lib/api/client";
import * as replacement from "@/lib/source-replacement";
import { useProjectStore } from "@/lib/stores/project";
import type { ProjectDataSource, SanitationRecipe } from "@/lib/types/api";
import messages from "@/messages/zh.json";

const source = (id: string, status: ProjectDataSource["status"] = "attached"): ProjectDataSource => ({
  id, project_id: "project-1", name: `${id}.csv`, kind: "file", format: "csv", status,
  profile_data: {}, created_at: "2026-09-05", updated_at: "2026-09-05",
});
const old = source("old", "ready");
const candidates = [source("new-1"), source("new-2")];
const result = (id = "new-1"): replacement.ReplacementPreview => ({
  source_id: "old", candidate_source_id: id, proof: "a".repeat(64),
  before: { rows: 10, columns: 2, sample: [{ order_id: "001", amount: "9007199254740993" }] },
  after: { rows: 20, columns: 2, sample: [{ order_id: id, amount: "9007199254740995" }] },
  added_columns: [], removed_columns: [], type_changes: [], can_apply: true, unresolved_questions: 0,
  input_rows: 20,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}
const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
const originalRefresh = useProjectStore.getState().refreshCurrent;
beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
  });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  useProjectStore.setState({ currentProjectId: null, sources: [], recipes: [], preflightReports: [], sourceAction: null, refreshCurrent: originalRefresh });
});
function view(apply = vi.fn().mockResolvedValue(undefined), refresh = vi.fn().mockResolvedValue(undefined)) {
  return render(<NextIntlClientProvider locale="zh" messages={messages}><SourceReplacementDialog projectId="project-1" source={old} candidates={candidates} canApply onApply={apply} onRefresh={refresh} onClose={vi.fn()} /></NextIntlClientProvider>);
}

it("requires a chosen file and preview, ignores superseded reads, and confirms exactly once", async () => {
  const first = deferred<replacement.ReplacementPreview>();
  const read = vi.spyOn(replacement, "previewSourceReplacement").mockImplementation(async (_p, _s, request) => request.candidate_source_id === "new-1" ? first.promise : result("new-2"));
  const applied = deferred<void>();
  const apply = vi.fn(() => applied.promise);
  view(apply);
  expect(read).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "确认更新" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("新文件"), { target: { value: "new-1" } });
  fireEvent.click(screen.getByRole("button", { name: "预览更新" }));
  fireEvent.change(screen.getByLabelText("新文件"), { target: { value: "new-2" } });
  await act(async () => first.resolve(result()));
  expect(screen.queryByText("9007199254740995")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "预览更新" }));
  expect(await screen.findByText("9007199254740995")).toBeInTheDocument();
  expect(screen.getByText("9007199254740993")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "确认更新" }));
  fireEvent.click(screen.getByRole("button", { name: "确认更新" }));
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply).toHaveBeenCalledWith({ candidate_source_id: "new-2", proof: "a".repeat(64) });
  await act(async () => applied.resolve());
});

it("offers refresh only after a lost acknowledgement and never resends the update", async () => {
  vi.spyOn(replacement, "previewSourceReplacement").mockResolvedValue(result());
  const apply = vi.fn().mockRejectedValue(new Error("Lost reply"));
  const refresh = vi.fn().mockRejectedValue(new Error("Offline"));
  view(apply, refresh);
  fireEvent.change(screen.getByLabelText("新文件"), { target: { value: "new-1" } });
  fireEvent.click(screen.getByRole("button", { name: "预览更新" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "确认更新" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "确认更新" }));
  expect(await screen.findByText(messages.sourceReplacement.uncertain)).toBeInTheDocument();
  expect(screen.getByLabelText("新文件")).toBeDisabled();
  expect(screen.getByRole("button", { name: "预览更新" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "刷新数据列表" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(apply).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "确认更新" })).not.toBeInTheDocument();
});

it("reviews distant fields and complete values using the current and replacement labels", async () => {
  const full = "销售说明".repeat(100);
  const row = Object.fromEntries(Array.from({ length: 14 }, (_, index) => [`字段${index + 1}`, index === 13 ? full : String(index)]));
  const preview = result();
  preview.after = { rows: 20, columns: 14, sample: [row] };
  vi.spyOn(replacement, "previewSourceReplacement").mockResolvedValue(preview);
  view();
  fireEvent.change(screen.getByLabelText("新文件"), { target: { value: "new-1" } });
  fireEvent.click(screen.getByRole("button", { name: "预览更新" }));
  await screen.findByRole("table", { name: "更新后" });
  expect(screen.getByRole("table", { name: "当前数据" })).toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "定位字段" }), { target: { value: "字段14" } });
  const opener = screen.getByRole("button", { name: "展开更新后第 1 条的“字段14”完整值" });
  fireEvent.click(opener);
  const region = screen.getByRole("region", { name: "字段14 · 完整值" });
  expect(region.querySelector("div[tabindex='0']")?.textContent).toBe(full);
  fireEvent.keyDown(region, { key: "Escape" });
  expect(opener).toHaveFocus();
  expect(screen.getByRole("dialog", { name: "更新数据" })).toBeInTheDocument();
});

it("opens from the current source and does not publish late replacement results into another project", async () => {
  const write = deferred<ProjectDataSource>();
  const apply = vi.spyOn(replacement, "applySourceReplacement").mockImplementation(() => write.promise);
  const refresh = vi.fn().mockResolvedValue(undefined);
  useProjectStore.setState({ currentProjectId: "project-1", sources: [old, ...candidates], recipes: [{ id: "recipe-1", data_source_id: "old", status: "applied", operations: [] } as unknown as SanitationRecipe], refreshCurrent: refresh });
  vi.spyOn(replacement, "previewSourceReplacement").mockResolvedValue(result());
  render(<NextIntlClientProvider locale="zh" messages={messages}><DataWorkspacePanel open onClose={vi.fn()} onConfigureConnection={vi.fn()} /></NextIntlClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "查看数据：old.csv" }));
  fireEvent.click(screen.getByRole("button", { name: "更新数据" }));
  expect(screen.getByRole("dialog", { name: "更新数据" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("新文件"), { target: { value: "new-1" } });
  fireEvent.click(screen.getByRole("button", { name: "预览更新" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "确认更新" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "确认更新" }));
  expect(apply).toHaveBeenCalledTimes(1);
  const other = { ...source("other", "ready"), project_id: "project-2" };
  act(() => useProjectStore.setState({ currentProjectId: "project-2", sources: [other], recipes: [], sourceAction: null }));
  expect(screen.queryByRole("dialog", { name: "更新数据" })).not.toBeInTheDocument();
  await act(async () => write.resolve({ ...candidates[0], status: "ready", profile_data: { is_current: true } }));
  expect(useProjectStore.getState().sources).toEqual([other]);
  expect(refresh).not.toHaveBeenCalled();
});

it("rejects preview evidence for another source and malformed row counts", async () => {
  const post = vi.spyOn(api, "post");
  for (const changes of [{ source_id: "other" }, { candidate_source_id: "other" }, { before: { ...result().before, rows: -1 } }]) {
    post.mockResolvedValueOnce({ data: { data: { ...result(), ...changes } } });
    await expect(replacement.previewSourceReplacement("project-1", "old", { candidate_source_id: "new-1" })).rejects.toThrow("Invalid replacement preview");
  }
});
