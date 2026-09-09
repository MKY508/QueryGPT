import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsEditor } from "@/components/settings/SettingsEditor";
import { WorkbenchNavigation } from "@/components/chat/WorkbenchNavigation";
import en from "@/messages/en.json";

const close = vi.fn();
function Editor({ active = true, confirming = false, disabled = false } = {}) {
  const [value, setValue] = useState("Unfinished configuration");
  return <NextIntlClientProvider locale="en" messages={en}>
    <button>Directory action</button>
    <SettingsEditor title="Edit configuration" active={active} confirming={confirming} disabled={disabled} onClose={close}>
      <input data-settings-primary-field="" aria-label="Name" value={value} disabled={disabled} onChange={event => setValue(event.target.value)} />
    </SettingsEditor>
  </NextIntlClientProvider>;
}
afterEach(() => { cleanup(); close.mockClear(); });

describe("desktop panels", () => {
  it("retains a hidden editor's input and selection without creating a modal", () => {
    const view = render(<Editor />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Kept draft" } }); input.setSelectionRange(2, 5);
    view.rerender(<Editor active={false} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    view.rerender(<Editor />);
    expect(screen.getByRole("textbox")).toBe(input);
    expect(input).toHaveValue("Kept draft"); expect(input.selectionStart).toBe(2);
    expect(document.querySelector("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Directory action" })).not.toBeDisabled();
  });

  it("closes only on an unhandled non-composing Escape, not while saving or confirming", () => {
    const view = render(<Editor />);
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "Escape", isComposing: true });
    view.rerender(<Editor disabled />); fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    view.rerender(<Editor confirming />); fireEvent.keyDown(input, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
    view.rerender(<Editor />); fireEvent.keyDown(input, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not take focus or consume Escape behind a real confirmation", () => {
    const view = render(<><dialog open aria-modal="true"><button>Decision</button></dialog><Editor active={false} /></>);
    const decision = screen.getByRole("button", { name: "Decision" }); decision.focus();
    view.rerender(<><dialog open aria-modal="true"><button>Decision</button></dialog><Editor /></>);
    expect(decision).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
  });

  it("collapses navigation while retaining its content and returns keyboard focus to its entry", () => {
    function Navigation() {
      const [open, setOpen] = useState(true);
      const panel = useRef<HTMLElement>(null), trigger = useRef<HTMLButtonElement>(null);
      return <><button ref={trigger} onClick={() => setOpen(!open)}>Navigation</button>
        <WorkbenchNavigation open={open} label="Workspace" panelRef={panel} triggerRef={trigger} onClose={() => setOpen(false)}>
          <input aria-label="Search" defaultValue="Orders" />
        </WorkbenchNavigation></>;
    }
    render(<Navigation />);
    const input = screen.getByRole("textbox"); input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Navigation" })).toHaveFocus();
    expect(screen.queryByRole("complementary")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Navigation" }));
    expect(screen.getByRole("textbox")).toBe(input);
    expect(input).toHaveValue("Orders");
    expect(document.querySelector("dialog")).toBeNull();
  });
});
