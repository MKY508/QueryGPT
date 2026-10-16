import { StrictMode, useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkbenchSearchShortcut } from "@/components/chat/useWorkbenchSearchShortcut";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function Workbench({ inert = false, modal = false, reveal }: { inert?: boolean; modal?: boolean; reveal: () => void }) {
  const root = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);
  const [opened, setOpened] = useState(false);
  // Deliberately recreated on each render, as in the production caller.
  useWorkbenchSearchShortcut(root, search, () => { setOpened(true); reveal(); });
  return <><div ref={root} inert={inert}><input ref={search} aria-label="search" /><button>Canvas</button><span>{String(opened)}</span></div>
    {modal && <div role="dialog" aria-modal="true"><input aria-label="modal search" /></div>}</>;
}

describe("workbench search shortcut", () => {
  it("focuses search after a reveal rerender, but ignores modifiers, composition, repeats and already handled keys", async () => {
    const reveal = vi.fn();
    render(<StrictMode><Workbench reveal={reveal} /></StrictMode>);
    const canvas = screen.getByText("Canvas");
    for (const extra of [{ altKey: true }, { shiftKey: true }, { isComposing: true }, { keyCode: 229 }, { repeat: true }]) {
      fireEvent.keyDown(canvas, { key: "k", metaKey: true, ...extra });
    }
    const handled = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, cancelable: true, bubbles: true });
    handled.preventDefault();
    fireEvent(canvas, handled);
    expect(reveal).not.toHaveBeenCalled();
    fireEvent.keyDown(canvas, { key: "K", ctrlKey: true });
    expect(reveal).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByLabelText("search")).toHaveFocus());
  });

  it("does not act behind inert areas, task modals or native dialogs", () => {
    const reveal = vi.fn();
    const view = render(<Workbench reveal={reveal} inert />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    view.rerender(<Workbench reveal={reveal} modal />);
    fireEvent.keyDown(screen.getByLabelText("modal search"), { key: "k", ctrlKey: true });
    view.rerender(<><Workbench reveal={reveal} /><dialog open aria-modal="true"><input aria-label="native" /></dialog></>);
    fireEvent.keyDown(screen.getByLabelText("native"), { key: "k", metaKey: true });
    expect(reveal).not.toHaveBeenCalled();
  });

  it("does not steal focus from a newer modal or user navigation while the focus frame is queued", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => frames.push(callback));
    const cancelled = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const reveal = vi.fn();
    const view = render(<Workbench reveal={reveal} />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    view.rerender(<Workbench reveal={reveal} modal />);
    act(() => { frames[0](0); });
    expect(screen.getByLabelText("search")).not.toHaveFocus();
    view.rerender(<Workbench reveal={reveal} />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    screen.getByText("Canvas").focus();
    act(() => { frames[1](0); });
    expect(screen.getByText("Canvas")).toHaveFocus();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    view.unmount();
    expect(cancelled).toHaveBeenLastCalledWith(3);
    act(() => { frames[2](0); });
    expect(reveal).toHaveBeenCalledTimes(3);
  });
});
