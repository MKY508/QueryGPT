"use client";

import { useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Columns3, X } from "lucide-react";
import { moveTableItem, type TableSortRule } from "@/lib/tabular-data";
import { cn } from "@/lib/utils";
import { tableTextMatcher } from "@/lib/table-text-search";
import { DATA_ROW_DISPLAYS, type DataRowDisplay } from "./useDataRowDisplay";
import { SearchField } from "@/components/ui/SearchField";

export interface DataViewLayoutHandle { dismiss: (restoreFocus?: boolean) => boolean }
const iconButton = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-muted aria-disabled:opacity-30";

export function DataViewLayoutControls({ fields, order, hidden, sorts, freezeCount, frozenCount, onFreeze, rowDisplay, onRowDisplay, onOrder, onHidden, onSorts, ref }: {
  fields: string[]; order: string[]; hidden: ReadonlySet<string>; sorts: TableSortRule[];
  freezeCount: number; frozenCount: number; onFreeze: (count: number) => void;
  rowDisplay: DataRowDisplay; onRowDisplay: (display: DataRowDisplay) => void;
  onOrder: (next: string[]) => void; onHidden: (next: Set<string>) => void;
  onSorts: (next: TableSortRule[]) => void; ref: Ref<DataViewLayoutHandle>;
}) {
  const t = useTranslations("dataView");
  const locale = useLocale();
  const columnsRef = useRef<HTMLDetailsElement>(null);
  const sortingRef = useRef<HTMLDetailsElement>(null);
  // Native grouping plus synchronous activation avoids queued toggle events closing a newer menu.
  const menuGroup = useId();
  const [query, setQuery] = useState("");
  const visibleCount = fields.filter((field) => !hidden.has(field)).length;
  const visible = order.filter((field) => !hidden.has(field));
  const matchesField = tableTextMatcher(query, locale);
  // Carry positions through search rather than scanning the full order per row.
  const pickerFields = order.flatMap((field, index) => matchesField(field) ? [{ field, index }] : []);
  const sortedFields = new Set(sorts.map((rule) => rule.column));
  const available = order.filter((field) => !sortedFields.has(field));
  const close = (element: HTMLDetailsElement | null, focus = true) => {
    if (!element?.open) return false;
    element.open = false;
    if (focus) element.querySelector("summary")?.focus();
    return true;
  };
  useImperativeHandle(ref, () => ({ dismiss: (restoreFocus = true) => {
    const columns = close(columnsRef.current, restoreFocus);
    return close(sortingRef.current, restoreFocus) || columns;
  } }));
  return <>
    <details ref={columnsRef} name={menuGroup} className="relative">
      <summary onClick={() => { if (!columnsRef.current?.open) close(sortingRef.current, false); }} className="rounded-md flex h-9 cursor-pointer list-none items-center gap-2 border border-border px-3 text-xs hover:bg-muted"><Columns3 size={14} />{t("columns", { count: visibleCount, total: fields.length })}</summary>
      <div className="absolute right-0 top-11 z-20 flex max-h-[min(560px,60dvh)] w-80 flex-col rounded-lg border border-border bg-popover p-3 shadow-lg">
        <SearchField label={t("searchColumns")} clearLabel={t("clearColumnSearch")} value={query} onChange={setQuery}
          className="rounded-md mb-2 w-full shrink-0 border border-input bg-background pl-2 pr-1" inputClassName="h-9" />
        <div className="mb-2 flex shrink-0 flex-wrap justify-between gap-2 text-xs">
          <button type="button" onClick={() => onHidden(new Set())} className="font-medium text-primary hover:underline">{t("showAll")}</button>
          <button type="button" onClick={() => onOrder([...fields])} className="text-muted-foreground hover:underline">{t("layout.resetColumns")}</button>
          <button type="button" onClick={() => close(columnsRef.current)} className="text-muted-foreground hover:underline">{t("done")}</button>
        </div>
        <details className="group/reading mb-2 shrink-0 border-y border-border">
          <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium text-muted-foreground hover:text-foreground">
            {t("readingSettings")}<ChevronDown size={13} className="shrink-0 group-open/reading:rotate-180" />
          </summary>
          <div className="pb-1">
        <label className="mb-2 flex shrink-0 items-center gap-2 text-xs">
          <span className="shrink-0 text-muted-foreground">{t("layout.freezeColumns")}</span>
          <select aria-label={t("layout.freezeColumns")} value={Math.min(freezeCount, visible.length)}
            onChange={(event) => onFreeze(Number(event.target.value))} className="rounded-md h-8 min-w-0 flex-1 border border-input bg-background px-2 text-xs">
            <option value={0}>{t("layout.noFreeze")}</option>
            {visible.map((field, index) => <option key={field} value={index + 1}>{t("layout.freezeThrough", { count: index + 1, field })}</option>)}
          </select>
        </label>
        {freezeCount > 0 && frozenCount < Math.min(freezeCount, visible.length) && <p className="mb-2 shrink-0 text-xs leading-5 text-muted-foreground">
          {t(frozenCount ? "layout.freezeLimited" : "layout.freezeSuspended", { count: frozenCount })}
        </p>}
        <label className="mb-2 flex shrink-0 items-center gap-2 text-xs">
          <span className="shrink-0 text-muted-foreground">{t("layout.rowHeight")}</span>
          <select aria-label={t("layout.rowHeight")} value={rowDisplay} onChange={(event) => {
            const next = DATA_ROW_DISPLAYS.find((display) => display === event.target.value);
            if (next) onRowDisplay(next);
          }} className="rounded-md h-8 min-w-0 flex-1 border border-input bg-background px-2 text-xs">
            {DATA_ROW_DISPLAYS.map((display) => <option key={display} value={display}>{t(`layout.rowDisplay.${display}`)}</option>)}
          </select>
        </label>
          </div>
        </details>
        <div className="min-h-0 max-h-80 flex-1 space-y-1 overflow-y-auto">
          {pickerFields.map(({ field, index }) => {
            return <div key={field} className="flex min-w-0 items-center gap-1 text-xs">
              <label className="flex min-w-0 flex-1 items-start gap-2 py-1">
                <input type="checkbox" checked={!hidden.has(field)} disabled={!hidden.has(field) && visibleCount === 1}
                  onChange={() => { const next = new Set(hidden); if (next.has(field)) next.delete(field); else next.add(field); onHidden(next); }}
                  className="mt-0.5 accent-[hsl(var(--primary))]" />
                <span className="break-words">{field}</span>
              </label>
              {!query.trim() && <>
                <button type="button" aria-label={t("layout.columnEarlier", { field })} aria-disabled={index === 0}
                  onClick={() => onOrder(moveTableItem(order, index, -1))} className={iconButton}><ArrowUp size={13} /></button>
                <button type="button" aria-label={t("layout.columnLater", { field })} aria-disabled={index === order.length - 1}
                  onClick={() => onOrder(moveTableItem(order, index, 1))} className={iconButton}><ArrowDown size={13} /></button>
              </>}
            </div>;
          })}
          {!pickerFields.length && <p className="py-2 text-xs text-muted-foreground">{t("noColumns")}</p>}
        </div>
      </div>
    </details>
    <details ref={sortingRef} name={menuGroup} className="relative">
      <summary onClick={() => { if (!sortingRef.current?.open) close(columnsRef.current, false); }} className={cn("flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border px-3 text-xs hover:bg-muted", sorts.length ? "border-primary/30 bg-primary/5 text-primary" : "border-border")}>
        <ArrowUpDown size={14} />{t("layout.sort")}{sorts.length > 0 && <span className="tabular-nums">{sorts.length}</span>}
      </summary>
      <section aria-label={t("layout.sortOrder")} className="absolute right-0 top-11 z-20 w-[400px] rounded-lg border border-border bg-popover p-3 shadow-lg">
        <div className="mb-2 flex items-center justify-between gap-3 text-xs">
          <h3 className="font-semibold">{t("layout.sortOrder")}</h3>
          <button type="button" onClick={() => close(sortingRef.current)} className="text-muted-foreground hover:underline">{t("done")}</button>
        </div>
        <ol className="max-h-[min(320px,45dvh)] space-y-2 overflow-y-auto">
          {sorts.map((rule, index) => <li key={rule.column} className="flex min-w-0 items-center gap-1 text-xs">
            <span className="w-5 shrink-0 tabular-nums text-muted-foreground" aria-hidden="true">{index + 1}</span>
            <span className="min-w-0 flex-1 break-words">{rule.column}</span>
            <select aria-label={t("layout.direction", { field: rule.column })} value={rule.direction}
              onChange={(event) => onSorts(sorts.map((item) => item.column === rule.column ? { ...item, direction: event.target.value as TableSortRule["direction"] } : item))}
              className="rounded-md h-8 w-20 shrink-0 border border-input bg-background px-1 text-xs">
              <option value="asc">{t("layout.asc")}</option><option value="desc">{t("layout.desc")}</option>
            </select>
            <button type="button" aria-label={t("layout.sortEarlier", { field: rule.column })} aria-disabled={index === 0}
              onClick={() => onSorts(moveTableItem(sorts, index, -1))} className={iconButton}><ArrowUp size={13} /></button>
            <button type="button" aria-label={t("layout.sortLater", { field: rule.column })} aria-disabled={index === sorts.length - 1}
              onClick={() => onSorts(moveTableItem(sorts, index, 1))} className={iconButton}><ArrowDown size={13} /></button>
            <button type="button" aria-label={t("layout.removeSort", { field: rule.column })}
              onClick={() => { onSorts(sorts.filter((item) => item.column !== rule.column)); sortingRef.current?.querySelector("summary")?.focus(); }} className={iconButton}><X size={13} /></button>
          </li>)}
        </ol>
        <div className="mt-3 flex items-center gap-3">
          <select aria-label={t("layout.addSort")} value="" aria-disabled={!available.length}
            onChange={(event) => { if (available.includes(event.target.value)) onSorts([...sorts, { column: event.target.value, direction: "asc" }]); }}
            className="rounded-md h-8 min-w-0 flex-1 border border-input bg-background px-2 text-xs aria-disabled:opacity-50">
            <option value="" disabled>{t(available.length ? "layout.addSort" : "layout.allSorted")}</option>
            {available.map((field) => <option key={field} value={field}>{field}</option>)}
          </select>
          {sorts.length > 0 && <button type="button" onClick={() => { onSorts([]); sortingRef.current?.querySelector("summary")?.focus(); }}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground">{t("layout.clearSort")}</button>}
        </div>
      </section>
    </details>
  </>;
}
