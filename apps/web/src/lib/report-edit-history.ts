import type { ReportBlock, ReportDocument } from "./reports";

export interface ReportEditorSelection { pageId: string | null; blockId: string | null }

/** Selection follows identity across pages, never an obsolete array position. */
export function resolveReportSelection(document: ReportDocument, selection: Readonly<ReportEditorSelection>): ReportEditorSelection {
  const containing = selection.blockId && document.pages.find((page) => page.blocks.some((block) => block.id === selection.blockId));
  if (containing) return { pageId: containing.id, blockId: selection.blockId };
  const page = document.pages.find((page) => page.id === selection.pageId)
    || [...document.pages].sort((a, b) => a.order_index - b.order_index)[0];
  return { pageId: page?.id || null, blockId: null };
}

interface SaveReconciliation {
  report: ReportDocument;
  pageIds: Map<string, string>;
  blockIds: Map<string, string>;
}

function saveReconciler(sent: ReportDocument, saved: ReportDocument) {
  const savedPages = new Map(saved.pages.map((page) => [page.id, page]));
  const pagesByOrder = new Map(saved.pages.map((page) => [page.order_index, page]));
  const matched = new Map(sent.pages.flatMap((page, index) => {
    const canonical = page.id.startsWith("local-")
      ? pagesByOrder.get(page.order_index) || saved.pages[index] : savedPages.get(page.id);
    if (!canonical) return [];
    const savedBlocks = new Map(canonical.blocks.map((block) => [block.id, block]));
    const blocksByOrder = new Map(canonical.blocks.map((block) => [block.order_index, block]));
    const blocks = new Map(page.blocks.flatMap((block, blockIndex) => {
      // serializeBlock sends the array position, not a possibly stale local
      // order_index. Match the actual request contract when IDs are assigned.
      const value = block.id.startsWith("local-")
        ? blocksByOrder.get(blockIndex) || canonical.blocks[blockIndex] : savedBlocks.get(block.id);
      return value ? [[block.id, value] as const] : [];
    }));
    return [[page.id, { canonical, blocks }] as const];
  }));
  const sentBlocks = new Map(sent.pages.flatMap((page) => page.blocks.map((block) => [block.id, block] as const)));
  const matchedBlocks = new Map([...matched.values()].flatMap(({ blocks }) => [...blocks]));
  const savedBlockIds = new Set(saved.pages.flatMap((page) => page.blocks.map((block) => block.id)));
  const copySources = new Map<string, string>();
  for (const { blocks } of matched.values()) for (const [id, canonical] of blocks) {
    copySources.set(id, canonical.id);
    const origin = sentBlocks.get(id)?.copy_source_block_id;
    if (origin && !savedBlockIds.has(origin)) copySources.set(origin, canonical.id);
  }
  const remapCopySource = (block: ReportBlock): ReportBlock => {
    const origin = block.copy_source_block_id;
    return origin && copySources.has(origin) ? { ...block, copy_source_block_id: copySources.get(origin) } : block;
  };
  return (current: ReportDocument): SaveReconciliation => {
    const pageIds = new Map<string, string>();
    const blockIds = new Map<string, string>();
    const reconcileBlock = (block: ReportBlock): ReportBlock => {
      const savedBlock = matchedBlocks.get(block.id);
      if (!savedBlock) return remapCopySource(block);
      blockIds.set(block.id, savedBlock.id);
      const sentBlock = sentBlocks.get(block.id);
      return { ...block,
        ...(sentBlock && sameSource(block, sentBlock) ? {
          source_kind: savedBlock.source_kind, analysis_run_id: savedBlock.analysis_run_id,
          artifact_id: savedBlock.artifact_id, source_ref: savedBlock.source_ref,
          source_available: savedBlock.source_available,
        } : {}),
        id: savedBlock.id, copy_source_block_id: undefined, version: savedBlock.version,
        created_at: savedBlock.created_at, updated_at: savedBlock.updated_at };
    };
    const pages = current.pages.map((page) => {
      const match = matched.get(page.id);
      if (!match) {
        const blocks = page.blocks.map(reconcileBlock);
        return blocks.some((block, index) => block !== page.blocks[index]) ? { ...page, blocks } : page;
      }
      const canonical = match.canonical;
      pageIds.set(page.id, canonical.id);
      return { ...page, id: canonical.id, version: canonical.version,
        created_at: canonical.created_at, updated_at: canonical.updated_at,
        blocks: page.blocks.map(reconcileBlock) };
    });
    return { report: { ...current, version: saved.version, updated_at: saved.updated_at,
      extra_data: saved.extra_data, pages }, pageIds, blockIds };
  };
}

export function reconcileReportAfterSave(current: ReportDocument, sent: ReportDocument, saved: ReportDocument): SaveReconciliation {
  return saveReconciler(sent, saved)(current);
}

const sameSource = (left: ReportBlock, right: ReportBlock) => left.source_kind === right.source_kind
  && left.analysis_run_id === right.analysis_run_id && left.artifact_id === right.artifact_id;

function needsCopy(block: ReportBlock): boolean {
  return block.id.startsWith("local-") && block.source_kind !== "manual"
    && !block.copy_source_block_id
    && (block.source_available === false || (block.source_kind === "artifact" ? !block.artifact_id : !block.analysis_run_id));
}

export function historyNeedsSourceCopy(document: ReportDocument): boolean {
  return document.pages.some((page) => page.blocks.some(needsCopy));
}

