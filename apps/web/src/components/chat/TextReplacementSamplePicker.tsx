"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { cleaningColumnLabels } from "@/lib/cleaning-field-names";

export function TextReplacementSamplePicker({ values, selected, target, emptyTarget, used, disabled, onSelect, onTarget, onEmptyTarget }: {
  values: readonly string[]; selected: readonly string[]; target: string; emptyTarget: boolean; used: ReadonlySet<string>; disabled: boolean;
  onSelect: (value: string) => void; onTarget: (value: string) => void; onEmptyTarget: (value: boolean) => void;
}) {
  const t = useTranslations("visualCleaning");
  const labels = useMemo(() => cleaningColumnLabels(values), [values]);
  return <div className="mt-4 grid min-w-0 gap-4 grid-cols-[minmax(0,1fr)_minmax(180px,0.8fr)]">
    <fieldset className="min-w-0">
      <legend className="mb-2 text-xs font-semibold">{t("groupChooseValues")}</legend>
      <div className="max-h-64 overflow-y-auto overscroll-contain rounded-lg border border-border">
        {values.map((value, index) => {
          const label = value === "" ? t("emptyTextValue") : `“${labels.get(value)}”`;
          const checked = selected.includes(value), alreadyUsed = used.has(value);
          return <div key={value} className="flex items-start gap-2 border-b border-border px-3 py-2 last:border-b-0">
            <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-xs leading-5">
              <input type="checkbox" checked={checked} disabled={disabled || (alreadyUsed && !checked)}
                aria-label={t("groupSelectValue", { number: index + 1, value: label })} onChange={() => onSelect(value)}
                className="mt-1 shrink-0 accent-primary disabled:opacity-40" />
              <span className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{label}{alreadyUsed && <span className="ml-2 inline-block text-[10px] text-muted-foreground">{t("groupAlreadyAdded")}</span>}</span>
            </label>
            <Button variant="ghost" size="sm" disabled={disabled} aria-label={t("groupUseValue", { number: index + 1 })}
              onClick={() => { onTarget(value); onEmptyTarget(value === ""); }}
              className="text-primary">{t("groupUseThisValue")}</Button>
          </div>;
        })}
      </div>
      <p role="status" className="mt-2 text-[11px] text-muted-foreground">{t("groupSelectionCount", { count: selected.length })}</p>
    </fieldset>
    <div className="min-w-0">
      <label className="block text-xs font-semibold">{t("groupTarget")}
        <textarea rows={3} value={emptyTarget ? "" : target} disabled={disabled || emptyTarget} maxLength={2000}
          aria-label={t("groupTarget")} placeholder={t("groupTargetPlaceholder")} onChange={event => onTarget(event.target.value)}
          className="mt-2 w-full rounded-md border border-border bg-card px-3 py-2 text-sm font-normal outline-none focus:border-primary disabled:bg-muted disabled:opacity-60" />
      </label>
      <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={emptyTarget} disabled={disabled}
        onChange={event => onEmptyTarget(event.target.checked)} className="accent-primary" />{t("groupEmptyTarget")}</label>
    </div>
  </div>;
}
