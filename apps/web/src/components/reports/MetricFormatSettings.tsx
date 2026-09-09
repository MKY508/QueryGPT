"use client";

import { useLocale, useTranslations } from "next-intl";
import type { ReportBlock } from "@/lib/reports";
import fieldStyles from "@/components/ui/FieldControl.module.css";
import { METRIC_CURRENCIES, METRIC_STYLES, metricDisplay, metricDisplayText, type MetricDisplay } from "@/lib/metric-display";

export function MetricFormatSettings({ block, onChange }: {
  block: ReportBlock;
  onChange: (updates: Partial<ReportBlock>) => void;
}) {
  const t = useTranslations("metricDisplay");
  const locale = useLocale();
  const display = metricDisplay(block.config);
  const change = (updates: Partial<MetricDisplay>) => onChange({
    config: { ...block.config, metric_display: { ...display, ...updates } },
  });
  const inputClass = fieldStyles.control;
  const labelClass = "mb-1.5 block text-[11px] font-medium text-muted-foreground";
  return <div className="space-y-3">
    <label className="block">
      <span className={labelClass}>{t("format")}</span>
      <select value={display.style} onChange={(event) => change({ style: event.target.value as MetricDisplay["style"] })} className={inputClass}>
        {METRIC_STYLES.map((style) => <option key={style} value={style}>{t(style)}</option>)}
      </select>
    </label>
    {display.style === "currency" && <label className="block">
      <span className={labelClass}>{t("currencyCode")}</span>
      <select value={display.currency} onChange={(event) => change({ currency: event.target.value as MetricDisplay["currency"] })} className={inputClass}>
        {METRIC_CURRENCIES.map((currency) => <option key={currency} value={currency}>{t(`currencies.${currency}`)}</option>)}
      </select>
    </label>}
    {display.style !== "raw" && <>
      <label className="block">
        <span className={labelClass}>{t("decimals")}</span>
        <select value={display.decimals ?? ""} onChange={(event) => change({ decimals: event.target.value === "" ? null : Number(event.target.value) })} className={inputClass}>
          <option value="">{t("auto")}</option>
          {Array.from({ length: 9 }, (_, digits) => <option key={digits} value={digits}>{digits}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={display.grouping} onChange={(event) => change({ grouping: event.target.checked })} />
        {t("grouping")}
      </label>
    </>}
    <label className="block">
      <span className={labelClass}>{t("suffix")}</span>
      <input value={display.suffix} maxLength={32} onChange={(event) => change({ suffix: event.target.value })} className={inputClass} />
    </label>
    <output aria-label={t("preview")} className="block break-all rounded border border-border bg-muted/20 px-3 py-3 font-mono text-sm tabular-nums">
      {metricDisplayText(block, locale)}
    </output>
  </div>;
}
