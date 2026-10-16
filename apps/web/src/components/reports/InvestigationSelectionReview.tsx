"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { InvestigationArtifactChoice } from "./InvestigationContentList";
import { groupInvestigationSelection, type InvestigationSelection } from "./investigation-selection";
import type { AnalysisArtifactSummary } from "@/lib/types/api";
import { artifactContentKey, type ArtifactContentState } from "./useReportArtifactContent";
import { Button } from "@/components/ui/button";

const actionClass = "aria-disabled:opacity-30";

export function InvestigationSelectionReview({ selection, onRemove, onClear, onMoveItem, onMoveGroup, contents, onLoad }: {
  selection: InvestigationSelection; onRemove: (key: string) => void; onClear: () => void;
  onMoveItem: (key: string, direction: -1 | 1) => void; onMoveGroup: (key: string, direction: -1 | 1) => void;
  contents: ReadonlyMap<string, ArtifactContentState>; onLoad: (artifact: AnalysisArtifactSummary) => void;
}) {
  const t = useTranslations("investigationPicker");
  const root = useRef<HTMLElement>(null);
  const movedControl = useRef<HTMLButtonElement | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const groups = groupInvestigationSelection(selection);
  useLayoutEffect(() => {
    const control = movedControl.current;
    movedControl.current = null;
    if (!control || !root.current?.contains(control)) return;
    if (document.activeElement !== control && document.activeElement !== document.body) return;
    control.focus({ preventScroll: true });
    control.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selection]);

  const moveControls = (key: string, title: string, index: number, total: number, group = false) => <>
    {([-1, 1] as const).map((direction) => {
      const disabled = index + direction < 0 || index + direction >= total;
      const Icon = direction === -1 ? ArrowUp : ArrowDown;
      const label = t(group ? direction === -1 ? "order.groupEarlier" : "order.groupLater"
        : direction === -1 ? "order.itemEarlier" : "order.itemLater", { title });
      return <Button variant="ghost" size="icon" key={direction} aria-label={label} title={label} aria-disabled={disabled}
        onClick={(event) => {
          if (disabled) return;
          movedControl.current = event.currentTarget;
          (group ? onMoveGroup : onMoveItem)(key, direction);
          setAnnouncement(t(group ? "order.groupMoved" : "order.itemMoved", { title, position: index + direction + 1, total }));
        }} className={actionClass}><Icon size={14} aria-hidden="true" /></Button>;
    })}
  </>;
  // Removing a focused row must not leave keyboard users outside the dialog.
  // Focus a surviving removal control before React removes the current row.
  const remove = (key: string, current: HTMLElement) => {
    const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>("[data-remove-selection]") ?? []);
    const index = buttons.indexOf(current as HTMLButtonElement);
    (buttons[index + 1] || buttons[index - 1] || root.current)?.focus();
    onRemove(key);
  };
  return <section ref={root} tabIndex={-1} aria-label={t("selectedContent")}
    className="min-h-0 min-w-0 flex-1 overflow-y-auto outline-none">
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
    <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/20 px-5 py-3">
      <div className="min-w-0 text-xs text-muted-foreground"><p>{t("selectionSources", { count: groups.length })}</p>
        {selection.size > 1 && <p className="mt-1 text-[11px]">{t("order.addInOrder")}</p>}
      </div>
      <Button variant="ghost" size="sm" onClick={() => { root.current?.focus(); onClear(); }} disabled={selection.size === 0}
        className="text-primary">{t("clearAllSelection")}</Button>
    </div>
    {!groups.length && <p className="px-6 py-16 text-center text-sm text-muted-foreground">{t("selectionEmpty")}</p>}
    {groups.map((group, groupIndex) => {
      const title = group.run.report.title?.trim() || group.run.query.trim() || t("unnamedRun");
      const controls = (key: string, itemTitle: string, index: number) => <div className="flex shrink-0 items-center">
        {group.items.length > 1 && moveControls(key, itemTitle, index, group.items.length)}
        <Button variant="ghost" size="icon" data-remove-selection aria-label={t("removeSelection", { title: itemTitle })}
          onClick={(event) => remove(key, event.currentTarget)} className="hover:text-destructive"><X size={14} aria-hidden="true" /></Button>
      </div>;
      return <section key={group.key} aria-label={title}>
      <div className="flex items-start gap-2 border-b border-border bg-muted/30 px-5 py-3">
        <h3 className="min-w-0 flex-1 break-words py-1.5 text-xs font-semibold leading-5">
          {title}<span className="ml-2 font-normal tabular-nums text-muted-foreground">{group.items.length}</span>
        </h3>
        {groups.length > 1 && <div className="flex shrink-0">{moveControls(group.key, title, groupIndex, groups.length, true)}</div>}
      </div>
      <ul className="divide-y divide-border">
        {group.items.map(({ key, item }, index) => item.kind === "artifact"
          ? <InvestigationArtifactChoice key={key} artifact={item.artifact} selected existing={false}
              content={contents.get(artifactContentKey(item.artifact))} onLoad={() => onLoad(item.artifact)}
              onToggle={() => onRemove(key)}
              removalControl={controls(key, item.artifact.title, index)} />
          : <li key={key} className="flex items-start gap-3 px-5 py-4">
              <div className="min-w-0 flex-1"><p className="text-sm font-medium">{t("summaryLabel")}</p>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{item.run.report.summary || item.run.query}</p></div>
              {controls(key, t("summaryLabel"), index)}
            </li>)}
      </ul>
    </section>; })}
  </section>;
}
