import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportPdfDialog } from "@/components/reports/ReportPdfDialog";
import type { ReportDocument } from "@/lib/reports";
import messages from "@/messages/en.json";

const report: ReportDocument = { id: "report", project_id: "project", title: "Monthly review", description: "", status: "draft", version: 1,
  created_at: "2026-09-06", updated_at: "2026-09-06", pages: Array.from({ length: 10 }, (_, index) => ({
    id: `page-${index + 1}`, title: `Section ${index + 1}`, order_index: index, config: {}, blocks: [],
  })).reverse() };
const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } },
  });
});
afterEach(() => {
  cleanup();
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

describe("PDF page chooser", () => {
  it("selects logical pages across search, keeps report order, and never exports from search or composition", () => {
    const exported = vi.fn();
    function Harness() {
      const [selectedIds, setSelected] = useState(["page-3"]);
      return <NextIntlClientProvider locale="en" messages={messages}>
        <ReportPdfDialog report={report} currentPageId="page-3" selectedIds={selectedIds} busy={false} error={null}
          onSelection={setSelected} onExport={() => exported(selectedIds)} onClose={() => {}} />
      </NextIntlClientProvider>;
    }
    render(<StrictMode><Harness /></StrictMode>);
    expect(screen.getByRole("checkbox", { name: "Page 3: Section 3" })).toHaveFocus();
    expect(screen.getAllByRole("checkbox")[0]).toHaveAccessibleName("Page 1: Section 1");
    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "Section 10" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(exported).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Page 10: Section 10" }));
    expect(screen.getByRole("status")).toHaveTextContent("2 report pages selected");
    fireEvent.click(screen.getByRole("button", { name: "All pages" }));
    expect(screen.getByRole("status")).toHaveTextContent("10 report pages selected");
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByRole("button", { name: "Export selected pages" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Current page only" }));
    expect(screen.getByRole("status")).toHaveTextContent("1 report page selected");
    fireEvent.compositionStart(search);
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    fireEvent.keyDown(search, { key: "Escape", isComposing: true });
    expect(exported).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    fireEvent.compositionEnd(search);
    fireEvent.click(screen.getByRole("button", { name: "Export selected pages" }));
    expect(exported).toHaveBeenCalledExactlyOnceWith(["page-3"]);
    expect(report.pages[0].id).toBe("page-10");
  });

  it("keeps busy selections locked and returns focus after cancellation without claiming an export", () => {
    const exported = vi.fn(), changed = vi.fn();
    function Harness({ busy = false, error = null }: { busy?: boolean; error?: string | null }) {
      const [open, setOpen] = useState(false);
      return <NextIntlClientProvider locale="en" messages={messages}>
        <button onClick={() => setOpen(true)}>Choose pages</button>
        {open && <ReportPdfDialog report={report} currentPageId="page-3" selectedIds={["page-3"]} busy={busy} error={error}
          onSelection={changed} onExport={exported} onClose={() => setOpen(false)} />}
      </NextIntlClientProvider>;
    }
    const view = render(<Harness />);
    const opener = screen.getByRole("button", { name: "Choose pages" });
    opener.focus(); fireEvent.click(opener);
    view.rerender(<Harness busy />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(within(dialog).getAllByRole("checkbox").every(input => input.hasAttribute("disabled"))).toBe(true);
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.submit(dialog.querySelector("form")!);
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(dialog).toHaveAttribute("open");
    expect(exported).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    view.rerender(<Harness error="Could not prepare the PDF" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not prepare the PDF");
    expect(screen.getByRole("checkbox", { name: "Page 3: Section 3" })).toBeChecked();
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
