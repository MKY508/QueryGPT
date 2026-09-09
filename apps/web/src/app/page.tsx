"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AnalysisHistoryDialog } from "@/components/chat/AnalysisHistoryDialog";
import { ChatArea } from "@/components/chat/ChatArea";
import { ProjectSwitcherDialog } from "@/components/projects/ProjectSwitcherDialog";
import {
  normalizeConversationId,
  storedConversationIdForProject,
  useChatStore,
} from "@/lib/stores/chat";
import { useProjectStore } from "@/lib/stores/project";

export default function Home() {
  const router = useRouter();
  const tProjectDefaults = useTranslations("projectDefaults");
  const initialProjectName = tProjectDefaults("initialName");
  const initialProjectDescription = tProjectDefaults("initialDescription");
  const [dialog, setDialog] = useState<"history" | "projects" | null>(null);
  const closeDialog = (owner: "history" | "projects") => setDialog(current => current === owner ? null : current);
  const [selectedReport, setSelectedReport] = useState<{
    projectId: string | null;
    conversationId: string;
    analysisRunId: string | null;
  } | null>(null);
  const [focusAnalysisRunId, setFocusAnalysisRunId] = useState<string | null>(null);
  const attemptedRestoreRef = useRef<string | null>(null);
  const returnConversation = useRef<string | null | undefined>(undefined);
  if (returnConversation.current === undefined) {
    returnConversation.current = typeof window === "undefined" ? null : normalizeConversationId(
      new URLSearchParams(window.location.search).get("conversation")
    );
  }
  const { bootstrap, currentProjectId, projects } = useProjectStore();
  const {
    messages,
    currentConversationId,
    isLoading,
    activeStreamId,
    setCurrentConversation,
  } = useChatStore();
  const selectionContext = useRef({ projectId: currentProjectId, conversationId: currentConversationId });
  useLayoutEffect(() => {
    selectionContext.current = { projectId: currentProjectId, conversationId: currentConversationId };
  }, [currentProjectId, currentConversationId]);

  const handleOpenReport = useCallback(
    (conversationId: string, analysisRunId: string) => {
      if (isLoading || activeStreamId) return;
      setSelectedReport({ projectId: currentProjectId, conversationId, analysisRunId });
      setFocusAnalysisRunId(analysisRunId);
      setCurrentConversation(conversationId, currentProjectId);
    },
    [activeStreamId, currentProjectId, isLoading, setCurrentConversation]
  );

  const handleVisibleReportChange = useCallback((analysisRunId: string | null) => {
    if (!currentConversationId || selectionContext.current.projectId !== currentProjectId || selectionContext.current.conversationId !== currentConversationId) return;
    setSelectedReport((current) => current?.projectId === currentProjectId && current.conversationId === currentConversationId && current.analysisRunId === analysisRunId
      ? current : { projectId: currentProjectId, conversationId: currentConversationId, analysisRunId });
  }, [currentProjectId, currentConversationId]);

  const latestMessageRunId = [...messages]
    .reverse()
    .find((message) => message.analysisRunId)?.analysisRunId;
  const currentAnalysisRunId =
    focusAnalysisRunId || (selectedReport?.projectId === currentProjectId && selectedReport.conversationId === currentConversationId
      ? selectedReport.analysisRunId
      : latestMessageRunId || null);

  useEffect(() => {
    void bootstrap({
      name: initialProjectName,
      description: initialProjectDescription,
    });
  }, [bootstrap, initialProjectDescription, initialProjectName]);

  useEffect(() => {
    if (!currentProjectId || isLoading || activeStreamId) return;
    const returnConversationId = returnConversation.current;
    const restoreKey = `${currentProjectId}:${returnConversationId || "stored"}`;
    if (returnConversationId) {
      if (attemptedRestoreRef.current !== restoreKey) {
        attemptedRestoreRef.current = restoreKey;
        if (currentConversationId !== returnConversationId) {
          setCurrentConversation(returnConversationId, currentProjectId);
        }
      }
      router.replace("/", { scroll: false });
      returnConversation.current = null;
      return;
    }
    if (currentConversationId) return;
    if (attemptedRestoreRef.current === restoreKey) return;
    attemptedRestoreRef.current = restoreKey;
    const conversationId = storedConversationIdForProject(currentProjectId);
    if (!conversationId) return;
    setCurrentConversation(conversationId, currentProjectId);
  }, [
    activeStreamId,
    currentConversationId,
    currentProjectId,
    isLoading,
    router,
    setCurrentConversation,
  ]);

  if (selectedReport && (selectedReport.projectId !== currentProjectId || selectedReport.conversationId !== currentConversationId)) {
    setSelectedReport(null);
    setFocusAnalysisRunId(null);
  }

  return (
    <div className="workspace-shell flex h-screen overflow-hidden bg-background">
      <AnalysisHistoryDialog
        open={dialog === "history"}
        onClose={() => closeDialog("history")}
        projectId={currentProjectId}
        projectName={projects.find(project => project.id === currentProjectId)?.name || ""}
        disabled={isLoading || Boolean(activeStreamId)}
        currentAnalysisRunId={currentAnalysisRunId}
        onOpenReport={handleOpenReport}
        onNewAnalysis={() => {
          const chat = useChatStore.getState();
          if (chat.isLoading || chat.activeStreamId) return;
          chat.clearConversation({ forget: true, projectId: currentProjectId });
          closeDialog("history");
        }}
      />
      <ChatArea
        onOpenHistory={() => setDialog("history")}
        onOpenProjects={() => setDialog("projects")}
        onOpenReport={handleOpenReport}
        focusAnalysisRunId={focusAnalysisRunId}
        onReportFocused={() => setFocusAnalysisRunId(null)}
        onVisibleReportChange={handleVisibleReportChange}
      />
      {dialog === "projects" && <ProjectSwitcherDialog disabled={isLoading || Boolean(activeStreamId)}
        onClose={() => closeDialog("projects")} onSwitched={() => closeDialog("projects")} />}
    </div>
  );
}
