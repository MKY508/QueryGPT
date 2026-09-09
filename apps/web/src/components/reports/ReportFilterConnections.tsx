"use client";

import { useTranslations } from "next-intl";
import type { ReportBlock, ReportDocument } from "@/lib/reports";
import { interactionFields } from "@/lib/report-interactions";
import { connectedReportFilters, isConnectedReportFilter } from "@/lib/report-filter-connections";
import fieldStyles from "@/components/ui/FieldControl.module.css";
import { cn } from "@/lib/utils";

export type FilterConnectionChange = { scope: "page" | "report" } | { targetId: string; field: string };

export function ReportFilterConnections({ report, block, onChange }: {
  report: ReportDocument; block: ReportBlock; onChange: (change: FilterConnectionChange) => void;
}) {
  const t = useTranslations("reportFilters");
  const connected = isConnectedReportFilter(block);
  const targets = connectedReportFilters(report).find((item) => item.block.id === block.id)?.targets || [];
  return (
    <div className="space-y-3">
      <label className="block text-[11px] font-medium text-muted-foreground">
        {t("scope")}
        <select value={connected ? "report" : "page"}
          onChange={(event) => onChange({ scope: event.target.value === "report" ? "report" : "page" })}
          className={cn(fieldStyles.control, "mt-1.5 text-xs")}>
          <option value="page">{t("pageScope")}</option>
          <option value="report">{t("reportScope")}</option>
        </select>
      </label>
      {connected && <>
        <p className="text-[11px] leading-5 text-muted-foreground">{t("connectDescription")}</p>
        {[...report.pages].sort((left, right) => left.order_index - right.order_index).map((page) => {
          const cards = page.blocks.filter((target) => interactionFields(target).length);
          if (!cards.length) return null;
          return <fieldset key={page.id} className="space-y-2 border-t border-border pt-2">
            <legend className="max-w-full break-words pt-2 text-xs font-medium">{page.title}</legend>
            {cards.map((target) => <label key={target.id} className="block text-[11px] text-muted-foreground">
              {target.title || t("untitled")}
              <select aria-label={t("targetField", { page: page.title, title: target.title || t("untitled") })}
                value={targets.find((item) => item.block.id === target.id)?.field || ""}
                onChange={(event) => onChange({ targetId: target.id, field: event.target.value })}
                className={cn(fieldStyles.control, "mt-1 text-xs")}>
                <option value="">{t("unaffected")}</option>
                {interactionFields(target).map((field) => <option key={field} value={field}>{field}</option>)}
              </select>
            </label>)}
          </fieldset>;
        })}
        {!targets.length && <p role="status" className="text-[11px] text-muted-foreground">{t("noTargets")}</p>}
      </>}
    </div>
  );
}
