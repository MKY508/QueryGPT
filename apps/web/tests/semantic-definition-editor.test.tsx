import { useRef, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SemanticDefinitionEditor } from "@/components/semantic/SemanticDefinitionEditor";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

const methods = ["showModal", "close"] as const;
let descriptors: (PropertyDescriptor | undefined)[];
beforeEach(() => {
  descriptors = methods.map(name => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name));
  for (const name of methods) Object.defineProperty(HTMLDialogElement.prototype, name, {
    configurable: true, value: function(this: HTMLDialogElement) { this.open = name === "showModal"; },
  });
});
afterEach(() => {
  cleanup();
  methods.forEach((name, index) => descriptors[index]
    ? Object.defineProperty(HTMLDialogElement.prototype, name, descriptors[index]!)
    : Reflect.deleteProperty(HTMLDialogElement.prototype, name));
});

function Editor({ busy = false, blocked = false, onClose, onSubmit }: {
  busy?: boolean; blocked?: boolean; onClose: () => void; onSubmit: () => void;
}) {
  const writing = useRef(busy), initial = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("  My definition\n");
  return <SemanticDefinitionEditor editing busy={busy} dirty saveBlocked={blocked} writingRef={writing}
    initialFocusRef={initial} onClose={onClose} onSubmit={event => { event.preventDefault(); onSubmit(); }}>
    <input ref={initial} aria-label="Name" defaultValue="Revenue" />
    <textarea aria-label="Meaning" value={draft} onChange={event => setDraft(event.target.value)} />
  </SemanticDefinitionEditor>;
}
const wrap = (children: React.ReactNode, english = false) => <NextIntlClientProvider locale={english ? "en" : "zh"} messages={english ? en : zh}>{children}</NextIntlClientProvider>;

describe("desktop definition editor", () => {
  it("keeps the same draft and native window across language changes, and delegates only deliberate close", async () => {
    const onClose = vi.fn(), onSubmit = vi.fn();
    const view = render(wrap(<Editor onClose={onClose} onSubmit={onSubmit} />));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus());
    const dialog = screen.getByRole("dialog"), meaning = screen.getByRole("textbox", { name: "Meaning" });
    fireEvent.change(meaning, { target: { value: "  Revised\t\n" } });
    view.rerender(wrap(<Editor onClose={onClose} onSubmit={onSubmit} />, true));
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(meaning).toHaveValue("  Revised\t\n");
    fireEvent.keyDown(meaning, { key: "Escape", isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(meaning, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialog).toHaveAttribute("open");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each(["busy", "blocked"])("blocks programmatic submission when %s", reason => {
    const onClose = vi.fn(), onSubmit = vi.fn();
    render(wrap(<Editor busy={reason === "busy"} blocked={reason === "blocked"} onClose={onClose} onSubmit={onSubmit} />));
    fireEvent.submit(screen.getByRole("textbox", { name: "Meaning" }).closest("form")!);
    expect(onSubmit).not.toHaveBeenCalled();
    if (reason === "busy") {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: zh.projectUnderstanding.actions.cancel })).toBeDisabled();
    }
  });
});
