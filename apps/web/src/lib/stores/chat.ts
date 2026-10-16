"use client";

import { create } from "zustand";
import { api, createSecureEventStream } from "@/lib/api/client";
import type {
  BusinessConfirmationResponse,
  Conversation,
  SSEEventData,
} from "@/lib/types/api";
import { UserFacingError } from "@/lib/types/api";
import {
  applyClientError,
  applyStreamErrorEvent,
  applyStreamEvent,
  buildPendingAssistantMessage,
  finalizeStreamMessage,
  getInvestigationErrorRecovery,
  mapConversationMessages,
  markStoppedMessage,
} from "@/lib/stores/chat-helpers";
import type { ChatMessage } from "@/lib/types/chat";
import { runtimeMessage } from "@/i18n/runtime";

// Confirmation changes business definitions. Share the pending boundary across
// message cards; never queue a second decision behind the first one.
const confirmingConversations = new Set<string>();

export interface AnalysisSettlement {
  id: string;
  streamId: string;
  projectId: string | null;
  outcome: "completed" | "failed" | "stopped";
}

export interface SemanticValidationSelection {
  entry_id: string;
  expected_active_revision_id: string;
}

export const CONVERSATION_CONTINUITY_STORAGE_KEY =
  "receiptbi-current-conversations";
const CONVERSATION_CONTINUITY_CHANGED = "receiptbi-conversation-continuity-changed";

type ConversationContinuityStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

interface StoredConversationContinuity {
  version: 1;
  conversations: Record<string, string>;
}

export function normalizeConversationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(normalized) &&
    !["__proto__", "constructor", "prototype"].includes(normalized)
    ? normalized
    : null;
}

function continuityStorage(
  storage?: ConversationContinuityStorage
): ConversationContinuityStorage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Some embedded/private browser contexts deny access to the getter itself.
    return null;
  }
}

export function subscribeToConversationContinuity(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if ((event.key === CONVERSATION_CONTINUITY_STORAGE_KEY || event.key === null)
      && (!event.storageArea || event.storageArea === continuityStorage())) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CONVERSATION_CONTINUITY_CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CONVERSATION_CONTINUITY_CHANGED, onChange);
  };
}

function readConversationContinuity(
  storage?: ConversationContinuityStorage
): StoredConversationContinuity {
  const target = continuityStorage(storage);
  if (!target) return { version: 1, conversations: {} };
  try {
    const raw = target.getItem(CONVERSATION_CONTINUITY_STORAGE_KEY);
    if (!raw) return { version: 1, conversations: {} };
    const parsed = JSON.parse(raw) as Partial<StoredConversationContinuity>;
    if (
      parsed.version !== 1 ||
      !parsed.conversations ||
      typeof parsed.conversations !== "object" ||
      Array.isArray(parsed.conversations)
    ) {
      return { version: 1, conversations: {} };
    }
    const conversations = Object.fromEntries(
      Object.entries(parsed.conversations).flatMap(([projectId, conversationId]) => {
        const safeProjectId = normalizeConversationId(projectId);
        const safeConversationId = normalizeConversationId(conversationId);
        return safeProjectId && safeConversationId
          ? [[safeProjectId, safeConversationId]]
          : [];
      })
    );
    return { version: 1, conversations };
  } catch {
    return { version: 1, conversations: {} };
  }
}

export function storedConversationIdForProject(
  projectId: string,
  storage?: ConversationContinuityStorage
): string | null {
  const safeProjectId = normalizeConversationId(projectId);
  if (!safeProjectId) return null;
  return readConversationContinuity(storage).conversations[safeProjectId] || null;
}

