import type { ReportBlock, ReportDocument, ReportPage } from "./reports";
import { applyReportBlockUpdates, reflowBlocks } from "./report-blocks";

type BlockPatch = Partial<Pick<ReportBlock, "block_type" | "title" | "content" | "config" | "layout">>;
type PagePatch = Partial<Pick<ReportPage, "title" | "config">>;

export type ReportPageCommand =
  | { type: "update-page"; updates: PagePatch }
  | { type: "update-block"; blockId: string; updates: BlockPatch }
  | { type: "append-blocks"; blocks: ReportBlock[] }
  | { type: "move-block"; blockId: string; direction: -1 | 1 }
  | { type: "resize-block"; blockId: string; direction: -1 | 1 }
  | { type: "remove-block"; blockId: string }
  | { type: "duplicate-block"; blockId: string; newBlockId: string; title: string;
      connectionKeys: { interaction_key: string; filter_target_key: string } };

const WIDTH_STEPS = [3, 4, 6, 8, 12];

function patchChanges<T extends object>(current: T, patch: Partial<T>): boolean {
  return (Object.keys(patch) as (keyof T)[]).some(key => !Object.is(current[key], patch[key]));
}

/** Pure document action. IDs and localized copy are supplied by the caller. */
export function editReportPage(page: ReportPage, command: ReportPageCommand): ReportPage {
  if (command.type === "update-page") {
    return patchChanges(page, command.updates) ? { ...page, ...command.updates } : page;
  }
  if (command.type === "append-blocks") {
    const ids = new Set(page.blocks.map(block => block.id));
    if (!command.blocks.length || command.blocks.some(block => {
      if (ids.has(block.id)) return true;
      ids.add(block.id);
      return false;
    })) return page;
    return { ...page, blocks: reflowBlocks([...page.blocks, ...command.blocks]) };
  }
  const index = page.blocks.findIndex(block => block.id === command.blockId);
  if (index < 0) return page;
  const source = page.blocks[index];
  const blocks = [...page.blocks];
  switch (command.type) {
    case "update-block": {
      const updates = command.updates;
      const unchangedLayout = !updates.layout || !patchChanges(source.layout, updates.layout);
      if (unchangedLayout && !patchChanges(source, { ...updates, layout: source.layout })) return page;
      blocks[index] = applyReportBlockUpdates(source, command.updates);
      return { ...page, blocks: command.updates.layout ? reflowBlocks(blocks) : blocks };
    }
    case "move-block": {
      const target = index + command.direction;
      if (target < 0 || target >= blocks.length) return page;
      [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
      break;
    }
    case "resize-block": {
      if (source.block_type === "table") return page;
      const width = source.layout.w;
      const next = command.direction === 1 ? WIDTH_STEPS.find(step => step > width)
        : WIDTH_STEPS.findLast(step => step < width);
      if (next === undefined) return page;
      blocks[index] = { ...source, layout: { ...source.layout, w: next } };
      break;
    }
    case "remove-block": blocks.splice(index, 1); break;
    case "duplicate-block": {
      if (!command.newBlockId || blocks.some(block => block.id === command.newBlockId)) return page;
      const config = structuredClone(source.config);
      delete config.manual_override;
      for (const key of ["interaction_key", "filter_target_key"] as const) {
        if (config[key]) config[key] = command.connectionKeys[key];
      }
      // A single-card duplicate is independent content, unlike a linked page copy.
      const copy: ReportBlock = {
        id: command.newBlockId, block_type: source.block_type, title: command.title,
        order_index: index + 1, source_kind: "manual", analysis_run_id: null, artifact_id: null,
        content: structuredClone(source.content), config, layout: { ...source.layout },
      };
      blocks.splice(index + 1, 0, copy);
      break;
    }
  }
  return { ...page, blocks: reflowBlocks(blocks) };
}

/** A rejected or boundary action retains object identity and creates no history step. */
export function editReportDocument(document: ReportDocument, pageId: string, command: ReportPageCommand): ReportDocument {
  const page = document.pages.find(item => item.id === pageId);
  if (!page) return document;
  const next = editReportPage(page, command);
  return next === page ? document : { ...document, pages: document.pages.map(item => item === page ? next : item) };
}
