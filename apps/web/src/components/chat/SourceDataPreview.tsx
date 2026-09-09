"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Eraser, Maximize2 } from "lucide-react";
import type { PreflightReport, ProjectDataSource } from "@/lib/types/api";
import { sourcePreview, type SourcePreview } from "@/lib/source-preview";
import { fileSourceBlockers } from "@/lib/source-activation";
import { sourceDisplayState } from "@/lib/source-directory";
import { cleaningColumnLabels, isCleaningFieldName } from "@/lib/cleaning-field-names";
import { CleaningSamples } from "./CleaningSamples";
import { DataViewDialog } from "@/components/data/DataViewDialog";
import { SearchField } from "@/components/ui/SearchField";
import { Button } from "@/components/ui/button";
import { TabList } from "@/components/ui/TabList";

const FIELD_PAGE_SIZE = 20;
type PreviewTab = "sample" | "fields";

export function SourceDataPreview({ source, report, onCleanColumn }: {
  source: ProjectDataSource; report?: PreflightReport; onCleanColumn?: (column: string) => void;
}) {
  const data = useMemo(() => source.kind === "file" && source.status !== "attached" ? sourcePreview(source.profile_data) : null, [source.kind, source.status, source.profile_data]);
  if (!data ||
    (!data.rows.length && !data.fields.length && data.totalRows !== 0)) return null;
  const warning = fileSourceBlockers(source).has("recipe_input_changed") ? "changedSample"
    : source.status === "error" ? "previousSample"
    : sourceDisplayState(source, report) === "preparation_review" ? "reviewSample" : null;
  return <SourcePreviewSession key={source.id} name={source.name} data={data} warning={warning} onCleanColumn={onCleanColumn} />;
}

