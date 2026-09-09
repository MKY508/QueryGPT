import { StrictMode, useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { AnalysisWorkbench } from "@/components/chat/AnalysisWorkbench";
import type { WorkbenchView } from "@/lib/workbench-pane";
import { EMPTY_RESULT_NAVIGATION, resultNavigationTarget, visitResult } from "@/lib/result-navigation";
import type { ChatMessage } from "@/lib/types/chat";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

const messages: ChatMessage[] = [
  { id: "a", role: "assistant", content: "First", originalQuery: "Question A", analysisRunId: "run-a" },
  { id: "b", role: "assistant", content: "Second", originalQuery: "Question B", analysisRunId: "run-b" },
  { id: "c", role: "assistant", content: "Third", originalQuery: "Question C", analysisRunId: "run-c" },
];
const submit = vi.fn(), history = vi.fn(), visible = vi.fn(), focused = vi.fn();
function Harness({ items = messages, scope = "conversation-one", focus, loading = false, english = false }: {
  items?: ChatMessage[]; scope?: string; focus?: string; loading?: boolean; english?: boolean;
}) {
  const [view, setView] = useState<WorkbenchView>("result");
  return <NextIntlClientProvider locale={english ? "en" : "zh"} messages={english ? en : zh}>
    <AnalysisWorkbench key={scope} messages={items} view={view} onViewChange={setView} onNewAnalysis={submit} onOpenHistory={history}
      composer={<textarea aria-label="question draft" />} emptyContent={<p>Loading</p>} dataContent={view !== "result" ? <p>Sources</p> : null}
      focusAnalysisRunId={focus} showEmpty={loading} onVisibleReportChange={visible} onReportFocused={focused}
      renderResult={(message) => <><h1>{message.content}</h1><input aria-label={`note-${message.id}`} /></>} />
  </NextIntlClientProvider>;
}
const button = (name: string) => screen.getByRole("button", { name });
const back = () => button("上一个查看的结果"), forward = () => button("下一个查看的结果");
const choose = (letter: string) => fireEvent.click(screen.getByRole("button", { name: new RegExp(`Question ${letter}`) }));
const title = (value: string) => {
  const canvas = screen.queryByRole("region", {name: zh.workbench.result}) || screen.getByRole("region", {name: en.workbench.result});
  expect(within(canvas).getByRole("heading", {level: 1})).toHaveTextContent(value);
};
const observers: { notify: () => void; disconnect: ReturnType<typeof vi.fn> }[] = [];
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); observers.length = 0; });

