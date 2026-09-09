"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { ComposerDraft } from "@/lib/composer-drafts";
import { PromptInsertionDialog } from "./PromptInsertionDialog";

type PendingInsertion = {
  scope: string;
  expected: ComposerDraft;
  prompt: string;
  onApplied?: () => void;
};
type Options = {
  scope: string;
  draft: ComposerDraft;
  blocked: boolean;
  canApply: () => boolean;
  replaceInput: (expected: ComposerDraft, text: string) => boolean;
  onFocusComposer: () => void;
};

export function appendPrompt(current: string, prompt: string) {
  if (!current.trim()) return prompt;
  // Keep the existing text exactly, including trailing spaces and line breaks.
  return current + (/\n\s*\n\s*$/.test(current) ? "" : /\n\s*$/.test(current) ? "\n" : "\n\n") + prompt;
}

/** A foreground editing action, never a send/retry operation. */
export function usePromptInsertion(options: Options) {
  const [pending, setPending] = useState<PendingInsertion | null>(null);
  const current = useRef(options), intent = useRef(pending), mounted = useRef(false);
  const visible = pending && !options.blocked && pending.scope === options.scope
    && pending.expected.revision === options.draft.revision && pending.expected.text === options.draft.text;
  if (pending && !visible) setPending(null);
  useLayoutEffect(() => { current.current = options; intent.current = visible ? pending : null; });
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; intent.current = null; }; }, []);
  const clear = () => { intent.current = null; setPending(null); };

  const request = (prompt: string, onApplied?: () => void) => {
    const latest = current.current;
    if (!mounted.current || !prompt.trim() || latest.blocked || !latest.canApply() || intent.current) return;
    if (!latest.draft.text.trim() || latest.draft.text === prompt) {
      if (latest.replaceInput(latest.draft, prompt)) { onApplied?.(); latest.onFocusComposer(); }
      return;
    }
    const next = { scope: latest.scope, expected: latest.draft, prompt, onApplied };
    intent.current = next; setPending(next);
  };
  const apply = (mode: "append" | "replace") => {
    const selected = intent.current, latest = current.current;
    if (!mounted.current || !selected) return;
    clear();
    if (latest.blocked || !latest.canApply() || selected.scope !== latest.scope) return;
    const text = mode === "append" ? appendPrompt(selected.expected.text, selected.prompt) : selected.prompt;
    // The store comparison also covers writes that happened before React rendered.
    if (!latest.replaceInput(selected.expected, text)) return;
    selected.onApplied?.(); latest.onFocusComposer();
  };

  return {
    request,
    dialog: visible && pending ? <PromptInsertionDialog current={pending.expected.text} incoming={pending.prompt}
      onCancel={clear} onAppend={() => apply("append")} onReplace={() => apply("replace")}
      onFallbackFocus={() => current.current.onFocusComposer()}
      canReturn={() => mounted.current && current.current.scope === pending.scope && current.current.canApply()} /> : null,
  };
}
