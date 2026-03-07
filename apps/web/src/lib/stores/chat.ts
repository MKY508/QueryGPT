"use client";

import { create } from "zustand";
import { api, createSecureEventStream } from "@/lib/api/client";
import type { Conversation, SSEEventData } from "@/lib/types/api";
import {
  applyClientError,
  applyStreamErrorEvent,
  applyStreamEvent,
  buildPendingAssistantMessage,
  mapApiMessage,
  markStoppedMessage,
} from "@/lib/stores/chat-helpers";
import type { ChatMessage } from "@/lib/types/chat";

interface ChatState {
  messages: ChatMessage[];
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
    if (typeof contextRounds === "number") set({ lastContextRounds: contextRounds });

    const { currentConversationId } = get();
    const pendingContext = {
      connection_id: connectionId || undefined,
      model_id: modelId || undefined,
      context_rounds: contextRounds || undefined,
    };

    set((state) => ({
      messages: [
        ...state.messages,
        { role: "user", content: query },
        buildPendingAssistantMessage(pendingContext),
      ],
      isLoading: true,
    }));

    try {
      const params: Record<string, string> = {
        query,
        language: "zh",
      };

      if (currentConversationId) params.conversation_id = currentConversationId;
      if (connectionId) params.connection_id = connectionId;
      if (modelId) params.model = modelId;
      if (typeof contextRounds === "number") {
        params.context_rounds = String(contextRounds);
      }

      const controller = new AbortController();
      set({ abortController: controller });

      for await (const event of createSecureEventStream(
        "/api/v1/chat/stream",
        params,
        controller.signal
      )) {
        const payload = event;

        const conversationId = getConversationId(payload);
        if (conversationId) {
          set({ currentConversationId: conversationId });
        }

        if (payload.type === "error") {
          set((state) => ({
            messages: applyStreamErrorEvent(state.messages, payload, query),
            isLoading: false,
            abortController: null,
          }));
          return;
        }

        if (payload.type === "done") {
          set({ isLoading: false, abortController: null });
          return;
        }

        set((state) => ({
          messages: applyStreamEvent(state.messages, payload),
        }));
      }

      set({ isLoading: false, abortController: null });
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      set((state) => ({
        messages: applyClientError(state.messages, query, error),
        isLoading: false,
        abortController: null,
      }));
    }
  },

  stopGeneration: () => {
    const { abortController, currentConversationId } = get();

    if (abortController) abortController.abort();
    if (currentConversationId) {
      api.post("/api/v1/chat/stop", { conversation_id: currentConversationId });
    }

    set((state) => ({
      messages: markStoppedMessage(state.messages),
      isLoading: false,
      abortController: null,
    }));
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

function getConversationId(payload: SSEEventData): string | null {
  if (
    "conversation_id" in payload.data &&
    typeof payload.data.conversation_id === "string"
  ) {
    return payload.data.conversation_id;
  }
  return null;
}
