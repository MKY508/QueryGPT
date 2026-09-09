"use client";

import type { ReactNode } from "react";
import {Database, FileStack} from "lucide-react";
import { useTranslations } from "next-intl";
import type {
  Project,
  ProjectDataSource,
  StandingAnalysis,
  SuggestedQuestion,
} from "@/lib/types/api";
import {Button} from "@/components/ui/button";
import {WorkspaceActivitySummary} from "./WorkspaceActivitySummary";
import { AnalysisSuggestions } from "./AnalysisSuggestions";

interface ChatEmptyStateProps {
  project?: Project;
  sources: ProjectDataSource[];
  standingAnalyses: StandingAnalysis[];
  suggestedQuestions: SuggestedQuestion[];
  suggestionsGenerated?: boolean;
  suggestionsLoading: boolean;
  settingsLoaded: boolean;
  selfAnalysisEnabled: boolean;
  canGenerateSuggestions: boolean;
  suggestionsFailed?: boolean;
  composer: ReactNode;
  activityLoading: boolean;
  checkingStandingId?: string | null;
  standingFeedback?: Record<string, string>;
  onOpenData: () => void;
  onOpenSettings: () => void;
  onGenerateSuggestions: () => void;
  onUsePrompt: (prompt: string) => void;
  onOpenReport: (conversationId: string, analysisRunId: string) => void;
  onCheckStanding: (standing: StandingAnalysis) => void;
}

export function ChatEmptyState({
  project,
  sources,
  standingAnalyses,
  suggestedQuestions,
  suggestionsGenerated = false,
  suggestionsLoading,
  settingsLoaded,
  selfAnalysisEnabled,
  canGenerateSuggestions,
  suggestionsFailed = false,
  composer,
  checkingStandingId,
  standingFeedback = {},
  onOpenData,
  onGenerateSuggestions,
  onUsePrompt,
  onCheckStanding,
}: ChatEmptyStateProps) {
  const t = useTranslations("chatEmpty");

  const readySources = sources.filter((source) =>
    ["ready", "needs_confirmation"].includes(source.status)
  );
  return (
    <div
      data-testid="project-work-surface"
      className="min-h-0 flex-1 overflow-y-auto"
      aria-label={project?.name ? `${project.name}${t("workspaceTitle")}` : t("workspaceTitle")}
    >
      <div className="mx-auto min-h-full w-full max-w-[1060px] px-8 pb-10 pt-12">
        <section className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] font-medium text-muted-foreground">
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
              <span className="truncate">{project?.name || t("projectFallback")}</span>
              <span aria-hidden="true">·</span>
              <span>{t("workspaceTitle")}</span>
            </div>
            {readySources.length > 0 && (
              <Button variant="ghost" size="sm"
                type="button"
                onClick={onOpenData}
                className="gap-2"
              >
                {readySources.some((source) => source.kind === "connection") ? (
                  <Database size={13} />
                ) : (
                  <FileStack size={13} />
                )}
                {t("readySources", { count: readySources.length })}
              </Button>
            )}
          </div>

          <h1 className="workbench-welcome-title mt-8 max-w-3xl text-[40px] font-medium leading-[1.35] tracking-[-0.035em] text-foreground">
            {t("title")}
          </h1>

          <div className="mt-7">{composer}</div>
        </section>

        {readySources.length > 0 && (!settingsLoaded || selfAnalysisEnabled) && (
          <AnalysisSuggestions items={suggestedQuestions} generated={suggestionsGenerated} loading={suggestionsLoading}
            failed={suggestionsFailed} settingsLoaded={settingsLoaded} canGenerate={canGenerateSuggestions}
            onGenerate={onGenerateSuggestions} onUsePrompt={onUsePrompt} />
        )}

        <WorkspaceActivitySummary sources={sources} standingAnalyses={standingAnalyses} checkingStandingId={checkingStandingId}
          standingFeedback={standingFeedback} onOpenData={onOpenData} onCheckStanding={onCheckStanding} />
      </div>
    </div>
  );
}
