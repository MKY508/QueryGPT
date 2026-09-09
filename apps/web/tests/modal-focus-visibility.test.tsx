import { useRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { focusableElements, useModalFocus } from "@/lib/use-modal-focus";

afterEach(cleanup);
it("retains document order when a search clear action is inserted between controls", () => {
  const view = render(<div><button>Close</button><input aria-label="Search" /><button>Destination</button></div>);
  focusableElements(view.container);
  view.rerender(<div><button>Close</button><input aria-label="Search" /><button>Clear</button><button>Destination</button></div>);
  expect(focusableElements(view.container).map(element => element.getAttribute("aria-label") || element.textContent))
    .toEqual(["Close", "Search", "Clear", "Destination"]);
});

it("skips hidden and inert pane descendants for initial and wraparound focus, then restores the opener", async () => {
  const close = vi.fn();
  function Modal() {
    const container = useRef<HTMLDivElement>(null), initial = useRef<HTMLInputElement>(null);
    useModalFocus({ active: true, containerRef: container, initialFocusRef: initial, onClose: close });
    return <div ref={container} role="dialog" tabIndex={-1}>
      <div style={{ display: "none" }}><input ref={initial} aria-label="Hidden search" /></div>
      <button tabIndex={-1}>Programmatic only</button><button>First visible</button>
      <div hidden><button>Hidden pane</button></div>
      <div inert><button>Inert pane</button></div>
      <div aria-hidden="true"><button>Excluded pane</button></div>
      <button style={{ visibility: "hidden" }}>Invisible button</button>
      <button>Last visible</button><div style={{ display: "none" }}><button>Hidden last</button></div>
    </div>;
  }
  render(<button>Open picker</button>);
  const opener = screen.getByRole("button", { name: "Open picker" }); opener.focus();
  const view = render(<Modal />);
  const first = screen.getByRole("button", { name: "First visible" }), last = screen.getByRole("button", { name: "Last visible" });
  await waitFor(() => expect(first).toHaveFocus());
  fireEvent.keyDown(first, { key: "Tab", shiftKey: true }); expect(last).toHaveFocus();
  fireEvent.keyDown(last, { key: "Tab" }); expect(first).toHaveFocus();
  fireEvent.keyDown(first, { key: "Escape", isComposing: true }); expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(first, { key: "Escape" }); expect(close).toHaveBeenCalledOnce();
  view.unmount(); expect(opener).toHaveFocus();
});
