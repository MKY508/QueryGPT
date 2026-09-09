"use client";

import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { composerDraftStore, type ComposerDraftScope } from "@/lib/composer-drafts";

export function useComposerDraft(projectId: string | null, conversationId: string | null, store = composerDraftStore) {
  const scope = useMemo<ComposerDraftScope | null>(() => projectId ? { projectId, conversationId } : null, [projectId, conversationId]);
  const snapshot = useCallback(() => store.get(scope), [scope, store]);
  const serverSnapshot = useCallback(() => store.get(null), [store]);
  const draft = useSyncExternalStore(store.subscribe, snapshot, serverSnapshot);
  const unretained = useSyncExternalStore(store.subscribe, store.hasUnretained, () => false);
  const unreadable = useSyncExternalStore(store.subscribe, store.hasUnreadable, () => false);
  useLayoutEffect(() => { if (scope) store.hydrate(scope); }, [scope, store]);
  return {
    input: draft.text,
    draft,
    replaceInput: (expected: typeof draft, text: string) => scope ? store.writeIfUnchanged(scope, expected, text) : false,
    setInput: (text: string) => { if (scope) store.write(scope, text); },
    // This closure deliberately belongs to the rendered draft, not whatever
    // project happens to be visible when a request eventually finishes.
    onAccepted: () => { if (scope) store.clearIfUnchanged(scope, draft); },
    unretained,
    unreadable,
    retryRetention: store.retryUnretained,
  };
}
