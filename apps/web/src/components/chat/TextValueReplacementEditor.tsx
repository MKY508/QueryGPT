"use client";

import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { TabList } from "@/components/ui/TabList";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { TextValueReplacement } from "@/lib/types/api";
import { MAX_TEXT_REPLACEMENTS, sampleTextReplacementValues, textReplacementError, textReplacementGroup } from "@/lib/text-value-replacements";
import { TextReplacementSamplePicker } from "./TextReplacementSamplePicker";

export function TextReplacementSummary({ replacements }: { replacements: TextValueReplacement[] }) {
  const t = useTranslations("visualCleaning");
  return (
    <details className="mt-1 text-xs text-muted-foreground">
      <summary className="w-fit cursor-pointer">{t("replacementDetails")}</summary>
      <ul className="mt-2 max-h-48 space-y-1 overflow-auto">
        {replacements.map((item) => (
          <li key={item.from_value} className="break-all whitespace-pre-wrap">
            {item.from_value === "" ? t("emptyTextValue") : `“${item.from_value}”`}
            {" → "}
            {item.to_value === "" ? t("emptyTextValue") : `“${item.to_value}”`}
          </li>
        ))}
      </ul>
    </details>
  );
}

export interface TextValueReplacementEditorHandle { hasChanges: () => boolean }

