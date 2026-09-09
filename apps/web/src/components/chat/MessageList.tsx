"use client";

import type { ReactNode } from "react";
import {ArrowDown, Search} from "lucide-react";
import { useTranslations } from "next-intl";
import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "@/lib/types/chat";
import type {
  AnalysisRunSummary,
  Project,
  ProjectDataSource,
  StandingAnalysis,
  SuggestedQuestion,
} from "@/lib/types/api";
import {Button} from "@/components/ui/button";
import {PendingTaskReport, ConversationStatus} from "./MessageListStatus";
import {useInvestigationTimeline} from "./useInvestigationTimeline";
import { AnalysisProgress } from "./AnalysisProgress";
import { AssistantMessageCard } from "./AssistantMessageCard";
import { ChatEmptyState } from "./ChatEmptyState";

interface MessageListProps {
  messages: ChatMessage[];
  isLoading: boolean;
  conversationLoading?: boolean;
  conversationLoadError?: string | null;
  project?: Project;
  sources: ProjectDataSource[];
  standingAnalyses: StandingAnalysis[];
  recentRuns: AnalysisRunSummary[];
  suggestedQuestions?: SuggestedQuestion[];
  suggestionsLoading?: boolean;
  settingsLoaded?: boolean;
  selfAnalysisEnabled?: boolean;
  canGenerateSuggestions?: boolean;
  suggestionsError?: string | null;
  emptyComposer: ReactNode;
  activityLoading: boolean;
  checkingStandingId?: string | null;
  standingFeedback?: Record<string, string>;
  modelReady: boolean;
  pendingTask?: string;
  onRetry: (index: number) => void;
  onRerun: (index: number) => void;
  onChangeAnalysisService?: (index: number) => void;
  onManageAnalysisServices?: (index: number) => void;
  onOpenSettings: () => void;
  onOpenProcessingSettings?: () => void;
  onGenerateSuggestions?: () => void;
  onOpenData: () => void;
  onOpenUnderstanding?: () => void;
  onUsePrompt: (text: string) => void;
  onRunPrompt?: (text: string, options?: { correctionId?: string }) => void;
  onOpenReport: (conversationId: string, analysisRunId: string) => void;
  focusAnalysisRunId?: string | null;
  onReportFocused?: () => void;
  onRetryConversation?: () => void;
  onCheckStanding: (standing: StandingAnalysis) => void;
  onConfirm: (analysisRunId: string, key: string, selectedOption: string) => Promise<void>;
  onContinuePending: () => void;
  onEditPending: () => void;
}

export function getProductAnalysisStateLabel(
  state: string | undefined,
  t: (key: string) => string
): string {
  switch (state) {
    case "waiting_confirmation":
      return t("statePending");
    case "investigating":
      return t("stateInvestigating");
    case "completed":
      return t("stateCompleted");
    case "needs_attention":
      return t("stateNeedsAttention");
    case "understanding":
    default:
      return t("stateUnderstanding");
  }
}

