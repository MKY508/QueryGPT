"use client";

import { useEffect, useReducer, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CircleAlert } from "lucide-react";
import type {
  AnalysisRunSummary,
  AppSettings,
  ConnectionSummary,
  ModelSummary,
  SuggestedQuestionsResponse,
} from "@/lib/types/api";
import { api } from "@/lib/api/client";
import { useChatStore } from "@/lib/stores/chat";
import { useProjectStore } from "@/lib/stores/project";
import { MessageList } from "./MessageList";
import { InputBar } from "./InputBar";
import { ChatHeader } from "./ChatHeader";
import { DataWorkspacePanel } from "./DataWorkspacePanel";
import { useComposerDraft } from "./useComposerDraft";
import { useAnalysisModelSelection } from "./useAnalysisModelSelection";
import { useAnalysisSettlementRefresh } from "./useAnalysisSettlementRefresh";
import { useStandingAnalyses } from "./useStandingAnalyses";
import { usePendingTask } from "./usePendingTask";
import { PendingTaskSaveNotice } from "./PendingTaskSaveNotice";
import type { PendingTask } from "@/lib/pending-task";
import { submitWithAnalysisReceipt } from "@/lib/chat-submission";
import { INITIAL_WORKBENCH_PANE, selectWorkbenchPane } from "@/lib/workbench-pane";
import { Button } from "@/components/ui/button";

interface ChatAreaProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  recentRuns: AnalysisRunSummary[];
  recentRunsLoading?: boolean;
  onOpenReport: (conversationId: string, analysisRunId: string) => void;
  focusAnalysisRunId?: string | null;
  onReportFocused?: () => void;
}

interface RunPromptOptions {
  correctionId?: string;
}

