"use client";

import { useId, useRef, useState, type DragEvent, type RefObject } from "react";
import { ArrowDown, ArrowUp, BarChart3, ChevronRight, Copy, FileText, Filter, GripVertical, Hash, MoreHorizontal, Plus, Table2, Trash2, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { ReportBlockType, ReportPage } from "@/lib/reports";
import { cn } from "@/lib/utils";
import { reorderReportPage } from "@/lib/report-page-editing";
import { tableTextMatcher } from "@/lib/table-text-search";
import { SearchField } from "@/components/ui/SearchField";

const blockIcons = { metric: Hash, chart: BarChart3, table: Table2, text: FileText, evidence: FileText, filter: Filter };
const PAGE_DRAG_TYPE = "application/x-receiptbi-report-page";

export { moveReportPage } from "@/lib/report-page-editing";

/** Search is navigation only: filtering never changes the report or selection. */
export function filterReportOutline(pages: ReportPage[], query: string, locale = "en") {
  const matches = tableTextMatcher(query, locale);
  return [...pages].sort((a, b) => a.order_index - b.order_index).flatMap((page, index) => {
    const pageMatches = matches(page.title);
    const blocks = pageMatches ? page.blocks : page.blocks.filter((block) => matches(block.title));
    return pageMatches || blocks.length ? [{ page, index, blocks }] : [];
  });
}

export function ReportOutline({ pages, activePageId, selectedBlockId, disabled, blockLabel, containerRef,
  onSelectPage, onSelectBlock, onAddPage, onMovePage, onReorderPage, onDuplicatePage, onDeletePage, onClose }: {
  pages: ReportPage[];
  activePageId: string;
  selectedBlockId: string | null;
  disabled: boolean;
  blockLabel: (type: ReportBlockType) => string;
  onSelectPage: (pageId: string) => void;
  onSelectBlock: (pageId: string, blockId: string) => void;
  onAddPage: () => void;
  onMovePage: (pageId: string, direction: -1 | 1) => void;
  onReorderPage: (pageId: string, targetId: string, edge: "before" | "after") => void;
  onDuplicatePage: (pageId: string) => void;
  onDeletePage: (pageId: string) => void;
  onClose: () => void;
  containerRef?: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("reportWorkspace");
  const locale = useLocale();
  const localRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const outlineRef = containerRef || localRef;
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [actions, setActions] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; edge: "before" | "after" } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const dragSource = useRef<string | null>(null);
  const moveHelp = useId();
  const canReorder = !disabled && !query.trim() && pages.length > 1;
  const edgeAt = (event: DragEvent<HTMLDivElement>) =>
    event.clientY < event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2 ? "before" : "after";
  const move = (pageId: string, direction: -1 | 1) => {
    if (disabled) return;
    const ordered = [...pages].sort((a, b) => a.order_index - b.order_index);
    const at = ordered.findIndex((page) => page.id === pageId);
    if (at < 0 || !ordered[at + direction]) return;
    onMovePage(pageId, direction);
    setAnnouncement(t("pageMoved", { title: ordered[at].title, number: at + direction + 1 }));
  };
  const matches = filterReportOutline(pages, query, locale);
  return <aside ref={outlineRef} data-report-editor-panel tabIndex={-1}
    aria-label={t("pagesAndBlocks")} className="report-outline flex h-full min-h-0 w-[248px] shrink-0 flex-col border-r border-border bg-card"
    onCompositionStartCapture={() => { composing.current = true; }}
    onCompositionEndCapture={() => { composing.current = false; }}
    onBlurCapture={() => { composing.current = false; }}
    onKeyDown={(event) => {
      if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.defaultPrevented) return;
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        const items = Array.from(outlineRef.current?.querySelectorAll<HTMLButtonElement>("button[data-outline-target]") || []);
        const at = items.indexOf(event.target as HTMLButtonElement);
        const fromSearch = event.target === searchRef.current;
        const next = fromSearch && event.key === "ArrowDown" ? 0 : at < 0 ? null
          : event.key === "ArrowDown" ? Math.min(at + 1, items.length - 1)
          : event.key === "ArrowUp" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
        if (next !== null && items.length) {
          event.preventDefault(); event.stopPropagation();
          if (next < 0) searchRef.current?.focus({ preventScroll: true }); else items[next]?.focus();
          return;
        }
      }
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation();
      if (dragSource.current) { dragSource.current = null; setDrop(null); }
      else if (actions) {
        const insideActions = event.target instanceof Element && event.target.closest("[data-outline-actions]");
        if (insideActions) {
          const trigger = Array.from(outlineRef.current?.querySelectorAll<HTMLButtonElement>("button[data-outline-actions-trigger]") || [])
            .find((button) => button.dataset.outlineActionsTrigger === actions);
          (trigger || searchRef.current)?.focus({ preventScroll: true });
        }
        setActions(null);
      } else if (query) { setQuery(""); searchRef.current?.focus({ preventScroll: true }); } else onClose();
    }}>
    <div className="flex h-14 shrink-0 items-center justify-between px-4">
      <h2 className="text-[13px] font-semibold">{t("pagesAndBlocks")}</h2>
      <div className="flex gap-1">
        <button type="button" aria-label={t("addPage")} disabled={disabled} onClick={onAddPage} className="report-editor-icon"><Plus size={15} /></button>
        <button type="button" aria-label={t("collapseOutline")} onClick={onClose} className="report-editor-icon"><X size={15} /></button>
      </div>
    </div>
    <SearchField inputRef={searchRef} value={query} onChange={setQuery} maxLength={200} clearOnEscape={false}
      label={t("searchOutline")} clearLabel={t("clearOutlineSearch")}
      className="mx-3 mb-3 shrink-0 rounded-lg border border-border bg-background pl-3 pr-1 focus-within:border-primary" inputClassName="h-10" />
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
      {!matches.length && <p role="status" className="px-3 py-8 text-xs text-muted-foreground">{t("outlineNoMatches")}</p>}
      {matches.map(({ page, index, blocks }) => {
        const active = page.id === activePageId;
        const open = Boolean(query.trim()) || (expanded[page.id] ?? active);
        return <div key={page.id} className="mb-2">
          <div data-report-page-row={page.id} className={cn("group relative flex items-center rounded-lg pr-1", active ? "bg-primary/10 text-primary" : "hover:bg-muted/70",
            drop?.id === page.id && (drop.edge === "before" ? "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:border-t-2 before:border-primary" : "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:border-b-2 after:border-primary"))}
            onDragOver={(event) => {
              if (!canReorder || !dragSource.current || dragSource.current === page.id) return;
              event.preventDefault(); event.dataTransfer.dropEffect = "move";
              const edge = edgeAt(event);
              setDrop((current) => current?.id === page.id && current.edge === edge ? current : { id: page.id, edge });
            }}
            onDragLeave={(event) => {
              if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDrop(null);
            }}
            onDrop={(event) => {
              const sourceId = dragSource.current;
              const edge = edgeAt(event);
              dragSource.current = null; setDrop(null);
              if (!canReorder || !sourceId || event.dataTransfer.getData(PAGE_DRAG_TYPE) !== sourceId) return;
              event.preventDefault();
              const next = reorderReportPage(pages, sourceId, page.id, edge);
              if (next === pages) return;
              onReorderPage(sourceId, page.id, edge);
              const at = next.findIndex((candidate) => candidate.id === sourceId);
              setAnnouncement(t("pageMoved", { title: next[at].title, number: at + 1 }));
            }}>
            <button type="button" draggable={canReorder} disabled={!canReorder} aria-label={t("reorderPage", { title: page.title })}
              title={t("reorderPage", { title: page.title })} aria-describedby={moveHelp} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              className="report-editor-icon !w-5 shrink-0 cursor-grab active:cursor-grabbing"
              onClick={() => setActions((current) => current === page.id ? null : page.id)}
              onKeyDown={(event) => {
                if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key) || event.nativeEvent.isComposing) return;
                event.preventDefault(); event.stopPropagation();
                if (canReorder) move(page.id, event.key === "ArrowUp" ? -1 : 1);
              }}
              onDragStart={(event) => {
                if (!canReorder) { event.preventDefault(); return; }
                dragSource.current = page.id; setActions(null);
                event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData(PAGE_DRAG_TYPE, page.id);
                event.dataTransfer.setDragImage(event.currentTarget.parentElement!, 20, 20);
              }}
              onDragEnd={() => { dragSource.current = null; setDrop(null); }}><GripVertical size={13} /></button>
            <button type="button" aria-label={t(open ? "collapsePage" : "expandPage", { title: page.title })} aria-expanded={open}
              disabled={Boolean(query.trim())} onClick={() => setExpanded((current) => ({ ...current, [page.id]: !open }))} className="report-editor-icon h-8 w-7 shrink-0"><ChevronRight size={14} className={cn(open && "rotate-90")} /></button>
            <button type="button" data-outline-target aria-current={active ? "page" : undefined} onClick={() => onSelectPage(page.id)} className="flex min-w-0 flex-1 items-center gap-2 py-3 text-left">
              <span className="text-[10px] tabular-nums opacity-65">{String(index + 1).padStart(2, "0")}</span>
              <span className="truncate text-xs font-medium">{page.title}</span>
              <span className="ml-auto text-[10px] tabular-nums opacity-60">{page.blocks.length}</span>
            </button>
            <button type="button" data-outline-actions-trigger={page.id} aria-label={t("pageActions", { title: page.title })} aria-expanded={actions === page.id}
              onClick={() => setActions((current) => current === page.id ? null : page.id)}
              className="report-editor-icon shrink-0" title={t("pageActions", { title: page.title })}><MoreHorizontal size={15} /></button>
          </div>
          {actions === page.id && <div data-outline-actions className="my-1 ml-7 flex gap-1 rounded-lg border border-border bg-background p-1" role="group" aria-label={t("pageActions", { title: page.title })}>
            <button type="button" disabled={disabled || index === 0} aria-label={t("movePageUp", { title: page.title })} title={t("movePageUp", { title: page.title })} onClick={() => move(page.id, -1)} className="report-editor-icon"><ArrowUp size={14} /></button>
            <button type="button" disabled={disabled || index === pages.length - 1} aria-label={t("movePageDown", { title: page.title })} title={t("movePageDown", { title: page.title })} onClick={() => move(page.id, 1)} className="report-editor-icon"><ArrowDown size={14} /></button>
            <button type="button" disabled={disabled} aria-label={t("duplicatePage", { title: page.title })} title={t("duplicatePage", { title: page.title })}
              onClick={() => {
                onDuplicatePage(page.id); setActions(null); setQuery("");
                requestAnimationFrame(() => outlineRef.current?.querySelector<HTMLButtonElement>('button[aria-current="page"]')?.focus());
              }} className="report-editor-icon"><Copy size={14} /></button>
            <span className="flex-1" />
            <button type="button" disabled={disabled || pages.length < 2} aria-label={t("deletePage", { title: page.title })} title={t("deletePage", { title: page.title })} onClick={() => { onDeletePage(page.id); setActions(null); }} className="report-editor-icon hover:!text-destructive"><Trash2 size={14} /></button>
          </div>}
          {open && <ol className="ml-4 mt-1 border-l border-border pl-2">
            {blocks.map((block) => {
              const Icon = blockIcons[block.block_type] || FileText;
              const selected = active && block.id === selectedBlockId;
              return <li key={block.id}><button type="button" data-outline-target aria-pressed={selected} onClick={() => onSelectBlock(page.id, block.id)}
                className={cn("mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs", selected ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                <Icon size={13} className="shrink-0" /><span className="truncate">{block.title || blockLabel(block.block_type)}</span>
              </button></li>;
            })}
            {!blocks.length && <li className="px-2 py-3 text-xs text-muted-foreground">{t("noContent")}</li>}
          </ol>}
        </div>;
      })}
    </div>
    <div role="status" aria-atomic="true" className="shrink-0 border-t border-border px-4 py-3 text-[11px] tabular-nums text-muted-foreground">
      {query.trim() ? t("outlineSearchCount", {
        matchedPages: matches.length, pages: pages.length,
        matchedBlocks: matches.reduce((sum, match) => sum + match.blocks.length, 0),
        blocks: pages.reduce((sum, page) => sum + page.blocks.length, 0),
      }) : t("outlineCount", { pages: pages.length, blocks: pages.reduce((sum, page) => sum + page.blocks.length, 0) })}
    </div>
    <p id={moveHelp} className="sr-only">{t("reorderPageHelp")}</p>
    <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
  </aside>;
}
