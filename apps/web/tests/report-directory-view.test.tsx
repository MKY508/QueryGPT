import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import { ReportDirectoryList } from "@/components/reports/ReportDirectoryList";
import { ReportLibraryControls } from "@/components/reports/ReportLibraryControls";
import type { ReportListItem } from "@/lib/reports";
import messages from "@/messages/zh.json";

afterEach(cleanup);
const report: ReportListItem = { id: "report", project_id: "project", title: "门店经营", description: "月度复盘", status: "draft", version: 3, page_count: 2, block_count: 6, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-09T00:00:00Z" };

it("keeps navigation separate from version-bound copy and delete actions", () => {
  const onCopy = vi.fn(), onDelete = vi.fn();
  const view = (blocked: boolean) => <NextIntlClientProvider locale="zh" messages={messages}>
    <ReportDirectoryList reports={[report]} href={() => "/reports/report?fromConversation=original"} writeDisabled={blocked} armedDeleteId="report" deletingId={null} onCopy={onCopy} onDelete={onDelete} />
  </NextIntlClientProvider>;
  const { rerender } = render(view(false));
  expect(screen.getByRole("link", { name: /门店经营 月度复盘/ })).toHaveAttribute("href", "/reports/report?fromConversation=original");
  fireEvent.click(screen.getByRole("button", { name: messages.reportIndex.confirmDelete }));
  expect(onDelete).toHaveBeenCalledExactlyOnceWith(report);
  expect(onCopy).not.toHaveBeenCalled();
  rerender(view(true));
  for (const button of screen.getAllByRole("button")) { expect(button).toBeDisabled(); fireEvent.click(button); }
  expect(onDelete).toHaveBeenCalledOnce(); expect(onCopy).not.toHaveBeenCalled();
});

it("submits search explicitly and distinguishes clearing search from clearing all filters", () => {
  const onChange = vi.fn();
  const view = { search: "门店", sort: "title" as const, status: "published" as const, page: 3 };
  render(<NextIntlClientProvider locale="zh" messages={messages}><ReportLibraryControls view={view} onChange={onChange} /></NextIntlClientProvider>);
  const input = screen.getByRole("searchbox");
  fireEvent.change(input, { target: { value: "门店收入" } });
  expect(onChange).not.toHaveBeenCalled();
  expect(fireEvent.keyDown(input, { key: "Enter", isComposing: true })).toBe(false);
  fireEvent.submit(screen.getByRole("search"));
  expect(onChange).toHaveBeenLastCalledWith({ ...view, search: "门店收入", page: 1 });
  fireEvent.click(screen.getByRole("button", { name: messages.reportIndex.clearSearch }));
  expect(onChange).toHaveBeenLastCalledWith({ ...view, search: "", page: 1 });
  fireEvent.click(screen.getByRole("button", { name: messages.reportIndex.clearFilters }));
  expect(onChange).toHaveBeenLastCalledWith({ ...view, search: "", status: "all", page: 1 });
});
