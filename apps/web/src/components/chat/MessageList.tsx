"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  FileText,
  Loader2,
  PencilLine,
  Search,
  Settings2,
} from "lucide-react";
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
import { useMessageVirtualizer } from "@/lib/hooks/useMessageVirtualizer";
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

function PendingTaskReport({
  task,
  modelReady,
  onOpenSettings,
  onContinue,
  onEdit,
}: {
  task: string;
  modelReady: boolean;
  onOpenSettings: () => void;
  onContinue: () => void;
  onEdit: () => void;
}) {
  const t = useTranslations("messageList");
  return (
    <div className="flex flex-1 overflow-y-auto bg-background px-5 py-8">
      <article
        data-testid="pending-task-report"
        className="mx-auto w-full max-w-[1080px] border border-border bg-card"
      >
        <div className="grid min-h-[520px] lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="px-6 py-7 md:px-9 md:py-9">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-warning">
              <span className="h-2 w-2 bg-warning" />
              {t("pendingTaskTitle")}
            </div>
            <h1 className="mt-4 max-w-3xl text-3xl font-semibold leading-tight tracking-[-0.035em] text-foreground">
              {task}
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">
              {t("pendingTaskHint")}
            </p>

            <section className="mt-10 border-y border-border py-6">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center bg-primary/[0.07] text-primary">
                  <FileText size={18} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-foreground">{t("reportTitle")}</div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {t("reportHint")}
                  </p>
                </div>
              </div>
            </section>

            <div className="mt-7 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={modelReady ? onContinue : onOpenSettings}
                className="inline-flex items-center gap-2 bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {modelReady ? <ArrowRight size={16} /> : <Settings2 size={16} />}
                {modelReady ? t("continueOrPick") : t("pickService")}
              </button>
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex items-center gap-2 border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/50"
              >
                <PencilLine size={15} />
                {t("editTask")}
              </button>
            </div>
          </div>

          <aside className="border-t border-border bg-muted/25 px-6 py-7 lg:border-l lg:border-t-0">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t("currentProgress")}
            </div>
            <ol className="mt-5 space-y-5 text-sm">
              <li className="flex gap-3 text-foreground">
                <span className="mt-1.5 h-2 w-2 shrink-0 bg-success" />
                {t("understoodTask")}
              </li>
              <li className="flex gap-3 text-warning">
                <span className="mt-1.5 h-2 w-2 shrink-0 bg-warning" />
                {modelReady ? t("serviceReady") : t("waitingForService")}
              </li>
              <li className="flex gap-3 text-muted-foreground">
                <span className="mt-1.5 h-2 w-2 shrink-0 bg-border" />
                {t("dataOptional")}
              </li>
            </ol>
          </aside>
        </div>
      </article>
    </div>
  );
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
  const [isNearLatest, setIsNearLatest] = useState(true);
  const [hasNewProgress, setHasNewProgress] = useState(false);
  const isNearLatestRef = useRef(true);
  const previousMessagesRef = useRef<ChatMessage[] | null>(null);
  const messageEntries = messages.map((message, index) => ({ message, index }));

  // Virtual scrolling with dynamic heights
  const { parentRef, virtualizer, virtualItems, getTotalSize } =
    useMessageVirtualizer(messages);
  const totalSize = getTotalSize();

  const scrollToLatest = useCallback(() => {
    const scroller = parentRef.current;
    if (!scroller) return;

    scroller.scrollTop = scroller.scrollHeight;
    isNearLatestRef.current = true;
    setIsNearLatest(true);
    setHasNewProgress(false);
  }, [parentRef]);

  const handleTimelineScroll = useCallback(() => {
    const scroller = parentRef.current;
    if (!scroller) return;

    const nearLatest =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 96;
    isNearLatestRef.current = nearLatest;
    setIsNearLatest(nearLatest);
    if (nearLatest) setHasNewProgress(false);
  }, [parentRef]);

  // A newly opened conversation starts at its latest result. Later progress
  // follows only while the reader has kept the timeline at the bottom.
  useEffect(() => {
    if (pendingTask) return;

    const previousMessages = previousMessagesRef.current;
    previousMessagesRef.current = messages;

    if (messages.length === 0) {
      isNearLatestRef.current = true;
      setIsNearLatest(true);
      setHasNewProgress(false);
      return;
    }

    const openingConversation = previousMessages === null || previousMessages.length === 0;
    const latestMessageChanged =
      previousMessages !== null &&
      (messages.length > previousMessages.length ||
        messages[messages.length - 1] !== previousMessages[previousMessages.length - 1]);

    if (openingConversation || isNearLatestRef.current) {
      const frame = requestAnimationFrame(scrollToLatest);
      return () => cancelAnimationFrame(frame);
    }

    if (latestMessageChanged) setHasNewProgress(true);
  }, [messages, pendingTask, scrollToLatest]);

  // Dynamic report blocks and images can change height after the stream event
  // that created them. Keep following those measurements only at the bottom.
  useEffect(() => {
    if (pendingTask || !messages.length || !isNearLatestRef.current) return;
    const frame = requestAnimationFrame(scrollToLatest);
    return () => cancelAnimationFrame(frame);
  }, [messages.length, pendingTask, scrollToLatest, totalSize]);

  useEffect(() => {
    if (!focusAnalysisRunId || pendingTask || !messages.length) return;
    const targetIndex = messages.findIndex(
      (message) => message.analysisRunId === focusAnalysisRunId
    );
    if (targetIndex < 0) return;

    const frame = requestAnimationFrame(() => {
      virtualizer.scrollToIndex(targetIndex, { align: "center" });
      const targetIsLatest = targetIndex >= messages.length - 2;
      isNearLatestRef.current = targetIsLatest;
      setIsNearLatest(targetIsLatest);
      setHasNewProgress(false);
      onReportFocused?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusAnalysisRunId, messages, onReportFocused, pendingTask, virtualizer]);

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

  if (conversationLoading) {
    return (
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto bg-background px-5 py-12">
        <div className="flex w-full max-w-[920px] items-center gap-3 border-y border-border py-6 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin text-primary" />
          {t("openingReport")}
        </div>
      </div>
    );
  }

  if (conversationLoadError) {
    return (
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto bg-background px-5 py-12">
        <div
          role="alert"
          className="w-full max-w-[920px] border-l-2 border-warning bg-card px-5 py-5"
        >
          <div className="text-sm font-semibold text-foreground">{t("reportUnavailable")}</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{conversationLoadError}</p>
          {onRetryConversation && (
            <button
              type="button"
              onClick={onRetryConversation}
              className="mt-3 text-xs font-semibold text-primary hover:underline"
            >
              {t("reopen")}
            </button>
          )}
        </div>
      </div>
    );
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
                <div className="mx-auto flex max-w-[1080px] gap-4 px-5 py-6 sm:gap-5 sm:px-7">
                  {message.role === "assistant" && (
                    <div className="mt-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/5">
                      <Search size={17} className="text-primary" />
                    </div>
                  )}

                  {message.role === "assistant" ? (
                    message.isLoading ? (
                      <div data-testid="assistant-loading-message" className="w-full">
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
                    <div className="w-full max-w-[920px] border-y border-r border-border border-l-2 border-l-primary/60 bg-card px-5 py-4">
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
          <button
            aria-label={hasNewProgress ? t("returnLatestNewAria") : t("returnLatestAria")}
            className="pointer-events-auto inline-flex items-center gap-2 border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={scrollToLatest}
            type="button"
          >
            {hasNewProgress && <span aria-hidden="true" className="h-1.5 w-1.5 bg-primary" />}
            <span>{hasNewProgress ? t("newProgress") : t("jumpToLatest")}</span>
            <ArrowDown aria-hidden="true" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
