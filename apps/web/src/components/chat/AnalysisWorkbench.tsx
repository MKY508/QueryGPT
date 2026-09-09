"use client";

import { type ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpenText, Database, History, Loader2, PanelLeft, PanelLeftClose, MessageSquare, Plus, Square, X } from "lucide-react";
import Image from "next/image";
import { RECEIPTBI_BRAND_ICON_SRC } from "@/lib/brand";
import { WorkbenchNavigation } from "./WorkbenchNavigation";
import { useTranslations } from "next-intl";
import type { ChatMessage } from "@/lib/types/chat";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/SearchField";
import { useWorkbenchSearchShortcut } from "./useWorkbenchSearchShortcut";
import { useResultReadingPosition } from "./useResultReadingPosition";
import { useWorkbenchPaneFocus } from "./useWorkbenchPaneFocus";
import { InvestigationList } from "./InvestigationList";
import { EMPTY_RESULT_NAVIGATION, resultNavigationTarget, visitResult } from "@/lib/result-navigation";

import type { WorkbenchView } from "@/lib/workbench-pane";

interface AnalysisWorkbenchProps {
  messages: ChatMessage[];
  header?: ReactNode;
  navigation?: ReactNode;
  notice?: ReactNode;
  composer: ReactNode;
  emptyContent: ReactNode;
  dataContent: ReactNode;
  renderResult: (message: ChatMessage, index: number) => ReactNode;
  view: WorkbenchView;
  onViewChange: (view: WorkbenchView) => void;
  onNewAnalysis: () => void;
  onOpenHistory: () => void;
  busy?: boolean;
  activeStreamId?: string | null;
  stopping?: boolean;
  onStopStream?: (streamId: string) => void;
  showEmpty?: boolean;
  focusAnalysisRunId?: string | null;
  onReportFocused?: () => void;
  onVisibleReportChange?: (analysisRunId: string | null) => void;
  focusComposerRequest?: number;
}

// Presentation only: selection never loads a conversation or submits a prompt.
// A single navigation column follows Twenty; the result owns the main surface.
export function analysisEntries(messages: ChatMessage[]) {
  let prompt = "";
  return messages.flatMap((message, index) => {
    if (message.role === "user") prompt = message.content;
    if (message.role !== "assistant") return [];
    // A confirmation answer is not the investigation's title. A resumed run
    // can also produce several messages: run identity is not message identity.
    return [{ message, index, title: message.originalQuery?.trim() || prompt.trim() || message.report?.title?.trim() || message.content,
      key: message.streamId ? `stream:${message.streamId}` : message.id ? `saved:${message.id}` : `message-${index}` }];
  });
}

