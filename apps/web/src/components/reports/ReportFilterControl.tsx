"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReportBlock } from "@/lib/reports";
import { isConnectedReportFilter } from "@/lib/report-filter-connections";

export function ReportFilterControl({ block, value = "", onChange, staticRendering = false, connectedCount = 0 }: {
  block: ReportBlock; value?: string; onChange?: (value: string) => void;
  staticRendering?: boolean; connectedCount?: number;
}) {
  const t = useTranslations("reportBlocks");
  const tFilters = useTranslations("reportFilters");
  const connected = isConnectedReportFilter(block);
  const field = typeof block.config.field === "string" ? block.config.field : "";
  const available = connected ? connectedCount > 0 : !!field;
  const placeholder = typeof block.config.placeholder === "string" && block.config.placeholder || t("all");
  if (staticRendering) return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2 text-xs">
      <span className="font-medium text-muted-foreground">{block.title}</span>
      <span className="break-words font-mono tabular-nums text-foreground">{available ? value || t("all") : t("notSet")}</span>
    </div>
  );
  return (
    <div className="min-w-44 max-w-full">
      <label className="block text-xs font-medium text-muted-foreground">
        {block.title}
        <input value={value} onChange={(event) => onChange?.(event.target.value)} disabled={!available}
          placeholder={available ? placeholder : connected ? tFilters("chooseTargets") : t("chooseFilterField")}
          className="mt-2 h-9 w-full border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-primary disabled:bg-muted/35" />
      </label>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span>{connected ? tFilters("connectedCount", { count: connectedCount }) : field ? t("currentPageField", { field }) : t("unsetField")}</span>
        {!!value && <button type="button" onClick={() => onChange?.("")} aria-label={tFilters("clear", { title: block.title })}
          className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">
          <X size={12} />{tFilters("clearValue")}
        </button>}
      </div>
    </div>
  );
}
