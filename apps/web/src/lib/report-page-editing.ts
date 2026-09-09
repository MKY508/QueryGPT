import type { ReportDocument, ReportPage } from "./reports";
import { createLocalId, reflowBlocks } from "@/lib/report-blocks";

export function reorderReportPage(pages: ReportPage[], pageId: string, targetId: string, edge: "before" | "after") {
  if (pageId === targetId) return pages;
  const ordered = [...pages].sort((a, b) => a.order_index - b.order_index);
  const moving = ordered.find((page) => page.id === pageId);
  if (!moving || !ordered.some((page) => page.id === targetId)) return pages;
  const remaining = ordered.filter((page) => page !== moving);
  const at = remaining.findIndex((page) => page.id === targetId) + (edge === "after" ? 1 : 0);
  remaining.splice(at, 0, moving);
  if (remaining.every((page, index) => page === ordered[index])) return pages;
  return remaining.map((page, order_index) => ({ ...page, order_index }));
}

export function moveReportPage(pages: ReportPage[], pageId: string, direction: -1 | 1) {
  const ordered = [...pages].sort((a, b) => a.order_index - b.order_index);
  const index = ordered.findIndex((page) => page.id === pageId);
  const target = index >= 0 ? ordered[index + direction] : undefined;
  return target ? reorderReportPage(pages, pageId, target.id, direction === -1 ? "before" : "after") : pages;
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function reportBlockMoveImpact(document: ReportDocument, blockId: string) {
  const page = document.pages.find((page) => page.blocks.some((block) => block.id === blockId));
  const block = page?.blocks.find((block) => block.id === blockId);
  const key = block?.config.interaction_key;
  const hasPageLinks = page?.blocks.some((candidate) => {
    const action = candidate.config.filter_action;
    return record(action) && Array.isArray(action.targets) && action.targets.some((target) =>
      candidate.id === blockId || (key && (candidate.config.interaction_key === key || (record(target) && target.key === key))));
  }) ?? false;
  return { hasPageLinks, changesPageFilter: block?.block_type === "filter" && block.config.filter_scope !== "report" };
}

/** Move identity, not a copy. Page-local links cannot follow a single card;
 * explicit report-wide filter connections still address the same target key. */
export function moveReportBlock(document: ReportDocument, blockId: string, targetPageId: string): ReportDocument {
  const source = document.pages.find((page) => page.blocks.some((block) => block.id === blockId));
  const target = document.pages.find((page) => page.id === targetPageId);
  if (!source || !target || source === target) return document;
  const block = source.blocks.find((block) => block.id === blockId)!;
  const config = { ...block.config };
  delete config.interaction_key;
  delete config.filter_action;
  const remaining = source.blocks.filter((candidate) => candidate !== block).map((candidate) => {
    const action = candidate.config.filter_action;
    if (!block.config.interaction_key || !record(action) || !Array.isArray(action.targets)) return candidate;
    // A previously ambiguous source must not become active after its duplicate
    // identity moves away. Clear those outgoing links as well as incoming ones.
    const targets = candidate.config.interaction_key === block.config.interaction_key ? []
      : action.targets.filter((target) => !record(target) || target.key !== block.config.interaction_key);
    if (targets.length === action.targets.length) return candidate;
    const config = { ...candidate.config, filter_action: { ...action, targets } };
    return { ...candidate, config };
  });
  const bottom = target.blocks.reduce((bottom, block) => Math.max(bottom, block.layout.y + block.layout.h), 0);
  const moved = { ...block, config, order_index: target.blocks.length, layout: { ...block.layout, x: 0, y: bottom } };
  return { ...document, pages: document.pages.map((page) => page === source ? { ...page, blocks: reflowBlocks(remaining) }
    : page === target ? { ...page, blocks: [...page.blocks, moved] } : page) };
}

/** Duplicate the page's subgraph: remap internal links, retain explicit external
 * links, and leave all original pages and their incoming connections untouched. */
export function duplicateReportPage(document: ReportDocument, pageId: string, title: string,
  newId = createLocalId, newKey: () => string = () => crypto.randomUUID()): { document: ReportDocument; page: ReportPage } | null {
  const source = document.pages.find((page) => page.id === pageId);
  if (!source) return null;
  const maps = { interaction_key: new Map<string, string>(), filter_target_key: new Map<string, string>() };
  const allBlocks = document.pages.flatMap((page) => page.blocks);
  const occupied = new Set(allBlocks.flatMap((block) =>
    [block.config.interaction_key, block.config.filter_target_key].filter((key): key is string => typeof key === "string")));
  const targetCounts = new Map<unknown, number>();
  for (const block of allBlocks) {
    const key = block.config.filter_target_key;
    targetCounts.set(key, (targetCounts.get(key) || 0) + 1);
  }
  for (const block of source.blocks) for (const field of ["interaction_key", "filter_target_key"] as const) {
    const key = block.config[field];
    if (typeof key !== "string" || !key || key.length > 200 || maps[field].has(key)) continue;
    const replacement = newKey();
    if (!replacement || occupied.has(replacement)) throw new Error("Duplicate report interaction identity");
    occupied.add(replacement); maps[field].set(key, replacement);
  }
  // An ambiguous old connection must not become valid just because only one
  // of its destinations happened to be copied into this page.
  const filterReferences = new Map([...maps.filter_target_key].filter(([key]) => targetCounts.get(key) === 1));
  const page = structuredClone(source);
  page.id = newId("page");
  page.title = title.slice(0, 160);
  delete page.version; delete page.created_at; delete page.updated_at;
  page.blocks = page.blocks.map((block, order_index) => {
    const originalId = block.id;
    block.id = newId("block"); block.order_index = order_index;
    delete block.version; delete block.created_at; delete block.updated_at;
    if (block.source_kind !== "manual" && !originalId.startsWith("local-")) block.copy_source_block_id = originalId;
    for (const field of ["interaction_key", "filter_target_key"] as const) {
      const key = block.config[field];
      if (typeof key === "string" && maps[field].has(key)) block.config[field] = maps[field].get(key)!;
    }
    const remap = (targets: unknown, keys: Map<string, string>) => Array.isArray(targets)
      ? targets.map((target) => record(target) && typeof target.key === "string" && keys.has(target.key)
        ? { ...target, key: keys.get(target.key)! } : target) : targets;
    const action = block.config.filter_action;
    if (record(action)) block.config.filter_action = { ...action, targets: remap(action.targets, maps.interaction_key) };
    if (Array.isArray(block.config.filter_targets)) block.config.filter_targets = remap(block.config.filter_targets, filterReferences);
    return block;
  });
  const pages = [...document.pages].sort((a, b) => a.order_index - b.order_index);
  pages.splice(pages.findIndex((candidate) => candidate.id === pageId) + 1, 0, page);
  const ordered = pages.map((candidate, order_index) => ({ ...candidate, order_index }));
  return { document: { ...document, pages: ordered }, page: ordered.find((candidate) => candidate.id === page.id)! };
}
