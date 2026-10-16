import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockSemanticDialogs } from "./semantic-dialog-mock";
import type { ChatMessage } from "@/lib/types/chat";
import type { AnalysisCorrection, SemanticEntry } from "@/lib/types/api";
import { AssistantMessageCard } from "@/components/chat/AssistantMessageCard";
import { api } from "@/lib/api/client";
import { useProjectStore } from "@/lib/stores/project";
import enMessages from "@/messages/en.json";
import messages from "@/messages/zh.json";

vi.mock("@/lib/api/client", () => ({
  api: {
    delete: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <div role="img" aria-label={alt} />,
}));

vi.mock("@/components/chat/ChartDisplay", () => ({
  ChartDisplay: ({ spec }: { spec: unknown }) => (
    <div data-testid="generic-chart" data-spec={JSON.stringify(spec)} />
  ),
}));

vi.mock("@/components/chat/DataTable", () => ({
  DataTable: ({ data }: { data: Array<Record<string, unknown>> }) => (
    <div>{JSON.stringify(data)}</div>
  ),
}));

vi.stubGlobal(
  "ResizeObserver",
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const visualization = {
  type: "bar" as const,
  data: [{ name: "A", value: 1 }],
  title: "Sales",
};

function correctionFixture(
  overrides: Partial<AnalysisCorrection> = {},
): AnalysisCorrection {
  return {
    id: "correction-1",
    project_id: "project-1",
    analysis_run_id: "run-1",
    semantic_entry_id: null,
    target_ref: null,
    correction_type: "business_rule",
    text: "利润按实付金额减单位成本计算。",
    scope: "run",
    state: "recorded",
    evidence: [],
    created_at: "2026-07-18T00:00:00Z",
    updated_at: "2026-07-18T00:00:00Z",
    ...overrides,
  };
}

function renderCard(
  message: ChatMessage,
  overrides: {
    onRunPrompt?: (prompt: string, options?: { correctionId?: string }) => void;
    onOpenUnderstanding?: () => void;
    onRetry?: (index: number) => void;
    onChangeAnalysisService?: (index: number) => void;
    onManageAnalysisServices?: (index: number) => void;
    onConfirm?: (
      analysisRunId: string,
      key: string,
      selectedOption: string,
    ) => Promise<void>;
  } = {},
  locale: "en" | "zh" = "zh",
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? enMessages : messages}
    >
      <QueryClientProvider client={queryClient}>
        <AssistantMessageCard
          message={message}
          index={0}
          onRetry={overrides.onRetry || vi.fn()}
          onRerun={vi.fn()}
          onUsePrompt={vi.fn()}
          onRunPrompt={overrides.onRunPrompt}
          onConfirm={overrides.onConfirm || vi.fn()}
          onOpenData={vi.fn()}
          onOpenUnderstanding={overrides.onOpenUnderstanding}
          onChangeAnalysisService={overrides.onChangeAnalysisService}
          onManageAnalysisServices={overrides.onManageAnalysisServices}
        />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

describe("AssistantMessageCard", () => {
  let restoreDialogs: () => void;
  beforeEach(() => { restoreDialogs = mockSemanticDialogs(); });
  afterEach(() => { cleanup(); restoreDialogs(); });
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.delete).mockReset();
    vi.mocked(api.get).mockResolvedValue({ data: { data: [] } });
    useProjectStore.setState({ knowledge: [] });
  });

  it("shows a verified correction receipt only when the system provides verification evidence", () => {
    renderCard({
      role: "assistant",
      content: "已重新核对",
      analysisState: "completed",
      correctionApplication: {
        correction_id: "correction-1",
        source_run_id: "run-before",
        status: "verified",
        summary: "退款已从本期收入中排除。",
        checks: ["收入已重新计算", "汇总结果已再次核对"],
      },
      report: {
        status: "completed",
        title: "收入调查",
        summary: "已按修正后的口径检查本期收入。",
        findings: [],
        metrics: [],
        evidence: [],
        follow_ups: [],
      },
    });

    const receipt = screen.getByRole("status", { name: "核对纠正内容" });
    expect(receipt).toHaveTextContent("本次修正已用于当前数据并重新核对");
    expect(receipt).toHaveTextContent("退款已从本期收入中排除");
    expect(receipt).toHaveTextContent("汇总结果已再次核对");
  });

  it("localizes coded correction receipt summaries in English", () => {
    renderCard(
      {
        role: "assistant",
        content: "done",
        correctionApplication: {
          correction_id: "correction-1",
          source_run_id: "run-before",
          status: "verified",
          summary_code: "correction_verified",
          summary: "这条修正已应用到当前数据，并在最终结果中重新核对。",
          checks: ["current_definition_applied", "历史中文检查"],
        },
      },
      {},
      "en",
    );

    const receipt = screen.getByRole("status");
    expect(receipt).toHaveTextContent(
      "This correction was applied to the current data and rechecked in the final result.",
    );
    expect(receipt).not.toHaveTextContent("这条修正已应用到当前数据");
    expect(receipt).toHaveTextContent("Using the currently confirmed definition");
    expect(receipt).not.toHaveTextContent("历史中文检查");
  });

  it("localizes coded correction receipt summaries in Chinese", () => {
    renderCard({
      role: "assistant",
      content: "已完成",
      correctionApplication: {
        correction_id: "correction-1",
        source_run_id: "run-before",
        status: "definition_only",
        summary_code: "correction_definition_only",
        summary: "The correction was saved but cannot be verified automatically.",
        checks: [],
      },
    });

    const receipt = screen.getByRole("status");
    expect(receipt).toHaveTextContent(
      "已按这条修正重新调查；它目前只作为业务定义保存，尚不能自动验证执行。",
    );
    expect(receipt).not.toHaveTextContent("cannot be verified automatically");
  });

  it("does not leak a cross-language legacy summary when no summary code exists", () => {
    renderCard(
      {
        role: "assistant",
        content: "done",
        correctionApplication: {
          correction_id: "correction-1",
          source_run_id: "run-before",
          status: "verified",
          summary: "这条历史回执只有中文摘要。",
          checks: [],
        },
      },
      {},
      "en",
    );

    const receipt = screen.getByRole("status");
    expect(receipt).toHaveTextContent(
      "This report uses the corrected judgement and rechecked the current data.",
    );
    expect(receipt).not.toHaveTextContent("这条历史回执只有中文摘要");
  });

  it("keeps an unverified correction amber and a failed application in the error state", () => {
    const { rerender } = renderCard({
      role: "assistant",
      content: "已记住",
      correctionApplication: {
        correction_id: "correction-1",
        source_run_id: "run-before",
        status: "definition_only",
        checks: [],
      },
    });

    expect(
      screen.getByRole("status", { name: "核对纠正内容" }),
    ).toHaveTextContent("已记住定义，执行方式尚未验证");

    rerender(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <QueryClientProvider client={new QueryClient()}>
          <AssistantMessageCard
            message={{
              role: "assistant",
              content: "",
              errorMessage: "当前数据无法完成核对",
              correctionApplication: {
                correction_id: null,
                source_run_id: null,
                status: "failed",
                summary: "当前数据不足以证明修正已经正确作用。",
              },
            }}
            index={0}
            onRetry={vi.fn()}
            onRerun={vi.fn()}
            onUsePrompt={vi.fn()}
            onConfirm={vi.fn()}
            onOpenData={vi.fn()}
          />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );

    const failure = screen.getByRole("alert", { name: "本次修正未完成" });
    expect(failure).toHaveTextContent("当前数据不足以证明修正已经正确作用");
    expect(screen.queryByText("本次修正没有完成核对")).not.toBeInTheDocument();
    expect(screen.queryByText("调查未完成")).not.toBeInTheDocument();
    expect(
      screen.queryByText("本次修正已用于当前数据并重新核对"),
    ).not.toBeInTheDocument();
  });

  it("offers a service change instead of repeating a rejected credential", () => {
    const onRetry = vi.fn();
    const onChangeAnalysisService = vi.fn();
    const onManageAnalysisServices = vi.fn();
    renderCard(
      {
        role: "assistant",
        content: "",
        hasError: true,
        errorCode: "MODEL_AUTH_ERROR",
        errorCategory: "model_provider",
        errorMessage: "模型服务拒绝了凭证，请检查 API Key。",
        originalQuery: "检查本月收入",
        canRetry: true,
      },
      {
        onRetry,
        onChangeAnalysisService,
        onManageAnalysisServices,
      },
    );

    const failure = screen.getByRole("alert", { name: "分析服务不可用" });
    expect(failure).toHaveTextContent("访问凭证已失效");
    expect(screen.queryByText("调查未完成")).not.toBeInTheDocument();
    expect(screen.queryByText("这次调查没有完成")).not.toBeInTheDocument();
    expect(screen.queryByText("分析服务需要处理")).not.toBeInTheDocument();
    expect(screen.queryByText(/原问题仍会保留/)).not.toBeInTheDocument();
    expect(
      screen.queryByText("模型服务拒绝了凭证，请检查 API Key。"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "诊断信息" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "重试" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "更换服务" }));
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(onChangeAnalysisService).toHaveBeenCalledWith(0);
    expect(onManageAnalysisServices).toHaveBeenCalledWith(0);
    expect(onRetry).not.toHaveBeenCalled();

    expect(
      screen.queryByText("模型服务拒绝了凭证，请检查 API Key。"),
    ).not.toBeInTheDocument();
  });

  it("keeps result rows while hiding internal execution details", () => {
    renderCard({
      role: "assistant",
      content: "华东区本月销售额最高。",
      sql: "SELECT internal_secret FROM private_table",
      pythonCode: "print('internal python code')",
      pythonOutput: "internal python output",
      diagnostics: [
        {
          status: "error",
          message: "raw provider diagnostic",
          error_code: "INTERNAL_TOOL_ERROR",
        },
      ],
      toolHistory: [
        { kind: "validation", raw_tool_payload: "private tool history" },
      ],
      data: [{ 地区: "华东", 销售额: 120 }],
    });

    expect(screen.getByText("华东区本月销售额最高。")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "调查结果详情" })).toHaveTextContent(
      "华东",
    );
    expect(screen.getByRole("region", { name: "调查结果详情" })).toHaveTextContent(
      "120",
    );
    expect(
      screen.queryByRole("button", { name: "依据与细节" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/internal_secret/)).not.toBeInTheDocument();
    expect(screen.queryByText(/internal python/)).not.toBeInTheDocument();
    expect(screen.queryByText(/raw provider diagnostic/)).not.toBeInTheDocument();
    expect(screen.queryByText(/private tool history/)).not.toBeInTheDocument();
  });

  it("keeps validation evidence internal instead of narrating it in the report", () => {
    renderCard({
      role: "assistant",
      content: "本月销售额保持稳定。",
      analysisState: "completed",
      report: {
        status: "completed",
        title: "销售概览",
        summary: "本月销售额保持稳定。",
        findings: [],
        metrics: [],
        evidence: [
          "结论使用了已连接业务数据库中的实际记录。",
          "最终汇总共 4 行，未发生截断。",
        ],
        follow_ups: [],
      },
    });

    expect(screen.getByText("销售概览")).toBeInTheDocument();
    expect(screen.queryByText("为什么可以这样判断")).not.toBeInTheDocument();
    expect(
      screen.queryByText("结论使用了已连接业务数据库中的实际记录。"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("最终汇总共 4 行，未发生截断。"),
    ).not.toBeInTheDocument();
  });

  it("offers retry only for a transient service failure", () => {
    const onRetry = vi.fn();
    renderCard(
      {
        role: "assistant",
        content: "",
        hasError: true,
        errorCode: "MODEL_TIMEOUT",
        errorCategory: "timeout",
        errorMessage: "分析服务暂时没有响应。",
        originalQuery: "检查本月收入",
        canRetry: true,
      },
      { onRetry },
    );

    expect(screen.getByRole("alert", { name: "调查未完成" })).toHaveTextContent(
      "分析服务暂时没有响应",
    );
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledWith(0);
    expect(
      screen.queryByRole("button", { name: "更换服务" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a resumable failure compact and continues the saved investigation", () => {
    const onRetry = vi.fn();
    renderCard(
      {
        role: "assistant",
        content: "",
        hasError: true,
        errorCode: "PROCESS_INTERRUPTED",
        errorCategory: "client",
        errorMessage: "进程意外退出，run_id=run-1",
        originalQuery: "检查本月收入",
        canRetry: true,
        resumable: true,
      },
      { onRetry },
    );

    expect(screen.getByRole("alert", { name: "调查已暂停" })).toHaveTextContent(
      "进度已保留，可以继续",
    );
    expect(screen.queryByText(/run_id/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(onRetry).toHaveBeenCalledWith(0);
  });

  it("translates known receipt checks and hides unknown internal check codes", () => {
    renderCard({
      role: "assistant",
      content: "已重新核对",
      correctionApplication: {
        correction_id: "correction-1",
        source_run_id: "run-before",
        rule_key: "revenue_refund_policy",
        status: "verified",
        checks: [
          "current_definition_applied",
          "application_reaches_final_result",
          "final_result_revalidated",
          "future_internal_guard_code",
        ],
      },
    });

    const receipt = screen.getByRole("status", { name: "核对纠正内容" });
    expect(receipt).toHaveTextContent("使用的是当前确认的定义");
    expect(receipt).toHaveTextContent("这条修正已进入最终结果");
    expect(receipt).toHaveTextContent("最终结果已经重新核对");
    expect(receipt).not.toHaveTextContent("current_definition_applied");
    expect(receipt).not.toHaveTextContent("future_internal_guard_code");
    expect(receipt).not.toHaveTextContent("revenue_refund_policy");
  });

  it("prefers a Python-rendered image over the generic chart for the same result", () => {
    renderCard({
      role: "assistant",
      content: "done",
      visualization,
      pythonImages: ["validated-image"],
    });

    expect(
      screen.getByRole("img", { name: "分析结果图 1" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("generic-chart")).not.toBeInTheDocument();
  });

  it("keeps the generic chart when there is no usable Python image", () => {
    renderCard({
      role: "assistant",
      content: "done",
      visualization,
      pythonImages: [""],
    });

    expect(screen.getByTestId("generic-chart")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("passes trusted chart bindings through to the deterministic renderer", () => {
    renderCard({
      role: "assistant",
      content: "done",
      visualization: {
        version: 1,
        type: "bar",
        title: "月度销售",
        data_ref: { result_name: "monthly_sales", result_hash: "hash-1" },
        encoding: {
          x: { field: "month", label: "月份" },
          y: [{ field: "sales", label: "销售额", format: "currency" }],
        },
        presentation: {
          orientation: "vertical",
          stack: "none",
          palette: "receiptbi",
        },
        data: [
          { wrong_label: "华东", wrong_number: 999, month: "一月", sales: 12 },
        ],
      },
    });

    const rendered = screen.getByTestId("generic-chart");
    const spec = JSON.parse(rendered.getAttribute("data-spec") || "null");
    expect(spec.encoding.x.field).toBe("month");
    expect(spec.encoding.y).toEqual([
      expect.objectContaining({ field: "sales", label: "销售额" }),
    ]);
    expect(spec.encoding.y).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "wrong_number" })]),
    );
  });

  it("turns a validated reusable analysis into a standing brief", async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({
        data: {
          data: {
            name: "门店收入变化",
            validation: { numeric_columns: ["revenue", "orders"] },
          },
        },
      })
      .mockResolvedValueOnce({ data: { data: { id: "standing-1" } } });

    renderCard({
      role: "assistant",
      content: "done",
      projectId: "project-1",
      analysisRunId: "run-1",
      analysisState: "completed",
      report: {
        status: "completed",
        title: "门店收入变化",
        summary: "收入出现明显变化",
        findings: [],
        metrics: [],
        evidence: [],
        follow_ups: [],
      },
      toolHistory: [{ kind: "validation" }],
    });

    fireEvent.click(screen.getByRole("button", { name: "下次继续这样分析" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "持续关注变化" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "持续关注变化" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post).toHaveBeenLastCalledWith(
      "/api/v1/projects/project-1/standing-analyses",
      expect.objectContaining({
        analysis_run_id: "run-1",
        materiality: expect.objectContaining({
          rules: [
            expect.objectContaining({ metric: "revenue", threshold: 0.1 }),
            expect.objectContaining({ metric: "orders", threshold: 0.1 }),
          ],
        }),
      }),
    );
    expect(
      await screen.findByRole("button", { name: "已持续关注" }),
    ).toBeDisabled();
  });

  it("keeps standing-analysis failures in product language", async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({
        data: {
          data: {
            name: "门店收入变化",
            validation: { numeric_columns: ["revenue"] },
          },
        },
      })
      .mockRejectedValueOnce({
        message: "Request failed with status code 422",
        response: {
          status: 422,
          data: { detail: "本次调查缺少唯一的系统执行回执" },
        },
      });

    renderCard({
      role: "assistant",
      content: "done",
      projectId: "project-1",
      analysisRunId: "run-1",
      analysisState: "completed",
      report: {
        status: "completed",
        title: "门店收入变化",
        summary: "收入出现明显变化",
        findings: [],
        metrics: [],
        evidence: [],
        follow_ups: [],
      },
      toolHistory: [{ kind: "validation" }],
    });

    fireEvent.click(screen.getByRole("button", { name: "下次继续这样分析" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "持续关注变化" }),
    );

    expect(
      await screen.findByText("暂时无法开始关注，请重新保存这项分析后再试。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Request failed with status code 422"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("本次调查缺少唯一的系统执行回执"),
    ).not.toBeInTheDocument();
  });

  it("opens every saved structured artifact even when none is a file", async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (String(url).endsWith("/artifacts")) {
        const base = {
          project_id: "project-1",
          analysis_run_id: "run-1",
          technical_details: {},
          created_at: "2026-07-19T00:00:00Z",
          updated_at: "2026-07-19T00:00:00Z",
        };
        return {
          data: {
            data: [
              {
                ...base,
                id: "artifact-report",
                kind: "report",
                title: "区域收入调查",
                payload: { summary: "华东收入领先。" },
              },
              {
                ...base,
                id: "artifact-metric-1",
                kind: "metric",
                title: "华东收入",
                payload: { value: "100" },
              },
              {
                ...base,
                id: "artifact-metric-2",
                kind: "metric",
                title: "华南收入",
                payload: { value: "80" },
              },
              {
                ...base,
                id: "artifact-table",
                kind: "table",
                title: "区域收入明细",
                payload: {
                  rows: [{ region: "华东", revenue: 100 }],
                  rows_count: 1,
                  sampled: false,
                },
              },
              {
                ...base,
                id: "artifact-chart",
                kind: "chart",
                title: "区域收入图",
                payload: {
                  chart: {
                    type: "bar",
                    title: "区域收入图",
                    data: [{ region: "华东", revenue: 100 }],
                  },
                },
              },
              {
                ...base,
                id: "artifact-evidence",
                kind: "evidence",
                title: "调查依据",
                payload: {
                  validations: [
                    {
                      purpose: "区域收入已经核对",
                      profile: { materialized_rows: 1 },
                    },
                  ],
                },
              },
            ],
          },
        };
      }
      return { data: { data: [] } };
    });

    renderCard({
      role: "assistant",
      content: "done",
      projectId: "project-1",
      analysisRunId: "run-1",
      analysisState: "completed",
      report: {
        status: "completed",
        title: "区域收入调查",
        summary: "华东收入领先。",
        findings: [],
        metrics: [],
        evidence: [],
        follow_ups: [],
      },
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "查看 6 项" }),
    );

    expect(
      screen.getByRole("dialog", { name: "本次调查" }),
    ).toBeInTheDocument();
    expect(screen.getByText("华东收入")).toBeInTheDocument();
    expect(screen.getAllByText("100").length).toBeGreaterThan(0);
    expect(screen.getByText("区域收入明细")).toBeInTheDocument();
    expect(screen.getAllByText("华东").length).toBeGreaterThan(0);
    expect(screen.getByText("结果已复核")).toBeInTheDocument();
    expect(screen.getByText("1 行结果已复核")).toBeInTheDocument();
    expect(screen.queryByText("区域收入已经核对")).not.toBeInTheDocument();
    expect(screen.queryByText(/relative_path/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /整理成报告/ })).toHaveAttribute(
      "href",
      "/projects/project-1/reports?fromRun=run-1",
    );
  });

  it("persists a run-scoped correction without promoting it to project knowledge", async () => {
    const onRunPrompt = vi.fn();
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (String(url).endsWith("/correction-targets")) {
        throw new Error("目标暂时不可用");
      }
      return { data: { data: [] } };
    });
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        data: correctionFixture({
          text: "折扣只是促销，利润要按实付金额减成本计算。",
        }),
      },
    });
    renderCard(
      {
        role: "assistant",
        content: "折扣门店一定亏损",
        originalQuery: "分析门店利润",
        projectId: "project-1",
        analysisRunId: "run-1",
        analysisState: "completed",
        report: {
          status: "completed",
          title: "门店利润",
          summary: "折扣门店一定亏损",
          findings: [],
          metrics: [],
          evidence: [],
          follow_ups: [],
        },
      },
      { onRunPrompt },
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "结论有偏差或口径不对？纠正这次理解",
      }),
    );
    expect(screen.getByText("这次问题出在哪里？")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /以后遇到同类问题/ }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("正确的理解是什么？"), {
      target: { value: "折扣只是促销，利润要按实付金额减成本计算。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修正" }));

    expect(await screen.findByText("已记录这次修正")).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith(
      "/api/v1/projects/project-1/corrections",
      expect.objectContaining({
        analysis_run_id: "run-1",
        scope: "run",
      }),
    );
    expect(
      screen.getByRole("button", { name: "撤销记录" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "按修正重新调查" }));
    expect(onRunPrompt).toHaveBeenCalledWith(
      expect.stringContaining("折扣只是促销，利润要按实付金额减成本计算。"),
      { correctionId: "correction-1" },
    );
  });

  it("carries a reusable correction when rerunning a report with the latest data", async () => {
    const onRunPrompt = vi.fn();
    const onRerun = vi.fn();
    const persisted = correctionFixture({
      scope: "project",
      state: "promoted",
      semantic_entry_id: "knowledge-1",
    });
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data: { data: String(url).endsWith("/corrections") ? [persisted] : [] },
    }));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <NextIntlClientProvider locale="zh" messages={messages}>
        <QueryClientProvider client={queryClient}>
          <AssistantMessageCard
            message={{
              role: "assistant",
              content: "已完成",
              originalQuery: "比较本月各门店净收入变化",
              projectId: "project-1",
              analysisRunId: "run-1",
              analysisState: "completed",
              report: {
                status: "completed",
                title: "门店净收入",
                summary: "已完成",
                findings: [],
                metrics: [],
                evidence: [],
                follow_ups: [],
              },
            }}
            index={4}
            onRetry={vi.fn()}
            onRerun={onRerun}
            onUsePrompt={vi.fn()}
            onRunPrompt={onRunPrompt}
            onConfirm={vi.fn()}
            onOpenData={vi.fn()}
          />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );

    await screen.findByText("已记住定义，执行方式尚未验证");
    expect(screen.getByRole("link", { name: "加入报表" })).toHaveAttribute(
      "href",
      "/projects/project-1/reports?fromRun=run-1",
    );
    fireEvent.click(screen.getByRole("button", { name: "用最新数据重跑" }));

    expect(onRunPrompt).toHaveBeenCalledWith("比较本月各门店净收入变化", {
      correctionId: "correction-1",
    });
    expect(onRerun).not.toHaveBeenCalled();
  });

  it("sends an opaque target ref without showing the internal semantic key", async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (String(url).endsWith("/correction-targets")) {
        return {
          data: {
            data: [
              {
                target_ref: "target-ref-relationship-1",
                label: "门店与订单的对应关系",
                description: "这两份数据应该如何对应",
                correction_type: "relationship_rule",
                target_key: "relationship:orders:stores",
              },
            ],
          },
        };
      }
      return { data: { data: [] } };
    });
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        data: correctionFixture({
          target_ref: "target-ref-relationship-1",
          correction_type: "relationship_rule",
          text: "订单和门店要通过门店编号关联，不要用门店名称。",
        }),
      },
    });
    renderCard({
      role: "assistant",
      content: "done",
      projectId: "project-1",
      analysisRunId: "run-1",
      analysisState: "completed",
      report: {
        status: "completed",
        title: "门店关联分析",
        summary: "旧关联",
        findings: [],
        metrics: [],
        evidence: [],
        follow_ups: [],
      },
    });

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(
      vi
        .mocked(api.get)
        .mock.calls.some(([url]) =>
          String(url).endsWith("/correction-targets"),
        ),
    ).toBe(false);
    fireEvent.click(
      screen.getByRole("button", {
        name: "结论有偏差或口径不对？纠正这次理解",
      }),
    );
    expect(await screen.findByText("你要修正哪一项？")).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /整体结论 \/ 其他/ }),
    ).toBeChecked();
    expect(screen.getByText("这两份数据应该如何对应")).toBeInTheDocument();
    expect(
      screen.queryByText("relationship:orders:stores"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("radio", { name: /门店与订单的对应关系/ }),
    );
    fireEvent.change(screen.getByLabelText("正确的理解是什么？"), {
      target: { value: "订单和门店要通过门店编号关联，不要用门店名称。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修正" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/api/v1/projects/project-1/corrections",
        expect.objectContaining({
          target_ref: "target-ref-relationship-1",
          correction_type: "relationship_rule",
          text: "订单和门店要通过门店编号关联，不要用门店名称。",
        }),
      ),
    );
    expect(await screen.findByText("数据关联")).toBeInTheDocument();
  });

  it("resets the selected target when the same card switches reports", async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/correction-targets")) {
        const firstRun = requestUrl.includes("/run-1/");
        return {
          data: {
            data: [
              {
                target_ref: firstRun ? "target-ref-run-1" : "target-ref-run-2",
                label: firstRun ? "第一份报告的收入" : "第二份报告的利润",
                description: firstRun ? "本期实际收入" : "本期实际利润",
                correction_type: "metric_definition",
              },
            ],
          },
        };
      }
      return { data: { data: [] } };
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const sharedProps = {
      index: 0,
      onRetry: vi.fn(),
      onRerun: vi.fn(),
      onUsePrompt: vi.fn(),
      onConfirm: vi.fn(),
      onOpenData: vi.fn(),
    };
    const messageForRun = (analysisRunId: string): ChatMessage => ({
      role: "assistant",
      content: "done",
      projectId: "project-1",
      analysisRunId,
      analysisState: "completed",
      report: {
        status: "completed",
        title: "经营结果",
        summary: "已完成",
        findings: [],
        metrics: [],
        evidence: [],
        follow_ups: [],
      },
    });
    const cardForRun = (analysisRunId: string) => (
      <NextIntlClientProvider locale="zh" messages={messages}>
        <QueryClientProvider client={queryClient}>
          <AssistantMessageCard
            message={messageForRun(analysisRunId)}
            {...sharedProps}
          />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
    const view = render(cardForRun("run-1"));

    fireEvent.click(
      screen.getByRole("button", {
        name: "结论有偏差或口径不对？纠正这次理解",
      }),
    );
    fireEvent.click(
      await screen.findByRole("radio", { name: /第一份报告的收入/ }),
    );
    expect(
      screen.getByRole("radio", { name: /第一份报告的收入/ }),
    ).toBeChecked();

    view.rerender(cardForRun("run-2"));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "结论有偏差或口径不对？纠正这次理解",
      }),
    );

    expect(
      await screen.findByRole("radio", { name: /第二份报告的利润/ }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("radio", { name: /整体结论 \/ 其他/ }),
    ).toBeChecked();
    expect(screen.queryByText("第一份报告的收入")).not.toBeInTheDocument();
  });

  it("only promotes a correction to project knowledge when the user asks to reuse it", async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (String(url).endsWith("/correction-targets")) {
        return {
          data: {
            data: [
              {
                target_ref: "target-ref-profit-1",
                label: "利润的计算口径",
                description: "本次调查已经应用的指标口径",
                correction_type: "metric_definition",
              },
            ],
          },
        };
      }
      return { data: { data: [] } };
    });
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        data: correctionFixture({
          semantic_entry_id: "knowledge-1",
          target_ref: "target-ref-profit-1",
          correction_type: "metric_definition",
          scope: "project",
          state: "promoted",
        }),
      },
    });
    renderCard({
      role: "assistant",
      content: "done",
      projectId: "project-1",
      analysisRunId: "run-1",
      analysisState: "completed",
      report: {
        status: "completed",
        title: "利润口径",
        summary: "旧口径",
        findings: [],
        metrics: [],
        evidence: [],
        follow_ups: [],
      },
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "结论有偏差或口径不对？纠正这次理解",
      }),
    );
    fireEvent.click(
      await screen.findByRole("radio", { name: /利润的计算口径/ }),
    );
    fireEvent.change(screen.getByLabelText("正确的理解是什么？"), {
      target: { value: "利润按实付金额减单位成本计算。" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /以后遇到同类问题/ }));
    await screen.findByText(/当前报告里没有可安全绑定的数值字段/);
    fireEvent.click(screen.getByRole("button", { name: "保存修正" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith(
      "/api/v1/projects/project-1/corrections",
      expect.objectContaining({
        analysis_run_id: "run-1",
        target_ref: "target-ref-profit-1",
        scope: "project",
      }),
    );
    expect(
      await screen.findByText("已记住定义，执行方式尚未验证"),
    ).toBeInTheDocument();
  });

  it("binds a reusable metric correction through an opaque field choice", async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/correction-targets")) {
        return {
          data: {
            data: [
              {
                target_ref: "target-ref-revenue-1",
                label: "收入的计算口径",
                description: "本次调查已经应用的指标口径",
                correction_type: "metric_definition",
              },
            ],
          },
        };
      }
      if (requestUrl.endsWith("/target-ref-revenue-1/options")) {
        return {
          data: {
            data: [
              {
                kind: "metric_column",
                field_ref: "mcf1_8b17e9a14c",
                label: "实付金额 · 订单数据",
                description: "来自订单数据的可核对数值字段",
              },
              {
                kind: "metric_column",
                field_ref: "mcf1_42a60d1f7e",
                label: "标价金额 · 订单数据",
                description: "来自订单数据的可核对数值字段",
              },
            ],
          },
        };
      }
      return { data: { data: [] } };
    });
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        data: correctionFixture({
          semantic_entry_id: "knowledge-revenue",
          target_ref: "target-ref-revenue-1",
          correction_type: "metric_definition",
          scope: "project",
          state: "promoted",
          selection: { kind: "metric_column", field_ref: "mcf1_8b17e9a14c" },
          text: "收入按实付金额计算。",
        }),
      },
    });
    renderCard({
      role: "assistant",
      content: "done",
      projectId: "project-1",
      analysisRunId: "run-1",
      analysisState: "completed",
      report: {
        status: "completed",
        title: "收入分析",
        summary: "旧口径",
        findings: [],
        metrics: [],
        evidence: [],
        follow_ups: [],
      },
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "结论有偏差或口径不对？纠正这次理解",
      }),
    );
    fireEvent.click(
      await screen.findByRole("radio", { name: /收入的计算口径/ }),
    );
    fireEvent.change(screen.getByLabelText("正确的理解是什么？"), {
      target: { value: "收入按实付金额计算。" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /以后遇到同类问题/ }));
    fireEvent.click(
      await screen.findByRole("radio", { name: /实付金额 · 订单数据/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存修正" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/api/v1/projects/project-1/corrections",
        expect.objectContaining({
          target_ref: "target-ref-revenue-1",
          scope: "project",
          selection: {
            kind: "metric_column",
            field_ref: "mcf1_8b17e9a14c",
          },
        }),
      ),
    );
    expect(
      screen.queryByText(/schema_signature|paid_amount/),
    ).not.toBeInTheDocument();
  });

  it("uses the sole current field option without waiting for an effect", async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/correction-targets")) {
        return {
          data: {
            data: [
              {
                target_ref: "target-ref-revenue-sole",
                label: "收入的计算口径",
                description: "本次调查已经应用的指标口径",
                correction_type: "metric_definition",
              },
            ],
          },
        };
      }
      if (requestUrl.endsWith("/target-ref-revenue-sole/options")) {
        return {
          data: {
            data: [
              {
                kind: "metric_column",
                field_ref: "mcf1_f5a2d920d1",
                label: "实付金额 · 订单数据",
                description: "来自订单数据的可核对数值字段",
              },
            ],
          },
        };
      }
      return { data: { data: [] } };
    });
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        data: correctionFixture({
          target_ref: "target-ref-revenue-sole",
          correction_type: "metric_definition",
          scope: "project",
          selection: { kind: "metric_column", field_ref: "mcf1_f5a2d920d1" },
        }),
      },
    });
    renderCard({
      role: "assistant",
      content: "done",
      projectId: "project-1",
      analysisRunId: "run-1",
      analysisState: "completed",
      report: {
        status: "completed",
        title: "收入分析",
        summary: "旧口径",
        findings: [],
        metrics: [],
        evidence: [],
        follow_ups: [],
      },
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "结论有偏差或口径不对？纠正这次理解",
      }),
    );
    fireEvent.click(
      await screen.findByRole("radio", { name: /收入的计算口径/ }),
    );
    fireEvent.change(screen.getByLabelText("正确的理解是什么？"), {
      target: { value: "收入按实付金额计算。" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /以后遇到同类问题/ }));
    expect(
      await screen.findByRole("radio", { name: /实付金额 · 订单数据/ }),
    ).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "保存修正" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/api/v1/projects/project-1/corrections",
        expect.objectContaining({
          selection: { kind: "metric_column", field_ref: "mcf1_f5a2d920d1" },
        }),
      ),
    );
  });

  it("drops a stale field ref and keeps an owned target type fixed", async () => {
    const persisted = correctionFixture({
      scope: "project",
      state: "promoted",
      semantic_entry_id: "knowledge-stale",
      target_ref: "target-ref-old",
      correction_type: "metric_definition",
      selection: { kind: "metric_column", field_ref: "mcf1_stale_opaque" },
      text: "收入按实付金额计算。",
    });
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data: { data: String(url).endsWith("/corrections") ? [persisted] : [] },
    }));
    vi.mocked(api.put).mockResolvedValueOnce({
      data: { data: correctionFixture({ ...persisted, selection: null }) },
    });
    renderCard({
      role: "assistant",
      content: "done",
      projectId: "project-1",
      analysisRunId: "run-1",
      analysisState: "completed",
      report: {
        status: "completed",
        title: "收入分析",
        summary: "旧口径",
        findings: [],
        metrics: [],
        evidence: [],
        follow_ups: [],
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "修改" }));
    expect(screen.queryByText("这次问题出在哪里？")).not.toBeInTheDocument();
    await screen.findByText(/没有可安全绑定的数值字段/);
    fireEvent.click(screen.getByRole("button", { name: "保存修正" }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        "/api/v1/projects/project-1/corrections/correction-1",
        expect.objectContaining({
          correction_type: "metric_definition",
          target_ref: "target-ref-old",
          selection: null,
        }),
      ),
    );
  });

  it("does not apply an old save response after the card switches reports", async () => {
    let resolveSave!: (value: unknown) => void;
    vi.mocked(api.post).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve;
      }) as ReturnType<typeof api.post>,
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const sharedProps = {
      index: 0,
      onRetry: vi.fn(),
      onRerun: vi.fn(),
      onUsePrompt: vi.fn(),
      onConfirm: vi.fn(),
      onOpenData: vi.fn(),
    };
    const messageForRun = (analysisRunId: string): ChatMessage => ({
      role: "assistant",
      content: "done",
      projectId: "project-1",
      analysisRunId,
      analysisState: "completed",
      report: {
        status: "completed",
        title: analysisRunId === "run-1" ? "第一份报告" : "第二份报告",
        summary: "已完成",
        findings: [],
        metrics: [],
        evidence: [],
        follow_ups: [],
      },
    });
    const cardForRun = (analysisRunId: string) => (
      <NextIntlClientProvider locale="zh" messages={messages}>
        <QueryClientProvider client={queryClient}>
          <AssistantMessageCard
            message={messageForRun(analysisRunId)}
            {...sharedProps}
          />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
    const view = render(cardForRun("run-1"));

    fireEvent.click(
      screen.getByRole("button", {
        name: "结论有偏差或口径不对？纠正这次理解",
      }),
    );
    fireEvent.change(screen.getByLabelText("正确的理解是什么？"), {
      target: { value: "只修正第一份报告。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修正" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));

    view.rerender(cardForRun("run-2"));
    await act(async () => {
      resolveSave({
        data: {
          data: correctionFixture({
            analysis_run_id: "run-1",
            text: "只修正第一份报告。",
          }),
        },
      });
    });

    expect(
      await screen.findByRole("button", {
        name: "结论有偏差或口径不对？纠正这次理解",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("已记录这次修正")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "按修正重新调查" }),
    ).not.toBeInTheDocument();
  });

  it("does not clear the new report draft when an old delete finishes", async () => {
    const persisted = correctionFixture();
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data: { data: String(url).endsWith("/corrections") ? [persisted] : [] },
    }));
    let resolveDelete!: (value: unknown) => void;
    vi.mocked(api.delete).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDelete = resolve;
      }) as ReturnType<typeof api.delete>,
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const sharedProps = {
      index: 0,
      onRetry: vi.fn(),
      onRerun: vi.fn(),
      onUsePrompt: vi.fn(),
      onConfirm: vi.fn(),
      onOpenData: vi.fn(),
    };
    const messageForRun = (analysisRunId: string): ChatMessage => ({
      role: "assistant",
      content: "done",
      projectId: "project-1",
      analysisRunId,
      analysisState: "completed",
      report: {
        status: "completed",
        title: analysisRunId === "run-1" ? "第一份报告" : "第二份报告",
        summary: "已完成",
        findings: [],
        metrics: [],
        evidence: [],
        follow_ups: [],
      },
    });
    const cardForRun = (analysisRunId: string) => (
      <NextIntlClientProvider locale="zh" messages={messages}>
        <QueryClientProvider client={queryClient}>
          <AssistantMessageCard
            message={messageForRun(analysisRunId)}
            {...sharedProps}
          />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
    const view = render(cardForRun("run-1"));

    fireEvent.click(await screen.findByRole("button", { name: "撤销记录" }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledTimes(1));
    view.rerender(cardForRun("run-2"));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "结论有偏差或口径不对？纠正这次理解",
      }),
    );
    fireEvent.change(screen.getByLabelText("正确的理解是什么？"), {
      target: { value: "这是第二份报告尚未保存的修正。" },
    });

    await act(async () => {
      resolveDelete({
        data: { data: { deleted: true, correction_id: persisted.id } },
      });
    });

    expect(screen.getByLabelText("正确的理解是什么？")).toHaveValue(
      "这是第二份报告尚未保存的修正。",
    );
  });

  it("restores the saved target when target changes are cancelled", async () => {
    const persisted = correctionFixture({
      scope: "project",
      state: "promoted",
      semantic_entry_id: "knowledge-1",
      target_ref: "target-ref-a",
      correction_type: "metric_definition",
    });
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (String(url).endsWith("/corrections")) {
        return { data: { data: [persisted] } };
      }
      if (String(url).endsWith("/correction-targets")) {
        return {
          data: {
            data: [
              {
                target_ref: "target-ref-a",
                label: "收入口径",
                description: "本次调查已经应用的指标口径",
                correction_type: "metric_definition",
              },
              {
                target_ref: "target-ref-b",
                label: "利润口径",
                description: "本次调查已经应用的指标口径",
                correction_type: "metric_definition",
              },
            ],
          },
        };
      }
      return { data: { data: [] } };
    });

    renderCard({
      role: "assistant",
      content: "done",
      projectId: "project-1",
      analysisRunId: "run-1",
      analysisState: "completed",
      report: {
        status: "completed",
        title: "经营结果",
        summary: "已完成",
        findings: [],
        metrics: [],
        evidence: [],
        follow_ups: [],
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "修改" }));
    fireEvent.click(await screen.findByRole("radio", { name: /利润口径/ }));
    expect(screen.getByRole("radio", { name: /利润口径/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "修改" }));

    expect(
      await screen.findByRole("radio", { name: /收入口径/ }),
    ).toBeChecked();
    expect(screen.getByRole("radio", { name: /利润口径/ })).not.toBeChecked();
  });

  it("restores a persisted correction and removes it through the undo action", async () => {
    const persisted = correctionFixture({
      scope: "project",
      state: "promoted",
      semantic_entry_id: "knowledge-1",
      target_ref: "target-ref-profit-1",
      correction_type: "metric_definition",
    });
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (String(url).endsWith("/corrections")) {
        return { data: { data: [persisted] } };
      }
      if (String(url).endsWith("/correction-targets")) {
        return {
          data: {
            data: [
              {
                target_ref: "target-ref-profit-1",
                label: "利润的计算口径",
                description: "本次调查已经应用的指标口径",
                correction_type: "metric_definition",
              },
            ],
          },
        };
      }
      return { data: { data: [] } };
    });
    vi.mocked(api.delete).mockResolvedValueOnce({
      data: { data: { deleted: true, correction_id: persisted.id } },
    });

    renderCard({
      role: "assistant",
      content: "done",
      projectId: "project-1",
      analysisRunId: "run-1",
      analysisState: "completed",
      report: {
        status: "completed",
        title: "利润口径",
        summary: "旧口径",
        findings: [],
        metrics: [],
        evidence: [],
        follow_ups: [],
      },
    });

    expect(
      await screen.findByText("已记住定义，执行方式尚未验证"),
    ).toBeInTheDocument();
    expect(screen.getByText(persisted.text)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "撤销记录" }));

    await waitFor(() =>
      expect(api.delete).toHaveBeenCalledWith(
        "/api/v1/projects/project-1/corrections/correction-1",
      ),
    );
    expect(
      await screen.findByRole("button", {
        name: "结论有偏差或口径不对？纠正这次理解",
      }),
    ).toBeInTheDocument();
  });

  it("lets the user edit the exact correction that ReceiptBI remembered", async () => {
    const persisted = correctionFixture({
      scope: "project",
      state: "promoted",
      semantic_entry_id: "knowledge-1",
      target_ref: "target-ref-profit-1",
      correction_type: "metric_definition",
    });
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (String(url).endsWith("/corrections")) {
        return { data: { data: [persisted] } };
      }
      if (String(url).endsWith("/correction-targets")) {
        return {
          data: {
            data: [
              {
                target_ref: "target-ref-profit-1",
                label: "利润的计算口径",
                description: "本次调查已经应用的指标口径",
                correction_type: "metric_definition",
              },
            ],
          },
        };
      }
      return { data: { data: [] } };
    });
    vi.mocked(api.put).mockResolvedValueOnce({
      data: {
        data: correctionFixture({
          scope: "project",
          state: "promoted",
          target_ref: "target-ref-profit-1",
          correction_type: "metric_definition",
          text: "利润按实付金额减完整履约成本计算。",
        }),
      },
    });

    renderCard({
      role: "assistant",
      content: "done",
      projectId: "project-1",
      analysisRunId: "run-1",
      analysisState: "completed",
      report: {
        status: "completed",
        title: "利润口径",
        summary: "旧口径",
        findings: [],
        metrics: [],
        evidence: [],
        follow_ups: [],
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "修改" }));
    await screen.findByRole("radio", { name: /利润的计算口径/ });
    fireEvent.change(screen.getByLabelText("正确的理解是什么？"), {
      target: { value: "利润按实付金额减完整履约成本计算。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修正" }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        "/api/v1/projects/project-1/corrections/correction-1",
        expect.objectContaining({
          analysis_run_id: "run-1",
          target_ref: "target-ref-profit-1",
          scope: "project",
          text: "利润按实付金额减完整履约成本计算。",
        }),
      ),
    );
    expect(
      await screen.findByText("利润按实付金额减完整履约成本计算。"),
    ).toBeInTheDocument();
  });

  it("separates a remembered definition from its verified execution state", async () => {
    const onOpenUnderstanding = vi.fn();
    const persisted = correctionFixture({
      semantic_entry_id: "knowledge-1",
      scope: "project",
      state: "promoted",
    });
    const verifiedKnowledge: SemanticEntry = {
      id: "knowledge-1",
      project_id: "project-1",
      key: "profit_definition",
      value: persisted.text,
      entry_type: "business_rule",
      state: "confirmed",
      confidence: 1,
      allowed_actions: [],
      validity: "active",
      execution_state: "verified",
      execution_details: {
        last_verified_run_id: "run-verified",
        summary: "利润处理方式已经用当前数据核对。",
      },
      evidence: [{ kind: "user_correction" }],
      source: "user",
      created_at: "2026-07-18T00:00:00Z",
      updated_at: "2026-07-18T00:00:00Z",
    };
    useProjectStore.setState({ knowledge: [verifiedKnowledge] });
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data: { data: String(url).endsWith("/corrections") ? [persisted] : [] },
    }));

    renderCard(
      {
        role: "assistant",
        content: "done",
        projectId: "project-1",
        analysisRunId: "run-1",
        analysisState: "completed",
        report: {
          status: "completed",
          title: "利润口径",
          summary: "已完成",
          findings: [],
          metrics: [],
          evidence: [],
          follow_ups: [],
        },
      },
      { onOpenUnderstanding },
    );

    expect(await screen.findByText("已记住定义")).toBeInTheDocument();
    expect(
      screen.getByText(/定义和对应处理方式都已经核对/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("已记住定义，执行方式尚未验证"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "修改" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "在数据中管理" }));
    expect(onOpenUnderstanding).toHaveBeenCalledTimes(1);
  });

  it("keeps the saved correction visible when undo fails", async () => {
    const persisted = correctionFixture();
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data: { data: String(url).endsWith("/corrections") ? [persisted] : [] },
    }));
    vi.mocked(api.delete).mockRejectedValueOnce(new Error("撤销失败，请重试"));

    renderCard({
      role: "assistant",
      content: "done",
      projectId: "project-1",
      analysisRunId: "run-1",
      analysisState: "completed",
      report: {
        status: "completed",
        title: "利润口径",
        summary: "旧口径",
        findings: [],
        metrics: [],
        evidence: [],
        follow_ups: [],
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "撤销记录" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "暂时无法完成，请重试。",
    );
    expect(screen.getByText("已记录这次修正")).toBeInTheDocument();
  });

  it("does not offer semantic correction before a report is completed", () => {
    renderCard({
      role: "assistant",
      content: "正在检查",
      projectId: "project-1",
      analysisRunId: "run-1",
      analysisState: "investigating",
      report: {
        status: "waiting_confirmation",
        title: "调查中",
        summary: "正在检查",
        findings: [],
        metrics: [],
        evidence: [],
        follow_ups: [],
      },
    });

    expect(
      screen.queryByRole("button", {
        name: "结论有偏差或口径不对？纠正这次理解",
      }),
    ).not.toBeInTheDocument();
  });

  it("localizes a coded refund preflight while submitting the original option", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderCard(
      {
        role: "assistant",
        content: "数据同时包含金额和退款字段，不同口径会改变收入结论。",
        analysisRunId: "run-preflight-en",
        analysisState: "waiting_confirmation",
        report: {
          status: "waiting_confirmation",
          title: "需要确认一个业务口径",
          summary: "数据同时包含金额和退款字段，不同口径会改变收入结论。",
          findings: [],
          metrics: [],
          evidence: [],
          follow_ups: [],
          confirmation: {
            key: "revenue_refund_policy",
            presentation_code: "preflight.revenue_refund_policy",
            question: "计算收入时，退款订单需要扣除吗？",
            reason: "数据同时包含金额和退款字段，不同口径会改变收入结论。",
            options: ["扣除退款", "保留退款订单"],
            option_codes: {
              "扣除退款": "exclude_refunds",
              "保留退款订单": "include_refunds",
            },
          },
        },
      },
      { onConfirm },
      "en",
    );

    expect(
      screen.getByRole("heading", {
        name: "Should refunded orders be deducted when calculating revenue?",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/The data contains both amount and refund fields/)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: enMessages.assistantMessage.rerunLatest })).not.toBeInTheDocument();
    expect(screen.queryByText("计算收入时，退款订单需要扣除吗？")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Deduct refunded orders" }));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm and continue" }));
    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith(
        "run-preflight-en",
        "revenue_refund_policy",
        "扣除退款",
      ),
    );
  });

  it("shows a confirmed choice record without asking for the same decision again", () => {
    renderCard({ role: "assistant", content: "需要确认", analysisState: "waiting_confirmation", analysisRunId: "run-confirmed", confirmationResolved: "扣除退款",
      report: { status: "waiting_confirmation", title: "需要确认", summary: "需要确认", metrics: [], findings: [], evidence: [], follow_ups: [],
        confirmation: { key: "revenue_refund_policy", question: "如何计算收入？", reason: "影响结果", options: ["扣除退款", "保留退款订单"] } },
    });
    expect(screen.getByRole("heading", { level: 2, name: "本次选择" })).toBeInTheDocument();
    expect(screen.queryByText("等待你的判断")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByText("扣除退款")).toBeInTheDocument();
  });
});
