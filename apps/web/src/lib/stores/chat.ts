"use client";

import { create } from "zustand";
import { api, createSecureEventStream } from "@/lib/api/client";
import type {
  AgentTraceEntry,
  APIMessage,
  Conversation,
  DataRow,
  ExecutionContextSummary,
  Visualization,
} from "@/lib/types/api";
import { getErrorMessage } from "@/lib/types/api";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  isLoading?: boolean;
  status?: string;
  thinkingStage?: string;
  sql?: string;
  visualization?: Visualization;
  data?: DataRow[];
  pythonOutput?: string;
  pythonImages?: string[];
  executionTime?: number;
  rowsCount?: number;
  executionContext?: ExecutionContextSummary;
  diagnostics?: AgentTraceEntry[];
  hasError?: boolean;
  errorMessage?: string;
  errorCode?: string;
  errorCategory?: string;
  canRetry?: boolean;
  originalQuery?: string;
}

interface ChatState {
  messages: Message[];
  currentConversationId: string | null;
  currentConversationMeta: Conversation | null;
  isLoading: boolean;
  abortController: AbortController | null;
  lastConnectionId: string | null;
  lastModelId: string | null;
  lastContextRounds: number | null;
  sendMessage: (
    query: string,
    connectionId?: string | null,
    modelId?: string | null,
    contextRounds?: number | null
  ) => Promise<void>;
  stopGeneration: () => void;
  setCurrentConversation: (id: string) => void;
  clearConversation: () => void;
  loadConversation: (id: string) => Promise<void>;
  retryMessage: (messageIndex: number) => Promise<void>;
  rerunMessage: (messageIndex: number) => Promise<void>;
}

function mapApiMessage(msg: APIMessage): Message {
  return {
    role: msg.role,
    content: msg.content,
    sql: msg.metadata?.sql,
    visualization: msg.metadata?.visualization,
    data: msg.metadata?.data,
    pythonOutput: msg.metadata?.python_output,
    pythonImages: msg.metadata?.python_images,
    executionTime: msg.metadata?.execution_time,
    rowsCount: msg.metadata?.rows_count,
    executionContext: msg.metadata?.execution_context,
    diagnostics: msg.metadata?.diagnostics,
    hasError: Boolean(msg.metadata?.error || msg.metadata?.error_code),
    errorMessage: msg.metadata?.error,
    errorCode: msg.metadata?.error_code,
    errorCategory: msg.metadata?.error_category,
    canRetry: Boolean(msg.metadata?.error || msg.metadata?.error_code),
    originalQuery: msg.metadata?.original_query,
  };
}

function mergeExecutionContext(
  current?: ExecutionContextSummary,
  incoming?: ExecutionContextSummary
): ExecutionContextSummary | undefined {
  if (!current && !incoming) return undefined;
  return {
    ...(current || {}),
    ...(incoming || {}),
  };
}

