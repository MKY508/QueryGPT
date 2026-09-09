import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SemanticDetailPanel } from "@/components/semantic/SemanticDetailPanel";
import messages from "@/messages/zh.json";

afterEach(cleanup);
const defaults = { covered: false, focusRequest: 1, title: "净收入", index: 0, count: 2, busy: false,
  onNavigate: vi.fn(), onReturnFocus: vi.fn(), children: <button>编辑</button> };
const panel = (props: Partial<typeof defaults> = {}) => <NextIntlClientProvider locale="zh" messages={messages}>
  <SemanticDetailPanel {...defaults} {...props} />
</NextIntlClientProvider>;

describe("desktop semantic inspector", () => {
  it("keeps one reading node and only returns focus on an unhandled Escape", () => {
    const onReturnFocus = vi.fn();
    const { rerender } = render(panel({ onReturnFocus }));
    const inspector = screen.getByRole("complementary", { name: "净收入" });
    const heading = screen.getByRole("heading");
    expect(heading).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.keyDown(heading, { key: "Escape", isComposing: true });
    expect(onReturnFocus).not.toHaveBeenCalled();
    fireEvent.keyDown(heading, { key: "Escape" });
    expect(onReturnFocus).toHaveBeenCalledOnce();
    screen.getByRole("button", { name: "编辑" }).focus();
    rerender(panel({ onReturnFocus }));
    expect(screen.getByRole("complementary")).toBe(inspector);
    expect(screen.getByRole("button", { name: "编辑" })).toHaveFocus();
  });

  it("blocks busy and out-of-page navigation without removing its controls", () => {
    const onNavigate = vi.fn();
    const { rerender } = render(panel({ onNavigate }));
    fireEvent.click(screen.getByRole("button", { name: messages.projectUnderstanding.details.previous }));
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: messages.projectUnderstanding.details.next }));
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(1);
    rerender(panel({ index: 1, busy: true, onNavigate }));
    fireEvent.click(screen.getByRole("button", { name: messages.projectUnderstanding.details.previous }));
    fireEvent.click(screen.getByRole("button", { name: messages.projectUnderstanding.details.next }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("defers reading focus while editing and leaves Tab navigation alone", () => {
    const onReturnFocus = vi.fn();
    const { rerender } = render(panel({ onReturnFocus }));
    const edit = screen.getByRole("button", { name: "编辑" }); edit.focus();
    rerender(panel({ covered: true, focusRequest: 2, onReturnFocus }));
    expect(edit).toHaveFocus();
    fireEvent.keyDown(edit, { key: "Escape" });
    expect(onReturnFocus).not.toHaveBeenCalled();
    rerender(panel({ focusRequest: 2, onReturnFocus }));
    expect(screen.getByRole("heading")).toHaveFocus();
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    fireEvent(screen.getByRole("heading"), tab);
    expect(tab.defaultPrevented).toBe(false);
  });
});