export function ChatArea({
  sidebarOpen: _sidebarOpen,
  onToggleSidebar,
  recentRuns,
  recentRunsLoading = false,
  onOpenReport,
  focusAnalysisRunId,
  onReportFocused,
}: ChatAreaProps) {
  const router = useRouter();
  const locale = useLocale();
  const tArea = useTranslations("chatArea");
  const tProjectDefaults = useTranslations("projectDefaults");
  const queryClient = useQueryClient();
  const [pane, changeWorkbenchView] = useReducer(selectWorkbenchPane, INITIAL_WORKBENCH_PANE);
  const dataPanelOpen = pane.view !== "result";
  const dataPanelView = pane.view === "result" ? pane.lastDataView : pane.view;
  const [analysisServiceSelectorOpen, setAnalysisServiceSelectorOpen] = useState(false);
  const [pendingServiceChangeMessageIndex, setPendingServiceChangeMessageIndex] =
    useState<number | null>(null);

  useEffect(() => {
    router.prefetch("/settings");
  }, [router]);
  const closeDataPanel = () => changeWorkbenchView("result");
  const openDataPanel = changeWorkbenchView;
  const {
    messages,
    isLoading,
    activeStreamId,
    stopRequestedStreamId,
    isConversationLoading,
    conversationLoadError,
    currentConversationId,
    currentConversationMeta,
    lastModelId,
    sendMessage,
    confirmBusinessDefinition,
    stopGeneration,
    retryMessage,
    retryMessageWithModel,
    rerunMessage,
    loadConversation,
    pendingAnalysisSettlements,
  } = useChatStore();

  const {
    projects,
    currentProjectId,
    sources,
    pendingKnowledgeCount,
    isUploading,
    error: projectError,
    bootstrap,
    renameProject,
    uploadFile,
    refreshCurrent,
  } = useProjectStore();
  const parkedTask = usePendingTask(currentProjectId);
  const pendingTask = parkedTask.task;
  const pendingTaskVisible = Boolean(pendingTask) && !currentConversationId && !isLoading && !activeStreamId;
  const clearPendingTask = parkedTask.clear;
  const currentProject = projects.find((project) => project.id === currentProjectId);
  const readySources = sources.filter((source) =>
    ["ready", "needs_confirmation"].includes(source.status)
  );
  const pendingUnderstandingCount = pendingKnowledgeCount;

  useAnalysisSettlementRefresh(pendingAnalysisSettlements);

  const { data: connections } = useQuery({
    queryKey: ["connections"],
    queryFn: async () => {
      const response = await api.get("/api/v1/config/connections");
      return response.data.data as ConnectionSummary[];
    },
  });

  const { data: models } = useQuery({
    queryKey: ["models"],
    queryFn: async () => {
      const response = await api.get("/api/v1/config/models");
      return response.data.data as ModelSummary[];
    },
  });

  const { data: appSettings, isLoading: appSettingsLoading } = useQuery({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const response = await api.get("/api/v1/settings");
      return response.data.data as AppSettings;
    },
  });

  const recordedMessageModelId = [...messages]
    .reverse()
    .find((message) => message.executionContext?.model_id)?.executionContext?.model_id;
  const modelSelectionLocked = Boolean(
    currentConversationId || messages.length || isLoading || activeStreamId
  );
  const selectorLocked =
    modelSelectionLocked && pendingServiceChangeMessageIndex === null;
  const lockedModelId =
    currentConversationMeta?.model_id ||
    recordedMessageModelId ||
    (modelSelectionLocked ? lastModelId : null);
  const {
    selectedModelId,
    modelReady,
    selectModel,
    modelSelectionSaving,
    modelSelectionError,
  } = useAnalysisModelSelection(models, appSettings, {
    selectionLocked: selectorLocked,
    lockedModelId,
  });
  const { input, setInput, onAccepted, unretained, unreadable, retryRetention } = useComposerDraft(currentProjectId, currentConversationId);
  const executionModelId = selectorLocked
    ? lockedModelId || selectedModelId
    : selectedModelId;

  const handleSelectAnalysisService = async (modelId: string) => {
    selectModel(modelId);
    if (pendingServiceChangeMessageIndex === null) return;
    const messageIndex = pendingServiceChangeMessageIndex;
    setAnalysisServiceSelectorOpen(false);
    const retryPromise = retryMessageWithModel(messageIndex, modelId, locale);
    setPendingServiceChangeMessageIndex(null);
    await retryPromise;
  };

  const sourceSuggestionKey = readySources
    .map((source) => `${source.id}:${source.updated_at}`)
    .join("|");
  const {
    data: suggestedQuestions,
    error: suggestionsError,
    isPending: suggestionsLoading,
    mutate: generateSuggestions,
    reset: resetSuggestions,
  } = useMutation<SuggestedQuestionsResponse>({
    mutationFn: async () => {
      if (!currentProjectId) throw new Error(tArea("noAnalyzableProject"));
      const response = await api.post(
        `/api/v1/projects/${currentProjectId}/suggested-questions`,
        { model_id: selectedModelId || null, locale: locale === "en" ? "en" : "zh" },
        { timeout: 20_000 }
      );
      return response.data.data as SuggestedQuestionsResponse;
    },
  });

  useEffect(() => {
    resetSuggestions();
  }, [currentProjectId, locale, resetSuggestions, selectedModelId, sourceSuggestionKey]);

  const selfAnalysisEnabled = appSettings?.self_analysis_enabled === true;
  const handleGenerateSuggestions = () => {
    if (!selfAnalysisEnabled || !currentProjectId || !readySources.length) return;
    generateSuggestions();
  };

  const effectiveContextRounds = appSettings?.context_rounds || 5;
  const { standingAnalyses, standingLoading, checkingStandingId, standingFeedback, checkStanding } = useStandingAnalyses({
    projectId: currentProjectId, modelId: selectedModelId, modelReady, contextRounds: effectiveContextRounds,
  });

  const handleInputSubmit = async (query: string, options?: RunPromptOptions) => {
    if (pendingServiceChangeMessageIndex !== null) {
      setAnalysisServiceSelectorOpen(true);
      return false;
    }
    if (!modelReady || !executionModelId) {
      setAnalysisServiceSelectorOpen(true);
      return false;
    }
    const accepted = await submitWithAnalysisReceipt(() => sendMessage(
      query,
      null,
      executionModelId,
      effectiveContextRounds,
      locale,
      currentProjectId,
      null,
      null,
      null,
      options?.correctionId
    ), useChatStore.getState);
    if (accepted && pendingTaskVisible) clearPendingTask();
    return accepted;
  };

  const handleContinuePendingTask = async () => {
    const chat = useChatStore.getState();
    if (!pendingTask || !parkedTask.isCurrent() || !modelReady || !executionModelId ||
        chat.isLoading || chat.activeStreamId || chat.currentConversationId || chat.isConversationLoading ||
        useProjectStore.getState().currentProjectId !== pendingTask.projectId) return;
    try {
      const accepted = await submitWithAnalysisReceipt(() => sendMessage(
        pendingTask.query, null, executionModelId, effectiveContextRounds, locale,
        pendingTask.projectId, null, null, null, null, pendingTask.validationSelection,
      ), useChatStore.getState);
      if (accepted) clearPendingTask();
    } catch {
      // The retained snapshot remains available until this submission has a receipt.
    }
  };

  const handleEditPendingTask = () => {
    if (!pendingTask) return;
    setInput(pendingTask.query);
    clearPendingTask();
  };

  const handleChangeAnalysisService = (messageIndex: number) => {
    const failedMessage = messages[messageIndex];
    const preservedQuery = failedMessage?.originalQuery;
    if (preservedQuery) setInput(preservedQuery);
    setPendingServiceChangeMessageIndex(messageIndex);
    setAnalysisServiceSelectorOpen(true);
    void queryClient.invalidateQueries({ queryKey: ["models"] });
  };

  const handleManageAnalysisServices = (messageIndex?: number) => {
    const failedMessage =
      typeof messageIndex === "number" ? messages[messageIndex] : null;
    const preservedQuery = failedMessage?.originalQuery;
    if (preservedQuery) {
      const task: PendingTask = {
        query: preservedQuery,
        projectId: failedMessage?.projectId || currentProjectId,
        ...(failedMessage?.semanticValidationSelection?.length
          ? { validationSelection: failedMessage.semanticValidationSelection }
          : {}),
      };
      if (!parkedTask.write(task)) return;
    }
    router.push("/settings?tab=models");
  };

  const handleConfirmation = async (
    analysisRunId: string,
    key: string,
    selectedOption: string
  ) => {
    await confirmBusinessDefinition(analysisRunId, key, selectedOption, locale);
    await refreshCurrent();
  };

  const showDockComposer = messages.length > 0 && !pendingTaskVisible;

  const taskComposer = (
    <InputBar
      placement="surface"
      onSubmit={handleInputSubmit}
      onStop={stopGeneration}
      isLoading={isLoading}
      isStopping={Boolean(
        activeStreamId && stopRequestedStreamId === activeStreamId
      )}
      projectName={currentProject?.name}
      dataReady={readySources.length > 0}
      sourceCount={sources.length}
      isUploading={isUploading}
      onOpenData={() => openDataPanel("sources")}
      onUploadFile={(file) => void uploadFile(file)}
      input={input}
      onInputChange={setInput}
      contextKey={JSON.stringify([currentProjectId, currentConversationId])}
      onAccepted={onAccepted}
      disabled={!currentProjectId || isConversationLoading}
      draftUnretained={unretained}
      draftUnreadable={unreadable}
      onRetryDraftRetention={retryRetention}
      analysisServices={models || []}
      selectedAnalysisServiceId={executionModelId}
      onSelectAnalysisService={handleSelectAnalysisService}
      onManageAnalysisServices={() => handleManageAnalysisServices()}
      analysisServiceLocked={selectorLocked}
      analysisServiceSaving={modelSelectionSaving}
      analysisServiceError={modelSelectionError}
      analysisServiceSelectorOpen={analysisServiceSelectorOpen}
      onAnalysisServiceSelectorOpenChange={setAnalysisServiceSelectorOpen}
    />
  );

  return (
    <div className="flex h-full min-w-0 flex-1 bg-background">
      <main className="flex min-w-0 flex-1 flex-col">
        <ChatHeader
          onToggleSidebar={onToggleSidebar}
          onToggleData={() => openDataPanel("sources")}
          onOpenUnderstanding={() => openDataPanel("understanding")}
          project={currentProject}
          readySources={readySources.length}
          totalSources={sources.length}
          pendingUnderstandingCount={pendingUnderstandingCount}
          onRenameProject={
            currentProject
              ? async (name) => {
                  await renameProject(currentProject.id, name);
                }
              : undefined
          }
        />

        {parkedTask.failedTask && <PendingTaskSaveNotice
          onRetry={() => { if (parkedTask.retryWrite()) router.push("/settings?tab=models"); }}
          onDismiss={parkedTask.dismissFailure} />}
        {projectError && (
          <div
            role="status"
            className="flex items-start gap-3 border-b border-warning/30 bg-warning/[0.06] px-5 py-3 text-sm text-foreground"
          >
            <CircleAlert size={17} className="mt-0.5 shrink-0 text-warning" />
            <div>
              <div className="font-semibold">
                {currentProjectId ? tArea("sourceRefreshFailed") : tArea("localNotConnected")}
              </div>
              <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                {currentProjectId
                  ? tArea("projectStillAvailable")
                  : tArea("localWorkspaceHint")}
              </div>
            </div>
            <Button variant="outline" size="sm"
              type="button"
              onClick={() =>
                void bootstrap({
                  name: tProjectDefaults("initialName"),
                  description: tProjectDefaults("initialDescription"),
                })
              }
              className="ml-auto border-warning/40 hover:bg-warning/10"
            >
              {tArea("reconnect")}
            </Button>
          </div>
        )}

        <MessageList
          key={currentConversationId || currentProjectId || "workspace"}
          messages={messages}
          isLoading={isLoading}
          conversationLoading={isConversationLoading}
          conversationLoadError={conversationLoadError}
          project={currentProject}
          sources={sources}
          standingAnalyses={standingAnalyses}
          suggestedQuestions={suggestedQuestions?.items || []}
          suggestionsLoading={Boolean(readySources.length && suggestionsLoading)}
          settingsLoaded={!appSettingsLoading}
          selfAnalysisEnabled={selfAnalysisEnabled}
          canGenerateSuggestions={Boolean(currentProjectId && readySources.length)}
          suggestionsFailed={Boolean(suggestionsError)}
          emptyComposer={taskComposer}
          activityLoading={standingLoading || recentRunsLoading}
          checkingStandingId={checkingStandingId}
          standingFeedback={standingFeedback}
          modelReady={modelReady}
          pendingTask={pendingTaskVisible ? pendingTask?.query : undefined}
          onRetry={(index) => void retryMessage(index, locale)}
          onRerun={(index) => void rerunMessage(index, locale)}
          onChangeAnalysisService={handleChangeAnalysisService}
          onManageAnalysisServices={handleManageAnalysisServices}
          onOpenSettings={() => router.push("/settings")}
          onOpenProcessingSettings={() => router.push("/settings?tab=execution")}
          onGenerateSuggestions={handleGenerateSuggestions}
          onOpenData={() => openDataPanel("sources")}
          onOpenUnderstanding={() => openDataPanel("understanding")}
          onUsePrompt={setInput}
          onRunPrompt={(prompt, options) => void handleInputSubmit(prompt, options)}
          onOpenReport={onOpenReport}
          focusAnalysisRunId={focusAnalysisRunId}
          onReportFocused={onReportFocused}
          onRetryConversation={() => {
            if (currentConversationId) void loadConversation(currentConversationId);
          }}
          onCheckStanding={checkStanding}
          onConfirm={handleConfirmation}
          onContinuePending={() => void handleContinuePendingTask()}
          onEditPending={handleEditPendingTask}
        />

        {showDockComposer && (
          <InputBar
            onSubmit={handleInputSubmit}
            onStop={stopGeneration}
            isLoading={isLoading}
            isStopping={Boolean(
              activeStreamId && stopRequestedStreamId === activeStreamId
            )}
            projectName={currentProject?.name}
            dataReady={readySources.length > 0}
            sourceCount={sources.length}
            isUploading={isUploading}
            onOpenData={() => openDataPanel("sources")}
            onUploadFile={(file) => void uploadFile(file)}
            input={input}
            onInputChange={setInput}
            contextKey={JSON.stringify([currentProjectId, currentConversationId])}
            onAccepted={onAccepted}
            disabled={!currentProjectId || isConversationLoading}
            draftUnretained={unretained}
            draftUnreadable={unreadable}
            onRetryDraftRetention={retryRetention}
            analysisServices={models || []}
            selectedAnalysisServiceId={executionModelId}
            onSelectAnalysisService={handleSelectAnalysisService}
            onManageAnalysisServices={() => handleManageAnalysisServices()}
            analysisServiceLocked={selectorLocked}
            analysisServiceSaving={modelSelectionSaving}
            analysisServiceError={modelSelectionError}
            analysisServiceSelectorOpen={analysisServiceSelectorOpen}
            onAnalysisServiceSelectorOpenChange={setAnalysisServiceSelectorOpen}
          />
        )}
      </main>
      {dataPanelOpen && (
        <button
          type="button"
          aria-label={tArea("closeDataSource")}
          onClick={closeDataPanel}
          className="fixed inset-0 z-30 bg-slate-950/25 md:hidden"
        />
      )}
      <DataWorkspacePanel
        open={dataPanelOpen}
        onClose={closeDataPanel}
        onConfigureConnection={() => router.push("/settings?tab=connections")}
        preprocessingEnabled={appSettings?.preprocessing_enabled === true}
        settingsLoaded={!appSettingsLoading}
        onOpenPreprocessingSettings={() => {
          closeDataPanel();
          router.push("/settings?tab=execution");
        }}
        connections={connections}
        view={dataPanelView}
        onViewChange={changeWorkbenchView}
      />
    </div>
  );
}
