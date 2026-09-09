import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkbookNavigator } from "@/components/chat/WorkbookNavigator";
import * as workbook from "@/lib/workbook";
import { api } from "@/lib/api/client";
import { useProjectStore } from "@/lib/stores/project";
import messages from "@/messages/zh.json";

const catalog: workbook.WorkbookPreview = {
  source_id: "source-1", source_revision: "a".repeat(64), input_fingerprint: "b".repeat(64),
  sheets: [{ name: "Orders", hidden: false }, { name: "Cash & Sales", hidden: true }], selected_sheet: null,
  rows: [], has_more_rows: false, truncated_columns: false, truncated_cells: false, missing_formula_results: 0,
  start_row: 1, nonempty_rows: [],
};
const preview = (sheet: string | null): workbook.WorkbookPreview => ({ ...catalog, selected_sheet: sheet, rows: sheet ? [[sheet, "001"]] : [], nonempty_rows: sheet ? [1] : [] });
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
function view(onPrepare = vi.fn().mockResolvedValue(undefined), onClose = vi.fn(), onRefreshSource = vi.fn().mockResolvedValue(undefined)) {
  return render(<NextIntlClientProvider locale="zh" messages={messages}><WorkbookNavigator projectId="project-1" sourceId="source-1" name="orders.xlsx" canPrepare onPrepare={onPrepare} onClose={onClose} onRefreshSource={onRefreshSource} /></NextIntlClientProvider>);
}

it("navigates workbook previews without writing, ignores stale rows and submits only the explicit selection once", async () => {
  const old = deferred<workbook.WorkbookPreview>();
  const read = vi.spyOn(workbook, "readWorkbook").mockImplementation(async (_project, _source, sheet) => sheet === "Orders" ? old.promise : preview(sheet));
  const write = deferred<void>();
  const prepare = vi.fn().mockReturnValue(write.promise);
  const done = vi.fn();
  view(prepare, done);
  expect(screen.getByRole("button", { name: "使用此工作表" })).toBeDisabled();
  fireEvent.click(await screen.findByRole("button", { name: "Orders" }));
  expect(prepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cash & Sales (隐藏)" }));
  await screen.findByRole("table", { name: "工作表内容预览" });
  await act(async () => old.resolve(preview("Orders")));
  expect(screen.getByRole("table")).not.toHaveTextContent("Orders");
  expect(read.mock.calls[1][3]?.aborted).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "使用此工作表" }));
  fireEvent.click(screen.getByRole("button", { name: "使用此工作表" }));
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(prepare).toHaveBeenCalledWith({ sheet: "Cash & Sales", source_revision: catalog.source_revision, input_fingerprint: catalog.input_fingerprint });
  expect(done).not.toHaveBeenCalled();
  await act(async () => write.resolve());
  expect(done).toHaveBeenCalledTimes(1);
});

it("requires a fresh workbook preview after rejection and a source read after an unconfirmed preparation", async () => {
  const read = vi.spyOn(workbook, "readWorkbook").mockImplementation(async (_project, _source, sheet) => preview(sheet));
  const prepare = vi.fn().mockRejectedValueOnce({ response: { status: 409 } }).mockRejectedValueOnce(new Error("Reply lost"));
  const done = vi.fn();
  const refresh = vi.fn().mockResolvedValue(undefined);
  view(prepare, done, refresh);
  fireEvent.click(await screen.findByRole("button", { name: "Orders" }));
  await screen.findByRole("table");
  fireEvent.click(screen.getByRole("button", { name: "使用此工作表" }));
  fireEvent.click(await screen.findByRole("button", { name: "重新预览" }));
  await screen.findByRole("table");
  expect(read).toHaveBeenCalledTimes(3);
  fireEvent.click(screen.getByRole("button", { name: "使用此工作表" }));
  await screen.findByText(messages.workbook.uncertain);
  expect(screen.queryByRole("button", { name: "使用此工作表" })).not.toBeInTheDocument();
  expect(prepare).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "刷新来源" }));
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(prepare).toHaveBeenCalledTimes(2);
});

it("preserves exact workbook names and rejects responses for another source or worksheet", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValueOnce({ data: { data: preview("Cash & Sales") } }).mockResolvedValueOnce({ data: { data: { ...catalog, source_id: "wrong" } } });
  expect((await workbook.readWorkbook("project-1", "source-1", "Cash & Sales")).rows[0][1]).toBe("001");
  expect(get).toHaveBeenCalledWith("/api/v1/projects/project-1/sources/source-1/workbook", expect.objectContaining({ params: { sheet: "Cash & Sales" } }));
  await expect(workbook.readWorkbook("project-1", "source-1", null)).rejects.toThrow("Invalid workbook preview");
  expect([0, 25, 26, 39].map(workbook.workbookColumnName)).toEqual(["A", "Z", "AA", "AN"]);
  get.mockResolvedValueOnce({ data: { data: { ...preview("Orders"), start_row: 25, nonempty_rows: [25] } } });
  expect((await workbook.readWorkbook("project-1", "source-1", "Orders", undefined, 25)).start_row).toBe(25);
  expect(get).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ params: { sheet: "Orders", start_row: 25 } }));
  get.mockResolvedValueOnce({ data: { data: preview("Orders") } });
  await expect(workbook.readWorkbook("project-1", "source-1", "Orders", undefined, 25)).rejects.toThrow("Invalid workbook preview");
  await expect(workbook.readWorkbook("project-1", "source-1", "Orders", undefined, 0)).rejects.toThrow("Invalid preview row");
});

