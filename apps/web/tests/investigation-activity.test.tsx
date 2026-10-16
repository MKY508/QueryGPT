import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appendAnalysisActivity, analysisStageDetailKey, MAX_ANALYSIS_ACTIVITY, type AnalysisActivityStep } from "@/lib/analysis-activity";
import { applyStreamEvent, buildPendingAssistantMessage } from "@/lib/stores/chat-helpers";
import { InvestigationActivity } from "@/components/chat/InvestigationActivity";
import { AnalysisWorkbench } from "@/components/chat/AnalysisWorkbench";
import type { WorkbenchView } from "@/lib/workbench-pane";
import type { ChatMessage } from "@/lib/types/chat";
import zh from "@/messages/zh.json";
import en from "@/messages/en.json";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("investigation activity", () => {
  it("records bounded observed stages, merges consecutive equivalents, and rejects unknown or terminal claims", () => {
    let activity: AnalysisActivityStep[] | undefined;
    for (const stage of ["read_files", "READ_FILES", "__proto__", "constructor", "unknown secret step", "completed", "waiting_confirmation", "needs_attention"]) {
      activity = appendAnalysisActivity(activity, stage);
    }
    expect(activity).toEqual(["readingFilesDesc"]);
    expect(analysisStageDetailKey("constructor")).toBeUndefined();
    for (let index = 0; index < 30; index++) activity = appendAnalysisActivity(activity, index % 2 ? "executing" : "read_database");
    expect(activity).toHaveLength(MAX_ANALYSIS_ACTIVITY);
    const same = appendAnalysisActivity(activity, "generating_sql");
    expect(same).toBe(activity);
    expect(JSON.stringify(activity)).not.toMatch(/secret|sql|constructor/);
  });

  it("keeps each stream's activity separate and never records free-form progress or thinking content", () => {
    let messages = [buildPendingAssistantMessage(undefined, "old"), buildPendingAssistantMessage(undefined, "new")];
    messages = applyStreamEvent(messages, { type: "progress", data: { message: "private SQL model text", step: "read_files" } }, "old");
    messages = applyStreamEvent(messages, { type: "progress", data: { message: "another private message", step: "validate_results" } }, "new");
    messages = applyStreamEvent(messages, { type: "thinking", data: { stage: "private chain of thought" } }, "new");
    expect(messages[0].activitySteps).toEqual(["readingFilesDesc"]);
    expect(messages[1].activitySteps).toEqual(["finalValidationDesc"]);
    expect(buildPendingAssistantMessage(undefined, "fresh").activitySteps).toBeUndefined();
    expect(JSON.stringify(messages.map(message => message.activitySteps))).not.toContain("private");
  });

  it("shows the full question and localized activity, preserves expansion and does not claim success before settlement", () => {
    const pending: ChatMessage = { role: "assistant", content: "", isLoading: true, analysisState: "investigating", thinkingStage: "read_files",
      status: "SQL / internal / private", activitySteps: ["preparingMaterialsDesc", "readingFilesDesc"] };
    const content = (message: ChatMessage, stopping = false, locale: "zh" | "en" = "zh") => <NextIntlClientProvider locale={locale} messages={locale === "zh" ? zh : en}>
      <InvestigationActivity message={message} query={'比较门店收入\n保留问题全文 <script>not executed</script>'} stopping={stopping} />
    </NextIntlClientProvider>;
    const view = render(content(pending));
    expect(screen.getByRole("heading", { name: /比较门店收入/ })).toHaveTextContent("<script>not executed</script>");
    expect(screen.getByTestId("investigation-activity")).not.toHaveTextContent(/private|SQL|100%/);
    const disclosure = screen.getByText("最近 2 条动态").closest("details")!;
    fireEvent.click(screen.getByText("最近 2 条动态")); expect(disclosure.open).toBe(true);
    view.rerender(content({ ...pending, activitySteps: [...pending.activitySteps!, "finalValidationDesc"], analysisState: "completed" }));
    expect(disclosure.open).toBe(true);
    expect(screen.getByRole("region", { name: "当前调查进度" })).toHaveTextContent("正在整理结果");
    expect(screen.getByTestId("investigation-activity")).not.toHaveTextContent("调查已完成");
    for (const signal of [{ thinkingStage: "complete_report", status: undefined }, { thinkingStage: undefined, status: "调查完成，正在整理报告" }]) {
      view.rerender(content({ ...pending, ...signal }));
      expect(screen.getByRole("region", { name: "当前调查进度" })).toHaveTextContent("正在核对发现");
      expect(screen.getByRole("region", { name: "当前调查进度" })).not.toHaveTextContent("正在整理结果");
      expect(screen.getByRole("region", { name: "当前调查进度" })).not.toHaveTextContent("已经保存");
    }
    view.rerender(content(pending, true)); expect(screen.getByRole("region", { name: "当前调查进度" })).toHaveTextContent("正在停止调查");
    view.rerender(content(pending, false, "en")); expect(screen.getByTestId("investigation-activity")).toHaveTextContent("Reading the relevant file data");
    expect(screen.getByRole("list", { name: "Investigation activity" })).not.toHaveTextContent("正在读取");
  });

  it("keeps run controls available while reading other results and tabs, and only controls the active stream", () => {
    const stop = vi.fn();
    const items: ChatMessage[] = [{ role: "user", content: "七月" }, { role: "assistant", id: "old", content: "旧结论", analysisState: "completed" },
      { role: "user", content: "八月" }, { role: "assistant", id: "active", streamId: "stream-a", content: "当前进展", isLoading: true }];
    function Harness({ stopping = false, stream = "stream-a", messages = items }: { stopping?: boolean; stream?: string; messages?: ChatMessage[] }) {
      const [view, setView] = useState<WorkbenchView>("result");
      return <NextIntlClientProvider locale="zh" messages={zh}><AnalysisWorkbench messages={messages} composer={<textarea defaultValue="下一条问题" />}
        emptyContent={null} dataContent={null} renderResult={message => <h1>{message.content}</h1>} view={view} onViewChange={setView}
        onNewAnalysis={vi.fn()} onOpenHistory={vi.fn()} activeStreamId={stream} stopping={stopping} onStopStream={stop} /></NextIntlClientProvider>;
    }
    const view = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /七月/ }));
    const controls = screen.getByTestId("active-investigation-controls");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("旧结论");
    fireEvent.click(within(controls).getByRole("button", { name: "查看进度" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("当前进展");
    fireEvent.click(screen.getByRole("tab", { name: "数据" }));
    fireEvent.click(within(controls).getByRole("button", { name: "停止调查" })); expect(stop).toHaveBeenCalledExactlyOnceWith("stream-a");
    view.rerender(<Harness stopping />);
    expect(within(controls).getByRole("button", { name: "停止调查" })).toBeDisabled();
    expect(controls).toHaveTextContent("正在停止");
    view.rerender(<Harness stream="other-stream" />); expect(screen.queryByTestId("active-investigation-controls")).not.toBeInTheDocument();
    view.rerender(<Harness />); const button = screen.getByRole("button", { name: "停止调查" }); button.focus();
    view.rerender(<Harness messages={items.map(message => ({ ...message, isLoading: false }))} />);
    expect(screen.queryByTestId("active-investigation-controls")).not.toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveFocus(); expect(screen.getByDisplayValue("下一条问题")).toHaveValue("下一条问题");
  });
});
