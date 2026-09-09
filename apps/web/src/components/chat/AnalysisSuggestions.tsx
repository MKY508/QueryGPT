"use client";

import {Button} from "@/components/ui/button";
import { useId } from "react";
import { ArrowUpRight, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import type { SuggestedQuestion } from "@/lib/types/api";

export function AnalysisSuggestions({ items, generated, loading, failed, settingsLoaded, canGenerate, onGenerate, onUsePrompt }: {
  items: SuggestedQuestion[];
  generated: boolean;
  loading: boolean;
  failed: boolean;
  settingsLoaded: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
  onUsePrompt: (prompt: string) => void;
}) {
  const t = useTranslations("chatEmpty"), id = useId();
  const hasItems = items.length > 0;
  const pending = loading || !settingsLoaded;
  const action = failed ? t("retrySuggestions") : generated || hasItems ? t("refreshSuggestions") : t("generateSuggestions");
  return <section data-testid="analysis-suggestions" aria-labelledby={`${id}-title`} className="mt-10 max-w-[920px] border-t border-border pt-5">
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <h2 id={`${id}-title`} className="text-sm font-semibold text-foreground">{t("suggestionsTitle")}</h2>
      <Button variant="ghost" type="button" onClick={onGenerate} disabled={!canGenerate || pending} aria-controls={`${id}-items`}
        data-testid="suggestions-generate"
        className="gap-2 text-xs">
        {pending ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : generated || hasItems ? <RefreshCw size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
        {pending ? t(settingsLoaded ? "loadingSuggestions" : "loadingSuggestionSettings") : action}
      </Button>
    </header>
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {pending ? t(settingsLoaded ? "loadingSuggestions" : "loadingSuggestionSettings") : generated && !failed ? t("suggestionsCount", { count: items.length }) : ""}
    </div>
    {failed && <p role="alert" className="mt-2 text-sm leading-6 text-destructive">{t(hasItems ? "suggestionsRefreshFailed" : "suggestionsFailed")}</p>}
    <div id={`${id}-items`} className="mt-3">
      {hasItems ? <ol className="grid grid-cols-3 gap-3">
        {items.map((suggestion, index) => <li key={`${suggestion.prompt}-${index}`} className="min-w-0">
          <Button variant="ghost" type="button" onClick={() => onUsePrompt(suggestion.prompt)} aria-labelledby={`${id}-${index}-label`} aria-describedby={`${id}-${index}-reason`}
            className="group flex h-full min-h-40 w-full flex-col items-start justify-start rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-primary/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
            <span className="mb-4 flex w-full items-center justify-between text-primary"><span className="font-mono text-[11px]" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><ArrowUpRight size={15} aria-hidden="true" /></span>
            <span id={`${id}-${index}-label`} className="text-sm font-semibold leading-6 text-foreground [overflow-wrap:anywhere]">{suggestion.label}</span>
            <span id={`${id}-${index}-reason`} className="mt-2 text-xs leading-6 text-muted-foreground [overflow-wrap:anywhere]">{suggestion.reason}</span>
          </Button>
        </li>)}
      </ol> : pending ? <div aria-hidden="true" className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map(index => <div key={index} className="rounded-xl border border-border bg-card p-4"><div className="h-2 w-8 rounded bg-muted" /><div className="mt-5 h-3 w-3/4 rounded bg-muted" /><div className="mt-3 h-2 w-full rounded bg-muted" /><div className="mt-2 h-2 w-2/3 rounded bg-muted" /></div>)}
      </div> : !failed ? <p className="rounded-xl border border-dashed border-border px-4 py-5 text-sm leading-6 text-muted-foreground">{t(generated ? "suggestionsEmpty" : "suggestionsRequireClick")}</p> : null}
    </div>
  </section>;
}
