import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportTextEditor } from "@/components/reports/ReportTextEditor";
import { reportBlockText, isReportTextBlock } from "@/lib/report-text";
import { applyReportBlockUpdates } from "@/lib/report-blocks";
import type { ReportBlock } from "@/lib/reports";
import messages from "@/messages/en.json";

const initial: ReportBlock = { id: "text-1", block_type: "evidence", title: "Quarterly findings", order_index: 0,
  source_kind: "artifact", artifact_id: "evidence-1", analysis_run_id: "run-1", source_ref: { origin: "unchanged" },
  content: { value: "  original....\n第二段\t ", items: [{ label: "Existing evidence", text: "Kept supporting detail" }], retained: true },
  layout: { x: 0, y: 0, w: 6, h: 3 }, config: { highlight: "Verified context" } };
afterEach(cleanup);

describe("focused report writing", () => {
  it("retains the writing window across saved identity changes and preserves report shortcut propagation", () => {
    const close = vi.fn(), keyboard = vi.fn();
    const writer = (block: ReportBlock) => <NextIntlClientProvider locale="en" messages={messages}>
      <ReportTextEditor block={block} pageTitle="Overview" disabled={false} saving={false} saveDisabled
        status="Saved" canUndo={false} canRedo={false} onUndo={() => {}} onRedo={() => {}}
        onChange={() => {}} onSave={() => {}} onClose={close} />
    </NextIntlClientProvider>;
    const view = render(writer(initial));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    view.rerender(writer({ ...initial, id: "another", title: "Another block" }));
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.getByRole("button", { name: "Compare" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "Content title" })).toHaveValue("Another block");
    expect(screen.getByRole("textbox", { name: "Body text" })).toHaveFocus();
    window.addEventListener("keydown", keyboard);
    try {
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Body text" }), { key: "s", metaKey: true });
      expect(keyboard).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener("keydown", keyboard); }
    expect(close).not.toHaveBeenCalled();
  });
  it("reads legacy values and exact text without confusing other block types or empty overrides", () => {
    expect(reportBlockText(initial)).toBe(initial.content.value);
    expect(reportBlockText({ ...initial, content: { text: "", summary: "old" } })).toBe("");
    expect(reportBlockText({ ...initial, content: { summary: 0 } })).toBe("0");
    expect(reportBlockText({ ...initial, content: { text: {}, description: "fallback" } })).toBe("fallback");
    expect(reportBlockText({ ...initial, block_type: "metric", content: { text: "wrong", value: 0 } })).toBe("0");
    for (const block_type of ["text", "evidence"] as const) expect(isReportTextBlock({ ...initial, block_type })).toBe(true);
    for (const block_type of ["chart", "metric", "table", "filter"] as const) expect(isReportTextBlock({ ...initial, block_type })).toBe(false);
  });

  it("ignores inherited aliases without reading getters or losing exact own values", () => {
    const prototype = { get text(): string { throw new Error("Inherited text must not be evaluated"); }, value: "not report data" };
    const content = Object.assign(Object.create(prototype), { summary: "  原文....\n👩🏽‍💻\t " });
    expect(reportBlockText({ ...initial, content })).toBe(content.summary);
    expect(reportBlockText({ ...initial, content: Object.create({ summary: "inherited" }) })).toBe("");
    expect(reportBlockText({ ...initial, block_type: "metric", content: Object.create({ value: 42 }) })).toBe("");
    const empty = Object.assign(Object.create({ text: "wrong" }), { text: "", summary: "old" });
    expect(reportBlockText({ ...initial, content: empty })).toBe("");
    const own = Object.assign(Object.create(null), { hasOwnProperty: false, value: 0 });
    expect(reportBlockText({ ...initial, content: own })).toBe("0");
  });

  it("resumes the last writing field and selection after preview without restoring stale text offsets", () => {
    const changes = vi.fn(), save = vi.fn();
    function Writer({ block = initial, disabled = false }: { block?: ReportBlock; disabled?: boolean }) {
      return <NextIntlClientProvider locale="en" messages={messages}>
        <ReportTextEditor block={block} pageTitle="Overview" disabled={disabled} saving={false} saveDisabled={disabled}
          status="Unsaved changes" canUndo={false} canRedo={false} onUndo={() => {}} onRedo={() => {}}
          onChange={changes} onSave={save} onClose={() => {}} />
      </NextIntlClientProvider>;
    }
    const { rerender } = render(<Writer />);
    const switchTo = (name: string) => {
      const button = screen.getByRole("button", { name });
      button.focus(); fireEvent.click(button);
    };
    const body = screen.getByRole("textbox", { name: "Body text" }) as HTMLTextAreaElement;
    body.setSelectionRange(2, 9, "backward"); body.scrollTop = 96;
    const viewport = body.closest("section")!.parentElement!.parentElement!;
    viewport.scrollTop = 64;
    switchTo("Preview");
    expect(body).not.toBeInTheDocument();
    viewport.scrollTop = 120;
    switchTo("Write");
    const restored = screen.getByRole("textbox", { name: "Body text" }) as HTMLTextAreaElement;
    expect(restored).toHaveFocus();
    expect([restored.selectionStart, restored.selectionEnd, restored.selectionDirection]).toEqual([2, 9, "backward"]);
    expect(restored.scrollTop).toBe(96); expect(viewport.scrollTop).toBe(64);
    const heading = screen.getByRole("textbox", { name: "Content title" }) as HTMLInputElement;
    heading.focus(); heading.setSelectionRange(1, 5, "forward");
    switchTo("Preview"); switchTo("Compare");
    const restoredHeading = screen.getByRole("textbox", { name: "Content title" }) as HTMLInputElement;
    expect(restoredHeading).toHaveFocus();
    expect([restoredHeading.selectionStart, restoredHeading.selectionEnd]).toEqual([1, 5]);
    switchTo("Preview");
    rerender(<Writer block={{ ...initial, title: "Changed title" }} />);
    switchTo("Write");
    const changedHeading = screen.getByRole("textbox", { name: "Content title" }) as HTMLInputElement;
    expect(changedHeading).toHaveValue("Changed title");
    expect(changedHeading.selectionStart).toBe(changedHeading.selectionEnd);
    switchTo("Preview"); rerender(<Writer disabled />); switchTo("Write");
    expect(screen.getByRole("button", { name: "Write" })).toHaveFocus();
    expect(changes).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  });

  it("keeps native cancel and unflagged Escape inside an active composition", () => {
    const close = vi.fn();
    render(<NextIntlClientProvider locale="en" messages={messages}>
      <ReportTextEditor block={initial} pageTitle="Overview" disabled={false} saving={false} saveDisabled={false}
        status="Unsaved changes" canUndo={false} canRedo={false} onUndo={() => {}} onRedo={() => {}}
        onChange={() => {}} onSave={() => {}} onClose={close} />
    </NextIntlClientProvider>);
    const dialog = screen.getByRole("dialog");
    const body = screen.getByRole("textbox", { name: "Body text" });
    fireEvent.compositionStart(body);
    fireEvent.keyDown(body, { key: "Escape" });
    const cancel = new Event("cancel", { cancelable: true });
    fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(close).not.toHaveBeenCalled();
    fireEvent.compositionEnd(body);
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(close).toHaveBeenCalledTimes(1);
    fireEvent.compositionStart(body);
    fireEvent.blur(body);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("edits one live draft, previews the real evidence presentation, and returns without a hidden save", () => {
    const save = vi.fn(), changes = vi.fn();
    function Harness({ disabled = false }: { disabled?: boolean }) {
      const [block, setBlock] = useState(initial), [open, setOpen] = useState(false);
      return <NextIntlClientProvider locale="en" messages={messages}>
        <button onClick={() => setOpen(true)}>Open writer</button>
        {open && <ReportTextEditor block={block} pageTitle="Overview" disabled={disabled} saving={false} saveDisabled={disabled}
          status="Unsaved changes" canUndo={false} canRedo={false} onUndo={() => {}} onRedo={() => {}}
          onChange={updates => { changes(updates); setBlock(current => applyReportBlockUpdates(current, updates)); }} onSave={save} onClose={() => setOpen(false)} />}
      </NextIntlClientProvider>;
    }
    const { rerender } = render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open writer" }); opener.focus(); fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Focus writing" });
    const body = within(dialog).getByRole("textbox", { name: "Body text" });
    expect(body).toHaveFocus(); expect(body).toHaveValue("  original....\n第二段\t ");
    const raw = "  Revised conclusion!\n<script>alert(1)</script>\n尾部\t ";
    fireEvent.change(body, { target: { value: raw } });
    expect(changes).toHaveBeenLastCalledWith({ content: { ...initial.content, text: raw } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Content title" }), { target: { value: "Revised title" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Compare" }));
    const preview = within(dialog).getByRole("region", { name: "In the report" });
    expect(preview).toHaveTextContent("Revised title"); expect(preview).toHaveTextContent("Existing evidence"); expect(preview).toHaveTextContent("Kept supporting detail");
    expect(preview.querySelector("article p.whitespace-pre-wrap")?.textContent).toBe(raw);
    expect(preview.querySelector("script")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Preview" }));
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Write" }));
    expect(within(dialog).getByRole("textbox", { name: "Body text" })).toHaveValue(raw);
    expect(changes).toHaveBeenCalledTimes(2);
    rerender(<Harness disabled />);
    expect(within(dialog).getByRole("textbox", { name: "Body text" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.keyDown(dialog, { key: "Escape", isComposing: true }); expect(dialog).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(opener).toHaveFocus();
    fireEvent.click(opener);
    expect(screen.getByRole("textbox", { name: "Body text" })).toHaveValue(raw);
    expect(save).not.toHaveBeenCalled(); expect(initial.content.text).toBeUndefined();
  });
});
