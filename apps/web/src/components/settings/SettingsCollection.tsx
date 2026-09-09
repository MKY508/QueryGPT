"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import styles from "./SettingsCollection.module.css";
import { SearchField } from "@/components/ui/SearchField";
import { Button } from "@/components/ui/button";

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
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
      <SearchField inputRef={searchRef} value={view.query} label={searchLabel} clearLabel={t("clearSearch")}
        controls={id} className={styles.search}
        onChange={query => { onBrowse(); setView(current => ({ ...current, query, page: 0 })); }} />
      <select aria-label={filterLabel} aria-controls={id} value={view.filter}
        onChange={event => { onBrowse(); setView(current => ({ ...current, filter: event.target.value, page: 0 })); }}
        className={`${styles.filter} h-9 rounded-md min-w-36 flex-1 border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary`}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <div className="flex items-center gap-1">
        <p ref={countRef} role="status" tabIndex={-1} className="px-2 text-xs tabular-nums text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary">
          {pages > 1 ? t("range", { start, end, total: filtered.length }) : constrained ? t("filteredCount", { count: filtered.length, total: items.length }) : t("count", { count: items.length })}
        </p>
        {pages > 1 && <>
          <Button variant="ghost" aria-label={t("previous")} disabled={page === 0} onClick={() => paginate(page - 1)} size="icon"><ChevronLeft size={17} /></Button>
          <Button variant="ghost" aria-label={t("next")} disabled={page === pages - 1} onClick={() => paginate(page + 1)} size="icon"><ChevronRight size={17} /></Button>
        </>}
      </div>
    </div>
    <div id={id}>
      {filtered.length ? children(filtered.slice(page * SETTINGS_PAGE_SIZE, (page + 1) * SETTINGS_PAGE_SIZE)) : constrained ? <div className="border-b border-border py-12 text-center">
        <p className="text-sm text-muted-foreground">{t("noMatches")}</p>
        <Button variant="ghost" onClick={clear} className="mt-3 text-primary">{t("clearFilters")}</Button>
      </div> : empty}
    </div>
  </section>;
}
