import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskDialog } from "@/components/ui/TaskDialog";
import { mockSemanticDialogs } from "./semantic-dialog-mock";

let restore: () => void;
beforeEach(() => { restore = mockSemanticDialogs(); });
afterEach(() => { cleanup(); restore(); });

function Window() {
  const dialog = useRef<HTMLDialogElement>(null), writing = useRef(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <TaskDialog dialogRef={dialog} writingRef={writing} busy={false} title="History" closeLabel="Close" onClose={() => {}}
    actions={<button>Refresh</button>}>
    <button disabled>Unavailable</button>
    <button hidden>Hidden</button>
    <button onKeyDown={event => { if (event.key === "Tab" && event.shiftKey) event.preventDefault(); }}>Local interaction</button>
    <button>Open analysis</button>
  </TaskDialog>;
}

describe("desktop task keyboard boundary", () => {
  it("wraps in both directions across frame and content actions, ignoring unavailable controls", () => {
    render(<Window />);
    const first = screen.getByRole("button", { name: "Refresh" }), last = screen.getByRole("button", { name: "Open analysis" });
    last.focus(); fireEvent.keyDown(last, { key: "Tab" }); expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true }); expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Tab", isComposing: true }); expect(last).toHaveFocus();
  });

  it("does not repeat a keyboard action already handled by a child", () => {
    render(<Window />);
    const local = screen.getByRole("button", { name: "Local interaction" });
    local.focus(); fireEvent.keyDown(local, { key: "Tab", shiftKey: true }); expect(local).toHaveFocus();
  });
});
