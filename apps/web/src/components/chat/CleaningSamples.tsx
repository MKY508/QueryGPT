"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Eraser, Maximize2, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { VisualCleaningSnapshot } from "@/lib/types/api";
import { dataCellText, dataColumns } from "@/lib/tabular-data";
import { cleaningColumnLabels, cleaningWhitespace, isCleaningFieldName } from "@/lib/cleaning-field-names";
import { Button } from "@/components/ui/button";
import { CleaningColumnSelect } from "./CleaningColumnSelect";
export { cleaningWhitespace } from "@/lib/cleaning-field-names";

const COLUMNS_PER_PAGE = 8;
const EXCERPT_LENGTH = 120;
const NO_COLUMN_NAMES: readonly string[] = [];
type Translator = ReturnType<typeof useTranslations<"visualCleaning">>;
type SampleRow = VisualCleaningSnapshot["sample"][number];
type ExpandedValue = { side: number; row: number; column: string; opener: HTMLButtonElement };

function excerpt(text: string): string {
  let result = "";
  let count = 0;
  for (const character of text) {
    if (count++ === EXCERPT_LENGTH) return `${result}…`;
    result += character;
  }
  return result;
}

function cellLabel(row: SampleRow, column: string, t: Translator): string | null {
  if (!Object.prototype.hasOwnProperty.call(row, column)) return t("sampleFieldAbsent");
  if (row[column] == null) return t("sampleMissingValue");
  if (row[column] === "") return t("sampleEmptyText");
  return null;
}

function SampleValue({ row, column, whitespace, full = false }: {
  row: SampleRow; column: string; whitespace: boolean; full?: boolean;
}) {
  const t = useTranslations("visualCleaning");
  const label = cellLabel(row, column, t);
  if (label) return <span className="text-muted-foreground">{label}</span>;
  const value = row[column];
  const raw = dataCellText(value);
  const text = full ? raw : excerpt(raw);
  if (!full && !whitespace && typeof value === "string" && /^[\s\u0085]+$/.test(value)) {
    return <span className="text-muted-foreground">{t("sampleWhitespaceOnly")}</span>;
  }
  return <>{whitespace && typeof value === "string" ? cleaningWhitespace(text) : text}</>;
}

function FullSampleValue({ row, column, columnLabel, title, position, whitespace, onClose }: {
  row: SampleRow; column: string; columnLabel: string; title: string; position: number; whitespace: boolean; onClose: () => void;
}) {
  const t = useTranslations("visualCleaning");
  const heading = useRef<HTMLHeadingElement>(null);
  const panel = useRef<HTMLElement>(null);
  const id = useId();
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView?.({ block: "nearest" });
  }, []);
  return <section ref={panel} aria-labelledby={id} className="mt-4 min-w-0 overflow-hidden rounded-lg border border-primary/30 bg-primary/[0.025]"
    onKeyDown={(event) => {
      if (event.key === "Escape" && !event.nativeEvent.isComposing) {
        event.preventDefault(); event.stopPropagation(); onClose();
      }
    }}>
    <header className="flex items-start justify-between gap-3 border-b border-primary/15 px-4 py-3">
      <div className="min-w-0">
        <h5 ref={heading} tabIndex={-1} id={id} className="break-words text-sm font-semibold outline-none">{t("sampleFullValue", { column: columnLabel })}</h5>
        <p className="mt-1 text-xs text-muted-foreground">{title} · {t("sampleRowNumber", { count: position })}</p>
      </div>
      <Button variant="ghost" size="sm" aria-label={t("sampleCloseValue")} onClick={onClose}
        className="size-7 p-0"><X size={16} /></Button>
    </header>
    <div tabIndex={0} className="max-h-64 overflow-auto whitespace-pre-wrap break-words px-4 py-3 text-sm leading-6 [overflow-wrap:anywhere]">
      <SampleValue row={row} column={column} whitespace={whitespace} full />
    </div>
  </section>;
}

interface CleaningSamplesProps {
  before: VisualCleaningSnapshot;
  after?: VisualCleaningSnapshot;
  title?: string;
  preferredColumns?: string[];
  columnNames?: readonly string[];
  columnOrder?: readonly string[];
  onCleanColumn?: (column: string) => void;
}