it("selects a late header from a physical-row preview and preserves its choice while paging", async () => {
  const read = vi.spyOn(workbook, "readWorkbook").mockImplementation(async (_project, _source, sheet, _signal, start = 1) => ({
    ...preview(sheet), start_row: start, rows: sheet ? [[null, null], ["order_id", "amount"], ["001", "10"]] : [],
    nonempty_rows: sheet ? [start + 1, start + 2] : [], has_more_rows: true,
  }));
  const prepare = vi.fn().mockResolvedValue(undefined);
  view(prepare);
  fireEvent.click(await screen.findByRole("button", { name: "Orders" }));
  await screen.findByRole("table");
  fireEvent.change(screen.getByLabelText("起始行"), { target: { value: "24" } });
  fireEvent.click(screen.getByRole("button", { name: "跳转" }));
  await screen.findByText("第 24–26 行预览");
  expect(screen.getByRole("button", { name: "将第 24 行用作表头" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "将第 25 行用作表头" }));
  expect(screen.getByRole("button", { name: "将第 25 行用作表头" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("第 25 行作为表头，前 24 行不参与分析。")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "后 12 行" }));
  await screen.findByText("第 36–38 行预览");
  expect(read.mock.calls.at(-1)?.[4]).toBe(36);
  expect(prepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "使用此工作表" }));
  expect(prepare).toHaveBeenCalledWith({ sheet: "Orders", header_row: 25, input_fingerprint: catalog.input_fingerprint, source_revision: catalog.source_revision });
});

it("refuses a header chosen from changed input and clears it when switching worksheets", async () => {
  let changed = false;
  vi.spyOn(workbook, "readWorkbook").mockImplementation(async (_project, _source, sheet, _signal, start = 1) => ({
    ...preview(sheet), start_row: start, nonempty_rows: sheet ? [start] : [], has_more_rows: true,
    input_fingerprint: changed ? "c".repeat(64) : catalog.input_fingerprint,
  }));
  const prepare = vi.fn().mockResolvedValue(undefined);
  view(prepare);
  fireEvent.click(await screen.findByRole("button", { name: "Orders" }));
  fireEvent.click(await screen.findByRole("button", { name: "将第 1 行用作表头" }));
  changed = true;
  fireEvent.click(screen.getByRole("button", { name: "后 12 行" }));
  await screen.findByText(messages.workbook.headerChanged);
  expect(screen.getByRole("button", { name: "使用此工作表" })).toBeDisabled();
  expect(prepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cash & Sales (隐藏)" }));
  await screen.findByRole("button", { name: "将第 1 行用作表头" });
  expect(screen.queryByText(messages.workbook.headerChanged)).not.toBeInTheDocument();
  expect(screen.getByText(messages.workbook.headerAutomatic)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "使用此工作表" }));
  expect(prepare).toHaveBeenCalledWith({ sheet: "Cash & Sales", input_fingerprint: "c".repeat(64), source_revision: catalog.source_revision });
});

it("uses generated headers explicitly without discarding the first preview row or submitting a row choice", async () => {
  vi.spyOn(workbook, "readWorkbook").mockImplementation(async (_project, _source, sheet, _signal, start = 1) => ({
    ...preview(sheet), start_row: start, nonempty_rows: sheet ? [start] : [], has_more_rows: true,
  }));
  const prepare = vi.fn().mockResolvedValue(undefined);
  view(prepare);
  fireEvent.click(await screen.findByRole("button", { name: "Orders" }));
  fireEvent.click(await screen.findByRole("button", { name: "将第 1 行用作表头" }));
  fireEvent.click(screen.getByRole("button", { name: "无表头" }));
  expect(screen.getByRole("button", { name: "无表头" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "将第 1 行用作表头" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("table")).toHaveTextContent("001");
  expect(screen.getByText(messages.workbook.headerlessSelected)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "自动识别" }));
  expect(screen.getByText(messages.workbook.headerAutomatic)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "无表头" }));
  fireEvent.click(screen.getByRole("button", { name: "后 12 行" }));
  await screen.findByText("第 13–13 行预览");
  expect(prepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "使用此工作表" }));
  expect(prepare).toHaveBeenCalledWith({ sheet: "Orders", headerless: true, input_fingerprint: catalog.input_fingerprint, source_revision: catalog.source_revision });
});

it("requires reconfirming generated headers after a changed workbook and can switch back to a header row", async () => {
  let changed = false;
  vi.spyOn(workbook, "readWorkbook").mockImplementation(async (_project, _source, sheet, _signal, start = 1) => ({
    ...preview(sheet), start_row: start, nonempty_rows: sheet ? [start] : [], has_more_rows: true,
    input_fingerprint: changed ? "d".repeat(64) : catalog.input_fingerprint,
  }));
  const prepare = vi.fn().mockResolvedValue(undefined);
  view(prepare);
  fireEvent.click(await screen.findByRole("button", { name: "Orders" }));
  await screen.findByRole("table");
  fireEvent.click(screen.getByRole("button", { name: "无表头" }));
  changed = true;
  fireEvent.click(screen.getByRole("button", { name: "后 12 行" }));
  await screen.findByText(messages.workbook.headerChanged);
  expect(screen.getByRole("button", { name: "使用此工作表" })).toBeDisabled();
  expect(prepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "将第 13 行用作表头" }));
  expect(screen.getByRole("button", { name: "无表头" })).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(screen.getByRole("button", { name: "使用此工作表" }));
  expect(prepare).toHaveBeenCalledWith({ sheet: "Orders", header_row: 13, input_fingerprint: "d".repeat(64), source_revision: catalog.source_revision });
});
