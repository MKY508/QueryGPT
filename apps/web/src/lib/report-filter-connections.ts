import type { ReportBlock, ReportDocument, ReportPage } from "./reports";
import { interactionFields, pageReportFilters } from "./report-interactions";
import { applyReportBlockUpdates, type ActiveReportFilter } from "@/components/reports/report-blocks";

interface FilterTarget { key: string; field: string }
export interface ConnectedReportFilter {
  block: ReportBlock;
  targets: { key: string; field: string; block: ReportBlock; page: ReportPage }[];
}

export function isConnectedReportFilter(block: ReportBlock): boolean {
  return block.block_type === "filter" && block.config.filter_scope === "report";
}

function targetKey(block: ReportBlock): string {
  const key = block.config.filter_target_key;
  return typeof key === "string" && key.length > 0 && key.length <= 200 ? key : "";
}

function configuredTargets(block: ReportBlock): FilterTarget[] {
  if (!Array.isArray(block.config.filter_targets)) return [];
  return block.config.filter_targets.flatMap((item: unknown) => {
    if (!item || typeof item !== "object" || !("key" in item) || !("field" in item) ||
      typeof item.key !== "string" || !item.key || item.key.length > 200 ||
      typeof item.field !== "string" || !item.field) return [];
    return [{ key: item.key, field: item.field }];
  });
}

/** Stable document-wide keys survive saving, copying and historical restore. */
export function connectedReportFilters(report: ReportDocument): ConnectedReportFilter[] {
  const locations = new Map<string, { page: ReportPage; block: ReportBlock }[]>();
  for (const page of report.pages) for (const block of page.blocks) {
    const key = targetKey(block);
    if (key) locations.set(key, [...(locations.get(key) || []), { page, block }]);
  }
  return report.pages.flatMap((page) => page.blocks.flatMap((block) => {
    if (!isConnectedReportFilter(block)) return [];
    const configured = configuredTargets(block);
    const targets = configured.flatMap(({ key, field }) => {
      const matches = locations.get(key);
      // Ambiguous, removed and unsupported destinations have no effect.
      if (matches?.length !== 1 || configured.filter((item) => item.key === key).length !== 1) return [];
      const target = matches[0];
      return interactionFields(target.block).includes(field) ? [{ key, field, ...target }] : [];
    });
    return [{ block, targets }];
  }));
}

export function reportFiltersForPage(
  page: ReportPage, values: Record<string, string>, connected: ConnectedReportFilter[],
): ActiveReportFilter[] {
  const local = pageReportFilters(page, values);
  const mapped = connected.flatMap(({ block, targets }) => {
    // Reuse the existing operator validation without interpreting a mapped field
    // as an implicit page-wide connection.
    return targets.filter((target) => target.page.id === page.id).flatMap((target) => {
      const configured = { ...block, config: { ...block.config, filter_scope: "page", field: target.field } };
      return pageReportFilters({ ...page, blocks: [configured] }, values)
        .map((filter) => ({ ...filter, field: target.field, blockId: target.block.id }));
    });
  });
  return [...local, ...mapped];
}

export function configureReportFilter(
  report: ReportDocument, sourceId: string,
  change: { scope: "page" | "report" } | { targetId: string; field: string },
  newKey: () => string = () => crypto.randomUUID(),
): ReportDocument {
  const blocks = report.pages.flatMap((page) => page.blocks);
  const source = blocks.find((block) => block.id === sourceId && block.block_type === "filter");
  if (!source) return report;
  const config = { ...source.config };
  let changedTarget: ReportBlock | undefined;
  if ("scope" in change) {
    config.filter_scope = change.scope;
    // Connections are opt-in. Switching scope cannot silently reconnect cards.
    config.filter_targets = [];
  } else {
    if (!isConnectedReportFilter(source)) return report;
    const target = blocks.find((block) => block.id === change.targetId);
    if (!target || (change.field && !interactionFields(target).includes(change.field))) return report;
    const targets = connectedReportFilters(report).find((item) => item.block === source)?.targets || [];
    const retained = targets.filter((item) => item.block.id !== target.id)
      .map(({ key, field }) => ({ key, field }));
    if (change.field) {
      const oldKey = targetKey(target);
      const key = oldKey && blocks.filter((block) => targetKey(block) === oldKey).length === 1 ? oldKey : newKey();
      if (!key || key.length > 200 || blocks.some((block) => block !== target && targetKey(block) === key)) return report;
      changedTarget = { ...target, config: { ...target.config, filter_target_key: key } };
      retained.push({ key, field: change.field });
    }
    config.filter_targets = retained;
  }
  return { ...report, pages: report.pages.map((page) => ({ ...page, blocks: page.blocks.map((block) =>
    block === source ? applyReportBlockUpdates(block, { config }) :
      changedTarget && block.id === changedTarget.id ? changedTarget : block) })) };
}
