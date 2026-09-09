import type { ReportBlockType, ReportDocument } from "./reports";
import { cleanReportProse, reportTextValue } from "./report-display-text";
import { metricDisplayText } from "./metric-display";
import { reportContentRows } from "./tabular-data";
import { textSearchExcerpt } from "./text-search-excerpt";

export interface ReportSearchEntry {
  pageId: string; pageTitle: string; pageNumber: number;
  blockId: string | null; kind: ReportBlockType | "page"; title: string; fields: string[];
}
export interface ReportSearchMatch extends ReportSearchEntry {
  snippet: { before: string; match: string; after: string } | null;
}
const compact = (value: string) => value.replace(/\s+/gu, " ").trim();

/** Index only the report's presentation text, never source references, SQL,
 * image URLs, raw chart/table rows or serialized arbitrary payloads. */
export function reportSearchIndex(report: ReportDocument, locale: string): ReportSearchEntry[] {
  return [...report.pages].sort((a, b) => a.order_index - b.order_index).flatMap((page, index) => {
    const source = { pageId: page.id, pageTitle: page.title, pageNumber: index + 1 };
    const heading: ReportSearchEntry = { ...source, blockId: null, kind: "page", title: page.title,
      fields: [page.title, typeof page.config.narrative === "string" ? page.config.narrative : "", ...(index === 0 ? [report.title, report.description] : [])].map(compact).filter(Boolean) };
    return [heading, ...page.blocks.map((block): ReportSearchEntry => {
      const fields = [block.title, typeof block.content.subtitle === "string" ? block.content.subtitle : "",
        typeof block.config.highlight === "string" ? cleanReportProse(block.config.highlight.trim()) : ""];
      if (block.block_type === "text" || block.block_type === "evidence") {
        fields.push(reportTextValue(block.content, ["text", "summary", "description", "value"]));
      }
      if (block.block_type === "evidence") {
        // Match the evidence card's twelve displayed entries, not hidden rows.
        for (const row of reportContentRows(block.content)?.rows.slice(0, 12) || []) {
          fields.push(reportTextValue(row, ["label", "title", "summary", "message", "purpose", "value"]),
            reportTextValue(row, ["text", "detail", "status"]));
        }
      }
      if (block.block_type === "metric") fields.push(cleanReportProse(metricDisplayText(block, locale)),
        reportTextValue(block.content, ["context", "note", "summary", "description"]), reportTextValue(block.content, ["change", "delta", "comparison"]));
      return { ...source, blockId: block.id, kind: block.block_type, title: block.title, fields: fields.map(compact).filter(Boolean) };
    })];
  });
}

/** Literal, case-insensitive phrase search. One result per page/card, with an
 * original-text excerpt around its first hit; input is never a regexp. */
export function searchReportContent(index: ReportSearchEntry[], query: string): ReportSearchMatch[] {
  const needle = compact(query.normalize("NFKC"));
  if (!needle) return index.map((entry) => ({ ...entry, snippet: null }));
  const excerpt = textSearchExcerpt([needle]);
  return index.flatMap((entry) => {
    for (const text of entry.fields) {
      const snippet = excerpt(text);
      if (snippet) return [{ ...entry, snippet }];
    }
    return [];
  });
}