function mergeDiagnostics(
  current?: AgentTraceEntry[],
  incoming?: AgentTraceEntry[]
): AgentTraceEntry[] | undefined {
  const combined = [...(current || []), ...(incoming || [])];
  if (!combined.length) return undefined;

  const seen = new Set<string>();
  return combined.filter((entry) => {
    const marker = JSON.stringify([
      entry.attempt ?? null,
      entry.phase ?? null,
      entry.status ?? null,
      entry.message ?? null,
    ]);
    if (seen.has(marker)) return false;
    seen.add(marker);
    return true;
  });
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  currentConversationId: null,
  currentConversationMeta: null,
  isLoading: false,
  abortController: null,
  lastConnectionId: null,
  lastModelId: null,
  lastContextRounds: null,

  sendMessage: async (
    query: string,
    connectionId?: string | null,
    modelId?: string | null,
    contextRounds?: number | null
  ) => {
    if (connectionId) set({ lastConnectionId: connectionId });
    if (modelId) set({ lastModelId: modelId });
    if (contextRounds) set({ lastContextRounds: contextRounds });

    const { currentConversationId } = get();
    const pendingContext: ExecutionContextSummary = {
      connection_id: connectionId || undefined,
      model_id: modelId || undefined,
      context_rounds: contextRounds || undefined,
    };

    set((state) => ({
      messages: [...state.messages, { role: "user", content: query }],
      isLoading: true,
    }));

    set((state) => ({
      messages: [
        ...state.messages,
        {
          role: "assistant",
          content: "",
          isLoading: true,
          status: "正在分析...",
          executionContext: pendingContext,
          diagnostics: [],
        },
      ],
    }));

    try {
      const params: Record<string, string> = {
        query,
        language: "zh",
      };

      if (currentConversationId) params.conversation_id = currentConversationId;
      if (connectionId) params.connection_id = connectionId;
      if (modelId) params.model = modelId;
      if (contextRounds) params.context_rounds = String(contextRounds);

      const controller = new AbortController();
      set({ abortController: controller });

      for await (const event of createSecureEventStream(
        "/api/v1/chat/stream",
        params,
        controller.signal
      )) {
        const data = event.data as { type: string; data: Record<string, unknown> };
        const { messages } = get();
        const lastIndex = messages.length - 1;

        if (data.type === "progress") {
          const executionContext = data.data.execution_context as ExecutionContextSummary | undefined;
          const diagnosticEntry = data.data.diagnostic_entry as AgentTraceEntry | undefined;
          if (typeof data.data.conversation_id === "string") {
            set({ currentConversationId: data.data.conversation_id });
          }
          set({
            messages: messages.map((msg, idx) =>
              idx === lastIndex
                ? {
                    ...msg,
                    status: String(data.data.message || ""),
                    executionContext: mergeExecutionContext(msg.executionContext, executionContext),
                    diagnostics: mergeDiagnostics(
                      msg.diagnostics,
                      diagnosticEntry ? [diagnosticEntry] : undefined
                    ),
                  }
                : msg
            ),
          });
        } else if (data.type === "result") {
          const executionContext = data.data.execution_context as ExecutionContextSummary | undefined;
          const diagnostics = data.data.diagnostics as AgentTraceEntry[] | undefined;
          set({
            messages: messages.map((msg, idx) =>
              idx === lastIndex
                ? {
                    ...msg,
                    content: String(data.data.content || ""),
                    sql: (data.data.sql as string | undefined) || msg.sql,
                    data: (data.data.data as DataRow[] | undefined) || msg.data,
                    executionTime:
                      (data.data.execution_time as number | undefined) || msg.executionTime,
                    rowsCount: (data.data.rows_count as number | undefined) || msg.rowsCount,
                    executionContext: mergeExecutionContext(msg.executionContext, executionContext),
                    diagnostics: mergeDiagnostics(msg.diagnostics, diagnostics),
                    isLoading: false,
                    status: undefined,
                  }
                : msg
            ),
          });
        } else if (data.type === "thinking") {
          set({
            messages: messages.map((msg, idx) =>
              idx === lastIndex
                ? {
                    ...msg,
                    thinkingStage: String(data.data.stage || ""),
                    status: String(data.data.stage || ""),
                  }
                : msg
            ),
          });
        } else if (data.type === "visualization") {
          set({
            messages: messages.map((msg, idx) =>
              idx === lastIndex
                ? { ...msg, visualization: data.data.chart as Visualization | undefined }
                : msg
            ),
          });
        } else if (data.type === "python_output") {
          set({
            messages: messages.map((msg, idx) =>
              idx === lastIndex
                ? {
                    ...msg,
                    pythonOutput: (msg.pythonOutput || "") + String(data.data.output || ""),
                  }
                : msg
            ),
          });
        } else if (data.type === "python_image") {
          set({
            messages: messages.map((msg, idx) =>
              idx === lastIndex
                ? {
                    ...msg,
                    pythonImages: [...(msg.pythonImages || []), String(data.data.image || "")],
                  }
                : msg
            ),
          });
        } else if (data.type === "error") {
          const executionContext = data.data.execution_context as ExecutionContextSummary | undefined;
          const diagnostics = data.data.diagnostics as AgentTraceEntry[] | undefined;
          if (typeof data.data.conversation_id === "string") {
            set({ currentConversationId: data.data.conversation_id });
          }
          const { messages: cur } = get();
          const last = cur.length - 1;
          set({
            messages: cur.map((msg, idx) =>
              idx === last
                ? {
                    ...msg,
                    content: msg.content || "",
                    hasError: true,
                    errorMessage: String(data.data.message || "执行失败"),
                    errorCode: String(data.data.code || "EXECUTION_ERROR"),
                    errorCategory:
                      typeof data.data.error_category === "string"
                        ? data.data.error_category
                        : undefined,
                    canRetry: true,
                    originalQuery: query,
                    executionContext: mergeExecutionContext(msg.executionContext, executionContext),
                    diagnostics: mergeDiagnostics(msg.diagnostics, diagnostics),
                    isLoading: false,
                    status: undefined,
                  }
                : msg
            ),
            isLoading: false,
            abortController: null,
          });
          return;
        } else if (data.type === "done") {
          if (typeof data.data.conversation_id === "string") {
            set({ currentConversationId: data.data.conversation_id });
          }
          set({ isLoading: false, abortController: null });
          return;
        }
      }

      set({ isLoading: false, abortController: null });
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      const { messages } = get();
      const lastIndex = messages.length - 1;
      set({
        messages: messages.map((msg, idx) =>
          idx === lastIndex
            ? {
                ...msg,
                content: msg.content || "",
                hasError: true,
                errorMessage: getErrorMessage(error),
                errorCode: "CLIENT_ERROR",
                errorCategory: "client",
                canRetry: true,
                originalQuery: query,
                isLoading: false,
                status: undefined,
              }
            : msg
        ),
        isLoading: false,
        abortController: null,
      });
    }
  },

  stopGeneration: () => {
    const { abortController, currentConversationId } = get();

    if (abortController) abortController.abort();
    if (currentConversationId) {
      api.post("/api/v1/chat/stop", { conversation_id: currentConversationId });
    }

    const { messages } = get();
    const lastIndex = messages.length - 1;

    set({
      messages: messages.map((msg, idx) =>
        idx === lastIndex && msg.isLoading
          ? { ...msg, content: msg.content || "已停止", isLoading: false }
          : msg
      ),
      isLoading: false,
      abortController: null,
    });
  },

  setCurrentConversation: (id: string) => {
    set({ currentConversationId: id });
    void get().loadConversation(id);
  },

  clearConversation: () => {
    set({
      messages: [],
      currentConversationId: null,
      currentConversationMeta: null,
    });
  },

  loadConversation: async (id: string) => {
    try {
      const response = await api.get(`/api/v1/conversations/${id}`);
      const conversation = response.data.data as Conversation;

      set({
        messages: conversation.messages.map(mapApiMessage),
        currentConversationId: id,
        currentConversationMeta: conversation,
        lastModelId: conversation.model_id || null,
        lastConnectionId: conversation.connection_id || null,
        lastContextRounds: conversation.context_rounds || null,
      });
    } catch (error) {
      console.error("Failed to load conversation", error);
    }
  },

  retryMessage: async (messageIndex: number) => {
    const { messages } = get();
    const errorMsg = messages[messageIndex];
    if (!errorMsg?.canRetry || !errorMsg.originalQuery) {
      console.error("Cannot retry this message");
      return;
    }

    const executionContext = errorMsg.executionContext;
    const userMsgIndex = messageIndex - 1;
    if (userMsgIndex >= 0 && messages[userMsgIndex]?.role === "user") {
      set({ messages: messages.slice(0, userMsgIndex) });
    } else {
      set({ messages: messages.slice(0, messageIndex) });
    }

    await get().sendMessage(
      errorMsg.originalQuery,
      executionContext?.connection_id || get().lastConnectionId,
      executionContext?.model_id || get().lastModelId,
      executionContext?.context_rounds || get().lastContextRounds
    );
  },

  rerunMessage: async (messageIndex: number) => {
    const { messages, lastConnectionId, lastModelId, lastContextRounds } = get();
    const message = messages[messageIndex];
    const previousUserMessage = messages[messageIndex - 1];
    const query =
      message.originalQuery ||
      (previousUserMessage?.role === "user" ? previousUserMessage.content : null);

    if (!query) {
      console.error("Cannot rerun this message");
      return;
    }

    await get().sendMessage(
      query,
      message.executionContext?.connection_id || lastConnectionId,
      message.executionContext?.model_id || lastModelId,
      message.executionContext?.context_rounds || lastContextRounds
    );
  },
}));
