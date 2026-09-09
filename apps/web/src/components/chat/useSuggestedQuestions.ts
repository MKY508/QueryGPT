"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { ProjectDataSource, SuggestedQuestion } from "@/lib/types/api";

interface Options {
  projectId: string | null;
  modelId: string | null;
  locale: string;
  sources: ProjectDataSource[];
  contextRevision: number;
  enabled: boolean;
}
interface SuggestionState {
  scope: string;
  items: SuggestedQuestion[];
  generated: boolean;
  loading: boolean;
  failed: boolean;
}
interface Request {
  scope: string;
  projectId: string;
  modelId: string | null;
  locale: "zh" | "en";
  controller: AbortController;
}
const empty = (scope: string): SuggestionState => ({ scope, items: [], generated: false, loading: false, failed: false });

export function suggestionScope(options: Options) {
  return JSON.stringify([options.projectId, options.modelId, options.locale === "en" ? "en" : "zh", options.contextRevision, options.enabled,
    options.sources.map(source => [source.id, source.updated_at, source.fingerprint, source.status, source.profile_data?.is_current])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
}

export function readSuggestedQuestions(value: unknown): SuggestedQuestion[] {
  if (!value || typeof value !== "object" || !("items" in value) || !Array.isArray(value.items) || value.items.length > 3) throw new Error("Invalid suggestions");
  return value.items.map(item => {
    if (!item || typeof item !== "object" || !["label", "prompt", "reason"].every(key => typeof item[key] === "string" && item[key].trim())) throw new Error("Invalid suggestion");
    return { label: item.label, prompt: item.prompt, reason: item.reason };
  });
}

/** Manual generation only. Reopening or reconnecting never generates questions. */
export function useSuggestedQuestions(options: Options) {
  const scope = suggestionScope(options);
  const [state, setState] = useState(() => empty(scope));
  if (state.scope !== scope) setState(empty(scope));
  const latest = useRef({ options, scope }), request = useRef<Request | null>(null), mounted = useRef(false);
  useLayoutEffect(() => { latest.current = { options, scope }; });
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.controller.abort(); request.current = null; };
  }, [scope]);
  const { mutateAsync } = useMutation({
    retry: false,
    networkMode: "always",
    mutationFn: async (selected: Request) => {
      const response = await api.post(`/api/v1/projects/${selected.projectId}/suggested-questions`,
        { model_id: selected.modelId, locale: selected.locale }, { timeout: 20_000, signal: selected.controller.signal });
      return readSuggestedQuestions(response.data.data);
    },
  });
  const generate = async () => {
    const { options: current, scope: currentScope } = latest.current;
    if (!mounted.current || currentScope !== scope || request.current || !current.enabled || !current.projectId || !current.sources.length) return;
    const selected: Request = { scope: currentScope, projectId: current.projectId, modelId: current.modelId,
      locale: current.locale === "en" ? "en" : "zh", controller: new AbortController() };
    request.current = selected;
    setState(previous => ({ ...(previous.scope === selected.scope ? previous : empty(selected.scope)), loading: true, failed: false }));
    const isCurrent = () => mounted.current && request.current === selected && latest.current.scope === selected.scope && !selected.controller.signal.aborted;
    try {
      const items = await mutateAsync(selected);
      if (isCurrent()) setState({ scope: selected.scope, items, generated: true, loading: false, failed: false });
    } catch {
      if (isCurrent()) setState(previous => ({ ...previous, loading: false, failed: true }));
    } finally {
      if (request.current === selected) request.current = null;
    }
  };
  return { ...(state.scope === scope ? state : empty(scope)), generate };
}
