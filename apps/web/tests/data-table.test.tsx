import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import * as csv from "@/lib/csv";
import { DataTable } from "@/components/chat/DataTable";
import type { DataRow } from "@/lib/types/api";
import messages from "@/messages/zh.json";

const table = (data: DataRow[]) => (
  <NextIntlClientProvider locale="zh" messages={messages}>
    <DataTable data={data} />
  </NextIntlClientProvider>
);

describe("result table", () => {
  it("renders missing inherited-name columns as blanks, consistent with exported data", () => {
    render(table([JSON.parse('{"toString":"own","constructor":"shop","__proto__":"literal"}'), {}]));
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["own", "shop", "literal"]);
    expect(within(rows[2]).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["—", "—", "—"]);
  });

  it("names each table, makes its scroll region focusable, and keeps pagination out of form submission", () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(<form onSubmit={onSubmit}>{table(Array.from({ length: 21 }, (_, amount) => ({ amount })))}</form>);
    const result = screen.getByRole("table", { name: messages.assistant.queryResult });
    const region = screen.getByRole("region", { name: messages.assistant.queryResult });
    region.focus();
    expect(region).toHaveFocus();
    const next = screen.getByRole("button", { name: messages.assistant.nextPage });
    expect(next).toHaveAttribute("aria-controls", result.id);
    fireEvent.click(next);
    expect(screen.getByRole("status")).toHaveTextContent("第 2 / 3 页");
    fireEvent.click(screen.getByRole("button", { name: messages.assistant.prevPage }));
    expect(screen.getByRole("status")).toHaveTextContent("第 1 / 3 页");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("normalizes fractional preview limits without creating empty pages", () => {
    render(<NextIntlClientProvider locale="zh" messages={messages}>
      <DataTable data={Array.from({ length: 11 }, (_, amount) => ({ amount }))} maxRows={10.5} />
    </NextIntlClientProvider>);
    expect(screen.getAllByRole("row")).toHaveLength(11);
    expect(screen.queryByRole("button", { name: messages.assistant.nextPage })).not.toBeInTheDocument();
  });

  it("shows a retryable export error and exports all sorted rows on retry", () => {
    const download = vi.spyOn(csv, "downloadCsv").mockImplementationOnce(() => { throw new Error("unavailable"); }).mockImplementation(() => {});
    try {
      render(table(Array.from({ length: 101 }, (_, index) => ({ amount: 101 - index }))));
      fireEvent.click(screen.getByRole("button", { name: "amount" }));
      const button = screen.getByRole("button", { name: messages.assistant.exportCsv });
      fireEvent.click(button);
      expect(screen.getByRole("alert")).toHaveTextContent(messages.dataView.exportError);
      fireEvent.click(button);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(download).toHaveBeenCalledTimes(2);
      expect(download.mock.calls[1][0]).toEqual(Array.from({ length: 101 }, (_, index) => ({ amount: index + 1 })));
    } finally { download.mockRestore(); }
  });

  it("sorts exact numeric strings numerically and leaves blanks last", () => {
    render(table([
      { amount: "9007199254740993" }, { amount: "10.01" }, { amount: null },
      { amount: "9007199254740992" }, { amount: "2.01" },
    ]));
    fireEvent.click(screen.getByRole("button", { name: "amount" }));
    const values = () => screen.getAllByRole("row").slice(1).map((row) => row.textContent);
    expect(values()).toEqual(["2.01", "10.01", "9007199254740992", "9007199254740993", "—"]);
    fireEvent.click(screen.getByRole("button", { name: "amount" }));
    expect(values()).toEqual(["9007199254740993", "9007199254740992", "10.01", "2.01", "—"]);
  });
  it("sorts all results before applying the preview limit", () => {
    render(table(Array.from({ length: 101 }, (_, index) => ({ amount: 101 - index }))));
    fireEvent.click(screen.getByRole("button", { name: "amount" }));
    expect(within(screen.getAllByRole("row")[1]).getByRole("cell")).toHaveTextContent(/^1$/);
  });

  it("keeps a valid page when a result is replaced with fewer rows", () => {
    const view = render(table(Array.from({ length: 30 }, (_, index) => ({ amount: index }))));
    fireEvent.click(screen.getByRole("button", { name: messages.assistant.nextPage }));
    fireEvent.click(screen.getByRole("button", { name: messages.assistant.nextPage }));
    view.rerender(table([{ amount: 99 }]));
    expect(screen.getByRole("cell", { name: "99" })).toBeInTheDocument();
  });
});
