export interface ComposerDraft { text: string; revision: number; retained: boolean }
export type ComposerDraftScope = { projectId: string; conversationId: string | null };
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const EMPTY: ComposerDraft = Object.freeze({ text: "", revision: 0, retained: true });
export const COMPOSER_DRAFT_PREFIX = "receiptbi-composer-draft-v1:";
export const composerDraftKey = (scope: ComposerDraftScope) => COMPOSER_DRAFT_PREFIX + JSON.stringify([scope.projectId, scope.conversationId]);

/** One draft per project/conversation, scoped to this browser tab. No network,
 * cross-tab overwrites, message delivery or automatic draft eviction. */
export function createComposerDraftStore(storage: () => DraftStorage | null) {
  const drafts = new Map<string, ComposerDraft>();
  const unreadable = new Set<string>();
  const listeners = new Set<() => void>();
  let revision = 0;
  const publish = (key: string, value: ComposerDraft) => {
    drafts.set(key, value); listeners.forEach(listener => listener());
    return value;
  };
  const get = (scope: ComposerDraftScope | null) => scope ? drafts.get(composerDraftKey(scope)) ?? EMPTY : EMPTY;
  const hydrate = (scope: ComposerDraftScope) => {
    const key = composerDraftKey(scope);
    if (drafts.has(key)) return;
    let text = "", retained = true;
    try {
      const target = storage();
      if (!target) throw new Error("Draft storage unavailable");
      const raw = target?.getItem(key);
      if (raw) {
        const saved: unknown = JSON.parse(raw);
        if (!saved || typeof saved !== "object" || Array.isArray(saved)
          || !("scope" in saved) || saved.scope !== key || !("text" in saved) || typeof saved.text !== "string") throw new Error("Invalid draft");
        text = saved.text;
      }
      unreadable.delete(key);
    } catch { retained = false; unreadable.add(key); }
    publish(key, { text, retained, revision: ++revision });
  };
  const write = (scope: ComposerDraftScope, text: string) => {
    const key = composerDraftKey(scope);
    const previous = drafts.get(key);
    unreadable.delete(key);
    let retained = false;
    try {
      const target = storage();
      if (target) {
        if (text) target.setItem(key, JSON.stringify({ scope: key, text }));
        else target.removeItem(key);
        // Silent failures must not be presented as retained drafts, including
        // failed deletion which could otherwise revive an already sent prompt.
        const actual = target.getItem(key);
        retained = text ? actual === JSON.stringify({ scope: key, text }) : actual === null;
      }
    } catch { /* Keep the current input available in memory. */ }
    return publish(key, { text, retained, revision: previous?.text === text ? previous.revision : ++revision });
  };
  return {
    get, hydrate, write,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    writeIfUnchanged(scope: ComposerDraftScope, expected: ComposerDraft, text: string) {
      const current = get(scope);
      if (current.revision !== expected.revision || current.text !== expected.text) return false;
      write(scope, text); return true;
    },
    clearIfUnchanged(scope: ComposerDraftScope, expected: ComposerDraft) {
      const current = get(scope);
      if (current.revision !== expected.revision || current.text !== expected.text) return false;
      write(scope, ""); return true;
    },
    hasUnreadable() { return unreadable.size > 0; },
    hasUnretained() { return [...drafts].some(([key, draft]) => !draft.retained && !unreadable.has(key)); },
    retryUnretained() {
      for (const [key, draft] of [...drafts]) {
        if (draft.retained) continue;
        const [projectId, conversationId] = JSON.parse(key.slice(COMPOSER_DRAFT_PREFIX.length)) as [string, string | null];
        if (unreadable.has(key)) { drafts.delete(key); hydrate({ projectId, conversationId }); }
        else write({ projectId, conversationId }, draft.text);
      }
    },
  };
}

export const composerDraftStore = createComposerDraftStore(() => {
  if (typeof window === "undefined") return null;
  return window.sessionStorage;
});
