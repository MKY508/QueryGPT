"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import styles from "./SettingsCollection.module.css";

export const SETTINGS_PAGE_SIZE = 12;
/** Only explicitly supplied display fields are searched; never serialize an API object. */
export function matchesSettingsItem(query: string, fields: (string | null | undefined)[]): boolean {
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase();
  const text = fields.map(value => normalize(value ?? "")).join(" ");
  return normalize(query).trim().split(/\s+/).filter(Boolean).every(token => text.includes(token));
}

export function SettingsCollection<T>({ items, searchLabel, filterLabel, options, matches, empty, children, onBrowse }: {
  items: T[]; searchLabel: string; filterLabel: string;
  options: { value: string; label: string }[];
  matches: (item: T, query: string, filter: string) => boolean;
  empty: ReactNode; children: (items: T[]) => ReactNode; onBrowse: () => void;
}) {
  const t = useTranslations("settingsCollection");
  const [view, setView] = useState({ query: "", filter: "all", page: 0 });
  const searchRef = useRef<HTMLInputElement>(null), countRef = useRef<HTMLParagraphElement>(null);
  const focusCount = useRef(false);
  const id = useId();
  const filtered = items.filter(item => matches(item, view.query, view.filter));
  const pages = Math.max(1, Math.ceil(filtered.length / SETTINGS_PAGE_SIZE));
  const page = Math.min(view.page, pages - 1);
  // A removed final page stays removed even if a later refresh grows the list.
  if (page !== view.page) setView({ ...view, page });
  useLayoutEffect(() => {
    if (focusCount.current) { focusCount.current = false; countRef.current?.focus(); }
  });
  const clear = () => { onBrowse(); setView({ query: "", filter: "all", page: 0 }); searchRef.current?.focus(); };
  const paginate = (next: number) => { onBrowse(); focusCount.current = true; setView(current => ({ ...current, page: Math.max(0, Math.min(next, pages - 1)) })); };
  const start = filtered.length ? page * SETTINGS_PAGE_SIZE + 1 : 0;
  const end = Math.min((page + 1) * SETTINGS_PAGE_SIZE, filtered.length);
  const constrained = view.query.trim().length > 0 || view.filter !== "all";

  return <section aria-label={searchLabel} className={styles.collection}>
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-3 sm:px-4">
      <div className={`${styles.search} relative min-w-0`}>
        <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 text-muted-foreground" />
        <input ref={searchRef} type="search" aria-label={searchLabel} aria-controls={id} placeholder={searchLabel} value={view.query}
          onChange={event => { onBrowse(); setView(current => ({ ...current, query: event.target.value, page: 0 })); }}
          className="h-11 w-full min-w-0 border border-border bg-background pl-9 pr-11 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary [&::-webkit-search-cancel-button]:hidden" />
        {view.query && <button type="button" aria-label={t("clearSearch")} onClick={() => {
          onBrowse(); setView(current => ({ ...current, query: "", page: 0 })); searchRef.current?.focus();
        }} className="absolute right-0 top-0 flex size-11 items-center justify-center text-muted-foreground hover:text-foreground"><X size={16} /></button>}
      </div>
      <select aria-label={filterLabel} aria-controls={id} value={view.filter}
        onChange={event => { onBrowse(); setView(current => ({ ...current, filter: event.target.value, page: 0 })); }}
        className={`${styles.filter} h-11 min-w-36 flex-1 border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary`}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <div className="flex items-center gap-1">
        <p ref={countRef} role="status" tabIndex={-1} className="px-2 text-xs tabular-nums text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary">
          {pages > 1 ? t("range", { start, end, total: filtered.length }) : constrained ? t("filteredCount", { count: filtered.length, total: items.length }) : t("count", { count: items.length })}
        </p>
        {pages > 1 && <>
          <button type="button" aria-label={t("previous")} disabled={page === 0} onClick={() => paginate(page - 1)} className="flex size-11 items-center justify-center hover:bg-muted disabled:opacity-30"><ChevronLeft size={17} /></button>
          <button type="button" aria-label={t("next")} disabled={page === pages - 1} onClick={() => paginate(page + 1)} className="flex size-11 items-center justify-center hover:bg-muted disabled:opacity-30"><ChevronRight size={17} /></button>
        </>}
      </div>
    </div>
    <div id={id}>
      {filtered.length ? children(filtered.slice(page * SETTINGS_PAGE_SIZE, (page + 1) * SETTINGS_PAGE_SIZE)) : constrained ? <div className="border-b border-border py-12 text-center">
        <p className="text-sm text-muted-foreground">{t("noMatches")}</p>
        <button type="button" onClick={clear} className="mt-3 min-h-11 px-4 text-sm font-medium text-primary hover:bg-primary/5">{t("clearFilters")}</button>
      </div> : empty}
    </div>
  </section>;
}
