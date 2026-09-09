"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { useChatStore } from "@/lib/stores/chat";
import { useProjectStore } from "@/lib/stores/project";
import { getErrorMessage, UserFacingError } from "@/lib/types/api";
import type { AnalysisRunSummary, StandingAnalysis, StandingPrepareResponse } from "@/lib/types/api";
import { standingAttentionFeedback } from "./standing-attention";

interface Options {
  projectId: string | null;
  modelId: string | null;
  modelReady: boolean;
  contextRounds: number;
}

export function useStandingAnalyses({ projectId, modelId, modelReady, contextRounds }: Options) {
  const t = useTranslations("chatArea");
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useMemo(() => ({ projectId }), [projectId]);
  const activeSession = useRef<typeof session | null>(null);
  const writing = useRef(false);
  const [feedback, setFeedback] = useState<{ session: typeof session; entries: Record<string, string> } | null>(null);

  useEffect(() => {
    activeSession.current = session;
    return () => { activeSession.current = null; };
  }, [session]);

  const directory = useQuery<StandingAnalysis[]>({
    queryKey: ["standing-analyses", projectId],
    queryFn: async ({ signal }) => {
      const response = await api.get(`/api/v1/projects/${encodeURIComponent(projectId!)}/standing-analyses`, { signal });
      return response.data.data as StandingAnalysis[];
    },
    enabled: Boolean(projectId),
  });

  const showFeedback = (id: string, message: string) => {
    if (activeSession.current !== session || useProjectStore.getState().currentProjectId !== projectId) return;
    setFeedback(current => ({ session, entries: { ...(current?.session === session ? current.entries : {}), [id]: message } }));
  };

  const check = useMutation({
    retry: false,
    networkMode: "always",
    mutationFn: async (request: { standing: StandingAnalysis; modelId: string; conversationId: string | null; session: typeof session }) => {
      const { standing, conversationId } = request;
      const originProjectId = request.session.projectId!;
      const current = () => activeSession.current === request.session && useProjectStore.getState().currentProjectId === originProjectId
        && useChatStore.getState().currentConversationId === conversationId;
      const canResume = () => current() && !useChatStore.getState().isLoading
        && !useChatStore.getState().activeStreamId && !useChatStore.getState().isConversationLoading;
      if (!canResume()) return;
      const base = `/api/v1/projects/${encodeURIComponent(originProjectId)}`;
      const response = await api.post(`${base}/standing-analyses/${encodeURIComponent(standing.id)}/prepare-run`, { trigger: "manual", force: false });
      if (!current()) return;
      const prepared = response.data.data as StandingPrepareResponse;
      switch (prepared.outcome) {
        case "no_change": return t("noChanges");
        case "paused": return t("standingPaused");
        case "already_completed": return t("standingCompleted");
        case "needs_attention": return standingAttentionFeedback(prepared, t);
        case "already_running": {
          const runsResponse = await api.get(`${base}/analysis-runs`);
          if (!current()) return;
          const run = (runsResponse.data.data as AnalysisRunSummary[]).find(item => item.id === prepared.run_id);
          if (run?.stage !== "prepared") {
            if (prepared.conversation_id && canResume()) {
              useChatStore.getState().setCurrentConversation(prepared.conversation_id, originProjectId);
            }
            return t("standingInvestigating");
          }
          break;
        }
      }
      if (!canResume()) return;
      if (!prepared.run_id || !prepared.conversation_id) throw new UserFacingError(t("standingResumeMissing"));
      await useChatStore.getState().resumePreparedRun({
        query: standing.query, projectId: originProjectId,
        runId: prepared.run_id, conversationId: prepared.conversation_id,
      }, request.modelId, contextRounds, locale);
    },
    onSuccess: (message, request) => {
      if (message && request.session === session) showFeedback(request.standing.id, message);
    },
    onError: (error, request) => {
      if (request.session === session) showFeedback(request.standing.id, getErrorMessage(error));
    },
    onSettled: (_data, _error, request) => {
      writing.current = false;
      void queryClient.invalidateQueries({ queryKey: ["standing-analyses", request.session.projectId], exact: true });
    },
  });

  const checkStanding = (standing: StandingAnalysis) => {
    if (!projectId || standing.project_id !== projectId || activeSession.current !== session || writing.current || useProjectStore.getState().currentProjectId !== projectId) return;
    const chat = useChatStore.getState();
    if (chat.isLoading || chat.activeStreamId || chat.isConversationLoading) {
      showFeedback(standing.id, t("waitForRun"));
      return;
    }
    if (!modelReady || !modelId) {
      showFeedback(standing.id, t("modelNotReady"));
      router.push("/settings");
      return;
    }
    writing.current = true;
    setFeedback(current => {
      const entries = { ...(current?.session === session ? current.entries : {}) };
      delete entries[standing.id];
      return { session, entries };
    });
    check.mutate({ standing, modelId, conversationId: chat.currentConversationId, session });
  };

  const checkingStandingId = check.isPending && check.variables.session === session ? check.variables.standing.id : null;
  return {
    standingAnalyses: directory.data || [],
    standingLoading: directory.isLoading,
    checkingStandingId,
    standingFeedback: {
      ...(feedback?.session === session ? feedback.entries : {}),
      ...(checkingStandingId ? { [checkingStandingId]: t("checkingData") } : {}),
    },
    checkStanding,
  };
}
