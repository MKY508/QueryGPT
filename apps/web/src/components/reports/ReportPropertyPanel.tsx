"use client";

import { Expand, LayoutPanelTop, Settings2, X } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ReportBlock, ReportBlockType, ReportDocument, ReportPage } from "@/lib/reports";
import { hasMetricResultField, metricColumnContent, metricResultColumns } from "@/lib/report-metrics";
import { ReportInteractionSettings } from "./ReportInteractionSettings";
import { ChartPropertySettings } from "./ChartPropertySettings";
import { MetricFormatSettings } from "./MetricFormatSettings";
import { ReportFilterConnections, type FilterConnectionChange } from "./ReportFilterConnections";
import { isConnectedReportFilter } from "@/lib/report-filter-connections";
import { reportBlockText } from "@/lib/report-text";
import { Button } from "@/components/ui/button";
import { TabList } from "@/components/ui/TabList";
import fieldStyles from "@/components/ui/FieldControl.module.css";
import { cn } from "@/lib/utils";
import {
  blockTypeLabel,
  createReportBlocksCopy,
  reportBlockOptions,
  reportFilterFields,
} from "@/lib/report-blocks";

interface ReportPropertyPanelProps {
  page: ReportPage;
  block: ReportBlock | null;
  disabled?: boolean;
  onChangePage: (updates: Partial<ReportPage>) => void;
  onChangeBlock: (updates: Partial<ReportBlock>) => void;
  report?: ReportDocument;
  onChangeFilterConnection?: (change: FilterConnectionChange) => void;
  onClose?: () => void;
  onEditText?: () => void;
}


function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="mb-1.5 block text-[11px] font-medium text-muted-foreground">{children}</span>;
}


