"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Download, ListChecks, PanelRightOpen, Pin, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadCsv } from "@/lib/csv";
import { compareNumericValues, isNumericCell } from "@/lib/numeric-values";
import { cycleTableSort, dataCellText, dataCellValue, dataColumns, filterTableRecords, tableSortRules, tableViewRecords, type TableSorting, type TableSortRule, type TabularRow } from "@/lib/tabular-data";
import { DataRecordDetails } from "./DataRecordDetails";
import { SearchField } from "@/components/ui/SearchField";
import { DataViewFilters, type DataViewFiltersHandle } from "./DataViewFilters";
import { EMPTY_TABLE_FILTERS, tableFieldKinds, tableFilterMatcher, type TableFilters } from "@/lib/tabular-filters";
import { DataViewLayoutControls, type DataViewLayoutHandle } from "./DataViewLayoutControls";
import { DataRowCheckbox, DataSelectionBar } from "./DataRowSelection";
import { DataSelectionCopy } from "./DataSelectionCopy";
import { tableSelectionRange, updateTableSelection } from "@/lib/tabular-selection";
import { useFrozenDataColumns } from "./useFrozenDataColumns";
import { useDataRowDisplay } from "./useDataRowDisplay";

export interface DataViewSnapshot {
  title: string;
  rows: readonly TabularRow[];
  notice?: string;
  sort?: TableSorting;
}

type DataViewProps = { snapshot: DataViewSnapshot; onClose: () => void };
export function DataViewDialog(props: DataViewProps) {
  const [session, setSession] = useState({ rows: props.snapshot.rows, key: 0 });
  // A new snapshot owns a new view, including nested menus and unfinished filters.
  if (session.rows !== props.snapshot.rows) setSession({ rows: props.snapshot.rows, key: session.key + 1 });
  return <DataViewSession key={session.key} {...props} />;
}