export function MessageList({
  messages,
  conversationLoading = false,
  conversationLoadError,
  project,
  sources,
  standingAnalyses,
  recentRuns,
  suggestedQuestions = [],
  suggestionsLoading = false,
  settingsLoaded = true,
  selfAnalysisEnabled = true,
  canGenerateSuggestions = false,
  suggestionsError,
  emptyComposer,
  activityLoading,
  checkingStandingId,
  standingFeedback,
  modelReady,
  pendingTask,
  onRetry,
  onRerun,
  onChangeAnalysisService,
  onManageAnalysisServices,
  onOpenSettings,
  onOpenProcessingSettings,
  onGenerateSuggestions,
  onOpenData,
  onOpenUnderstanding,
  onUsePrompt,
  onRunPrompt,
  onOpenReport,
  focusAnalysisRunId,
  onReportFocused,
  onRetryConversation,
  onCheckStanding,
  onConfirm,
  onContinuePending,
  onEditPending,
}: MessageListProps) {
  const t = useTranslations("messageList");
  const {parentRef, virtualizer, virtualItems, totalSize, isNearLatest, hasNewProgress, scrollToLatest, handleTimelineScroll} = useInvestigationTimeline({messages, pendingTask, focusAnalysisRunId, onReportFocused});
  const messageEntries = messages.map((message, index) => ({message, index}));

  if (pendingTask) {
    return (
      <PendingTaskReport
        task={pendingTask}
        modelReady={modelReady}
        onOpenSettings={onOpenSettings}
        onContinue={onContinuePending}
        onEdit={onEditPending}
      />
    );
  }

  if (conversationLoading || conversationLoadError) {
    return <ConversationStatus loading={conversationLoading} error={conversationLoadError} onRetry={onRetryConversation} />;
  }

  if (messages.length === 0) {
    return (
      <ChatEmptyState
        project={project}
        sources={sources}
        standingAnalyses={standingAnalyses}
        recentRuns={recentRuns}
        suggestedQuestions={suggestedQuestions}
        suggestionsLoading={suggestionsLoading}
        settingsLoaded={settingsLoaded}
        selfAnalysisEnabled={selfAnalysisEnabled}
        canGenerateSuggestions={canGenerateSuggestions}
        suggestionsError={suggestionsError}
        composer={emptyComposer}
        activityLoading={activityLoading}
        checkingStandingId={checkingStandingId}
        standingFeedback={standingFeedback}
        onOpenData={onOpenData}
        onOpenSettings={onOpenProcessingSettings || onOpenSettings}
        onGenerateSuggestions={onGenerateSuggestions || (() => undefined)}
        onUsePrompt={onUsePrompt}
        onOpenReport={onOpenReport}
        onCheckStanding={onCheckStanding}
      />
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-background">
      <div
        aria-label={t("timelineAria")}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={handleTimelineScroll}
        ref={parentRef}
        role="region"
        tabIndex={0}
      >
        <div style={{ height: `${totalSize}px`, position: "relative" }}>
          {virtualItems.map((virtualItem) => {
            const entry = messageEntries[virtualItem.index];
            const message = entry.message;
            const messageIndex = entry.index;

            return (
              <div
                key={message.id || `${message.role}-${messageIndex}`}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <div className="mx-auto flex max-w-[1080px] gap-5 px-7 py-6">
                  {message.role === "assistant" && (
                    <div className="mt-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/5">
                      <Search size={17} className="text-primary" />
                    </div>
                  )}

                  {message.role === "assistant" ? (
                    message.isLoading ? (
                      <div data-testid="assistant-loading-message" className="min-w-0 flex-1">
                        <AnalysisProgress
                          state={message.analysisState}
                          stage={message.thinkingStage}
                          pending
                          finalizing={Boolean(message.report)}
                        />
                      </div>
                    ) : (
                      <AssistantMessageCard
                        message={message}
                        index={messageIndex}
                        onRetry={(idx) => void onRetry(idx)}
                        onRerun={(idx) => void onRerun(idx)}
                        onUsePrompt={onUsePrompt}
                        onRunPrompt={onRunPrompt || onUsePrompt}
                        onConfirm={onConfirm}
                        onOpenData={onOpenData}
                        onOpenUnderstanding={onOpenUnderstanding}
                        onChangeAnalysisService={onChangeAnalysisService}
                        onManageAnalysisServices={onManageAnalysisServices}
                      />
                    )
                  ) : (
                    <div className="min-w-0 w-full max-w-[920px] rounded-xl border border-border bg-card px-5 py-4">
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        {t("taskLabel")}
                      </div>
                      <ReactMarkdown className="prose prose-sm max-w-none text-foreground">
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {!isNearLatest && (
        <div
          aria-live="polite"
          className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2"
        >
          <Button variant="outline"
            aria-label={hasNewProgress ? t("returnLatestNewAria") : t("returnLatestAria")}
            className="pointer-events-auto gap-2 shadow-sm"
            onClick={scrollToLatest}
            type="button"
          >
            {hasNewProgress && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-primary" />}
            <span>{hasNewProgress ? t("newProgress") : t("jumpToLatest")}</span>
            <ArrowDown aria-hidden="true" size={14} />
          </Button>
        </div>
      )}
    </div>
  );
}
