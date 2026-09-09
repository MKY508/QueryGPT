import { StrictMode, useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { AnalysisWorkbench, type WorkbenchView } from "@/components/chat/AnalysisWorkbench";
import type { ChatMessage } from "@/lib/types/chat";
import zh from "@/messages/zh.json";
import { mockSemanticDialogs, mockSemanticWidth } from "./semantic-dialog-mock";

const messages: ChatMessage[] = [
  { id: "a", role: "assistant", content: "First result", originalQuery: "Question A" },
  { id: "b", role: "assistant", content: "Second result", originalQuery: "Question B" },
];
const submit = vi.fn(), history = vi.fn();
function Harness({ items = messages, request = 0 }: { items?: ChatMessage[]; request?: number }) {
  const [view, setView] = useState<WorkbenchView>("result");
  return <NextIntlClientProvider locale="zh" messages={zh}>
    <AnalysisWorkbench messages={items} view={view} onViewChange={setView} onNewAnalysis={submit} onOpenHistory={history}
      focusComposerRequest={request} composer={<textarea aria-label="Draft" defaultValue="Keep my question" />}
      emptyContent={<p>No result</p>} dataContent={view !== "result" ? <p>Sources</p> : null}
      renderResult={(message) => <><h1>{message.content}</h1><input aria-label={`Note ${message.id}`} /></>} />
  </NextIntlClientProvider>;
}
function layout() {
  const viewport = mockSemanticWidth(true);
  // Native focus trapping is verified in Chrome, not simulated by this mock.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function(this: HTMLElement) {
    const hidden = this.closest('[hidden], dialog:not([open])');
    return (hidden ? [] : [{ width: 200, height: 100 }]) as unknown as DOMRectList;
  });
  return viewport;
}
const button = (name: string) => screen.getByRole("button", { name });
const entry = (letter: string) => screen.getByRole("button", { name: new RegExp(`Question ${letter}`) });
const result = () => screen.getByRole("region", { name: zh.workbench.result });
const click = (node: HTMLElement) => { node.focus(); fireEvent.click(node); };
const menu = () => within(screen.getByRole("region", { name: zh.workbench.canvas })).getByRole("button", { name: /工作区导航/ });
let restoreDialogs: () => void;
beforeEach(() => { restoreDialogs = mockSemanticDialogs(); });
afterEach(() => { cleanup(); restoreDialogs(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("workbench pane focus", () => {
  it("retains the result and draft while desktop navigation is collapsed", () => {
    layout(); render(<Harness />);
    const draft = screen.getByLabelText("Draft");
    expect(screen.getByRole("complementary")).not.toHaveAttribute("aria-modal");
    click(entry("A")); expect(entry("A")).toHaveFocus();
    expect(within(screen.getByRole("region", { name: zh.workbench.result })).getByRole("heading", { level: 1 })).toHaveTextContent("First result");
    const search = screen.getByPlaceholderText(zh.workbench.search);
    fireEvent.change(search, { target: { value: "Question B" } });
    click(within(screen.getByRole("complementary")).getByRole("button", { name: zh.workbench.closeNavigation })); expect(menu()).toHaveFocus();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    click(menu());
    expect(search).toHaveValue("Question B");
    expect(screen.getByLabelText("Draft")).toBe(draft);
    expect(submit).not.toHaveBeenCalled(); expect(history).not.toHaveBeenCalled();
  });

  it("preserves visible desktop list focus and returns from focused reading directly to the existing draft", () => {
    layout(); render(<Harness />);
    click(entry("A")); expect(entry("A")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Note a"), { target: { value: "Unsaved note" } });
    click(within(screen.getByRole("complementary")).getByRole("button", { name: zh.workbench.closeNavigation }));
    expect(menu()).toHaveFocus();
    expect(menu()).toHaveAttribute("aria-expanded", "false");
    click(button(zh.workbench.continueQuestion));
    expect(screen.getByLabelText("Draft")).toHaveFocus();
    expect(screen.getByLabelText("Draft")).toHaveValue("Keep my question");
    expect(menu()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("Note a")).toHaveValue("Unsaved note");
    expect(within(screen.getByRole("region", { name: zh.workbench.result })).getByRole("heading", { level: 1 })).toHaveTextContent("First result");
    expect(submit).not.toHaveBeenCalled();
  });

  it("does not steal focus for incoming progress and hands off a latest-result button that disappears", () => {
    layout(); const view = render(<Harness />);
    click(entry("A"));
    const note = screen.getByLabelText("Note a"); note.focus();
    view.rerender(<Harness items={[...messages, { id: "c", role: "assistant", content: "Progress", originalQuery: "Question C", isLoading: true }]} />);
    expect(note).toHaveFocus(); expect(within(screen.getByRole("region", { name: zh.workbench.result })).getByRole("heading", { level: 1 })).toHaveTextContent("First result");
    click(button(zh.workbench.jumpToLatest)); expect(result()).toHaveFocus();
    expect(within(screen.getByRole("region", { name: zh.workbench.result })).getByRole("heading", { level: 1 })).toHaveTextContent("Progress");
    click(button(zh.workbench.previousResult)); expect(button(zh.workbench.previousResult)).toHaveFocus();
    expect(within(screen.getByRole("region", { name: zh.workbench.result })).getByRole("heading", { level: 1 })).toHaveTextContent("First result");
  });

  it("retains desktop navigation and drafts across window changes and honors explicit composer requests once in Strict Mode", () => {
    const viewport = layout(); const view = render(<StrictMode><Harness /></StrictMode>);
    const draft = screen.getByLabelText("Draft");
    expect(screen.getByLabelText("Draft")).not.toHaveFocus();
    const tabs = screen.getByRole("tablist");
    const data = within(tabs).getByRole("tab", { name: zh.workbench.data }); click(data);
    act(() => viewport.set(false));
    expect(data).toHaveFocus();
    expect(draft).not.toBeVisible();
    click(within(tabs).getByRole("tab", { name: zh.workbench.result }));
    expect(within(tabs).getByRole("tab", { name: zh.workbench.result })).toHaveFocus();
    expect(screen.getByLabelText("Draft")).toBe(draft);
    view.rerender(<StrictMode><Harness request={1} /></StrictMode>);
    expect(screen.getByLabelText("Draft")).toHaveFocus();
    expect(screen.getByLabelText("Draft")).toHaveValue("Keep my question");
    act(() => viewport.set(true));
    data.focus(); fireEvent.keyDown(data, { key: "ArrowUp" });
    expect(within(tabs).getByRole("tab", { name: zh.workbench.result })).toHaveFocus();
    view.rerender(<StrictMode><Harness request={1} /></StrictMode>);
    expect(within(tabs).getByRole("tab", { name: zh.workbench.result })).toHaveFocus();
    expect(submit).not.toHaveBeenCalled();
  });
});
