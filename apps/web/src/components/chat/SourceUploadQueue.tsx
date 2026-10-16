"use client";

import { UploadQueueView } from "@/components/uploads/UploadQueueView";
import { EMPTY_UPLOADS } from "@/lib/upload-state";
import { useProjectStore } from "@/lib/stores/project";
import { useUploadQueueStore } from "@/lib/stores/uploads";

export function SourceUploadQueue() {
  const projectId = useProjectStore(state => state.currentProjectId);
  return projectId ? <ProjectUploadQueue projectId={projectId} /> : null;
}

/** Bind every command to this queue, not whichever project is currently visible. */
export function ProjectUploadQueue({ projectId, label }: { projectId: string; label?: string }) {
  const queue = useUploadQueueStore(state => state.byProject[projectId] ?? EMPTY_UPLOADS);
  return <UploadQueueView key={projectId} queue={queue} label={label} actions={{
    resumeUploads: () => useProjectStore.getState().resumeUploads(projectId),
    pauseUploads: () => useProjectStore.getState().pauseUploads(projectId),
    retryUpload: id => useProjectStore.getState().retryUpload(id, projectId),
    checkUpload: id => useProjectStore.getState().checkUpload(id, projectId),
    reselectUpload: (id, file) => useProjectStore.getState().reselectUpload(id, file, projectId),
    cancelQueuedUpload: id => useProjectStore.getState().cancelQueuedUpload(id, projectId),
    cancelQueuedUploads: () => useProjectStore.getState().cancelQueuedUploads(projectId),
    clearUploads: () => useProjectStore.getState().clearUploads(projectId),
  }} />;
}
