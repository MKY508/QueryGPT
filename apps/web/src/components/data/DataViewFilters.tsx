"use client";

import { useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { useTranslations } from "next-intl";
import { ListFilter, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { EMPTY_TABLE_FILTERS, tableFilterError, tableFilterFromValue, tableFilterNeedsValue, tableFilterOperators,
  type TableFieldKind, type TableFilter, type TableFilterOperator, type TableFilters } from "@/lib/tabular-filters";

export interface DataViewFiltersHandle {
  dismiss: () => boolean;
  beginValue: (field: string, value: unknown, origin: HTMLButtonElement) => void;
}
const control = "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs";

/** One inline editor, with explicit Apply; unfinished conditions never affect rows or exports. */
export function DataViewFilters({ filters, kinds, onChange, onBegin, onEnd, ref }: {
  filters: TableFilters; kinds: ReadonlyMap<string, TableFieldKind>;
  onChange: (next: TableFilters) => void; onBegin?: () => void; onEnd?: () => void; ref: Ref<DataViewFiltersHandle>;
}) {
  const t = useTranslations("dataView.filters");
  const tData = useTranslations("dataView");
  const [draft, setDraft] = useState<TableFilter | null>(null);
  const [draftMode, setDraftMode] = useState(filters.mode);
  const [submitted, setSubmitted] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const originRef = useRef<HTMLButtonElement | null>(null);
  const composing = useRef(false);
  const nextId = useRef(0);
  const editorId = useId();
  const errorId = useId();
  const error = draft ? tableFilterError(draft, kinds) : null;
  const kind = draft ? kinds.get(draft.field) || "text" : "text";
  const close = (restoreOrigin = true) => {
    setDraft(null); setSubmitted(false); composing.current = false; onEnd?.();
    const origin = originRef.current;
    (restoreOrigin && origin?.isConnected ? origin : trigger.current)?.focus();
    originRef.current = null;
  };
  const begin = (rule?: TableFilter, origin?: HTMLButtonElement) => {
    if (draft) return;
    onBegin?.();
    originRef.current = origin || null;
    composing.current = false;
    const field = kinds.keys().next().value ?? "";
    setDraft(rule ? { ...rule } : { id: String(nextId.current++), field,
      operator: tableFilterOperators(kinds.get(field) || "text")[0], value: "", upper: "" });
    setSubmitted(false);
    setDraftMode(filters.mode);
  };
  useImperativeHandle(ref, () => ({
    dismiss: () => { if (!draft) return false; close(); return true; },
    beginValue: (field, value, origin) => {
      if (draft) return; // A record action cannot discard unfinished work.
      const seed = tableFilterFromValue(field, value, kinds);
      if (!seed) return;
      const existing = filters.rules.find((rule) => rule.field === seed.field && rule.operator === seed.operator
        && rule.value === seed.value && rule.upper === seed.upper);
      begin(existing || { ...seed, id: String(nextId.current++) }, origin);
    },
  }));
  const draftRuleCount = filters.rules.length + (draft && !filters.rules.some((rule) => rule.id === draft.id) ? 1 : 0);
  const description = (rule: TableFilter) => [rule.field, t(`operators.${rule.operator}`),
    tableFilterNeedsValue(rule.operator) ? kinds.get(rule.field) === "boolean" ? t(rule.value === "true" ? "true" : "false") : rule.value : "",
    rule.operator === "between" ? `${t("to")} ${rule.upper}` : ""].filter(Boolean).join(" ");
  const remove = (id: string) => {
    if (draft) return;
    onChange({ ...filters, rules: filters.rules.filter((rule) => rule.id !== id) });
    trigger.current?.focus();
  };
  return <section aria-label={t("title")} className="shrink-0 overflow-y-auto border-b border-border bg-muted/10 px-5 py-2 max-h-[45dvh]">
    <div className="flex flex-wrap items-center gap-2">
      <button ref={trigger} type="button" disabled={!kinds.size} aria-expanded={Boolean(draft)} aria-controls={draft ? editorId : undefined}
        onClick={() => draft ? close() : begin()} className="inline-flex min-h-8 items-center gap-2 text-xs font-medium text-primary disabled:opacity-40">
        <ListFilter size={14} />{t("add")}
      </button>
      {!draft && filters.rules.length > 1 && <select aria-label={t("match")} value={filters.mode}
        onChange={(event) => onChange({ ...filters, mode: event.target.value as TableFilters["mode"] })}
        className="rounded-md h-8 min-w-0 border border-border bg-background px-2 text-xs">
        <option value="all">{t("all")}</option><option value="any">{t("any")}</option>
      </select>}
      {filters.rules.map((rule) => <div key={rule.id} className="rounded-md inline-flex max-w-full items-center border border-primary/25 bg-primary/5 text-xs text-primary">
        <button type="button" title={draft ? tData("finishFilter") : description(rule)} aria-disabled={Boolean(draft)} aria-label={t("edit", { condition: description(rule) })}
          onClick={() => begin(rule)} className="min-h-8 min-w-0 truncate px-2.5 text-left hover:bg-primary/10 aria-disabled:opacity-40">{description(rule)}</button>
        <button type="button" onClick={() => remove(rule.id)} aria-disabled={Boolean(draft)} title={draft ? tData("finishFilter") : undefined} aria-label={t("remove", { condition: description(rule) })}
          className="rounded-md inline-flex h-8 w-8 shrink-0 items-center justify-center hover:bg-primary/10 aria-disabled:opacity-40"><X size={13} /></button>
      </div>)}
      {filters.rules.length > 0 && <button type="button" aria-disabled={Boolean(draft)} title={draft ? tData("finishFilter") : undefined}
        onClick={() => { if (draft) return; onChange(EMPTY_TABLE_FILTERS); close(); }}
        className="min-h-8 text-xs text-muted-foreground hover:text-foreground aria-disabled:opacity-40">{t("clear")}</button>}
    </div>
    {draft && <form id={editorId} aria-label={t("editor")} className="mt-2 border-t border-border pt-3 pb-1"
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || composing.current)) event.preventDefault();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (composing.current) return;
        setSubmitted(true);
        if (error) return;
        const exists = filters.rules.some((rule) => rule.id === draft.id);
        onChange({ mode: draftMode, rules: exists ? filters.rules.map((rule) => rule.id === draft.id ? draft : rule) : [...filters.rules, draft] });
        // Applying a different operator can remove the inspected record and its opener.
        close(false);
      }}>
      {draftRuleCount > 1 && <label className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">{t("match")}
        <select value={draftMode} onChange={(event) => setDraftMode(event.target.value as TableFilters["mode"])}
          className="rounded-md h-8 min-w-0 max-w-full border border-border bg-background px-2 text-xs text-foreground">
          <option value="all">{t("all")}</option><option value="any">{t("any")}</option>
        </select>
      </label>}
      <div className="grid min-w-0 grid-cols-[minmax(100px,1fr)_minmax(100px,1fr)_minmax(160px,2fr)_auto] items-end gap-2">
        <label className="min-w-0 text-[11px] text-muted-foreground">{t("field")}
          <select autoFocus value={draft.field} onChange={(event) => {
            const field = event.target.value;
            setDraft({ ...draft, field, operator: tableFilterOperators(kinds.get(field) || "text")[0], value: "", upper: "" });
            setSubmitted(false);
          }} className={cn(control, "mt-1 text-foreground")}>
            {[...kinds.keys()].map((field) => <option key={field} value={field}>{field}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-[11px] text-muted-foreground">{t("operator")}
          <select value={draft.operator} onChange={(event) => { setDraft({ ...draft, operator: event.target.value as TableFilterOperator }); setSubmitted(false); }} className={cn(control, "mt-1 text-foreground")}>
            {tableFilterOperators(kind).map((operator) => <option key={operator} value={operator}>{t(`operators.${operator}`)}</option>)}
          </select>
        </label>
        <div className="flex min-w-0 gap-2">
          {tableFilterNeedsValue(draft.operator) && <label className="min-w-0 flex-1 text-[11px] text-muted-foreground">{t(draft.operator === "between" ? "lower" : "value")}
            {kind === "boolean" ? <select value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} className={cn(control, "mt-1 text-foreground")}>
              <option value="" disabled>{t("chooseValue")}</option><option value="true">{t("true")}</option><option value="false">{t("false")}</option>
            </select> : kind === "text" ? <textarea value={draft.value} maxLength={4096} rows={/[\r\n]/.test(draft.value) ? 3 : 1}
              onChange={(event) => setDraft({ ...draft, value: event.target.value })} aria-invalid={submitted && Boolean(error)} aria-describedby={submitted && error ? errorId : undefined}
              className={cn(control, "mt-1 h-auto min-h-9 max-h-32 resize-y py-2 text-foreground")} /> : <input value={draft.value} maxLength={256} inputMode="decimal"
              onChange={(event) => setDraft({ ...draft, value: event.target.value })} aria-invalid={submitted && Boolean(error)} aria-describedby={submitted && error ? errorId : undefined}
              className={cn(control, "mt-1 text-foreground")} />}
          </label>}
          {draft.operator === "between" && <label className="min-w-0 flex-1 text-[11px] text-muted-foreground">{t("upper")}
            <input value={draft.upper} inputMode="decimal" maxLength={256} onChange={(event) => setDraft({ ...draft, upper: event.target.value })}
              aria-invalid={submitted && Boolean(error)} aria-describedby={submitted && error ? errorId : undefined} className={cn(control, "mt-1 text-foreground")} />
          </label>}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => close()} className="h-9 px-3 text-xs text-muted-foreground hover:bg-muted">{t("cancel")}</button>
          <button type="submit" className="rounded-md inline-flex h-9 items-center gap-1 bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"><Plus size={13} />{t("apply")}</button>
        </div>
      </div>
      {submitted && error && <p id={errorId} role="alert" className="mt-2 text-xs text-destructive">{t(`errors.${error}`)}</p>}
    </form>}
  </section>;
}
