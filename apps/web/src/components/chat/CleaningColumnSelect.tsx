"use client";

import { useId, useMemo, type Ref } from "react";
import { SearchField } from "@/components/ui/SearchField";
import { useLocale, useTranslations } from "next-intl";
import { cleaningColumnChoices, CLEANING_COLUMN_SEARCH_THRESHOLD } from "@/lib/cleaning-column-search";

interface CleaningColumnSelectProps {
  columns: readonly string[];
  labels: ReadonlyMap<string, string>;
  value: string;
  onChange: (column: string) => void;
  query: string;
  onQueryChange: (query: string) => void;
  label: string;
  searchLabel: string;
  ariaLabel?: string;
  disabled?: boolean;
  inline?: boolean;
  selectRef?: Ref<HTMLSelectElement>;
}

/** Shared native selection, with a separate search draft and bounded options. */
export function CleaningColumnSelect({ columns, labels, value, onChange, query, onQueryChange,
  label, searchLabel, ariaLabel, disabled = false, inline = false, selectRef }: CleaningColumnSelectProps) {
  const t = useTranslations("visualCleaning");
  const locale = useLocale();
  const id = useId();
  const searchable = columns.length > CLEANING_COLUMN_SEARCH_THRESHOLD;
  const choices = useMemo(() => cleaningColumnChoices(columns, labels, searchable ? query : "", locale, value),
    [columns, labels, searchable, query, locale, value]);
  const status = choices.matches.length === 0 && query && searchable ? t("sampleNoMatchingColumns")
    : choices.truncated ? t("columnSearchMore") : "";
  const inactive = disabled || columns.length === 0;

  return <div className={inline ? "flex min-w-0 max-w-full flex-wrap items-center gap-2" : "grid min-w-0 gap-1.5"}>
    <label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</label>
    {searchable && <SearchField value={query} onChange={onQueryChange} label={searchLabel}
      clearLabel={t("clearColumnSearch")} controls={id} describedBy={status ? `${id}-status` : undefined}
      disabled={inactive} className={inline ? "w-40 max-w-full" : "w-full"}
      inputClassName={inline ? "h-8 text-xs" : undefined} />}
    <select ref={selectRef} id={id} aria-label={ariaLabel} value={value} disabled={inactive}
      aria-describedby={status ? `${id}-status` : undefined}
      onChange={(event) => {
        const column = event.target.value;
        if (columns.includes(column)) { onChange(column); onQueryChange(""); }
      }}
      className={`min-w-0 max-w-full rounded-md border border-border bg-background text-foreground outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50 ${inline ? "h-8 w-52 px-2 text-xs" : "w-full px-3 py-2.5 text-sm"}`}>
      {choices.pinned !== undefined && <optgroup label={t("columnSearchCurrent")}>
        <option value={choices.pinned}>{labels.get(choices.pinned) ?? choices.pinned}</option>
      </optgroup>}
      {choices.matches.map((column) => <option key={column} value={column}>{labels.get(column) ?? column}</option>)}
    </select>
    <span id={`${id}-status`} role="status" className={status ? "w-full text-xs text-muted-foreground" : "sr-only"}>{status}</span>
  </div>;
}
