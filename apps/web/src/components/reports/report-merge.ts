import type { ReportBlock, ReportDocument, ReportPage } from "@/lib/reports";
import { reflowBlocks } from "@/lib/report-blocks";

export type MergeChoice = "mine" | "latest";
export type MergeField = "reportTitle" | "description" | "status" | "pageTitle" | "pageSettings" | "page" | "block" | "pageOrder" | "blockOrder" | "pagesRequired" | "blockPage" | "blockLinks" | "copySource";
export interface ReportMergeConflict {
  id: string;
  field: MergeField;
  label: string;
  mine: string | null;
  latest: string | null;
  restoresCopy: boolean;
}

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b)
    && a.length === b.length && a.every((value, index) => same(value, b[index]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && same(left[key], right[key]));
}

// Keep data, its source binding and presentation together. Never recursively
// merge rows/chart settings into a combination neither author actually saw.
function blockValue(block: ReportBlock | undefined, withoutLocalLinks = false): unknown {
  if (!block) return undefined;
  const config = { ...block.config };
  if (withoutLocalLinks) { delete config.interaction_key; delete config.filter_action; }
  return { title: block.title, block_type: block.block_type, source_kind: block.source_kind,
    analysis_run_id: block.analysis_run_id || null, artifact_id: block.artifact_id || null,
    content: block.content, config, width: block.layout.w, height: block.layout.h };
}
function pageValue(page: ReportPage | undefined): unknown {
  return page && { title: page.title, config: page.config,
    blocks: page.blocks.map((block) => ({ id: block.id, value: blockValue(block) })) };
}
function entitySummary(value: ReportPage | ReportBlock | undefined): string | null {
  if (!value) return null;
  if ("blocks" in value) return value.title;
  return [value.title, typeof value.content.text === "string" ? value.content.text.slice(0, 240) : ""].filter(Boolean).join(" — ");
}