export function rememberConversationForProject(
  projectId: string,
  conversationId: string,
  storage?: ConversationContinuityStorage
): void {
  const safeProjectId = normalizeConversationId(projectId);
  const safeConversationId = normalizeConversationId(conversationId);
  const target = continuityStorage(storage);
  if (!safeProjectId || !safeConversationId || !target) return;
  const continuity = readConversationContinuity(target);
  if (continuity.conversations[safeProjectId] === safeConversationId) return;
  continuity.conversations[safeProjectId] = safeConversationId;
  try {
    target.setItem(CONVERSATION_CONTINUITY_STORAGE_KEY, JSON.stringify(continuity));
    if (!storage) window.dispatchEvent(new Event(CONVERSATION_CONTINUITY_CHANGED));
  } catch {
    // Continuity is a convenience. Blocked storage must not block an investigation.
  }
}

export function forgetConversationForProject(
  projectId: string,
  storage?: ConversationContinuityStorage
): void {
  const safeProjectId = normalizeConversationId(projectId);
  const target = continuityStorage(storage);
  if (!safeProjectId || !target) return;
  const continuity = readConversationContinuity(target);
  if (!Object.prototype.hasOwnProperty.call(continuity.conversations, safeProjectId)) {
    return;
  }
  delete continuity.conversations[safeProjectId];
  try {
    if (Object.keys(continuity.conversations).length) {
      target.setItem(CONVERSATION_CONTINUITY_STORAGE_KEY, JSON.stringify(continuity));
    } else {
      target.removeItem(CONVERSATION_CONTINUITY_STORAGE_KEY);
    }
    if (!storage) window.dispatchEvent(new Event(CONVERSATION_CONTINUITY_CHANGED));
  } catch {
    // A failed cleanup is safer than preventing the user from starting over.
  }
}

interface ChatState {
  messages: ChatMessage[];
  currentConversationId: string | null;
  currentConversationMeta: Conversation | null;
  isLoading: boolean;
  isConversationLoading: boolean;
  conversationLoadError: string | null;
  abortController: AbortController | null;
  activeStreamId: string | null;
  stopRequestedStreamId: string | null;
  lastConnectionId: string | null;
  lastModelId: string | null;
  lastContextRounds: number | null;
  lastProjectId: string | null;
  lastLanguage: string | null;
  pendingAnalysisSettlements: AnalysisSettlement[];
  sendMessage: (
    query: string,
    connectionId?: string | null,
    modelId?: string | null,
    contextRounds?: number | null,
    language?: string,
    projectId?: string | null,
    resumeRunId?: string | null,
    originalQueryOverride?: string | null,
    conversationIdOverride?: string | null,
    correctionId?: string | null,
    semanticValidationSelection?: readonly SemanticValidationSelection[] | null
  ) => Promise<void>;
  resumePreparedRun: (
    prepared: {
      query: string;
      projectId: string;
      runId: string;
      conversationId: string;
    },
    modelId?: string | null,
    contextRounds?: number | null,
    language?: string
  ) => Promise<void>;
  confirmBusinessDefinition: (
    analysisRunId: string,
    key: string,
    selectedOption: string,
    language?: string
  ) => Promise<void>;
  stopGeneration: () => void;
  setCurrentConversation: (id: string, expectedProjectId?: string | null) => void;
  clearConversation: (options?: {
    forget?: boolean;
    projectId?: string | null;
  }) => void;
  loadConversation: (id: string, expectedProjectId?: string | null) => Promise<void>;
  retryMessage: (messageIndex: number, language?: string) => Promise<void>;
  retryMessageWithModel: (
    messageIndex: number,
    modelId: string,
    language?: string
  ) => Promise<void>;
  rerunMessage: (messageIndex: number, language?: string) => Promise<void>;
  acknowledgeAnalysisSettlement: (id: string) => void;
}

