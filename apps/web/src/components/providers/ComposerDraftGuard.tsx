"use client";

import { useEffect, useSyncExternalStore } from "react";
import { composerDraftStore } from "@/lib/composer-drafts";

/** Keep failed-retention protection active after leaving the chat workspace. */
export function ComposerDraftGuard({ store = composerDraftStore }: { store?: typeof composerDraftStore }) {
  const unretained = useSyncExternalStore(store.subscribe, store.hasUnretained, () => false);
  useEffect(() => {
    if (!unretained) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unretained]);
  return null;
}