export function ReportPropertyPanel({
  page,
  block: selectedBlock,
  disabled = false,
  onChangePage,
  onChangeBlock,
  report,
  onChangeFilterConnection,
  onClose,
  onEditText,
}: ReportPropertyPanelProps) {
  const tabId = useId();
  const [inspection, setInspection] = useState({ pageId: page.id, blockId: selectedBlock?.id, scope: selectedBlock ? "block" : "page" });
  if (inspection.pageId !== page.id || inspection.blockId !== selectedBlock?.id) {
    setInspection({ pageId: page.id, blockId: selectedBlock?.id, scope: selectedBlock ? "block" : "page" });
  }
  const block = inspection.scope === "block" ? selectedBlock : null;
  const locale = useLocale();
  const t = useTranslations("reportProperty");
  const tWriting = useTranslations("reportWriting");
  const tBlocks = useTranslations("reportBlocks");
  const blocksCopy = useMemo(
    () => createReportBlocksCopy((key, values) => tBlocks(key, values)),
    [tBlocks]
  );
  const blockOptions = useMemo(() => reportBlockOptions(blocksCopy), [blocksCopy]);
  const filterFields = reportFilterFields(page.blocks, locale);
  const metricFields = block?.block_type === "metric" ? metricResultColumns(block) : [];
  const metricFromResult = block ? hasMetricResultField(block) : false;
  return (
    <aside className="report-inspector flex h-full min-h-0 w-[320px] shrink-0 flex-col border-l border-border bg-card"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && onClose) {
          event.preventDefault(); event.stopPropagation(); onClose();
        }
      }}>
      <div className="flex h-[60px] shrink-0 items-center gap-2 border-b border-border px-5">
        {block ? <Settings2 size={15} className="text-primary" /> : <LayoutPanelTop size={15} className="text-primary" />}
        <h2 className="flex-1 text-[13px] font-semibold">{block ? t("blockSettings") : t("pageSettings")}</h2>
        {onClose && <Button variant="ghost" size="icon" aria-label={t("closeInspector")} onClick={onClose}><X size={15} /></Button>}
      </div>
      <TabList id={tabId} label={t("inspectorScope")} className="shrink-0 px-2"
        items={selectedBlock ? [{ value: "page", label: t("pageTab") }, { value: "block", label: t("blockTab") }] : [{ value: "page", label: t("pageTab") }]}
        value={inspection.scope} onChange={scope => setInspection(current => ({ ...current, scope }))} />
      <fieldset
        id={`${tabId}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${inspection.scope}`}
        data-report-history
        disabled={disabled}
        className="min-h-0 flex-1 overflow-y-auto border-0 px-5 py-5 disabled:opacity-60"
      >
        {!block ? (
          <div className="space-y-5">
            <label className="block">
              <FieldLabel>{t("pageName")}</FieldLabel>
              <input
                value={page.title}
                maxLength={160}
                onChange={(event) => onChangePage({ title: event.target.value })}
                className={cn(fieldStyles.control)}
              />
            </label>
            <p className="text-xs leading-5 text-muted-foreground">
              {t("selectBlockHint")}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            <label className="block">
              <FieldLabel>{t("blockType")}</FieldLabel>
              <select
                value={block.block_type}
                onChange={(event) => onChangeBlock({ block_type: event.target.value as ReportBlockType })}
                className={cn(fieldStyles.control)}
              >
                {blockOptions.map((option) => (
                  <option key={option.type} value={option.type}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <FieldLabel>{t("title")}</FieldLabel>
              <input
                value={block.title}
                aria-label={t("blockTitle")}
                maxLength={200}
                onChange={(event) => onChangeBlock({ title: event.target.value })}
                placeholder={blockTypeLabel(block.block_type, blocksCopy)}
                className={cn(fieldStyles.control)}
              />
            </label>

            {(block.block_type === "text" || block.block_type === "evidence") && (
              <div>
                {onEditText && <Button variant="ghost" size="sm" onClick={onEditText} className="mb-2 text-primary"><Expand size={13} />{tWriting("title")}</Button>}
                <label className="block">
                <FieldLabel>{block.block_type === "evidence" ? t("evidenceText") : t("bodyText")}</FieldLabel>
                <textarea
                  value={reportBlockText(block)}
                  onChange={(event) => onChangeBlock({ content: { ...block.content, text: event.target.value } })}
                  rows={8}
                  className={cn(fieldStyles.control, "resize-y leading-6")}
                />
                </label>
              </div>
            )}

            {block.block_type === "metric" && (
              <>
                {(metricFields.length > 0 || metricFromResult) && (
                  <label className="block">
                    <FieldLabel>{t("metricField")}</FieldLabel>
                    <select
                      aria-label={t("metricField")}
                      value={typeof block.config.metric_column === "string" ? block.config.metric_column : ""}
                      onChange={(event) => {
                        const column = event.target.value;
                        onChangeBlock({
                          config: { ...block.config, metric_column: column },
                          ...(column ? { content: metricColumnContent(block, column) } : {}),
                        });
                      }}
                      className={cn(fieldStyles.control)}
                    >
                      <option value="">{t("metricManual")}</option>
                      {metricFields.map((column) => <option key={column} value={column}>{column}</option>)}
                      {metricFromResult && !metricFields.includes(String(block.config.metric_column)) && (
                        <option value={String(block.config.metric_column)}>{String(block.config.metric_column)}</option>
                      )}
                    </select>
                  </label>
                )}
                <label className="block">
                  <FieldLabel>{t("displayValue")}</FieldLabel>
                  <input
                    value={reportBlockText(block)}
                    readOnly={metricFromResult}
                    onChange={(event) => onChangeBlock({ content: { ...block.content, value: event.target.value } })}
                    className={cn(fieldStyles.control)}
                  />
                </label>
                <label className="block">
                  <FieldLabel>{t("supportingText")}</FieldLabel>
                  <input
                    value={typeof block.content.context === "string" ? block.content.context : ""}
                    onChange={(event) => onChangeBlock({ content: { ...block.content, context: event.target.value } })}
                    className={cn(fieldStyles.control)}
                  />
                </label>
                <MetricFormatSettings block={block} onChange={onChangeBlock} />
              </>
            )}

            {block.block_type === "chart" && (
              <div key={block.id}>
                <ChartPropertySettings block={block} onChangeBlock={onChangeBlock} />
                {typeof block.content.image_url !== "string" && <ReportInteractionSettings page={page} block={block}
                  collapsible disabled={disabled} onChange={(next) => onChangePage({ blocks: next.blocks })} />}
              </div>
            )}

            {block.block_type === "filter" && (
              <div className="space-y-4">
                {report && onChangeFilterConnection && <ReportFilterConnections report={report} block={block} onChange={onChangeFilterConnection} />}
                {!isConnectedReportFilter(block) && <label className="block">
                  <FieldLabel>{t("filterField")}</FieldLabel>
                  <select
                    value={typeof block.config.field === "string" ? block.config.field : ""}
                    onChange={(event) =>
                      onChangeBlock({ config: { ...block.config, field: event.target.value } })
                    }
                    disabled={!filterFields.length}
                    className={cn(fieldStyles.control)}
                  >
                    <option value="">
                      {filterFields.length ? t("selectField") : t("noFilterData")}
                    </option>
                    {filterFields.map((field) => <option key={field}>{field}</option>)}
                  </select>
                </label>}
                <label className="block">
                  <FieldLabel>{t("matchMode")}</FieldLabel>
                  <select
                    value={typeof block.config.operator === "string" ? block.config.operator : "contains"}
                    onChange={(event) =>
                      onChangeBlock({ config: { ...block.config, operator: event.target.value } })
                    }
                    className={cn(fieldStyles.control)}
                  >
                    <option value="contains">{t("operatorContains")}</option>
                    <option value="equals">{t("operatorEquals")}</option>
                    <option value="not_equals">{t("operatorNotEquals")}</option>
                    <option value="greater_than">{t("operatorGreaterThan")}</option>
                    <option value="greater_or_equal">{t("operatorGreaterOrEqual")}</option>
                    <option value="less_than">{t("operatorLessThan")}</option>
                    <option value="less_or_equal">{t("operatorLessOrEqual")}</option>
                  </select>
                </label>
                <label className="block">
                  <FieldLabel>{t("inputHint")}</FieldLabel>
                  <input
                    value={typeof block.config.placeholder === "string" ? block.config.placeholder : ""}
                    onChange={(event) => onChangeBlock({ config: { ...block.config, placeholder: event.target.value } })}
                    className={cn(fieldStyles.control)}
                  />
                </label>
                {!isConnectedReportFilter(block) && <p className="text-[11px] leading-5 text-muted-foreground">
                  {t("filterDescription")}
                </p>}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 border-t border-border pt-5">
              <label>
                <FieldLabel>{t("width")}</FieldLabel>
                <select
                  value={block.layout.w}
                  onChange={(event) => onChangeBlock({ layout: { ...block.layout, w: Number(event.target.value) } })}
                  className={cn(fieldStyles.control, "text-xs")}
                >
                  <option value={3}>{t("widthQuarter")}</option>
                  <option value={4}>{t("widthThird")}</option>
                  <option value={6}>{t("widthHalf")}</option>
                  <option value={8}>{t("widthTwoThirds")}</option>
                  <option value={12}>{t("widthFull")}</option>
                </select>
              </label>
              <label>
                <FieldLabel>{t("height")}</FieldLabel>
                <select
                  value={block.layout.h}
                  onChange={(event) => onChangeBlock({ layout: { ...block.layout, h: Number(event.target.value) } })}
                  className={cn(fieldStyles.control, "text-xs")}
                >
                  <option value={2}>{t("heightCompact")}</option>
                  <option value={3}>{t("heightStandard")}</option>
                  <option value={4}>{t("heightTall")}</option>
                  <option value={6}>{t("heightLarge")}</option>
                </select>
              </label>
            </div>

            {block.source_kind !== "manual" && (
              <p className="border-t border-border pt-4 text-[11px] leading-5 text-muted-foreground">
                {block.source_available === false
                  ? t("sourceUnavailable")
                  : block.config.manual_override === true
                  ? t("sourceEdited")
                  : t("sourceAvailable")}
              </p>
            )}
          </div>
        )}
      </fieldset>
    </aside>
  );
}
