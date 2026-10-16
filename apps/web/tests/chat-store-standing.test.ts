import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stream: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  api: { get: mocks.get, post: mocks.post },
  createSecureEventStream: mocks.stream,
}));

import {
  CONVERSATION_CONTINUITY_STORAGE_KEY,
  forgetConversationForProject,
  rememberConversationForProject,
  storedConversationIdForProject,
  useChatStore,
} from "@/lib/stores/chat";
import { getErrorMessage, UserFacingError } from "@/lib/types/api";

const confirmationReport = {
  status: "waiting_confirmation" as const, title: "请选择", summary: "请选择",
  metrics: [], findings: [], evidence: [], follow_ups: [],
  confirmation: { key: "revenue_rule", question: "退款如何处理？", reason: "影响收入", options: ["扣除退款", "保留退款订单"] },
};

function confirmationFixture() {
  const message = { role: "assistant" as const, content: "请选择", analysisRunId: "run-1", projectId: "project-1", originalQuery: "比较门店收入", report: confirmationReport };
  useChatStore.setState({ currentConversationId: "origin-conversation", lastProjectId: "project-1", messages: [message],
    isLoading: false, activeStreamId: null, isConversationLoading: false, lastModelId: "model-original", lastConnectionId: "connection-original", lastContextRounds: 4 });
  const response = { data: { data: { analysis_run_id: "run-1", resume_run_id: "run-1", project_id: "project-1", conversation_id: "origin-conversation",
    key: "canonical_revenue_rule", selected_option: "扣除退款", ready_to_continue: true } } };
  const confirm = () => useChatStore.getState().confirmBusinessDefinition("run-1", "revenue_rule", "扣除退款", "zh");
  return { message, response, confirm };
}