interface BlockEntry { block: ReportBlock; page: ReportPage }
function blockIndex(document: ReportDocument) {
  return new Map(document.pages.flatMap((page) => page.blocks.map((block) => [block.id, { block, page }] as const)));
}
function placementValue(entry: BlockEntry | undefined) {
  return entry && { page: entry.page.id, key: entry.block.config.interaction_key ?? null,
    action: entry.block.config.filter_action ?? null };
}
function entryValue(entry: BlockEntry | undefined) {
  return entry && { page: entry.page.id, block: blockValue(entry.block) };
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

// A copied card keeps its own contents, but its source must still denote the
// same saved origin. A removed live source can retain its identity in a receipt.
function sameCopySource(block: ReportBlock, source: ReportBlock): boolean {
  if (block.source_kind !== source.source_kind) return false;
  const identity = (value: ReportBlock, key: "analysis_run_id" | "artifact_id") => {
    const ref = value.source_ref;
    const snapshot = record(ref?.snapshot) ? ref.snapshot : undefined;
    return value[key] || (typeof ref?.[key] === "string" ? ref[key] : null)
      || (typeof snapshot?.[key] === "string" ? snapshot[key] : null);
  };
  const keys = ["analysis_run_id", "artifact_id"] as const;
  if (!keys.every((key) => identity(block, key) === identity(source, key))) return false;
  // Older detached receipts sometimes have no identity. Do not infer an
  // unchanged source from two null foreign keys when their receipts differ.
  return keys.some((key) => identity(block, key)) || same(block.source_ref || {}, source.source_ref || {});
}

function staticCopy(block: ReportBlock): ReportBlock {
  const config = { ...block.config };
  delete config.manual_override;
  return { ...block, config, source_kind: "manual", analysis_run_id: null, artifact_id: null,
    copy_source_block_id: undefined, source_ref: undefined, source_available: true };
}

/** Describe connections with card/field names, never their internal keys. */
function linksSummary(entry: BlockEntry | undefined): string | null {
  if (!entry) return null;
  const lines: string[] = [];
  for (const source of entry.page.blocks) {
    const action = source.config.filter_action;
    if (!record(action) || typeof action.field !== "string" || !Array.isArray(action.targets)) continue;
    for (const target of action.targets) {
      if (!record(target) || typeof target.field !== "string" || typeof target.key !== "string") continue;
      const destination = entry.page.blocks.filter((block) => block.config.interaction_key === target.key);
      if (destination.length !== 1 || (source.id !== entry.block.id && destination[0].id !== entry.block.id)) continue;
      lines.push(`${source.title} · ${action.field} → ${destination[0].title} · ${target.field}`);
    }
  }
  return [...new Set(lines)].join("\n") || null;
}

/** Three-way, identity-based merge; unresolved choices are previews, never saveable results. */
export function mergeReportDocuments(base: ReportDocument, mine: ReportDocument, latest: ReportDocument,
  choices: Readonly<Record<string, MergeChoice>> = {}): { report: ReportDocument; conflicts: ReportMergeConflict[]; unresolved: number } {
  if ([mine, latest].some((report) => report.id !== base.id || report.project_id !== base.project_id || report.created_at !== base.created_at)
    || latest.version < base.version || mine.version !== base.version) throw new Error("Incompatible report comparison");
  for (const report of [base, mine, latest]) {
    const pageIds = report.pages.map((page) => page.id);
    const blockIds = report.pages.flatMap((page) => page.blocks.map((block) => block.id));
    if (new Set(pageIds).size !== pageIds.length || new Set(blockIds).size !== blockIds.length) throw new Error("Duplicate report identities");
  }
  const conflicts: ReportMergeConflict[] = [];
  const pick = <T,>(id: string, field: MergeField, label: string, original: T, local: T, remote: T,
    project: (value: T) => unknown = (value) => value,
    summary: (value: T) => string | null = (value) => typeof value === "string" ? value : null,
    restoresCopy = false): T => {
    const b = project(original), m = project(local), r = project(remote);
    if (same(m, r)) return remote;
    if (same(m, b)) return remote;
    if (same(r, b)) return local;
    conflicts.push({ id, field, label, mine: summary(local), latest: summary(remote), restoresCopy });
    return choices[id] === "mine" ? local : remote;
  };
  const mergeOrder = <T extends { id: string; title: string }>(id: string, field: "pageOrder" | "blockOrder", label: string,
    original: T[], local: T[], remote: T[], entries: T[]): T[] => {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const ids = (values: T[]) => values.map((value) => value.id).filter((key) => byId.has(key));
    // Insert the other side's missing members before their next surviving
    // neighbour. Deletion is handled by membership, never mistaken for a move.
    const complete = (primary: string[], secondary: string[]) => {
      const result = [...primary];
      const present = new Set(primary);
      for (let index = 0; index < secondary.length; index++) {
        const key = secondary[index];
        if (present.has(key)) continue;
        const next = secondary.slice(index + 1).find((candidate) => present.has(candidate));
        if (next) result.splice(result.indexOf(next), 0, key);
        else result.push(key);
        present.add(key);
      }
      return result;
    };
    const m = ids(local), r = ids(remote), ancestor = ids(original);
    // A retained entity omitted by one side was deleted there, not moved.
    // Restore its ancestor position before interleaving genuinely new entries.
    const localOrder = complete(complete(m, ancestor), r), remoteOrder = complete(complete(r, ancestor), m);
    const originalIds = new Set(ids(original)), localIds = new Set(m), remoteIds = new Set(r);
    const summary = (value: string[]) => value.map((key) => byId.get(key)!.title).join(" → ");
    const competingAdditions = !same(localOrder, remoteOrder)
      && m.some((key) => !originalIds.has(key) && !remoteIds.has(key))
      && r.some((key) => !originalIds.has(key) && !localIds.has(key));
    // Both authors can move the same existing card into this page, but choose
    // different insertion points. It is absent from this page's ancestor, so
    // filling the ancestor's missing IDs must not silently bless either order.
    const mPosition = new Map(m.map((key, index) => [key, index]));
    const rPosition = new Map(r.map((key, index) => [key, index]));
    const sharedAnchors = m.filter((key) => remoteIds.has(key));
    const competingPlacement = m.some((key) => !originalIds.has(key) && remoteIds.has(key) && sharedAnchors.some((anchor) =>
      (mPosition.get(key)! < mPosition.get(anchor)!) !== (rPosition.get(key)! < rPosition.get(anchor)!)));
    let order: string[];
    if (competingAdditions || competingPlacement) {
      conflicts.push({ id, field, label, mine: summary(localOrder), latest: summary(remoteOrder), restoresCopy: false });
      order = choices[id] === "mine" ? localOrder : remoteOrder;
    } else {
      order = pick(id, field, label, complete(ids(original), [...r, ...m]), localOrder, remoteOrder, (value) => value, summary);
    }
    // The chosen order never drops independently added entries from the other side.
    return [...new Set(order)].map((key) => byId.get(key)!);
  };
  const bPages = new Map(base.pages.map((page) => [page.id, page]));
  const mPages = new Map(mine.pages.map((page) => [page.id, page]));
  const rPages = new Map(latest.pages.map((page) => [page.id, page]));
  const bBlocks = blockIndex(base), mBlocks = blockIndex(mine), rBlocks = blockIndex(latest);
  const reconcileCopy = (block: ReportBlock, pageTitle: string): ReportBlock | undefined => {
    if (!block.id.startsWith("local-") || block.source_kind === "manual" || !block.copy_source_block_id) return block;
    const source = rBlocks.get(block.copy_source_block_id)?.block;
    if (source && sameCopySource(block, source)) return { ...block,
      analysis_run_id: source.analysis_run_id, artifact_id: source.artifact_id,
      source_ref: source.source_ref, source_available: source.source_available,
      config: !same(block.content, source.content) ? { ...block.config, manual_override: true } : block.config };
    const id = `copy-source:${block.id}`;
    conflicts.push({ id, field: "copySource", label: `${pageTitle} / ${block.title}`,
      mine: entitySummary(block), latest: null, restoresCopy: true });
    return choices[id] === "mine" ? staticCopy(block) : undefined;
  };
  const pages = new Map<string, ReportPage>();
  const retainedPages = new Map<string, MergeChoice>();
  for (const id of new Set([...bPages.keys(), ...mPages.keys(), ...rPages.keys()])) {
    const b = bPages.get(id), m = mPages.get(id), r = rPages.get(id);
    if (m && r) {
      pages.set(id, { ...r, blocks: [],
        title: pick(`page-title:${id}`, "pageTitle", m.title, b?.title, m.title, r.title)!,
        config: pick(`page-config:${id}`, "pageSettings", m.title, b?.config, m.config, r.config)! });
      continue;
    }
    // Deleting/moving cards out does not oppose deleting their now-empty page.
    // Edits, additions, incoming moves and surviving-card reorders still do.
    const retained = m || r;
    const otherBlocks = m ? rBlocks : mBlocks;
    const retainedBlocks = m ? mBlocks : rBlocks;
    const departed = new Set(b?.blocks.filter((block) => {
      const other = otherBlocks.get(block.id);
      return other && other.page.id !== id && same(placementValue(bBlocks.get(block.id)), placementValue(retainedBlocks.get(block.id)));
    }).map((block) => block.id));
    const retainedIds = new Set(retained?.blocks.map((block) => block.id));
    const comparable = b && { ...b, blocks: b.blocks.filter((block) => retainedIds.has(block.id) && !departed.has(block.id)) };
    const pageSide = (page: ReportPage | undefined) => page && { ...page, blocks: page.blocks.filter((block) => !departed.has(block.id)) };
    const before = conflicts.length;
    const selected = pick(`page:${id}`, "page", (m || r || b)!.title,
      comparable, pageSide(m), pageSide(r), pageValue, entitySummary, !!b && !!m && !r);
    if (selected) {
      pages.set(id, { ...selected, blocks: [] });
      // Retaining a deleted page already authorizes its missing contents. Do
      // not ask for an identical restore decision for each deleted child.
      if (conflicts.length > before) retainedPages.set(id, m ? "mine" : "latest");
    }
  }
  for (const id of new Set([...bBlocks.keys(), ...mBlocks.keys(), ...rBlocks.keys()])) {
    const b = bBlocks.get(id), m = mBlocks.get(id), r = rBlocks.get(id);
    if (![m, r].some((entry) => entry && pages.has(entry.page.id))) continue;
    let selected: ReportBlock | undefined;
    let placement: BlockEntry | undefined;
    if (m && r) {
      // Data/source/presentation stay atomic, while page-local links travel
      // with placement. Moving alone no longer conflicts with editing data.
      selected = pick(`block:${id}`, "block", m.block.title, b?.block, m.block, r.block,
        (block) => blockValue(block, true), entitySummary);
      const localPlace = pages.has(m.page.id) ? m : r;
      const remotePlace = pages.has(r.page.id) ? r : m;
      const field = localPlace.page.id === remotePlace.page.id ? "blockLinks" : "blockPage";
      placement = pick(`block-page:${id}`, field, m.block.title, b, localPlace, remotePlace, placementValue,
        field === "blockPage" ? (entry) => entry?.page.title ?? null : linksSummary);
    } else {
      const survivor = m || r;
      const entry = survivor && retainedPages.get(survivor.page.id) === (m ? "mine" : "latest") ? survivor
        : pick(`block:${id}`, "block", (m || r || b)!.block.title, b, m, r, entryValue,
          (entry) => entry ? `${entry.page.title} / ${entitySummary(entry.block)}` : null, !!b && !!m && !r);
      selected = entry?.block; placement = entry;
    }
    if (!selected || !placement) continue;
    selected = reconcileCopy(selected, pages.get(placement.page.id)!.title);
    if (!selected) continue;
    const config = { ...selected.config };
    delete config.interaction_key; delete config.filter_action;
    for (const key of ["interaction_key", "filter_action"] as const) {
      if (Object.hasOwn(placement.block.config, key)) config[key] = placement.block.config[key];
    }
    pages.get(placement.page.id)?.blocks.push({ ...selected, config });
  }
  for (const page of pages.values()) {
    page.blocks = mergeOrder(`block-order:${page.id}`, "blockOrder", page.title,
      bPages.get(page.id)?.blocks || [], mPages.get(page.id)?.blocks || [], rPages.get(page.id)?.blocks || [], page.blocks);
  }
  let ordered = mergeOrder("page-order", "pageOrder", "", base.pages, mine.pages, latest.pages, [...pages.values()]);
  if (!ordered.length && mine.pages.length) {
    // Independently deleting different pages can otherwise erase the whole report.
    conflicts.push({ id: "pages-required", field: "pagesRequired", label: "",
      mine: mine.pages.map((page) => page.title).join(" → "), latest: latest.pages.map((page) => page.title).join(" → "),
      restoresCopy: mine.pages.some((page) => !rPages.has(page.id) && !page.id.startsWith("local-")) });
    ordered = (choices["pages-required"] === "mine" ? mine.pages : latest.pages).map((page) => ({ ...page,
      blocks: page.blocks.flatMap((block) => { const copy = reconcileCopy(block, page.title); return copy ? [copy] : []; }) }));
  }
  const remoteBlocks = new Map(latest.pages.flatMap((page) => page.blocks.map((block) => [block.id, block] as const)));
  const report: ReportDocument = { ...latest,
    title: pick("title", "reportTitle", "", base.title, mine.title, latest.title),
    description: pick("description", "description", "", base.description, mine.description, latest.description),
    status: pick("status", "status", "", base.status, mine.status, latest.status),
    pages: ordered.map((page, order_index) => {
      const remote = rPages.get(page.id);
      return { ...page, order_index,
        id: !remote && !page.id.startsWith("local-") ? `local-page-merge-${page.id}` : page.id,
        version: remote?.version, created_at: remote?.created_at, updated_at: remote?.updated_at,
        blocks: reflowBlocks(page.blocks.map((block) => {
          const canonical = remoteBlocks.get(block.id);
          const restored = !canonical && !block.id.startsWith("local-");
          // Keeping something deleted remotely is an explicitly labelled static
          // copy, not resurrection of a server ID or a fabricated source receipt.
          const config = { ...block.config };
          if (canonical && block.source_kind !== "manual" && !same(block.content, canonical.content)) config.manual_override = true;
          return { ...(restored ? staticCopy(block) : { ...block, config }),
            ...(canonical && block.source_kind === canonical.source_kind && block.analysis_run_id === canonical.analysis_run_id
              && block.artifact_id === canonical.artifact_id ? { source_ref: canonical.source_ref, source_available: canonical.source_available } : {}),
            ...(restored ? { id: `local-block-merge-${block.id}` } : {}),
            version: canonical?.version, created_at: canonical?.created_at, updated_at: canonical?.updated_at };
        })) };
    }) };
  return { report, conflicts, unresolved: conflicts.filter((conflict) => choices[conflict.id] !== "mine" && choices[conflict.id] !== "latest").length };
}