/** Both sides browse the same field window, never an assumed record identity. */
export function CleaningSamples({ before, after, title, preferredColumns = [], columnNames = NO_COLUMN_NAMES, columnOrder = NO_COLUMN_NAMES, onCleanColumn }: CleaningSamplesProps) {
  const t = useTranslations("visualCleaning");
  const locale = useLocale();
  const fieldSelect = useRef<HTMLSelectElement>(null);
  const selectedHeaders = useRef<Array<HTMLTableCellElement | null>>([]);
  const scrollers = useRef<Array<HTMLDivElement | null>>([]);
  const columns = useMemo(() => [...new Set([...columnOrder, ...dataColumns([...before.sample, ...(after?.sample ?? [])])])], [columnOrder, before.sample, after?.sample]);
  const labels = useMemo(() => cleaningColumnLabels([...columnNames, ...columns]), [columnNames, columns]);
  const initialColumn = preferredColumns.find((column) => columns.includes(column)) ?? columns[0] ?? "";
  const [session, setSession] = useState(() => ({
    before: before.sample, after: after?.sample, column: initialColumn, preferredColumn: initialColumn,
    expanded: null as ExpandedValue | null, whitespace: false, query: "",
  }));
  if (session.before !== before.sample || session.after !== after?.sample) {
    // Snapshot-owned state must not reappear after A → B → A navigation.
    setSession({ before: before.sample, after: after?.sample, column: initialColumn, preferredColumn: initialColumn, expanded: null, whitespace: false, query: "" });
  } else if (session.preferredColumn !== initialColumn) {
    // A newly chosen cleaning target should be visible in its sample window.
    // Browsing the sample itself remains independent until that target changes.
    setSession({ ...session, preferredColumn: initialColumn, column: initialColumn, expanded: null, query: "" });
  }
  const selectedColumn = columns.includes(session.column) ? session.column : initialColumn;
  const page = Math.max(0, Math.floor(columns.indexOf(selectedColumn) / COLUMNS_PER_PAGE));
  const start = page * COLUMNS_PER_PAGE;
  const visibleColumns = columns.slice(start, start + COLUMNS_PER_PAGE);
  const snapshots = after ? [before, after] : [before];
  const titles = after ? [t("beforeLabel"), t("afterLabel")] : [title ?? t("sourceSample")];
  const selection = session.expanded;
  const expandedRow = selection && visibleColumns.includes(selection.column)
    ? snapshots[selection.side]?.sample[selection.row] : undefined;

  useEffect(() => {
    // A parent dialog opens in its own effect, after the child effects. Measure
    // on the next frame so a newly opened reader has real, nonzero geometry.
    const frame = requestAnimationFrame(() => {
      selectedHeaders.current.forEach((header, index) => {
        const scroller = scrollers.current[index];
        if (!header || !scroller) return;
        // Locate the chosen field on both sides without coupling sample rows.
        scroller.scrollLeft = Math.max(0, scroller.scrollLeft
          + header.getBoundingClientRect().left - scroller.getBoundingClientRect().left - 40);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedColumn, before.sample, after?.sample]);

  function selectColumn(column: string) {
    setSession((current) => ({ ...current, column, expanded: null, query: "" }));
  }
  function closeValue() {
    setSession((current) => ({ ...current, expanded: null }));
    if (selection?.opener.isConnected) selection.opener.focus({ preventScroll: true });
    else fieldSelect.current?.focus({ preventScroll: true });
  }

  return <section aria-label={t("sampleReviewTitle")} className="min-w-0">
    {columns.length > 0 && <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <CleaningColumnSelect inline selectRef={fieldSelect} columns={columns} labels={labels} value={selectedColumn}
          onChange={selectColumn} query={session.query} onQueryChange={(query) => setSession((current) => ({ ...current, query }))}
          label={t("sampleLocateColumn")} searchLabel={t("sampleSearchColumns")} />
        {columns.length > COLUMNS_PER_PAGE && <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" disabled={page === 0} aria-label={t("samplePreviousColumns")}
            onClick={() => selectColumn(columns[start - COLUMNS_PER_PAGE])}
            className="size-8 p-0"><ChevronLeft size={15} /></Button>
          <span aria-live="polite" className="text-[11px] tabular-nums text-muted-foreground">
            {t("sampleColumnRange", { start: start + 1, end: start + visibleColumns.length, total: columns.length })}
          </span>
          <Button variant="ghost" size="sm" disabled={start + COLUMNS_PER_PAGE >= columns.length} aria-label={t("sampleNextColumns")}
            onClick={() => selectColumn(columns[start + COLUMNS_PER_PAGE])}
            className="size-8 p-0"><ChevronRight size={15} /></Button>
        </div>}
      </div>
      <div className="flex flex-wrap items-center gap-4">
      {onCleanColumn && isCleaningFieldName(selectedColumn) && <Button variant="ghost" size="sm"
        aria-label={t("cleanColumnAria", { column: labels.get(selectedColumn) ?? selectedColumn })}
        onClick={() => onCleanColumn(selectedColumn)}
        className="text-primary"><Eraser size={13} aria-hidden="true" />{t("cleanColumn")}</Button>}
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={session.whitespace} onChange={(event) => {
          const whitespace = event.target.checked;
          setSession((current) => ({ ...current, whitespace }));
        }}
          className="accent-primary" />{t("sampleShowWhitespace")}
      </label>
      </div>
    </div>}
    {session.whitespace && <p className="mb-3 text-xs text-muted-foreground">{t("sampleWhitespaceLegend")}</p>}
    <div className={`grid min-w-0 gap-5 ${after ? "grid-cols-2" : ""}`}>
      {snapshots.map((snapshot, side) => <section key={side} className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">{titles[side]}</h4>
          <span className="text-xs text-muted-foreground">{t("summaryCounts", { rows: snapshot.rows.toLocaleString(locale), columns: snapshot.columns })}</span>
        </div>
        <div ref={(node) => { scrollers.current[side] = node; }} tabIndex={0} role="region" aria-label={t("sampleTableScroll", { title: titles[side] })}
          className="max-h-72 overflow-auto overscroll-contain rounded-lg border border-border bg-background outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          {snapshot.sample.length > 0 && visibleColumns.length > 0 ? (
            <table aria-label={titles[side]} className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-muted"><tr>
                <th scope="col" className="sticky left-0 z-10 min-w-10 whitespace-nowrap border-b border-r border-border bg-muted px-2 py-2 font-normal text-muted-foreground">{t("sampleRowHeading")}</th>
                {visibleColumns.map((column) => <th key={column} scope="col" ref={column === selectedColumn ? (node) => { selectedHeaders.current[side] = node; } : undefined}
                  className={`min-w-36 border-b border-r border-border px-3 py-2 font-semibold last:border-r-0 ${column === selectedColumn ? "bg-primary/10 text-primary" : ""}`}>
                  <span className="block max-w-48 break-words [overflow-wrap:anywhere]">{labels.get(column)}</span>
                </th>)}
              </tr></thead>
              <tbody>{snapshot.sample.map((row, rowIndex) => <tr key={rowIndex} className="border-b border-border last:border-b-0">
                <th scope="row" className="sticky left-0 border-r border-border bg-background px-2 py-2 align-top font-normal tabular-nums text-muted-foreground">{rowIndex + 1}</th>
                {visibleColumns.map((column) => {
                  const value = row[column];
                  const raw = dataCellText(value);
                  const expandable = cellLabel(row, column, t) === null && (raw.length > 24 || /[\r\n\t]/.test(raw) || typeof value === "object");
                  return <td key={column} className={`border-r border-border px-3 py-2 align-top last:border-r-0 ${column === selectedColumn ? "bg-primary/[0.025]" : ""}`}>
                    <div className="max-w-48">
                      <span className="line-clamp-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere]"><SampleValue row={row} column={column} whitespace={session.whitespace} /></span>
                      {expandable && <Button variant="ghost" size="sm" aria-label={t("sampleExpandValue", { title: titles[side], count: rowIndex + 1, column: labels.get(column) ?? column })}
                        aria-expanded={selection?.side === side && selection.row === rowIndex && selection.column === column}
                        onClick={(event) => {
                          const opener = event.currentTarget;
                          setSession((current) => ({ ...current, expanded: { side, row: rowIndex, column, opener } }));
                        }}
                        className="mt-1 text-primary"><Maximize2 size={10} />{t("sampleExpand")}</Button>}
                    </div>
                  </td>;
                })}
              </tr>)}</tbody>
            </table>
          ) : <p className="px-4 py-8 text-center text-xs text-muted-foreground">{t("noSample")}</p>}
        </div>
      </section>)}
    </div>
    {expandedRow && selection && <FullSampleValue key={`${selection.side}:${selection.row}:${selection.column}`}
      row={expandedRow} column={selection.column} columnLabel={labels.get(selection.column) ?? selection.column} title={titles[selection.side]} position={selection.row + 1} whitespace={session.whitespace} onClose={closeValue} />}
    <p className="mt-3 text-xs text-muted-foreground">{t(after ? "sampleIndependentScope" : "sampleScope")}</p>
  </section>;
}
