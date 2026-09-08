"use client";

import { useTranslations } from "next-intl";
import { selectionValueKey, type ChartSelectionControl, type CrossFilterValue } from "@/lib/report-interactions";

export function selectionLabel(value: CrossFilterValue, empty: string, blank: string): string {
  return value === null ? empty : value === "" ? blank : String(value);
}

export function ReportSelectionControl({ control }: { control: ChartSelectionControl }) {
  const t = useTranslations("reportInteractions");
  const values = [...control.values];
  if (control.selected && !values.some((item) => item === control.selected?.value)) values.unshift(control.selected.value);
  return (
    <label className="mb-3 flex items-center gap-2 text-[11px] text-muted-foreground">
      <span className="shrink-0">{control.field}</span>
      <select aria-label={t("selectValue", { field: control.field })}
        value={control.selected ? selectionValueKey(control.selected.value) : ""}
        onChange={(event) => control.onSelect(values.find((value) => selectionValueKey(value) === event.target.value))}
        className="h-8 min-w-0 max-w-full border border-input bg-background px-2 text-xs text-foreground">
        <option value="">{t("allValues")}</option>
        {values.map((value) => <option key={selectionValueKey(value)} value={selectionValueKey(value)}>
          {selectionLabel(value, t("emptyValue"), t("blankValue"))}
        </option>)}
      </select>
    </label>
  );
}
