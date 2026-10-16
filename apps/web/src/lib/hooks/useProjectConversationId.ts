"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  normalizeConversationId,
  storedConversationIdForProject,
  subscribeToConversationContinuity,
  useChatStore,
} from "@/lib/stores/chat";

function serverConversationId(): null { return null; }

/** Navigation follows only the relevant project pointer, never streamed messages. */
export function useProjectConversationId(projectId: string, requestedId?: string | null) {
  const liveId = useChatStore((state) => {
    const conversationProjectId = state.currentConversationMeta?.project_id ?? state.lastProjectId;
    return conversationProjectId === projectId ? normalizeConversationId(state.currentConversationId) : null;
  });
  const readStoredId = useCallback(() => storedConversationIdForProject(projectId), [projectId]);
  const storedId = useSyncExternalStore(subscribeToConversationContinuity, readStoredId, serverConversationId);
  return normalizeConversationId(requestedId) || liveId || storedId;
}
