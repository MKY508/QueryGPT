import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { InputBar } from "@/components/chat/InputBar";
import { AnalysisProgress } from "@/components/chat/AnalysisProgress";
import {
  getProductAnalysisStateLabel,
  MessageList,
} from "@/components/chat/MessageList";
import enMessages from "@/messages/en.json";
import messages from "@/messages/zh.json";
import type {
  AnalysisRunSummary,
  ProjectDataSource,
  StandingAnalysis,
} from "@/lib/types/api";

const emptyWorkspaceProps = {
  standingAnalyses: [] as StandingAnalysis[],
  recentRuns: [] as AnalysisRunSummary[],
  emptyComposer: <div>任务输入</div>,
  activityLoading: false,
  onOpenReport: vi.fn(),
  onCheckStanding: vi.fn(),
};

describe("task-first workspace", () => {
  it("accepts the task before model or data setup", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <InputBar
          onSubmit={onSubmit}
          onStop={vi.fn()}
          onOpenData={vi.fn()}
          onUploadFile={vi.fn()}
          isLoading={false}
          isUploading={false}
          projectName="七月经营复盘"
          dataReady={false}
          sourceCount={0}
          input="分析商品销量与线上渠道表现"
          onInputChange={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByTestId("chat-submit")).not.toBeDisabled();
    expect(screen.getByTestId("chat-input")).toHaveAttribute(
      "placeholder",
      "输入问题或分析任务"
    );
    expect(screen.queryByText(/结果留在/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("chat-submit"));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith("分析商品销量与线上渠道表现")
    );
  });

  it("keeps the typed task when service selection is still required", async () => {
    const onInputChange = vi.fn();
    const onSubmit = vi.fn().mockResolvedValue(false);

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <InputBar
          onSubmit={onSubmit}
          onStop={vi.fn()}
          onOpenData={vi.fn()}
          onUploadFile={vi.fn()}
          isLoading={false}
          isUploading={false}
          dataReady={false}
          sourceCount={0}
          input="检查本月收入"
          onInputChange={onInputChange}
        />
      </NextIntlClientProvider>
    );

    fireEvent.click(screen.getByTestId("chat-submit"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("检查本月收入"));
    expect(onInputChange).not.toHaveBeenCalledWith("");
    expect(screen.getByTestId("chat-input")).toHaveValue("检查本月收入");
  });

  it("lets a new investigation choose an analysis service from the composer", () => {
    const onSelectAnalysisService = vi.fn();
    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <InputBar
          onSubmit={vi.fn().mockResolvedValue(undefined)}
          onStop={vi.fn()}
          onOpenData={vi.fn()}
          onUploadFile={vi.fn()}
          isLoading={false}
          isUploading={false}
          dataReady={false}
          sourceCount={0}
          input=""
          onInputChange={vi.fn()}
          analysisServices={[
            {
              id: "service-1",
              name: "经营分析",
              provider: "custom",
              model_id: "hidden-model-name",
              is_default: true,
              credential_state: "readable",
              health_status: "healthy",
            },
          ]}
          selectedAnalysisServiceId="service-1"
          onSelectAnalysisService={onSelectAnalysisService}
          onManageAnalysisServices={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    const selector = screen.getByTestId("analysis-service-selector");
    expect(selector).toHaveTextContent("分析服务");
    expect(selector).toHaveTextContent("经营分析");
    expect(screen.queryByText("hidden-model-name")).not.toBeInTheDocument();
  });

  it("keeps an unconfigured task inside the report instead of showing onboarding", () => {
    const onOpenSettings = vi.fn();

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <MessageList
          messages={[]}
          isLoading={false}
          sources={[]}
          {...emptyWorkspaceProps}
          modelReady={false}
          pendingTask="分析商品销量与线上渠道表现"
          onRetry={vi.fn()}
          onRerun={vi.fn()}
          onOpenSettings={onOpenSettings}
          onOpenData={vi.fn()}
          onUsePrompt={vi.fn()}
          onConfirm={vi.fn().mockResolvedValue(undefined)}
          onContinuePending={vi.fn()}
          onEditPending={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByTestId("pending-task-report")).toHaveTextContent(
      "分析商品销量与线上渠道表现"
    );
    expect(screen.queryByText("配置模型")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "选择分析能力" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("keeps the empty work surface free of placeholder data and standing-analysis strips", () => {
    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <MessageList
          messages={[]}
          isLoading={false}
          sources={[]}
          {...emptyWorkspaceProps}
          modelReady={true}
          onRetry={vi.fn()}
          onRerun={vi.fn()}
          onOpenSettings={vi.fn()}
          onOpenData={vi.fn()}
          onUsePrompt={vi.fn()}
          onConfirm={vi.fn().mockResolvedValue(undefined)}
          onContinuePending={vi.fn()}
          onEditPending={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    expect(screen.queryByText("需要时再添加数据")).not.toBeInTheDocument();
    expect(screen.queryByText("需要时再拖入文件或连接数据库")).not.toBeInTheDocument();
    expect(
      screen.queryByText("完成一份报告后，可以让它在数据变化时自动核对。")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("数据与理解")).not.toBeInTheDocument();
    expect(screen.queryByText("持续关注")).not.toBeInTheDocument();
  });

  it("shows the factual source count and data block when a source exists", () => {
    const source = {
      id: "source-1",
      project_id: "project-1",
      kind: "file",
      name: "orders.csv",
      format: "csv",
      status: "ready",
      profile_data: { is_current: true },
      created_at: "2026-07-18T00:00:00Z",
      updated_at: "2026-07-18T00:00:00Z",
    } satisfies ProjectDataSource;

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <MessageList
          messages={[]}
          isLoading={false}
          sources={[source]}
          {...emptyWorkspaceProps}
          modelReady={true}
          onRetry={vi.fn()}
          onRerun={vi.fn()}
          onOpenSettings={vi.fn()}
          onOpenData={vi.fn()}
          onUsePrompt={vi.fn()}
          onConfirm={vi.fn().mockResolvedValue(undefined)}
          onContinuePending={vi.fn()}
          onEditPending={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByRole("button", { name: "1 项数据可用" })).toBeInTheDocument();
    expect(screen.getByText("数据")).toBeInTheDocument();
    expect(screen.getByText("orders.csv")).toBeInTheDocument();
    expect(screen.queryByText("持续关注")).not.toBeInTheDocument();
  });

  it("only generates analysis suggestions after an explicit click", () => {
    const onGenerateSuggestions = vi.fn();
    const source = {
      id: "source-suggestions",
      project_id: "project-1",
      kind: "file",
      name: "orders.csv",
      format: "csv",
      status: "ready",
      profile_data: { is_current: true },
      created_at: "2026-07-22T00:00:00Z",
      updated_at: "2026-07-22T00:00:00Z",
    } satisfies ProjectDataSource;

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <MessageList
          messages={[]}
          isLoading={false}
          sources={[source]}
          {...emptyWorkspaceProps}
          modelReady
          selfAnalysisEnabled
          canGenerateSuggestions
          onGenerateSuggestions={onGenerateSuggestions}
          onRetry={vi.fn()}
          onRerun={vi.fn()}
          onOpenSettings={vi.fn()}
          onOpenData={vi.fn()}
          onUsePrompt={vi.fn()}
          onConfirm={vi.fn().mockResolvedValue(undefined)}
          onContinuePending={vi.fn()}
          onEditPending={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    expect(onGenerateSuggestions).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "生成分析建议" }));
    expect(onGenerateSuggestions).toHaveBeenCalledOnce();
  });

  it("does not expose suggestion generation while self analysis is disabled", () => {
    const onGenerateSuggestions = vi.fn();
    const source = {
      id: "source-suggestions-off",
      project_id: "project-1",
      kind: "file",
      name: "orders.csv",
      format: "csv",
      status: "ready",
      profile_data: { is_current: true },
      created_at: "2026-07-22T00:00:00Z",
      updated_at: "2026-07-22T00:00:00Z",
    } satisfies ProjectDataSource;

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <MessageList
          messages={[]}
          isLoading={false}
          sources={[source]}
          {...emptyWorkspaceProps}
          modelReady
          selfAnalysisEnabled={false}
          canGenerateSuggestions
          onGenerateSuggestions={onGenerateSuggestions}
          onRetry={vi.fn()}
          onRerun={vi.fn()}
          onOpenSettings={vi.fn()}
          onOpenData={vi.fn()}
          onUsePrompt={vi.fn()}
          onConfirm={vi.fn().mockResolvedValue(undefined)}
          onContinuePending={vi.fn()}
          onEditPending={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    expect(screen.queryByRole("button", { name: "生成分析建议" })).not.toBeInTheDocument();
    expect(screen.queryByText("分析建议已关闭。")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "设置" })).not.toBeInTheDocument();
    expect(onGenerateSuggestions).not.toHaveBeenCalled();
  });

  it("only exposes the five product states", () => {
    const t = (key: string) => key;
    expect(getProductAnalysisStateLabel("understanding", t)).toBe("stateUnderstanding");
    expect(getProductAnalysisStateLabel("waiting_confirmation", t)).toBe("statePending");
    expect(getProductAnalysisStateLabel("investigating", t)).toBe("stateInvestigating");
    expect(getProductAnalysisStateLabel("completed", t)).toBe("stateCompleted");
    expect(getProductAnalysisStateLabel("needs_attention", t)).toBe("stateNeedsAttention");
    expect(getProductAnalysisStateLabel("raw_backend_stage", t)).toBe("stateUnderstanding");
  });

  it("shows only the current plain-language investigation state", () => {
    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <AnalysisProgress
          state="investigating"
          stage="running Python tool against SQL schema"
        />
      </NextIntlClientProvider>
    );

    const progress = screen.getByRole("region", { name: "当前调查进度" });
    expect(progress).toHaveTextContent("正在核对发现");
    expect(progress).toHaveTextContent("比较数据、验证关系和异常");
    expect(progress).not.toHaveTextContent("已收到调查任务");
    expect(progress).not.toHaveTextContent("形成可回看的报告");
    expect(progress).not.toHaveTextContent("Python");
    expect(progress).not.toHaveTextContent("SQL");
    const liveStatus = progress.querySelector('[aria-live="polite"]');
    expect(liveStatus).toHaveAttribute("aria-atomic", "true");
    expect(liveStatus).toHaveAttribute("data-progress-state", "investigating");
  });

  it("uses a stable progress step instead of a fixed Chinese server message in English", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AnalysisProgress
          state="investigating"
          stage="read_files"
        />
      </NextIntlClientProvider>
    );

    const progress = screen.getByRole("region", {
      name: "Current investigation progress",
    });
    expect(progress).toHaveTextContent("Reading the relevant file data");
    expect(progress).not.toHaveTextContent("正在读取服务端固定进度");
  });

  it("uses only registered work steps in either language", () => {
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AnalysisProgress
          state="investigating"
          stage="Reading the July customer ledger"
        />
      </NextIntlClientProvider>
    );

    expect(
      screen.getByRole("region", { name: "Current investigation progress" })
    ).not.toHaveTextContent("Reading the July customer ledger");

    rerender(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <AnalysisProgress
          state="investigating"
          stage="Reading the July customer ledger"
        />
      </NextIntlClientProvider>
    );
    const chineseProgress = screen.getByRole("region", { name: "当前调查进度" });
    expect(chineseProgress).toHaveTextContent("比较数据、验证关系和异常");
    expect(chineseProgress).not.toHaveTextContent("Reading the July customer ledger");
  });

  it.each([
    ["understanding", "正在理解数据"],
    ["waiting_confirmation", "等待你的确认"],
    ["investigating", "正在核对发现"],
    ["completed", "调查已完成"],
    ["needs_attention", "这份调查需要处理"],
  ] as const)("renders the %s product state", (state, label) => {
    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <AnalysisProgress state={state} />
      </NextIntlClientProvider>
    );
    const progress = screen.getByRole("region", { name: "当前调查进度" });
    expect(progress).toHaveTextContent(label);
    expect(progress.querySelector('[aria-live="polite"]')).toHaveAttribute(
      "data-progress-state",
      state
    );
  });

  it("keeps every turn in one investigation timeline", () => {
    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <MessageList
          messages={[
            { role: "user", content: "旧任务" },
            { role: "assistant", content: "", isLoading: true },
            { role: "user", content: "当前任务" },
            { role: "assistant", content: "", isLoading: true },
          ]}
          isLoading={true}
          sources={[]}
          {...emptyWorkspaceProps}
          modelReady={true}
          onRetry={vi.fn()}
          onRerun={vi.fn()}
          onOpenSettings={vi.fn()}
          onOpenData={vi.fn()}
          onUsePrompt={vi.fn()}
          onConfirm={vi.fn().mockResolvedValue(undefined)}
          onContinuePending={vi.fn()}
          onEditPending={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByRole("region", { name: "调查时间线" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /查看之前的/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "回到当前报告" })).not.toBeInTheDocument();
  });

  it("does not take the timeline from a reader and announces later progress", async () => {
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const userMessage = { role: "user" as const, content: "检查收入变化" };
    const assistantMessage = {
      role: "assistant" as const,
      content: "",
      isLoading: true,
      analysisState: "investigating" as const,
    };
    const commonProps = {
      isLoading: true,
      sources: [],
      ...emptyWorkspaceProps,
      modelReady: true,
      onRetry: vi.fn(),
      onRerun: vi.fn(),
      onOpenSettings: vi.fn(),
      onOpenData: vi.fn(),
      onUsePrompt: vi.fn(),
      onConfirm: vi.fn().mockResolvedValue(undefined),
      onContinuePending: vi.fn(),
      onEditPending: vi.fn(),
    };

    try {
      const { rerender } = render(
        <NextIntlClientProvider locale="zh" messages={messages}>
          <MessageList messages={[userMessage, assistantMessage]} {...commonProps} />
        </NextIntlClientProvider>
      );
      const timeline = screen.getByRole("region", { name: "调查时间线" });
      Object.defineProperties(timeline, {
        clientHeight: { configurable: true, value: 400 },
        scrollHeight: { configurable: true, value: 1_000 },
        scrollTop: { configurable: true, value: 100, writable: true },
      });

      fireEvent.scroll(timeline);
      expect(screen.getByRole("button", { name: "回到最新位置" })).toBeInTheDocument();

      rerender(
        <NextIntlClientProvider locale="zh" messages={messages}>
          <MessageList
            messages={[
              userMessage,
              { ...assistantMessage, analysisState: "completed", content: "调查完成" },
            ]}
            {...commonProps}
          />
        </NextIntlClientProvider>
      );

      const latestButton = await screen.findByRole("button", {
        name: "有新进展，回到最新位置",
      });
      expect(timeline.scrollTop).toBe(100);

      fireEvent.click(latestButton);
      expect(timeline.scrollTop).toBe(1_000);
      expect(screen.queryByRole("button", { name: /回到最新/ })).not.toBeInTheDocument();
    } finally {
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
    }
  });

  it("keeps standing work on the project surface without duplicating the sidebar report index", () => {
    const onOpenReport = vi.fn();
    const onCheckStanding = vi.fn();
    const standing = {
      schema_version: 1,
      id: "standing_0123456789abcdefabcd",
      project_id: "project-1",
      name: "门店收入变化",
      query: "比较门店收入变化",
      playbook_id: "pb_0123456789abcdefabcd",
      playbook_shape_hash: "a".repeat(64),
      watched_source_roles: ["订单"],
      state: "active",
      trigger_policy: "app_open_and_source_change",
      overdue_after_seconds: 86400,
      materiality: {
        version: 1,
        match: "any",
        percent_unit: "ratio",
        top_driver_limit: 10,
        rules: [],
      },
      created_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-02T00:00:00Z",
    } satisfies StandingAnalysis;
    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <MessageList
          messages={[]}
          isLoading={false}
          sources={[]}
          standingAnalyses={[standing]}
          emptyComposer={<button type="button">描述任务</button>}
          activityLoading={false}
          modelReady={true}
          onRetry={vi.fn()}
          onRerun={vi.fn()}
          onOpenSettings={vi.fn()}
          onOpenData={vi.fn()}
          onUsePrompt={vi.fn()}
          onOpenReport={onOpenReport}
          onCheckStanding={onCheckStanding}
          onConfirm={vi.fn().mockResolvedValue(undefined)}
          onContinuePending={vi.fn()}
          onEditPending={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByTestId("project-work-surface")).toHaveTextContent("现在想推进哪件事");
    expect(screen.getByText("门店收入变化")).toBeInTheDocument();
    expect(screen.queryByText("商品与线上渠道关联")).not.toBeInTheDocument();
    expect(screen.getAllByText("持续关注")).toHaveLength(2);
    expect(screen.queryByText("数据")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "检查变化" }));
    expect(onCheckStanding).toHaveBeenCalledWith(standing);
    expect(onOpenReport).not.toHaveBeenCalled();
  });

  it("keeps the task surface clear of a second horizontal report browser", () => {
    const onOpenReport = vi.fn();
    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <MessageList
          messages={[]}
          isLoading={false}
          sources={[]}
          standingAnalyses={[]}
          emptyComposer={<div>任务输入</div>}
          activityLoading={false}
          modelReady={true}
          onRetry={vi.fn()}
          onRerun={vi.fn()}
          onOpenSettings={vi.fn()}
          onOpenData={vi.fn()}
          onUsePrompt={vi.fn()}
          onOpenReport={onOpenReport}
          onCheckStanding={vi.fn()}
          onConfirm={vi.fn().mockResolvedValue(undefined)}
          onContinuePending={vi.fn()}
          onEditPending={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByText("任务输入")).toBeInTheDocument();
    expect(screen.queryByTestId("recent-report-track")).not.toBeInTheDocument();
    expect(screen.queryByText("收入变化")).not.toBeInTheDocument();
    expect(onOpenReport).not.toHaveBeenCalled();
  });
});
