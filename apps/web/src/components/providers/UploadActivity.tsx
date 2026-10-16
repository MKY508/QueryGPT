"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CircleAlert, Files, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UploadActivityWindow } from "@/components/uploads/UploadActivityWindow";
import { useShallow } from "zustand/react/shallow";
import { ProjectUploadQueue } from "@/components/chat/SourceUploadQueue";
import { useUploadQueueStore } from "@/lib/stores/uploads";
import { refreshUploadRecovery, subscribeUploadRecovery, useProjectStore } from "@/lib/stores/project";
import type { UploadSnapshot } from "@/lib/upload-state";

export function uploadActivitySummary(
  byProject: Record<string, UploadSnapshot>,
) {
  let pending = 0;
  let running = false;
  let attention = false;
  let visible = false;
  for (const queue of Object.values(byProject)) {
    visible ||= queue.items.length > 0 || queue.notice !== null;
    attention ||= queue.notice !== null;
    for (const item of queue.items) {
      const active = item.status === "preparing" || item.verifying || item.status === "uploading" || item.status === "saving";
      if (active || item.status === "queued") pending++;
      running ||= active;
      attention ||= item.status === "failed" || item.status === "uncertain";
    }
  }
  return { pending, running, attention, visible };
}

function UploadActivityDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("dataWorkspace.uploadQueue");
  const recovery = useUploadQueueStore((state) => state.recovery);
  const projectIds = useUploadQueueStore(
    useShallow((state) =>
      Object.keys(state.byProject).filter((id) => {
        const queue = state.byProject[id];
        return queue.items.length > 0 || queue.notice !== null;
      }),
    ),
  );
  const projects = useProjectStore((state) => state.projects);
  const [selectedId, setSelectedId] = useState(() => {
    const queues = useUploadQueueStore.getState().byProject;
    return (
      projectIds.find((id) => {
        const summary = uploadActivitySummary({ [id]: queues[id] });
        return summary.pending > 0 || summary.attention;
      }) ?? projectIds[0]
    );
  });
  const projectId = projectIds.includes(selectedId)
    ? selectedId
    : projectIds[0];
  const projectName = (id: string) =>
    projects.find((project) => project.id === id)?.name ||
    t("unnamedProject", { number: projectIds.indexOf(id) + 1 });

  return (
    <UploadActivityWindow projectName={projectId ? projectName(projectId) : ""} onClose={onClose}>
        {recovery === "error" && <div className="mb-3 text-xs">
          <p role="alert" className="text-destructive">{t("recoveryFailed")}</p>
          <Button variant="outline" size="sm" type="button" onClick={() => void refreshUploadRecovery()} className="mt-2">{t("reloadRecovery")}</Button>
        </div>}
        {recovery === "loading" && <p role="status" className="mb-3 text-xs text-muted-foreground">{t("loadingRecovery")}</p>}
        {projectIds.length > 1 ? (
          <label className="flex items-center gap-3 text-xs">
            {t("project")}
            <select
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2"
              value={projectId}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              {projectIds.map((id) => (
                <option key={id} value={id}>
                  {projectName(id)}
                </option>
              ))}
            </select>
          </label>
        ) : projectId ? (
          <p className="break-words text-xs font-medium">
            {projectName(projectId)}
          </p>
        ) : null}
        {projectId ? (
          <ProjectUploadQueue
            projectId={projectId}
            label={t("projectImports", { name: projectName(projectId) })}
          />
        ) : recovery === "ready" ? (
          <p role="status" className="py-5 text-sm text-muted-foreground">
            {t("empty")}
          </p>
        ) : null}
    </UploadActivityWindow>
  );
}

/** Root-owned access survives route changes; opening it never changes the project. */
export function UploadActivity() {
  const t = useTranslations("dataWorkspace.uploadQueue");
  const [open, setOpen] = useState(false);
  const recovery = useUploadQueueStore((state) => state.recovery);
  useEffect(() => subscribeUploadRecovery(), []);
  // Percentage changes rerender the selected file list, not this global trigger.
  const summary = useUploadQueueStore(
    useShallow((state) => uploadActivitySummary(state.byProject)),
  );
  // Keep the trigger and empty dialog until dismissal, so clearing the final queue
  // does not unexpectedly move keyboard focus or close the user's open panel.
  if (!summary.visible && !open && recovery !== "error") return null;
  const attention = summary.attention || recovery === "error";
  return (
    <>
      <Button variant="outline"
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("open")}
        className="report-screen-view fixed bottom-4 right-4 z-40 max-w-80 bg-card text-xs shadow-md"
      >
        {attention ? (
          <CircleAlert size={14} aria-hidden="true" />
        ) : summary.running ? (
          <Loader2
            size={14}
            aria-hidden="true"
            className="motion-safe:animate-spin"
          />
        ) : (
          <Files size={14} aria-hidden="true" />
        )}
        <span role="status" aria-atomic="true">
          {summary.pending
            ? t("pendingSummary", { count: summary.pending })
            : attention
              ? t("needsAttention")
              : t("title")}
        </span>
      </Button>
      {open && <UploadActivityDialog onClose={() => setOpen(false)} />}
    </>
  );
}