export function TextValueReplacementEditor({ column, columnLabel = column, initial, suggestions, available, disabled, onSave, onCancel, ref }: {
  column: string;
  columnLabel?: string;
  initial: TextValueReplacement[];
  suggestions: string[];
  available: number;
  disabled: boolean;
  onSave: (replacements: TextValueReplacement[]) => void;
  onCancel: () => void;
  ref?: Ref<TextValueReplacementEditorHandle>;
}) {
  const t = useTranslations("visualCleaning");
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView?.({ block: "start" });
  }, []);
  const [samples] = useState(() => sampleTextReplacementValues(suggestions));
  const [startedEmpty] = useState(initial.length === 0);
  const [mode, setMode] = useState<"sample" | "manual">(() => startedEmpty && samples.length > 1 ? "sample" : "manual");
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [emptyTarget, setEmptyTarget] = useState(false);
  const groupChanged = selected.length > 0 || target !== "" || emptyTarget;
  const [baseline] = useState(() => (initial.length ? initial : [{ from_value: "", to_value: "" }]).map(row => ({ ...row })));
  const [rows, setRows] = useState(() => baseline.map((row, index) => ({ ...row, id: index })));
  useImperativeHandle(ref, () => ({ hasChanges: () => groupChanged || rows.length !== baseline.length || rows.some((row, index) =>
    row.from_value !== baseline[index].from_value || row.to_value !== baseline[index].to_value) }), [rows, baseline, groupChanged]);
  const [nextId, setNextId] = useState(rows.length);
  const [error, setError] = useState<string | null>(null);
  const limit = Math.min(MAX_TEXT_REPLACEMENTS, available);
  const placeholderOnly = startedEmpty && rows.length === 1 && rows[0].id === 0 && rows[0].from_value === "" && rows[0].to_value === "";
  const kept = placeholderOnly ? [] : rows;
  const used = new Set(kept.map(row => row.from_value));
  const rowInputs = useRef(new Map<number, HTMLTextAreaElement>());
  const [focusRow, setFocusRow] = useState<number | null>(null);
  useEffect(() => {
    if (focusRow === null || mode !== "manual") return;
    const input = rowInputs.current.get(focusRow);
    input?.focus({ preventScroll: true }); input?.scrollIntoView?.({ block: "nearest" });
  }, [focusRow, mode]);

  const clearGroup = () => { setSelected([]); setTarget(""); setEmptyTarget(false); setError(null); };
  const addGroup = () => {
    if (disabled || (!emptyTarget && target === "")) return;
    const result = textReplacementGroup(kept, samples.filter(value => selected.includes(value)), emptyTarget ? "" : target, limit);
    if (result.error) { setError(t(`groupError.${result.error}`)); return; }
    const added = result.additions.map((pair, index) => ({ ...pair, id: nextId + index }));
    setRows([...kept, ...added]); setNextId(nextId + added.length); clearGroup(); setMode("manual"); setFocusRow(added[0].id);
  };

  const update = (rowId: number, key: "from_value" | "to_value", value: string) => {
    setRows((current) => current.map((row) => row.id === rowId ? { ...row, [key]: value } : row));
    setError(null);
  };
  const save = () => {
    if (disabled || groupChanged) return;
    const values = rows.map(({ from_value, to_value }) => ({ from_value, to_value }));
    const problem = textReplacementError(values);
    if (problem) { setError(t(`replacementError.${problem}`)); return; }
    if (rows.length > available) { setError(t("replacementTotalLimit")); return; }
    onSave(values);
  };

  return (
    <section className="mt-4 rounded-lg border border-border bg-background p-3" aria-label={t("replacementEditorTitle", { column: columnLabel })}>
      <h4 ref={headingRef} tabIndex={-1} className="break-words text-sm font-semibold outline-none">{t("replacementEditorTitle", { column: columnLabel })}</h4>
      <p className="mt-1 text-xs text-muted-foreground">{t("replacementScope")}</p>
      {samples.length > 0 && <TabList id={id} label={t("replacementInputMode")} value={mode} disabled={disabled} className="mt-4"
        onChange={(tab: "sample" | "manual") => { setFocusRow(null); setMode(tab); setError(null); }}
        items={[{ value: "sample", label: t("replacementSampleMode") }, { value: "manual", label: t("replacementManualMode") }]} />}
      <div id={`${id}-panel`} role={samples.length ? "tabpanel" : undefined} aria-labelledby={samples.length ? `${id}-${mode}` : undefined}>
      {mode === "sample" ? <TextReplacementSamplePicker values={samples} selected={selected} target={target} emptyTarget={emptyTarget} used={used} disabled={disabled}
        onSelect={value => { setSelected(current => current.includes(value) ? current.filter(item => item !== value) : [...current, value]); setError(null); }}
        onTarget={value => { setTarget(value); setError(null); }} onEmptyTarget={value => { setEmptyTarget(value); setError(null); }} />
        : <div className="mt-3 max-h-80 space-y-3 overflow-y-auto">
        {rows.map((row, index) => (
          <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
            <label className="text-xs text-muted-foreground">
              {t("replacementFrom")}
              <textarea rows={2} value={row.from_value} disabled={disabled} maxLength={2000}
                aria-label={t("replacementFromAria", { count: index + 1 })}
                onChange={(event) => update(row.id, "from_value", event.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-card px-2 py-2 text-sm text-foreground" />
            </label>
            <label className="min-w-0 text-xs text-muted-foreground">
              {t("replacementTo")}
              <textarea rows={2} value={row.to_value} disabled={disabled} maxLength={2000}
                ref={node => { if (node) rowInputs.current.set(row.id, node); else rowInputs.current.delete(row.id); }}
                aria-label={t("replacementToAria", { count: index + 1 })}
                onChange={(event) => update(row.id, "to_value", event.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-card px-2 py-2 text-sm text-foreground" />
            </label>
            <Button variant="ghost" size="sm" disabled={disabled} aria-label={t("replacementRemoveAria", { count: index + 1 })}
              onClick={() => { setRows((current) => current.filter((item) => item.id !== row.id)); setError(null); }}
              className="size-9 p-0 hover:text-destructive"><Trash2 size={14} /></Button>
          </div>
        ))}
      </div>}
      </div>
      {mode === "manual" && groupChanged && <p role="status" className="mt-3 text-xs text-muted-foreground">{t("groupPending")}</p>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {mode === "manual" ? <Button variant="ghost" size="sm" disabled={disabled || rows.length >= limit}
          onClick={() => { setRows((current) => [...current, { id: nextId, from_value: "", to_value: "" }]); setNextId(nextId + 1); setError(null); }}
          ><Plus size={13} />{t("replacementAddRow")}</Button>
          : <Button variant="ghost" size="sm" disabled={disabled || !groupChanged} onClick={clearGroup} >{t("groupClear")}</Button>}
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" disabled={disabled} onClick={onCancel} >{t("replacementCancel")}</Button>
          {mode === "sample" ? <Button variant="primary" size="sm" disabled={disabled || !selected.length || (!emptyTarget && target === "")} onClick={addGroup}
            className="h-9">{t("groupAdd")}</Button>
            : <Button variant="primary" size="sm" disabled={disabled || !rows.length || groupChanged} onClick={save} className="h-9">{t("replacementSave")}</Button>}
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}
