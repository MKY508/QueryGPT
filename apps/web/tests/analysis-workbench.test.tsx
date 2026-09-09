import { useLayoutEffect, useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisWorkbench, analysisEntries, type WorkbenchView } from "@/components/chat/AnalysisWorkbench";
import { InputBar } from "@/components/chat/InputBar";
import type { ChatMessage } from "@/lib/types/chat";
import { mockSemanticDialogs, mockSemanticWidth } from "./semantic-dialog-mock";
import zh from "@/messages/zh.json";

let restoreDialogs: () => void;
beforeEach(() => { restoreDialogs = mockSemanticDialogs(); mockSemanticWidth(true); });
afterEach(() => { cleanup(); restoreDialogs(); vi.restoreAllMocks(); });

const messages: ChatMessage[] = [
  { role: "user", content: "七月利润" },
  { id: "a1", role: "assistant", content: "七月结论", analysisState: "completed", analysisRunId: "run-1" },
  { role: "user", content: "八月利润" },
  { id: "a2", role: "assistant", content: "八月结论", analysisState: "completed", analysisRunId: "run-2" },
];
function Harness({ items = messages }: { items?: ChatMessage[] }) {
  const [view, setView] = useState<WorkbenchView>("result");
  return <NextIntlClientProvider locale="zh" messages={zh}><AnalysisWorkbench messages={items}
    composer={<textarea aria-label="继续提问" />} emptyContent={<p>尚未提问</p>}
    dataContent={view !== "result" ? <p>数据工作区</p> : null}
    renderResult={(message) => <><h1>{message.content}</h1><input aria-label={`备注-${message.id}`} /></>}
    view={view} onViewChange={setView} onNewAnalysis={vi.fn()} onOpenHistory={vi.fn()} /></NextIntlClientProvider>;
}
describe("analysis workbench", () => {
  it("reuses message-derived entries during local search and refreshes them for new messages", () => {
    const readPrompt = vi.fn(() => "七月利润");
    const items: ChatMessage[] = [{ role: "user", get content() { return readPrompt(); } }, ...messages.slice(1)];
    const { rerender } = render(<Harness items={items} />);
    const initialReads = readPrompt.mock.calls.length;
    expect(initialReads).toBeGreaterThan(0);
    const search = screen.getByRole("searchbox", { name: "搜索当前分析…" });
    fireEvent.change(search, { target: { value: "七月" } });
    fireEvent.change(search, { target: { value: "" } });
    rerender(<Harness items={items} />);
    expect(readPrompt).toHaveBeenCalledTimes(initialReads);
    rerender(<Harness items={[...items.slice(0, -1), { ...items.at(-1)!, content: "八月更新结论" }]} />);
    expect(readPrompt.mock.calls.length).toBeGreaterThan(initialReads);
    expect(within(screen.getByRole("region", { name: zh.workbench.result })).getByRole("heading", { level: 1 })).toHaveTextContent("八月更新结论");
  });

  it("waits for an external target and commits its selection before acknowledging it", () => {
    const committed: string[] = [], acknowledge = vi.fn(), changeView = vi.fn();
    function Probe({ value }: { value: string }) {
      useLayoutEffect(() => { committed.push(value); }, [value]);
      return <h1>{value}</h1>;
    }
    const content = (items: ChatMessage[], target = "run-1") => <NextIntlClientProvider locale="zh" messages={zh}><AnalysisWorkbench messages={items}
      composer={null} emptyContent={null} dataContent={null} renderResult={message => <Probe value={message.content} />}
      view="result" onViewChange={changeView} onNewAnalysis={vi.fn()} onOpenHistory={vi.fn()}
      focusAnalysisRunId={target} onReportFocused={acknowledge} /></NextIntlClientProvider>;
    const { rerender } = render(content([]));
    expect(acknowledge).not.toHaveBeenCalled(); expect(committed).toEqual([]);
    rerender(content(messages));
    expect(committed).toEqual(["七月结论"]); expect(acknowledge).toHaveBeenCalledOnce();
    rerender(content(messages.map(message => ({ ...message }))));
    expect(acknowledge).toHaveBeenCalledOnce();
    expect(within(screen.getByRole("region", { name: zh.workbench.result })).getByRole("heading", { level: 1 })).toHaveTextContent("七月结论");
  });
  it("preserves the same composer while switching between results and full-width data", () => {
    const content = (view: WorkbenchView) => <NextIntlClientProvider locale="zh" messages={zh}><AnalysisWorkbench messages={[]}
      composer={<textarea aria-label="草稿" />} emptyContent={<p>尚未提问</p>} dataContent={view !== "result" ? <p>数据内容</p> : null}
      renderResult={() => null} view={view} onViewChange={vi.fn()} onNewAnalysis={vi.fn()} onOpenHistory={vi.fn()} /></NextIntlClientProvider>;
    const { rerender } = render(content("result"));
    const composer = screen.getByRole("textbox", { name: "草稿" });
    fireEvent.change(composer, { target: { value: "继续比较" } });
    rerender(content("sources"));
    expect(screen.getByText("数据内容")).toBeVisible();
    expect(composer).toHaveValue("继续比较");
    expect(composer).not.toBeVisible();
    rerender(content("understanding"));
    rerender(content("result"));
    expect(screen.getByRole("textbox", { name: "草稿" })).toBe(composer);
    expect(composer).toHaveValue("继续比较");
  });
  it("clears local search with focus return without switching the selected result", () => {
    render(<Harness />);
    const search = screen.getByRole("searchbox", { name: "搜索当前分析…" });
    fireEvent.change(search, { target: { value: "七月" } });
    fireEvent.compositionStart(search); fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("七月");
    fireEvent.compositionEnd(search); fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue(""); expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: "无匹配" } });
    fireEvent.click(screen.getByRole("button", { name: "清除搜索", exact: true }));
    expect(search).toHaveValue(""); expect(search).toHaveFocus();
    expect(within(screen.getByRole("region", { name: zh.workbench.result })).getByRole("heading", { level: 1 })).toHaveTextContent("八月结论");
    expect(screen.getByRole("button", { name: /七月利润/ })).toBeInTheDocument();
  });
  it("keeps the original question searchable after a confirmation answer", () => {
    const items: ChatMessage[] = [
      { role: "user", content: "比较门店收入" },
      { role: "assistant", content: "请确认", streamId: "first", analysisRunId: "same-run", originalQuery: "比较门店收入" },
      { role: "user", content: "扣除退款" },
      { role: "assistant", content: "确认后的比较结果", streamId: "second", analysisRunId: "same-run", originalQuery: "比较门店收入" },
    ];
    expect(analysisEntries(items).map(entry => entry.title)).toEqual(["比较门店收入", "比较门店收入"]);
    render(<Harness items={items} />);
    fireEvent.change(screen.getByPlaceholderText("搜索当前分析…"), { target: { value: "门店收入" } });
    expect(screen.getAllByRole("button", { name: /比较门店收入/ })).toHaveLength(2);
    expect(within(screen.getByRole("region", { name: zh.workbench.result })).getByRole("heading", { level: 1 })).toHaveTextContent("确认后的比较结果");
    expect(analysisEntries([{ role: "user", content: "普通新问题" }, { role: "assistant", content: "回答", originalQuery: "  " }])[0].title).toBe("普通新问题");
  });

  it("keeps message keys distinct for same-run attempts and stable as metadata arrives", () => {
    const first: ChatMessage = { role: "assistant", content: "", streamId: "first" };
    const key = analysisEntries([first])[0].key;
    const updated = { ...first, id: "saved-later", analysisRunId: "same-run", content: "Done" };
    expect(analysisEntries([updated])[0].key).toBe(key);
    const entries = analysisEntries([updated, { ...first, streamId: "second", analysisRunId: "same-run" },
      { role: "assistant", content: "older", analysisRunId: "same-run" }, { role: "assistant", content: "newer", analysisRunId: "same-run" }]);
    expect(new Set(entries.map(entry => entry.key)).size).toBe(4);
  });

  it("preserves the result editor when a pending message receives its run identity", () => {
    const pending: ChatMessage = { role: "assistant", content: "进行中", streamId: "pending-stream" };
    const { rerender } = render(<Harness items={[{ role: "user", content: "原问题" }, pending]} />);
    const editor = screen.getByRole("textbox", { name: "备注-undefined" });
    fireEvent.change(editor, { target: { value: "保留这段批注" } });
    rerender(<Harness items={[{ role: "user", content: "原问题" }, { ...pending, analysisRunId: "arrived-run", content: "已有结果" }]} />);
    expect(screen.getByRole("textbox", { name: "备注-undefined" })).toBe(editor);
    expect(editor).toHaveValue("保留这段批注");
  });

  it("opens the latest matching attempt when locating a resumed run", () => {
    const items: ChatMessage[] = [
      { id: "older", role: "assistant", content: "旧的确认问题", analysisRunId: "same-run" },
      { id: "newer", role: "assistant", content: "最新续跑结果", analysisRunId: "same-run" },
      { id: "other", role: "assistant", content: "另一项调查", analysisRunId: "other-run" },
    ];
    render(<NextIntlClientProvider locale="zh" messages={zh}><AnalysisWorkbench messages={items} composer={null} emptyContent={null} dataContent={null}
      renderResult={message => <h1>{message.content}</h1>} view="result" onViewChange={vi.fn()} onNewAnalysis={vi.fn()} onOpenHistory={vi.fn()}
      focusAnalysisRunId="same-run" /></NextIntlClientProvider>);
    expect(within(screen.getByRole("region", { name: zh.workbench.result })).getByRole("heading", { level: 1 })).toHaveTextContent("最新续跑结果");
  });

  it("marks a resolved confirmation as confirmed without claiming the investigation completed", () => {
    const items: ChatMessage[] = messages.map((message) => message.id === "a2" ? { ...message, analysisState: "waiting_confirmation", confirmationResolved: "扣除退款" } : message);
    render(<Harness items={items} />);
    const entry = screen.getByRole("button", { name: /八月利润/ });
    expect(entry).toHaveTextContent("已确认");
    expect(entry).not.toHaveTextContent("待确认");
    expect(entry).not.toHaveTextContent("已完成");
  });
  it("reports the actual canvas selection without notifying an old result during external navigation", () => {
    const visible = vi.fn();
    const content = (focusAnalysisRunId?: string, showEmpty = false) => <NextIntlClientProvider locale="zh" messages={zh}>
      <AnalysisWorkbench messages={messages} composer={<textarea />} emptyContent={<p>Loading</p>} dataContent={null}
        renderResult={(message) => <h1>{message.content}</h1>} view="result" onViewChange={vi.fn()} onNewAnalysis={vi.fn()}
        onOpenHistory={vi.fn()} onVisibleReportChange={visible} focusAnalysisRunId={focusAnalysisRunId} showEmpty={showEmpty} />
    </NextIntlClientProvider>;
    const view = render(content());
    expect(visible).toHaveBeenLastCalledWith("run-2");
    fireEvent.click(screen.getByRole("button", { name: /七月利润/ }));
    expect(visible).toHaveBeenLastCalledWith("run-1");
    fireEvent.click(screen.getByRole("button", { name: "回到最新结果" }));
    expect(visible).toHaveBeenLastCalledWith("run-2");
    visible.mockClear();
    view.rerender(content("not-arrived"));
    expect(visible).not.toHaveBeenCalled();
    view.rerender(content("run-1"));
    expect(visible).toHaveBeenCalledExactlyOnceWith("run-1");
    visible.mockClear();
    view.rerender(content(undefined, true));
    expect(visible).not.toHaveBeenCalled();
  });
  it("keeps local result editor drafts when navigating between visited results", () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("textbox", { name: "备注-a2" }), { target: { value: "还没有保存的修正" } });
    fireEvent.click(screen.getByRole("button", { name: /七月利润/ }));
    fireEvent.click(screen.getByRole("button", { name: /八月利润/ }));
    expect(screen.getByRole("textbox", { name: "备注-a2" })).toHaveValue("还没有保存的修正");
  });
  it("pairs each result with its own question, supports search without losing the selected result", () => {
    expect(analysisEntries(messages).map((entry) => entry.title)).toEqual(["七月利润", "八月利润"]);
    render(<Harness />);
    expect(within(screen.getByRole("region", { name: zh.workbench.result })).getByRole("heading", { level: 1 })).toHaveTextContent("八月结论");
    fireEvent.click(screen.getByRole("button", { name: /七月利润/ }));
    expect(within(screen.getByRole("region", { name: zh.workbench.result })).getByRole("heading", { level: 1 })).toHaveTextContent("七月结论");
    fireEvent.change(screen.getByPlaceholderText("搜索当前分析…"), { target: { value: "八月" } });
    expect(screen.queryByRole("button", { name: /七月利润/ })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: zh.workbench.result })).getByRole("heading", { level: 1 })).toHaveTextContent("七月结论");
    fireEvent.click(screen.getByRole("button", { name: "回到最新结果" }));
    expect(within(screen.getByRole("region", { name: zh.workbench.result })).getByRole("heading", { level: 1 })).toHaveTextContent("八月结论");
  });
  it("keeps an older result selected as new progress arrives", () => {
    const { rerender } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /七月利润/ }));
    rerender(<Harness items={[...messages, { role: "user", content: "九月" }, { id: "a3", role: "assistant", content: "新进展", isLoading: true }]} />);
    expect(within(screen.getByRole("region", { name: zh.workbench.result })).getByRole("heading", { level: 1 })).toHaveTextContent("七月结论");
    fireEvent.click(screen.getByRole("button", { name: "查看最新进展" }));
    expect(within(screen.getByRole("region", { name: zh.workbench.result })).getByRole("heading", { level: 1 })).toHaveTextContent("新进展");
  });
  it("navigates vertical sections and collapses navigation without remounting the composer", () => {
    render(<Harness />);
    const composer = screen.getByRole("textbox", { name: "继续提问" });
    fireEvent.change(composer, { target: { value: "保留草稿" } });
    const tabs = screen.getByRole("tablist");
    expect(tabs).toHaveAttribute("aria-orientation", "vertical");
    fireEvent.keyDown(within(tabs).getByRole("tab", {name: "分析结果"}), {key: "ArrowDown", isComposing: true, keyCode: 229});
    expect(within(tabs).getByRole("tab", {name: "分析结果"})).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(within(tabs).getByRole("tab", { name: "分析结果" }), { key: "ArrowDown" });
    expect(within(tabs).getByRole("tab", { name: "数据" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("数据工作区")).toBeInTheDocument();
    fireEvent.click(within(tabs).getByRole("tab", { name: "分析结果" }));
    const canvas = screen.getByRole("region", { name: zh.workbench.canvas });
    fireEvent.click(within(canvas).getByRole("button", { name: zh.workbench.closeNavigation }));
    expect(screen.queryByRole("dialog", { name: zh.workbench.navigation })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "继续提问" })).toBe(composer);
    fireEvent.click(within(canvas).getByRole("button", { name: zh.workbench.openNavigation }));
    expect(screen.getByRole("complementary", { name: zh.workbench.navigation })).toBeInTheDocument();
    expect(composer).toHaveValue("保留草稿");
  });
  it("does not submit while the Chinese IME is committing text", () => {
    const submit = vi.fn().mockResolvedValue(true);
    render(<NextIntlClientProvider locale="zh" messages={zh}><InputBar input="八月利润" onInputChange={vi.fn()}
      onSubmit={submit} onStop={vi.fn()} onOpenData={vi.fn()} onUploadFile={vi.fn()} isLoading={false} isUploading={false} dataReady sourceCount={1} /></NextIntlClientProvider>);
    const input = screen.getByTestId("chat-input");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter", isComposing: false, keyCode: 13 });
    expect(submit).toHaveBeenCalledWith("八月利润");
  });
});