function settleActiveStream(
  state: ChatState,
  streamId: string,
  messages: ChatMessage[],
  projectId: string | null,
  outcome: AnalysisSettlement["outcome"]
): Partial<ChatState> {
  if (state.activeStreamId !== streamId) return { messages };
  const messageProjectId = messages.find((message) => message.streamId === streamId)?.projectId;
  return {
    messages,
    isLoading: false,
    abortController: null,
    activeStreamId: null,
    stopRequestedStreamId: null,
    pendingAnalysisSettlements: [
      ...state.pendingAnalysisSettlements,
      {
        id: streamId,
        streamId,
        projectId: messageProjectId || projectId || state.lastProjectId,
        outcome,
      },
    ],
  };
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  currentConversationId: null,
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

  sendMessage: async (
    query: string,
    connectionId?: string | null,
    modelId?: string | null,
    contextRounds?: number | null,
    language?: string,
    projectId?: string | null,
    resumeRunId?: string | null,
    originalQueryOverride?: string | null,
    conversationIdOverride?: string | null,
    correctionId?: string | null,
    semanticValidationSelection?: readonly SemanticValidationSelection[] | null
  ) => {
    if (get().isLoading || get().activeStreamId) {
      throw new Error(runtimeMessage("analysisAlreadyRunning"));
    }

    if (connectionId !== undefined) set({ lastConnectionId: connectionId });
    if (modelId) set({ lastModelId: modelId });
    if (typeof contextRounds === "number") set({ lastContextRounds: contextRounds });
    if (projectId) set({ lastProjectId: projectId });
    if (language) set({ lastLanguage: language });

    const currentConversationId = conversationIdOverride ?? get().currentConversationId;
    if (conversationIdOverride) {
      set({ currentConversationId: conversationIdOverride });
    }
    const pendingContext = {
      connection_id: connectionId || undefined,
      model_id: modelId || undefined,
      context_rounds: contextRounds || undefined,
      project_id: projectId || undefined,
    };

    const streamId = `stream-${
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`
    }`;
    const originalQuery = originalQueryOverride || query;
    const preservedValidationSelection = semanticValidationSelection?.map((item) => ({
      entry_id: item.entry_id,
      expected_active_revision_id: item.expected_active_revision_id,
    }));

    set((state) => ({
      messages: [
        ...state.messages,
        { role: "user", content: query },
        {
          ...buildPendingAssistantMessage(pendingContext, streamId, resumeRunId),
          originalQuery,
          semanticValidationSelection: preservedValidationSelection,
        },
      ],
      isLoading: true,
      activeStreamId: streamId,
      stopRequestedStreamId: null,
    }));

    try {
      const params: Record<string, string> = {
        query,
        language: language || get().lastLanguage || "zh",
        client_stream_id: streamId,
      };

      if (currentConversationId) params.conversation_id = currentConversationId;
      if (connectionId) params.connection_id = connectionId;
      if (modelId) params.model = modelId;
      if (typeof contextRounds === "number") {
        params.context_rounds = String(contextRounds);
      }
      if (projectId) params.project_id = projectId;
      if (resumeRunId) params.resume_run_id = resumeRunId;
      if (correctionId) params.correction_id = correctionId;
      if (preservedValidationSelection?.length) {
        Object.assign(params, {
          semantic_validation_selection: preservedValidationSelection,
        });
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
        if (conversationId && get().activeStreamId === streamId) {
          set({ currentConversationId: conversationId });
          const conversationProjectId = projectId || get().lastProjectId;
          if (conversationProjectId) {
            rememberConversationForProject(conversationProjectId, conversationId);
          }
        }

        if (payload.type === "error") {
          set((state) => {
            const messages = applyStreamErrorEvent(
              state.messages,
              payload,
              originalQuery,
              streamId
            );
            return settleActiveStream(
              state,
              streamId,
              messages,
              projectId || null,
              payload.data.code === "CANCELLED" ? "stopped" : "failed"
            );
          });
          return;
        }

        if (payload.type === "done") {
          set((state) =>
            settleActiveStream(
              state,
              streamId,
              finalizeStreamMessage(state.messages, streamId),
              projectId || null,
              "completed"
            )
          );
          return;
        }

        set((state) => ({
          messages: applyStreamEvent(state.messages, payload, streamId),
        }));
      }

      throw new Error(runtimeMessage("analysisConnectionInterrupted"));
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") {
        set((state) =>
          settleActiveStream(
            state,
            streamId,
            markStoppedMessage(state.messages, streamId),
            projectId || null,
            "stopped"
          )
        );
        return;
      }

      set((state) =>
        settleActiveStream(
          state,
          streamId,
          applyClientError(state.messages, originalQuery, error, streamId),
          projectId || null,
          "failed"
        )
      );
    }
  },

  resumePreparedRun: async (prepared, modelId, contextRounds, language) => {
    if (get().isLoading || get().activeStreamId) {
      throw new Error(runtimeMessage("analysisAlreadyRunningForCheck"));
    }
    set({
      messages: [],
      currentConversationId: prepared.conversationId,
      currentConversationMeta: null,
      lastProjectId: prepared.projectId,
    });
    rememberConversationForProject(prepared.projectId, prepared.conversationId);
    await get().sendMessage(
      prepared.query,
      null,
      modelId,
      contextRounds,
      language,
      prepared.projectId,
      prepared.runId,
      prepared.query,
      prepared.conversationId
    );
  },

  confirmBusinessDefinition: async (
    analysisRunId: string,
    key: string,
    selectedOption: string,
    language?: string
  ) => {
    const origin = get();
    const originConversationId = origin.currentConversationId;
    const originMessage = [...origin.messages].reverse().find((message) =>
      message.role === "assistant" && message.analysisRunId === analysisRunId &&
      message.report?.confirmation?.key === key);
    const originProjectId = originMessage?.projectId || origin.lastProjectId;
    if (origin.isLoading || origin.activeStreamId) {
      throw new UserFacingError(runtimeMessage("analysisAlreadyRunning"));
    }
    if (!originConversationId || !originMessage || !originProjectId || origin.isConversationLoading ||
      (origin.lastProjectId && origin.lastProjectId !== originProjectId) ||
      originMessage.confirmationResolved !== undefined ||
      (originMessage.report?.confirmation && !originMessage.report.confirmation.options.includes(selectedOption))) {
      throw new UserFacingError(runtimeMessage("confirmationCannotContinue"));
    }
    if (confirmingConversations.has(originConversationId)) {
      throw new UserFacingError(runtimeMessage("confirmationInProgress"));
    }
    confirmingConversations.add(originConversationId);
    try {
      const response = await api.post("/api/v1/chat/confirm", {
        analysis_run_id: analysisRunId,
        key,
        selected_option: selectedOption,
      });
      const confirmation = response?.data?.data as BusinessConfirmationResponse | undefined;
      // The server confirms and resumes the same run. Its key may be
      // canonicalized, so compare the answer and authoritative identities.
      if (!confirmation || confirmation.analysis_run_id !== analysisRunId ||
        confirmation.resume_run_id !== analysisRunId ||
        confirmation.conversation_id !== originConversationId ||
        confirmation.project_id !== originProjectId ||
        confirmation.selected_option !== selectedOption ||
        confirmation.ready_to_continue !== true) {
        throw new UserFacingError(runtimeMessage("confirmationCannotContinue"));
      }
      const live = get();
      if (live.currentConversationId !== originConversationId || live.isConversationLoading ||
        !live.messages.includes(originMessage) ||
        (live.lastProjectId && live.lastProjectId !== originProjectId)) {
        throw new UserFacingError(runtimeMessage("confirmationSavedElsewhere"));
      }
      if (live.isLoading || live.activeStreamId) {
        throw new UserFacingError(runtimeMessage("confirmationWaitingForRun"));
      }
      set((current) => ({
        messages: current.messages.map((message) =>
          message === originMessage
            ? { ...message, confirmationResolved: selectedOption }
            : message
        ),
      }));
      rememberConversationForProject(originProjectId, originConversationId);
      await get().sendMessage(
        selectedOption,
        origin.lastConnectionId,
        origin.lastModelId,
        origin.lastContextRounds,
        language,
        originProjectId,
        analysisRunId,
        originMessage.originalQuery,
      );
    } finally {
      confirmingConversations.delete(originConversationId);
    }
  },

  stopGeneration: () => {
    const {
      abortController,
      currentConversationId,
      activeStreamId,
      stopRequestedStreamId,
    } = get();
    if (!activeStreamId || stopRequestedStreamId === activeStreamId) return;

    // A stop is a request, not a terminal result. Keep the stream active until
    // the server confirms cancellation (or the bounded fallback aborts it), so
    // a late successful completion cannot be overwritten as "stopped".
    set({ stopRequestedStreamId: activeStreamId });

    if (!currentConversationId) {
      abortController?.abort();
      return;
    }

    const abortIfStillStopping = () => {
      if (!abortController) return;
      window.setTimeout(() => {
        const current = get();
        if (
          current.activeStreamId === activeStreamId &&
          current.stopRequestedStreamId === activeStreamId &&
          current.abortController === abortController
        ) {
          abortController.abort();
        }
      }, 3_000);
    };

    // The POST can be delayed or can race with stream registration. Start the
    // bounded client fallback now; its identity guards make it harmless if a
    // terminal event wins first or a newer investigation starts.
    abortIfStillStopping();
    void api
      .post("/api/v1/chat/stop", {
        conversation_id: currentConversationId,
        client_stream_id: activeStreamId,
      })
      .catch(() => {
        // The guarded AbortController fallback remains responsible for ending
        // this exact client stream when the acknowledgement is unavailable.
      });
  },

  setCurrentConversation: (id: string, expectedProjectId?: string | null) => {
    const safeConversationId = normalizeConversationId(id);
    if (!safeConversationId) {
      set({ conversationLoadError: runtimeMessage("invalidConversationRecord") });
      return;
    }
    const { abortController, currentConversationId, isLoading, activeStreamId } = get();
    if (isLoading || activeStreamId) {
      return;
    }
    if (abortController) {
      if (currentConversationId) {
        void api.post("/api/v1/chat/stop", {
          conversation_id: currentConversationId,
          ...(activeStreamId ? { client_stream_id: activeStreamId } : {}),
        });
      }
      abortController.abort();
    }
    set({
      currentConversationId: safeConversationId,
      currentConversationMeta: null,
      messages: [],
      isLoading: false,
      isConversationLoading: true,
      conversationLoadError: null,
      abortController: null,
      activeStreamId: null,
      stopRequestedStreamId: null,
      ...(expectedProjectId ? { lastProjectId: expectedProjectId } : {}),
    });
    void get().loadConversation(safeConversationId, expectedProjectId);
  },

  clearConversation: (options) => {
    const {
      abortController,
      currentConversationId,
      currentConversationMeta,
      lastProjectId,
      activeStreamId,
    } = get();
    if (abortController) {
      if (currentConversationId) {
        void api.post("/api/v1/chat/stop", {
          conversation_id: currentConversationId,
          ...(activeStreamId ? { client_stream_id: activeStreamId } : {}),
        });
      }
      abortController.abort();
    }
    set({
      messages: [],
      currentConversationId: null,
      currentConversationMeta: null,
      isLoading: false,
      isConversationLoading: false,
      conversationLoadError: null,
      abortController: null,
      activeStreamId: null,
      stopRequestedStreamId: null,
    });
    if (options?.forget !== false) {
      const projectId =
        options?.projectId || currentConversationMeta?.project_id || lastProjectId;
      if (projectId) forgetConversationForProject(projectId);
    }
  },

  loadConversation: async (id: string, expectedProjectId?: string | null) => {
    if (get().currentConversationId !== id) return;
    set({ isConversationLoading: true, conversationLoadError: null });
    try {
      const response = await api.get(`/api/v1/conversations/${encodeURIComponent(id)}`);
      const conversation = response.data.data as Conversation;
      if (get().currentConversationId !== id) return;
      if (
        normalizeConversationId(conversation.id) !== normalizeConversationId(id) ||
        (expectedProjectId &&
          conversation.project_id &&
          conversation.project_id !== expectedProjectId)
      ) {
        if (
          expectedProjectId &&
          storedConversationIdForProject(expectedProjectId) === id
        ) {
          forgetConversationForProject(expectedProjectId);
        }
        set({
          messages: [],
          currentConversationId: null,
          currentConversationMeta: null,
          isConversationLoading: false,
          conversationLoadError: runtimeMessage("conversationProjectMismatch"),
        });
        return;
      }
      const restoredMessages = mapConversationMessages(
        conversation.messages, conversation.project_id || expectedProjectId,
      );

      set({
        messages: restoredMessages,
        currentConversationId: id,
        currentConversationMeta: conversation,
        lastModelId: conversation.model_id || null,
        lastConnectionId: conversation.connection_id || null,
        lastContextRounds: conversation.context_rounds || null,
        lastProjectId: conversation.project_id || expectedProjectId || null,
        isConversationLoading: false,
        conversationLoadError: null,
      });
      const conversationProjectId = conversation.project_id || expectedProjectId;
      if (conversationProjectId) {
        rememberConversationForProject(conversationProjectId, id);
      }
    } catch (error) {
      console.error("Failed to load conversation", error);
      if (get().currentConversationId !== id) return;
      set({
        isConversationLoading: false,
        conversationLoadError: runtimeMessage("conversationOpenFailed"),
      });
    }
  },

  retryMessage: async (messageIndex: number, language?: string) => {
    const { messages } = get();
    const errorMsg = messages[messageIndex];
    const canContinueAfterData =
      errorMsg?.report?.status === "needs_data" &&
      Boolean(errorMsg.analysisRunId && errorMsg.resumable);
    if ((!errorMsg?.canRetry && !canContinueAfterData) || !errorMsg.originalQuery) {
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
      executionContext?.context_rounds || get().lastContextRounds,
      language || get().lastLanguage || undefined,
      errorMsg.projectId || get().lastProjectId,
      errorMsg.resumable ? errorMsg.analysisRunId : undefined,
      null,
      null,
      null,
      errorMsg.semanticValidationSelection
    );
  },

  retryMessageWithModel: async (
    messageIndex: number,
    modelId: string,
    language?: string
  ) => {
    const { messages } = get();
    const errorMsg = messages[messageIndex];
    const recovery = getInvestigationErrorRecovery(
      errorMsg?.errorCode,
      errorMsg?.errorCategory
    );
    if (
      recovery !== "change_analysis_service" ||
      !errorMsg?.originalQuery ||
      !modelId
    ) {
      console.error("Cannot change analysis service for this message");
      return;
    }

    const executionContext = errorMsg.executionContext;
    const connectionId = executionContext?.connection_id || get().lastConnectionId;
    const contextRounds = executionContext?.context_rounds || get().lastContextRounds;
    const projectId = errorMsg.projectId || get().lastProjectId;
    // A conversation is execution provenance and keeps its original model.
    // An explicit service change therefore starts a new investigation while
    // carrying the user's original question and project context forward.
    set({
      messages: [],
      currentConversationId: null,
      currentConversationMeta: null,
      isConversationLoading: false,
      conversationLoadError: null,
    });
    if (projectId) forgetConversationForProject(projectId);

    await get().sendMessage(
      errorMsg.originalQuery,
      connectionId,
      modelId,
      contextRounds,
      language || get().lastLanguage || undefined,
      projectId,
      null,
      null,
      null,
      null,
      errorMsg.semanticValidationSelection
    );
  },

  rerunMessage: async (messageIndex: number, language?: string) => {
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
      message.executionContext?.context_rounds || lastContextRounds,
      language || get().lastLanguage || undefined,
      message.projectId || get().lastProjectId,
      null,
      null,
      null,
      null,
      message.hasError ? message.semanticValidationSelection : undefined
    );
  },

  acknowledgeAnalysisSettlement: (id: string) => {
    set((state) => ({
      pendingAnalysisSettlements: state.pendingAnalysisSettlements.filter(
        (settlement) => settlement.id !== id
      ),
    }));
  },
}));

function getConversationId(payload: SSEEventData): string | null {
  if (
    "conversation_id" in payload.data &&
    typeof payload.data.conversation_id === "string"
  ) {
    return normalizeConversationId(payload.data.conversation_id);
  }
  return null;
}