function confirmationDoneStream() {
  return (async function* () { yield { type: "done", data: { conversation_id: "origin-conversation", message_id: "resumed" } }; })();
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

describe("standing analysis resume", () => {
  beforeEach(() => {
    mocks.stream.mockReset();
    mocks.get.mockReset();
    mocks.post.mockReset();
    vi.mocked(localStorage.getItem).mockReset();
    vi.mocked(localStorage.getItem).mockReturnValue(null);
    vi.mocked(localStorage.setItem).mockReset();
    vi.mocked(localStorage.removeItem).mockReset();
    useChatStore.setState({
      messages: [],
      currentConversationId: "old-conversation",
      currentConversationMeta: null,
      isLoading: false,
      isConversationLoading: false,
      conversationLoadError: null,
      abortController: null,
      activeStreamId: null,
      stopRequestedStreamId: null,
      lastConnectionId: null,
      lastModelId: null,
      lastContextRounds: null,
      lastProjectId: null,
      lastLanguage: null,
      pendingAnalysisSettlements: [],
    });
  });

  it("keeps one recoverable conversation pointer per project", () => {
    const storage = memoryStorage();

    rememberConversationForProject("project-A", "conversation-A", storage);
    rememberConversationForProject("project-B", "conversation-B", storage);

    expect(storedConversationIdForProject("project-A", storage)).toBe(
      "conversation-A"
    );
    expect(storedConversationIdForProject("project-B", storage)).toBe(
      "conversation-B"
    );

    forgetConversationForProject("project-A", storage);
    expect(storedConversationIdForProject("project-A", storage)).toBeNull();
    expect(storedConversationIdForProject("project-B", storage)).toBe(
      "conversation-B"
    );
  });

  it("does not let malformed continuity storage escape its project boundary", () => {
    const storage = memoryStorage();
    storage.setItem(CONVERSATION_CONTINUITY_STORAGE_KEY, "not-json");

    expect(storedConversationIdForProject("project-A", storage)).toBeNull();
    rememberConversationForProject("project-A", "conversation/unsafe", storage);
    expect(storedConversationIdForProject("project-A", storage)).toBeNull();
  });

  it("retains project pointers for navigation but forgets only the explicit new investigation", () => {
    vi.mocked(localStorage.getItem).mockReturnValue(
      JSON.stringify({
        version: 1,
        conversations: {
          "project-A": "conversation-A",
          "project-B": "conversation-B",
        },
      })
    );
    useChatStore.setState({
      currentConversationId: "conversation-A",
      lastProjectId: "project-A",
    });

    useChatStore.getState().clearConversation({ forget: false });
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(localStorage.removeItem).not.toHaveBeenCalled();

    useChatStore.getState().clearConversation({
      forget: true,
      projectId: "project-A",
    });
    expect(localStorage.setItem).toHaveBeenCalledWith(
      CONVERSATION_CONTINUITY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        conversations: { "project-B": "conversation-B" },
      })
    );
  });

  it("reuses a restored conversation for an ordinary follow-up", async () => {
    mocks.stream.mockImplementation(() =>
      (async function* () {
        yield {
          type: "done",
          data: { conversation_id: "conversation-1", message_id: "message-2" },
        };
      })()
    );
    useChatStore.setState({
      currentConversationId: "conversation-1",
      lastProjectId: "project-1",
      messages: [{ role: "user", content: "先看本月收入" }],
    });

    await useChatStore
      .getState()
      .sendMessage("继续比较上月", null, "model-1", 5, "zh", "project-1");

    expect(mocks.stream).toHaveBeenCalledWith(
      "/api/v1/chat/stream",
      expect.objectContaining({
        conversation_id: "conversation-1",
        query: "继续比较上月",
      }),
      expect.any(AbortSignal)
    );
  });

  it("uses the prepared conversation instead of the conversation currently on screen", async () => {
    mocks.stream.mockImplementation(() =>
      (async function* () {
        yield {
          type: "done",
          data: { conversation_id: "standing-conversation", message_id: "message-1" },
        };
      })()
    );

    await useChatStore.getState().resumePreparedRun(
      {
        query: "重新核对门店收入变化",
        projectId: "project-1",
        runId: "run-1",
        conversationId: "standing-conversation",
      },
      "model-1",
      5,
      "zh"
    );

    expect(mocks.stream).toHaveBeenCalledWith(
      "/api/v1/chat/stream",
      expect.objectContaining({
        conversation_id: "standing-conversation",
        resume_run_id: "run-1",
        project_id: "project-1",
      }),
      expect.any(AbortSignal)
    );
    expect(useChatStore.getState().currentConversationId).toBe("standing-conversation");
    expect(useChatStore.getState().isLoading).toBe(false);
  });

  it("rejects a second investigation while the first stream is active", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.stream.mockImplementation(() =>
      (async function* () {
        await pending;
        yield {
          type: "done",
          data: { conversation_id: "conversation-1", message_id: "message-1" },
        };
      })()
    );

    const first = useChatStore.getState().sendMessage("第一项调查", null, "model-1");

    await expect(
      useChatStore.getState().sendMessage("第二项调查", null, "model-1")
    ).rejects.toThrow("已有一项调查正在进行");
    expect(mocks.stream).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().messages.filter((message) => message.role === "user"))
      .toEqual([{ role: "user", content: "第一项调查" }]);

    release();
    await first;
  });

  it("treats an active stream id as busy even if the loading flag is stale", async () => {
    useChatStore.setState({ isLoading: false, activeStreamId: "stream-still-active" });

    await expect(useChatStore.getState().sendMessage("不要并发开启"))
      .rejects.toThrow("已有一项调查正在进行");
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it("keeps the homepage busy until a stop reaches a terminal event", async () => {
    let releaseStream!: () => void;
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    mocks.post.mockResolvedValue({ data: { data: { stopped: true } } });
    mocks.stream.mockImplementation(() =>
      (async function* () {
        await streamGate;
        yield {
          type: "error",
          data: {
            code: "CANCELLED",
            message: "分析已停止",
            error_category: "cancelled",
            analysis_state: "needs_attention",
            conversation_id: "active-conversation",
          },
        };
      })()
    );
    useChatStore.setState({
      currentConversationId: "active-conversation",
      lastProjectId: "project-1",
    });

    const investigation = useChatStore
      .getState()
      .sendMessage("检查订单变化", null, "model-1", 5, "zh", "project-1");
    const activeStreamId = useChatStore.getState().activeStreamId;
    expect(activeStreamId).toBeTruthy();

    useChatStore.getState().stopGeneration();

    expect(mocks.post).toHaveBeenCalledWith("/api/v1/chat/stop", {
      conversation_id: "active-conversation",
      client_stream_id: activeStreamId,
    });
    expect(mocks.stream).toHaveBeenCalledWith(
      "/api/v1/chat/stream",
      expect.objectContaining({ client_stream_id: activeStreamId }),
      expect.any(AbortSignal)
    );
    expect(useChatStore.getState()).toMatchObject({
      isLoading: true,
      activeStreamId,
      stopRequestedStreamId: activeStreamId,
      pendingAnalysisSettlements: [],
    });

    releaseStream();
    await investigation;

    expect(useChatStore.getState()).toMatchObject({
      isLoading: false,
      activeStreamId: null,
      stopRequestedStreamId: null,
    });
    expect(useChatStore.getState().pendingAnalysisSettlements).toEqual([
      expect.objectContaining({ outcome: "stopped" }),
    ]);
  });

  it("lets a completion that wins the stop race remain completed", async () => {
    let releaseStream!: () => void;
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    mocks.post.mockResolvedValue({ data: { data: { stopped: true } } });
    mocks.stream.mockImplementation(() =>
      (async function* () {
        await streamGate;
        yield {
          type: "done",
          data: {
            conversation_id: "active-conversation",
            message_id: "message-1",
          },
        };
      })()
    );
    useChatStore.setState({
      currentConversationId: "active-conversation",
      lastProjectId: "project-1",
    });

    const investigation = useChatStore
      .getState()
      .sendMessage("检查订单变化", null, "model-1", 5, "zh", "project-1");
    useChatStore.getState().stopGeneration();
    releaseStream();
    await investigation;

    expect(useChatStore.getState().pendingAnalysisSettlements).toEqual([
      expect.objectContaining({ outcome: "completed" }),
    ]);
    expect(useChatStore.getState().stopRequestedStreamId).toBeNull();
  });

  it("does not let a late stop response from an old stream abort the new stream", async () => {
    vi.useFakeTimers();
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    let resolveOldStop!: (value: { data: { data: { stopped: boolean } } }) => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const oldStop = new Promise<{ data: { data: { stopped: boolean } } }>(
      (resolve) => {
        resolveOldStop = resolve;
      }
    );
    mocks.post.mockReturnValue(oldStop);
    mocks.stream
      .mockImplementationOnce(() =>
        (async function* () {
          await firstGate;
          yield {
            type: "done",
            data: {
              conversation_id: "active-conversation",
              message_id: "message-a",
            },
          };
        })()
      )
      .mockImplementationOnce(() =>
        (async function* () {
          await secondGate;
          yield {
            type: "done",
            data: {
              conversation_id: "active-conversation",
              message_id: "message-b",
            },
          };
        })()
      );
    useChatStore.setState({
      currentConversationId: "active-conversation",
      lastProjectId: "project-1",
    });

    const first = useChatStore
      .getState()
      .sendMessage("第一项调查", null, "model-1", 5, "zh", "project-1");
    const firstStreamId = useChatStore.getState().activeStreamId;
    useChatStore.getState().stopGeneration();
    releaseFirst();
    await first;

    const second = useChatStore
      .getState()
      .sendMessage("第二项调查", null, "model-1", 5, "zh", "project-1");
    const secondStreamId = useChatStore.getState().activeStreamId;
    const secondController = useChatStore.getState().abortController;
    expect(secondStreamId).toBeTruthy();
    expect(secondStreamId).not.toBe(firstStreamId);
    expect(secondController).not.toBeNull();
    const abortSecond = vi.spyOn(secondController!, "abort");

    try {
      resolveOldStop({ data: { data: { stopped: true } } });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(3_000);

      expect(useChatStore.getState().activeStreamId).toBe(secondStreamId);
      expect(useChatStore.getState().isLoading).toBe(true);
      expect(abortSecond).not.toHaveBeenCalled();
    } finally {
      releaseSecond();
      await second;
      vi.useRealTimers();
    }
  });

  it("does not replace or abort the active report when history is clicked", () => {
    const abort = vi.fn();
    useChatStore.setState({
      currentConversationId: "active-conversation",
      isLoading: true,
      activeStreamId: "active-stream",
      abortController: { abort } as unknown as AbortController,
      messages: [{ role: "user", content: "正在调查" }],
    });

    useChatStore.getState().setCurrentConversation("history-conversation");

    expect(useChatStore.getState().currentConversationId).toBe("active-conversation");
    expect(useChatStore.getState().messages).toEqual([
      { role: "user", content: "正在调查" },
    ]);
    expect(abort).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("passes a correction id through when rerunning a corrected investigation", async () => {
    mocks.stream.mockImplementation(() =>
      (async function* () {
        yield {
          type: "done",
          data: { conversation_id: "conversation-1", message_id: "message-1" },
        };
      })()
    );

    await useChatStore.getState().sendMessage(
      "按修正后的口径重跑",
      null,
      "model-1",
      5,
      "zh",
      "project-1",
      null,
      null,
      null,
      "correction-1"
    );

    expect(mocks.stream).toHaveBeenCalledWith(
      "/api/v1/chat/stream",
      expect.objectContaining({ correction_id: "correction-1" }),
      expect.any(AbortSignal)
    );
    expect(useChatStore.getState().pendingAnalysisSettlements).toEqual([
      expect.objectContaining({
        projectId: "project-1",
        outcome: "completed",
      }),
    ]);
  });

  it("posts every selected semantic revision without appending identities to the visible query", async () => {
    mocks.stream.mockImplementation(() =>
      (async function* () {
        yield {
          type: "done",
          data: { conversation_id: "conversation-1", message_id: "message-1" },
        };
      })()
    );
    const selection = Array.from({ length: 25 }, (_, index) => ({
      entry_id: `entry-${index}`,
      expected_active_revision_id: `revision-${index}`,
    }));

    await useChatStore.getState().sendMessage(
      "逐条验证所选关联",
      null,
      "model-1",
      5,
      "zh",
      "project-1",
      null,
      null,
      null,
      null,
      selection
    );

    expect(mocks.stream).toHaveBeenCalledWith(
      "/api/v1/chat/stream",
      expect.objectContaining({
        query: "逐条验证所选关联",
        semantic_validation_selection: selection,
      }),
      expect.any(AbortSignal)
    );
    expect(
      useChatStore.getState().messages.find((message) => message.role === "user")
        ?.content
    ).toBe("逐条验证所选关联");
    expect(
      useChatStore.getState().messages.find((message) => message.role === "assistant")
        ?.semanticValidationSelection
    ).toEqual(selection);
  });

  it("keeps every selected revision when a client failure is retried", async () => {
    const selection = Array.from({ length: 25 }, (_, index) => ({
      entry_id: `entry-${index}`,
      expected_active_revision_id: `revision-${index}`,
    }));
    mocks.stream
      .mockImplementationOnce(() =>
        (async function* () {
          throw new Error("connection interrupted");
        })()
      )
      .mockImplementationOnce(() =>
        (async function* () {
          yield {
            type: "done",
            data: { conversation_id: "conversation-2", message_id: "message-2" },
          };
        })()
      );

    await useChatStore.getState().sendMessage(
      "验证所选关联",
      null,
      "model-1",
      5,
      "zh",
      "project-1",
      null,
      null,
      null,
      null,
      selection
    );

    const failedIndex = useChatStore
      .getState()
      .messages.findIndex((message) => message.role === "assistant");
    expect(failedIndex).toBeGreaterThanOrEqual(0);
    expect(
      useChatStore.getState().messages[failedIndex].semanticValidationSelection
    ).toEqual(selection);

    await useChatStore.getState().retryMessage(failedIndex, "zh");

    expect(mocks.stream).toHaveBeenLastCalledWith(
      "/api/v1/chat/stream",
      expect.objectContaining({
        query: "验证所选关联",
        project_id: "project-1",
        semantic_validation_selection: selection,
      }),
      expect.any(AbortSignal)
    );
  });

  it("publishes one failed settlement so project understanding can refresh", async () => {
    mocks.stream.mockImplementation(() =>
      (async function* () {
        yield {
          type: "error",
          data: {
            code: "EXECUTION_FAILED",
            message: "执行失败",
            project_id: "project-from-runtime",
            analysis_state: "needs_attention",
          },
        };
      })()
    );

    await useChatStore.getState().sendMessage(
      "检查异常",
      null,
      "model-1",
      5,
      "zh",
      "project-1"
    );

    const settlements = useChatStore.getState().pendingAnalysisSettlements;
    expect(settlements).toEqual([
      expect.objectContaining({
        projectId: "project-from-runtime",
        outcome: "failed",
      }),
    ]);

    useChatStore.getState().acknowledgeAnalysisSettlement(settlements[0].id);
    expect(useChatStore.getState().pendingAnalysisSettlements).toEqual([]);
  });

  it("replays the preserved question with an explicitly chosen replacement service", async () => {
    mocks.stream.mockImplementation(() =>
      (async function* () {
        yield {
          type: "done",
          data: { conversation_id: "replacement-conversation", message_id: "message-2" },
        };
      })()
    );
    useChatStore.setState({
      currentConversationId: "expired-conversation",
      lastProjectId: "project-1",
      lastModelId: "expired-service",
      lastContextRounds: 5,
      messages: [
        { role: "user", content: "检查本月收入" },
        {
          role: "assistant",
          content: "",
          hasError: true,
          errorCode: "MODEL_AUTH_ERROR",
          errorCategory: "auth",
          originalQuery: "检查本月收入",
          projectId: "project-1",
          executionContext: { connection_id: "connection-1" },
          semanticValidationSelection: [
            {
              entry_id: "entry-1",
              expected_active_revision_id: "revision-1",
            },
          ],
        },
      ],
    });

    await useChatStore.getState().retryMessageWithModel(1, "healthy-service", "zh");

    expect(mocks.stream).toHaveBeenCalledWith(
      "/api/v1/chat/stream",
      expect.objectContaining({
        query: "检查本月收入",
        model: "healthy-service",
        project_id: "project-1",
        connection_id: "connection-1",
        semantic_validation_selection: [
          {
            entry_id: "entry-1",
            expected_active_revision_id: "revision-1",
          },
        ],
      }),
      expect.any(AbortSignal)
    );
    expect(mocks.stream.mock.calls[0][1]).not.toHaveProperty("resume_run_id");
    expect(mocks.stream.mock.calls[0][1]).not.toHaveProperty("conversation_id");
    expect(useChatStore.getState().currentConversationId).toBe(
      "replacement-conversation"
    );
    expect(useChatStore.getState().lastModelId).toBe("healthy-service");
  });

  it("exposes loading and failure state while restoring conversation history", async () => {
    let rejectLoad!: (error: Error) => void;
    mocks.get.mockReturnValue(
      new Promise((_, reject) => {
        rejectLoad = reject;
      })
    );
    useChatStore.setState({ currentConversationId: "conversation-1" });

    const load = useChatStore.getState().loadConversation("conversation-1");
    expect(useChatStore.getState().isConversationLoading).toBe(true);
    expect(useChatStore.getState().conversationLoadError).toBeNull();

    rejectLoad(new Error("network unavailable"));
    await load;

    expect(useChatStore.getState().isConversationLoading).toBe(false);
    expect(useChatStore.getState().conversationLoadError).toContain("无法打开");
  });

  it("restores a conversation and clears its loading error", async () => {
    mocks.get.mockResolvedValue({
      data: {
        data: {
          id: "conversation-1",
          title: "七月复盘",
          model_id: "model-1",
          connection_id: null,
          context_rounds: 5,
          project_id: "project-1",
          status: "active",
          messages: [
            {
              id: "message-1",
              role: "user",
              content: "收入为什么下降？",
              created_at: "2026-07-18T00:00:00Z",
            },
          ],
          created_at: "2026-07-18T00:00:00Z",
          updated_at: "2026-07-18T00:00:00Z",
        },
      },
    });
    useChatStore.setState({
      currentConversationId: "conversation-1",
      conversationLoadError: "旧错误",
    });

    await useChatStore.getState().loadConversation("conversation-1");

    expect(useChatStore.getState().isConversationLoading).toBe(false);
    expect(useChatStore.getState().conversationLoadError).toBeNull();
    expect(useChatStore.getState().messages).toEqual([
      expect.objectContaining({ role: "user", content: "收入为什么下降？" }),
    ]);
    expect(useChatStore.getState().currentConversationMeta?.title).toBe("七月复盘");
  });

  it("rejects a persisted conversation that belongs to another project", async () => {
    mocks.get.mockResolvedValue({
      data: {
        data: {
          id: "conversation-1",
          title: "其他项目的调查",
          project_id: "project-2",
          status: "active",
          messages: [],
          created_at: "2026-07-18T00:00:00Z",
          updated_at: "2026-07-18T00:00:00Z",
        },
      },
    });
    useChatStore.setState({ currentConversationId: "conversation-1" });

    await useChatStore
      .getState()
      .loadConversation("conversation-1", "project-1");

    expect(useChatStore.getState().currentConversationId).toBeNull();
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().conversationLoadError).toContain("不属于当前项目");
  });

  it("saves a late confirmation but does not pull the user back from another investigation", async () => {
    let resolveConfirmation!: (value: unknown) => void;
    mocks.post.mockReturnValue(
      new Promise((resolve) => {
        resolveConfirmation = resolve;
      })
    );
    useChatStore.setState({
      currentConversationId: "origin-conversation",
      lastProjectId: "project-1",
      messages: [
        {
          role: "assistant",
          content: "请选择收入口径",
          analysisRunId: "run-1",
          projectId: "project-1",
          originalQuery: "比较门店收入",
          report: confirmationReport,
        },
      ],
    });

    const confirmation = useChatStore
      .getState()
      .confirmBusinessDefinition("run-1", "revenue_rule", "扣除退款", "zh");
    useChatStore.setState({ currentConversationId: "other-conversation" });
    resolveConfirmation({
      data: {
        data: {
          analysis_run_id: "run-1",
          resume_run_id: "run-1",
          project_id: "project-1",
          conversation_id: "origin-conversation",
          key: "revenue_rule",
          selected_option: "扣除退款",
          ready_to_continue: true,
        },
      },
    });

    await expect(confirmation).rejects.toThrow("你已切换到其他调查");
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(useChatStore.getState().currentConversationId).toBe("other-conversation");
  });

  it("rejects confirmation before saving when busy or outside an available investigation", async () => {
    for (const changed of [{ isLoading: true }, { activeStreamId: "another-stream" }, { currentConversationId: null },
      { messages: [] }, { isConversationLoading: true }, { lastProjectId: "other-project" }]) {
      const { confirm } = confirmationFixture(); useChatStore.setState(changed);
      const error = await confirm().catch(error => error);
      expect(error).toBeInstanceOf(UserFacingError);
      expect(getErrorMessage(error)).toBe(error.message);
    }
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it("locks confirmation across callers and releases the lock after failure for explicit retry", async () => {
    const { response, confirm } = confirmationFixture();
    let reject!: (error: Error) => void;
    mocks.post.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    const first = confirm();
    await expect(confirm()).rejects.toThrow("正在确认一个选择");
    expect(mocks.post).toHaveBeenCalledTimes(1);
    reject(new Error("network failure"));
    await expect(first).rejects.toThrow("network failure");
    mocks.post.mockResolvedValueOnce(response); mocks.stream.mockImplementation(confirmationDoneStream);
    await confirm();
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.stream).toHaveBeenCalledTimes(1);
  });

  it("rejects mismatched confirmation receipts without changing scope or marking a choice confirmed", async () => {
    for (const changed of [null, { analysis_run_id: "other-run" }, { resume_run_id: "other-run" }, { conversation_id: "other-conversation" },
      { project_id: "other-project" }, { selected_option: "保留退款订单" }, { ready_to_continue: false }]) {
      const { response, confirm } = confirmationFixture();
      mocks.post.mockResolvedValueOnce({ data: { data: changed === null ? null : { ...response.data.data, ...changed } } });
      await expect(confirm()).rejects.toThrow("这次调查暂时无法继续");
      expect(useChatStore.getState().currentConversationId).toBe("origin-conversation");
      expect(useChatStore.getState().messages[0].confirmationResolved).toBeUndefined();
    }
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it("does not resume a pending confirmation after a reload or over a newly running investigation", async () => {
    for (const mode of ["reload", "running"] as const) {
      const { message, response, confirm } = confirmationFixture();
      let resolve!: (response: unknown) => void;
      mocks.post.mockReturnValueOnce(new Promise(done => { resolve = done; }));
      const pending = confirm();
      if (mode === "reload") useChatStore.setState({ messages: [{ ...message }] });
      else useChatStore.setState({ activeStreamId: "new-stream" });
      resolve(response);
      await expect(pending).rejects.toThrow(mode === "reload" ? "你已切换到其他调查" : "选择已保存");
      expect(useChatStore.getState().messages[0].confirmationResolved).toBeUndefined();
      expect(useChatStore.getState().activeStreamId).toBe(mode === "running" ? "new-stream" : null);
    }
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it("resumes a valid canonicalized confirmation with the original analysis context", async () => {
    const { response, confirm } = confirmationFixture();
    let resolve!: (response: unknown) => void;
    mocks.post.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    mocks.stream.mockImplementation(confirmationDoneStream);
    const pending = confirm();
    useChatStore.setState({ lastModelId: "model-later", lastConnectionId: "connection-later", lastContextRounds: 9 });
    resolve(response); await pending;
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith("/api/v1/chat/confirm", { analysis_run_id: "run-1", key: "revenue_rule", selected_option: "扣除退款" });
    expect(mocks.stream.mock.calls[0][1]).toMatchObject({ conversation_id: "origin-conversation", project_id: "project-1", resume_run_id: "run-1",
      model: "model-original", connection_id: "connection-original", context_rounds: "4", language: "zh" });
    expect(useChatStore.getState().messages[0].confirmationResolved).toBe("扣除退款");
    expect(useChatStore.getState().messages.at(-1)?.originalQuery).toBe("比较门店收入");
  });

  it("confirms only the matching question in a multi-question run without rewriting previous receipts", async () => {
    const { message, response, confirm } = confirmationFixture();
    const report = { status: "waiting_confirmation" as const, title: "请选择", summary: "请选择", metrics: [], findings: [], evidence: [], follow_ups: [],
      confirmation: { key: "revenue_rule", question: "退款如何处理？", reason: "影响收入", options: ["扣除退款", "保留退款订单"] } };
    const previous = { ...message, id: "previous", confirmationResolved: "全部门店", report: { ...report, confirmation: { ...report.confirmation, key: "store_scope", options: ["全部门店"] } } };
    const current = { ...message, id: "current", report };
    useChatStore.setState({ messages: [previous, current] });
    await expect(useChatStore.getState().confirmBusinessDefinition("run-1", "revenue_rule", "不在选项内", "zh")).rejects.toThrow("暂时无法继续");
    expect(mocks.post).not.toHaveBeenCalled();
    mocks.post.mockResolvedValueOnce(response); mocks.stream.mockImplementation(confirmationDoneStream);
    await confirm();
    const saved = useChatStore.getState().messages;
    expect(saved[0]).toBe(previous);
    expect(saved[0].confirmationResolved).toBe("全部门店");
    expect(saved[1].confirmationResolved).toBe("扣除退款");
    expect(mocks.stream).toHaveBeenCalledTimes(1);
  });

  it("restores confirmation history without spreading the last answer across the run", async () => {
    const id = "d74f7238-64f7-4566-aec1-351105691620";
    useChatStore.setState({ currentConversationId: id });
    const question = (messageId: string, key: string) => ({ id: messageId, role: "assistant", content: "请选择", created_at: "2026-09-07T00:00:00Z",
      metadata: { project_id: "project-1", analysis_run_id: "run-1", report: { ...confirmationReport, confirmation: { ...confirmationReport.confirmation, key } } } });
    mocks.get.mockResolvedValueOnce({ data: { data: { id, project_id: "project-1", messages: [question("q1", "revenue_rule"),
      { id: "receipt", role: "user", content: "扣除退款", created_at: "2026-09-07T00:00:01Z", metadata: {
        kind: "business_confirmation", project_id: "project-1", analysis_run_id: "run-1", confirmation_key: "revenue_rule", selected_option: "扣除退款" } },
      question("q2", "store_scope")],
    } } });
    await useChatStore.getState().loadConversation(id, "project-1");
    expect(useChatStore.getState().messages.map(message => message.confirmationResolved)).toEqual(["扣除退款", undefined, undefined]);
    expect(useChatStore.getState().conversationLoadError).toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });
});
