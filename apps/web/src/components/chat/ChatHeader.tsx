"use client";

import { BookOpenText, ChevronDown, Database } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Project } from "@/lib/types/api";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface ChatHeaderProps {
  onToggleData: () => void;
  onOpenUnderstanding?: () => void;
  project?: Project;
  readySources: number;
  totalSources: number;
  pendingUnderstandingCount?: number;
  onOpenProjects?: () => void;
  workspaceActions?: ReactNode;
}
export function ChatHeader({
  onToggleData,
  onOpenUnderstanding,
  project,
  readySources,
  totalSources,
  pendingUnderstandingCount = 0,
  onOpenProjects,
  workspaceActions,
}: ChatHeaderProps) {
  const t = useTranslations("chatHeader");
  const tw = useTranslations("workbench");
  const dataReady = readySources > 0;
  const hasPendingUnderstanding = pendingUnderstandingCount > 0;
  return (
    <header className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="min-w-0">
            {project && onOpenProjects ? <Button variant="ghost" size="sm" onClick={onOpenProjects} aria-haspopup="dialog"
              aria-label={t("switchProject", { name: project.name })} className="max-w-full justify-start text-left text-[13px] font-semibold text-foreground">
              <span className="truncate">{project.name}</span><ChevronDown size={13} className="shrink-0 text-muted-foreground" />
            </Button> : project ? <div className="truncate text-sm font-semibold">{project.name}</div> : <span className="text-sm font-medium">ReceiptBI</span>}
            {dataReady ? (
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                {t("readySources", { count: readySources })}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {hasPendingUnderstanding && onOpenUnderstanding && <Button variant="ghost" onClick={onOpenUnderstanding}
            aria-label={`${tw("understanding")} · ${t("pendingReview", { count: pendingUnderstandingCount })}`}>
            <BookOpenText size={16} className="text-warning" />
            <span>{t("pendingReview", {count: pendingUnderstandingCount})}</span>
          </Button>}
          <Button variant="outline" onClick={onToggleData}
            aria-label={`${t("data")}${totalSources > 0 ? ` ${totalSources}` : ""}`}>
            <Database size={16} className="text-primary" />
            <span>{t("data")}</span>
            {totalSources > 0 && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">{totalSources}</span>}
          </Button>
          {workspaceActions}
        </div>
      </div>
    </header>
  );
}