function scrolling() {
  let height = 400, contentHeight = 2400;
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function(this: HTMLElement) {
    return this.classList.contains("workbench-result") && !this.hidden ? height : 0;
  });
  const scrollTo = vi.fn(function(this: HTMLElement, options: ScrollToOptions) {
    this.scrollTop = Math.max(0, Math.min(options.top || 0, contentHeight - height));
    this.scrollLeft = options.left || 0;
  });
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
  vi.stubGlobal("ResizeObserver", class {
    entry: typeof observers[number];
    constructor(callback: ResizeObserverCallback) {
      this.entry = { notify: () => callback([], this as unknown as ResizeObserver), disconnect: vi.fn() };
      observers.push(this.entry);
    }
    observe() {}
    disconnect() { this.entry.disconnect(); }
  });
  return { scrollTo, size: (nextHeight: number, nextContent = contentHeight) => { height = nextHeight; contentHeight = nextContent; },
    notify: () => act(() => observers.at(-1)!.notify()),
    restore: () => { if (original) Object.defineProperty(HTMLElement.prototype, "scrollTo", original); else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo"); } };
}

describe("result reading navigation", () => {
  it("bounds the trail, branches after backtracking and skips missing or consecutive equal destinations", () => {
    let trail = EMPTY_RESULT_NAVIGATION;
    for (const key of ["a", "b", "c"]) trail = visitResult(trail, key);
    expect(visitResult(trail, "c")).toBe(trail);
    expect(resultNavigationTarget(trail, -1, new Set(["a", "c"]))).toBe(0);
    expect(resultNavigationTarget(trail, 1, new Set(["a", "b", "c"]))).toBeNull();
    const branch = visitResult({ ...trail, index: 0 }, "d");
    expect(branch.keys).toEqual(["a", "d"]);
    expect(trail.keys).toEqual(["a", "b", "c"]);
    expect(resultNavigationTarget({ keys: ["a", "missing", "a", "b"], index: 0 }, 1, new Set(["a", "b"]))).toBe(3);
    for (let i = 0; i < 100; i++) trail = visitResult(trail, `result-${i}`);
    expect(trail.keys).toHaveLength(50);
    expect(trail.index).toBe(49);
    expect(trail.keys[0]).toBe("result-50");
  });

  it("navigates the actual visit order through a search, retains drafts and cuts a forward branch only on a new visit", () => {
    render(<Harness />);
    expect(back()).toHaveAttribute("aria-disabled", "true");
    choose("A");
    fireEvent.change(screen.getByLabelText("note-a"), { target: { value: "unsaved" } });
    choose("B");
    fireEvent.change(screen.getByPlaceholderText("搜索当前分析…"), { target: { value: "Question C" } });
    back().focus(); fireEvent.click(back()); title("First");
    expect(back()).toHaveFocus();
    expect(screen.getByLabelText("note-a")).toHaveValue("unsaved");
    fireEvent.click(back()); title("Third");
    expect(back()).toHaveFocus(); expect(back()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(back()); title("Third");
    fireEvent.click(forward()); title("First");
    fireEvent.click(forward()); title("Second");
    expect(forward()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(back()); title("First");
    choose("C"); title("Third");
    expect(forward()).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByPlaceholderText("搜索当前分析…")).toHaveValue("Question C");
    fireEvent.click(back()); title("First");
    expect(visible).toHaveBeenLastCalledWith("run-a");
    expect(submit).not.toHaveBeenCalled(); expect(history).not.toHaveBeenCalled();
  });

  it("pins revisited latest results during streaming and waits for external targets instead of recording a loading placeholder", () => {
    const view = render(<Harness />);
    choose("A"); fireEvent.click(back()); title("Third");
    const fourth: ChatMessage = { id: "d", role: "assistant", content: "Progress", originalQuery: "Question D", analysisRunId: "run-d", isLoading: true };
    view.rerender(<Harness items={[...messages, fourth]} />); title("Third");
    fireEvent.click(button("专注阅读"));
    fireEvent.click(button("最新结果")); title("Progress");
    expect(button("退出专注阅读")).toHaveAttribute("aria-pressed", "true");
    view.rerender(<Harness items={[...messages, { ...fourth, content: "Complete", isLoading: false }]} />); title("Complete");
    fireEvent.click(back()); title("Third");
    fireEvent.click(forward()); title("Complete");
    visible.mockClear();
    view.rerender(<Harness items={[...messages, fourth]} focus="not-arrived" loading />);
    expect(screen.queryByRole("navigation", { name: "结果浏览" })).not.toBeInTheDocument();
    expect(visible).not.toHaveBeenCalled();
    view.rerender(<Harness items={[...messages, fourth]} focus="run-b" />); title("Second");
    expect(visible).toHaveBeenLastCalledWith("run-b");
    view.rerender(<Harness items={[...messages, fourth]} />);
    fireEvent.click(back()); title("Progress");
    fireEvent.click(forward()); title("Second");
    // Removing a visited result cannot make its old identity an action target.
    view.rerender(<Harness items={messages} />);
    fireEvent.click(back()); title("Third");
    choose("C"); // Explicitly resume following before leaving the result tab.
    fireEvent.click(screen.getByRole("tab", { name: "数据" }));
    view.rerender(<Harness items={[...messages, fourth]} />);
    const fifth: ChatMessage = { id: "e", role: "assistant", content: "Fifth", analysisRunId: "run-e" };
    view.rerender(<Harness items={[...messages, fourth, fifth]} />);
    fireEvent.click(screen.getByRole("tab", { name: "分析结果" })); title("Fifth");
    fireEvent.click(back()); title("Third"); // Hidden intermediate progress was not a reading visit.
    expect(submit).not.toHaveBeenCalled();
  });

  it("restores independent scroll positions through hidden tabs and late chart layout without overriding new reader input", () => {
    const mock = scrolling();
    try {
      render(<Harness />);
      const canvas = screen.getByRole("heading", { name: "Third" }).closest<HTMLDivElement>(".workbench-result")!;
      fireEvent.scroll(canvas, { target: { scrollTop: 850, scrollLeft: 12 } });
      choose("A"); expect(canvas.scrollTop).toBe(0);
      fireEvent.scroll(canvas, { target: { scrollTop: 300, scrollLeft: 3 } });
      fireEvent.click(back()); expect(canvas.scrollTop).toBe(850); expect(canvas.scrollLeft).toBe(12);
      fireEvent.click(forward()); expect(canvas.scrollTop).toBe(300);
      fireEvent.click(screen.getByRole("tab", { name: "数据" }));
      fireEvent.scroll(canvas, { target: { scrollTop: 0 } });
      fireEvent.click(screen.getByRole("tab", { name: "分析结果" })); expect(canvas.scrollTop).toBe(300);
      // Mobile/CSS hiding is observed independently of the selected result key.
      mock.size(0); mock.notify(); fireEvent.scroll(canvas, { target: { scrollTop: 0 } });
      mock.size(400); mock.notify(); expect(canvas.scrollTop).toBe(300);
      mock.size(400, 500);
      fireEvent.click(back()); expect(canvas.scrollTop).toBe(100);
      fireEvent.scroll(canvas); // A temporary layout clamp must not erase 850.
      mock.size(400, 2400); mock.notify(); expect(canvas.scrollTop).toBe(850);
      fireEvent.click(forward());
      mock.size(400, 500); fireEvent.click(back()); expect(canvas.scrollTop).toBe(100);
      fireEvent.wheel(canvas);
      fireEvent.scroll(canvas, { target: { scrollTop: 40 } });
      mock.size(400, 2400); mock.notify(); expect(canvas.scrollTop).toBe(40);
      fireEvent.click(forward()); fireEvent.click(back()); expect(canvas.scrollTop).toBe(40);
    } finally { mock.restore(); }
  });

  it("resets navigation and reading positions with the owning conversation and disconnects obsolete observers in Strict Mode", () => {
    const mock = scrolling();
    try {
      const view = render(<StrictMode><Harness english /></StrictMode>);
      expect(observers[0].disconnect).toHaveBeenCalledOnce();
      const canvas = screen.getByRole("heading", { name: "Third" }).closest<HTMLDivElement>(".workbench-result")!;
      fireEvent.scroll(canvas, { target: { scrollTop: 800 } });
      choose("A");
      const obsolete = observers.at(-1)!;
      view.rerender(<StrictMode><Harness english scope="conversation-two" /></StrictMode>);
      expect(obsolete.disconnect).toHaveBeenCalledOnce();
      title("Third");
      const newCanvas = screen.getByRole("heading", { name: "Third" }).closest<HTMLDivElement>(".workbench-result")!;
      expect(newCanvas.scrollTop).toBe(0);
      const nav = screen.getByRole("navigation", { name: "Result navigation" });
      expect(within(nav).getByRole("button", { name: "Previously viewed result" })).toHaveAttribute("aria-disabled", "true");
      const count = mock.scrollTo.mock.calls.length;
      act(() => obsolete.notify()); expect(mock.scrollTo).toHaveBeenCalledTimes(count);
      const latest = observers.at(-1)!;
      view.unmount(); expect(latest.disconnect).toHaveBeenCalledOnce();
      act(() => latest.notify()); expect(mock.scrollTo).toHaveBeenCalledTimes(count);
    } finally { mock.restore(); }
  });
});