function DataViewSession({ snapshot, onClose }: DataViewProps) {
  const t = useTranslations("dataView");
  const locale = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const layoutRef = useRef<DataViewLayoutHandle>(null);
  const filtersRef = useRef<DataViewFiltersHandle>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const { rowDisplay, changeRowDisplay } = useDataRowDisplay(tableRef);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectTriggerRef = useRef<HTMLButtonElement>(null);
  const rangeAnchor = useRef<number | null>(null);
  const focusReturnRef = useRef<number | null>(null);
  const [selection, setSelection] = useState<{ rows: readonly TabularRow[]; index: number } | null>(null);
  const [query, setQuery] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const fields = useMemo(() => dataColumns(snapshot.rows), [snapshot.rows]);
  const [sorts, setSorts] = useState<TableSortRule[]>(() => tableSortRules(snapshot.sort || null)
    .filter((rule) => fields.includes(rule.column)));
  const [order, setOrder] = useState(() => [...fields]);
  const [freezeCount, setFreezeCount] = useState(0);
  const sortDescriptionId = useId();
  const [requestedPage, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [exportError, setExportError] = useState(false);
  const [filters, setFilters] = useState(EMPTY_TABLE_FILTERS);
  const [filterEditing, setFilterEditing] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(() => new Set());
  const [onlyChecked, setOnlyChecked] = useState(false);
  const kinds = useMemo(() => tableFieldKinds(snapshot.rows, fields), [snapshot.rows, fields]);
  const columns = useMemo(() => order.filter((field) => !hidden.has(field)), [order, hidden]);
  const ordered = useMemo(() => tableViewRecords(snapshot.rows, sorts, [], "", locale), [snapshot.rows, sorts, locale]);
  const selectedRows = useMemo(() => checked.size ? ordered
    .filter((record) => checked.has(record.index)).map(({ row }) => row) : [], [ordered, checked]);
  const filtered = useMemo(() => {
    const matches = tableFilterMatcher(filters, kinds, locale);
    return filterTableRecords(ordered, columns, query, locale, matches);
  }, [ordered, columns, query, locale, filters, kinds]);
  const matching = useMemo(() => onlyChecked ? filtered.filter((record) => checked.has(record.index)) : filtered,
    [filtered, onlyChecked, checked]);
  const checkedInResults = filtered.reduce((count, record) => count + Number(checked.has(record.index)), 0);
  const selectedPosition = selection?.rows === snapshot.rows ? matching.findIndex((record) => record.index === selection.index) : -1;
  const selected = matching[selectedPosition];
  if (selection && !selected) setSelection(null);
  const pageCount = Math.max(1, Math.ceil(matching.length / pageSize));
  const page = selected ? Math.floor(selectedPosition / pageSize) : Math.min(requestedPage, pageCount - 1);
  const rows = matching.slice(page * pageSize, (page + 1) * pageSize);
  const checkedOnPage = rows.reduce((count, record) => count + Number(checked.has(record.index)), 0);
  const frozenOffsets = useFrozenDataColumns(tableRef, Math.min(freezeCount, columns.length),
    JSON.stringify([columns, selecting, Boolean(selected), rowDisplay, rows.map((record) => record.index)]));
  const frozenStyle = (index: number) => index < frozenOffsets.length ? {
    left: frozenOffsets[index],
    boxShadow: index === frozenOffsets.length - 1 ? "2px 0 0 hsl(var(--border))" : undefined,
  } : undefined;

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (focusReturnRef.current !== null) cancelAnimationFrame(focusReturnRef.current);
    };
  }, []);

  const openRecord = (position: number) => {
    const record = matching[position];
    if (!record) return;
    if (focusReturnRef.current !== null) cancelAnimationFrame(focusReturnRef.current);
    setSelection({ rows: snapshot.rows, index: record.index });
    setPage(Math.floor(position / pageSize));
  };
  const closeRecord = () => {
    if (!selected) return false;
    const index = selected.index;
    const previousFocus = document.activeElement;
    setSelection(null); setPage(page);
    focusReturnRef.current = requestAnimationFrame(() => {
      focusReturnRef.current = null;
      if (!dialogRef.current?.open) return;
      if (document.activeElement !== previousFocus && document.activeElement !== document.body) return;
      const trigger = tableRef.current?.querySelector<HTMLButtonElement>(`[data-record-index="${index}"]`);
      (trigger || searchRef.current)?.focus({ preventScroll: true });
      trigger?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    });
    return true;
  };
  const changePage = (next: number) => { setSelection(null); setPage(next); };
  const changeFilters = (value: TableFilters) => { setFilters(value); setPage(0); };
  const changeSorts = (value: TableSortRule[]) => { setSorts(value); setPage(0); };
  const restoreRecords = () => {
    if (filterEditing) return;
    setQuery(""); setFilters(EMPTY_TABLE_FILTERS); setOnlyChecked(false);
    setSelection(null); setPage(0); rangeAnchor.current = null;
    // The empty-state button disappears; leave focus at a stable entry point.
    searchRef.current?.focus({ preventScroll: true });
  };
  const endSelection = () => {
    setSelecting(false); setChecked(new Set()); setOnlyChecked(false); rangeAnchor.current = null;
    selectTriggerRef.current?.focus({ preventScroll: true });
  };
  const toggleRow = (index: number, value: boolean, range: boolean) => {
    const indices = range ? tableSelectionRange(matching, rangeAnchor.current, index) : [index];
    setChecked((current) => updateTableSelection(current, indices, value));
    rangeAnchor.current = index;
    // In selected-only view, unticking removes its own focused control. Keep
    // keyboard browsing in the remaining page, or return to the selection entry.
    const origin = document.activeElement;
    if (onlyChecked && !value && origin?.getAttribute("data-selection-index") === String(index)) {
      const removed = new Set(indices);
      const remaining = rows.filter((record) => !removed.has(record.index));
      const position = rows.findIndex((record) => record.index === index);
      const next = remaining[Math.min(position, remaining.length - 1)];
      if (focusReturnRef.current !== null) cancelAnimationFrame(focusReturnRef.current);
      focusReturnRef.current = requestAnimationFrame(() => {
        focusReturnRef.current = null;
        if (!dialogRef.current?.open || (document.activeElement !== origin && document.activeElement !== document.body)) return;
        const target = next && tableRef.current?.querySelector<HTMLInputElement>(`[data-selection-index="${next.index}"]`);
        (target || selectTriggerRef.current)?.focus({ preventScroll: true });
      });
    }
  };
  const exportData = (selectedOnly = false) => {
    setExportError(false);
    const filename = Array.from(snapshot.title).map((char) =>
      char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? "-" : char).join("").trim().slice(0, 120);
    // Selected export includes selections outside the current filter; use the
    // full snapshot for sort type inference and preserve its duplicate rows.
    const records = selectedOnly ? selectedRows : matching.map(({ row }) => row);
    if (!records.length || !columns.length) return;
    try { downloadCsv(records, `${filename || t("untitled")}${selectedOnly ? `-${t("selection.filename")}` : ""}.csv`, columns); }
    catch { setExportError(true); }
  };
  if (typeof document === "undefined") return null;
  return createPortal(
    <dialog ref={dialogRef} aria-label={t("title", { title: snapshot.title || t("untitled") })}
      onClose={(event) => { if (!event.currentTarget.open) onClose(); }}
      onCancel={(event) => { if (layoutRef.current?.dismiss() || filtersRef.current?.dismiss() || closeRecord()) event.preventDefault(); }}
      onKeyDown={(event) => {
        // Reader controls must not invoke report save/print/undo shortcuts.
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
          if (event.key === "Escape") event.preventDefault();
          return;
        }
        if ((event.ctrlKey || event.metaKey) && ["s", "p"].includes(event.key.toLowerCase())) event.preventDefault();
        if (event.key === "Escape" && (layoutRef.current?.dismiss() || filtersRef.current?.dismiss() || closeRecord())) event.preventDefault();
      }}
      onBeforeInput={(event) => event.stopPropagation()}
      className="report-screen-view m-auto h-[min(900px,92dvh)] max-h-[92dvh] w-[min(1500px,96vw)] max-w-none rounded-xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/35">
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{t("title", { title: snapshot.title || t("untitled") })}</h2>
            {snapshot.notice && <p className="mt-1 text-xs text-muted-foreground">{snapshot.notice}</p>}
          </div>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label={t("close")} className="inline-flex h-9 w-9 rounded-md shrink-0 items-center justify-center hover:bg-muted"><X size={17} /></button>
        </header>
        <div className="relative flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          <SearchField inputRef={searchRef} autoFocus label={t("search")} clearLabel={t("clearSearch")} maxLength={512}
            value={query} onChange={(value) => { setQuery(value); setPage(0); }}
            className="min-w-44 flex-1 border border-input bg-background pl-3 pr-1" inputClassName="h-9" />
          <DataViewLayoutControls ref={layoutRef} fields={fields} order={order} hidden={hidden} sorts={sorts}
            freezeCount={freezeCount} frozenCount={frozenOffsets.length} onFreeze={setFreezeCount}
            rowDisplay={rowDisplay} onRowDisplay={changeRowDisplay}
            onOrder={setOrder} onHidden={(value) => { setHidden(value); setPage(0); }} onSorts={changeSorts} />
          <button ref={selectTriggerRef} type="button" aria-pressed={selecting} onClick={() => {
            if (selecting) endSelection(); else { layoutRef.current?.dismiss(false); setSelecting(true); }
          }} className="inline-flex h-9 rounded-md items-center gap-2 border border-border px-3 text-xs hover:bg-muted aria-pressed:border-primary/30 aria-pressed:bg-primary/5 aria-pressed:text-primary"><ListChecks size={14} />{t("selection.title")}</button>
          <button type="button" disabled={!matching.length || !columns.length} onClick={() => exportData()}
            className="inline-flex h-9 rounded-md items-center gap-2 border border-border px-3 text-xs font-medium hover:bg-muted disabled:opacity-40"><Download size={14} />{t("exportCsv")}</button>
        </div>
        <div className="shrink-0">
          <DataViewFilters ref={filtersRef} filters={filters} kinds={kinds} onChange={changeFilters}
            onBegin={() => { layoutRef.current?.dismiss(false); setFilterEditing(true); }} onEnd={() => setFilterEditing(false)} />
        </div>
        {selecting && <div className="shrink-0"><DataSelectionBar count={checked.size} outside={checked.size - checkedInResults} total={filtered.length}
          allChecked={checkedInResults === filtered.length} onlyChecked={onlyChecked} canExport={checked.size > 0 && columns.length > 0}
          onAll={() => { setChecked((current) => updateTableSelection(current, filtered.map((record) => record.index), true)); rangeAnchor.current = null; }}
          onClear={() => { setChecked(new Set()); rangeAnchor.current = null; }}
          onOnly={() => { setOnlyChecked((current) => !current); setPage(0); rangeAnchor.current = null; }}
          onExport={() => exportData(true)} onExit={endSelection}>
          <DataSelectionCopy rows={selectedRows} columns={columns} />
        </DataSelectionBar></div>}
        <p id={sortDescriptionId} className="sr-only" aria-live="polite" aria-atomic="true">
          {sorts.length ? t("layout.description", { order: sorts.map((rule, index) => `${index + 1}. ${rule.column} ${t(`layout.${rule.direction}`)}`).join("; ") }) : t("layout.unsorted")}
        </p>
        {freezeCount > 0 && <p className="sr-only" aria-live="polite" aria-atomic="true">{t("layout.frozenCount", { count: frozenOffsets.length })}</p>}
        {exportError && <p role="alert" className="border-b border-destructive/25 px-5 py-2 text-xs text-destructive">{t("exportError")}</p>}
        <div className="flex min-h-0 flex-1 overflow-hidden">
        <div ref={tableRef} className="min-h-0 min-w-0 flex-1 overflow-auto">
          <table aria-label={snapshot.title || t("untitled")} data-row-display={rowDisplay} className="w-full border-separate border-spacing-0 text-left text-xs">
            <thead className="sticky top-0 z-10 bg-secondary">
              <tr><th scope="col" className={cn("sticky left-0 z-10 border-r border-b border-border bg-secondary font-normal text-muted-foreground", selecting ? "w-28 min-w-28 py-1 pl-1 pr-3" : "w-16 px-3 py-3")}>
                <span className="flex items-center">{selecting && <DataRowCheckbox label={t("selection.page")} checked={rows.length > 0 && checkedOnPage === rows.length}
                  mixed={checkedOnPage > 0 && checkedOnPage < rows.length} disabled={!rows.length}
                  onChange={(value) => { setChecked((current) => updateTableSelection(current, rows.map((record) => record.index), value)); rangeAnchor.current = null; }} />}{t("rowNumber")}</span>
              </th>{columns.map((column, columnIndex) => {
                const position = sorts.findIndex((rule) => rule.column === column);
                const sort = sorts[position];
                return <th key={column} style={frozenStyle(columnIndex)} data-frozen={columnIndex < frozenOffsets.length || undefined}
                aria-sort={position === 0 ? sort.direction === "asc" ? "ascending" : "descending" : undefined}
                className={cn("border-b border-r border-border p-0 font-semibold last:border-r-0", columnIndex < frozenOffsets.length && "sticky z-[2] bg-secondary")}>
                <button type="button" title={t("layout.headerHint")} aria-describedby={sortDescriptionId}
                  onClick={(event) => changeSorts(cycleTableSort(sorts, column, event.shiftKey))}
                  className="flex w-full select-none items-center gap-2 whitespace-nowrap px-4 py-3 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40">
                  {column}{columnIndex < freezeCount && <Pin aria-hidden="true" size={11} className={cn("shrink-0 text-primary", columnIndex >= frozenOffsets.length && "invisible")} />}{sort && <span aria-hidden="true" className="inline-flex items-center gap-0.5 text-primary">{sort.direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />}{sorts.length > 1 && <span className="text-[10px] tabular-nums">{position + 1}</span>}</span>}
                </button>
              </th>; })}</tr>
            </thead>
            <tbody>
              {rows.map(({ row, index: sourceIndex }, index) => <tr key={sourceIndex} data-data-row={sourceIndex} className={cn("group border-b border-border/70 even:bg-muted/20 hover:bg-muted/40", (selected?.index === sourceIndex || checked.has(sourceIndex)) && "bg-primary/5 even:bg-primary/5")}>
                <th scope="row" className="sticky left-0 z-[3] border-r border-b border-border bg-card p-0 align-top font-normal">
                  <div className={cn("flex", rowDisplay === "wrap" ? "items-start" : "items-center", selecting && "pl-1")}>
                  {selecting && <DataRowCheckbox label={t("selection.row", { number: page * pageSize + index + 1 })} hint={t("selection.range")}
                    recordIndex={sourceIndex} checked={checked.has(sourceIndex)} onChange={(value, range) => toggleRow(sourceIndex, value, range)} />}
                  <button type="button" data-record-index={sourceIndex} aria-label={t("openRecord", { number: page * pageSize + index + 1 })}
                    aria-pressed={selected?.index === sourceIndex} onClick={() => openRecord(page * pageSize + index)}
                    className={cn("flex w-full items-center justify-between gap-1 px-3 text-xs tabular-nums text-muted-foreground hover:bg-primary/5 hover:text-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
                      rowDisplay === "compact" ? "min-h-9 py-1.5" : rowDisplay === "comfortable" ? "min-h-12 py-3.5" : "min-h-10 py-2.5",
                      selected?.index === sourceIndex && "bg-primary/10 text-primary")}>
                    {page * pageSize + index + 1}<PanelRightOpen size={12} className="shrink-0" />
                  </button>
                  </div>
                </th>
                {columns.map((column, columnIndex) => {
                  const value = dataCellValue(row, column);
                  const numeric = isNumericCell(value);
                  const text = dataCellText(value);
                  return <td key={column} style={frozenStyle(columnIndex)} data-frozen={columnIndex < frozenOffsets.length || undefined}
                    className={cn("min-w-24 border-b border-border/70 px-4 align-top",
                    rowDisplay === "compact" ? "py-1.5" : rowDisplay === "comfortable" ? "py-3.5" : "py-2.5",
                    columnIndex < frozenOffsets.length && "sticky z-[2] bg-card group-hover:bg-secondary",
                    columnIndex < frozenOffsets.length && (selected?.index === sourceIndex || checked.has(sourceIndex)) && "!bg-secondary",
                    numeric && "text-right tabular-nums", numeric && compareNumericValues(value, 0) === -1 && "text-destructive")}>
                    <div className={cn("max-w-lg leading-5", rowDisplay === "wrap" ? "whitespace-pre-wrap break-words [overflow-wrap:anywhere]" : "truncate")}
                      title={rowDisplay !== "wrap" && text.length <= 4096 ? text : undefined}>
                      {value === null || value === undefined ? <span aria-label={t("emptyValue")} className="text-muted-foreground">—</span> : text}
                    </div>
                  </td>;
                })}
              </tr>)}
              {!rows.length && <tr><td colSpan={columns.length + 1} className="px-4 py-4 text-center text-sm text-muted-foreground">
                <p>{t(onlyChecked ? "selection.empty" : query.trim() || filters.rules.length ? "noMatches" : "empty")}</p>
                {snapshot.rows.length > 0 && (onlyChecked || query.trim() || filters.rules.length > 0) &&
                  <button type="button" onClick={restoreRecords} aria-disabled={filterEditing}
                    title={filterEditing ? t("finishFilter") : undefined}
                    className="mt-3 min-h-11 rounded border border-border px-4 text-xs font-medium text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary aria-disabled:opacity-40">
                    {t("restoreRecords")}
                  </button>}
              </td></tr>}
            </tbody>
          </table>
        </div>
        {selected && <DataRecordDetails record={selected} position={selectedPosition} total={matching.length} columns={columns}
          kinds={kinds} filterEditing={filterEditing} onFilter={(field, value, origin) => filtersRef.current?.beginValue(field, value, origin)}
          onNavigate={(direction) => openRecord(selectedPosition + direction)} onClose={closeRecord} />}
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs">
          <span role="status" className="text-muted-foreground">{t("rows", { count: matching.length, total: snapshot.rows.length })}</span>
          {matching.length > 0 && <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-muted-foreground">{t("pageSize")}
              <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }} className="h-8 rounded-md border border-input bg-background px-2 text-foreground">
                {[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <nav aria-label={t("pagination")} className="flex items-center gap-2">
              <button type="button" disabled={page === 0} onClick={() => changePage(page - 1)} className="h-8 rounded-md border border-border px-2 hover:bg-muted disabled:opacity-35">{t("previous")}</button>
              <span className="tabular-nums">{t("page", { current: page + 1, total: pageCount })}</span>
              <button type="button" disabled={page === pageCount - 1} onClick={() => changePage(page + 1)} className="h-8 rounded-md border border-border px-2 hover:bg-muted disabled:opacity-35">{t("next")}</button>
            </nav>
          </div>}
        </footer>
      </div>
    </dialog>, document.body,
  );
}
