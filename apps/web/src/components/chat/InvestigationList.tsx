"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Loader2, MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ChatMessage } from "@/lib/types/chat";
import { cn } from "@/lib/utils";
import { textSearchExcerpt } from "@/lib/text-search-excerpt";
import { Button } from "@/components/ui/button";

interface InvestigationEntry {
  key: string;
  index: number;
  title: string;
  message: ChatMessage;
}

export function groupInvestigationEntries(entries: InvestigationEntry[]) {
  const groups = new Map<string, InvestigationEntry[]>();
  for (const entry of entries) {
    const key = entry.message.analysisRunId
      ? JSON.stringify(["run", entry.message.projectId || null, entry.message.analysisRunId])
      : JSON.stringify(["message", entry.key]);
    const group = groups.get(key) || [];
    group.push(entry);
    // Reinsert so group order follows its most recent result, not its start.
    groups.delete(key);
    groups.set(key, group);
  }
  return [...groups].reverse().map(([key, items]) => ({
    key, latest: items[items.length - 1], earlier: items.slice(0, -1).reverse(),
  }));
}

export function InvestigationList({ entries, selectedKey, search, onSelect }: {
  entries: InvestigationEntry[];
  selectedKey?: string;
  search: string;
  onSelect: (key: string) => void;
}) {
  const t = useTranslations("workbench"), tc = useTranslations("businessConfirmation");
  const id = useId();
  const root = useRef<HTMLOListElement>(null);
  const focusedEntry = useRef<{ key: string; element: HTMLElement } | null>(null);
  const groups = useMemo(() => groupInvestigationEntries(entries), [entries]);
  const selectedGroup = groups.find(group => group.earlier.some(entry => entry.key === selectedKey));
  const selectionLocation = selectedGroup ? JSON.stringify([selectedGroup.key, selectedKey, selectedGroup.latest.key]) : null;
  const [lastLocation, setLastLocation] = useState(selectionLocation);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(selectedGroup ? [selectedGroup.key] : []));
  // Reveal a newly selected older result, including one reached using back /
  // forward. Explicit collapse remains possible until that location changes.
  if (lastLocation !== selectionLocation) {
    setLastLocation(selectionLocation);
    if (selectedGroup) setExpanded(current => new Set([...current, selectedGroup.key]));
  }
  const terms = search.normalize("NFKC").trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const searching = terms.length > 0;
  const searchText = useMemo(() => searching ? new Map(entries.map(entry => [entry,
    [entry.title, entry.message.report?.title, entry.message.report?.summary].filter(Boolean).join(" ").normalize("NFKC").toLocaleLowerCase(),
  ])) : null, [entries, searching]);
  const excerpt = terms.length ? textSearchExcerpt(terms, { before: 20, after: 40 }) : null;
  const matchCache = new Map<InvestigationEntry, boolean>();
  const matches = (entry: InvestigationEntry) => {
    if (!terms.length) return true;
    const cached = matchCache.get(entry);
    if (cached !== undefined) return cached;
    const text = searchText?.get(entry) || "";
    const matched = terms.every(term => text.includes(term));
    matchCache.set(entry, matched);
    return matched;
  };
  const visibleGroups = groups.filter(group => matches(group.latest) || group.earlier.some(matches));

  // A stream can acquire its run identity and move into an existing group.
  // Preserve keyboard focus only if the old row actually disappeared.
  useLayoutEffect(() => {
    const previous = focusedEntry.current;
    if (!previous || previous.element.isConnected || document.activeElement !== document.body) return;
    const replacement = [...(root.current?.querySelectorAll<HTMLElement>("[data-entry-key]") || [])]
      .find(element => element.dataset.entryKey === previous.key);
    const target = replacement?.closest("[hidden]")
      ? replacement.closest("[data-investigation-group]")?.querySelector<HTMLElement>("button[aria-expanded]")
      : replacement;
    target?.focus({ preventScroll: true });
  });

  const row = (entry: InvestigationEntry, number: number, earlier = false) => {
    const message = entry.message;
    const searchMatch = terms.length > 0 && matches(entry);
    const snippet = searchMatch && message.report?.summary ? excerpt?.(message.report.summary) : null;
    const displayedTitle = (earlier ? message.report?.title : entry.title) || entry.title || t("untitled");
    const status = message.isLoading ? t("running") : message.hasError ? t("needsAttention")
      : message.analysisState === "waiting_confirmation" ? message.confirmationResolved ? tc("confirmed") : t("waiting")
      : message.analysisState === "completed" ? t("completed") : t("question", { number });
    return <Button variant="ghost" key={entry.key} data-entry-key={entry.key} onClick={() => onSelect(entry.key)}
      aria-current={selectedKey === entry.key ? "true" : undefined}
      className={cn("workbench-entry block h-auto whitespace-normal text-left", earlier && "workbench-earlier-entry", selectedKey === entry.key && "workbench-entry-selected")}>
      <span className="flex items-start gap-2.5">
        {message.isLoading ? <Loader2 size={15} aria-hidden="true" className="mt-1 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
          : !earlier ? <MessageSquare size={15} aria-hidden="true" className="mt-1 shrink-0 text-muted-foreground" /> : null}
        <span className={cn("min-w-0 flex-1 break-words text-[13px] font-medium leading-5", !searchMatch && "line-clamp-2")}>{displayedTitle}</span>
      </span>
      {searchMatch && message.report?.title && message.report.title !== displayedTitle && <span className={cn("mt-2 block break-words text-xs font-medium", !earlier && "pl-6")}>{message.report.title}</span>}
      {searchMatch && message.report?.summary && <span className={cn("mt-2 block break-words text-xs leading-5 text-muted-foreground", !snippet && "line-clamp-3", !earlier && "pl-6")}>
        {snippet ? <>{snippet.before}<mark className="bg-primary/10 font-semibold text-foreground">{snippet.match}</mark>{snippet.after}</> : message.report.summary}
      </span>}
      <span className={cn("mt-2 flex items-center gap-1.5 text-xs text-muted-foreground", !earlier && "pl-6")}>
        {earlier && <><span>{t("recordNumber", { number })}</span><span aria-hidden="true">·</span></>}
        {message.analysisState === "completed" && !message.isLoading && <CheckCircle2 size={11} aria-hidden="true" />}{status}
      </span>
    </Button>;
  };

  if (!visibleGroups.length) return <p className="px-2 py-6 text-xs leading-6 text-muted-foreground">{terms.length ? t("noMatches") : t("emptyConversation")}</p>;
  return <ol ref={root} className="space-y-1" data-testid="investigation-list" onFocusCapture={event => {
    const element = (event.target as HTMLElement).closest<HTMLElement>("[data-entry-key]");
    focusedEntry.current = element ? { key: element.dataset.entryKey!, element } : null;
  }}>
    {visibleGroups.map((group, index) => {
      const earlier = group.earlier.flatMap((entry, index) => matches(entry)
        ? [{ entry, number: group.earlier.length - index }] : []);
      const open = terms.length > 0 || expanded.has(group.key);
      const disclosureId = `${id}-earlier-${index}`;
      return <li key={group.key} data-investigation-group className="min-w-0">
        {row(group.latest, index + 1)}
        {earlier.length > 0 && <>
          {terms.length ? <p className="px-4 py-2 text-[11px] text-muted-foreground">{t("matchingEarlier", { count: earlier.length })}</p>
            : <Button variant="ghost" aria-expanded={open} aria-controls={disclosureId}
              onClick={() => setExpanded(current => { const next = new Set(current); if (next.has(group.key)) next.delete(group.key); else next.add(group.key); return next; })}
              className="ml-2 max-w-[calc(100%-1rem)] justify-start gap-2 text-xs">
              <ChevronDown size={14} aria-hidden="true" className={cn("shrink-0 transition-transform motion-reduce:transition-none", !open && "-rotate-90")} />
              {t("earlierRecords", { count: earlier.length })}
            </Button>}
          <ol id={disclosureId} hidden={!open} className="ml-5 space-y-1 border-l border-border pl-3">
            {earlier.map(({ entry, number }) => <li key={entry.key}>{row(entry, number, true)}</li>)}
          </ol>
        </>}
      </li>;
    })}
  </ol>;
}
