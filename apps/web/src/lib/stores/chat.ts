import { create } from "zustand";
import { api, createEventSource } from "@/lib/api/client";
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
}

interface ChatState {
  messages: Message[];
  currentConversationId: string | null;
  isLoading: boolean;
  eventSource: EventSource | null;
  sendMessage: (query: string, connectionId?: string | null, modelId?: string | null) => Promise<void>;
  stopGeneration: () => void;
  setCurrentConversation: (id: string) => void;
  clearConversation: () => void;
  loadConversation: (id: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  currentConversationId: null,
  isLoading: false,
  eventSource: null,

  sendMessage: async (query: string, connectionId?: string | null, modelId?: string | null) => {
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

      const eventSource = createEventSource("/api/v1/chat/stream", params);
      set({ eventSource });

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const { messages } = get();
          const lastIndex = messages.length - 1;

          if (data.type === "progress") {
            // 更新状态
            set({
              messages: messages.map((msg, idx) =>
                idx === lastIndex
                  ? { ...msg, status: data.data.message }
                  : msg
              ),
            });
          } else if (data.type === "result") {
            // 更新结果
            set({
              messages: messages.map((msg, idx) =>
                idx === lastIndex
                  ? {
                      ...msg,
                      content: data.data.content || "",
                      sql: data.data.sql,
                      data: data.data.data,
                      isLoading: false,
                      status: undefined,
                    }
                  : msg
              ),
            });
          } else if (data.type === "thinking") {
            // 更新思考阶段
            set({
              messages: messages.map((msg, idx) =>
                idx === lastIndex
                  ? { ...msg, thinkingStage: data.data.stage, status: data.data.stage }
                  : msg
              ),
            });
          } else if (data.type === "visualization") {
            // 更新可视化
            set({
              messages: messages.map((msg, idx) =>
                idx === lastIndex
                  ? { ...msg, visualization: data.data.chart }
                  : msg
              ),
            });
          } else if (data.type === "python_output") {
            // 更新 Python 输出
            set({
              messages: messages.map((msg, idx) =>
                idx === lastIndex
                  ? {
                      ...msg,
                      pythonOutput: (msg.pythonOutput || "") + data.data.output,
                    }
                  : msg
              ),
            });
          } else if (data.type === "python_image") {
            // 添加 Python 图表
            set({
              messages: messages.map((msg, idx) =>
                idx === lastIndex
                  ? {
                      ...msg,
                      pythonImages: [...(msg.pythonImages || []), data.data.image],
                    }
                  : msg
              ),
            });
          } else if (data.type === "error") {
            // 错误
            set({
              messages: messages.map((msg, idx) =>
                idx === lastIndex
                  ? {
                      ...msg,
                      content: `错误: ${data.data.message}`,
                      isLoading: false,
                      status: undefined,
                    }
                  : msg
              ),
              isLoading: false,
            });
            eventSource.close();
          } else if (data.type === "done") {
            // 完成
            if (data.data.conversation_id) {
              set({ currentConversationId: data.data.conversation_id });
            }
            set({ isLoading: false });
            eventSource.close();
          }
        } catch (e) {
          console.error("Failed to parse event", e);
        }
      };

      eventSource.onerror = () => {
        const { messages } = get();
        const lastIndex = messages.length - 1;

        set({
          messages: messages.map((msg, idx) =>
            idx === lastIndex && msg.isLoading
              ? { ...msg, content: "连接失败", isLoading: false }
              : msg
          ),
          isLoading: false,
        });
        eventSource.close();
      };
    } catch (error: unknown) {
      const { messages } = get();
      const lastIndex = messages.length - 1;

      set({
        messages: messages.map((msg, idx) =>
          idx === lastIndex
            ? { ...msg, content: `请求失败: ${getErrorMessage(error)}`, isLoading: false }
            : msg
        ),
        isLoading: false,
      });
    }
  },

  stopGeneration: () => {
    const { eventSource, currentConversationId } = get();

    if (eventSource) {
      eventSource.close();
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
      eventSource: null,
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
      }));

      set({ messages, currentConversationId: id });
    } catch (error) {
      console.error("Failed to load conversation", error);
    }
  },
}));