function SourcePreviewSession({ name, data, warning, onCleanColumn }: {
  name: string; data: SourcePreview; warning: string | null; onCleanColumn?: (column: string) => void;
}) {
  const t = useTranslations("sourcePreview"), locale = useLocale();
  const cleaning = useTranslations("visualCleaning");
  const id = useId();
  const initialTab: PreviewTab = data.rows.length || !data.fields.length ? "sample" : "fields";
  const [session, setSession] = useState(() => ({
    data, tab: initialTab,
    query: "", limit: FIELD_PAGE_SIZE, column: data.fields[0]?.name ?? "",
  }));
  const [expanded, setExpanded] = useState<{ name: string; rows: SourcePreview["rows"] } | null>(null);
  if (session.data !== data) {
    setSession({ data, tab: initialTab, query: "", limit: FIELD_PAGE_SIZE, column: data.fields[0]?.name ?? "" });
    setExpanded(null);
  }
  const names = useMemo(() => data.fields.map((field) => field.name), [data.fields]);
  const labels = useMemo(() => cleaningColumnLabels(names), [names]);
  const matches = useMemo(() => {
    const query = session.query.trim().toLocaleLowerCase(locale);
    return data.fields.filter((field) => !query || field.name.toLocaleLowerCase(locale).includes(query) ||
      (labels.get(field.name) ?? "").toLocaleLowerCase(locale).includes(query));
  }, [data.fields, session.query, locale, labels]);
  const visible = matches.slice(0, session.limit);
  const fieldSearch = useRef<HTMLInputElement>(null);
  const fieldRows = useRef(new Map<string, HTMLTableRowElement>());
  const [focusRequest, setFocusRequest] = useState<{ kind: "sample" } | { kind: "field"; name: string } | null>(null);
  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.kind === "sample") {
      const target = document.getElementById(`${id}-sample`);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView?.({ block: "nearest" });
    }
    else {
      const target = fieldRows.current.get(focusRequest.name);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView?.({ block: "nearest" });
    }
  }, [focusRequest, id]);
  const fieldLabel = (name: string) => labels.get(name) || t("unnamedField");
  const updateQuery = (query: string) => setSession((current) => ({ ...current, query, limit: FIELD_PAGE_SIZE }));

  return <section aria-label={t("title")} className="mt-5 min-w-0 border-t border-border pt-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">{t("title")}</h3>
      <div className="flex flex-wrap items-center gap-3">
        {data.totalRows !== null && <span className="text-xs tabular-nums text-muted-foreground">{t("totalRows", { count: data.totalRows.toLocaleString(locale) })}</span>}
        {data.rows.length > 0 && <Button variant="ghost" size="sm" onClick={() => setExpanded({ name, rows: structuredClone(data.rows) })}
          className="text-primary"><Maximize2 size={13} aria-hidden="true" />{t("expandSample")}</Button>}
      </div>
    </div>
    {warning && <p className="mb-3 border-l-2 border-warning/50 bg-warning/[0.05] px-3 py-2 text-xs leading-5 text-warning">{t(warning)}</p>}
    {data.limitedFields && <p className="mb-3 text-xs text-muted-foreground">{t("limitedFields", { count: data.fields.length })}</p>}
    <TabList id={id} label={t("title")} value={session.tab} className="mb-4"
      onChange={(tab: PreviewTab) => setSession(current => ({ ...current, tab }))}
      items={(["sample", "fields"] as const).map(tab => ({ value: tab,
        label: <>{t(tab)}<span className="ml-1.5 text-[11px] tabular-nums opacity-70">{tab === "sample" ? data.rows.length : data.fields.length}</span></>,
      }))} />
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${session.tab}`} className="min-w-0">
      {session.tab === "sample" ? data.rows.length ? <>
        <CleaningSamples title={t("sampleTitle")} columnNames={names} columnOrder={names} preferredColumns={[session.column]}
          onCleanColumn={onCleanColumn}
          before={{ rows: data.rows.length, columns: names.length, sample: data.rows }} />
        {data.limitedRows && <p className="mt-2 text-xs text-muted-foreground">{t("limitedRows", { count: data.rows.length })}</p>}
      </> : <p className="py-6 text-center text-xs text-muted-foreground">{t(data.totalRows === 0 ? "emptyData" : "noSample")}</p>
        : <>
          <SearchField inputRef={fieldSearch} value={session.query} onChange={updateQuery} maxLength={200}
            label={t("searchFields")} clearLabel={t("clearSearch")} controls={`${id}-fields`} className="mb-3" />
          <p role="status" className="mb-2 text-[11px] tabular-nums text-muted-foreground">{t("fieldCount", { shown: visible.length, total: matches.length })}</p>
          <div className="max-h-80 overflow-auto overscroll-contain rounded-lg border border-border">
            <table id={`${id}-fields`} className="w-full text-left text-xs" aria-label={t("fields")}>
              <thead className="sticky top-0 bg-muted"><tr>
                <th scope="col" className="px-3 py-2 font-medium">{t("name")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("type")}</th>
                <th scope="col" className="whitespace-nowrap px-3 py-2 text-right font-medium">{t("missing")}</th>
                {onCleanColumn && <th scope="col" className="w-10 px-1"><span className="sr-only">{cleaning("sectionTitle")}</span></th>}
              </tr></thead>
              <tbody>{visible.map((field) => <tr key={field.name} tabIndex={-1}
                ref={(node) => { if (node) fieldRows.current.set(field.name, node); else fieldRows.current.delete(field.name); }}
                className="border-t border-border outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  {data.rows.length ? <Button variant="ghost" size="sm" aria-label={t("viewField", { name: fieldLabel(field.name) })}
                    onClick={() => { setSession((current) => ({ ...current, tab: "sample", column: field.name })); setFocusRequest({ kind: "sample" }); }}
                    className="h-auto min-h-8 w-full justify-start whitespace-normal text-left text-primary">
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">{fieldLabel(field.name)}</span><ArrowRight size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                  </Button> : <span className="break-words [overflow-wrap:anywhere]">{fieldLabel(field.name)}</span>}
                </th>
                <td className="px-3 py-2 text-muted-foreground">{t(`kind.${field.kind}`)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">{field.missing === null ? "—" : field.missing.toLocaleString(locale)}</td>
                {onCleanColumn && <td className="px-1 py-2">{isCleaningFieldName(field.name) && <Button variant="ghost" size="sm"
                  aria-label={cleaning("cleanColumnAria", { column: fieldLabel(field.name) })}
                  title={cleaning("cleanColumnAria", { column: fieldLabel(field.name) })}
                  onClick={() => onCleanColumn(field.name)}
                  className="size-8 p-0"><Eraser size={14} aria-hidden="true" /></Button>}</td>}
              </tr>)}</tbody>
            </table>
            {!matches.length && <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t(data.fields.length ? "noMatchingFields" : "noFields")}</p>}
          </div>
          {visible.length < matches.length && <Button variant="outline" size="sm" className="mt-2 h-9 w-full"
            onClick={() => {
              setSession((current) => ({ ...current, limit: current.limit + FIELD_PAGE_SIZE }));
              setFocusRequest({ kind: "field", name: matches[visible.length].name });
            }}>{t("moreFields", { count: Math.min(FIELD_PAGE_SIZE, matches.length - visible.length) })}</Button>}
        </>}
    </div>
    {expanded && <DataViewDialog snapshot={{ title: `${expanded.name} · ${t("sampleTitle")}`, rows: expanded.rows,
      notice: [warning && t(warning), t("sampleNotice", { count: expanded.rows.length })].filter(Boolean).join(" ") }} onClose={() => setExpanded(null)} />}
  </section>;
}
