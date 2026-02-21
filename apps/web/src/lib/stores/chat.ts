import { create } from "zustand";
import { api, createSecureEventStream } from "@/lib/api/client";
import type { DataRow, Visualization, APIMessage } from "@/lib/types/api";
import { getErrorMessage } from "@/lib/types/api";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  isLoading?: boolean;
  status?: string;
  thinkingStage?: string; // 思考阶段
  sql?: string;
  visualization?: Visualization;
  data?: DataRow[];
  pythonOutput?: string; // Python 输出
  pythonImages?: string[]; // Python 图表 (base64)
  // 错误状态
  hasError?: boolean;
  errorMessage?: string;
  canRetry?: boolean;
  originalQuery?: string; // 用于重试
}

interface ChatState {
  messages: Message[];
  currentConversationId: string | null;
  isLoading: boolean;
  abortController: AbortController | null;
  lastConnectionId: string | null; // 保存上次使用的连接 ID
  lastModelId: string | null; // 保存上次使用的模型 ID
  sendMessage: (query: string, connectionId?: string | null, modelId?: string | null) => Promise<void>;
  stopGeneration: () => void;
  setCurrentConversation: (id: string) => void;
  clearConversation: () => void;
  loadConversation: (id: string) => Promise<void>;
  retryMessage: (messageIndex: number) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  currentConversationId: null,
  isLoading: false,
  abortController: null,
  lastConnectionId: null,
  lastModelId: null,

  sendMessage: async (query: string, connectionId?: string | null, modelId?: string | null) => {
    // 保存连接信息用于重试
    if (connectionId) set({ lastConnectionId: connectionId });
    if (modelId) set({ lastModelId: modelId });
    const { currentConversationId } = get();

    // 添加用户消息
    set((state) => ({
      messages: [...state.messages, { role: "user", content: query }],
      isLoading: true,
    }));

    // 添加助手占位消息
    set((state) => ({
      messages: [
        ...state.messages,
        { role: "assistant", content: "", isLoading: true, status: "正在分析..." },
      ],
    }));

    try {
      // 创建 SSE 连接
      const params: Record<string, string> = {
        query,
        language: "zh",
      };

      if (currentConversationId) {
        params.conversation_id = currentConversationId;
      }

      if (connectionId) {
        params.connection_id = connectionId;
      }

      if (modelId) {
        params.model = modelId;
      }

      const controller = new AbortController();
      set({ abortController: controller });

      for await (const event of createSecureEventStream(
        "/api/v1/chat/stream",
        params,
        controller.signal
      )) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = event.data as { type: string; data: any };
        const { messages } = get();
        const lastIndex = messages.length - 1;

        if (data.type === "progress") {
          set({ messages: messages.map((msg, idx) =>
            idx === lastIndex ? { ...msg, status: data.data.message } : msg
          )});
        } else if (data.type === "result") {
          set({ messages: messages.map((msg, idx) =>
            idx === lastIndex ? {
              ...msg,
              content: data.data.content || "",
              sql: data.data.sql,
              data: data.data.data,
              isLoading: false,
              status: undefined,
            } : msg
          )});
        } else if (data.type === "thinking") {
          set({ messages: messages.map((msg, idx) =>
            idx === lastIndex ? { ...msg, thinkingStage: data.data.stage, status: data.data.stage } : msg
          )});
        } else if (data.type === "visualization") {
          set({ messages: messages.map((msg, idx) =>
            idx === lastIndex ? { ...msg, visualization: data.data.chart } : msg
          )});
        } else if (data.type === "python_output") {
          set({ messages: messages.map((msg, idx) =>
            idx === lastIndex ? { ...msg, pythonOutput: (msg.pythonOutput || "") + data.data.output } : msg
          )});
        } else if (data.type === "python_image") {
          set({ messages: messages.map((msg, idx) =>
            idx === lastIndex ? { ...msg, pythonImages: [...(msg.pythonImages || []), data.data.image] } : msg
          )});
        } else if (data.type === "error") {
          const { messages: cur } = get();
          const last = cur.length - 1;
          set({
            messages: cur.map((msg, idx) => idx === last ? {
              ...msg, content: msg.content || "",
              hasError: true, errorMessage: data.data.message,
              canRetry: true, originalQuery: query,
              isLoading: false, status: undefined,
            } : msg),
            isLoading: false, abortController: null,
          });
          return;
        } else if (data.type === "done") {
          if (data.data.conversation_id) {
            set({ currentConversationId: data.data.conversation_id });
          }
          set({ isLoading: false, abortController: null });
          return;
        }
      }
      // generator 正常结束（流关闭）
      set({ isLoading: false, abortController: null });
    } catch (error: unknown) {
      // AbortError = 用户主动停止，静默处理
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      const { messages } = get();
      const lastIndex = messages.length - 1;
      set({
        messages: messages.map((msg, idx) =>
          idx === lastIndex ? {
            ...msg, content: msg.content || "",
            hasError: true, errorMessage: getErrorMessage(error),
            canRetry: true, originalQuery: query,
            isLoading: false, status: undefined,
          } : msg
        ),
        isLoading: false, abortController: null,
      });
    }
  },

  stopGeneration: () => {
    const { abortController, currentConversationId } = get();

    if (abortController) {
      abortController.abort();
    }

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
    get().loadConversation(id);
  },

  clearConversation: () => {
    set({
      messages: [],
      currentConversationId: null,
    });
  },

  loadConversation: async (id: string) => {
    try {
      const response = await api.get(`/api/v1/conversations/${id}`);
      const conversation = response.data.data;

      const messages: Message[] = conversation.messages.map((msg: APIMessage) => ({
        role: msg.role,
        content: msg.content,
        sql: msg.metadata?.sql,
        visualization: msg.metadata?.visualization,
        data: msg.metadata?.data,
        pythonOutput: msg.metadata?.python_output,
        pythonImages: msg.metadata?.python_images,
      }));

      set({ messages, currentConversationId: id });
    } catch (error) {
      console.error("Failed to load conversation", error);
    }
  },

  retryMessage: async (messageIndex: number) => {
    const { messages, lastConnectionId, lastModelId } = get();
    const errorMsg = messages[messageIndex];

    // 检查是否可以重试
    if (!errorMsg?.canRetry || !errorMsg.originalQuery) {
      console.error("Cannot retry this message");
      return;
    }

    const query = errorMsg.originalQuery;

    // 移除错误消息（保留用户消息）
    // 找到对应的用户消息索引（应该是 messageIndex - 1）
    const userMsgIndex = messageIndex - 1;
    if (userMsgIndex >= 0 && messages[userMsgIndex]?.role === "user") {
      // 移除用户消息和错误的助手消息
      set({
        messages: messages.slice(0, userMsgIndex),
      });
    } else {
      // 只移除错误消息
      set({
        messages: messages.slice(0, messageIndex),
      });
    }

    // 重新发送
    await get().sendMessage(query, lastConnectionId, lastModelId);
  },
}));