function copyUnavailableSources(document: ReportDocument): ReportDocument {
  return { ...document, pages: document.pages.map((page) => ({ ...page, blocks: page.blocks.map((block) => {
    if (!needsCopy(block)) return block;
    const config = { ...block.config };
    delete config.manual_override;
    return { ...block, source_kind: "manual" as const, analysis_run_id: null, artifact_id: null,
      source_ref: undefined, source_available: true, copy_source_block_id: undefined, config };
  }) })) };
}

/**
 * Immutable past/present/future history, following Redux's undo recipe.
 * Typing groups use Tiptap's 500 ms convention; explicit actions are separate.
 * Server acknowledgements rebase every entry, never become undoable edits.
 */
export class ReportEditHistory {
  private past: ReportDocument[] = [];
  private future: ReportDocument[] = [];
  private present: ReportDocument | null = null;
  private saved: ReportDocument | null = null;
  // UI bookmarks stay outside serialized documents and do not create edits or
  // discard redo. Only document transitions belong to the durable history.
  private selections = new WeakMap<ReportDocument, Readonly<ReportEditorSelection>>();
  private group: unknown = null;
  private editedAt = 0;

  constructor(private readonly localId: (kind: "page" | "block") => string, private readonly depth = 100) {}

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  get dirty() { return this.present !== this.saved; }
  get savedDocument() { return this.saved; }
  get selection() { return this.present ? this.selections.get(this.present) : undefined; }

  rememberSelection(document: ReportDocument, selection: Readonly<ReportEditorSelection>): void {
    if (document === this.present) this.selections.set(document, resolveReportSelection(document, selection));
  }

  reset(document: ReportDocument): void {
    this.past = [];
    this.future = [];
    this.present = this.saved = document;
    this.selections = new WeakMap();
    this.closeGroup();
  }

  closeGroup(): void { this.group = null; }

  record(document: ReportDocument, group: unknown = null, composing = false, now = Date.now()): void {
    if (document === this.present) return;
    if (this.present && (!group || group !== this.group || (!composing && now - this.editedAt > 500))) {
      this.past.push(this.present);
      if (this.past.length > this.depth) this.past.shift();
    }
    this.present = document;
    this.future = [];
    this.group = group;
    this.editedAt = now;
  }

  peek(direction: "undo" | "redo"): ReportDocument | undefined {
    return (direction === "undo" ? this.past : this.future).at(-1);
  }

  move(direction: "undo" | "redo", asCopy = false): ReportDocument | null {
    const target = this.peek(direction);
    if (!target || !this.present || (historyNeedsSourceCopy(target) && !asCopy)) return null;
    const from = direction === "undo" ? this.past : this.future;
    const to = direction === "undo" ? this.future : this.past;
    from.pop();
    to.push(this.present);
    this.present = asCopy ? copyUnavailableSources(target) : target;
    const selection = this.selections.get(target);
    if (selection) this.selections.set(this.present, resolveReportSelection(this.present, selection));
    this.closeGroup();
    return this.present;
  }

  acknowledge(sent: ReportDocument, saved: ReportDocument): ReportDocument {
    const pageIds = new Map<string, string>();
    const blockIds = new Map<string, string>();
    const cached = new Map<ReportDocument, ReportDocument>([[sent, saved]]);
    const reconcile = saveReconciler(sent, saved);
    const savedPages = new Map(saved.pages.map((page) => [page.id, page]));
    const savedBlocks = new Map(saved.pages.flatMap((page) => page.blocks.map((block) => [block.id, block] as const)));
    const newId = (ids: Map<string, string>, id: string, kind: "page" | "block") => {
      if (!ids.has(id)) ids.set(id, this.localId(kind));
      return ids.get(id)!;
    };
    const rebase = (document: ReportDocument): ReportDocument => {
      const previous = cached.get(document);
      if (previous) return previous;
      const next = reconcile(document).report;
      next.pages = next.pages.map((page) => {
        const canonical = savedPages.get(page.id);
        const id = canonical || page.id.startsWith("local-") ? page.id : newId(pageIds, page.id, "page");
        return { ...page, id, version: canonical?.version, created_at: canonical?.created_at, updated_at: canonical?.updated_at,
          blocks: page.blocks.map((block) => {
            const source = savedBlocks.get(block.id);
            const blockId = source || block.id.startsWith("local-") ? block.id : newId(blockIds, block.id, "block");
            return { ...block, id: blockId,
              ...(source && sameSource(source, block) ? { source_ref: source.source_ref, source_available: source.source_available } : {}),
              // A committed deletion is recreated, not sent back as an ID the
              // server no longer owns. Recreated linked content is an override.
              ...(!source && block.source_kind !== "manual" ? { config: { ...block.config, manual_override: true } } : {}),
              version: source?.version, created_at: source?.created_at, updated_at: source?.updated_at };
          }) };
      });
      cached.set(document, next);
      return next;
    };
    this.past = this.past.map(rebase);
    this.future = this.future.map(rebase);
    this.present = rebase(this.present || sent);
    const selections = new WeakMap<ReportDocument, Readonly<ReportEditorSelection>>();
    for (const [before, after] of cached) {
      const selection = this.selections.get(before);
      if (!selection) continue;
      const mapped = reconcile(before);
      const pageId = selection.pageId && (mapped.pageIds.get(selection.pageId) || selection.pageId);
      const blockId = selection.blockId && (mapped.blockIds.get(selection.blockId) || selection.blockId);
      selections.set(after, resolveReportSelection(after, {
        pageId: pageId && (pageIds.get(pageId) || pageId),
        blockId: blockId && (blockIds.get(blockId) || blockId),
      }));
    }
    this.selections = selections;
    this.saved = saved;
    this.closeGroup();
    return this.present;
  }
}
