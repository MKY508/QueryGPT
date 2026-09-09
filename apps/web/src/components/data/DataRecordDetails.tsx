"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, ChevronLeft, ChevronRight, Copy, ListFilter } from "lucide-react";
import { createTsv } from "@/lib/csv";
import { dataCellText, dataCellValue, type TableRecord } from "@/lib/tabular-data";
import { tableFilterFromValue, type TableFieldKind } from "@/lib/tabular-filters";
import { tableTextMatcher } from "@/lib/table-text-search";
import { useDataClipboard } from "./useDataClipboard";
import { SearchField } from "@/components/ui/SearchField";

export function DataRecordDetails({ record, position, total, columns, kinds, filterEditing, onFilter, onNavigate, onClose }: {
  record: TableRecord; position: number; total: number; columns: string[];
  kinds: ReadonlyMap<string, TableFieldKind>; filterEditing: boolean;
  onFilter: (field: string, value: unknown, origin: HTMLButtonElement) => void;
  onNavigate: (direction: -1 | 1) => void; onClose: () => void;
}) {
  const t = useTranslations("dataView"), locale = useLocale();
  const closeRef = useRef<HTMLButtonElement>(null);
  const operation = useRef(0);
  const { copying, write } = useDataClipboard();
  const [fieldQuery, setFieldQuery] = useState("");
  const [feedback, setFeedback] = useState<{ record: TableRecord; columns: string[]; failed: boolean } | null>(null);
  const fields = columns.filter(tableTextMatcher(fieldQuery, locale));
  const fieldStatusId = useId();
  const emptyMessageId = useId();
  const currentFeedback = feedback?.record === record && feedback.columns === columns ? feedback : null;
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    return () => { operation.current += 1; };
  }, []);
  const copy = async (value: () => string) => {
    if (copying) return;
    const request = ++operation.current;
    setFeedback(null);
    try {
      const written = await write(value);
      if (written && request === operation.current) setFeedback({ record, columns, failed: false });
    } catch {
      if (request === operation.current) setFeedback({ record, columns, failed: true });
    }
  };
  return <aside aria-label={t("recordDetails")} className="flex min-h-0 min-w-0 w-[360px] flex-none flex-col border-l border-border bg-card">
    <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
      <button ref={closeRef} data-record-back type="button" onClick={onClose} className="inline-flex rounded-md h-8 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft size={14} />{t("backToTable")}</button>
      <div className="flex items-center gap-1">
        <span aria-live="polite" aria-atomic="true" className="mr-1 text-xs tabular-nums text-muted-foreground">{t("recordPosition", { current: position + 1, total })}</span>
        <button type="button" aria-disabled={position <= 0} aria-label={t("previousRecord")} onClick={() => { if (position > 0) onNavigate(-1); }} className="inline-flex rounded-md h-8 w-8 items-center justify-center hover:bg-muted aria-disabled:opacity-30 aria-disabled:hover:bg-transparent"><ChevronLeft size={16} /></button>
        <button type="button" aria-disabled={position >= total - 1} aria-label={t("nextRecord")} onClick={() => { if (position < total - 1) onNavigate(1); }} className="inline-flex rounded-md h-8 w-8 items-center justify-center hover:bg-muted aria-disabled:opacity-30 aria-disabled:hover:bg-transparent"><ChevronRight size={16} /></button>
      </div>
    </header>
    <div className="shrink-0 border-b border-border px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0"><h3 className="text-sm font-semibold">{t("recordDetails")}</h3>
          <p id={fieldStatusId} role="status" aria-atomic="true" className={fieldQuery.trim() ? "mt-1 text-[11px] tabular-nums text-muted-foreground" : "sr-only"}>
            {t("fieldMatches", { count: fields.length, total: columns.length })}
          </p>
        </div>
        <button type="button" disabled={copying || !columns.length} aria-busy={copying} onClick={() => void copy(() => createTsv([record.row], columns))}
          title={t("copyRecordHint", { count: columns.length })} className="inline-flex rounded-md h-8 items-center gap-1.5 px-2 text-xs text-primary hover:bg-primary/5 disabled:opacity-40"><Copy size={13} />{t("copyRecord")}</button>
      </div>
      <SearchField label={t("searchFields")} clearLabel={t("clearFieldSearch")} value={fieldQuery} onChange={setFieldQuery}
        describedBy={fields.length ? fieldStatusId : emptyMessageId}
        className="mt-2 border-b border-input" inputClassName="h-9" />
    </div>
    {currentFeedback && <p role={currentFeedback.failed ? "alert" : "status"} className={`shrink-0 px-4 pt-2 text-xs ${currentFeedback.failed ? "text-destructive" : "text-muted-foreground"}`}>
      {t(currentFeedback.failed ? "copyError" : "copied")}
    </p>}
    <div className="min-h-0 flex-1 overflow-y-auto px-4"><dl>
      {fields.map((field) => {
        const value = dataCellValue(record.row, field);
        const filterable = tableFilterFromValue(field, value, kinds) !== null;
        return <div key={field} className="group border-b border-border/60 py-3 last:border-b-0">
        <dt className="flex items-start justify-between gap-3 text-[11px] font-medium text-muted-foreground">
          <span className="min-w-0 break-words">{field}</span>
          <div className="-mt-1 flex shrink-0 items-center gap-1">
          {filterable && <button type="button" aria-disabled={filterEditing} aria-label={t("filterValue", { field })}
            title={t(filterEditing ? "finishFilter" : "filterValue", { field })}
            onClick={(event) => { if (!filterEditing) onFilter(field, value, event.currentTarget); }}
            className="inline-flex h-7 w-7 items-center justify-center text-primary hover:bg-primary/5 aria-disabled:opacity-40"><ListFilter size={13} /></button>}
          <button type="button" disabled={copying} aria-label={t("copyValue", { field })} onClick={() => void copy(() => dataCellText(value))}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center hover:bg-muted hover:text-foreground disabled:opacity-40"><Copy size={12} /></button>
          </div>
        </dt>
        <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">
          {value === null || value === undefined ? <span className="text-muted-foreground">{t("emptyValue")}</span>
            : value === "" ? <span className="text-muted-foreground">{t("blankValue")}</span> : dataCellText(value)}
        </dd>
      </div>; })}
    </dl>
      {!fields.length && <p id={emptyMessageId} className="break-words py-8 text-center text-xs text-muted-foreground [overflow-wrap:anywhere]">
        {columns.length ? t("noFieldMatches", { query: fieldQuery }) : t("noVisibleFields")}
      </p>}
    </div>
  </aside>;
}