export function AnalysisWorkbench({ messages, header, navigation: workspaceNavigation, notice, composer, emptyContent, dataContent, renderResult,
  view, onViewChange, onNewAnalysis, onOpenHistory, busy = false, showEmpty = false,
  focusAnalysisRunId, onReportFocused, onVisibleReportChange, focusComposerRequest = 0,
  activeStreamId, stopping = false, onStopStream }: AnalysisWorkbenchProps) {
  const t = useTranslations("workbench");
  const ta = useTranslations("investigationActivity");
  const id = useId();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [reading, setReading] = useState({ visitedKeys: [] as string[], navigation: EMPTY_RESULT_NAVIGATION });
  const { visitedKeys, navigation } = reading;
  const [search, setSearch] = useState("");
  const [focused, setFocused] = useState(false);
  const navigationOpen = !focused;
  const closeNavigation = () => setFocused(true);
  const container = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const conversation = useRef<HTMLElement>(null);
  const navigationTrigger = useRef<HTMLButtonElement>(null);
  const composerContainer = useRef<HTMLDivElement>(null);
  const lastComposerRequest = useRef(focusComposerRequest);
  const lastRunControl = useRef<HTMLElement | null>(null);
  const entries = useMemo(() => analysisEntries(messages), [messages]);
  const { entryKeys, entryKeySignature } = useMemo(() => {
    const keys = new Set(entries.map(entry => entry.key));
    return { entryKeys: keys, entryKeySignature: JSON.stringify([...keys]) };
  }, [entries]);
  const latest = entries.at(-1);
  const focusEntryKey = focusAnalysisRunId
    ? entries.findLast(entry => entry.message.analysisRunId === focusAnalysisRunId)?.key || null : null;
  const focusLocation = JSON.stringify([focusAnalysisRunId || null, focusEntryKey]);
  const [lastFocusLocation, setLastFocusLocation] = useState<string | null>(null);
  if (lastFocusLocation !== focusLocation) {
    setLastFocusLocation(focusLocation);
    if (focusEntryKey) {
      setSelectedKey(focusEntryKey);
    }
  }
  const selected = entries.find((entry) => entry.key === selectedKey) || latest;
  const active = activeStreamId ? entries.find(entry => entry.message.isLoading && entry.message.streamId === activeStreamId) : undefined;
  const tabs = [{ key: "result" as const, label: t("result"), icon: MessageSquare },
    { key: "sources" as const, label: t("data"), icon: Database },
    { key: "understanding" as const, label: t("understanding"), icon: BookOpenText }];

  const visibleRunId = selected?.message.analysisRunId || null;
  const canNavigate = !showEmpty && (!focusAnalysisRunId || visibleRunId === focusAnalysisRunId);
  // Reconcile only an actual result view. Streaming updates to the same result
  // and a canvas hidden behind the data tab do not create extra visits.
  if (canNavigate && view === "result" && selected && navigation.keys[navigation.index] !== selected.key) {
    setReading({ navigation: visitResult(navigation, selected.key),
      visitedKeys: visitedKeys.includes(selected.key) ? visitedKeys : [...visitedKeys, selected.key] });
  }
  const back = canNavigate ? resultNavigationTarget(navigation, -1, entryKeys) : null;
  const forward = canNavigate ? resultNavigationTarget(navigation, 1, entryKeys) : null;
  useResultReadingPosition(canvas, selected?.key || null, view === "result" && canNavigate,
    String(navigationOpen), entryKeySignature);
  const requestPaneFocus = useWorkbenchPaneFocus(canvas, panel, composerContainer, navigationTrigger);
  useLayoutEffect(() => {
    const previous = lastRunControl.current;
    if (!previous || previous.isConnected) return;
    lastRunControl.current = null;
    if (document.activeElement === document.body) panel.current?.focus({ preventScroll: true });
  }, [active?.key]);
  useEffect(() => {
    // Do not report the previous canvas while an external history selection is
    // still being located in the arriving conversation messages.
    if (showEmpty || (focusAnalysisRunId && visibleRunId !== focusAnalysisRunId)) return;
    onVisibleReportChange?.(visibleRunId);
  }, [focusAnalysisRunId, visibleRunId, onVisibleReportChange, showEmpty]);

  useEffect(() => {
    if (!focusAnalysisRunId || !focusEntryKey) return;
    onViewChange("result");
    onReportFocused?.();
  }, [focusAnalysisRunId, focusEntryKey, onReportFocused, onViewChange]);

  useEffect(() => {
    if (focusComposerRequest === lastComposerRequest.current) return;
    lastComposerRequest.current = focusComposerRequest;
    requestPaneFocus("composer");
  }, [focusComposerRequest, requestPaneFocus]);

  useWorkbenchSearchShortcut(container, searchInput, () => {
    setFocused(false);
  });

  const selectEntry = (key: string) => {
    requestPaneFocus("result");
    setSelectedKey(key === latest?.key ? null : key);
    onViewChange("result");
  };
  const continueQuestion = () => {
    requestPaneFocus("composer");
  };
  const revisit = (index: number | null) => {
    if (index === null || !canNavigate) return;
    const key = navigation.keys[index];
    if (!entryKeys.has(key)) return;
    setReading((current) => ({ ...current, navigation: { ...current.navigation, index } }));
    // A history visit pins this exact result, including one that happens to be
    // latest. Only the explicit latest action/list entry resumes live following.
    setSelectedKey(key);
    onViewChange("result");
  };

  return (
    <div ref={container} className="analysis-workbench" data-focused={focused}>
      <WorkbenchNavigation open={navigationOpen} label={t("navigation")}
        panelRef={conversation} triggerRef={navigationTrigger} onClose={closeNavigation}>
        <div className="workbench-brand">
          <Image src={RECEIPTBI_BRAND_ICON_SRC} width={27} height={27} unoptimized alt="" />
          <span>ReceiptBI</span>
          <Button size="icon" variant="ghost" type="button" onClick={closeNavigation} className="workbench-icon-button ml-auto"
            aria-label={t("closeNavigation")}><X size={16} /></Button>
        </div>
        <Button variant="ghost" type="button" disabled={busy} onClick={() => { onNewAnalysis(); }}
          className="workbench-new-analysis justify-start"><Plus size={16} />{t("newAnalysis")}</Button>
        <div role="tablist" aria-orientation="vertical" aria-label={t("canvas")} className="workbench-sections">
          {tabs.map((tab, index) => <Button variant="ghost" key={tab.key} id={`${id}-${tab.key}`} type="button" role="tab"
            aria-selected={view === tab.key} aria-controls={`${id}-panel`} tabIndex={view === tab.key ? 0 : -1}
            onClick={() => { requestPaneFocus("result"); onViewChange(tab.key); }}
            onKeyDown={event => {
              if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowDown" ? 1 : 2)) % 3;
              onViewChange(tabs[next].key);
              document.getElementById(`${id}-${tabs[next].key}`)?.focus();
            }} className={cn("workbench-section justify-start", view === tab.key && "workbench-section-active")}>
            <tab.icon size={16} />{tab.label}
          </Button>)}
        </div>
        {workspaceNavigation && <div>{workspaceNavigation}</div>}
        <div className="workbench-history-heading">
          <h2>{t("conversation")}</h2>
          <Button size="icon" variant="ghost" type="button" onClick={() => { onOpenHistory(); }}
            className="workbench-icon-button" aria-label={t("allHistory")} title={t("allHistory")}><History size={15} /></Button>
        </div>
        <SearchField inputRef={searchInput} value={search} onChange={setSearch} label={t("search")} clearLabel={t("clearSearch")}
          className="mx-3 mb-2 shrink-0 rounded-md border border-transparent bg-muted/60 pl-2.5 pr-1 focus-within:border-primary/40"
          inputClassName="h-8 text-xs" />
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          <InvestigationList entries={entries} selectedKey={selected?.key} search={search} onSelect={selectEntry} />
        </div>
        {latest && selected?.key !== latest.key && <Button variant="ghost" type="button" onClick={() => selectEntry(latest.key)}
          className="mx-3 mb-3 rounded-lg bg-primary/10 px-3 py-2 text-xs font-medium text-primary">{latest.message.isLoading ? t("newProgress") : t("latest")}</Button>}
        <div className="workbench-sidebar-footer">
          <Button variant="ghost" type="button" onClick={() => { onOpenHistory(); }}><History size={14} />{t("allHistory")}</Button>
        </div>
      </WorkbenchNavigation>

      <section className="workbench-canvas" aria-label={t("canvas")}>
        <div className="workbench-topbar">
          <Button size="icon" variant="ghost" ref={navigationTrigger} type="button" onClick={() => {
            setFocused(value => !value);
          }} aria-expanded={navigationOpen} aria-label={t(navigationOpen ? "closeNavigation" : "openNavigation")}
            className="workbench-icon-button">{navigationOpen ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}</Button>
          {header || <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{t(view === "result" ? "canvas" : view === "sources" ? "data" : "understanding")}</h1>}
        </div>
        {notice}
        {active && <div data-testid="active-investigation-controls" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-primary/20 bg-primary/[0.04] px-7 py-2"
          onFocusCapture={event => { if (event.target instanceof HTMLElement) lastRunControl.current = event.target; }}>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Loader2 aria-hidden="true" size={14} className="shrink-0 animate-spin text-primary motion-reduce:animate-none" />
            <span className="shrink-0 text-xs font-medium text-primary" role="status">{ta(stopping ? "stopping" : "running")}</span>
            {(view !== "result" || selected?.key !== active.key) && <span className="min-w-0 truncate text-xs text-muted-foreground">{active.title || t("untitled")}</span>}
          </div>
          {(view !== "result" || selected?.key !== active.key || showEmpty) && <Button variant="ghost" type="button" onClick={() => selectEntry(active.key)}
            className="h-9 shrink-0 px-2 text-xs font-semibold text-primary hover:bg-primary/10">{ta("show")}</Button>}
          {onStopStream && <Button variant="ghost" type="button" disabled={stopping} onClick={() => { if (!stopping && active.message.streamId) onStopStream(active.message.streamId); }}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 border border-border bg-card px-3 text-xs font-medium hover:bg-muted disabled:cursor-wait disabled:opacity-50">
            <Square size={12} aria-hidden="true" />{ta("stop")}
          </Button>}
        </div>}
        <div className="workbench-body" data-empty={view === "result" && (showEmpty || !selected)}>
          <div ref={panel} id={`${id}-panel`} role="tabpanel" tabIndex={-1} aria-labelledby={`${id}-${view}`} className="flex min-h-0 flex-1 flex-col outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40">
            {view === "result" && selected && canNavigate && <nav aria-label={t("readingNavigation")} className="flex min-w-0 shrink-0 items-center gap-1 border-b border-border/60 px-7 py-1.5">
              <Button size="icon" variant="ghost" type="button" aria-label={t("previousResult")} aria-disabled={back === null} onClick={() => revisit(back)}
                title={back === null ? t("previousResult") : t("returnTo", { title: entries.find((entry) => entry.key === navigation.keys[back])?.title || t("untitled") })}
                className="workbench-icon-button aria-disabled:opacity-35"><ArrowLeft size={15} /></Button>
              <Button size="icon" variant="ghost" type="button" aria-label={t("nextResult")} aria-disabled={forward === null} onClick={() => revisit(forward)}
                title={forward === null ? t("nextResult") : t("returnTo", { title: entries.find((entry) => entry.key === navigation.keys[forward])?.title || t("untitled") })}
                className="workbench-icon-button aria-disabled:opacity-35"><ArrowRight size={15} /></Button>
              <span className="ml-2 min-w-0 flex-1 truncate text-xs text-muted-foreground" aria-live="polite" aria-atomic="true">{selected.title || t("untitled")}</span>
              {latest && selected.key !== latest.key && <Button variant="ghost" type="button" onClick={() => selectEntry(latest.key)} title={t("latest")}
                className="ml-2 h-9 shrink-0 rounded-md px-2 text-xs font-medium text-primary hover:bg-primary/10">{t("jumpToLatest")}</Button>}
              <Button variant="ghost" type="button" onClick={continueQuestion}
                className="ml-1 h-9 shrink-0 rounded-md border border-border px-2 text-xs font-medium hover:bg-muted">{t("continueQuestion")}</Button>
            </nav>}
            <div ref={canvas} role="region" aria-label={t("result")} tabIndex={-1} hidden={view !== "result"}
              className={cn("workbench-result outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40", view !== "result" && "!hidden")}>
              {showEmpty || !selected ? emptyContent : entries.filter((entry) => entry.key === selected.key || visitedKeys.includes(entry.key)).map((entry) => (
                <div key={entry.key} hidden={entry.key !== selected.key} className={cn("workbench-result-page", entry.key !== selected.key && "!hidden")}>
                  {renderResult(entry.message, entry.index)}
                </div>
              ))}
            </div>
            {dataContent}
          </div>
          <div ref={composerContainer} hidden={view !== "result"} className="workbench-composer">{composer}</div>
        </div>
      </section>
    </div>
  );
}
