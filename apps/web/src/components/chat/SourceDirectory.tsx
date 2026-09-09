"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, Database, FileSpreadsheet } from "lucide-react";
import { useTranslations } from "next-intl";
import type { PreflightReport, ProjectDataSource } from "@/lib/types/api";
import { currentSourceVersionLinks, sourceDirectoryGroup, sourceDirectoryMatches, type SourceDirectoryFilter } from "@/lib/source-directory";
import { SourceStatus } from "./SourceStatus";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/SearchField";
import styles from "./SourceDirectory.module.css";

const PAGE_SIZE = 20;
const FILTERS: SourceDirectoryFilter[] = ["all", "attention", "ready", "history"];
type FocusRequest = { kind: "detail"; id: string } | { kind: "row"; id: string };

export function SourceDirectory({ sources, reports, children }: {
  sources: ProjectDataSource[];
  reports: PreflightReport[];
  children: (source: ProjectDataSource) => ReactNode;
}) {
  const t = useTranslations("sourceDirectory");
  const dataT = useTranslations("dataWorkspace");
  const headingId = useId();
  const detailId = useId();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SourceDirectoryFilter>("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [versionReturn, setVersionReturn] = useState<{
    fromId: string; toId: string; query: string; filter: SourceDirectoryFilter; limit: number;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const detailRef = useRef<HTMLDivElement>(null);
  const detailBodyRef = useRef<HTMLDivElement>(null);
  const lastSelected = useRef<string | null>(null);
  const versionLinks = useMemo(() => currentSourceVersionLinks(sources, reports), [sources, reports]);
  const bySource = useMemo(() => {
    // The first report wins throughout the directory and source details.
    const index = new Map<string, PreflightReport>();
    for (const report of reports) if (!index.has(report.data_source_id)) index.set(report.data_source_id, report);
    return index;
  }, [reports]);
  const { matches, counts } = useMemo(() => {
    const counts = { all: 0, attention: 0, ready: 0, history: 0 };
    const matches: ProjectDataSource[] = [];
    for (const source of sources) {
      if (!sourceDirectoryMatches(source, query)) continue;
      const group = sourceDirectoryGroup(source, bySource.get(source.id));
      counts.all++;
      if (group !== "other") counts[group]++;
      if (filter === "all" || filter === group) matches.push(source);
    }
    return { matches, counts };
  }, [sources, bySource, query, filter]);
  const visible = matches.slice(0, limit);
  const selected = sources.find((source) => source.id === selectedId) ?? null;
  const selectedIndex = selected ? matches.findIndex((source) => source.id === selected.id) : -1;

  // One source needs no picking step. Initialize only once, including async load.
  // Later uploads, status changes and filters must not replace the user's selection.
  if (selectedId === undefined && sources.length) setSelectedId(sources.length === 1 ? sources[0].id : null);
  if (selectedId && !selected) setSelectedId(null);

  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.kind === "detail") {
      if (detailBodyRef.current) detailBodyRef.current.scrollTop = 0;
      detailRef.current?.focus({ preventScroll: true });
      detailRef.current?.scrollIntoView?.({ block: "nearest" });
      rows.current.get(focusRequest.id)?.scrollIntoView?.({ block: "nearest" });
    } else {
      const target = rows.current.get(focusRequest.id);
      if (target) {
        target.focus({ preventScroll: true });
        target.scrollIntoView?.({ block: "nearest" });
      } else (inputRef.current ?? headingRef.current)?.focus({ preventScroll: true });
    }
  }, [focusRequest]);

  useEffect(() => {
    // Restore a usable focus only if removing the selected source lost focus.
    if (lastSelected.current && !selected && document.activeElement === document.body) (inputRef.current ?? headingRef.current)?.focus();
    lastSelected.current = selected?.id ?? null;
  }, [selected]);

  const showSource = (id: string) => {
    const index = matches.findIndex((source) => source.id === id);
    if (index < 0) return;
    setVersionReturn(null);
    setLimit((current) => Math.max(current, Math.ceil((index + 1) / PAGE_SIZE) * PAGE_SIZE));
    setSelectedId(id);
    setFocusRequest({ kind: "detail", id });
  };
  const closeDetails = () => {
    if (!selected) return;
    if (selectedIndex >= 0) setLimit((current) => Math.max(current, Math.ceil((selectedIndex + 1) / PAGE_SIZE) * PAGE_SIZE));
    setSelectedId(null);
    setVersionReturn(null);
    setFocusRequest({ kind: "row", id: selected.id });
  };
  const openCurrentVersion = (from: ProjectDataSource) => {
    const target = versionLinks.get(from.id);
    const index = target ? sources.findIndex((source) => source.id === target.id) : -1;
    if (!target || index < 0) return;
    setVersionReturn({ fromId: from.id, toId: target.id, query, filter, limit });
    setQuery("");
    setFilter("all");
    setLimit(Math.max(PAGE_SIZE, Math.ceil((index + 1) / PAGE_SIZE) * PAGE_SIZE));
    setSelectedId(target.id);
    setFocusRequest({ kind: "detail", id: target.id });
  };
  const returnToVersion = () => {
    if (!versionReturn) return;
    const { fromId, query: previousQuery, filter: previousFilter, limit: previousLimit } = versionReturn;
    const priorMatches = sources.filter((source) => sourceDirectoryMatches(source, previousQuery) &&
      (previousFilter === "all" || sourceDirectoryGroup(source, bySource.get(source.id)) === previousFilter));
    const index = priorMatches.findIndex((source) => source.id === fromId);
    const fallbackIndex = sources.findIndex((source) => source.id === fromId);
    setVersionReturn(null);
    if (fallbackIndex < 0) return;
    setQuery(index >= 0 ? previousQuery : "");
    setFilter(index >= 0 ? previousFilter : "all");
    setLimit(Math.max(previousLimit, Math.ceil(((index >= 0 ? index : fallbackIndex) + 1) / PAGE_SIZE) * PAGE_SIZE));
    setSelectedId(fromId);
    setFocusRequest({ kind: "detail", id: fromId });
  };
  const locateSelected = () => {
    if (!selected) return;
    const index = sources.findIndex((source) => source.id === selected.id);
    setQuery("");
    setFilter("all");
    setLimit(Math.max(PAGE_SIZE, Math.ceil((index + 1) / PAGE_SIZE) * PAGE_SIZE));
    setVersionReturn(null);
  };
  const changeQuery = (value: string) => {
    setVersionReturn(null);
    setQuery(value);
    setLimit(PAGE_SIZE);
  };
  const reset = () => {
    changeQuery("");
    setFilter("all");
    inputRef.current?.focus();
  };

  return <section aria-labelledby={headingId} className={styles["source-directory"]}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 ref={headingRef} tabIndex={-1} id={headingId} className="text-sm font-semibold text-foreground">{dataT("projectSourcesTitle")}</h3>
      <span className="text-xs tabular-nums text-muted-foreground">{dataT("projectSourcesCount", { count: sources.length })}</span>
    </div>
    <div className={styles["source-browser"]} data-selected={Boolean(selected)}>
      <div className={styles["source-browser-list"]}>
        {sources.length > 0 && <div className="shrink-0 space-y-2.5 border-b border-border p-3">
          <div onKeyDown={event => {
            if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (event.target === inputRef.current && event.key === "ArrowDown" && visible.length) {
              event.preventDefault(); rows.current.get(visible[0].id)?.focus();
            }
          }}>
            <SearchField inputRef={inputRef} value={query} onChange={changeQuery} maxLength={200}
              label={t("search")} clearLabel={t("clearSearch")} />
          </div>
          <div role="group" aria-label={t("filterLabel")} className="flex flex-wrap gap-1">
            {FILTERS.map((value) => <Button key={value} variant={filter === value ? "primary" : "ghost"} size="sm" aria-pressed={filter === value}
              onClick={() => { setVersionReturn(null); setFilter(value); setLimit(PAGE_SIZE); }}
              className="gap-1.5 px-2">
              {t(value)}<span className="text-[11px] tabular-nums opacity-75">{counts[value]}</span>
            </Button>)}
          </div>
          <p role="status" aria-live="polite" aria-atomic="true" className="text-[11px] tabular-nums text-muted-foreground">{t("showing", { shown: visible.length, total: matches.length })}</p>
        </div>}
        <div className={styles["source-browser-scroll"]}>
          <ul aria-label={t("listLabel")} className="divide-y divide-border" onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            const index = visible.findIndex((source) => rows.current.get(source.id) === event.target);
            if (index < 0) return;
            let next: number;
            if (event.key === "ArrowDown") next = Math.min(index + 1, visible.length - 1);
            else if (event.key === "ArrowUp") next = index - 1;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = visible.length - 1;
            else return;
            event.preventDefault();
            if (next < 0) inputRef.current?.focus(); else rows.current.get(visible[next].id)?.focus();
          }}>
            {visible.map((source) => <li key={source.id} aria-label={source.name}>
              <button type="button" aria-label={t("openSource", { name: source.name })} aria-controls={selected ? detailId : undefined}
                aria-current={selected?.id === source.id ? "true" : undefined}
                ref={(node) => { if (node) rows.current.set(source.id, node); else rows.current.delete(source.id); }}
                onClick={() => showSource(source.id)}
                className={`${styles["source-browser-row"]} group`}>
                {source.kind === "file" ? <FileSpreadsheet size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" /> : <Database size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />}
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium" title={source.name}>{source.name}</span>
                  <SourceStatus source={source} report={bySource.get(source.id)} compact className="mt-1.5" />
                </span>
                <ArrowRight size={14} aria-hidden="true" className="mt-1 shrink-0 text-muted-foreground group-hover:text-primary" />
              </button>
            </li>)}
          </ul>
          {!sources.length ? <div className="px-4 py-8 text-center text-xs leading-5 text-muted-foreground">{dataT("emptyData")}</div>
            : !matches.length && <div className="px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">{t("noMatches")}</p>
              <button type="button" onClick={reset} className="mt-2 p-1 text-xs font-semibold text-primary hover:underline">{t("reset")}</button>
            </div>}
          {visible.length < matches.length && <button type="button" onClick={() => {
            const id = matches[visible.length]?.id;
            setLimit(visible.length + PAGE_SIZE);
            if (id) setFocusRequest({ kind: "row", id });
          }} className="min-h-10 w-full border-t border-border bg-background px-3 py-2 text-xs font-semibold text-primary hover:bg-muted">{t("showMore", { count: Math.min(PAGE_SIZE, matches.length - visible.length) })}</button>}
        </div>
      </div>
      {selected && <div id={detailId} ref={detailRef} role="region" aria-label={t("sourceDetails", { name: selected.name })} tabIndex={-1}
        className={styles["source-browser-detail"]} onKeyDown={(event) => {
          if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          if (event.target === event.currentTarget && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeDetails(); }
        }}>
        <div className="flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
          <button type="button" onClick={closeDetails} className="inline-flex min-h-8 items-center gap-1.5 text-xs font-semibold text-primary"><ArrowLeft size={14} aria-hidden="true" />{t("backToList")}</button>
          <div className="flex items-center gap-1">
            {selectedIndex >= 0 && <span className="mr-1 text-[11px] tabular-nums text-muted-foreground">{t("position", { position: selectedIndex + 1, count: matches.length })}</span>}
            <button type="button" aria-label={t("previousSource")} disabled={selectedIndex <= 0}
              onClick={() => showSource(matches[selectedIndex - 1].id)} className={styles["source-browser-step"]}><ChevronUp size={15} /></button>
            <button type="button" aria-label={t("nextSource")} disabled={selectedIndex < 0 || selectedIndex >= matches.length - 1}
              onClick={() => showSource(matches[selectedIndex + 1].id)} className={styles["source-browser-step"]}><ChevronDown size={15} /></button>
          </div>
        </div>
        <div ref={detailBodyRef} className={styles["source-browser-detail-body"]}>
          {selectedIndex < 0 && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
            <span>{t("outsideFilter")}</span><button type="button" onClick={locateSelected} className="font-semibold text-primary">{t("locateSource")}</button>
          </div>}
          {versionReturn?.toId === selected.id && sources.some((item) => item.id === versionReturn.fromId) &&
            <button type="button" onClick={returnToVersion} className="flex min-h-10 w-full items-center gap-1.5 border-b border-border bg-muted/40 px-3 py-2 text-left text-xs text-primary hover:bg-muted"><ArrowLeft size={13} aria-hidden="true" />{t("backToVersion")}</button>}
          <div key={selected.id} className={styles["source-browser-source"]}>{children(selected)}</div>
          {versionLinks.has(selected.id) && <button type="button" onClick={() => openCurrentVersion(selected)}
            aria-label={t("openCurrentVersion", { name: versionLinks.get(selected.id)!.name })}
            className="flex min-h-12 w-full items-center gap-2 border-t border-border bg-muted/30 px-3 py-2 text-left text-xs hover:bg-muted">
            <span className="shrink-0 text-muted-foreground">{t("currentVersion")}</span>
            <span className="min-w-0 flex-1 truncate font-medium text-primary">{versionLinks.get(selected.id)!.name}</span>
            <ArrowRight size={14} className="shrink-0 text-primary" aria-hidden="true" />
          </button>}
        </div>
      </div>}
    </div>
  </section>;
}
