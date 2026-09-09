import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReportKeyboard } from "@/components/reports/useReportKeyboard";

afterEach(() => { cleanup(); document.body.replaceChildren(); });
function setup() {
  const props = { editing: true, blocked: false, composing: { current: false }, onSave: vi.fn(), onPrint: vi.fn(), onHistory: vi.fn() };
  const hook = renderHook((options) => useReportKeyboard(options), { initialProps: props });
  const key = (key: string, target: EventTarget = window, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true, ...options });
    act(() => target.dispatchEvent(event)); return event;
  };
  const nativeUndo = (target: EventTarget) => {
    const event = new InputEvent("beforeinput", { inputType: "historyUndo", bubbles: true, cancelable: true });
    act(() => target.dispatchEvent(event)); return event;
  };
  return { ...props, hook, props, key, nativeUndo };
}

describe("report keyboard ownership", () => {
  it("allows shortcuts only inside the owned writing dialog and yields to unrelated modal tasks", () => {
    const { key, nativeUndo, onSave, onPrint, onHistory } = setup();
    const writer = document.createElement("dialog"); writer.open = true; writer.setAttribute("aria-modal", "true"); writer.dataset.reportEditorDialog = ""; writer.dataset.reportHistory = "";
    const body = document.createElement("textarea"); writer.append(body); document.body.append(writer);
    key("s", body); key("p", body); key("z", body);
    expect(onSave).toHaveBeenCalledOnce(); expect(onPrint).toHaveBeenCalledOnce(); expect(onHistory).toHaveBeenLastCalledWith("undo");
    expect(nativeUndo(body).defaultPrevented).toBe(true);
    key("s", window); key("z", window);
    expect(onSave).toHaveBeenCalledOnce(); expect(onHistory).toHaveBeenCalledTimes(2);
    const other = document.createElement("dialog"); other.open = true; other.setAttribute("aria-modal", "true"); document.body.append(other);
    key("s", body); key("z", body); nativeUndo(body);
    expect(onSave).toHaveBeenCalledOnce(); expect(onHistory).toHaveBeenCalledTimes(2);
  });
  it.each(["dialog", "task"])("keeps save/print and history out of an open %s, but preserves native search undo", (kind) => {
    const { key, nativeUndo, onSave, onPrint, onHistory } = setup();
    const modal = document.createElement(kind === "dialog" ? "dialog" : "section");
    if (kind === "dialog") modal.setAttribute("open", "");
    modal.setAttribute("aria-modal", "true");
    const search = document.createElement("input"); search.type = "search"; modal.append(search); document.body.append(modal);
    expect(key("s", search).defaultPrevented).toBe(true);
    expect(key("p", window).defaultPrevented).toBe(true);
    expect(key("z", search).defaultPrevented).toBe(false);
    expect(nativeUndo(search).defaultPrevented).toBe(false);
    expect(onSave).not.toHaveBeenCalled(); expect(onPrint).not.toHaveBeenCalled(); expect(onHistory).not.toHaveBeenCalled();
    modal.remove(); key("s"); expect(onSave).toHaveBeenCalledOnce();
  });

  it("allows desktop sidebars to edit the report but preserves search/select/contenteditable undo", () => {
    const { key, nativeUndo, onSave, onHistory } = setup();
    const pane = document.createElement("aside"); pane.dataset.reportHistory = "";
    const title = document.createElement("input"), search = document.createElement("input"), select = document.createElement("select"), editable = document.createElement("div");
    search.type = "search"; editable.setAttribute("contenteditable", "plaintext-only");
    pane.append(title, search, select, editable); document.body.append(pane);
    key("s", title); expect(onSave).toHaveBeenCalledOnce();
    key("z", title); expect(onHistory).toHaveBeenLastCalledWith("undo");
    expect(nativeUndo(title).defaultPrevented).toBe(true);
    for (const target of [search, select, editable]) expect(key("z", target).defaultPrevented).toBe(false);
    expect(onHistory).toHaveBeenCalledTimes(2);
  });

  it("does not let an inline native panel or a closed writing dialog block the document", () => {
    const { key, onSave, onHistory } = setup();
    const panel = document.createElement("dialog"); panel.open = true;
    // Model a nonmodal dialog explicitly; DOM test engines differ in :modal support.
    const matches = panel.matches.bind(panel);
    vi.spyOn(panel, "matches").mockImplementation((selector) => selector === ":modal" ? false : matches(selector));
    const closedWriter = document.createElement("dialog");
    closedWriter.dataset.reportEditorDialog = ""; closedWriter.setAttribute("aria-modal", "true");
    document.body.append(panel, closedWriter);
    key("s"); key("z");
    expect(onSave).toHaveBeenCalledOnce(); expect(onHistory).toHaveBeenLastCalledWith("undo");
  });

  it("honors pending modal state, read mode, IME, repeated keys, modifiers and teardown", () => {
    const { props, hook, key, onSave, onPrint, onHistory } = setup();
    hook.rerender({ ...props, blocked: true });
    expect(key("s").defaultPrevented).toBe(true); key("p"); key("z");
    expect(onSave).not.toHaveBeenCalled(); expect(onPrint).not.toHaveBeenCalled(); expect(onHistory).not.toHaveBeenCalled();
    hook.rerender({ ...props, editing: false }); key("z"); expect(onHistory).not.toHaveBeenCalled();
    key("p"); expect(onPrint).toHaveBeenCalledOnce();
    hook.rerender(props);
    for (const options of [{ isComposing: true }, { keyCode: 229 }, { altKey: true }, { shiftKey: true }, { repeat: true }]) key("s", window, options);
    props.composing.current = true; key("s"); key("z"); props.composing.current = false;
    expect(onSave).not.toHaveBeenCalled(); expect(onHistory).not.toHaveBeenCalled();
    key("z", window, { shiftKey: true }); expect(onHistory).toHaveBeenLastCalledWith("redo");
    key("y"); expect(onHistory).toHaveBeenLastCalledWith("redo");
    key("s", window, { ctrlKey: false, metaKey: true }); expect(onSave).toHaveBeenCalledOnce();
    hook.unmount(); key("s"); expect(onSave).toHaveBeenCalledOnce();
  });
});
