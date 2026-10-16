"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { ReportBlock, ReportDocument } from "@/lib/reports";
import { ReportBlockCard } from "./ReportBlockCard";
import type { ReportSelection } from "@/lib/report-interactions";
import { readReportPage } from "@/lib/report-reading";
import { selectionLabel } from "./ReportSelectionControl";
import { connectedReportFilters } from "@/lib/report-filter-connections";
import { ReportFilterControl } from "./ReportFilterControl";

function blockStyle(block: ReportBlock): CSSProperties {
  const width = block.block_type === "table" ? 12 : block.layout.w;
  return {
    "--report-column-span": `span ${width} / span ${width}`,
  } as CSSProperties;
}

const noop = () => undefined;

export function ReportPrintView({
  report,
  filterValues,
  imagePageId,
  pageIds,
  preview = false,
  selections = [],
}: {
  report: ReportDocument;
  filterValues: Record<string, string>;
  imagePageId?: string;
  pageIds?: readonly string[];
  preview?: boolean;
  selections?: ReportSelection[];
}) {
  const t = useTranslations("reportInteractions");
  const connected = connectedReportFilters(report);
  const ordered = [...report.pages].sort(
    (left, right) => left.order_index - right.order_index
  );
  // Keep the complete document above for inherited filters from omitted pages.
  // Image captures retain original report numbering; selected PDF pages renumber.
  const included = pageIds ? new Set(pageIds) : null;
  const pages = included && !imagePageId ? ordered.filter(page => included.has(page.id)) : ordered;

  return (
    <section
      className={preview ? "report-print-view report-recovery-preview" : imagePageId ? "report-print-view report-image-view" : "report-print-view"}
      data-testid="report-print-view"
      aria-hidden={preview ? undefined : true}
    >
      {pages.map((page, pageIndex) => {
        if (imagePageId && page.id !== imagePageId) return null;
        const reading = readReportPage(page, { filters: filterValues, selections }, connected);
        const { inheritedFilters, selections: activeSelections } = reading;
        const narrative =
          typeof page.config.narrative === "string"
            ? page.config.narrative.trim()
            : "";
        return (
          <article className="report-print-page" key={page.id}>
            <header className="report-print-header">
              <div>
                <p className="report-print-kicker">{page.title}</p>
                <h1>{report.title}</h1>
                {report.description && <p>{report.description}</p>}
                {narrative && <p className="report-print-narrative">{narrative}</p>}
                {!!activeSelections.length && <p className="report-print-narrative">{t("active")}：{activeSelections.map((selection) =>
                  `${selection.source.title} · ${selection.rule.field}：${selectionLabel(selection.value, t("emptyValue"), t("blankValue"))}`
                ).join("； ")}</p>}
              </div>
              <span>{pageIndex + 1} / {pages.length}</span>
            </header>

            <div className="report-print-grid">
              {!!inheritedFilters.length && <div className="col-span-full space-y-2">
                {inheritedFilters.map(({ block, targets }) => <ReportFilterControl key={block.id} block={block}
                  value={filterValues[block.id] || ""} connectedCount={targets.length} staticRendering />)}
              </div>}
              {reading.blocks.map(({ block, filterConnectedCount }) => {
                return (
                  <div
                    key={block.id}
                    style={blockStyle(block)}
                    className="report-print-block"
                    data-block-type={block.block_type}
                  >
                    <ReportBlockCard
                      block={block}
                      editing={false}
                      selected={false}
                      staticRendering
                      onSelect={noop}
                      onMove={noop}
                      onResize={noop}
                      onDuplicate={noop}
                      onDelete={noop}
                      filterValue={filterValues[block.id] || ""}
                      filterConnectedCount={filterConnectedCount}
                      onFilterValueChange={noop}
                    />
                  </div>
                );
              })}
            </div>
          </article>
        );
      })}
    </section>
  );
}
