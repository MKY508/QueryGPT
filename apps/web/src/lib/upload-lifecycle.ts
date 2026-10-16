import { registerDesktopCloseGuard } from "@/lib/desktop-app-info";
import type { UploadSnapshot } from "@/lib/upload-state";
import { useUploadQueueStore } from "@/lib/stores/uploads";

export function hasUnfinishedUploads(
  byProject: Record<string, UploadSnapshot>,
): boolean {
  return Object.values(byProject).some((queue) =>
    queue.items.some(
      (item) =>
        item.status === "queued" ||
        item.status === "preparing" || item.verifying ||
        item.status === "uploading" ||
        item.status === "saving",
    ),
  );
}

/** One root subscription covers every project, including hidden/paused batches. */
export function subscribeToUploadLifecycle(): (() => void) | undefined {
  if (typeof window === "undefined") return undefined;
  const unfinished = () =>
    hasUnfinishedUploads(useUploadQueueStore.getState().byProject);
  const removeCloseGuard = registerDesktopCloseGuard(() =>
    unfinished() ? "uploads" : "clean",
  );
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!unfinished()) return;
    event.preventDefault();
    event.returnValue = true; // Browser compatibility; custom dialog text is not supported.
  };
  let listening = false;
  const sync = () => {
    const next = unfinished();
    if (next === listening) return;
    listening = next;
    if (next) window.addEventListener("beforeunload", beforeUnload);
    else window.removeEventListener("beforeunload", beforeUnload);
  };
  sync();
  const unsubscribe = useUploadQueueStore.subscribe(sync);
  return () => {
    unsubscribe();
    removeCloseGuard();
    if (listening) window.removeEventListener("beforeunload", beforeUnload);
    listening = false;
  };
}
