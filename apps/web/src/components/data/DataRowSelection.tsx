"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Download, X } from "lucide-react";

export function DataRowCheckbox({ checked, mixed = false, disabled = false, label, hint, recordIndex, onChange }: {
  checked: boolean; mixed?: boolean; disabled?: boolean; label: string; hint?: string; recordIndex?: number;
  onChange: (checked: boolean, range: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed, checked]);
  return <label title={hint || label} className="inline-flex min-h-9 w-9 shrink-0 cursor-pointer items-center justify-center">
    <input ref={ref} type="checkbox" checked={checked} disabled={disabled} aria-label={label} data-selection-index={recordIndex}
      onChange={(event) => onChange(event.target.checked, "shiftKey" in event.nativeEvent && Boolean(event.nativeEvent.shiftKey))}
      className="h-4 w-4 cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-default" />
  </label>;
}

export function DataSelectionBar({ count, outside, total, allChecked, onlyChecked, canExport, onAll, onClear, onOnly, onExport, onExit, children }: {
  count: number; outside: number; total: number; allChecked: boolean; onlyChecked: boolean; canExport: boolean;
  onAll: () => void; onClear: () => void; onOnly: () => void; onExport: () => void; onExit: () => void;
  children?: ReactNode;
}) {
  const t = useTranslations("dataView.selection");
  const action = "min-h-8 rounded-md px-2 text-xs hover:bg-primary/10 disabled:opacity-40";
  return <section aria-label={t("title")} className="flex max-h-[24dvh] shrink-0 flex-wrap items-center gap-x-3 gap-y-1 overflow-y-auto border-b border-primary/20 bg-primary/5 px-5 py-2 text-primary">
    <div aria-live="polite" aria-atomic="true" className="mr-auto text-xs">
      <span className="font-semibold tabular-nums">{t("count", { count })}</span>
      {outside > 0 && <span className="ml-2 text-muted-foreground">{t("outside", { count: outside })}</span>}
    </div>
    <button type="button" onClick={onExit} aria-label={t("exit")} className={`${action} shrink-0`}><X size={15} /></button>
    <div className="flex w-full flex-wrap items-center gap-1">
      <button type="button" disabled={!total || allChecked} onClick={onAll} className={action}>{t("all", { count: total })}</button>
      <button type="button" aria-pressed={onlyChecked} onClick={onOnly} className={`${action} aria-pressed:bg-primary/10`}>{t("only")}</button>
      <button type="button" disabled={!count} onClick={onClear} className={action}>{t("clear")}</button>
      {children}
      <button type="button" disabled={!canExport} onClick={onExport} className="rounded-md inline-flex min-h-8 items-center gap-1.5 border border-primary/25 bg-background px-2 text-xs font-medium hover:bg-primary/10 disabled:opacity-40">
        <Download size={13} />{t("export", { count })}
      </button>
    </div>
  </section>;
}
