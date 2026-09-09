"use client";

import { useTranslations } from "next-intl";
import type { ReportBlock, ReportPage } from "@/lib/reports";
import { configureCrossFilter, crossFilterRule, interactionFields, interactionKey } from "@/lib/report-interactions";
import { ReportPropertySection } from "./ReportPropertySection";
import fieldStyles from "@/components/ui/FieldControl.module.css";
import { cn } from "@/lib/utils";

export function ReportInteractionSettings({ page, block, disabled, onChange, collapsible = false }: {
  page: ReportPage; block: ReportBlock; disabled: boolean; onChange: (page: ReportPage) => void;
  collapsible?: boolean;
}) {
  const t = useTranslations("reportInteractions");
  const fields = interactionFields(block);
  if (block.block_type !== "chart" || !fields.length) return null;
  const rule = crossFilterRule(page, block);
  const targets = page.blocks.filter((target) => target.id !== block.id && interactionFields(target).length);
  if (!targets.length) return null;
  const settings = (
    <fieldset disabled={disabled} className={collapsible ? "space-y-3" : "space-y-3 border-t border-border pt-4"}>
      <legend className={collapsible ? "sr-only" : "pt-4 text-xs font-medium"}>{t("title")}</legend>
      <label className="block text-[11px] text-muted-foreground">
        {t("sourceField")}
        <select aria-label={t("sourceField")} value={rule?.field || ""}
          onChange={(event) => onChange(configureCrossFilter(page, block.id, event.target.value))}
          className={cn(fieldStyles.control, "mt-1.5 text-xs")}>
          <option value="">{t("off")}</option>
          {fields.map((field) => <option key={field} value={field}>{field}</option>)}
        </select>
      </label>
      {rule && targets.map((target) => (
        <label key={target.id} className="block text-[11px] text-muted-foreground">
          {target.title || t("untitled")}
          <select aria-label={t("targetField", { title: target.title || t("untitled") })}
            value={rule.targets.find((item) => item.key === interactionKey(target))?.field || ""}
            onChange={(event) => onChange(configureCrossFilter(page, block.id, rule.field, target.id, event.target.value))}
            className={cn(fieldStyles.control, "mt-1.5 text-xs")}>
            <option value="">{t("unaffected")}</option>
            {interactionFields(target).map((field) => <option key={field} value={field}>{field}</option>)}
          </select>
        </label>
      ))}
    </fieldset>
  );
  return collapsible ? <ReportPropertySection title={t("title")}>{settings}</ReportPropertySection> : settings;
}
