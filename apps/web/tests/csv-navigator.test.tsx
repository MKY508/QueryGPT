import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CsvNavigator } from "@/components/chat/CsvNavigator";
import { DataWorkspacePanel } from "@/components/chat/DataWorkspacePanel";
import * as csv from "@/lib/csv-import";
import { api } from "@/lib/api/client";
import { useProjectStore } from "@/lib/stores/project";
import messages from "@/messages/zh.json";

const preview = (delimiter: csv.CsvDelimiter = ";", encoding: csv.CsvEncoding = "utf-8-sig", start = 1): csv.CsvPreview => ({
  source_id: "source-1", source_revision: "a".repeat(64), input_fingerprint: "b".repeat(64),
  delimiter, encoding, start_row: start, rows: [["001", "10"]], nonempty_rows: [start],
  has_more_rows: false, truncated_columns: false, truncated_cells: false,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}
const show = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
  });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  if (show) Object.defineProperty(HTMLDialogElement.prototype, "showModal", show); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (close) Object.defineProperty(HTMLDialogElement.prototype, "close", close); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  useProjectStore.setState({ currentProjectId: null, sources: [], sourceAction: null, error: null });
});
function view(prepare = vi.fn().mockResolvedValue(undefined), done = vi.fn(), refresh = vi.fn().mockResolvedValue(undefined)) {
  return render(<NextIntlClientProvider locale="zh" messages={messages}><CsvNavigator projectId="project-1" sourceId="source-1" name="orders.csv" canPrepare onPrepare={prepare} onClose={done} onRefreshSource={refresh} /></NextIntlClientProvider>);
}

it("previews CSV options without writing, ignores stale dialect reads and sends one exact headerless choice", async () => {
  const old = deferred<csv.CsvPreview>();
  const read = vi.spyOn(csv, "readCsv").mockImplementation(async (_p, _s, delimiter, encoding, start) => delimiter === "," ? old.promise : preview(delimiter, encoding || "utf-8-sig", start));
  const write = deferred<void>();
  const prepare = vi.fn().mockReturnValue(write.promise);
  const done = vi.fn();
  view(prepare, done);
  expect(screen.getByRole("button", { name: "使用这些设置" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("分隔符"), { target: { value: ";" } });
  await screen.findByRole("table", { name: "CSV 内容预览" });
  await act(async () => old.resolve({ ...preview(","), rows: [["old,wrong,column"]] }));
  expect(screen.getByRole("table")).not.toHaveTextContent("old,wrong,column");
  expect(read.mock.calls[0][5]?.aborted).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "将第 1 条记录用作表头" }));
  fireEvent.change(screen.getByLabelText("文件编码"), { target: { value: "gb18030" } });
  await screen.findByRole("table");
  expect(screen.getByText(messages.csvImport.headerChanged)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "使用这些设置" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "无表头" }));
  expect(prepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "使用这些设置" }));
  fireEvent.click(screen.getByRole("button", { name: "使用这些设置" }));
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(prepare).toHaveBeenCalledWith({ kind: "csv", delimiter: ";", encoding: "gb18030", headerless: true, input_fingerprint: "b".repeat(64), source_revision: "a".repeat(64) });
  expect(done).not.toHaveBeenCalled();
  await act(async () => write.resolve());
  expect(done).toHaveBeenCalledTimes(1);
});

it("requires a new CSV preview after rejection and never resubmits an uncertain write", async () => {
  vi.spyOn(csv, "readCsv").mockImplementation(async (_p, _s, delimiter) => preview(delimiter));
  const prepare = vi.fn().mockRejectedValueOnce({ response: { status: 409 } }).mockRejectedValueOnce(new Error("Lost reply"));
  const done = vi.fn();
  const refresh = vi.fn().mockResolvedValue(undefined);
  view(prepare, done, refresh);
  await screen.findByRole("table");
  fireEvent.click(screen.getByRole("button", { name: "使用这些设置" }));
  fireEvent.click(await screen.findByRole("button", { name: "重新预览" }));
  await screen.findByRole("table");
  fireEvent.click(screen.getByRole("button", { name: "使用这些设置" }));
  await screen.findByText(messages.workbook.uncertain);
  fireEvent.change(screen.getByLabelText("分隔符"), { target: { value: "|" } });
  await screen.findByRole("table");
  expect(screen.queryByRole("button", { name: "使用这些设置" })).not.toBeInTheDocument();
  expect(prepare).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "刷新来源" }));
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("opens attached CSV import settings with saved options and ignores a late read after switching projects", async () => {
  const old = deferred<csv.CsvPreview>();
  const initial = deferred<csv.CsvPreview>();
  const read = vi.spyOn(csv, "readCsv").mockReturnValueOnce(initial.promise).mockReturnValue(old.promise);
  const post = vi.spyOn(api, "post");
  useProjectStore.setState({ currentProjectId: "project-1", sources: [{
    id: "source-1", project_id: "project-1", kind: "file", name: "orders.csv", format: "csv", status: "attached", fingerprint: "b".repeat(64), profile_data: { csv_options: { delimiter: ";", encoding: "gb18030" }, has_header: false, header_row: null }, created_at: "created", updated_at: "updated",
  }], sourceAction: null, error: null });
  render(<NextIntlClientProvider locale="zh" messages={messages}><DataWorkspacePanel open onClose={vi.fn()} onConfigureConnection={vi.fn()} settingsLoaded preprocessingEnabled /></NextIntlClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: messages.dataWorkspace.sourcePrepareButton }));
  await screen.findByRole("dialog", { name: "CSV 导入设置" });
  expect(screen.getByLabelText("分隔符")).toHaveValue(";");
  expect(screen.getByLabelText("文件编码")).toHaveValue("gb18030");
  expect(post).not.toHaveBeenCalled();
  await act(async () => initial.resolve({ ...preview(";", "gb18030"), input_fingerprint: "c".repeat(64) }));
  expect(screen.getByText(messages.csvImport.headerlessSelected)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "无表头" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText(messages.csvImport.headerChanged)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "使用这些设置" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("分隔符"), { target: { value: "|" } });
  expect(screen.getByText(messages.csvImport.headerlessSelected)).toBeInTheDocument();
  act(() => { useProjectStore.setState({ currentProjectId: "project-2", sources: [] }); });
  await act(async () => old.resolve(preview(";", "gb18030")));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(read.mock.calls[1][5]?.aborted).toBe(true);
});

it("validates CSV source, dialect, encoding and record identity before exposing preview data", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValueOnce({ data: { data: preview("\t", "gb18030", 14) } });
  const sample = await csv.readCsv("project-1", "source-1", "\t", "gb18030", 14);
  expect(sample.start_row).toBe(14);
  expect(get).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ params: { delimiter: "\t", encoding: "gb18030", start_row: 14 } }));
  for (const wrong of [{ source_id: "wrong" }, { delimiter: ";" }, { encoding: "utf-8-sig" }, { start_row: 1 }]) {
    get.mockResolvedValueOnce({ data: { data: { ...preview("\t", "gb18030", 14), ...wrong } } });
    await expect(csv.readCsv("project-1", "source-1", "\t", "gb18030", 14)).rejects.toThrow("Invalid CSV preview");
  }
  await expect(csv.readCsv("project-1", "source-1", ",", null, 0)).rejects.toThrow("Invalid CSV options");
});
